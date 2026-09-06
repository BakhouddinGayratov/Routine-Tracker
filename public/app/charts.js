import { el, mount } from './dom.js';
import { formatDate, weekdayOf, parseISO, pct } from './utils.js';

/**
 * Charts, drawn as plain SVG.
 *
 * No charting library: the shapes here are simple enough that hand-built SVG
 * is smaller, themeable through CSS variables, and free of layout surprises.
 */

/**
 * Render a chart at the container's real pixel width.
 *
 * Stretching a fixed viewBox with preserveAspectRatio="none" also stretches the
 * text, so instead the SVG is rebuilt 1:1 whenever the container resizes.
 */
function responsiveChart(build) {
  const host = el('div', { style: { width: '100%' } });
  let lastWidth = 0;

  const paint = (width) => {
    if (!width || Math.abs(width - lastWidth) < 8) return;
    lastWidth = width;
    mount(host, build(width) || el('div'));
  };

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver((entries) => paint(Math.round(entries[0].contentRect.width)));
    requestAnimationFrame(() => {
      observer.observe(host);
      paint(host.clientWidth || 720);
    });
  } else {
    requestAnimationFrame(() => paint(host.clientWidth || 720));
  }

  return host;
}

/** Area + line chart of daily completion rate. */
export function lineChart(series, { height = 210, locale = 'en' } = {}) {
  const points = series.filter((d) => d.rate !== null);
  if (points.length < 2) return null;

  return responsiveChart((W) => {
    const H = height;
    const padLeft = 38;
    const padRight = 10;
    const padTop = 14;
    const padBottom = 26;
    const innerW = Math.max(40, W - padLeft - padRight);
    const innerH = H - padTop - padBottom;

    const x = (i) => padLeft + (i / (points.length - 1)) * innerW;
    const y = (rate) => padTop + innerH - (rate / 100) * innerH;

    // A light Catmull-Rom → bezier smoothing keeps the trend readable without
    // inventing values between the real data points.
    const path = smoothPath(points.map((d, i) => [x(i), y(d.rate)]));
    const area = `${path} L ${x(points.length - 1)} ${padTop + innerH} L ${x(0)} ${padTop + innerH} Z`;
    const gradientId = `grad-${Math.random().toString(36).slice(2, 8)}`;

    // Roughly one label per 90px, so a wide chart is not crowded and a narrow
    // one does not overlap.
    const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 90))));

    return el('svg', {
      class: 'chart', width: W, height: H, viewBox: `0 0 ${W} ${H}`,
      role: 'img', 'aria-label': 'Daily completion rate',
    },
      el('defs', null,
        el('linearGradient', { id: gradientId, x1: '0', y1: '0', x2: '0', y2: '1' },
          el('stop', { offset: '0', 'stop-color': 'var(--accent)', 'stop-opacity': '0.8' }),
          el('stop', { offset: '1', 'stop-color': 'var(--accent)', 'stop-opacity': '0' }),
        ),
      ),
      el('g', { class: 'chart__grid' },
        ...[0, 25, 50, 75, 100].map((tick) =>
          el('line', { x1: padLeft, x2: W - padRight, y1: y(tick), y2: y(tick) })),
      ),
      el('g', { class: 'chart__axis' },
        ...[0, 50, 100].map((tick) =>
          el('text', { x: padLeft - 8, y: y(tick) + 3, 'text-anchor': 'end' }, `${tick}%`)),
      ),
      el('path', { class: 'chart__area', d: area, fill: `url(#${gradientId})` }),
      el('path', { class: 'chart__line', d: path, stroke: 'var(--accent)' }),
      el('g', null,
        ...points.map((d, i) => el('circle', {
          class: 'chart__dot',
          cx: x(i), cy: y(d.rate), r: points.length > 70 ? 0 : 2.6,
          fill: 'var(--surface)', stroke: 'var(--accent)', 'stroke-width': 2,
        }, el('title', null, `${formatDate(d.date, { locale })} — ${pct(d.rate)}%`))),
      ),
      el('g', { class: 'chart__axis' },
        ...points.map((d, i) => (i % labelEvery === 0
          ? el('text', {
              x: x(i), y: H - 7,
              'text-anchor': i === 0 ? 'start' : 'middle',
            }, formatDate(d.date, { locale }).replace(/^\w+,\s*/, ''))
          : null)).filter(Boolean),
      ),
    );
  });
}

function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/** Vertical bars, used for the weekday breakdown. */
export function barChart(items, { height = 200 } = {}) {
  if (!items.length) return null;

  return responsiveChart((W) => {
    const H = height;
    const padBottom = 26;
    const innerH = H - padBottom - 18;
    const max = Math.max(100, ...items.map((i) => i.value ?? 0));
    const slot = W / items.length;
    const barW = Math.min(44, slot * 0.5);

    return el('svg', {
      class: 'chart', width: W, height: H, viewBox: `0 0 ${W} ${H}`,
      role: 'img', 'aria-label': 'Completion by weekday',
    },
      ...items.map((item, i) => {
        const h = Math.max(2, ((item.value || 0) / max) * innerH);
        const x = slot * i + (slot - barW) / 2;
        const y = 18 + innerH - h;
        return el('g', null,
          el('rect', {
            class: 'chart__bar', x, y, width: barW, height: h, rx: 7,
            fill: item.color || 'var(--accent)',
            opacity: item.value ? 1 : 0.3,
          }, el('title', null, `${item.label}: ${pct(item.value)}%`)),
          el('text', {
            class: 'chart__axis', x: x + barW / 2, y: H - 9, 'text-anchor': 'middle',
          }, item.label),
          item.value ? el('text', {
            class: 'chart__axis', x: x + barW / 2, y: y - 6, 'text-anchor': 'middle',
            style: { 'font-weight': '640' },
          }, `${pct(item.value)}`) : null,
        );
      }),
    );
  });
}

/** Horizontal labelled bars, used for category breakdowns. */
export function barList(items) {
  if (!items.length) return null;
  return el('div', { class: 'bars' },
    ...items.map((item) => el('div', { class: 'bars__row' },
      el('div', { class: 'bars__name truncate' },
        el('i', { class: 'chip__dot', style: { background: item.color, color: item.color } }),
        item.label,
      ),
      el('div', { class: 'bar' },
        el('div', {
          class: 'bar__fill',
          style: { width: `${Math.max(2, item.value || 0)}%`, background: item.color },
        }),
      ),
      el('div', { class: 'bars__value' }, item.value === null ? '—' : `${pct(item.value)}%`),
    )),
  );
}

/**
 * GitHub-style heatmap: one column per week, one cell per day.
 * `weekStart` shifts the row order to match the user's calendar preference.
 */
export function heatmap(days, { weekStart = 1, locale = 'en', onSelect } = {}) {
  if (!days.length) return null;

  const columns = [];
  let column = new Array(7).fill(null);

  for (const day of days) {
    const row = (weekdayOf(day.date) - weekStart + 7) % 7;
    if (column[row] !== null) { columns.push(column); column = new Array(7).fill(null); }
    column[row] = day;
  }
  columns.push(column);

  // One label per month, placed above the column its first day falls in.
  const monthLabels = columns.map((col, index) => {
    const first = col.find(Boolean);
    if (!first) return '';
    const previous = columns[index - 1]?.find(Boolean);
    if (previous && previous.date.slice(0, 7) === first.date.slice(0, 7)) return '';
    try {
      return new Intl.DateTimeFormat(locale === 'uz' ? 'en-GB' : locale, { month: 'short', timeZone: 'UTC' })
        .format(parseISO(first.date));
    } catch {
      return first.date.slice(5, 7);
    }
  });

  const level = (day) => {
    if (!day) return null;
    if (day.due === 0) return -1;
    if (day.rate >= 100) return 4;
    if (day.rate >= 75) return 3;
    if (day.rate >= 45) return 2;
    if (day.rate > 0) return 1;
    return 0;
  };

  return el('div', { class: 'heatmap' },
    ...columns.map((col, index) => el('div', { class: 'heatmap__col' },
      el('span', { class: 'heatmap__month' }, monthLabels[index]),
      ...col.map((day) => {
        if (!day) return el('div', { class: 'heatmap__cell', style: { visibility: 'hidden' } });
        const title = day.due === 0
          ? `${formatDate(day.date, { locale })} — nothing scheduled`
          : `${formatDate(day.date, { locale })} — ${day.done}/${day.due} (${pct(day.rate)}%)`;
        return el('button', {
          class: 'heatmap__cell',
          type: 'button',
          dataset: { level: String(level(day)), date: day.date },
          title,
          'aria-label': title,
          onclick: onSelect ? () => onSelect(day.date) : null,
        });
      }),
    )),
  );
}

export function heatmapLegend(lessLabel = 'Less', moreLabel = 'More') {
  return el('div', { class: 'heatmap__legend' },
    el('span', null, lessLabel),
    ...[0, 1, 2, 3, 4].map((l) => el('span', { class: 'heatmap__cell', dataset: { level: String(l) } })),
    el('span', null, moreLabel),
  );
}

/** Month grid used by the calendar view. */
export function monthGrid(days, { weekStart = 1, today, locale = 'en', onSelect, dayLabels }) {
  if (!days.length) return null;

  const lead = (weekdayOf(days[0].date) - weekStart + 7) % 7;
  const cells = [
    ...Array.from({ length: lead }, () => null),
    ...days,
  ];

  return el('div', { class: 'calendar' },
    ...dayLabels.map((label) => el('div', { class: 'calendar__dow' }, label)),
    ...cells.map((day) => {
      if (!day) return el('div', { class: 'calendar__day is-empty' });
      const num = Number(day.date.slice(8, 10));
      const isToday = day.date === today;
      const isFuture = day.date > today;
      const rate = day.rate ?? 0;
      // A future day has nothing to report yet; showing "0/10" reads as failure.
      const showProgress = day.due > 0 && !isFuture;
      return el('button', {
        class: ['calendar__day', isToday && 'is-today', isFuture && 'is-future'],
        type: 'button',
        onclick: () => onSelect?.(day.date),
        'aria-label': `${formatDate(day.date, { locale })}${day.due ? `, ${day.done} of ${day.due}` : ''}`,
      },
        el('div', { class: 'calendar__num' }, num),
        day.mood ? el('div', { class: 'calendar__mood' }, ['😞', '😕', '😐', '🙂', '😄'][day.mood - 1]) : null,
        showProgress ? el('div', { class: 'calendar__ratio' }, `${Math.round(day.done)}/${day.due}`) : null,
        showProgress
          ? el('div', { class: 'calendar__meter' },
              el('i', {
                style: {
                  width: `${Math.min(100, rate)}%`,
                  background: rate >= 100 ? 'var(--success)' : rate >= 50 ? 'var(--accent)' : 'var(--warning)',
                },
              }))
          : null,
      );
    }),
  );
}

/** Sparkline for a single routine's recent history. */
export function sparkline(values, { width = 120, height = 30, color = 'var(--accent)' } = {}) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const step = width / (values.length - 1);
  const points = values.map((v, i) => `${i * step},${height - (v / max) * (height - 4) - 2}`).join(' ');
  return el('svg', { class: 'chart', width, height, viewBox: `0 0 ${width} ${height}` },
    el('polyline', {
      points, fill: 'none', stroke: color, 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }),
  );
}

export { parseISO };
