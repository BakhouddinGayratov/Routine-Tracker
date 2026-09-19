import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { state, invalidateRoutines, refreshSummary } from '../store.js';
import { toast, emptyState, skeletonList, progressRing, celebrate, confirmDialog } from '../ui.js';
import { openRoutineForm, repeatLabel } from './routine-form.js';
import {
  todayISO, addDays, formatDate, relativeDay, formatDuration, nowTime,
  timeBucket, weekdayOf, pct, weekdayName,
} from '../utils.js';

const BUCKET_ORDER = ['morning', 'afternoon', 'evening', 'night', 'anytime'];

/**
 * The day view: a timeline of everything scheduled, with the progress ring,
 * week strip and one-tap completion.
 */
export function renderToday(container, { date, navigate }) {
  const selected = date || todayISO();
  let data = null;
  let week = null;
  // Secondary data: tomorrow's routines (for "Up next" once today is clear),
  // goal names (day summary), this day's journal entry (the one-line note),
  // and, on an empty day only, whether the account has any routine at all
  // (first-run guide). None of it is essential — a failed request just
  // leaves that part out.
  let extras = { upcoming: [], goals: [], journal: null, routineCount: null };

  mount(container, el('div', { class: 'col', style: { gap: 'var(--s-6)' } },
    el('div', { class: 'skeleton skeleton--tile', style: { height: '160px' } }),
    skeletonList(5),
  ));

  const loadExtras = async () => {
    const isToday = selected === data.today;
    const [upcoming, goals, journal, routines] = await Promise.allSettled([
      isToday ? api.upcoming(2) : null,
      api.goals(true),
      api.journalEntry(selected),
      data.items.length ? null : api.routines(true),
    ]);
    extras = {
      upcoming: upcoming.value?.items || [],
      goals: goals.value?.goals || [],
      journal: journal.value?.entry || null,
      routineCount: routines.value ? routines.value.routines.length : null,
    };
  };

  const load = async () => {
    try {
      [data, week] = await Promise.all([api.day(selected), api.week(selected)]);
      await loadExtras();
      render();
    } catch (err) {
      mount(container, emptyState({
        art: '⚠️',
        title: t('error.loadFailed'),
        text: err.message,
        action: el('button', { class: 'btn btn--secondary', onclick: load }, t('action.retry')),
      }));
    }
  };

  /** Optimistic toggle: paint the new state immediately, reconcile after. */
  const setStatus = async (item, status, value) => {
    const previous = { status: item.status, value: item.value };
    item.status = status === 'pending' ? 'pending' : status;
    item.value = value ?? (status === 'done' ? (item.goal_type === 'quantity' ? item.target_value : 1) : 0);
    updateSummary();
    render();

    try {
      const result = await api.log({
        routine_id: item.id,
        date: selected,
        status,
        value: item.value,
      });
      item.status = result.status === 'pending' ? 'pending' : result.log?.status || result.status;
      item.value = result.log?.value ?? 0;

      if (item.status === 'done' && previous.status !== 'done') {
        const remaining = data.items.filter((i) => i.status === 'pending').length;
        if (remaining === 0 && data.items.length > 1) {
          celebrate();
          toast(t('today.perfect'), 'success');
        }
      }
      updateSummary();
      render();
      refreshSummary();   // keeps the sidebar's remaining-count honest
    } catch (err) {
      Object.assign(item, previous);
      updateSummary();
      render();
      toast(err.message || t('error.generic'), 'error');
    }
  };

  const updateSummary = () => {
    const done = data.items.filter((i) => i.status === 'done').length;
    const skipped = data.items.filter((i) => i.status === 'skipped').length;
    data.summary = {
      ...data.summary,
      total: data.items.length,
      done,
      skipped,
      pending: data.items.length - done - skipped,
      rate: data.items.length ? Math.round((done / data.items.length) * 100) : null,
      minutes_done: data.items.filter((i) => i.status === 'done')
        .reduce((sum, i) => sum + (i.duration_min || 0), 0),
    };
  };

  const render = () => {
    mount(container, el('div', { class: 'col', style: { gap: 'var(--s-6)' } },
      heroCard(),
      weekStrip(),
      timeline(),
    ));
  };

  // --- Hero ---------------------------------------------------------------

  const heroCard = () => {
    const { summary, streak } = data;
    const isToday = selected === data.today;
    const rate = summary.rate ?? 0;

    return el('section', { class: 'hero-card' },
      el('div', { class: 'hero-card__body' },
        el('div', { class: 'row row--wrap', style: { gap: 'var(--s-2) var(--s-3)' } },
          el('h1', { class: 'hero-card__greeting' }, isToday ? greeting() : relativeDay(selected, t, state.user.locale)),
          streak.current > 0
            ? el('span', { class: 'streak-pill' }, icon('flame', { size: 15 }), t('today.streak', { count: streak.current }))
            : null,
        ),
        el('div', { class: 'hero-card__date' }, formatDate(selected, { long: true, locale: state.user.locale })),

        summary.total > 0 && summary.pending === 0
          ? daySummary()
          : el('p', { class: 'hero-card__line' },
              summary.total === 0
                ? t('today.nothing')
                : [
                    el('b', null, t('today.progress', { done: summary.done, total: summary.total })),
                    ' · ',
                    t('today.remaining', { count: summary.pending }),
                  ],
            ),
        upNext(),
        summary.minutes_planned
          ? el('div', { class: 'subtle', style: { 'font-size': 'var(--text-sm)', 'margin-top': '4px' } },
              t('today.plannedTime', { time: formatDuration(summary.minutes_planned) }))
          : null,

        el('div', { class: 'hero-card__actions' },
          el('button', {
            // Hidden on phones, where the header's "+" is always in reach.
            class: 'btn btn--primary hero-card__add',
            onclick: () => openRoutineForm(null, {
              weekStart: state.user.week_start,
              date: selected,
              onSaved: () => { invalidateRoutines(); load(); },
            }),
          }, icon('plus', { size: 16 }), t('action.add')),

          summary.pending > 0
            ? el('button', {
                class: 'btn btn--secondary',
                onclick: async (event) => {
                  // `currentTarget` is null once the handler yields, so keep a
                  // reference before the first await.
                  const button = event.currentTarget;
                  const ok = await confirmDialog({
                    title: t('today.completeAll'),
                    message: t('today.progress', { done: summary.done, total: summary.total }),
                    confirmLabel: t('action.confirm'),
                  });
                  if (!ok) return;
                  button.setAttribute('aria-busy', 'true');
                  await api.completeAll(selected);
                  celebrate();
                  toast(t('toast.allComplete'));
                  await load();
                },
              }, icon('check', { size: 16 }), t('today.completeAll'))
            : null,

          el('button', {
            class: 'btn btn--ghost',
            onclick: async () => {
              const result = await api.copyFrom(selected, addDays(selected, -1));
              if (result.count) { toast(t('toast.copied', { count: result.count })); load(); }
              else toast(t('toast.nothingToCopy'), 'info');
            },
          }, icon('copy', { size: 16 }), t('today.copyYesterday')),
        ),
      ),

      // On a phone the big ring filled the first screen and pushed the list
      // below the fold; a small one beside the text leaves room for it.
      progressRing(rate, compact()
        ? { size: 72, stroke: 7, label: summary.total ? `${pct(rate)}%` : '—', color: rate >= 100 ? '#22c55e' : undefined }
        : {
            size: 132,
            stroke: 11,
            label: summary.total ? `${pct(rate)}%` : '—',
            sublabel: summary.total ? `${summary.done}/${summary.total}` : t('today.nothing'),
            color: rate >= 100 ? '#22c55e' : undefined,
          }),
    );
  };

  const compact = () => window.matchMedia('(max-width: 640px)').matches;

  // --- Up next (UI-04) -----------------------------------------------------

  /**
   * What to do next: a routine running right now, else the next one later
   * today, else tomorrow's first. Today's candidates come from the live day
   * items, so ticking one off moves the line on without a reload.
   */
  const nextUp = () => {
    if (selected !== data.today) return null;
    const now = toMinutes(nowTime());
    const pending = data.items
      .filter((i) => i.status === 'pending' && i.start_time)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

    const running = pending.find((i) => {
      const start = toMinutes(i.start_time);
      return start <= now && now < start + (i.duration_min || 0);
    });
    if (running) return { item: running, when: 'now' };

    const later = pending.find((i) => toMinutes(i.start_time) >= now);
    if (later) return { item: later, when: 'today', minutes: toMinutes(later.start_time) - now };

    const tomorrow = addDays(data.today, 1);
    const first = extras.upcoming
      .filter((u) => u.date === tomorrow && u.start_time)
      .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
    return first ? { item: first, when: 'tomorrow', date: tomorrow } : null;
  };

  const upNext = () => {
    const next = nextUp();
    if (!next) return null;
    const { item } = next;
    const when = next.when === 'now'
      ? t('today.nowRunning')
      : next.when === 'tomorrow'
        ? `${t('date.tomorrow')} ${item.start_time}`
        : `${item.start_time} · ${inTime(next.minutes)}`;

    return el('button', {
      class: 'up-next',
      type: 'button',
      onclick: () => {
        if (next.when === 'tomorrow') { navigate(`/day/${next.date}`); return; }
        const row = container.querySelector(`[data-routine="${item.id}"]`);
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row?.classList.add('is-flash');
        setTimeout(() => row?.classList.remove('is-flash'), 1200);
      },
    },
      el('span', { class: 'up-next__label' }, t('today.upNext')),
      el('span', { class: 'up-next__icon', 'aria-hidden': 'true' }, item.icon),
      el('span', { class: 'up-next__title truncate' }, item.title),
      el('span', { class: 'up-next__when' }, when),
    );
  };

  /** "in 45 min" / "in 1 h 20 min", in the user's language. */
  const inTime = (minutes) => {
    if (minutes < 60) return t('today.inMin', { count: Math.max(1, minutes) });
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? t('today.inHoursMin', { h, m }) : t('today.inHours', { h });
  };

  // --- Day summary (UI-13) -------------------------------------------------

  /**
   * Shown once nothing is left: what got done, how long it took, which goals
   * it served, and a one-line journal note while the day is fresh.
   */
  const daySummary = () => {
    const done = data.items.filter((i) => i.status === 'done');
    const skipped = data.items.length - done.length;
    const minutes = done.reduce((sum, i) => sum + (i.duration_min || 0), 0);

    const perGoal = new Map();
    for (const item of done) if (item.goal_id) perGoal.set(item.goal_id, (perGoal.get(item.goal_id) || 0) + 1);
    const goalChips = [...perGoal].flatMap(([id, count]) => {
      const goal = extras.goals.find((g) => g.id === id);
      return goal ? [el('span', { class: 'chip' }, `${goal.icon} ${goal.title} +${count}`)] : [];
    });

    return el('div', { class: 'day-summary' },
      el('div', { class: 'day-summary__title' }, icon('check', { size: 16, stroke: 3 }), t('today.summaryTitle')),
      el('p', { class: 'hero-card__line', style: { 'margin-top': 'var(--s-2)' } },
        el('b', null, t('today.progress', { done: done.length, total: data.items.length })),
        minutes ? ` · ${formatDuration(minutes)}` : '',
        skipped ? ` · ${t('today.summarySkipped', { count: skipped })}` : '',
      ),
      goalChips.length
        ? el('div', { class: 'row row--wrap', style: { gap: 'var(--s-2)', 'margin-top': 'var(--s-2)' } },
            el('span', { class: 'subtle', style: { 'font-size': 'var(--text-sm)' } }, t('today.summaryGoals')),
            ...goalChips)
        : null,
      journalNote(),
    );
  };

  /** The day's journal line: the saved text, or a field to write one. */
  const journalNote = () => {
    const saved = extras.journal?.body?.trim();
    if (saved) {
      return el('a', {
        class: 'day-summary__note', href: `/journal/${selected}`,
        onclick: (e) => { e.preventDefault(); navigate(`/journal/${selected}`); },
      }, icon('journal', { size: 15 }), el('span', { class: 'truncate' }, saved.split('\n')[0]));
    }

    const input = el('input', {
      class: 'input', id: 'f-day-note', type: 'text', maxlength: '280',
      placeholder: t('today.notePlaceholder'), 'aria-label': t('nav.journal'),
      onkeydown: (e) => { if (e.key === 'Enter') save.click(); },
    });
    const save = el('button', {
      class: 'btn btn--secondary', type: 'button',
      onclick: async (event) => {
        const button = event.currentTarget;
        const body = input.value.trim();
        if (!body) { input.focus(); return; }
        button.setAttribute('aria-busy', 'true');
        try {
          // The journal PUT replaces the whole entry, so the day's mood and
          // energy are sent back unchanged rather than wiped.
          const { entry } = await api.saveJournal(selected, {
            mood: extras.journal?.mood ?? null,
            energy: extras.journal?.energy ?? null,
            body,
          });
          extras.journal = entry;
          toast(t('today.noteSaved'));
          render();
        } catch (err) {
          button.removeAttribute('aria-busy');
          toast(err.message || t('error.generic'), 'error');
        }
      },
    }, t('action.save'));

    return el('div', { class: 'row', style: { gap: 'var(--s-2)', 'margin-top': 'var(--s-4)' } }, input, save);
  };

  // --- First run (UI-05) ---------------------------------------------------

  /** Three steps for an account with no routines yet, instead of a bare "add". */
  const firstRun = () => {
    const hasGoal = extras.goals.length > 0;
    const steps = [
      {
        done: hasGoal,
        title: t('onboard.goal'),
        text: t('onboard.goalText'),
        action: hasGoal ? null : el('button', { class: 'btn btn--secondary btn--sm', onclick: () => navigate('/goals') },
          icon('target', { size: 15 }), t('goals.new')),
      },
      {
        done: false,
        title: t('onboard.routine'),
        text: t('onboard.routineText'),
        action: el('div', { class: 'row row--wrap', style: { gap: 'var(--s-2)' } },
          el('button', {
            class: 'btn btn--primary btn--sm',
            onclick: () => openRoutineForm(null, {
              weekStart: state.user.week_start,
              date: selected,
              onSaved: () => { invalidateRoutines(); load(); },
            }),
          }, icon('plus', { size: 15 }), t('action.add')),
          el('button', { class: 'btn btn--secondary btn--sm', onclick: () => navigate('/routines') },
            icon('layers', { size: 15 }), t('routines.templates')),
        ),
      },
      { done: false, locked: true, title: t('onboard.check'), text: t('onboard.checkText') },
    ];

    return el('section', { class: 'card onboard' },
      el('h2', { class: 'onboard__title' }, t('onboard.title')),
      el('p', { class: 'muted' }, t('onboard.sub')),
      el('ol', { class: 'onboard__steps' },
        ...steps.map((step, i) => el('li', { class: ['onboard__step', step.done && 'is-done', step.locked && 'is-locked'] },
          el('span', { class: 'onboard__num', 'aria-hidden': 'true' },
            step.done ? icon('check', { size: 14, stroke: 3 }) : String(i + 1)),
          el('div', { class: 'onboard__body' },
            el('div', { class: 'onboard__step-title' }, step.title),
            el('p', { class: 'onboard__text' }, step.text),
            step.action || null,
          ),
        )),
      ),
    );
  };

  // --- Week strip ----------------------------------------------------------

  const weekStrip = () => {
    if (!week?.days?.length) return null;
    return el('section', null,
      el('div', { class: 'section__head' },
        el('div', { class: 'section__title' }, t('today.thisWeek')),
        el('div', { class: 'row', style: { gap: '4px' } },
          el('button', {
            class: 'btn btn--icon', 'aria-label': 'Previous week',
            onclick: () => navigate(`/day/${addDays(selected, -7)}`),
          }, icon('chevronLeft', { size: 17 })),
          el('button', {
            class: 'btn btn--icon', 'aria-label': 'Next week',
            onclick: () => navigate(`/day/${addDays(selected, 7)}`),
          }, icon('chevronRight', { size: 17 })),
        ),
      ),
      el('div', { class: 'weekstrip' },
        ...week.days.map((day) => el('button', {
          class: [
            'weekstrip__day',
            day.date === data.today && 'is-today',
            day.date === selected && 'is-selected',
          ],
          onclick: () => navigate(`/day/${day.date}`),
          'aria-label': formatDate(day.date, { locale: state.user.locale }),
        },
          el('span', { class: 'weekstrip__dow' }, weekdayName(weekdayOf(day.date), state.user.locale)),
          el('span', { class: 'weekstrip__num' }, Number(day.date.slice(8, 10))),
          el('span', { class: 'weekstrip__dots' },
            ...dotsFor(day).map((on) => el('i', { class: on ? 'is-on' : '' })),
          ),
        )),
      ),
    );
  };

  /** Up to four dots showing how much of that day was completed. */
  const dotsFor = (day) => {
    if (!day.due) return [];
    const filled = Math.round((day.rate / 100) * 4);
    return Array.from({ length: 4 }, (_, i) => i < filled);
  };

  // --- Timeline ------------------------------------------------------------

  const timeline = () => {
    if (!data.items.length && extras.routineCount === 0) return firstRun();
    if (!data.items.length) {
      return el('section', { class: 'card' }, emptyState({
        art: '🗓️',
        title: t('today.nothing'),
        text: t('today.nothingText'),
        action: el('div', { class: 'row' },
          el('button', {
            class: 'btn btn--primary',
            onclick: () => openRoutineForm(null, {
              weekStart: state.user.week_start,
              date: selected,
              onSaved: () => { invalidateRoutines(); load(); },
            }),
          }, icon('plus', { size: 16 }), t('action.add')),
          el('button', { class: 'btn btn--secondary', onclick: () => navigate('/routines') },
            icon('layers', { size: 16 }), t('routines.templates')),
        ),
      }));
    }

    const groups = new Map(BUCKET_ORDER.map((b) => [b, []]));
    for (const item of data.items) groups.get(timeBucket(item.start_time)).push(item);

    const now = nowTime();
    const showNowLine = selected === data.today;
    let nowPlaced = false;

    return el('section', { class: 'timeline' },
      ...BUCKET_ORDER.flatMap((bucket) => {
        const items = groups.get(bucket);
        if (!items.length) return [];

        const nodes = [el('div', { class: 'timeline__label' }, t(`part.${bucket}`))];
        for (const item of items) {
          if (showNowLine && !nowPlaced && item.start_time && item.start_time > now) {
            nodes.push(nowLine(now));
            nowPlaced = true;
          }
          nodes.push(routineRow(item));
        }
        return nodes;
      }),
    );
  };

  const nowLine = (time) => el('div', { class: 'now-line' },
    el('span', { class: 'now-line__dot' }),
    el('span', { class: 'now-line__text' }, `${t('today.now')} · ${time}`),
  );

  const routineRow = (item) => {
    const isDone = item.status === 'done';
    const isSkipped = item.status === 'skipped';
    const isPartial = item.status === 'partial';
    const overdue = selected === data.today && !isDone && !isSkipped
      && item.start_time && item.start_time < nowTime();

    return el('article', {
      class: ['routine', isDone && 'is-done', isSkipped && 'is-skipped', overdue && 'is-overdue'],
      style: { '--routine-color': item.color },
      dataset: { routine: String(item.id) },
    },
      el('button', {
        class: ['check', isDone && 'is-done', isSkipped && 'is-skipped'],
        type: 'button',
        'aria-pressed': String(isDone),
        'aria-label': `${isDone ? t('action.undo') : t('action.confirm')}: ${item.title}`,
        onclick: () => setStatus(item, isDone ? 'pending' : 'done'),
      }, icon(isSkipped ? 'skip' : 'check', { size: 15, stroke: 3.2 })),

      item.start_time ? el('div', { class: 'routine__time tnum' }, item.start_time) : null,
      el('div', { class: 'routine__icon' }, item.icon),

      el('div', { class: 'routine__body' },
        el('div', { class: 'routine__title' }, item.title),
        el('div', { class: 'routine__meta' },
          el('span', null, el('i', {
            class: 'chip__dot',
            style: { background: item.color, color: item.color },
          }), t(`cat.${item.category}`)),
          item.duration_min ? el('span', null, icon('clock', { size: 12 }), formatDuration(item.duration_min)) : null,
          item.priority === 'high' ? el('span', { class: 'badge badge--warning' }, t('priority.high')) : null,
          el('span', null, icon('repeat', { size: 12 }), repeatLabel(item)),
          isSkipped ? el('span', { class: 'badge badge--muted' }, t('action.skip')) : null,
        ),
      ),

      item.goal_type === 'quantity' ? quantityControl(item) : null,

      el('div', { class: 'routine__actions' },
        !isDone ? el('button', {
          class: 'btn btn--icon', 'data-tip': t('action.skip'),
          onclick: () => setStatus(item, isSkipped ? 'pending' : 'skipped'),
        }, icon('skip', { size: 15 })) : null,
        el('button', {
          class: 'btn btn--icon', 'data-tip': t('action.edit'),
          onclick: () => openRoutineForm(item, {
            weekStart: state.user.week_start,
            onSaved: () => { invalidateRoutines(); load(); },
          }),
        }, icon('edit', { size: 15 })),
      ),
    );
  };

  /** Stepper for measurable routines: +/- against the target. */
  const quantityControl = (item) => {
    const step = item.target_value > 20 ? Math.max(1, Math.round(item.target_value / 10)) : 1;
    const change = (delta) => {
      const next = Math.max(0, Math.min(item.target_value, (item.value || 0) + delta));
      setStatus(item, next === 0 ? 'pending' : next >= item.target_value ? 'done' : 'partial', next);
    };
    return el('div', { class: 'qty' },
      el('button', { class: 'qty__btn', type: 'button', 'aria-label': '-', onclick: () => change(-step) },
        icon('minus', { size: 13 })),
      el('span', { class: 'qty__value' }, `${trim(item.value)}/${trim(item.target_value)} ${item.unit}`),
      el('button', { class: 'qty__btn', type: 'button', 'aria-label': '+', onclick: () => change(step) },
        icon('plus', { size: 13 })),
    );
  };

  load();
}

function trim(n) {
  return Number.isInteger(Number(n)) ? String(Number(n)) : String(Math.round(Number(n) * 10) / 10);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return t('today.greeting.morning');
  if (hour < 17) return t('today.greeting.afternoon');
  if (hour < 22) return t('today.greeting.evening');
  return t('today.greeting.night');
}

/** Minutes since midnight for "HH:MM". */
function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}
