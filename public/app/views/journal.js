import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { state } from '../store.js';
import { toast, emptyState, skeletonList } from '../ui.js';
import { todayISO, formatDate, relativeDay, debounce } from '../utils.js';

const MOODS = ['😞', '😕', '😐', '🙂', '😄'];

/** Daily journal with mood/energy check-in and a list of past entries. */
export function renderJournal(container, { date, navigate }) {
  const selected = date || todayISO();
  const draft = { mood: null, energy: null, body: '' };
  let entries = [];

  mount(container, el('div', { class: 'col' }, skeletonList(3, 'tile')));

  const load = async () => {
    try {
      const [entryRes, listRes] = await Promise.all([
        api.journalEntry(selected),
        api.journalList(40),
      ]);
      Object.assign(draft, {
        mood: entryRes.entry?.mood ?? null,
        energy: entryRes.entry?.energy ?? null,
        body: entryRes.entry?.body ?? '',
      });
      entries = listRes.entries;
      render();
    } catch (err) {
      mount(container, emptyState({
        art: '⚠️', title: t('error.loadFailed'), text: err.message,
        action: el('button', { class: 'btn btn--secondary', onclick: load }, t('action.retry')),
      }));
    }
  };

  const save = async ({ silent = false } = {}) => {
    try {
      await api.saveJournal(selected, draft);
      if (!silent) toast(t('journal.saved'));
      const listRes = await api.journalList(40);
      entries = listRes.entries;
      renderPast();
    } catch (err) {
      toast(err.message || t('error.generic'), 'error');
    }
  };

  // Autosave keeps a long entry from being lost, without a save button race.
  const autosave = debounce(() => save({ silent: true }), 1400);

  const pastSlot = el('div');

  const render = () => {
    mount(container,
      el('div', { class: 'page-head' },
        el('h1', null, t('journal.title')),
        el('p', null, t('journal.sub')),
      ),
      editorCard(),
      el('section', { class: 'section' },
        el('div', { class: 'section__head' },
          el('div', { class: 'section__title' }, t('journal.past')),
          el('div', { class: 'section__hint' }, `${entries.length}`),
        ),
        pastSlot,
      ),
    );
    renderPast();
  };

  const editorCard = () => el('section', { class: 'card' },
    el('div', { class: 'card__head' },
      el('div', null,
        el('div', { class: 'card__title' }, relativeDay(selected, t, state.user.locale)),
        el('div', { class: 'card__hint' }, formatDate(selected, { long: true, locale: state.user.locale })),
      ),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: () => navigate(`/day/${selected}`) },
        icon('today', { size: 14 }), t('nav.today')),
    ),

    el('div', { class: 'col', style: { gap: 'var(--s-5)' } },
      pickerRow(t('journal.mood'), MOODS, 'mood'),
      pickerRow(t('journal.energy'), [1, 2, 3, 4, 5].map((n) => energyMeter(n)), 'energy'),

      el('div', { class: 'field' },
        el('label', { class: 'field__label', for: 'journal-body' }, t('form.notes')),
        el('textarea', {
          class: 'textarea', id: 'journal-body', rows: '7',
          placeholder: t('journal.placeholder'),
          maxlength: '10000',
          oninput: (e) => { draft.body = e.target.value; autosave(); },
        }, draft.body),
      ),

      el('div', { class: 'row row--between' },
        el('span', { class: 'subtle', style: { 'font-size': 'var(--text-xs)' } },
          `${draft.body.length} / 10000`),
        el('button', { class: 'btn btn--primary', onclick: () => { autosave.cancel(); save(); } },
          icon('check', { size: 15 }), t('journal.save')),
      ),
    ),
  );

  const pickerRow = (label, faces, key) => {
    const row = el('div', { class: 'mood-row' });
    faces.forEach((face, index) => {
      const value = index + 1;
      const text = key === 'mood' ? t(`mood.${value}`) : `${value}/5`;
      row.appendChild(el('button', {
        type: 'button',
        class: ['mood', draft[key] === value && 'is-on'],
        'aria-pressed': String(draft[key] === value),
        'aria-label': `${label}: ${text}`,
        onclick: (event) => {
          // Tapping the active option clears it.
          draft[key] = draft[key] === value ? null : value;
          [...row.children].forEach((n) => { n.classList.remove('is-on'); n.setAttribute('aria-pressed', 'false'); });
          if (draft[key] === value) {
            event.currentTarget.classList.add('is-on');
            event.currentTarget.setAttribute('aria-pressed', 'true');
          }
          autosave();
        },
      }, face, el('span', null, key === 'mood' ? text : String(value))));
    });
    return el('div', { class: 'field' }, el('div', { class: 'field__label' }, label), row);
  };

  const renderPast = () => {
    const past = entries.filter((e) => e.entry_date !== selected);
    if (!past.length) {
      mount(pastSlot, el('div', { class: 'card' }, emptyState({
        art: '📓', title: t('journal.empty'), text: t('journal.emptyText'),
      })));
      return;
    }
    mount(pastSlot, el('div', { class: 'card' },
      ...past.map((entry) => el('article', { class: 'journal-entry' },
        el('div', null,
          el('div', { class: 'journal-entry__date' }, formatDate(entry.entry_date, { locale: state.user.locale })),
          el('div', { style: { 'font-size': '17px', 'margin-top': '4px' } },
            entry.mood ? MOODS[entry.mood - 1] : '',
            entry.energy ? energyMeter(entry.energy, { small: true }) : null),
        ),
        el('div', null,
          el('p', { class: 'journal-entry__body' }, entry.body || '—'),
          el('button', {
            class: 'btn btn--ghost btn--sm', style: { 'margin-top': 'var(--s-2)', padding: '2px 6px' },
            onclick: () => navigate(`/journal/${entry.entry_date}`),
          }, t('action.edit')),
        ),
      )),
    ));
  };

  load();
}

/**
 * Energy as a five-step meter: the same bar shape filling up, so 3 reads as
 * "less than 4" at a glance. The old battery / bolt / fire / rocket emoji were
 * five different things, not one scale.
 */
function energyMeter(level, { small = false } = {}) {
  return el('span', { class: ['energy-meter', small && 'energy-meter--sm'], 'aria-hidden': 'true' },
    ...[1, 2, 3, 4, 5].map((step) => el('i', { class: step <= level ? 'is-on' : null })));
}
