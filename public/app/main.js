import { el, mount } from './dom.js';
import { icon } from './icons.js';
import { t, getLocale } from './i18n.js';
import { state, bootstrap, subscribe, signOut, updateProfile, refreshSummary } from './store.js';
import { toast } from './ui.js';
import { openPalette } from './palette.js';
import { startReminders, stopReminders } from './reminders.js';
import { initials, todayISO, relativeDay, formatDate } from './utils.js';
import { openRoutineForm } from './views/routine-form.js';

import { renderAuth } from './views/auth.js';
import { renderToday } from './views/today.js';
import { renderRoutines } from './views/routines.js';
import { renderRoutineDetail } from './views/routine-detail.js';
import { renderGoals } from './views/goals.js';
import { renderCalendar } from './views/calendar.js';
import { renderStats } from './views/stats.js';
import { renderJournal } from './views/journal.js';
import { renderAchievements } from './views/achievements.js';
import { renderSettings } from './views/settings.js';

const appRoot = document.getElementById('app');

/* --- Routing -------------------------------------------------------------- */

/**
 * Routes are matched in order; `:param` segments are captured. A route marked
 * `guest: true` is only for signed-out visitors, everything else requires an
 * account.
 */
const ROUTES = [
  { path: '/login', guest: true, view: (c, p) => renderAuth(c, { ...p, mode: 'login' }) },
  { path: '/register', guest: true, view: (c, p) => renderAuth(c, { ...p, mode: 'register' }) },
  { path: '/', nav: 'today', view: (c, p) => renderToday(c, p) },
  { path: '/today', nav: 'today', view: (c, p) => renderToday(c, p) },
  { path: '/day/:date', nav: 'today', view: (c, p) => renderToday(c, { ...p, date: p.params.date }) },
  { path: '/routines', nav: 'routines', view: (c, p) => renderRoutines(c, p) },
  { path: '/routine/:id', nav: 'routines', view: (c, p) => renderRoutineDetail(c, { ...p, id: p.params.id }) },
  { path: '/goals', nav: 'goals', view: (c, p) => renderGoals(c, p) },
  { path: '/calendar', nav: 'calendar', view: (c, p) => renderCalendar(c, p) },
  { path: '/stats', nav: 'stats', view: (c, p) => renderStats(c, p) },
  { path: '/journal', nav: 'journal', view: (c, p) => renderJournal(c, p) },
  { path: '/journal/:date', nav: 'journal', view: (c, p) => renderJournal(c, { ...p, date: p.params.date }) },
  { path: '/achievements', nav: 'achievements', view: (c, p) => renderAchievements(c, p) },
  { path: '/settings', nav: 'settings', view: (c, p) => renderSettings(c, p) },
];

function matchRoute(pathname) {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  for (const route of ROUTES) {
    const routeParts = route.path.split('/').filter(Boolean);
    if (routeParts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < routeParts.length; i += 1) {
      if (routeParts[i].startsWith(':')) params[routeParts[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (routeParts[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

function navigate(path, { replace = false } = {}) {
  if (path === location.pathname) { render(); return; }
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  render();
}

window.addEventListener('popstate', () => render());

/* --- Shell ---------------------------------------------------------------- */

const NAV_ITEMS = [
  { key: 'today', path: '/today', icon: 'today', label: () => t('nav.today'), group: 'plan' },
  { key: 'routines', path: '/routines', icon: 'routines', label: () => t('nav.routines'), group: 'plan' },
  { key: 'goals', path: '/goals', icon: 'target', label: () => t('nav.goals'), group: 'plan' },
  { key: 'calendar', path: '/calendar', icon: 'calendar', label: () => t('nav.calendar'), group: 'plan' },
  { key: 'stats', path: '/stats', icon: 'stats', label: () => t('nav.stats'), group: 'insight' },
  { key: 'journal', path: '/journal', icon: 'journal', label: () => t('nav.journal'), group: 'insight' },
  { key: 'achievements', path: '/achievements', icon: 'trophy', label: () => t('nav.achievements'), group: 'insight' },
];

// The sidebar is hidden on a phone, so anything missing from here is
// unreachable there.
const TAB_ITEMS = ['today', 'routines', 'goals', 'calendar', 'stats', 'settings'];

function shell(activeNav, content) {
  return el('div', { class: 'shell' },
    sidebar(activeNav),
    el('div', { class: 'main' },
      header(activeNav),
      el('main', { class: 'content', id: 'view' }, content),
    ),
    tabbar(activeNav),
  );
}

function sidebar(activeNav) {
  const groups = [
    { key: 'plan', label: t('nav.plan') },
    { key: 'insight', label: t('nav.insight') },
  ];

  return el('aside', { class: 'sidebar' },
    el('a', {
      class: 'brand', href: '/today',
      onclick: (e) => { e.preventDefault(); navigate('/today'); },
    },
      el('div', { class: 'brand__logo' }, icon('check', { size: 18, stroke: 3 })),
      el('div', { class: 'brand__text' },
        el('div', { class: 'brand__name' }, t('app.name')),
        el('div', { class: 'brand__tag' }, t('app.tagline')),
      ),
    ),

    el('nav', { class: 'nav' },
      ...groups.flatMap((group) => [
        el('div', { class: 'nav__label' }, group.label),
        ...NAV_ITEMS.filter((item) => item.group === group.key).map((item) => navLink(item, activeNav)),
      ]),
    ),

    el('div', { class: 'sidebar__foot' },
      levelCard(),

      el('a', {
        class: ['nav__item', activeNav === 'settings' && 'is-active'],
        href: '/settings',
        onclick: (e) => { e.preventDefault(); navigate('/settings'); },
      }, icon('settings', { size: 18 }), el('span', null, t('nav.settings'))),

      el('button', {
        class: 'user-chip',
        onclick: () => navigate('/settings'),
        'aria-label': state.user.name,
      },
        el('span', { class: 'avatar', style: { background: state.user.avatar_color } }, initials(state.user.name)),
        el('span', { class: 'user-chip__meta truncate' },
          el('span', { class: 'user-chip__name truncate' }, state.user.name),
          el('span', { class: 'user-chip__mail truncate' }, state.user.email),
        ),
      ),
    ),
  );
}

function navLink(item, activeNav) {
  // The Today entry doubles as a to-do count, so the sidebar answers
  // "is there anything left?" without navigating.
  const pending = item.key === 'today' ? state.summary?.today?.pending : 0;

  return el('a', {
    class: ['nav__item', activeNav === item.key && 'is-active'],
    href: item.path,
    onclick: (e) => { e.preventDefault(); navigate(item.path); },
  },
    icon(item.icon, { size: 18 }),
    el('span', null, item.label()),
    pending ? el('span', { class: 'nav__badge' }, String(pending)) : null,
  );
}

function levelCard() {
  const summary = state.summary;
  if (!summary) return null;

  return el('button', {
    class: 'level-card',
    style: { 'text-align': 'left', width: '100%' },
    onclick: () => navigate('/achievements'),
  },
    el('div', { class: 'level-card__top' },
      el('span', { class: 'level-card__level' }, t('sidebar.level', { level: summary.xp.level })),
      summary.streak.current
        ? el('span', { class: 'level-card__xp' }, `🔥 ${summary.streak.current}`)
        : null,
    ),
    el('div', { class: 'bar bar--sm', style: { margin: 'var(--s-2) 0 var(--s-1)' } },
      el('div', { class: 'bar__fill', style: { width: `${summary.xp.progress}%` } }),
    ),
    el('div', { class: 'level-card__xp' }, `${summary.xp.xp} XP`),
  );
}

function tabbar(activeNav) {
  const items = TAB_ITEMS.map((key) =>
    NAV_ITEMS.find((n) => n.key === key)
    || { key: 'settings', path: '/settings', icon: 'settings', label: () => t('nav.settings') });

  return el('nav', { class: 'tabbar' },
    ...items.map((item) => el('a', {
      class: ['tabbar__item', activeNav === item.key && 'is-active'],
      href: item.path,
      onclick: (e) => { e.preventDefault(); navigate(item.path); },
    }, icon(item.icon, { size: 20 }), el('span', null, item.label()))),
  );
}

function header(activeNav) {
  const titles = {
    today: t('nav.today'),
    routines: t('nav.routines'),
    goals: t('nav.goals'),
    calendar: t('nav.calendar'),
    stats: t('nav.stats'),
    journal: t('nav.journal'),
    achievements: t('nav.achievements'),
    settings: t('nav.settings'),
  };

  const subtitle = activeNav === 'today'
    ? formatDate(currentDate(), { long: true, locale: getLocale() })
    : null;

  return el('header', { class: 'header' },
    el('div', null,
      el('div', { class: 'header__title' }, titles[activeNav] || t('app.name')),
      subtitle ? el('div', { class: 'header__sub' }, subtitle) : null,
    ),

    el('div', { class: 'header__actions' },
      el('button', {
        class: 'search-trigger',
        onclick: () => openPalette({ navigate, actions: paletteActions() }),
        'aria-label': t('action.search'),
      },
        icon('search', { size: 15 }),
        el('span', { class: 'grow', style: { 'text-align': 'left' } }, t('action.search')),
        el('kbd', null, isMac() ? '⌘K' : 'Ctrl K'),
      ),

      el('button', {
        class: 'btn btn--icon',
        'data-tip': state.theme === 'dark' ? t('settings.themeLight') : t('settings.themeDark'),
        'aria-label': t('settings.theme'),
        onclick: toggleTheme,
      }, icon(state.theme === 'dark' ? 'sun' : 'moon', { size: 17 })),

      el('button', {
        class: 'btn btn--primary btn--sm',
        onclick: () => openRoutineForm(null, {
          weekStart: state.user.week_start,
          onSaved: () => render(),
        }),
      }, icon('plus', { size: 15 }), el('span', { class: 'grow' }, t('action.add'))),
    ),
  );
}

function paletteActions() {
  return [
    {
      label: t('action.add'),
      icon: 'plus',
      hint: 'N',
      run: () => openRoutineForm(null, { weekStart: state.user.week_start, onSaved: () => render() }),
    },
    { label: t('settings.theme'), icon: 'moon', run: toggleTheme },
    { label: t('action.export'), icon: 'download', run: () => { window.location.href = '/api/export'; } },
    {
      label: t('action.signOut'),
      icon: 'logout',
      run: async () => { await signOut(); navigate('/login'); toast(t('toast.signedOut')); },
    },
  ];
}

async function toggleTheme() {
  const next = state.theme === 'dark' ? 'light' : 'dark';
  try {
    await updateProfile({ theme: next });
  } catch {
    // Offline or a failed request still gets a local theme switch.
    state.theme = next;
    document.documentElement.dataset.theme = next;
    render();
  }
}

function currentDate() {
  const match = matchRoute(location.pathname);
  return match?.params?.date || todayISO();
}

function isMac() {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/* --- Render --------------------------------------------------------------- */

let currentPath = null;

function render() {
  const path = location.pathname;
  const match = matchRoute(path);

  // Signed out: only the guest routes are reachable.
  if (!state.user) {
    const guestRoute = match?.route?.guest ? match.route : ROUTES[0];
    if (!match?.route?.guest && path !== '/login' && path !== '/register') {
      history.replaceState({}, '', '/login');
    }
    stopReminders();
    guestRoute.view(appRoot, { navigate, params: match?.params || {} });
    currentPath = location.pathname;
    return;
  }

  // Signed in: bounce away from the auth screens.
  if (match?.route?.guest) { navigate('/today', { replace: true }); return; }

  if (!match) {
    mount(appRoot, shell(null, notFound()));
    return;
  }

  const view = el('div');
  mount(appRoot, shell(match.route.nav, view));
  match.route.view(view, { navigate, params: match.params });
  currentPath = path;
  scheduleSummaryRefresh();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

// The shell's numbers are cheap but not free; refresh them at most every few
// seconds as the user navigates.
let lastSummaryAt = 0;
function scheduleSummaryRefresh(force = false) {
  const now = Date.now();
  if (!force && now - lastSummaryAt < 5000) return;
  lastSummaryAt = now;
  refreshSummary();
}

function notFound() {
  return el('div', { class: 'card' },
    el('div', { class: 'empty' },
      el('div', { class: 'empty__art' }, '🧭'),
      el('div', { class: 'empty__title' }, t('error.notFound')),
      el('p', { class: 'empty__text' }, t('error.notFoundText')),
      el('button', { class: 'btn btn--primary', onclick: () => navigate('/today') }, t('nav.today')),
    ),
  );
}

/* --- Keyboard shortcuts --------------------------------------------------- */

document.addEventListener('keydown', (event) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (state.user) openPalette({ navigate, actions: paletteActions() });
    return;
  }
  if (typing || event.metaKey || event.ctrlKey || event.altKey || !state.user) return;

  const shortcuts = {
    n: () => openRoutineForm(null, { weekStart: state.user.week_start, onSaved: () => render() }),
    t: () => navigate('/today'),
    r: () => navigate('/routines'),
    g: () => navigate('/goals'),
    c: () => navigate('/calendar'),
    s: () => navigate('/stats'),
    j: () => navigate('/journal'),
    a: () => navigate('/achievements'),
    '?': () => openPalette({ navigate, actions: paletteActions() }),
  };
  const action = shortcuts[event.key.toLowerCase()];
  if (action) { event.preventDefault(); action(); }
});

/* --- Boot ----------------------------------------------------------------- */

// Language and theme live in the shell (nav labels, header, tab bar), so a
// change to either has to re-render the whole app, not just the current view.
let lastLocale = null;
let lastTheme = null;

subscribe(() => {
  if (state.user?.reminders_on) startReminders();
  else stopReminders();

  const locale = state.user?.locale ?? null;
  const theme = state.theme;
  const changed = lastLocale !== null && (locale !== lastLocale || theme !== lastTheme);
  lastLocale = locale;
  lastTheme = theme;
  if (changed && state.user) { render(); return; }
  paintSummary();
});

/** Update just the sidebar's live numbers, leaving the current view untouched. */
function paintSummary() {
  const sidebarEl = document.querySelector('.sidebar');
  if (!sidebarEl || !state.user) return;

  const foot = sidebarEl.querySelector('.sidebar__foot');
  const existingCard = foot?.querySelector('.level-card');
  const card = levelCard();
  if (foot && card) {
    if (existingCard) existingCard.replaceWith(card);
    else foot.prepend(card);
  }

  const todayLink = sidebarEl.querySelector('.nav__item[href="/today"]');
  if (todayLink) {
    const pending = state.summary?.today?.pending || 0;
    const badge = todayLink.querySelector('.nav__badge');
    if (pending && badge) badge.textContent = String(pending);
    else if (pending) todayLink.appendChild(el('span', { class: 'nav__badge' }, String(pending)));
    else badge?.remove();
  }
}

(async function boot() {
  await bootstrap();
  render();

  const splash = document.getElementById('boot');
  splash?.classList.add('is-done');
  setTimeout(() => splash?.remove(), 600);

  if (state.user?.reminders_on) startReminders();
  if (state.user) refreshSummary();
})();
