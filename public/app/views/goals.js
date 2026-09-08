import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import { t, getLocale } from '../i18n.js';
import { api, ApiError } from '../api.js';
import { modal, toast, emptyState, skeletonList, confirmDialog } from '../ui.js';
import { invalidateRoutines } from '../store.js';
import { formatDate, daysBetween, todayISO, EMOJI_CHOICES, COLOR_CHOICES } from '../utils.js';

const GOAL_EMOJI = ['🎯', '🏆', '🚀', '📚', '💪', '🧠', '💰', '🌱', '❤️', '🎨', '🧘', '⛰️'];

/**
 * Goals — the reason routines exist.
 *
 * A goal owns no schedule of its own: its numbers are entirely derived from
 * the routines pointing at it, so "how is this goal going" and "did I do the
 * work" can never disagree.
 */
export function renderGoals(container, { navigate }) {
  let goals = [];
  let unassigned = 0;
  let windowDays = 30;
  let filter = 'active';   // active | done | all

  mount(container, el('div', { class: 'col' }, skeletonList(3)));

  const load = async () => {
    try {
      const res = await api.goals(true);
      goals = res.goals;
      unassigned = res.unassigned;
      windowDays = res.window_days;
      render();
    } catch (err) {
      mount(container, emptyState({
        art: '⚠️', title: t('error.loadFailed'), text: err.message,
        action: el('button', { class: 'btn btn--secondary', onclick: load }, t('action.retry')),
      }));
    }
  };

  const reload = () => {
    // A goal change can move routines between goals, so the cached list goes.
    invalidateRoutines();
    load();
  };

  const visible = () => goals.filter((g) => (filter === 'all' ? true : g.status === filter));

  const listSlot = el('div');

  const render = () => {
    mount(container,
      el('div', { class: 'page-head' },
        el('h1', null, t('goals.title')),
        el('p', null, t('goals.sub')),
      ),
      toolbar(),
      listSlot,
    );
    renderList();
  };

  const toolbar = () => el('div', { class: 'toolbar' },
    el('div', { class: 'segmented' },
      ...[['active', t('goals.filterActive')], ['done', t('goals.filterDone')], ['all', t('goals.filterAll')]]
        .map(([value, label]) => el('button', {
          type: 'button',
          class: ['segmented__item', filter === value && 'is-active'],
          onclick: (event) => {
            filter = value;
            [...event.currentTarget.parentElement.children]
              .forEach((n) => n.classList.toggle('is-active', n === event.currentTarget));
            renderList();
          },
        }, label)),
    ),

    unassigned
      ? el('span', { class: 'chip' }, icon('layers', { size: 11 }), t('goals.unassigned', { count: unassigned }))
      : null,

    el('button', {
      class: 'btn btn--primary',
      style: { 'margin-left': 'auto' },
      onclick: () => openGoalForm(null, { onSaved: reload }),
    }, icon('plus', { size: 16 }), t('goals.new')),
  );

  const renderList = () => {
    const items = visible();
    if (!items.length) {
      mount(listSlot, el('div', { class: 'card' }, emptyState({
        art: '🎯',
        title: t('goals.empty'),
        text: t('goals.emptyText'),
        action: el('button', {
          class: 'btn btn--primary',
          onclick: () => openGoalForm(null, { onSaved: reload }),
        }, icon('plus', { size: 16 }), t('goals.new')),
      })));
      return;
    }
    mount(listSlot, el('div', { class: 'grid grid--auto' }, ...items.map(goalCard)));
  };

  const goalCard = (goal) => {
    const { progress } = goal;
    const done = goal.status === 'done';

    return el('article', {
      class: ['routine-card', goal.status === 'archived' && 'is-archived'],
      style: { '--routine-color': goal.color },
    },
      el('div', { class: 'routine-card__top' },
        el('div', { class: 'routine__icon' }, goal.icon),
        el('div', { class: 'grow' },
          el('div', { class: 'routine-card__title' }, goal.title),
          el('div', { class: 'routine__meta' },
            el('span', null, t('goals.routineCount', { count: progress.routines })),
            goal.target_date ? el('span', null, icon('calendar', { size: 12 }), deadlineLabel(goal.target_date)) : null,
          ),
        ),
        done ? el('span', { class: 'badge badge--success' }, t('goals.statusDone')) : null,
      ),

      goal.description ? el('p', { class: 'routine-card__notes' }, goal.description) : null,

      // No routines yet means there is nothing to report, so the bar stays out
      // of the way rather than showing a discouraging 0%.
      progress.completion === null
        ? el('p', { class: 'subtle', style: { 'font-size': 'var(--text-xs)' } }, t('goals.noRoutines'))
        : el('div', null,
            el('div', { class: 'row row--between', style: { 'margin-bottom': 'var(--s-2)' } },
              el('span', { class: 'routine-card__stat' }, t('goals.lastDays', { count: windowDays })),
              el('span', { class: 'routine-card__stat' }, el('b', null, `${Math.round(progress.completion)}%`)),
            ),
            el('div', { class: ['bar', progress.completion >= 80 && 'bar--success'] },
              el('div', { class: 'bar__fill', style: { width: `${Math.min(100, progress.completion)}%` } }),
            ),
          ),

      goal.routines.length
        ? el('div', { class: 'template-card__list' },
            ...goal.routines.slice(0, 4).map((r) => el('span', null,
              r.icon,
              el('span', { class: 'truncate grow' }, r.title),
              r.start_time ? el('span', null, r.start_time) : null,
            )),
            goal.routines.length > 4
              ? el('span', null, t('goals.andMore', { count: goal.routines.length - 4 }))
              : null,
          )
        : null,

      el('div', { class: 'routine-card__foot' },
        el('button', {
          class: 'btn btn--ghost btn--sm',
          onclick: () => navigate('/routines'),
        }, icon('routines', { size: 13 }), t('nav.routines')),

        el('div', { class: 'row', style: { gap: '2px' } },
          el('button', {
            class: 'btn btn--icon', 'data-tip': t('action.edit'),
            onclick: () => openGoalForm(goal, { onSaved: reload }),
          }, icon('edit', { size: 15 })),
          el('button', {
            class: 'btn btn--icon',
            'data-tip': done ? t('goals.reopen') : t('goals.markDone'),
            onclick: async (event) => {
              const button = event.currentTarget;
              button.setAttribute('aria-busy', 'true');
              try {
                await api.updateGoal(goal.id, { status: done ? 'active' : 'done' });
                toast(done ? t('toast.goalReopened') : t('toast.goalDone'));
                reload();
              } finally {
                button.removeAttribute('aria-busy');
              }
            },
          }, icon('check', { size: 15 })),
          el('button', {
            class: 'btn btn--icon', 'data-tip': t('action.delete'),
            onclick: async () => {
              const ok = await confirmDialog({
                title: t('goals.deleteConfirm', { title: goal.title }),
                message: t('goals.deleteWarn'),
                confirmLabel: t('action.delete'),
                danger: true,
              });
              if (!ok) return;
              await api.deleteGoal(goal.id);
              toast(t('toast.goalDeleted'));
              reload();
            },
          }, icon('trash', { size: 15 })),
        ),
      ),
    );
  };

  load();
}

/** "in 12 days" / "3 days ago" — a deadline only helps if it reads as one. */
function deadlineLabel(date) {
  const days = daysBetween(todayISO(), date);
  if (days === 0) return t('goals.dueToday');
  if (days > 0) return t('goals.dueIn', { count: days });
  return formatDate(date, { locale: getLocale() });
}

/**
 * Create / edit dialog for a goal.
 *
 * Same shape as the routine form: a name and a date are all it asks for, and
 * the cosmetic fields wait behind one toggle.
 */
export function openGoalForm(goal, { onSaved } = {}) {
  const isEdit = Boolean(goal);

  const draft = {
    title: goal?.title || '',
    description: goal?.description || '',
    icon: goal?.icon || '🎯',
    color: goal?.color || '#6366f1',
    target_date: goal?.target_date || '',
    status: goal?.status || 'active',
  };

  modal({
    title: isEdit ? t('goals.edit') : t('goals.new'),
    subtitle: isEdit ? goal.title : null,
    build: (close) => {
      const titleError = el('div', { class: 'field__error' });

      const advanced = el('div', { class: 'col', style: { gap: 'var(--s-5)' } },
        el('div', { class: 'field' },
          el('div', { class: 'field__label' }, t('form.icon')),
          el('div', { class: 'picker-grid' },
            ...[...GOAL_EMOJI, ...EMOJI_CHOICES].map((emoji) => el('button', {
              type: 'button',
              class: ['picker-grid__item', emoji === draft.icon && 'is-on'],
              onclick: (event) => {
                draft.icon = emoji;
                event.currentTarget.parentElement.querySelectorAll('.is-on')
                  .forEach((n) => n.classList.remove('is-on'));
                event.currentTarget.classList.add('is-on');
              },
            }, emoji)),
          ),
        ),

        el('div', { class: 'field' },
          el('div', { class: 'field__label' }, t('form.color')),
          el('div', { class: 'picker-grid' },
            ...COLOR_CHOICES.map((color) => el('button', {
              type: 'button',
              class: ['swatch', color === draft.color && 'is-on'],
              style: { background: color },
              'aria-label': color,
              onclick: (event) => {
                draft.color = color;
                event.currentTarget.parentElement.querySelectorAll('.is-on')
                  .forEach((n) => n.classList.remove('is-on'));
                event.currentTarget.classList.add('is-on');
              },
            })),
          ),
        ),

        el('div', { class: 'field' },
          el('label', { class: 'field__label', for: 'g-desc' }, t('goals.why')),
          el('textarea', {
            class: 'textarea', id: 'g-desc', maxlength: '2000',
            placeholder: t('goals.whyPlaceholder'),
            oninput: (e) => { draft.description = e.target.value; },
          }, draft.description),
        ),
      );

      if (!isEdit) advanced.classList.add('hidden');

      const advancedToggle = el('button', {
        class: 'btn btn--ghost btn--block', type: 'button',
        'aria-expanded': String(isEdit),
        onclick: (event) => {
          const button = event.currentTarget;
          const folded = advanced.classList.toggle('hidden');
          button.setAttribute('aria-expanded', String(!folded));
          button.textContent = folded ? t('form.moreOptions') : t('form.lessOptions');
        },
      }, isEdit ? t('form.lessOptions') : t('form.moreOptions'));

      const body = el('div', { class: 'col', style: { gap: 'var(--s-5)' } },
        el('div', { class: 'field' },
          el('label', { class: 'field__label', for: 'g-title' }, t('goals.name')),
          el('input', {
            class: 'input', id: 'g-title', type: 'text', maxlength: '120',
            value: draft.title, placeholder: t('goals.namePlaceholder'), 'data-autofocus': '',
            oninput: (e) => { draft.title = e.target.value; titleError.textContent = ''; },
          }),
          titleError,
        ),

        el('div', { class: 'field' },
          el('label', { class: 'field__label', for: 'g-date' }, t('goals.targetDate')),
          el('input', {
            class: 'input', id: 'g-date', type: 'date', value: draft.target_date,
            oninput: (e) => { draft.target_date = e.target.value; },
          }),
          el('div', { class: 'field__hint' }, t('goals.targetDateHint')),
        ),

        advancedToggle,
        advanced,
      );

      const save = el('button', { class: 'btn btn--primary', type: 'button' },
        isEdit ? t('action.save') : t('action.create'));

      save.addEventListener('click', async () => {
        if (!draft.title.trim()) {
          titleError.textContent = `${t('goals.name')} ${t('misc.required')}`;
          body.querySelector('#g-title').focus();
          return;
        }
        save.setAttribute('aria-busy', 'true');

        const payload = {
          ...draft,
          title: draft.title.trim(),
          target_date: draft.target_date || null,
        };

        try {
          const result = isEdit
            ? await api.updateGoal(goal.id, payload)
            : await api.createGoal(payload);
          toast(isEdit ? t('toast.goalUpdated') : t('toast.goalCreated'));
          close(result.goal);
          onSaved?.(result.goal);
        } catch (err) {
          save.removeAttribute('aria-busy');
          if (err instanceof ApiError && err.fields) {
            toast(Object.values(err.fields)[0], 'error');
          } else {
            toast(err.message || t('error.generic'), 'error');
          }
        }
      });

      return {
        body,
        footer: [
          el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => close(null) }, t('action.cancel')),
          save,
        ],
      };
    },
  });
}
