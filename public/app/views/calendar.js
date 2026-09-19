import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { state } from '../store.js';
import { emptyState } from '../ui.js';
import { monthGrid, dayTier } from '../charts.js';
import { todayISO, formatMonth, weekdayName, pct } from '../utils.js';

/** Month calendar with per-day completion, mood and quick navigation. */
export function renderCalendar(container, { navigate }) {
  const today = todayISO();
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));

  const gridSlot = el('div', { class: 'card' },
    el('div', { class: 'skeleton', style: { height: '360px' } }));
  const statsSlot = el('div');

  const load = async () => {
    try {
      const data = await api.month(year, month);
      renderGrid(data);
      renderStats(data);
    } catch (err) {
      mount(gridSlot, emptyState({ art: '⚠️', title: t('error.loadFailed'), text: err.message }));
    }
  };

  const header = () => el('div', { class: 'section__head calendar-nav' },
    el('div', { class: 'row' },
      el('button', {
        class: 'btn btn--icon', 'aria-label': 'Previous month',
        onclick: () => {
          month -= 1;
          if (month < 1) { month = 12; year -= 1; }
          renderShell();
          load();
        },
      }, icon('chevronLeft', { size: 17 })),
      el('div', { class: 'section__title calendar-nav__title' },
        formatMonth(year, month, state.user.locale)),
      el('button', {
        class: 'btn btn--icon', 'aria-label': 'Next month',
        onclick: () => {
          month += 1;
          if (month > 12) { month = 1; year += 1; }
          renderShell();
          load();
        },
      }, icon('chevronRight', { size: 17 })),
    ),
    el('button', {
      class: 'btn btn--secondary btn--sm',
      onclick: () => {
        year = Number(today.slice(0, 4));
        month = Number(today.slice(5, 7));
        renderShell();
        load();
      },
    }, t('date.today')),
  );

  const renderShell = () => {
    mount(container,
      el('div', { class: 'page-head' },
        el('h1', null, t('calendar.title')),
        el('p', null, t('calendar.sub')),
      ),
      header(),
      gridSlot,
      statsSlot,
    );
  };

  const dailyGoal = () => Number(state.user.daily_goal) || 80;

  /** What the bar colours mean, with the user's own goal in the numbers. */
  const legend = () => {
    const goal = dailyGoal();
    const half = Math.round(goal / 2);
    const item = (tier, text) => el('span', { class: 'calendar-legend__item' },
      el('i', { class: `calendar-legend__swatch is-${tier}`, 'aria-hidden': 'true' }), text);
    return el('div', { class: 'calendar-legend' },
      item(dayTier(goal, goal), t('calendar.tierMet', { goal })),
      item(dayTier(half, goal), t('calendar.tierPart', { half, goal })),
      item(dayTier(0, goal), t('calendar.tierLow', { half })),
      el('span', { class: 'calendar-legend__item' }, '🙂', t('calendar.moodHint')),
    );
  };

  const renderGrid = (data) => {
    const weekStart = state.user.week_start === 0 ? 0 : 1;
    const labels = (weekStart === 0 ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0])
      .map((d) => weekdayName(d, state.user.locale));

    mount(gridSlot,
      monthGrid(data.days, {
        weekStart,
        today: data.today,
        locale: state.user.locale,
        dayLabels: labels,
        goal: dailyGoal(),
        onSelect: (date) => navigate(`/day/${date}`),
      }),
      legend(),
    );
  };

  const renderStats = (data) => {
    const tracked = data.days.filter((d) => d.due > 0 && d.date <= data.today);
    if (!tracked.length) { mount(statsSlot); return; }

    const due = tracked.reduce((s, d) => s + d.due, 0);
    const done = tracked.reduce((s, d) => s + d.done, 0);
    const perfect = tracked.filter((d) => d.rate === 100).length;
    const moods = tracked.filter((d) => d.mood);
    const avgMood = moods.length
      ? Math.round((moods.reduce((s, d) => s + d.mood, 0) / moods.length) * 10) / 10
      : null;

    mount(statsSlot, el('div', { class: 'grid grid--4', style: { 'margin-top': 'var(--s-6)' } },
      tile(t('stats.completion'), `${pct((done / due) * 100)}%`, `${Math.round(done)} / ${due}`, '#818cf8'),
      tile(t('stats.perfectDays'), String(perfect), `${t('misc.of')} ${tracked.length}`, '#22c55e'),
      tile(t('stats.activeRoutines'), String(Math.max(...tracked.map((d) => d.due))), t('stats.days', { count: tracked.length }), '#f59e0b'),
      tile(t('journal.mood'), avgMood === null ? '—' : `${avgMood}/5`, `${moods.length} ${t('journal.past').toLowerCase()}`, '#a855f7'),
    ));
  };

  const tile = (label, value, foot, accent) => el('div', {
    class: 'kpi', style: { '--kpi-accent': accent },
  },
    el('div', { class: 'kpi__label' }, label),
    el('div', { class: 'kpi__value' }, value),
    el('div', { class: 'kpi__foot' }, foot),
  );

  renderShell();
  load();
}
