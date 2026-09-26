/**
 * Routine Tracker service worker (TZ UI-11).
 *
 * Two jobs:
 *   1. Make the app installable and let its shell open without a network:
 *      page loads are network-first with the cached index.html as fallback;
 *      scripts, styles and icons are stale-while-revalidate, so an update
 *      arrives on the next load. API responses are never cached — they are
 *      personal and a stale answer would show the wrong day.
 *   2. Show the reminders the server pushes (server/lib/reminders.js), which
 *      is what lets them arrive while no tab is open.
 *
 * Not registered inside the iOS app: WKWebView does not run service workers
 * for the capacitor:// scheme.
 */

const CACHE = 'rt-shell-v2';   // bump when a fix must reach installed apps promptly
const SHELL = '/index.html';
const STATIC = /^\/(app|styles|assets)\/|^\/manifest\.webmanifest$/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) (await caches.open(CACHE)).put(SHELL, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(SHELL)) || Response.error();
      }
    })());
    return;
  }

  if (STATIC.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      const refresh = fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      }).catch(() => cached);
      return cached || refresh;
    })());
  }
});

// The first page load happens before this worker controls the page, so its
// scripts and styles never pass through the fetch handler above. The page
// sends the list of what it loaded (push.js) and it is cached here, so the
// app can open offline from the second visit on without a hand-kept list.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'warm' || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls
    .map((u) => new URL(u, self.location.origin))
    .filter((u) => u.origin === self.location.origin && STATIC.test(u.pathname))
    .map((u) => u.pathname);
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(
    urls.map((u) => cache.match(u).then((hit) => hit || cache.add(u).catch(() => {}))),
  )));
});

// --- Push ----------------------------------------------------------------------

self.addEventListener('push', (event) => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; } catch { message = { body: event.data?.text() }; }

  event.waitUntil(self.registration.showNotification(message.title || 'Routine Tracker', {
    body: message.body || '',
    // Same tag as the in-tab reminder, so an open tab and a push for the same
    // routine replace each other instead of doubling up.
    tag: message.tag,
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    data: { url: message.url || '/today' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/today', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      if ('navigate' in open) await open.navigate(target).catch(() => {});
      return;
    }
    await self.clients.openWindow(target);
  })());
});

// The browser may rotate a subscription on its own. Re-subscribe with the
// same server key and tell the server; the session cookie authenticates the
// request, since a service worker cannot read the page's stored token.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const key = event.oldSubscription?.options?.applicationServerKey;
    if (!key) return;
    const subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON()),
    });
  })());
});
