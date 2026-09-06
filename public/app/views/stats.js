import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { state } from '../store.js';
import { emptyState, skeletonList } from '../ui.js';
import { lineChart, barChart, barList, heatmap, heatmapLegend } from '../charts.js';
import { formatDuration, pct, WEEKDAYS_SHORT, CATEGORY_COLORS } from '../utils.js';

const RANGES = [7, 30, 90, 365];

/** The analytics page: trends, breakdowns, heatmap and a routine leaderboard. */
export function renderStats(container, { navigate }) {
  let days = 30;
  let overview = null;
  let heat = null;

  mount(container, el('div', { class: 'col' },
    el('div', { class: 'grid grid--4' },
      ...Array.from({ length: 4 }, () => el('div', { class: 'skeleton skeleton--tile' }))),
    skeletonList(2, 'tile'),
  ));

  const load = async () => {
    try {
      [overview, heat] = await Promise.all([api.overview(days), api.heatmap(364)]);
      render();
    } catch (err) {
      mount(container, emptyState({
        art: '⚠️', title: t('error.loadFailed'), text: err.message,
        action: el('button', { class: 'btn btn--secondary', onclick: load }, t('action.retry')),
      }));
    }
  };

  const render = () => {
    const { totals, streak, perfect_streak: perfectStreak } = overview;
    const hasData = totals.due > 0;

    mount(container,
      el('div', { class: 'page-head row row--between row--wrap' },
        el('div', null,
          el('h1', null, t('stats.title')),
          el('p', null, t('stats.sub', { days })),
        ),
        el('div', { class: 'segmented' },
          ...RANGES.map((range) => el('button', {
            type: 'button',
            class: ['segmented__item', range === days && 'is-active'],
            onclick: () => { days = range; load(); },
          }, range === 365 ? '1y' : `${range}d`)),
        ),
      ),

      el('div', { class: 'grid grid--4' },
        kpi({
          label: t('stats.completion'),
          value: totals.rate === null ? '—' : `${pct(totals.rate)}`,
          unit: totals.rate === null ? '' : '%',
          foot: totals.delta === null ? null : delta(totals.delta, days),
          accent: '#818cf8',
          emoji: '🎯',
        }),
        kpi({
          label: t('stats.currentStreak'),
          value: String(streak.current),
          unit: ` ${t('misc.days')}`,
          foot: `${t('stats.bestStreak')}: ${streak.longest}`,
          accent: '#f59e0b',
          emoji: '🔥',
        }),
        kpi({
          label: t('stats.perfectDays'),
          value: String(totals.perfect_days),
          unit: `/${totals.active_days}`,
          foot: perfectStreak.longest ? `${t('stats.bestStreak')}: ${perfectStreak.longest}` : null,
          accent: '#22c55e',
          emoji: '💯',
        }),
        kpi({
          label: t('stats.timeInvested'),
          value: formatDuration(totals.minutes),
          foot: `${totals.routines} ${t('stats.activeRoutines').toLowerCase()}`,
          accent: '#a855f7',
          emoji: '⏱️',
        }),
      ),

      hasData ? trendCard() : noData(),

      hasData ? el('div', { class: 'grid grid--split', style: { 'margin-top': 'var(--s-4)' } },
        weekdayCard(),
        categoryCard(),
      ) : null,

      heatmapCard(),

      hasData ? leaderboardCard() : null,
    );
  };

  const noData = () => el('div', { class: 'card', style: { 'margin-top': 'var(--s-4)' } },
    emptyState({
      art: '📊',
      title: t('stats.noData'),
      text: t('stats.noDataText'),
      action: el('button', { class: 'btn btn--primary', onclick: () => navigate('/today') }, t('nav.today')),
    }));

  const kpi = ({ label, value, unit, foot, accent, emoji }) => el('div', {
    class: 'kpi', style: { '--kpi-accent': accent },
  },
    el('div', { class: 'kpi__label' }, el('span', null, emoji), label),
    el('div', { class: 'kpi__value' }, value, unit ? el('small', null, unit) : null),
    foot ? el('div', { class: 'kpi__foot' }, foot) : null,
  );

  const delta = (value, range) => {
    const kind = value > 0.5 ? 'up' : value < -0.5 ? 'down' : 'flat';
    const sign = value > 0 ? '+' : '';
    return el('span', null,
      el('span', { class: `delta delta--${kind}` },
        kind === 'up' ? '▲' : kind === 'down' ? '▼' : '—',
        `${sign}${Math.round(value)}%`),
      ' ',
      el('span', { class: 'subtle', style: { 'font-size': 'var(--text-xs)' } }, t('stats.vsPrevious', { days: range })),
    );
  };

  const trendCard = () => el('section', { class: 'card', style: { 'margin-top': 'var(--s-4)' } },
    el('div', { class: 'card__head' },
      el('div', { class: 'card__title' }, t('stats.trend')),
      el('div', { class: 'card__hint' }, t('stats.days', { count: days })),
    ),
    lineChart(overview.series, { locale: state.user.locale })
      || el('p', { class: 'muted' }, t('stats.noDataText')),
  );

  const weekdayCard = () => {
    const weekStart = state.user.week_start === 0 ? 0 : 1;
    const order = weekStart === 0 ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
    const items = order.map((day) => {
      const bucket = overview.weekdays[day];
      return {
        label: WEEKDAYS_SHORT[day],
        value: bucket.rate ?? 0,
        color: bucket.rate >= 80 ? 'var(--success)' : bucket.rate >= 50 ? 'var(--accent)' : 'var(--warning)',
      };
    });

    const best = [...items].sort((a, b) => b.value - a.value)[0];
    return el('section', { class: 'card' },
      el('div', { class: 'card__head' },
        el('div', { class: 'card__title' }, t('stats.byWeekday')),
        best?.value ? el('div', { class: 'card__hint' }, `${best.label} · ${pct(best.value)}%`) : null,
      ),
      barChart(items),
    );
  };

  const categoryCard = () => {
    const items = overview.categories
      .filter((c) => c.due > 0)
      .map((c) => ({
        label: t(`cat.${c.category}`),
        value: c.rate,
        color: CATEGORY_COLORS[c.category] || '#64748b',
      }));

    return el('section', { class: 'card' },
      el('div', { class: 'card__head' },
        el('div', { class: 'card__title' }, t('stats.byCategory')),
      ),
      barList(items) || el('p', { class: 'muted' }, t('stats.noDataText')),
    );
  };

  const heatmapCard = () => el('section', { class: 'card', style: { 'margin-top': 'var(--s-4)' } },
    el('div', { class: 'card__head' },
      el('div', { class: 'card__title' }, t('stats.heatmap')),
      heatmapLegend(),
    ),
    heatmap(heat.days, {
      weekStart: state.user.week_start === 0 ? 0 : 1,
      locale: state.user.locale,
      onSelect: (date) => navigate(`/day/${date}`),
    }) || el('p', { class: 'muted' }, t('stats.noDataText')),
  );

  const leaderboardCard = () => el('section', { class: 'grid grid--2', style: { 'margin-top': 'var(--s-4)' } },
    routineListCard(t('stats.top'), overview.top, '🌟'),
    routineListCard(t('stats.struggling'), overview.struggling, '🎯'),
  );

  const routineListCard = (title, rows, emoji) => el('div', { class: 'card' },
    el('div', { class: 'card__head' },
      el('div', { class: 'card__title' }, emoji, ' ', title),
    ),
    rows.length
      ? el('div', { class: 'col', style: { gap: 'var(--s-3)' } },
          ...rows.map((row) => el('button', {
            class: 'row',
            style: { width: '100%', 'text-align': 'left', gap: 'var(--s-3)' },
            onclick: () => navigate(`/routine/${row.id}`),
          },
            el('span', { class: 'routine__icon', style: { '--routine-color': row.color, width: '32px', height: '32px', 'font-size': '15px' } }, row.icon),
            el('span', { class: 'grow truncate' },
              el('span', { style: { 'font-weight': '580', 'font-size': 'var(--text-sm)' } }, row.title),
              el('span', { class: 'bar bar--sm', style: { 'margin-top': '5px' } },
                el('span', {
                  class: 'bar__fill',
                  style: { width: `${row.rate ?? 0}%`, background: row.color, display: 'block', height: '100%' },
                })),
            ),
            el('span', { class: 'tnum', style: { 'font-weight': '640', 'font-size': 'var(--text-sm)' } },
              row.rate === null ? '—' : `${pct(row.rate)}%`),
            row.streak > 0
              ? el('span', { class: 'badge badge--warning' }, icon('flame', { size: 11 }), String(row.streak))
              : null,
          )),
        )
      : el('p', { class: 'muted' }, t('stats.noDataText')),
  );

  load();
}
