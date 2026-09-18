import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { state, invalidateRoutines } from '../store.js';
import { emptyState, skeletonList, progressRing, toast, confirmDialog } from '../ui.js';
import { openRoutineForm, repeatLabel } from './routine-form.js';
import { formatDate, formatDuration, pct } from '../utils.js';

/** A single routine: its settings, performance and recent history. */
export function renderRoutineDetail(container, { id, navigate }) {
  mount(container, el('div', { class: 'col' }, skeletonList(4)));

  const load = async () => {
    try {
      const { routine, stats, history } = await api.routine(id);
      render(routine, stats, history);
    } catch (err) {
      mount(container, emptyState({
        art: '⚠️',
        title: err.status === 404 ? t('error.notFound') : t('error.loadFailed'),
        text: err.message,
        action: el('button', { class: 'btn btn--secondary', onclick: () => navigate('/routines') }, t('nav.routines')),
      }));
    }
  };

  const render = (routine, stats, history) => {
    const recent = history.slice(-42);

    mount(container,
      el('div', { class: 'row', style: { 'margin-bottom': 'var(--s-5)' } },
        el('button', { class: 'btn btn--ghost btn--sm', onclick: () => navigate('/routines') },
          icon('chevronLeft', { size: 15 }), t('nav.routines')),
      ),

      el('section', { class: 'hero-card', style: { '--routine-color': routine.color } },
        el('div', { class: 'hero-card__body' },
          el('div', { class: 'row' },
            el('div', { class: 'routine__icon', style: { '--routine-color': routine.color, width: '52px', height: '52px', 'font-size': '25px' } }, routine.icon),
            el('div', null,
              el('h1', { class: 'hero-card__greeting' }, routine.title),
              el('div', { class: 'hero-card__date' },
                `${t(`cat.${routine.category}`)} · ${repeatLabel(routine)}`),
            ),
          ),
          routine.notes ? el('p', { class: 'hero-card__line' }, routine.notes) : null,

          el('div', { class: 'row row--wrap', style: { gap: 'var(--s-2)', 'margin-top': 'var(--s-4)' } },
            routine.start_time ? el('span', { class: 'chip' }, icon('clock', { size: 11 }), routine.start_time) : null,
            routine.duration_min ? el('span', { class: 'chip' }, formatDuration(routine.duration_min)) : null,
            el('span', { class: 'chip' }, t(`priority.${routine.priority}`)),
            routine.goal_type === 'quantity'
              ? el('span', { class: 'chip' }, icon('target', { size: 11 }), `${routine.target_value} ${routine.unit}`)
              : null,
            el('span', { class: 'chip' }, `${t('form.startDate')}: ${routine.start_date}`),
            routine.end_date ? el('span', { class: 'chip' }, `${t('form.endDate')}: ${routine.end_date}`) : null,
          ),

          el('div', { class: 'hero-card__actions' },
            el('button', {
              class: 'btn btn--secondary',
              onclick: () => openRoutineForm(routine, {
                weekStart: state.user.week_start,
                onSaved: () => { invalidateRoutines(); load(); },
              }),
            }, icon('edit', { size: 15 }), t('action.edit')),
            el('button', {
              class: 'btn btn--ghost',
              onclick: async () => {
                await api.updateRoutine(routine.id, { archived: !routine.archived });
                toast(routine.archived ? t('toast.routineRestored') : t('toast.routineArchived'));
                invalidateRoutines();
                load();
              },
            }, icon('archive', { size: 15 }), routine.archived ? t('action.restore') : t('action.archive')),
            el('button', {
              class: 'btn btn--ghost',
              onclick: async () => {
                const ok = await confirmDialog({
                  title: t('routines.deleteConfirm', { title: routine.title }),
                  message: t('routines.deleteWarn'),
                  confirmLabel: t('action.delete'),
                  danger: true,
                });
                if (!ok) return;
                await api.deleteRoutine(routine.id);
                invalidateRoutines();
                toast(t('toast.routineDeleted'));
                navigate('/routines');
              },
            }, icon('trash', { size: 15 }), t('action.delete')),
          ),
        ),

        progressRing(stats.rate ?? 0, {
          size: 124,
          label: stats.rate === null ? '—' : `${pct(stats.rate)}%`,
          sublabel: `${stats.done}/${stats.due}`,
          color: routine.color,
        }),
      ),

      el('div', { class: 'grid grid--4', style: { 'margin-top': 'var(--s-6)' } },
        kpi(t('stats.currentStreak'), stats.streak, t('misc.days'), '🔥'),
        kpi(t('stats.bestStreak'), stats.best_streak, t('misc.days'), '🏆'),
        kpi(t('stats.completion'), stats.rate === null ? '—' : `${pct(stats.rate)}%`, t('stats.days', { count: 90 }), '🎯'),
        kpi('Last done', stats.last_done ? formatDate(stats.last_done, { locale: state.user.locale }) : t('misc.never'), '', '📅'),
      ),

      el('section', { class: 'section' },
        el('div', { class: 'section__head' },
          el('div', { class: 'section__title' }, t('stats.heatmap')),
          el('div', { class: 'section__hint' }, t('stats.days', { count: recent.length })),
        ),
        el('div', { class: 'card' },
          recent.length
            ? el('div', { class: 'row row--wrap', style: { gap: '5px' } },
                ...recent.map((day) => el('span', {
                  class: 'heatmap__cell',
                  style: {
                    width: '18px', height: '18px', 'border-radius': '5px',
                    background: day.status === 'done' ? routine.color
                      : day.status === 'partial' ? `color-mix(in srgb, ${routine.color} 45%, var(--surface-3))`
                      : day.status === 'skipped' ? 'var(--surface-3)'
                      : 'var(--surface-3)',
                    opacity: day.status === 'pending' ? '0.6' : '1',
                  },
                  title: `${formatDate(day.date, { locale: state.user.locale })} — ${day.status}`,
                })),
              )
            : el('p', { class: 'muted' }, t('routines.noHistory')),
        ),
      ),
    );
  };

  const kpi = (label, value, foot, emoji) => el('div', { class: 'kpi' },
    el('div', { class: 'kpi__label' }, el('span', null, emoji), label),
    el('div', { class: 'kpi__value' }, String(value)),
    foot ? el('div', { class: 'kpi__foot' }, foot) : null,
  );

  load();
}
