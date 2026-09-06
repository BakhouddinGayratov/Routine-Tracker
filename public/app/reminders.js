import { api } from './api.js';
import { state } from './store.js';
import { todayISO, nowTime } from './utils.js';

/**
 * Browser reminders.
 *
 * Every minute we look at today's still-pending routines and fire a
 * notification for any whose reminder moment has just arrived. Fired reminders
 * are remembered per day in localStorage so a page refresh doesn't re-notify.
 */

let timer = null;
let cache = { date: null, items: [] };

export function notificationState() {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function startReminders() {
  stopReminders();
  if (typeof Notification === 'undefined') return;
  refresh();
  timer = setInterval(tick, 60_000);
  // Coming back to the tab after a while should re-sync before the next tick.
  document.addEventListener('visibilitychange', onVisible);
}

export function stopReminders() {
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onVisible);
}

function onVisible() {
  if (document.visibilityState === 'visible') refresh();
}

async function refresh() {
  if (!state.user?.reminders_on || Notification.permission !== 'granted') return;
  const date = todayISO();
  try {
    const day = await api.day(date);
    cache = {
      date,
      items: day.items.filter((i) => i.start_time && i.reminder_min !== null && i.status === 'pending'),
    };
    tick();
  } catch { /* a failed refresh simply means no reminders this cycle */ }
}

function tick() {
  if (!state.user?.reminders_on || Notification.permission !== 'granted') return;
  const date = todayISO();
  if (date !== cache.date) { refresh(); return; }

  const now = nowTime();
  for (const item of cache.items) {
    const fireAt = subtractMinutes(item.start_time, item.reminder_min || 0);
    if (fireAt !== now) continue;
    if (alreadyFired(date, item.id)) continue;
    markFired(date, item.id);

    try {
      new Notification(item.title, {
        body: item.reminder_min
          ? `Starts at ${item.start_time} — in ${item.reminder_min} min`
          : `Starting now (${item.start_time})`,
        tag: `routine-${item.id}-${date}`,
        icon: '/assets/icon.svg',
        badge: '/assets/icon.svg',
      });
    } catch { /* some browsers block construction outside a service worker */ }
  }
}

function subtractMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  let total = h * 60 + m - minutes;
  if (total < 0) total += 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const FIRED_KEY = 'rt.reminders';

function firedSet(date) {
  try {
    const raw = JSON.parse(localStorage.getItem(FIRED_KEY) || '{}');
    return raw.date === date ? new Set(raw.ids) : new Set();
  } catch {
    return new Set();
  }
}

function alreadyFired(date, id) {
  return firedSet(date).has(id);
}

function markFired(date, id) {
  const set = firedSet(date);
  set.add(id);
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify({ date, ids: [...set] }));
  } catch { /* ignore */ }
}
