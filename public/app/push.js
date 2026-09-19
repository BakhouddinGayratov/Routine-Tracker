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
 * (iOS 16.4+); in a normal Safari tab pushSupported() is false.
 */

export function pushSupported() {
  return !isNativeApp()
    && window.isSecureContext
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && typeof Notification !== 'undefined';
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

function keyBytes(base64url) {
  const raw = atob(base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '='));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function sameKey(buffer, base64url) {
  if (!buffer) return false;
  const a = new Uint8Array(buffer);
  const b = keyBytes(base64url);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Subscribe this browser (or refresh its subscription) and register it with
 * the server. Needs notification permission already granted.
 *
 * @returns {Promise<boolean>} whether push is now on for this browser
 */
export async function enablePush() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const registration = await readyRegistration();
  if (!registration) return false;

  const { publicKey } = await api.pushKey();
  let subscription = await registration.pushManager.getSubscription();
  // A subscription made for a different server key can never be delivered to.
  if (subscription && !sameKey(subscription.options?.applicationServerKey, publicKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
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

/** 'unsupported' | 'denied' | 'off' | 'on' — for this browser. */
export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const registration = await readyRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? 'on' : 'off';
}
