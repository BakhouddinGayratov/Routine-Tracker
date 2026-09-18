import { el, mount } from './dom.js';
import { icon } from './icons.js';
import { t, getLocale } from './i18n.js';
import { state, bootstrap, subscribe, signOut, updateProfile, refreshSummary } from './store.js';
import { toast } from './ui.js';
import { api } from './api.js';
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

// The sidebar is hidden on a phone. Five tabs is what fits across a 375px
// screen; everything else a phone needs lives in the header's account menu
// (ACCOUNT_ITEMS), so no screen becomes unreachable.
const TAB_ITEMS = ['today', 'routines', 'goals', 'calendar', 'stats'];
const ACCOUNT_ITEMS = [
  { key: 'journal', path: '/journal', icon: 'journal', label: () => t('nav.journal') },
  { key: 'achievements', path: '/achievements', icon: 'trophy', label: () => t('nav.achievements') },
  { key: 'settings', path: '/settings', icon: 'settings', label: () => t('nav.settings') },
];

/* --- Sidebar collapse ----------------------------------------------------- */

// The sidebar collapses to icons on mid-size screens by default. Once the user
// picks a state with the toggle, that choice wins at every width, and is kept
// per browser — it is a viewing preference, not account data.
const SIDEBAR_KEY = 'rt.sidebar';
const narrowScreen = window.matchMedia('(max-width: 1080px)');

function sidebarPreference() {
  try { return localStorage.getItem(SIDEBAR_KEY); } catch { return null; }
}

function isSidebarCollapsed() {
  const preference = sidebarPreference();
  return preference ? preference === 'collapsed' : narrowScreen.matches;
}

function applySidebarState() {
  const collapsed = isSidebarCollapsed();
  document.querySelector('.shell')?.classList.toggle('is-collapsed', collapsed);
  const toggle = document.querySelector('.sidebar__toggle');
  if (!toggle) return;
  const label = collapsed ? t('nav.expand') : t('nav.collapse');
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.setAttribute('aria-label', label);
  toggle.dataset.tip = label;
  toggle.replaceChildren(icon(collapsed ? 'chevronRight' : 'chevronLeft', { size: 18 }), el('span', null, label));
}

function toggleSidebar() {
  try { localStorage.setItem(SIDEBAR_KEY, isSidebarCollapsed() ? 'expanded' : 'collapsed'); } catch { /* ignore */ }
  applySidebarState();
}

narrowScreen.addEventListener('change', applySidebarState);

function shell(activeNav, content) {
  return el('div', { class: ['shell', isSidebarCollapsed() && 'is-collapsed'] },
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
        'data-tip': t('nav.settings'),
        onclick: (e) => { e.preventDefault(); navigate('/settings'); },
      }, icon('settings', { size: 18 }), el('span', null, t('nav.settings'))),

      sidebarToggle(),

      el('button', {
        class: 'user-chip',
        onclick: () => navigate('/settings'),
        'aria-label': state.user.name,
        'data-tip': state.user.name,
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

  // The tooltip only shows while the sidebar is collapsed (see layout.css);
  // expanded, the label is already on screen.
  return el('a', {
    class: ['nav__item', activeNav === item.key && 'is-active'],
    href: item.path,
    'data-tip': item.label(),
    onclick: (e) => { e.preventDefault(); navigate(item.path); },
  },
    icon(item.icon, { size: 18 }),
    el('span', null, item.label()),
    pending ? el('span', { class: 'nav__badge' }, String(pending)) : null,
  );
}

function sidebarToggle() {
  const collapsed = isSidebarCollapsed();
  const label = collapsed ? t('nav.expand') : t('nav.collapse');
  return el('button', {
    class: 'nav__item sidebar__toggle',
    type: 'button',
    'aria-expanded': String(!collapsed),
    'aria-label': label,
    'data-tip': label,
    onclick: toggleSidebar,
  }, icon(collapsed ? 'chevronRight' : 'chevronLeft', { size: 18 }), el('span', null, label));
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
  const items = TAB_ITEMS.map((key) => NAV_ITEMS.find((n) => n.key === key));

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
    el('div', { class: 'header__text' },
      el('div', { class: 'header__title truncate' }, titles[activeNav] || t('app.name')),
      subtitle ? el('div', { class: 'header__sub truncate' }, subtitle) : null,
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
          date: currentDate(),
          onSaved: () => render(),
        }),
      }, icon('plus', { size: 15 }), el('span', { class: 'grow' }, t('action.add'))),

      accountMenu(activeNav),
    ),
  );
}

/**
 * The avatar in the header, shown on phones only (the sidebar carries the same
 * links on wider screens). It holds the screens that do not fit in the five
 * tabs, plus sign-out.
 */
function accountMenu(activeNav) {
  const menu = el('div', { class: 'account-menu__list hidden', role: 'menu', id: 'account-menu' },
    el('div', { class: 'account-menu__who' },
      el('div', { class: 'truncate', style: { 'font-weight': '600' } }, state.user.name),
      el('div', { class: 'truncate subtle', style: { 'font-size': 'var(--text-xs)' } }, state.user.email),
    ),
    ...ACCOUNT_ITEMS.map((item) => el('a', {
      class: ['account-menu__item', activeNav === item.key && 'is-active'],
      href: item.path,
      role: 'menuitem',
      onclick: (e) => { e.preventDefault(); close(); navigate(item.path); },
    }, icon(item.icon, { size: 17 }), el('span', null, item.label()))),
    el('button', {
      class: 'account-menu__item',
      type: 'button',
      role: 'menuitem',
      onclick: async () => { close(); await signOut(); navigate('/login'); toast(t('toast.signedOut')); },
    }, icon('logout', { size: 17 }), el('span', null, t('action.signOut'))),
  );

  const button = el('button', {
    class: 'account-menu__button',
    type: 'button',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'aria-controls': 'account-menu',
    'aria-label': t('nav.account'),
    onclick: () => (menu.classList.contains('hidden') ? open() : close()),
  }, el('span', { class: 'avatar', style: { background: state.user.avatar_color } }, initials(state.user.name)));

  const wrap = el('div', { class: 'account-menu' }, button, menu);

  // Close on a click anywhere else or on Escape, and stop listening once the
  // menu is shut so a closed menu costs nothing.
  const onOutside = (e) => { if (!wrap.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { close(); button.focus(); } };
  function open() {
    menu.classList.remove('hidden');
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey);
    menu.querySelector('.account-menu__item')?.focus();
  }
  function close() {
    menu.classList.add('hidden');
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('keydown', onKey);
  }

  return wrap;
}

function paletteActions() {
  return [
    {
      label: t('action.add'),
      icon: 'plus',
      hint: 'N',
      run: () => openRoutineForm(null, { weekStart: state.user.week_start, date: currentDate(), onSaved: () => render() }),
    },
    { label: t('settings.theme'), icon: 'moon', run: toggleTheme },
    {
      label: t('action.export'),
      icon: 'download',
      run: () => api.downloadExport('json').catch((err) => toast(err.message, 'error')),
    },
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
    n: () => openRoutineForm(null, { weekStart: state.user.week_start, date: currentDate(), onSaved: () => render() }),
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
