/**
 * Server-side reminders over Web Push (TZ UI-11).
 *
 * The browser-side reminders in public/app/reminders.js only run while a tab
 * is open. This runs on the server once a minute and pushes a notification to
 * every browser a user subscribed, so a reminder arrives with the site closed.
 *
 * Both use the same notification tag (routine-<id>-<date>), so when a tab is
 * open as well the second notification replaces the first rather than
 * doubling it.
 */
import { db } from '../db/index.js';
import { isDueOn } from './schedule.js';
import { sendPush } from './webpush.js';

// A reminder whose moment was missed by a restart or a slow tick still goes
// out within this window; after it, a late reminder would only be noise.
const GRACE_MINUTES = 10;

// Notification text is rendered here, not in the browser, so the server keeps
// the few strings it needs in each of the app's languages.
const TEXT = {
  en: { soon: 'Starts at {time} — in {count} min', now: 'Starting now ({time})', test: 'Reminders are on. They will arrive even with the site closed.' },
  uz: { soon: '{time} da boshlanadi — {count} daqiqadan keyin', now: 'Hozir boshlanadi ({time})', test: 'Eslatmalar yoqildi. Ular sayt yopiq bo‘lsa ham keladi.' },
  ru: { soon: 'Начало в {time} — через {count} мин', now: 'Начинается сейчас ({time})', test: 'Напоминания включены. Они придут, даже если сайт закрыт.' },
};

export function pushText(locale, key, vars = {}) {
  const template = (TEXT[locale] || TEXT.en)[key];
  return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
}

const toMinutes = (time) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/** The calendar date and minute of the day in `timezone` at `now`. */
export function clockIn(timezone, now) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    return clockIn('UTC', now);   // an unknown zone falls back rather than stopping reminders
  }
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/**
 * Send every reminder that is due right now.
 *
 * @param {{ now?: Date, send?: Function }} options  `send` is swapped in tests
 * @returns {Promise<{ sent: number, removed: number }>}
 */
export async function runReminders({ now = new Date(), send = sendPush } = {}) {
  const users = (await db.prepare(
    `SELECT DISTINCT u.id, u.timezone, u.locale
     FROM users u JOIN push_subscriptions s ON s.user_id = u.id
     WHERE u.reminders_on = 1`,
  ).all());

  const claim = db.prepare('INSERT INTO reminders_sent (routine_id, log_date) VALUES (?, ?) ON CONFLICT DO NOTHING');
  const forget = db.prepare('DELETE FROM push_subscriptions WHERE id = ?');
  let sent = 0;
  let removed = 0;

  for (const user of users) {
    const { date, minutes } = clockIn(user.timezone, now);

    const due = (await db.prepare(
      `SELECT * FROM routines
       WHERE user_id = ? AND archived = 0 AND start_time IS NOT NULL AND reminder_min IS NOT NULL`,
    ).all(user.id)).filter((routine) => {
      if (!isDueOn(routine, date)) return false;
      const fireAt = toMinutes(routine.start_time) - routine.reminder_min;
      return fireAt >= 0 && fireAt <= minutes && minutes - fireAt < GRACE_MINUTES;
    });
    if (!due.length) continue;

    // Nothing to remind about once it is done or deliberately skipped.
    const settled = new Set((await db.prepare(
      "SELECT routine_id FROM logs WHERE user_id = ? AND log_date = ? AND status IN ('done', 'skipped')",
    ).all(user.id, date)).map((log) => log.routine_id));

    let subscriptions = (await db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(user.id));

    for (const routine of due) {
      if (settled.has(routine.id)) continue;
      // Claim before sending: if the claim fails, another tick already has it.
      if (!(await claim.run(routine.id, date)).changes) continue;

      const message = {
        title: `${routine.icon} ${routine.title}`,
        body: routine.reminder_min
          ? pushText(user.locale, 'soon', { time: routine.start_time, count: routine.reminder_min })
          : pushText(user.locale, 'now', { time: routine.start_time }),
        tag: `routine-${routine.id}-${date}`,
        url: '/today',
      };

      for (const subscription of subscriptions) {
        try {
          const result = await send(subscription, message);
          if (result.gone) {
            await forget.run(subscription.id);
            removed += 1;
            subscriptions = subscriptions.filter((s) => s.id !== subscription.id);
          } else if (result.ok) {
            sent += 1;
          }
        } catch {
          // Network trouble with one push service must not stop the others.
        }
      }
    }
  }

  (await db.prepare("DELETE FROM reminders_sent WHERE log_date < to_char((now() AT TIME ZONE 'utc')::date - 2, 'YYYY-MM-DD')").run());
  return { sent, removed };
}

/** Run once a minute, on the minute, for as long as the server runs. */
export function scheduleReminders(log = console) {
  const tick = () => runReminders().catch((err) => log.error(`  reminders failed: ${err.message}`));
  const untilNextMinute = 60_000 - (Date.now() % 60_000) + 500;
  const first = setTimeout(() => {
    tick();
    setInterval(tick, 60_000).unref();
  }, untilNextMinute);
  first.unref();
}
