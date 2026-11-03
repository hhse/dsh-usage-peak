/**
 * dsh-usage-peak — Host half.
 *
 * Reads the session logs (~/.dsh/sessions/<cwd>/<session>/session.v4.jsonl.zstd),
 * reconstructs every model request from its `assistant/message` usage, prices it
 * with the DeepSeek peak/valley tariff (Beijing time), and serves the result as
 * JSON for the Settings page dashboard implemented in ./client.js.
 *
 * The whale ledger (~/.dsh/.dshw-usage.json) is only used as a cross-check:
 * it knows account-level spend but not the input/cache/output split.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const NS = 'dsh-usage-peak';
const ROUTE_BASE = '/plugin/dsh-usage-peak';
const SNAPSHOT_TTL_MS = 15_000;
const BJ_OFFSET = 8 * 60 * 60 * 1000;
const DAYS_SHOWN = 14;
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]); // zstd frame magic, little endian

/** CNY per million tokens, [valley, peak]. */
const PRICING = [
  { id: 'flash', label: 'DeepSeek Flash', match: 'flash', hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
  { id: 'pro', label: 'DeepSeek Pro', match: 'pro', hit: [0.15, 0.3], miss: [4.5, 9], out: [13.5, 27] },
];

function priceFor(model) {
  const name = String(model || '').toLowerCase();
  if (name.includes('pro')) return PRICING[1];
  return PRICING[0];
}

function bjDate(ts) {
  return new Date(ts + BJ_OFFSET);
}

function dayKey(ts) {
  return bjDate(ts).toISOString().slice(0, 10);
}

/** Peak = Beijing Mon-Fri 09:00-12:00 and 14:00-18:00; everything else is valley (half price). */
function isPeakAt(ts) {
  const d = bjDate(ts);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080);
}

/** Next tariff switch after `ts`, with the status it switches into. */
function nextSwitch(ts) {
  const d = bjDate(ts);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const da = d.getUTCDate();
  for (let k = 0; k < 9; k += 1) {
    const probe = new Date(Date.UTC(y, mo, da + k));
    const dow = probe.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (const hour of [9, 12, 14, 18]) {
      const at = Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth(), probe.getUTCDate(), hour, 0, 0) - BJ_OFFSET;
      if (at > ts) return { at, status: hour === 9 || hour === 14 ? 'peak' : 'valley' };
    }
  }
  return { at: ts + 3600_000, status: 'valley' };
}

/* ------------------------------------------------------------------ */
/* Session log decoding                                                */
/* ------------------------------------------------------------------ */

/**
 * Session logs are concatenated zstd frames; Node's zstd entry points stop after
 * the first frame. Split on the frame magic and stitch the frames back together.
 */
function decodeSessionFile(file) {
  const buf = fs.readFileSync(file);
  const starts = [];
  let cursor = 0;
  for (;;) {
    const at = buf.indexOf(MAGIC, cursor);
    if (at < 0) break;
    starts.push(at);
    cursor = at + 4;
  }
  if (starts.length === 0) return buf.toString('utf8');
  const chunks = [];
  let index = 0;
  while (index < starts.length) {
    let accepted;
    for (let end = index + 1; end <= starts.length; end += 1) {
      const stop = end < starts.length ? starts[end] : buf.length;
      try {
        accepted = { data: zlib.zstdDecompressSync(buf.subarray(starts[index], stop)), next: end };
        break;
      } catch {
        /* a magic-looking byte inside a frame: keep growing the slice */
      }
    }
    if (!accepted) {
      index += 1;
      continue;
    }
    chunks.push(accepted.data);
    index = accepted.next;
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** One turn per billed model request: { t, model, input, cache, output }. */
function parseSessionTurns(text) {
  const turns = [];
  for (const line of text.split('\n')) {
    if (line.length < 2) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.type !== 'assistant/message') continue;
    const usage = record.data && record.data.usage;
    if (!usage) continue;
    const model = (record.data.message && record.data.message.source && record.data.message.source.model) || 'unknown';
    turns.push({
      t: record.time,
      model,
      input: usage.inputTokens || 0,
      cache: usage.cacheReadTokens || 0,
      output: usage.outputTokens || 0,
    });
  }
  return turns;
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

const fileCache = new Map(); // file -> { mtimeMs, size, turns }
let snapshotCache = null;

function collectTurns() {
  const root = path.join(os.homedir(), '.dsh', 'sessions');
  const turns = [];
  let workspaceDirs;
  try {
    workspaceDirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return turns;
  }
  for (const workspace of workspaceDirs) {
    if (!workspace.isDirectory()) continue;
    const workspacePath = path.join(root, workspace.name);
    let sessions;
    try {
      sessions = fs.readdirSync(workspacePath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      const dir = path.join(workspacePath, session.name);
      const file = path.join(dir, 'session.v4.jsonl.zstd');
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      let entry = fileCache.get(file);
      if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
        let parsed = [];
        try {
          parsed = parseSessionTurns(decodeSessionFile(file));
        } catch {
          parsed = [];
        }
        entry = { mtimeMs: stat.mtimeMs, size: stat.size, turns: parsed };
        fileCache.set(file, entry);
      }
      for (const turn of entry.turns) turns.push(turn);
    }
  }
  return turns;
}

function emptyDay(day) {
  const hours = [];
  for (let hour = 0; hour < 24; hour += 1) hours.push({ hour, cost: 0, calls: 0 });
  return {
    day,
    calls: 0,
    inputTokens: 0,
    cacheTokens: 0,
    outputTokens: 0,
    cost: 0,
    costCache: 0,
    costMiss: 0,
    costOut: 0,
    peakCost: 0,
    valleyCost: 0,
    hours,
    models: {},
    firstAt: 0,
    lastAt: 0,
  };
}

function addTurn(day, turn) {
  const price = priceFor(turn.model);
  const peak = isPeakAt(turn.t);
  const offset = peak ? 1 : 0;
  const costCache = (turn.cache / 1e6) * price.hit[offset];
  const costMiss = (turn.input / 1e6) * price.miss[offset];
  const costOut = (turn.output / 1e6) * price.out[offset];
  const cost = costCache + costMiss + costOut;

  day.calls += 1;
  day.inputTokens += turn.input;
  day.cacheTokens += turn.cache;
  day.outputTokens += turn.output;
  day.cost += cost;
  day.costCache += costCache;
  day.costMiss += costMiss;
  day.costOut += costOut;
  if (peak) day.peakCost += cost;
  else day.valleyCost += cost;
  if (!day.firstAt || turn.t < day.firstAt) day.firstAt = turn.t;
  if (turn.t > day.lastAt) day.lastAt = turn.t;

  const hour = bjDate(turn.t).getUTCHours();
  const bucket = day.hours[hour];
  bucket.cost += cost;
  bucket.calls += 1;

  const modelKey = price.id;
  const slot = day.models[modelKey] || (day.models[modelKey] = { calls: 0, cost: 0, tokens: 0 });
  slot.calls += 1;
  slot.cost += cost;
  slot.tokens += turn.input + turn.cache + turn.output;
}

function readLedger() {
  const file = path.join(os.homedir(), '.dsh', '.dshw-usage.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      file,
      ok: true,
      date: raw.date,
      todayUsage: typeof raw.todayUsage === 'number' ? raw.todayUsage : null,
      balance: typeof raw.lastBalance === 'number' ? raw.lastBalance : null,
      dayStart: typeof raw.dayStart === 'number' ? raw.dayStart : null,
      history: raw.history && typeof raw.history === 'object' ? raw.history : {},
      updatedAt: fs.statSync(file).mtimeMs,
    };
  } catch {
    return { file, ok: false, history: {} };
  }
}

function shapeDay(day) {
  const tokens = day.inputTokens + day.cacheTokens + day.outputTokens;
  const billable = Math.max(1, day.cacheTokens + day.inputTokens);
  return {
    day: day.day,
    calls: day.calls,
    tokens,
    inputTokens: day.inputTokens,
    cacheTokens: day.cacheTokens,
    outputTokens: day.outputTokens,
    cost: round(day.cost),
    costCache: round(day.costCache),
    costMiss: round(day.costMiss),
    costOut: round(day.costOut),
    peakCost: round(day.peakCost),
    valleyCost: round(day.valleyCost),
    peakShare: day.cost > 0 ? day.peakCost / day.cost : 0,
    hitRate: (day.cacheTokens + day.inputTokens) > 0 ? day.cacheTokens / billable : 0,
    avgTokens: day.calls > 0 ? Math.round(tokens / day.calls) : 0,
    firstAt: day.firstAt,
    lastAt: day.lastAt,
    models: day.models,
  };
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function buildSnapshot() {
  const now = Date.now();
  if (snapshotCache && now - snapshotCache.builtAt < SNAPSHOT_TTL_MS) return snapshotCache.payload;

  const turns = collectTurns();
  const days = new Map();
  let unknownModels = new Set();

  for (const turn of turns) {
    if (!Number.isFinite(turn.t)) continue;
    const key = dayKey(turn.t);
    let day = days.get(key);
    if (!day) {
      day = emptyDay(key);
      days.set(key, day);
    }
    addTurn(day, turn);
    if (!/flash|pro/i.test(turn.model)) unknownModels.add(turn.model);
  }

  const ledger = readLedger();

  const dayList = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  const window = dayList.slice(-DAYS_SHOWN).map((day) => {
    const shaped = shapeDay(day);
    const booked = ledger.history && ledger.history[day.day];
    shaped.ledger = typeof booked === 'number' ? round(booked) : null;
    shaped.hours = day.hours.map((bucket) => ({
      hour: bucket.hour,
      cost: round(bucket.cost),
      calls: bucket.calls,
      peak: isPeakAt(Date.parse(`${day.day}T00:00:00Z`) - BJ_OFFSET + bucket.hour * 3600_000),
    }));
    return shaped;
  });

  const todayKey = dayKey(now);
  const today = window.find((entry) => entry.day === todayKey) || null;
  const todayHours = today ? today.hours : emptyDay(todayKey).hours.map((bucket) => ({
    hour: bucket.hour,
    cost: 0,
    calls: 0,
    peak: isPeakAt(Date.parse(`${todayKey}T00:00:00Z`) - BJ_OFFSET + bucket.hour * 3600_000),
  }));

  const last7 = window.slice(-7);
  const week = last7.reduce(
    (acc, entry) => ({
      cost: acc.cost + entry.cost,
      calls: acc.calls + entry.calls,
      tokens: acc.tokens + entry.tokens,
      peakCost: acc.peakCost + entry.peakCost,
      costCache: acc.costCache + entry.costCache,
      costMiss: acc.costMiss + entry.costMiss,
      costOut: acc.costOut + entry.costOut,
      days: acc.days + 1,
    }),
    { cost: 0, calls: 0, tokens: 0, peakCost: 0, costCache: 0, costMiss: 0, costOut: 0, days: 0 },
  );

  const switchPoint = nextSwitch(now);
  const peakNow = isPeakAt(now);
  const currentPrice = PRICING[0];

  const models = PRICING.map((price) => {
    let calls = 0;
    let cost = 0;
    let tokens = 0;
    for (const entry of window) {
      const slot = entry.models[price.id];
      if (!slot) continue;
      calls += slot.calls;
      cost += slot.cost;
      tokens += slot.tokens;
    }
    return { id: price.id, label: price.label, calls, cost: round(cost), tokens };
  });

  const payload = {
    ok: true,
    generatedAt: now,
    tz: 'Asia/Shanghai',
    now: {
      ts: now,
      day: todayKey,
      peak: peakNow,
      hour: bjDate(now).getUTCHours(),
      minutesIntoHour: bjDate(now).getUTCMinutes(),
      nextAt: switchPoint.at,
      nextStatus: switchPoint.status,
      price: {
        hit: currentPrice.hit[peakNow ? 1 : 0],
        miss: currentPrice.miss[peakNow ? 1 : 0],
        out: currentPrice.out[peakNow ? 1 : 0],
      },
    },
    today,
    hours: todayHours,
    days: window,
    week: {
      cost: round(week.cost),
      calls: week.calls,
      tokens: week.tokens,
      peakCost: round(week.peakCost),
      costCache: round(week.costCache),
      costMiss: round(week.costMiss),
      costOut: round(week.costOut),
      peakShare: week.cost > 0 ? week.peakCost / week.cost : 0,
      avgPerDay: week.days > 0 ? round(week.cost / week.days) : 0,
      avgPerCall: week.calls > 0 ? Math.round(week.tokens / week.calls) : 0,
    },
    models,
    pricing: PRICING.map((price) => ({
      id: price.id,
      label: price.label,
      hit: price.hit,
      miss: price.miss,
      out: price.out,
    })),
    ledger,
    warnings: unknownModels.size > 0 ? [`未识别的模型按 Flash 价计算: ${[...unknownModels].join(', ')}`] : [],
  };

  snapshotCache = { builtAt: now, payload };
  return payload;
}

/* ------------------------------------------------------------------ */
/* HTTP surface                                                        */
/* ------------------------------------------------------------------ */

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(body.length),
  });
  res.end(body);
}

export const name = NS;

export function apply(ctx) {
  const webServer = (typeof ctx.get === 'function' && ctx.get('webServer')) || ctx.webServer;
  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger?.warn?.(`[${NS}] no webServer in this profile; dashboard route skipped`);
    return;
  }

  const trustCheck = (req, res) => {
    try {
      const connection = (typeof ctx.get === 'function' && ctx.get('connection')) || ctx.connection;
      if (!connection || typeof connection.requestRejection !== 'function') return false;
      const rejection = connection.requestRejection(req);
      if (rejection === undefined || rejection === null || rejection === false) return false;
      res.statusCode = typeof rejection === 'number' ? rejection : 403;
      res.end();
      return true;
    } catch {
      return false;
    }
  };

  const register = (route) => {
    try {
      return webServer.register(route);
    } catch (error) {
      // Hot reload can apply the new half before the old one finalises; a
      // duplicate route must not take the whole plugin down.
      ctx.logger?.warn?.(`[${NS}] route ${route.path} not registered: ${String((error && error.message) || error)}`);
      return () => {};
    }
  };

  const dispose = register({
    kind: 'exact',
    path: `${ROUTE_BASE}/data`,
    handler: async (req, res) => {
      if (trustCheck(req, res)) return;
      if ((req.method || 'GET').toUpperCase() !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.searchParams.get('fresh') === '1' || url.searchParams.get('fresh') === 'true') snapshotCache = null;
      try {
        sendJson(res, 200, buildSnapshot());
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String((error && error.stack) || error) });
      }
    },
  });

  ctx.effect(() => () => {
    dispose();
  }, `${NS}: dashboard route`);
}
