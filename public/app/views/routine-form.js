import { el } from '../dom.js';
import { t, getLocale } from '../i18n.js';
import { api, ApiError } from '../api.js';
import { modal, toast } from '../ui.js';
import { invalidateRoutines } from '../store.js';
import {
  todayISO, formatDate, weekdayName, EMOJI_CHOICES, COLOR_CHOICES, CATEGORY_COLORS,
} from '../utils.js';

const CATEGORIES = Object.keys(CATEGORY_COLORS);

/**
 * Create / edit dialog for a routine.
 *
 * The form is progressive: the repeat and goal sections reveal only the inputs
 * that the chosen mode actually needs, so the dialog never shows a field that
 * cannot affect the result.
 *
 * A new routine happens once, on the day it was added from. Repeating is a
 * deliberate choice under "More options": a routine added while looking at
 * one day should not quietly appear on every other day as well.
 *
 * @param {object|null} routine  existing routine, or null to create
 * @param {object} options       { weekStart, date, goalId, onSaved } — `date` is
 *                               the day the form was opened from (default
 *                               today); `goalId` preselects a goal
 */
export function openRoutineForm(routine, { weekStart = 1, date, goalId = null, onSaved } = {}) {
  const isEdit = Boolean(routine);

  const draft = {
    title: routine?.title || '',
    goal_id: routine?.goal_id ?? goalId,
    notes: routine?.notes || '',
    icon: routine?.icon || '✅',
    color: routine?.color || '#6366f1',
    category: routine?.category || 'personal',
    priority: routine?.priority || 'normal',
    start_time: routine?.start_time || '',
    duration_min: routine?.duration_min ?? 0,
    end_time: endTimeOf(routine),
    repeat_type: routine?.repeat_type || 'once',
    repeat_days: routine?.repeat_days || '',
    repeat_every: routine?.repeat_every || 2,
    start_date: routine?.start_date || date || todayISO(),
    end_date: routine?.end_date || '',
    goal_type: routine?.goal_type || 'check',
    target_value: routine?.target_value ?? 1,
    unit: routine?.unit || '',
    reminder_min: routine?.reminder_min ?? null,
  };

  const errors = {};

  /**
   * The server stores a start time plus a length; people describe a slot as
   * "6 to 7". So the form collects a finish time and derives the length here.
   * A finish at or before the start means the routine runs past midnight.
   */
  const syncDuration = () => {
    const from = toMinutes(draft.start_time);
    const to = toMinutes(draft.end_time);
    draft.duration_min = from === null || to === null ? 0 : (to - from + 1440) % 1440;
  };

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
              el('span', null, timeSummary(draft)),
              el('span', null, t(`cat.${draft.category}`)),
              draft.duration_min ? el('span', null, `${draft.duration_min} ${t('misc.min')}`) : null,
              el('span', null, repeatLabel(draft)),
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
              }, weekdayName(day, getLocale()))),
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

      // Which goal this routine serves. "No goal" is the default and stays
      // selected until the user picks one, so a routine never needs a goal to
      // exist. The list arrives after the dialog is already on screen.
      const goalSelect = el('select', {
        class: 'select', id: 'f-goal',
        onchange: (e) => { draft.goal_id = e.target.value ? Number(e.target.value) : null; },
      }, el('option', { value: '', selected: !draft.goal_id }, t('form.noGoal')));

      api.goals()
        .then(({ goals }) => {
          for (const goal of goals) {
            if (goal.status === 'archived') continue;
            goalSelect.appendChild(el('option', {
              value: String(goal.id),
              selected: goal.id === draft.goal_id,
            }, `${goal.icon} ${goal.title}`));
          }
        })
        .catch(() => { /* the form is still usable without the goal list */ });

      // Everything beyond the name and the time slot is optional, so it starts
      // folded away: adding a routine should cost one field and two clocks.
      const advanced = el('div', { class: 'col', style: { gap: 'var(--s-5)' } },
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
              oninput: (e) => { draft.start_date = e.target.value; refreshPreview(); },
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
      );

      // Editing opens expanded: the detail being changed is usually one of the
      // ones that live in here. This folds with the `.hidden` class rather than
      // the hidden attribute, because `.col`'s display would beat `[hidden]`.
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
        // The entire required form: what it is called, and when it happens.
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
          el('div', { class: 'grid grid--2' },
            el('div', { class: 'field' },
              el('label', { class: 'field__label', for: 'f-time' }, t('form.startTime')),
              el('input', {
                class: 'input', id: 'f-time', type: 'time', value: draft.start_time,
                oninput: (e) => { draft.start_time = e.target.value; syncDuration(); refreshPreview(); },
              }),
            ),
            el('div', { class: 'field' },
              el('label', { class: 'field__label', for: 'f-end-time' }, t('form.endTime')),
              el('input', {
                class: 'input', id: 'f-end-time', type: 'time', value: draft.end_time,
                oninput: (e) => { draft.end_time = e.target.value; syncDuration(); refreshPreview(); },
              }),
            ),
          ),
          // Quick lengths (UI-10): one tap sets the finish time from the start.
          el('div', { class: 'quick-times', role: 'group', 'aria-label': t('form.quickLength') },
            ...[15, 30, 60, 120].map((minutes) => el('button', {
              type: 'button',
              class: 'chip chip--button',
              onclick: (event) => {
                const field = event.currentTarget.closest('.field');
                // No start yet: begin at the next quarter hour, the way a slot
                // is usually booked, rather than refusing the tap.
                if (!draft.start_time) {
                  draft.start_time = nextQuarterHour();
                  field.querySelector('#f-time').value = draft.start_time;
                }
                draft.end_time = formatClock(toMinutes(draft.start_time) + minutes);
                field.querySelector('#f-end-time').value = draft.end_time;
                syncDuration();
                refreshPreview();
              },
            }, minutes < 60 ? t('form.minutesShort', { count: minutes }) : t('form.hoursShort', { count: minutes / 60 }))),
          ),
          el('div', { class: 'field__hint' }, t('form.timeHint')),
        ),

        el('div', { class: 'field' },
          el('label', { class: 'field__label', for: 'f-goal' }, t('form.goal')),
          goalSelect,
        ),

        el('div', { class: 'field' },
          el('div', { class: 'field__label' }, t('form.preview')),
          preview,
        ),

        advancedToggle,
        advanced,
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

        // end_time only exists in the form; the API stores duration_min.
        const { end_time: _formEndTime, ...fields } = draft;
        const payload = {
          ...fields,
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

/**
 * A routine's repeat rule in the reader's language. The server also sends a
 * `repeat_label`, but it is English only, so the views use this instead.
 * Empty weekday lists read as "every day", because that is how the schedule
 * treats them.
 */
export function repeatLabel(routine) {
  const locale = getLocale();
  const days = String(routine.repeat_days || '').split(',').filter(Boolean).map(Number).sort((a, b) => a - b);

  switch (routine.repeat_type) {
    case 'daily': return t('repeat.daily');
    case 'once': return t('repeat.onDay', { date: formatDate(routine.start_date, { locale }) });
    case 'interval':
      return Number(routine.repeat_every) === 1 ? t('repeat.daily') : t('repeat.everyN', { count: routine.repeat_every });
    case 'weekly':
      return days.length && days.length < 7 ? days.map((d) => weekdayName(d, locale)).join(', ') : t('repeat.daily');
    case 'monthly':
      return days.length ? `${t('repeat.monthly')}: ${days.join(', ')}` : t('repeat.monthly');
    default: return '';
  }
}

/** Minutes since midnight for an "HH:MM" string, or null when it is unset. */
function toMinutes(time) {
  if (!time) return null;
  const [hours, minutes] = String(time).split(':').map(Number);
  return Number.isInteger(hours) && Number.isInteger(minutes) ? hours * 60 + minutes : null;
}

/** "HH:MM" for a minute count, wrapping past midnight. */
function formatClock(minutes) {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/** The finish time implied by a saved routine's start time and duration. */
function endTimeOf(routine) {
  const start = toMinutes(routine?.start_time);
  if (start === null || !routine?.duration_min) return '';
  return formatClock(start + routine.duration_min);
}

/** The next quarter hour from now, e.g. 09:07 → "09:15". */
function nextQuarterHour() {
  const now = new Date();
  return formatClock(Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 15) * 15);
}

/** "06:00 – 07:00", a bare start time, or "anytime". */
function timeSummary(draft) {
  if (!draft.start_time) return t('part.anytime');
  return draft.end_time ? `${draft.start_time} – ${draft.end_time}` : draft.start_time;
}
