import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { state, invalidateRoutines, refreshSummary } from '../store.js';
import { toast, emptyState, skeletonList, celebrate, confirmDialog, choiceDialog, countUp } from '../ui.js';
import { dayDial } from '../dial.js';
import { slicePieces, layoutColumn } from '../schedule-layout.js';
import { openRoutineForm, repeatLabel } from './routine-form.js';
import {
  todayISO, addDays, formatDate, relativeDay, formatDuration, nowTime,
  timeBucket, weekdayOf, pct, weekdayName,
} from '../utils.js';

const BUCKET_ORDER = ['morning', 'afternoon', 'evening', 'night', 'anytime'];
const VIEW_KEY = 'rt.dayView';

/** The person's last choice between the hour grid and the list. */
function readView() {
  try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
}

/**
 * The day view: the day drawn as a dial, what is happening right now, the
 * week, and the routines themselves — either as an hour grid (each block as
 * tall as it lasts) or as a list grouped by part of the day.
 */
export function renderToday(container, { date, navigate }) {
  const selected = date || todayISO();
  let data = null;
  let week = null;
  let view = readView();
  // Draw the dial's arcs in only on the first paint, not on every tick.
  let intro = true;
  // The routine whose status just changed: only it plays its animation.
  let freshId = null;
  // The hour grid's minutes → pixels scale (it folds empty hours), kept so
  // the minute tick can move the "now" line without redrawing the grid.
  let gridY = () => 0;
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
    freshId = item.id;
    item.status = status === 'pending' ? 'pending' : status;
    item.value = value ?? (status === 'done' ? (item.goal_type === 'quantity' ? item.target_value : 1) : 0);
    updateSummary();
    render();
    const optimistic = { status: item.status, value: item.value };

    try {
      const result = await api.log({
        routine_id: item.id,
        date: selected,
        status,
        value: item.value,
      });
      item.status = result.status === 'pending' ? 'pending' : result.log?.status || result.status;
      item.value = result.log?.value ?? 0;
      // The usual case: the server agreed with what is already on screen.
      // Redrawing the list then would restart the tick's animation mid-way,
      // so only the hero (its dial and counts) is refreshed.
      const agreed = item.status === optimistic.status && Number(item.value) === Number(optimistic.value);

      if (item.status === 'done' && previous.status !== 'done') {
        const remaining = data.items.filter((i) => i.status === 'pending').length;
        if (remaining === 0 && data.items.length > 1) {
          const done = data.items.filter((i) => i.status === 'done').length;
          celebrate({ big: t('celebrate.dayClosed'), small: `${done}/${data.items.length}` });
          toast(t('today.perfect'), 'success');
        }
      }
      updateSummary();
      if (agreed) container.querySelector('.hero-card')?.replaceWith(heroCard());
      else render();
      refreshSummary();   // keeps the sidebar's remaining-count honest
    } catch (err) {
      Object.assign(item, previous);
      updateSummary();
      render();
      toast(err.message || t('error.generic'), 'error');
    }
  };

  /**
   * Move one occurrence to the next day. A repeating routine keeps its rule,
   * so it is asked about first — the day being left gets marked skipped, and
   * that is not something to do behind the user's back.
   */
  const postpone = async (item) => {
    if (item.repeat_type !== 'once') {
      const ok = await confirmDialog({
        title: t('routines.postponeConfirm', { title: item.title }),
        message: t('routines.postponeRepeat'),
        confirmLabel: t('action.postpone'),
      });
      if (!ok) return;
    }

    try {
      const result = await api.postponeRoutine(item.id, selected);
      toast(t('toast.postponed', { date: formatDate(result.date, { locale: state.user.locale }) }));
      invalidateRoutines();
      await load();
      refreshSummary();
    } catch (err) {
      toast(err.message || t('error.generic'), 'error');
    }
  };

  /**
   * Delete from the day view. A repeating routine offers two different
   * things: take just this day out of the schedule (neither done nor missed),
   * or delete the routine with its whole history. A one-off has only this
   * day, so the plain confirmation is enough.
   */
  const removeRoutine = async (item) => {
    let choice;
    if (item.repeat_type === 'once') {
      const ok = await confirmDialog({
        title: t('routines.deleteConfirm', { title: item.title }),
        message: t('routines.deleteWarn'),
        confirmLabel: t('action.delete'),
        danger: true,
      });
      choice = ok ? 'all' : null;
    } else {
      choice = await choiceDialog({
        title: t('routines.deleteConfirm', { title: item.title }),
        choices: [
          { value: 'day', label: t('delete.onlyDay'), hint: t('delete.onlyDayHint', { date: formatDate(selected, { locale: state.user.locale }) }) },
          { value: 'all', label: t('delete.everything'), hint: t('routines.deleteWarn'), danger: true },
        ],
      });
    }
    if (!choice) return;

    try {
      if (choice === 'day') {
        await api.removeRoutineDay(item.id, selected);
        toast(t('toast.dayRemoved'));
      } else {
        await api.deleteRoutine(item.id);
        toast(t('toast.routineDeleted'));
      }
      invalidateRoutines();
      await load();
      refreshSummary();
    } catch (err) {
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
    intro = false;
    // The fresh mark lasts one paint; later re-renders must not replay it.
    if (freshId !== null) { const id = freshId; setTimeout(() => { if (freshId === id) freshId = null; }, 900); }
  };

  // While today is on screen, the hand, the "now" line and the live strip
  // move with the clock. Only the hero and the grid's now-line are redrawn,
  // and only while nothing is being typed into.
  const tick = setInterval(() => {
    if (!container.isConnected) { clearInterval(tick); return; }
    if (!data || selected !== data.today || document.querySelector('.modal')) return;
    if (container.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
    container.querySelector('.hero-card')?.replaceWith(heroCard());
    const now = container.querySelector('.hours__now');
    if (now) now.replaceWith(hoursNow());
  }, 30_000);

  // --- Hero ---------------------------------------------------------------

  const heroCard = () => {
    const { summary, streak } = data;
    const isToday = selected === data.today;
    const rate = summary.rate ?? 0;
    const small = compact();

    // The day's percentage in the dial's centre, counted up on first paint.
    const value = el('span');
    if (summary.total && intro) countUp(value, pct(rate));
    else value.textContent = summary.total ? String(pct(rate)) : '—';
    const center = el('div', null,
      el('div', { class: 'dial-wrap__value' }, value, summary.total ? el('small', null, '%') : null),
      el('div', { class: 'dial-wrap__sub' }, summary.total ? `${summary.done}/${summary.total}` : t('today.nothing')),
    );
    const dial = dayDial(data.items, { size: small ? 100 : 208, now: isToday ? nowTime() : null, center, intro, labels: !small });
    if (small) dial.classList.add('dial-wrap--sm');

    return el('section', { class: 'hero-card' },
      el('div', { class: 'hero-card__body' },
        el('p', { class: 'hero-card__greeting' }, isToday ? greeting() : relativeDay(selected, t, state.user.locale)),
        // A non-breaking hyphen: "9-oktabr" must never split as "9-" / "oktabr".
        el('h1', { class: 'hero-card__date' },
          formatDate(selected, { long: true, locale: state.user.locale }).replace(/(\d)-/g, '$1‑')),
        streak.current > 0
          ? el('div', { class: 'hero-card__meta' },
              el('span', { class: 'streak-pill' }, icon('flame', { size: 13 }), t('today.streak', { count: streak.current })))
          : null,

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
                  celebrate({ big: t('celebrate.dayClosed'), small: `${summary.total}/${summary.total}` });
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

      // The day as a dial. On a phone a small one sits beside the text, so the
      // routines still start on the first screen.
      dial,
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

  /**
   * The live strip. While something is running it says so, shows how much of
   * the block has passed and counts the minutes left; otherwise it names the
   * next routine and how soon it starts. The minute tick redraws it.
   */
  const upNext = () => {
    const next = nextUp();
    if (!next) return null;
    const { item } = next;
    const running = next.when === 'now';

    let when;
    let progress = null;
    if (running) {
      const now = toMinutes(nowTime());
      const start = toMinutes(item.start_time);
      const length = item.duration_min || 1;
      progress = Math.min(100, Math.max(0, ((now - start) / length) * 100));
      when = t('today.minutesLeft', { count: Math.max(1, start + length - now) });
    } else if (next.when === 'tomorrow') {
      when = `${t('date.tomorrow')} ${item.start_time}`;
    } else {
      when = `${item.start_time} · ${inTime(next.minutes)}`;
    }

    return el('button', {
      class: ['up-next live', running && 'is-running'],
      type: 'button',
      onclick: () => {
        if (next.when === 'tomorrow') { navigate(`/day/${next.date}`); return; }
        const row = container.querySelector(`[data-routine="${item.id}"]`);
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row?.classList.add('is-flash');
        setTimeout(() => row?.classList.remove('is-flash'), 1200);
      },
    },
      el('span', { class: 'live__label' }, running ? t('today.now') : t('today.upNext')),
      el('span', { class: 'live__title' }, `${item.icon} ${item.title}`),
      el('span', { class: 'live__when' }, when),
      running ? el('span', { class: 'live__bar' }, el('i', { style: { width: `${progress}%` } })) : null,
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
        skipped ? ' · ' : '',
        skipped ? el('span', { class: 'text-danger' }, `✗ ${t('today.summarySkipped', { count: skipped })}`) : null,
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
          dayBar(day),
        )),
      ),
    );
  };

  /**
   * The day's split as one bar: done, then ✗, then what is still open, each
   * at its real share. Four dots rounded "7 of 9" and "8 of 9" to the same
   * picture and could not show a failure at all.
   */
  const dayBar = (day) => {
    if (!day.due) return el('span', { class: 'weekstrip__bar', style: { opacity: '0.35' } });
    const share = (n) => `${Math.max(0, Math.min(100, (n / day.due) * 100))}%`;
    return el('span', { class: 'weekstrip__bar', title: `${day.done}/${day.due}` },
      el('i', { class: 'is-done', style: { width: share(day.done) } }),
      day.skipped ? el('i', { class: 'is-missed', style: { width: share(day.skipped) } }) : null,
    );
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

    const hasTimed = data.items.some((i) => i.start_time);
    const showGrid = view === 'grid' && hasTimed;

    return el('section', null,
      el('div', { class: 'day-head' },
        el('h2', { class: 'section__title' }, t('today.plan')),
        hasTimed ? viewSwitch() : null,
      ),
      showGrid ? hourGrid() : listView(),
    );
  };

  /** Grid ↔ list, remembered on this device. */
  const viewSwitch = () => el('div', { class: 'segmented', role: 'group', 'aria-label': t('today.plan') },
    ...[['grid', 'calendar', t('today.viewGrid')], ['list', 'list', t('today.viewList')]].map(([key, glyph, label]) =>
      el('button', {
        type: 'button',
        class: ['segmented__item', view === key && 'is-active'],
        'aria-pressed': String(view === key),
        onclick: () => {
          if (view === key) return;
          view = key;
          try { localStorage.setItem(VIEW_KEY, key); } catch { /* per-device nicety only */ }
          render();
        },
      }, icon(glyph, { size: 14 }), label)),
  );

  const listView = () => {
    const groups = new Map(BUCKET_ORDER.map((b) => [b, []]));
    for (const item of data.items) groups.get(timeBucket(item.start_time)).push(item);

    const now = nowTime();
    const showNowLine = selected === data.today;
    let nowPlaced = false;

    return el('div', { class: 'timeline' },
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

  // --- Hour grid -------------------------------------------------------------

  /**
   * The day as one column (schedule-layout.js): every moment shows exactly
   * one routine, never two side by side. Where routines overlap, the one that
   * ends first is shown and the longer one resumes after it — a short routine
   * inside a long one splits it in two. The rail on the left marks the exact
   * minute each block starts and ends (04:15, 04:30 …), with whole hours only
   * in the empty stretches between. Short blocks are drawn tall enough to read
   * and very long ones are capped, so the scale stretches, but every label
   * sits where its minute falls on that scale. Routines without a time sit in
   * a short list above.
   */
  const hourGrid = () => {
    const timed = data.items.filter((i) => i.start_time);
    const anytime = data.items.filter((i) => !i.start_time);
    const byId = new Map(timed.map((item) => [item.id, item]));
    const pieces = slicePieces(timed.map((item) => {
      const start = toMinutes(item.start_time);
      return { id: item.id, start, end: Math.min(1440, start + Math.max(item.duration_min || 0, 0)) };
    }));

    const isToday = selected === data.today;
    const nowMin = toMinutes(nowTime());
    let first = Math.min(...pieces.map((p) => p.start));
    let last = Math.max(...pieces.map((p) => p.end));
    if (isToday) { first = Math.min(first, nowMin); last = Math.max(last, nowMin); }
    // The column starts with the first routine and ends with the last (or now):
    // their times are on the rail, so no empty lead-in is needed.
    const from = Math.max(0, first);
    const to = Math.min(1440, last);

    const MIN_PX = 46;     // room for a name and a time range, and a thumb
    const MAX_PX = 240;    // a six-hour school day need not fill three screens
    const { segments, y, height } = layoutColumn(pieces, {
      from, to, ppm: compact() ? 1.3 : 1.4, minPx: MIN_PX, foldMin: 120, foldPx: 32,
    });
    // A long piece is capped after the layout: everything below moves up.
    // PAD keeps the first and last rail labels clear of the grid's edges.
    const PAD = 14;
    let lift = 0;
    for (const s of segments) {
      s.top = s.top - lift + PAD;
      if (s.piece && s.height > MAX_PX) { lift += s.height - MAX_PX; s.height = MAX_PX; }
    }
    const total = height - lift + PAD * 2;
    const yAt = (minute) => {
      const s = segments.find((seg) => minute < seg.b) || segments[segments.length - 1];
      if (!s) return 0;
      if (minute <= s.a) return s.top;
      return s.top + Math.min(1, (minute - s.a) / Math.max(1, s.b - s.a)) * s.height;
    };
    gridY = yAt;

    // The rail: each block's start, its end where nothing follows at once,
    // whole hours in the open stretches — never two labels on top of each other.
    const marks = [];
    segments.forEach((s, index) => {
      if (s.piece) {
        marks.push({ top: s.top, text: clock(s.piece.start), kind: 'edge' });
        const next = segments[index + 1];
        if (!next || !next.piece || next.piece.start !== s.piece.end) {
          marks.push({ top: s.top + s.height, text: clock(s.piece.end), kind: 'edge' });
        }
      } else if (!s.folded) {
        for (let h = Math.ceil((s.a + 1) / 60) * 60; h < s.b; h += 60) {
          marks.push({ top: s.top + ((h - s.a) / (s.b - s.a)) * s.height, text: clock(h), kind: 'hour' });
        }
      }
    });
    marks.sort((a, b) => a.top - b.top || (a.kind === 'edge' ? -1 : 1));
    // A block's own times win over a round hour that would crowd them.
    const rail = [];
    for (const mark of marks) {
      const previous = rail[rail.length - 1];
      if (!previous || mark.top - previous.top >= 15) rail.push(mark);
      else if (mark.kind === 'edge' && previous.kind === 'hour') rail[rail.length - 1] = mark;
    }

    const rows = [
      ...segments.filter((s) => s.folded).map((s) => el('div', {
        class: 'hours__row hours__row--fold', style: { top: `${s.top}px`, height: `${s.height}px` },
      }, el('span', { class: 'hours__fold' }, `${clock(s.a)}–${clock(s.b)} · ${t('today.free')}`))),
      ...rail.map((mark) => el('div', { class: ['hours__mark', `is-${mark.kind}`], style: { top: `${mark.top}px` } },
        el('span', { class: 'hours__label' }, mark.text))),
    ];

    const blocks = segments.filter((s) => s.piece).map((s) => hourBlock(byId.get(s.piece.id), s.piece, {
      top: `${s.top + 2}px`,
      height: `${s.height - 4}px`,
    }, s.height < 60));

    return el('div', null,
      anytime.length
        ? el('div', { class: 'anytime' },
            el('div', { class: 'anytime__label' }, t('part.anytime')),
            ...anytime.map(routineRow))
        : null,
      el('div', { class: 'hours', style: { height: `${total}px` } },
        ...rows,
        el('div', { class: 'hours__lane' }, ...blocks),
        isToday && nowMin >= from && nowMin <= to ? hoursNow() : null,
      ),
    );
  };

  /** The red "now" line across the grid, placed through the grid's own scale. */
  const hoursNow = () => {
    const now = nowTime();
    return el('div', { class: 'hours__now', style: { top: `${gridY(toMinutes(now))}px` } }, el('span', null, now));
  };

  /**
   * One piece of a routine in the grid. It always states the routine's real
   * start and end; a routine split around a shorter one says which part this
   * is, and a later part reads "continued". Its check works in place; the
   * rest opens a menu.
   */
  const hourBlock = (item, piece, position, short) => {
    const isDone = item.status === 'done';
    const isSkipped = item.status === 'skipped';
    const end = item.duration_min ? clock(toMinutes(item.start_time) + item.duration_min) : null;
    const range = end ? `${item.start_time}–${end}` : item.start_time;
    const continued = piece.parts > 1 && piece.part > 1;

    return el('div', {
      class: ['tl-block', isDone && 'is-done', isSkipped && 'is-skipped', short && 'is-short',
        continued && 'is-continued', piece.marker && 'is-marker', item.id === freshId && 'is-fresh'],
      style: { ...position, '--routine-color': item.color },
      dataset: { routine: String(item.id) },
      role: 'button',
      tabindex: '0',
      'aria-label': `${item.title}, ${range}${piece.parts > 1 ? ` (${piece.part}/${piece.parts})` : ''}`,
      onclick: () => blockMenu(item),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); blockMenu(item); } },
    },
      el('button', {
        class: ['check', isDone && 'is-done', isSkipped && 'is-skipped'],
        type: 'button',
        'aria-pressed': String(isDone),
        'aria-label': `${isDone ? t('action.undo') : t('action.confirm')}: ${item.title}`,
        onclick: (e) => { e.stopPropagation(); setStatus(item, isDone ? 'pending' : 'done'); },
      }, icon(isSkipped ? 'x' : 'check', { size: 12, stroke: 3.2 })),
      el('div', { class: 'tl-block__body' },
        el('div', { class: 'tl-block__title' },
          el('span', { class: 'tl-block__name' }, `${item.icon} ${item.title}`),
          piece.parts > 1 ? el('span', { class: 'tl-block__part num' }, `${piece.part}/${piece.parts}`) : null,
        ),
        el('div', { class: 'tl-block__time' },
          continued ? `${t('today.continued')} · ` : '',
          el('span', { class: 'num' }, range),
        ),
      ),
    );
  };

  /** Everything else a block can do, as one menu — a block is too small for a toolbar. */
  const blockMenu = async (item) => {
    const isDone = item.status === 'done';
    const isSkipped = item.status === 'skipped';
    const choices = [
      { value: 'done', label: isDone ? t('action.undo') : `✓ ${t('action.markDone')}` },
      isDone ? null : { value: 'missed', label: isSkipped ? t('action.undoMissed') : `✗ ${t('action.markMissed')}`, danger: !isSkipped },
      isDone ? null : { value: 'postpone', label: t('action.postpone') },
      { value: 'edit', label: t('action.edit'), hint: t('form.editDayOnlyShort') },
      { value: 'delete', label: t('action.delete'), danger: true },
    ].filter(Boolean);

    const choice = await choiceDialog({
      title: `${item.icon} ${item.title}`,
      message: item.duration_min
        ? `${item.start_time}–${clock(toMinutes(item.start_time) + item.duration_min)} · ${repeatLabel(item)}`
        : `${item.start_time} · ${repeatLabel(item)}`,
      choices,
    });
    if (choice === 'done') setStatus(item, isDone ? 'pending' : 'done');
    else if (choice === 'missed') setStatus(item, isSkipped ? 'pending' : 'skipped');
    else if (choice === 'postpone') postpone(item);
    else if (choice === 'edit') {
      openRoutineForm(item, {
        weekStart: state.user.week_start,
        day: selected,
        onSaved: () => { invalidateRoutines(); load(); },
      });
    } else if (choice === 'delete') removeRoutine(item);
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
      class: ['routine', isDone && 'is-done', isSkipped && 'is-skipped', overdue && 'is-overdue', item.id === freshId && 'is-fresh'],
      style: { '--routine-color': item.color },
      dataset: { routine: String(item.id) },
    },
      el('button', {
        class: ['check', isDone && 'is-done', isSkipped && 'is-skipped'],
        type: 'button',
        'aria-pressed': String(isDone),
        'aria-label': `${isDone ? t('action.undo') : t('action.confirm')}: ${item.title}`,
        onclick: () => setStatus(item, isDone ? 'pending' : 'done'),
      }, icon(isSkipped ? 'x' : 'check', { size: 15, stroke: 3.2 })),

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
          isSkipped ? el('span', { class: 'badge badge--danger' }, `✗ ${t('status.missed')}`) : null,
        ),
      ),

      item.goal_type === 'quantity' ? quantityControl(item) : null,

      el('div', { class: 'routine__actions' },
        // ✗ "not done": a deliberate failure mark that counts against the
        // statistics (stored as status 'skipped'). Tapping again undoes it.
        !isDone ? el('button', {
          class: ['btn btn--icon btn--danger-ghost', isSkipped && 'is-active'],
          'data-tip': isSkipped ? t('action.undoMissed') : t('action.markMissed'),
          'aria-pressed': String(isSkipped),
          onclick: () => setStatus(item, isSkipped ? 'pending' : 'skipped'),
        }, icon('x', { size: 16, stroke: 2.6 })) : null,
        !isDone ? el('button', {
          class: 'btn btn--icon', 'data-tip': t('action.postpone'),
          onclick: () => postpone(item),
        }, icon('tomorrow', { size: 15 })) : null,
        el('button', {
          class: 'btn btn--icon', 'data-tip': t('action.edit'),
          onclick: () => openRoutineForm(item, {
            weekStart: state.user.week_start,
            day: selected,   // an edit from the day view changes only this day
            onSaved: () => { invalidateRoutines(); load(); },
          }),
        }, icon('edit', { size: 15 })),
        el('button', {
          class: 'btn btn--icon btn--danger-ghost', 'data-tip': t('action.delete'),
          onclick: () => removeRoutine(item),
        }, icon('trash', { size: 15 })),
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

/** "HH:MM" for minutes since midnight, wrapping past midnight. */
function clock(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
