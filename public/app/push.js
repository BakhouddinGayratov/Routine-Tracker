import { api } from './api.js';
import { isNativeApp } from './config.js';

/**
 * Service worker registration and Web Push subscription.
 *
 * With a subscription, the server pushes reminders even when no tab is open
 * (server/lib/reminders.js). Without one — an unsupported browser, a denied
 * permission, the iOS app — the in-tab reminders in reminders.js still work
 * while the site is open.
 *
 * On iPhone, Safari only offers Web Push to a site added to the Home Screen
 * and opened from its icon (iOS 16.4+). In a normal Safari tab PushManager is
 * missing altogether, so that case is told apart ('needs-install') and the
 * user is shown how to install rather than a bare "unsupported".
 */

export function pushSupported() {
  return !isNativeApp()
    && window.isSecureContext
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && typeof Notification !== 'undefined';
}

/** Opened from a Home Screen icon rather than in a browser tab. */
export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

/** iPhone or iPad — iPadOS reports itself as a Mac, but a Mac has no touch. */
export function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function registerServiceWorker() {
  if (isNativeApp() || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then((registration) => {
      // Hand the worker everything this load fetched, so the shell is cached
      // even though the worker was not in control yet (see sw.js, 'warm').
      const urls = performance.getEntriesByType('resource').map((entry) => entry.name)
        .concat(performance.getEntriesByType('navigation').map((entry) => entry.name));
      registration.active?.postMessage({ type: 'warm', urls });
    })
    .catch(() => { /* the app works without it */ });
}

/** The active registration, or null if none shows up within a few seconds. */
async function readyRegistration() {
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 5000));
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

/**
 * The VAPID public key as the bytes pushManager.subscribe() wants. It must be
 * the 65-byte uncompressed P-256 point; Safari rejects anything else with an
 * unhelpful error, so a bad key is reported here in plain words.
 */
export function keyBytes(base64url) {
  const raw = atob(base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '='));
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error(`The server's push key is malformed (${bytes.length} bytes)`);
  }
  return bytes;
}

function sameKey(buffer, base64url) {
  if (!buffer) return false;
  const a = new Uint8Array(buffer);
  const b = keyBytes(base64url);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Subscribe this browser (or refresh its subscription) and register it with
 * the server.
 *
 * With `ask`, a permission not yet given is requested first. Call it that way
 * straight from a click, before any other await: Safari only shows the prompt
 * — and only lets subscribe() through — while the tap still counts as the
 * user's. Doing a network request first used the gesture up, which is why
 * iPhones never subscribed.
 *
 * @returns {Promise<boolean>} true when push is on for this browser; false
 *   when it cannot be (unsupported, not installed, permission refused)
 * @throws when subscribing or registering with the server fails — the message
 *   says why, so it can be shown instead of failing silently
 */
export async function enablePush({ ask = false } = {}) {
  if (!pushSupported()) return false;

  if (Notification.permission === 'default' && ask) {
    if (await Notification.requestPermission() !== 'granted') return false;
  }
  if (Notification.permission !== 'granted') return false;

  const registration = await readyRegistration();
  if (!registration) throw new Error('The service worker did not start');

  const { publicKey } = await api.pushKey();
  let subscription = await registration.pushManager.getSubscription();
  // A subscription made for a different server key can never be delivered to.
  if (subscription && !sameKey(subscription.options?.applicationServerKey, publicKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,   // required by Safari and Chrome: every push shows a notification
      applicationServerKey: keyBytes(publicKey),
    });
  }
  await api.pushSubscribe(subscription.toJSON());
  return true;
}

/** Stop pushes to this browser: tell the server, then drop the subscription. */
export async function disablePush() {
  if (!pushSupported()) return;
  const registration = await readyRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  try { await api.pushUnsubscribe(subscription.endpoint); } catch { /* signed out already, or offline */ }
  await subscription.unsubscribe().catch(() => {});
}

/** 'needs-install' | 'unsupported' | 'denied' | 'off' | 'on' — for this browser. */
export async function pushState() {
  if (isIOS() && !isStandalone() && !isNativeApp()) return 'needs-install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const registration = await readyRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? 'on' : 'off';
}
