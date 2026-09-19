import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { state, invalidateRoutines } from '../store.js';
import { toast, emptyState, skeletonList, confirmDialog } from '../ui.js';
import { openRoutineForm, repeatLabel } from './routine-form.js';
import { formatDuration, debounce } from '../utils.js';

/** Library of every routine, plus the template packs. */
export function renderRoutines(container, { navigate }) {
  let routines = [];
  let templates = [];
  let goalsById = new Map();
  let query = '';
  let filter = 'active';   // active | archived | all
  let category = 'all';

  mount(container, el('div', { class: 'col' }, skeletonList(5)));

  const load = async () => {
    try {
      const [routinesRes, templatesRes, goalsRes] = await Promise.all([
        api.routines(true), api.templates(), api.goals(true),
      ]);
      routines = routinesRes.routines;
      templates = templatesRes.templates;
      goalsById = new Map(goalsRes.goals.map((g) => [g.id, g]));
      render();
    } catch (err) {
      mount(container, emptyState({
        art: '⚠️', title: t('error.loadFailed'), text: err.message,
        action: el('button', { class: 'btn btn--secondary', onclick: load }, t('action.retry')),
      }));
    }
  };

  const visible = () => routines.filter((r) => {
    if (filter === 'active' && r.archived) return false;
    if (filter === 'archived' && !r.archived) return false;
    if (category !== 'all' && r.category !== category) return false;
    if (query) {
      const haystack = `${r.title} ${r.notes} ${r.category}`.toLowerCase();
      if (!haystack.includes(query.toLowerCase())) return false;
    }
    return true;
  });

  const onSearch = debounce((value) => { query = value; renderList(); }, 180);

  const listSlot = el('div');

  const render = () => {
    mount(container,
      el('div', { class: 'page-head' },
        el('h1', null, t('routines.title')),
        el('p', null, t('routines.sub')),
      ),
      toolbar(),
      listSlot,
      templateSection(),
    );
    renderList();
  };

  const toolbar = () => {
    const categories = [...new Set(routines.map((r) => r.category))].sort();
    return el('div', { class: 'toolbar' },
      el('div', { class: 'toolbar__search' },
        icon('search', { size: 16 }),
        el('input', {
          class: 'input', type: 'search', placeholder: t('routines.searchPlaceholder'),
          value: query,
          oninput: (e) => onSearch(e.target.value),
        }),
      ),
      el('div', { class: 'segmented' },
        ...[['active', t('routines.active')], ['archived', t('routines.archived')], ['all', 'All']]
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
      categories.length > 1
        ? el('select', {
            class: 'select', style: { width: 'auto' },
            onchange: (e) => { category = e.target.value; renderList(); },
          },
            el('option', { value: 'all' }, t('form.category')),
            ...categories.map((c) => el('option', { value: c }, t(`cat.${c}`))),
          )
        : null,
      el('button', {
        class: 'btn btn--primary',
        style: { 'margin-left': 'auto' },
        onclick: () => openRoutineForm(null, { weekStart: state.user.week_start, onSaved: reload }),
      }, icon('plus', { size: 16 }), t('action.add')),
    );
  };

  const reload = () => { invalidateRoutines(); load(); };

  const renderList = () => {
    const items = visible();
    if (!items.length) {
      mount(listSlot, el('div', { class: 'card' }, emptyState({
        art: query ? '🔍' : '🌱',
        title: query ? t('palette.empty') : t('routines.empty'),
        text: query ? null : t('routines.emptyText'),
        action: query ? null : el('button', {
          class: 'btn btn--primary',
          onclick: () => openRoutineForm(null, { weekStart: state.user.week_start, onSaved: reload }),
        }, icon('plus', { size: 16 }), t('action.add')),
      })));
      return;
    }
    const reorderable = canReorder();
    mount(listSlot,
      reorderable ? el('p', { class: 'subtle reorder-hint' }, icon('grip', { size: 14, stroke: 3 }), t('routines.dragHint')) : null,
      el('div', { class: 'grid grid--auto' }, ...items.map((routine) => routineCard(routine, reorderable))),
    );
  };

  // --- Reordering (UI-09) --------------------------------------------------

  // Only the unfiltered active list can be reordered: dragging within a
  // search result or one category would have to guess where the hidden
  // routines go. The server stores the result in sort_order.
  const canReorder = () => filter === 'active' && !query && category === 'all';

  /** Persist the grid's current order; on failure, reload the true order. */
  const saveOrder = async (grid) => {
    const ids = [...grid.children].map((card) => Number(card.dataset.id));
    const byId = new Map(routines.map((r) => [r.id, r]));
    routines = [...ids.map((id) => byId.get(id)), ...routines.filter((r) => !ids.includes(r.id))];
    try {
      await api.reorderRoutines(ids);
      invalidateRoutines();
    } catch (err) {
      toast(err.message || t('error.generic'), 'error');
      reload();
    }
  };

  /**
   * Drag by the handle with a mouse, a finger or a pen (Pointer Events, so it
   * works on phones where HTML5 drag-and-drop does not). The card moves in
   * the DOM as the pointer crosses others; the order is saved on release.
   *
   * The listeners sit on the document, not the handle: moving the card in the
   * DOM releases any pointer capture on its handle, after which a handle-only
   * listener never hears the release and the drag never ends.
   */
  const startDrag = (event, card) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    const grid = card.parentElement;
    const startOrder = [...grid.children].map((c) => c.dataset.id).join(',');
    card.classList.add('is-dragging');

    const onMove = (e) => {
      if (e.pointerId !== pointerId) return;
      // Keep scrolling while the pointer rests near the top or bottom edge.
      if (e.clientY < 70) window.scrollBy(0, -12);
      else if (e.clientY > window.innerHeight - 90) window.scrollBy(0, 12);

      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.routine-card');
      if (!target || target === card || target.parentElement !== grid) return;
      const cards = [...grid.children];
      if (cards.indexOf(target) > cards.indexOf(card)) target.after(card);
      else target.before(card);
    };
    const onEnd = (e) => {
      if (e.pointerId !== pointerId) return;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      card.classList.remove('is-dragging');
      if ([...grid.children].map((c) => c.dataset.id).join(',') !== startOrder) saveOrder(grid);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
  };

  /** Keyboard reordering: arrow keys move the focused card one place. */
  const keyMove = (event, card) => {
    const back = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    if (!back && !forward) return;
    event.preventDefault();
    const sibling = back ? card.previousElementSibling : card.nextElementSibling;
    if (!sibling) return;
    if (back) sibling.before(card); else sibling.after(card);
    event.currentTarget.focus();   // moving a node in the DOM drops its focus
    saveOrder(card.parentElement);
  };

  const routineCard = (routine, reorderable = false) => el('article', {
    class: ['routine-card', routine.archived && 'is-archived'],
    style: { '--routine-color': routine.color },
    dataset: { id: String(routine.id) },
  },
    el('div', { class: 'routine-card__top' },
      reorderable
        ? el('button', {
            class: 'drag-handle',
            type: 'button',
            'aria-label': t('routines.dragHandle', { title: routine.title }),
            'data-tip': t('routines.dragHandle', { title: routine.title }),
            onpointerdown: (e) => startDrag(e, e.currentTarget.closest('.routine-card')),
            onkeydown: (e) => keyMove(e, e.currentTarget.closest('.routine-card')),
          }, icon('grip', { size: 16, stroke: 3 }))
        : null,
      el('div', { class: 'routine__icon' }, routine.icon),
      el('div', { class: 'grow' },
        el('div', { class: 'routine-card__title' }, routine.title),
        el('div', { class: 'routine__meta' },
          routine.start_time ? el('span', null, icon('clock', { size: 12 }), routine.start_time) : el('span', null, t('part.anytime')),
          routine.duration_min ? el('span', null, formatDuration(routine.duration_min)) : null,
        ),
      ),
      routine.priority === 'high' ? el('span', { class: 'badge badge--warning' }, t('priority.high')) : null,
      routine.archived ? el('span', { class: 'badge badge--muted' }, t('routines.archived')) : null,
    ),

    routine.notes ? el('p', { class: 'routine-card__notes' }, routine.notes) : null,

    el('div', { class: 'row row--wrap', style: { gap: 'var(--s-2)' } },
      el('span', { class: 'chip' },
        el('i', { class: 'chip__dot', style: { background: routine.color, color: routine.color } }),
        t(`cat.${routine.category}`)),
      el('span', { class: 'chip' }, icon('repeat', { size: 11 }), repeatLabel(routine)),
      goalsById.has(routine.goal_id)
        ? el('span', { class: 'chip' }, icon('target', { size: 11 }), goalsById.get(routine.goal_id).title)
        : null,
      routine.goal_type === 'quantity'
        ? el('span', { class: 'chip' }, icon('target', { size: 11 }), `${trim(routine.target_value)} ${routine.unit}`)
        : null,
      routine.reminder_min !== null
        ? el('span', { class: 'chip' }, icon('bell', { size: 11 }),
            routine.reminder_min === 0 ? t('form.reminderAt') : t('form.reminderBefore', { count: routine.reminder_min }))
        : null,
    ),

    el('div', { class: 'routine-card__foot' },
      el('button', {
        class: 'btn btn--ghost btn--sm',
        onclick: () => navigate(`/routine/${routine.id}`),
      }, icon('stats', { size: 13 }), t('stats.title')),

      el('div', { class: 'row', style: { gap: '2px' } },
        el('button', {
          class: 'btn btn--icon', 'data-tip': t('action.edit'),
          onclick: () => openRoutineForm(routine, { weekStart: state.user.week_start, onSaved: reload }),
        }, icon('edit', { size: 15 })),
        el('button', {
          class: 'btn btn--icon', 'data-tip': t('action.duplicate'),
          onclick: async () => {
            await api.duplicateRoutine(routine.id);
            toast(t('toast.routineCreated'));
            reload();
          },
        }, icon('copy', { size: 15 })),
        el('button', {
          class: 'btn btn--icon',
          'data-tip': routine.archived ? t('action.restore') : t('action.archive'),
          onclick: async () => {
            await api.updateRoutine(routine.id, { archived: !routine.archived });
            toast(routine.archived ? t('toast.routineRestored') : t('toast.routineArchived'));
            reload();
          },
        }, icon('archive', { size: 15 })),
        el('button', {
          class: 'btn btn--icon', 'data-tip': t('action.delete'),
          onclick: async () => {
            const ok = await confirmDialog({
              title: t('routines.deleteConfirm', { title: routine.title }),
              message: t('routines.deleteWarn'),
              confirmLabel: t('action.delete'),
              danger: true,
            });
            if (!ok) return;
            await api.deleteRoutine(routine.id);
            toast(t('toast.routineDeleted'));
            reload();
          },
        }, icon('trash', { size: 15 })),
      ),
    ),
  );

  const templateSection = () => el('section', { class: 'section' },
    el('div', { class: 'section__head' },
      el('div', null,
        el('div', { class: 'section__title' }, t('routines.templates')),
        el('div', { class: 'section__hint' }, t('routines.templatesSub')),
      ),
    ),
    el('div', { class: 'grid grid--auto' },
      ...templates.map((tpl) => el('article', {
        class: 'template-card',
        style: { '--tpl-accent': tpl.accent },
      },
        el('div', { class: 'row' },
          el('div', { class: 'template-card__icon' }, tpl.icon),
          el('div', { class: 'grow' },
            el('div', { style: { 'font-weight': '640' } }, tpl.name),
            el('div', { class: 'subtle', style: { 'font-size': 'var(--text-xs)' } },
              `${tpl.count} ${t('nav.routines').toLowerCase()}`),
          ),
        ),
        el('p', { class: 'muted', style: { 'font-size': 'var(--text-sm)' } }, tpl.description),
        el('div', { class: 'template-card__list' },
          ...tpl.preview.slice(0, 4).map((item) => el('span', null,
            item.icon,
            el('span', { class: 'truncate' }, item.title),
            item.start_time ? el('span', { style: { 'margin-left': 'auto' } }, item.start_time) : null,
          )),
        ),
        el('button', {
          class: 'btn btn--secondary btn--block',
          onclick: async (event) => {
            const button = event.currentTarget;
            button.setAttribute('aria-busy', 'true');
            try {
              const result = await api.applyTemplate(tpl.id);
              toast(t('toast.packAdded', { count: result.created }));
              reload();
            } finally {
              button.removeAttribute('aria-busy');
            }
          },
        }, icon('plus', { size: 15 }), t('routines.applyPack')),
      )),
    ),
  );

  load();
}

function trim(n) {
  return Number.isInteger(Number(n)) ? String(Number(n)) : String(Math.round(Number(n) * 10) / 10);
}
