import { api, auth } from './api.js';
import { setLocale } from './i18n.js';
import { disablePush } from './push.js';

/**
 * Application state.
 *
 * Deliberately minimal: a plain object plus a subscriber list. Views read
 * `state`, mutate through the exported actions, and re-render on notify.
 */
export const state = {
  user: null,
  ready: false,
  routines: [],
  selectedDate: null,
  theme: 'dark',
  summary: null,   // level / streak / today's progress, shown in the app shell
  offline: false,  // the server could not be reached at boot; the session is kept
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) fn(state);
}

/** Apply the user's theme + language to the document and to state. */
export function applyUserPreferences(user) {
  const theme = user?.theme || readStoredTheme() || 'dark';
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f6f7fb' : '#0b0d14');
  try { localStorage.setItem('rt.theme', theme); } catch { /* ignore */ }
  setLocale(user?.locale || readStoredLocale() || 'en');
}

function readStoredTheme() {
  try { return localStorage.getItem('rt.theme'); } catch { return null; }
}
function readStoredLocale() {
  try { return localStorage.getItem('rt.locale'); } catch { return null; }
}

export function setUser(user) {
  state.user = user;
  applyUserPreferences(user);
  if (user) {
    try { localStorage.setItem('rt.locale', user.locale); } catch { /* ignore */ }
  }
  notify();
}

/** Restore a session on boot. A 401 simply means "show the sign-in screen". */
export async function bootstrap() {
  try {
    const { user } = await api.me();
    state.offline = false;
    setUser(user);
  } catch (err) {
    // Only a real "not signed in" (401) ends the session. No connection used
    // to wipe the token too, so a phone that opened the app offline — which
    // the service worker now allows — would have been signed out for good.
    if (err?.status === 401) auth.token = null;
    state.offline = err?.status === 0 && Boolean(auth.token);
    state.user = null;
    applyUserPreferences(null);
  } finally {
    state.ready = true;
  }
  return state.user;
}

export async function signIn(credentials) {
  const { user, token } = await api.login(credentials);
  auth.token = token;
  setUser(user);
  return user;
}

export async function signUp(details) {
  const { user, token } = await api.register(details);
  auth.token = token;
  setUser(user);
  return user;
}

export async function signOut() {
  // Stop this browser's push reminders first, while the request is still
  // authenticated; the next person to sign in here should not get them.
  try { await disablePush(); } catch { /* best effort */ }
  try { await api.logout(); } catch { /* the local session is cleared regardless */ }
  auth.token = null;
  state.user = null;
  state.routines = [];
  notify();
}

export async function updateProfile(patch) {
  const { user } = await api.updateProfile(patch);
  setUser(user);
  return user;
}

/** Cached routine list, shared by the palette and the routine views. */
export async function loadRoutines({ force = false, all = false } = {}) {
  if (!force && state.routines.length && !all) return state.routines;
  const { routines } = await api.routines(all);
  state.routines = routines;
  return routines;
}

export function invalidateRoutines() {
  state.routines = [];
}

/**
 * Refresh the small numbers the shell shows (level, streak, remaining today).
 * Failures are silent: the shell simply keeps the last known values.
 */
export async function refreshSummary() {
  if (!state.user) return null;
  try {
    state.summary = await api.summary();
    notify();
  } catch { /* keep the previous summary */ }
  return state.summary;
}
