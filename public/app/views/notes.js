import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { state } from '../store.js';
import { toast, confirmDialog, emptyState } from '../ui.js';
import { formatDate } from '../utils.js';

/**
 * Quick notes: scraps of paper on the desk. Write one in a second (Enter
 * saves), pin what must stay on top, tick off what is dealt with, click a note
 * to edit it in place.
 *
 * The same panel lives on its own page and beside the journal, where each
 * note can be dropped into the entry being written (`onUse`) — the point of
 * keeping notes there is having them at hand while writing.
 *
 * @param {{ onUse?: (text: string) => void, compact?: boolean, navigate?: Function }} options
 */
export function notesPanel({ onUse = null, compact = false, navigate = null } = {}) {
  let notes = null;
  let editingId = null;

  const listSlot = el('div', { class: 'notes__list' });
  const count = el('span', { class: 'notes__count num' });

  const input = el('textarea', {
    class: 'textarea notes__input',
    rows: '2',
    maxlength: '2000',
    placeholder: t('notes.placeholder'),
    'aria-label': t('notes.new'),
    onkeydown: (e) => {
      // Enter saves, Shift+Enter starts a new line — a note is usually one.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); add(); }
    },
  });

  const add = async () => {
    const body = input.value.trim();
    if (!body) { input.focus(); return; }
    input.value = '';
    try {
      const { note } = await api.createNote({ body });
      notes.unshift(note);
      sortNotes();
      renderList(note.id);
    } catch (err) {
      input.value = body;
      toast(err.message || t('error.generic'), 'error');
    }
  };

  const update = async (note, changes) => {
    const before = { ...note };
    Object.assign(note, changes);
    sortNotes();
    renderList();
    try {
      const { note: saved } = await api.updateNote(note.id, changes);
      Object.assign(note, saved);
    } catch (err) {
      Object.assign(note, before);
      sortNotes();
      renderList();
      toast(err.message || t('error.generic'), 'error');
    }
  };

  const remove = async (note) => {
    const ok = await confirmDialog({
      title: t('notes.deleteConfirm'),
      message: note.body.length > 120 ? `${note.body.slice(0, 120)}…` : note.body,
      confirmLabel: t('action.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteNote(note.id);
      notes = notes.filter((n) => n.id !== note.id);
      renderList();
      toast(t('notes.deleted'));
    } catch (err) {
      toast(err.message || t('error.generic'), 'error');
    }
  };

  // Same order as the server: pinned, then open, then newest change.
  const sortNotes = () => {
    notes.sort((a, b) => (b.pinned - a.pinned) || (a.done - b.done)
      || String(b.updated_at).localeCompare(String(a.updated_at)) || b.id - a.id);
  };

  const noteItem = (note, freshId) => {
    const editing = editingId === note.id;
    const body = editing
      ? el('textarea', {
          class: 'textarea note__edit',
          rows: String(Math.min(8, Math.max(2, note.body.split('\n').length + 1))),
          maxlength: '2000',
          'aria-label': t('action.edit'),
          ref: (node) => requestAnimationFrame(() => { node.focus(); node.setSelectionRange(node.value.length, node.value.length); }),
          onkeydown: (e) => {
            if (e.key === 'Escape') { editingId = null; renderList(); }
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.currentTarget.blur(); }
          },
          onblur: (e) => {
            const text = e.currentTarget.value.trim();
            editingId = null;
            if (text && text !== note.body) update(note, { body: text });
            else renderList();
          },
        }, note.body)
      : el('button', {
          type: 'button',
          class: 'note__body',
          title: t('notes.clickToEdit'),
          onclick: () => { editingId = note.id; renderList(); },
        }, note.body);

    return el('article', {
      class: ['note', note.pinned && 'is-pinned', note.done && 'is-done', note.id === freshId && 'is-fresh'],
    },
      el('button', {
        type: 'button',
        class: ['note__tick', note.done && 'is-on'],
        'aria-pressed': String(note.done),
        'aria-label': note.done ? t('action.undo') : t('notes.markDone'),
        onclick: () => update(note, { done: !note.done }),
      }, note.done ? icon('check', { size: 12, stroke: 3 }) : null),
      el('div', { class: 'note__main' },
        body,
        el('div', { class: 'note__meta' },
          el('span', { class: 'num' }, formatDate(String(note.updated_at).slice(0, 10), { locale: state.user.locale })),
          el('span', { class: 'note__actions' },
            onUse ? el('button', {
              type: 'button', class: 'note__action', 'data-tip': t('notes.use'),
              'aria-label': t('notes.use'),
              onclick: () => { onUse(note.body); toast(t('notes.used'), 'info'); },
            }, icon('insert', { size: 14 })) : null,
            el('button', {
              type: 'button', class: ['note__action', note.pinned && 'is-on'],
              'data-tip': note.pinned ? t('notes.unpin') : t('notes.pin'),
              'aria-label': note.pinned ? t('notes.unpin') : t('notes.pin'),
              'aria-pressed': String(note.pinned),
              onclick: () => update(note, { pinned: !note.pinned }),
            }, icon('pin', { size: 14 })),
            el('button', {
              type: 'button', class: 'note__action note__action--danger',
              'data-tip': t('action.delete'), 'aria-label': t('action.delete'),
              onclick: () => remove(note),
            }, icon('trash', { size: 14 })),
          ),
        ),
      ),
    );
  };

  const renderList = (freshId = null) => {
    count.textContent = notes.length ? String(notes.filter((n) => !n.done).length) : '';
    if (!notes.length) {
      mount(listSlot, compact
        ? el('p', { class: 'notes__empty' }, t('notes.emptyShort'))
        : emptyState({ art: 'notebook', title: t('notes.empty'), text: t('notes.emptyText') }));
      return;
    }
    // Beside the journal the panel stays short: the open notes, and a link.
    const shown = compact ? notes.filter((n) => !n.done).slice(0, 12) : notes;
    mount(listSlot,
      ...shown.map((n) => noteItem(n, freshId)),
      compact && notes.length > shown.length && navigate
        ? el('button', { class: 'btn btn--ghost btn--sm notes__more', type: 'button', onclick: () => navigate('/notes') },
            t('notes.all', { count: notes.length }))
        : null,
    );
  };

  const panel = el('section', { class: ['notes', 'card', compact && 'notes--compact'] },
    el('div', { class: 'card__head' },
      el('div', { class: 'card__title' }, icon('note', { size: 16 }), ' ', t('notes.title'), ' ', count),
      compact && navigate
        ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => navigate('/notes') }, t('notes.open'))
        : null,
    ),
    el('div', { class: 'notes__composer' },
      input,
      el('div', { class: 'notes__composer-foot' },
        el('span', { class: 'subtle' }, t('notes.hint')),
        el('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: add }, icon('plus', { size: 14 }), t('notes.add')),
      ),
    ),
    listSlot,
  );

  mount(listSlot, el('div', { class: 'skeleton skeleton--row' }));
  api.notes()
    .then((res) => { notes = res.notes; renderList(); })
    .catch((err) => mount(listSlot, el('p', { class: 'notes__empty' }, err.message || t('error.loadFailed'))));

  return panel;
}

/** The notes on a page of their own. */
export function renderNotes(container, { navigate }) {
  mount(container,
    el('div', { class: 'page-head' },
      el('h1', null, t('notes.title')),
      el('p', null, t('notes.sub')),
    ),
    el('div', { class: 'notes-page' }, notesPanel({ navigate })),
  );
}
