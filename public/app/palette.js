import { el, mount } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { api } from './api.js';
import { debounce } from './utils.js';

/**
 * Command palette (Ctrl/Cmd-K).
 *
 * Combines static navigation and actions with a live search over the user's
 * routines and journal, driven entirely from the keyboard.
 */
let open = false;

export function openPalette({ navigate, actions = [] }) {
  if (open) return;
  open = true;

  const root = document.getElementById('modal-root');
  const previouslyFocused = document.activeElement;

  const pages = [
    { label: t('nav.today'), icon: 'today', run: () => navigate('/today') },
    { label: t('nav.routines'), icon: 'routines', run: () => navigate('/routines') },
    { label: t('nav.calendar'), icon: 'calendar', run: () => navigate('/calendar') },
    { label: t('nav.stats'), icon: 'stats', run: () => navigate('/stats') },
    { label: t('nav.journal'), icon: 'journal', run: () => navigate('/journal') },
    { label: t('nav.achievements'), icon: 'trophy', run: () => navigate('/achievements') },
    { label: t('nav.settings'), icon: 'settings', run: () => navigate('/settings') },
  ];

  let items = [];
  let cursor = 0;
  let controller = null;

  const list = el('div', { class: 'palette__list' });

  const input = el('input', {
    class: 'palette__input',
    type: 'text',
    placeholder: t('palette.placeholder'),
    'aria-label': t('action.search'),
    autocomplete: 'off',
    spellcheck: 'false',
  });

  const close = () => {
    if (!open) return;
    open = false;
    controller?.abort();
    document.removeEventListener('keydown', onKey, true);
    document.body.style.removeProperty('overflow');
    mount(root);
    previouslyFocused?.focus?.();
  };

  const run = (item) => { close(); item.run(); };

  const renderList = (groups) => {
    items = groups.flatMap((g) => g.items);
    cursor = 0;
    if (!items.length) {
      mount(list, el('div', { class: 'palette__empty' }, t('palette.empty')));
      return;
    }
    mount(list, ...groups.flatMap((group) => (group.items.length ? [
      el('div', { class: 'palette__group' }, group.label),
      ...group.items.map((item, i) => el('button', {
        class: ['palette__item', items.indexOf(item) === cursor && 'is-active'],
        type: 'button',
        dataset: { index: String(items.indexOf(item)) },
        onclick: () => run(item),
        onmouseenter: () => { cursor = items.indexOf(item); highlight(); },
      },
        item.emoji ? el('span', null, item.emoji) : icon(item.icon || 'chevronRight', { size: 15 }),
        el('span', { class: 'grow truncate' }, item.label),
        item.hint ? el('kbd', null, item.hint) : null,
      )),
    ] : [])));
  };

  const highlight = () => {
    for (const node of list.querySelectorAll('.palette__item')) {
      node.classList.toggle('is-active', Number(node.dataset.index) === cursor);
    }
    list.querySelector('.palette__item.is-active')?.scrollIntoView({ block: 'nearest' });
  };

  const defaultGroups = () => [
    { label: t('palette.pages'), items: pages },
    { label: t('palette.actions'), items: actions },
  ];

  const search = debounce(async (query) => {
    if (query.trim().length < 2) { renderList(defaultGroups()); return; }
    controller?.abort();
    controller = new AbortController();
    try {
      const result = await api.search(query.trim(), { signal: controller.signal });
      const lower = query.toLowerCase();
      renderList([
        {
          label: t('palette.routines'),
          items: result.routines.map((r) => ({
            label: r.title,
            emoji: r.icon,
            run: () => navigate(`/routine/${r.id}`),
          })),
        },
        {
          label: t('palette.journal'),
          items: result.journal.map((j) => ({
            label: `${j.entry_date} — ${j.excerpt}`,
            icon: 'journal',
            run: () => navigate(`/journal/${j.entry_date}`),
          })),
        },
        {
          label: t('palette.pages'),
          items: [...pages, ...actions].filter((p) => p.label.toLowerCase().includes(lower)),
        },
      ]);
    } catch (err) {
      if (err.name !== 'AbortError') renderList(defaultGroups());
    }
  }, 180);

  const onKey = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      cursor = (cursor + 1) % Math.max(1, items.length);
      highlight();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      cursor = (cursor - 1 + items.length) % Math.max(1, items.length);
      highlight();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (items[cursor]) run(items[cursor]);
    }
  };

  input.addEventListener('input', () => search(input.value));

  const panel = el('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true' }, input, list);
  const backdrop = el('div', {
    class: 'palette-backdrop',
    onmousedown: (event) => { if (event.target === backdrop) close(); },
  }, panel);

  mount(root, backdrop);
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKey, true);
  renderList(defaultGroups());
  requestAnimationFrame(() => input.focus());
}
