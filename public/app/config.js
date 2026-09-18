/**
 * Where the API lives.
 *
 * On the web the page is served by the API server itself, so every request
 * goes to the same origin and no configuration is needed.
 *
 * Inside the iOS app (Capacitor) the page is loaded from capacitor://localhost,
 * which has no API behind it, so requests need the server's absolute URL.
 * It is resolved in this order:
 *
 *   1. the server address the user saved on the sign-in screen (per device),
 *   2. DEFAULT_NATIVE_API_URL below — set it once before `npx cap sync` so a
 *      build ships pointed at your server (see IOS_BUILD.md),
 *   3. nothing: the sign-in screen then asks for the address.
 *
 * The web app ignores both, so a stray value can never redirect a browser's
 * requests (and its token) to another host.
 */
export const DEFAULT_NATIVE_API_URL = '';

const STORAGE_KEY = 'rt.apiUrl';

/** True inside the Capacitor shell; its native bridge defines window.Capacitor. */
export function isNativeApp() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

export function savedApiUrl() {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}

/** Prefix for every API call: '' on the web, the server's origin in the app. */
export function apiBase() {
  if (!isNativeApp()) return '';
  return savedApiUrl() || DEFAULT_NATIVE_API_URL;
}

/**
 * Validate and store the server address. HTTPS is required — the token
 * travels in every request. Plain http is allowed only for a development
 * server on this machine (the iOS simulator's localhost) or a .local name;
 * index.html's CSP and the app's ATS setting allow exactly the same set.
 *
 * @returns {string} the normalised origin that was saved
 * @throws {Error} with `code` 'invalid' or 'insecure'
 */
export function saveApiUrl(input) {
  const value = String(input || '').trim();
  if (!value) {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return '';
  }

  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('invalid'), { code: 'invalid' }); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw Object.assign(new Error('invalid'), { code: 'invalid' });
  }
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) {
    throw Object.assign(new Error('insecure'), { code: 'insecure' });
  }

  // Only the origin is kept: the client adds /api/... itself, and a path or
  // query here would silently produce wrong URLs.
  const origin = url.origin;
  try { localStorage.setItem(STORAGE_KEY, origin); } catch { /* ignore */ }
  return origin;
}

function isLocalHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
}
