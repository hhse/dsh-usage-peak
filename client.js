/**
 * dsh-usage-peak — Client half.
 *
 * Two surfaces over one data feed (/plugin/dsh-usage-peak/data):
 *  - a compact pill on its own row in the sidebar panel list,
 *  - a details page in Settings.
 *
 * Locale dictionaries are FLAT (`Record<string, string>`), as the client locale
 * service requires: nested objects silently fall back to the bare key.
 */
window.__ModuleLoader__.load({
  id: 'dsh-usage-peak',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const NS = 'dsh-usage-peak';
    const DATA_URL = '/plugin/dsh-usage-peak/data';

    const dicts = {
      zh: {
        'settings.title': '用量仪表盘',
        'settings.description': '峰谷时段与每天的花费、请求量、缓存命中',

        'widget.today': '今日',
        'widget.peak': '峰时',
        'widget.valley': '谷时',
        'widget.toPeak': '后转峰',
        'widget.toValley': '后转谷',
        'widget.soon': '即将切换',
        'widget.rail': '用量',
        'widget.railTitle': '用量仪表盘',
        'widget.failed': '读取失败',
        'widget.loading': '读取中',

        'page.title': '用量仪表盘',
        'page.subtitle': 'DeepSeek 峰谷计价 · 北京时区',
        'page.refresh': '刷新',
        'page.updated': '更新于',
        'page.loading': '正在统计会话日志…',
        'page.error': '读取失败',
        'page.retry': '重试',

        'status.peak': '峰时',
        'status.valley': '谷时',
        'status.switchIn': '距转',

        'kpi.calls': '今日请求',
        'kpi.tokens': 'tokens',
        'kpi.hit': '缓存命中',
        'kpi.peakShare': '峰时占比',
        'kpi.perCall': '平均每次',
        'kpi.balance': '余额',
        'kpi.today': '今日',
        'kpi.cache': '缓存',
        'kpi.out': '输出',
        'kpi.peakCost': '峰',
        'kpi.valleyCost': '谷',

        'chart.hours': '今日每小时花费',
        'chart.hoursHint': '橙 峰时 · 绿 谷时',
        'chart.days': '近 14 天',
        'chart.daysHint': '橙 峰时 · 绿 谷时',

        'cost.title': '今日花费构成',
        'cost.cache': '缓存命中',
        'cost.miss': '未命中输入',
        'cost.out': '输出',

        'price.title': '价目表',
        'price.hint': '元 / 百万 tokens',
        'price.model': '模型',
        'price.period': '时段',
        'price.hit': '命中',
        'price.miss': '未命中',
        'price.out': '输出',
        'price.current': '当前',
      },
      en: {
        'settings.title': 'Usage dashboard',
        'settings.description': 'Peak/valley windows with daily spend, requests and cache hits',

        'widget.today': 'Today',
        'widget.peak': 'Peak',
        'widget.valley': 'Valley',
        'widget.toPeak': ' to peak',
        'widget.toValley': ' to valley',
        'widget.soon': 'switching',
        'widget.rail': 'Usage',
        'widget.railTitle': 'Usage dashboard',
        'widget.failed': 'failed',
        'widget.loading': 'loading',

        'page.title': 'Usage dashboard',
        'page.subtitle': 'DeepSeek peak/valley pricing · Beijing time',
        'page.refresh': 'Refresh',
        'page.updated': 'Updated',
        'page.loading': 'Reading session logs…',
        'page.error': 'Failed to load',
        'page.retry': 'Retry',

        'status.peak': 'Peak',
        'status.valley': 'Valley',
        'status.switchIn': 'in',

        'kpi.calls': 'Requests',
        'kpi.tokens': 'tokens',
        'kpi.hit': 'Cache hit',
        'kpi.peakShare': 'Peak share',
        'kpi.perCall': 'per request',
        'kpi.balance': 'Balance',
        'kpi.today': 'today',
        'kpi.cache': 'cache',
        'kpi.out': 'output',
        'kpi.peakCost': 'peak',
        'kpi.valleyCost': 'valley',

        'chart.hours': 'Cost per hour today',
        'chart.hoursHint': 'orange peak · green valley',
        'chart.days': 'Last 14 days',
        'chart.daysHint': 'orange peak · green valley',

        'cost.title': 'Today by token type',
        'cost.cache': 'Cache hits',
        'cost.miss': 'Missed input',
        'cost.out': 'Output',

        'price.title': 'Price list',
        'price.hint': 'CNY per million tokens',
        'price.model': 'Model',
        'price.period': 'Period',
        'price.hit': 'Hit',
        'price.miss': 'Miss',
        'price.out': 'Output',
        'price.current': 'now',
      },
    };

    const C = {
      text: 'var(--dsw-alias-label-primary)',
      text2: 'var(--dsw-alias-label-secondary)',
      text3: 'var(--dsw-alias-label-tertiary)',
      border: 'var(--dsw-alias-border-l2)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      peak: 'var(--dsw-alias-state-warn-primary)',
      valley: 'var(--dsw-alias-state-success-primary)',
      cache: 'var(--dsw-alias-state-business-primary)',
      miss: 'var(--dsw-alias-state-warn-primary)',
      out: 'var(--dsw-alias-brand-primary)',
    };

    /* ------------------------------ formatting ------------------------------ */

    const yuan = (value, digits) =>
      value === null || value === undefined || Number.isNaN(value)
        ? '—'
        : `¥${Number(value).toFixed(digits === undefined ? 2 : digits)}`;

    function tokens(value) {
      if (!value) return '0';
      if (value >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
      if (value >= 1e4) return `${(value / 1e4).toFixed(1)} 万`;
      return String(Math.round(value));
    }

    /** Ultra compact for the pill: 1.2B / 12.8M / 942K. */
    function shortTokens(value) {
      if (!value) return '0';
      if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
      if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
      if (value >= 1e3) return `${Math.round(value / 1e3)}K`;
      return String(Math.round(value));
    }

    const percent = (value, digits) =>
      value === null || value === undefined || Number.isNaN(value)
        ? '—'
        : `${(value * 100).toFixed(digits === undefined ? 1 : digits)}%`;

    function clock(ts) {
      const date = new Date(ts);
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    /** Short numeric countdown: 27分 / 1:27 / 3:19. */
    function countdown(ms) {
      const total = Math.max(0, Math.round(ms / 60000));
      const hours = Math.floor(total / 60);
      const minutes = total % 60;
      return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}` : `${minutes}分`;
    }

    /* --------------------------------- data --------------------------------- */

    function useFeed() {
      const [state, setState] = useState({ loading: true, error: null, data: null });
      const [tick, setTick] = useState(0);

      const load = useCallback((fresh) => {
        const url = fresh ? `${DATA_URL}?fresh=1` : DATA_URL;
        fetch(url, { headers: { accept: 'application/json' } })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((data) => {
            if (!data || data.ok === false) throw new Error((data && data.error) || 'bad payload');
            setState({ loading: false, error: null, data });
          })
          .catch((error) =>
            setState((previous) => ({ loading: false, error: String(error && error.message), data: previous.data })),
          );
      }, []);

      useEffect(() => {
        load(false);
        const timer = setInterval(() => load(false), 60_000);
        return () => clearInterval(timer);
      }, [load]);

      // A failed start (the host half may register its route a moment after the
      // page boots) should not leave the widget stuck on "读取失败" for a minute.
      const failing = !!state.error;
      useEffect(() => {
        if (!failing) return undefined;
        const timer = setTimeout(() => load(false), 5_000);
        return () => clearTimeout(timer);
      }, [failing, load, state.error]);

      useEffect(() => {
        const timer = setInterval(() => setTick((value) => value + 1), 15_000);
        return () => clearInterval(timer);
      }, []);

      return { ...state, tick, reload: load };
    }

    /* -------------------------------- atoms --------------------------------- */

    function Pill(props) {
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 11px',
            borderRadius: 999,
            background: C.layer2,
            border: `1px solid ${C.border}`,
            fontSize: 12,
            lineHeight: '18px',
            color: C.text2,
            whiteSpace: 'nowrap',
            ...(props.style || {}),
          },
        },
        props.children,
      );
    }

    function Dot(props) {
      return h('span', {
        style: {
          width: 7,
          height: 7,
          borderRadius: 4,
          flex: 'none',
          background: props.tone,
          boxShadow: props.glow ? `0 0 0 3px ${props.tone}22` : 'none',
        },
      });
    }

    function Sep() {
      return h('span', { style: { color: C.text3, opacity: 0.7 } }, '·');
    }

    /* ----------------------------- sidebar widget ---------------------------- */

    /**
     * A row of its own in the sidebar's panel list.
     *
     * The list row is a normal nav row (36px), so the pill sits there as the
     * row's glyph with an empty label: nothing to squeeze, nothing to overlap.
     * Clicking the row opens the details page as a main panel.
     */
    function PanelGlyph(props) {
      const t = props.t;
      const { data } = useFeed();
      const rail = !!props.rail;
      const open = typeof props.onOpen === 'function' ? props.onOpen : null;
      const rootProps = { 'data-usage-widget': '', title: '' };

      const peak = data ? data.now.peak : null;
      const loading = !data;
      const tone = loading ? C.text3 : peak ? C.peak : C.valley;
      const word = loading ? t('widget.loading') : peak ? t('widget.peak') : t('widget.valley');
      const short = word.slice(0, 1) === '峰' ? '峰' : word.slice(0, 1) === '谷' ? '谷' : word;
      const remain = data ? Math.max(0, data.now.nextAt - Date.now()) : 0;
      const switchText =
        data && remain > 30_000
          ? `${countdown(remain)} ${peak ? t('widget.toValley') : t('widget.toPeak')}`
          : t('widget.soon');
      const today = data && data.today ? data.today.cost : null;
      const tip = data
        ? `${word} · ${t('widget.today')} ${yuan(today)} · ${tokens(data.today ? data.today.tokens : 0)} tokens · ${t('status.switchIn')} ${switchText}`
        : word;

      // The seat is the shell's own flex row: the root takes a whole line (see
      // CSS) and the pill keeps its intrinsic width on it.
      const rootStyle = { display: 'flex', alignItems: 'center', minWidth: 0 };
      if (open) rootStyle.cursor = 'pointer';

      const pillStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 21,
        padding: '0 8px',
        borderRadius: 999,
        border: `1px solid ${C.border}`,
        fontSize: 10.5,
        lineHeight: '19px',
        color: C.text2,
        maxWidth: '100%',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
      };

      const pill = rail
        ? h(Dot, { tone })
        : h(
            'span',
            { style: pillStyle },
            h(Dot, { tone, glow: true }),
            h('span', { style: { color: tone, fontWeight: 600, flex: 'none' } }, short),
            h('span', { style: { color: C.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums', flex: 'none' } }, yuan(today)),
            h(Sep),
            h(
              'span',
              { style: { color: C.text2, flex: 'none', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } },
              data && data.today ? shortTokens(data.today.tokens) : '—',
              h('span', { style: { color: C.text3, marginLeft: 2 } }, 'tok'),
            ),
            h(Sep),
            h('span', { style: { color: C.text3, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis' } }, data ? switchText : ''),
          );

      return h('div', { ...rootProps, title: tip, onClick: open || undefined, style: rootStyle }, pill);
    }

    /* ------------------------------- page bits ------------------------------- */

    function Card(props) {
      return h(
        'section',
        {
          style: {
            background: C.layer1,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minWidth: 0,
            ...(props.style || {}),
          },
        },
        props.children,
      );
    }

    function CardTitle(props) {
      return h(
        'header',
        { style: { display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'space-between' } },
        h('h3', { style: { margin: 0, fontSize: 12.5, fontWeight: 600, color: C.text } }, props.title),
        props.hint ? h('span', { style: { fontSize: 10.5, color: C.text3 } }, props.hint) : null,
      );
    }

    function Kpi(props) {
      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: '10px 14px',
            borderRadius: 10,
            border: `1px solid ${C.border}`,
            background: C.layer1,
            minWidth: 0,
          },
        },
        h('span', { style: { fontSize: 11, color: C.text3 } }, props.label),
        h(
          'strong',
          {
            style: {
              fontSize: 19,
              fontWeight: 600,
              lineHeight: 1.2,
              color: props.tone || C.text,
              fontVariantNumeric: 'tabular-nums',
            },
          },
          props.value,
        ),
        props.hint ? h('span', { style: { fontSize: 10.5, color: C.text3 } }, props.hint) : null,
      );
    }

    function HourChart(props) {
      const hours = props.hours || [];
      const max = Math.max(0.0001, ...hours.map((entry) => entry.cost));
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'flex-end', gap: 3, height: 108, marginTop: 2 } },
        hours.map((entry) =>
          h(
            'div',
            {
              key: entry.hour,
              title: `${String(entry.hour).padStart(2, '0')}:00 · ${yuan(entry.cost)} · ${entry.calls} 次`,
              style: {
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                height: '100%',
                minWidth: 5,
                borderRadius: 4,
                outline: entry.hour === props.nowHour ? `1px solid ${C.border}` : 'none',
                outlineOffset: 1,
              },
            },
            h('div', {
              style: {
                height: `${Math.max(entry.cost > 0 ? 3 : 0, (entry.cost / max) * 100)}%`,
                background: entry.peak ? C.peak : C.valley,
                opacity: entry.cost > 0 ? 0.9 : 0,
                borderRadius: 3,
              },
            }),
          ),
        ),
      );
    }

    function DayChart(props) {
      const days = props.days || [];
      const max = Math.max(0.0001, ...days.map((entry) => entry.cost));
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'flex-end', gap: 8, height: 128, marginTop: 4 } },
        days.map((entry) =>
          h(
            'div',
            {
              key: entry.day,
              style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%' },
            },
            h(
              'span',
              { style: { fontSize: 9.5, color: C.text3, fontVariantNumeric: 'tabular-nums' } },
              entry.cost > 0 ? entry.cost.toFixed(1) : '',
            ),
            h(
              'div',
              {
                title: `${entry.day} · ${yuan(entry.cost)} · ${entry.calls} 次`,
                style: {
                  flex: 1,
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                  borderRadius: 4,
                  overflow: 'hidden',
                },
              },
              h('div', { style: { height: `${(entry.peakCost / max) * 100}%`, background: C.peak, opacity: 0.9 } }),
              h('div', { style: { height: `${(entry.valleyCost / max) * 100}%`, background: C.valley, opacity: 0.9 } }),
            ),
            h('span', { style: { fontSize: 9.5, color: C.text2 } }, entry.day.slice(5)),
          ),
        ),
      );
    }

    function CostSplit(props) {
      const total = Math.max(0.0001, props.cost || 0);
      const rows = [
        { key: 'cache', label: props.t('cost.cache'), value: props.costCache, fill: C.cache },
        { key: 'miss', label: props.t('cost.miss'), value: props.costMiss, fill: C.miss },
        { key: 'out', label: props.t('cost.out'), value: props.costOut, fill: C.out },
      ];
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 7 } },
        h(
          'div',
          { style: { display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: C.layer2 } },
          rows.map((row) =>
            h('div', {
              key: row.key,
              title: `${row.label} ${yuan(row.value)}`,
              style: { width: `${((row.value || 0) / total) * 100}%`, background: row.fill },
            }),
          ),
        ),
        rows.map((row) =>
          h(
            'div',
            { key: row.key, style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5 } },
            h('span', { style: { width: 7, height: 7, borderRadius: 2, background: row.fill, flex: 'none' } }),
            h('span', { style: { color: C.text2, flex: 1 } }, row.label),
            h('span', { style: { color: C.text, fontVariantNumeric: 'tabular-nums' } }, yuan(row.value)),
            h('span', { style: { color: C.text3, width: 42, textAlign: 'right' } }, percent((row.value || 0) / total)),
          ),
        ),
      );
    }

    function PriceTable(props) {
      const { pricing, peakNow, t } = props;
      const head = [t('price.model'), t('price.period'), t('price.hit'), t('price.miss'), t('price.out')];
      const rows = [];
      for (const model of pricing) {
        for (const offset of [0, 1]) {
          const isPeak = offset === 1;
          const current = isPeak === peakNow;
          rows.push(
            h(
              'tr',
              { key: `${model.id}-${offset}`, style: { background: current ? C.layer2 : 'transparent' } },
              h('td', { style: { padding: '4px 8px', color: C.text } }, offset === 0 ? model.label : ''),
              h(
                'td',
                { style: { padding: '4px 8px', color: C.text2 } },
                isPeak ? t('status.peak') : t('status.valley'),
                current ? ` · ${t('price.current')}` : '',
              ),
              h('td', { style: { padding: '4px 8px', textAlign: 'right', color: C.text } }, model.hit[offset]),
              h('td', { style: { padding: '4px 8px', textAlign: 'right', color: C.text } }, model.miss[offset]),
              h('td', { style: { padding: '4px 8px', textAlign: 'right', color: C.text } }, model.out[offset]),
            ),
          );
        }
      }
      return h(
        'table',
        { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11.5 } },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            head.map((label, index) =>
              h(
                'th',
                {
                  key: label,
                  style: {
                    padding: '3px 8px',
                    textAlign: index >= 2 ? 'right' : 'left',
                    fontWeight: 500,
                    color: C.text3,
                    borderBottom: `1px solid ${C.border}`,
                  },
                },
                label,
              ),
            ),
          ),
        ),
        h('tbody', null, rows),
      );
    }

    /* -------------------------------- settings ------------------------------- */

    function Dashboard(props) {
      const t = props.t;
      const feed = useFeed();
      const data = feed.data;
      const peakNow = data ? data.now.peak : false;
      const remain = data ? Math.max(0, data.now.nextAt - Date.now()) : 0;
      const switchText =
        data && remain > 30_000
          ? `${countdown(remain)} ${t(data.now.nextStatus === 'peak' ? 'widget.toPeak' : 'widget.toValley')}`
          : t('widget.soon');

      const body = [];

      if (feed.loading && !data) {
        body.push(h('div', { key: 'loading', style: { color: C.text2, fontSize: 13 } }, t('page.loading')));
      } else if (feed.error && !data) {
        body.push(
          h(
            Card,
            { key: 'error', style: { gap: 8 } },
            h(
              'span',
              { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12.5 } },
              `${t('page.error')}: ${feed.error}`,
            ),
            h(
              'button',
              {
                onClick: () => feed.reload(true),
                style: {
                  alignSelf: 'flex-start',
                  padding: '5px 13px',
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: C.layer2,
                  color: C.text,
                  cursor: 'pointer',
                  fontSize: 12,
                },
              },
              t('page.retry'),
            ),
          ),
        );
      } else if (data) {
        const today = data.today || {};

        body.push(
          h(
            'div',
            { key: 'pills', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h(
              Pill,
              { style: { background: peakNow ? `${C.peak}1a` : `${C.valley}1a`, borderColor: 'transparent' } },
              h(Dot, { tone: peakNow ? C.peak : C.valley, glow: true }),
              h(
                'span',
                { style: { color: peakNow ? C.peak : C.valley, fontWeight: 600 } },
                peakNow ? t('status.peak') : t('status.valley'),
              ),
              h(Sep),
              h('span', { style: { color: C.text } }, yuan(today.cost)),
              h(Sep),
              h('span', { style: { color: C.text3 } }, `${t('status.switchIn')} ${switchText}`),
            ),
            h(
              Pill,
              null,
              `${t('kpi.balance')} `,
              h(
                'span',
                { style: { color: C.text } },
                data.ledger && typeof data.ledger.balance === 'number' ? yuan(data.ledger.balance) : '—',
              ),
            ),
            h(Pill, null, `${today.calls || 0} 次 · ${tokens(today.tokens)} tokens`),
          ),
        );

        body.push(
          h(
            'div',
            { key: 'kpi', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 } },
            h(Kpi, {
              label: t('kpi.calls'),
              value: today.calls || 0,
              hint: `${t('kpi.perCall')} ${tokens(today.avgTokens)}`,
            }),
            h(Kpi, {
              label: t('kpi.tokens'),
              value: tokens(today.tokens),
              hint: `${t('kpi.cache')} ${tokens(today.cacheTokens)} · ${t('kpi.out')} ${tokens(today.outputTokens)}`,
            }),
            h(Kpi, { label: t('kpi.hit'), value: percent(today.hitRate), hint: '命中价 1/50' }),
            h(Kpi, {
              label: t('kpi.peakShare'),
              value: percent(today.peakShare, 0),
              tone: (today.peakShare || 0) > 0.5 ? C.peak : C.valley,
              hint: `${t('kpi.peakCost')} ${yuan(today.peakCost)} · ${t('kpi.valleyCost')} ${yuan(today.valleyCost)}`,
            }),
          ),
        );

        body.push(
          h(
            'div',
            { key: 'charts', style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 10 } },
            h(
              Card,
              null,
              h(CardTitle, { title: t('chart.hours'), hint: t('chart.hoursHint') }),
              h(HourChart, { hours: data.hours, nowHour: data.now.hour }),
              h(
                'div',
                { style: { display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: C.text3 } },
                ['00', '06', '12', '18', '23'].map((label) => h('span', { key: label }, label)),
              ),
            ),
            h(
              Card,
              null,
              h(CardTitle, { title: t('cost.title') }),
              h(CostSplit, {
                t,
                cost: today.cost || 0,
                costCache: today.costCache || 0,
                costMiss: today.costMiss || 0,
                costOut: today.costOut || 0,
              }),
            ),
          ),
        );

        body.push(
          h(
            Card,
            { key: 'days' },
            h(CardTitle, {
              title: t('chart.days'),
              hint: `${t('kpi.today')} ${yuan(today.cost)} · ${t('kpi.perCall')} ${yuan(data.week.avgPerCall)}`,
            }),
            h(DayChart, { days: data.days }),
            h('span', { style: { fontSize: 9.5, color: C.text3 } }, t('chart.daysHint')),
          ),
        );

        body.push(
          h(
            Card,
            { key: 'price' },
            h(CardTitle, { title: t('price.title'), hint: t('price.hint') }),
            h(PriceTable, { pricing: data.pricing, peakNow, t }),
          ),
        );
      }

      return h(
        'div',
        {
          style: {
            padding: '20px 24px 32px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            color: C.text,
            height: '100%',
            overflowY: 'auto',
            boxSizing: 'border-box',
          },
        },
        h(
          'header',
          { style: { display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' } },
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 1, flex: 1 } },
            h('h2', { style: { margin: 0, fontSize: 16, fontWeight: 600 } }, t('page.title')),
            h('span', { style: { fontSize: 11.5, color: C.text2 } }, t('page.subtitle')),
          ),
          h(
            'span',
            { style: { fontSize: 10.5, color: C.text3 } },
            data ? `${t('page.updated')} ${clock(data.generatedAt)}` : '',
          ),
          h(
            'button',
            {
              onClick: () => feed.reload(true),
              style: {
                padding: '4px 12px',
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: C.layer1,
                color: C.text,
                cursor: 'pointer',
                fontSize: 11.5,
              },
            },
            t('page.refresh'),
          ),
        ),
        body,
      );
    }

    /* --------------------------------- apply --------------------------------- */

    function makeT(ctx) {
      const { locale } = ctx;
      if (!locale || typeof locale.bind !== 'function') {
        return (key, fallback) => dicts.zh[key] || fallback || key;
      }
      const bound = locale.bind(NS);
      return (key, fallback) => {
        const value = bound(key);
        return value === key && fallback ? fallback : value;
      };
    }

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        ctx.effect(() => ctx.locale && ctx.locale.register(NS, dicts), 'dsh-usage-peak: dictionaries');
        const t = makeT(ctx);

        const openPanel = () => {
          try {
            ctx.layout && typeof ctx.layout.selectPanel === 'function' && ctx.layout.selectPanel('usage');
          } catch (err) {
            console.warn('[dsh-usage-peak] open panel failed', err);
          }
        };

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'usage', order: -10, label: () => '' },
            (props) => h(PanelGlyph, { ...props, t, rail: (props.size || 0) >= 18, onOpen: openPanel }),
          ),
        );

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'usage' }, () => h(Dashboard, { t })),
        );

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'dsh-usage-peak', order: 47, label: () => t('settings.title') },
            () => h(Dashboard, { t }),
          ),
        );
      },
    };
  },
});
