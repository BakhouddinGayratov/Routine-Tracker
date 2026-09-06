import { el } from '../dom.js';
import { t } from '../i18n.js';
import { api, ApiError } from '../api.js';
import { modal, toast } from '../ui.js';
import { invalidateRoutines } from '../store.js';
import {
  todayISO, EMOJI_CHOICES, COLOR_CHOICES, CATEGORY_COLORS, WEEKDAYS_SHORT,
} from '../utils.js';

const CATEGORIES = Object.keys(CATEGORY_COLORS);

/**
 * Create / edit dialog for a routine.
 *
 * The form is progressive: the repeat and goal sections reveal only the inputs
 * that the chosen mode actually needs, so the dialog never shows a field that
 * cannot affect the result.
 *
 * @param {object|null} routine  existing routine, or null to create
 * @param {object} options       { weekStart, onSaved }
 */
export function openRoutineForm(routine, { weekStart = 1, onSaved } = {}) {
  const isEdit = Boolean(routine);

  const draft = {
    title: routine?.title || '',
    notes: routine?.notes || '',
    icon: routine?.icon || '✅',
    color: routine?.color || '#6366f1',
    category: routine?.category || 'personal',
    priority: routine?.priority || 'normal',
    start_time: routine?.start_time || '',
    duration_min: routine?.duration_min ?? 0,
    repeat_type: routine?.repeat_type || 'daily',
    repeat_days: routine?.repeat_days || '',
    repeat_every: routine?.repeat_every || 2,
    start_date: routine?.start_date || todayISO(),
    end_date: routine?.end_date || '',
    goal_type: routine?.goal_type || 'check',
    target_value: routine?.target_value ?? 1,
    unit: routine?.unit || '',
    reminder_min: routine?.reminder_min ?? null,
  };

  const errors = {};

  modal({
    title: isEdit ? t('form.editRoutine') : t('form.newRoutine'),
    subtitle: isEdit ? routine.title : null,
    size: 'wide',
    build: (close) => {
      const repeatSlot = el('div');
      const goalSlot = el('div');
      const preview = el('div', { class: 'routine', style: { '--routine-color': draft.color } });

      const refreshPreview = () => {
        preview.style.setProperty('--routine-color', draft.color);
        preview.replaceChildren(
          el('div', { class: 'routine__icon' }, draft.icon),
          el('div', { class: 'routine__body' },
            el('div', { class: 'routine__title' }, draft.title || t('form.titlePlaceholder')),
            el('div', { class: 'routine__meta' },
              draft.start_time ? el('span', null, draft.start_time) : el('span', null, t('part.anytime')),
              el('span', null, t(`cat.${draft.category}`)),
              draft.duration_min ? el('span', null, `${draft.duration_min} ${t('misc.min')}`) : null,
              el('span', null, repeatSummary(draft)),
            ),
          ),
        );
      };

      // --- Repeat section ---------------------------------------------------
      const renderRepeat = () => {
        repeatSlot.replaceChildren();
        if (draft.repeat_type === 'weekly') {
          const selected = new Set(draft.repeat_days.split(',').filter(Boolean).map(Number));
          const order = weekStart === 0 ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
          repeatSlot.appendChild(el('div', { class: 'field' },
            el('div', { class: 'field__label' }, t('form.repeatDays')),
            el('div', { class: 'daypick' },
              ...order.map((day) => el('button', {
                type: 'button',
                class: ['daypick__day', selected.has(day) && 'is-on'],
                onclick: (event) => {
                  if (selected.has(day)) selected.delete(day); else selected.add(day);
                  draft.repeat_days = [...selected].sort((a, b) => a - b).join(',');
                  event.currentTarget.classList.toggle('is-on');
                  refreshPreview();
                },
              }, WEEKDAYS_SHORT[day])),
            ),
          ));
        } else if (draft.repeat_type === 'monthly') {
          const selected = new Set(draft.repeat_days.split(',').filter(Boolean).map(Number));
          repeatSlot.appendChild(el('div', { class: 'field' },
            el('div', { class: 'field__label' }, t('form.repeatDays')),
            el('div', { class: 'daypick daypick--month' },
              ...Array.from({ length: 31 }, (_, i) => i + 1).map((day) => el('button', {
                type: 'button',
                class: ['daypick__day', selected.has(day) && 'is-on'],
                onclick: (event) => {
                  if (selected.has(day)) selected.delete(day); else selected.add(day);
                  draft.repeat_days = [...selected].sort((a, b) => a - b).join(',');
                  event.currentTarget.classList.toggle('is-on');
                  refreshPreview();
                },
              }, day)),
            ),
          ));
        } else if (draft.repeat_type === 'interval') {
          repeatSlot.appendChild(el('div', { class: 'field' },
            el('label', { class: 'field__label', for: 'f-every' }, t('form.repeatEvery')),
            el('input', {
              class: 'input', id: 'f-every', type: 'number', min: '1', max: '365',
              value: draft.repeat_every,
              oninput: (e) => { draft.repeat_every = Number(e.target.value) || 1; refreshPreview(); },
            }),
          ));
        }
      };

      // --- Goal section -----------------------------------------------------
      const renderGoal = () => {
        goalSlot.replaceChildren();
        if (draft.goal_type !== 'quantity') return;
        goalSlot.appendChild(el('div', { class: 'grid grid--2' },
          el('div', { class: 'field' },
            el('label', { class: 'field__label', for: 'f-target' }, t('form.target')),
            el('input', {
              class: 'input', id: 'f-target', type: 'number', min: '0.01', step: 'any',
              value: draft.target_value,
              oninput: (e) => { draft.target_value = Number(e.target.value) || 1; },
            }),
          ),
          el('div', { class: 'field' },
            el('label', { class: 'field__label', for: 'f-unit' }, t('form.unit')),
            el('input', {
              class: 'input', id: 'f-unit', type: 'text', maxlength: '20',
              value: draft.unit, placeholder: t('form.unitPlaceholder'),
              oninput: (e) => { draft.unit = e.target.value; },
            }),
          ),
        ));
      };

      const titleError = el('div', { class: 'field__error' });

      const body = el('div', { class: 'col', style: { gap: 'var(--s-5)' } },
        // Identity ---------------------------------------------------------
        el('div', { class: 'field' },
          el('label', { class: 'field__label', for: 'f-title' }, t('form.title')),
          el('input', {
            class: 'input', id: 'f-title', type: 'text', maxlength: '120',
            value: draft.title, placeholder: t('form.titlePlaceholder'), 'data-autofocus': '',
            oninput: (e) => { draft.title = e.target.value; titleError.textContent = ''; refreshPreview(); },
          }),
          titleError,
        ),

        el('div', { class: 'field' },
          el('div', { class: 'field__label' }, t('form.icon')),
          el('div', { class: 'picker-grid' },
            ...EMOJI_CHOICES.map((emoji) => el('button', {
              type: 'button',
              class: ['picker-grid__item', emoji === draft.icon && 'is-on'],
              onclick: (event) => {
                draft.icon = emoji;
                event.currentTarget.parentElement.querySelectorAll('.is-on')
                  .forEach((n) => n.classList.remove('is-on'));
                event.currentTarget.classList.add('is-on');
                refreshPreview();
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
                refreshPreview();
              },
            })),
          ),
        ),

        el('div', { class: 'grid grid--2' },
          el('div', { class: 'field' },
            el('label', { class: 'field__label', for: 'f-category' }, t('form.category')),
            el('select', {
              class: 'select', id: 'f-category',
              onchange: (e) => {
                draft.category = e.target.value;
                refreshPreview();
              },
            }, ...CATEGORIES.map((c) => el('option', { value: c, selected: c === draft.category }, t(`cat.${c}`)))),
          ),
          el('div', { class: 'field' },
            el('label', { class: 'field__label', for: 'f-priority' }, t('form.priority')),
            el('select', {
              class: 'select', id: 'f-priority',
              onchange: (e) => { draft.priority = e.target.value; },
            }, ...['low', 'normal', 'high'].map((p) =>
              el('option', { value: p, selected: p === draft.priority }, t(`priority.${p}`)))),
          ),
        ),

        // Schedule -----------------------------------------------------------
        el('div', { class: 'grid grid--2' },
          el('div', { class: 'field' },
            el('label', { class: 'field__label', for: 'f-time' }, t('form.time')),
            el('input', {
              class: 'input', id: 'f-time', type: 'time', value: draft.start_time,
              oninput: (e) => { draft.start_time = e.target.value; refreshPreview(); },
            }),
            el('div', { class: 'field__hint' }, t('form.timeHint')),
          ),
          el('div', { class: 'field' },
            el('label', { class: 'field__label', for: 'f-duration' }, t('form.duration')),
            el('input', {
              class: 'input', id: 'f-duration', type: 'number', min: '0', max: '1440', step: '5',
              value: draft.duration_min,
              oninput: (e) => { draft.duration_min = Number(e.target.value) || 0; refreshPreview(); },
            }),
          ),
        ),

        el('div', { class: 'field' },
          el('label', { class: 'field__label', for: 'f-repeat' }, t('form.repeat')),
          el('select', {
            class: 'select', id: 'f-repeat',
            onchange: (e) => { draft.repeat_type = e.target.value; renderRepeat(); refreshPreview(); },
          }, ...['daily', 'weekly', 'interval', 'monthly', 'once'].map((r) =>
            el('option', { value: r, selected: r === draft.repeat_type }, t(`repeat.${r}`)))),
        ),
        repeatSlot,

        el('div', { class: 'grid grid--2' },
          el('div', { class: 'field' },
            el('label', { class: 'field__label', for: 'f-start' }, t('form.startDate')),
            el('input', {
              class: 'input', id: 'f-start', type: 'date', value: draft.start_date,
              oninput: (e) => { draft.start_date = e.target.value; },
            }),
          ),
          el('div', { class: 'field' },
            el('label', { class: 'field__label', for: 'f-end' }, t('form.endDate')),
            el('input', {
              class: 'input', id: 'f-end', type: 'date', value: draft.end_date,
              oninput: (e) => { draft.end_date = e.target.value; },
            }),
          ),
        ),

        // Tracking -----------------------------------------------------------
        el('div', { class: 'field' },
          el('div', { class: 'field__label' }, t('form.goalType')),
          el('div', { class: 'segmented' },
            ...['check', 'quantity'].map((type) => el('button', {
              type: 'button',
              class: ['segmented__item', type === draft.goal_type && 'is-active'],
              onclick: (event) => {
                draft.goal_type = type;
                [...event.currentTarget.parentElement.children]
                  .forEach((n) => n.classList.toggle('is-active', n === event.currentTarget));
                renderGoal();
              },
            }, t(`goal.${type}`))),
          ),
        ),
        goalSlot,

        el('div', { class: 'field' },
          el('label', { class: 'field__label', for: 'f-reminder' }, t('form.reminder')),
          el('select', {
            class: 'select', id: 'f-reminder',
            onchange: (e) => { draft.reminder_min = e.target.value === '' ? null : Number(e.target.value); },
          },
            el('option', { value: '', selected: draft.reminder_min === null }, t('form.reminderNone')),
            el('option', { value: '0', selected: draft.reminder_min === 0 }, t('form.reminderAt')),
            ...[5, 10, 15, 30, 60].map((m) =>
              el('option', { value: String(m), selected: draft.reminder_min === m }, t('form.reminderBefore', { count: m }))),
          ),
        ),

        el('div', { class: 'field' },
          el('label', { class: 'field__label', for: 'f-notes' }, t('form.notes')),
          el('textarea', {
            class: 'textarea', id: 'f-notes', maxlength: '2000',
            placeholder: t('form.notesPlaceholder'),
            oninput: (e) => { draft.notes = e.target.value; },
          }, draft.notes),
        ),

        // Live preview -------------------------------------------------------
        el('div', { class: 'field' },
          el('div', { class: 'field__label' }, 'Preview'),
          preview,
        ),
      );

      renderRepeat();
      renderGoal();
      refreshPreview();

      const save = el('button', { class: 'btn btn--primary', type: 'button' },
        isEdit ? t('action.save') : t('action.create'));

      save.addEventListener('click', async () => {
        if (!draft.title.trim()) {
          titleError.textContent = `${t('form.title')} ${t('misc.required')}`;
          body.querySelector('#f-title').focus();
          return;
        }
        save.setAttribute('aria-busy', 'true');

        const payload = {
          ...draft,
          title: draft.title.trim(),
          start_time: draft.start_time || null,
          end_date: draft.end_date || null,
          // Only send the fields the chosen modes actually use.
          repeat_days: ['weekly', 'monthly'].includes(draft.repeat_type) ? draft.repeat_days : '',
          repeat_every: draft.repeat_type === 'interval' ? draft.repeat_every : 1,
          target_value: draft.goal_type === 'quantity' ? draft.target_value : 1,
          unit: draft.goal_type === 'quantity' ? draft.unit.trim() : '',
        };

        try {
          const result = isEdit
            ? await api.updateRoutine(routine.id, payload)
            : await api.createRoutine(payload);
          invalidateRoutines();
          toast(isEdit ? t('toast.routineUpdated') : t('toast.routineCreated'));
          close(result.routine);
          onSaved?.(result.routine);
        } catch (err) {
          save.removeAttribute('aria-busy');
          if (err instanceof ApiError && err.fields) {
            const [field, message] = Object.entries(err.fields)[0];
            errors[field] = message;
            toast(message, 'error');
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

function repeatSummary(draft) {
  switch (draft.repeat_type) {
    case 'daily': return t('repeat.daily');
    case 'once': return t('repeat.once');
    case 'interval': return `${t('repeat.interval')} (${draft.repeat_every})`;
    case 'weekly': {
      const days = draft.repeat_days.split(',').filter(Boolean).map(Number);
      return days.length ? days.map((d) => WEEKDAYS_SHORT[d]).join(', ') : t('repeat.weekly');
    }
    case 'monthly': {
      const days = draft.repeat_days.split(',').filter(Boolean);
      return days.length ? `${t('repeat.monthly')}: ${days.join(', ')}` : t('repeat.monthly');
    }
    default: return '';
  }
}
