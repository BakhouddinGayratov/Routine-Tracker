import express from 'express';
import { db } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../middleware/error.js';
import { vapidKeys, isAllowedEndpoint, sendPush, pushServiceOf, vapidSubjectProblem } from '../lib/webpush.js';
import { pushText } from '../lib/reminders.js';

export const pushRouter = express.Router();

// A person has a few browsers, not dozens; the cap stops one account from
// filling the table with junk endpoints.
const MAX_SUBSCRIPTIONS = 10;

/** Validate a PushSubscription as the browser serialises it (toJSON()). */
function readSubscription(body) {
  const endpoint = String(body?.endpoint || '');
  const p256dh = String(body?.keys?.p256dh || '');
  const auth = String(body?.keys?.auth || '');
  const fields = {};

  if (endpoint.length > 2048 || !isAllowedEndpoint(endpoint)) {
    fields.endpoint = 'Must be an https URL on a known push service';
  }
  // p256dh is an uncompressed P-256 point (65 bytes, starting 0x04); auth is
  // a 16-byte secret. Anything else cannot be encrypted to.
  const point = Buffer.from(p256dh, 'base64url');
  if (point.length !== 65 || point[0] !== 0x04) fields.p256dh = 'Invalid public key';
  if (Buffer.from(auth, 'base64url').length !== 16) fields.auth = 'Invalid auth secret';

  if (Object.keys(fields).length) throw ApiError.badRequest('Invalid push subscription', fields);
  return { endpoint, p256dh, auth };
}

/** The server's public VAPID key, which the browser needs to subscribe. */
pushRouter.get('/key', (_req, res) => {
  res.json({ publicKey: vapidKeys().publicKey });
});

pushRouter.post('/subscribe', asyncHandler(async (req, res) => {
  const subscription = readSubscription(req.body);

  (await db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES (@user_id, @endpoint, @p256dh, @auth, @user_agent)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = excluded.user_id, p256dh = excluded.p256dh,
       auth = excluded.auth, user_agent = excluded.user_agent`,
  ).run({ ...subscription, user_id: req.user.id, user_agent: String(req.get('user-agent') || '').slice(0, 300) }));

  // Over the cap, the oldest browsers go first.
  (await db.prepare(
    `DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN (
       SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT ?
     )`,
  ).run(req.user.id, req.user.id, MAX_SUBSCRIPTIONS));

  res.status(201).json({ ok: true });
}));

pushRouter.delete('/subscribe', asyncHandler(async (req, res) => {
  const endpoint = String(req.body?.endpoint || '');
  if (!endpoint) throw ApiError.badRequest('Send the endpoint to remove');
  const result = (await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
    .run(endpoint, req.user.id));
  res.json({ ok: true, removed: result.changes });
}));

/**
 * Push a test notification to every browser of this account and report, per
 * browser, what its push service answered. The status and reason are the
 * point: "403 BadJwtToken" from Apple names the fix, "failed" does not.
 */
async function sendTestPush(user, send = sendPush) {
  const subscriptions = (await db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY id').all(user.id));
  const message = { title: 'Routine Tracker', body: pushText(user.locale, 'test'), tag: 'rt-test', url: '/settings' };
  const results = [];

  for (const subscription of subscriptions) {
    const row = { id: subscription.id, service: pushServiceOf(subscription.endpoint), created_at: subscription.created_at };
    try {
      const result = await send(subscription, message);
      if (result.gone) await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(subscription.id);
      results.push({ ...row, ok: result.ok, status: result.status, reason: result.reason || '', removed: result.gone });
    } catch (err) {
      results.push({ ...row, ok: false, status: 0, reason: err.message, removed: false });
    }
  }

  const sent = results.filter((r) => r.ok).length;
  return { ok: sent > 0, sent, total: subscriptions.length, results };
}

/** Send a test notification to every browser of this account. */
pushRouter.post('/test', asyncHandler(async (req, res) => {
  const count = (await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(req.user.id)).n;
  if (!count) throw ApiError.badRequest('No browser is subscribed to notifications yet');
  res.json(await sendTestPush(req.user));
}));

/**
 * One-stop diagnosis, meant to be opened straight in the browser while signed
 * in: is the server configured, is any device of this account subscribed —
 * an iPhone shows up as service "apple" (web.push.apple.com) — and what do the
 * push services say to a test right now. It sends a real notification, which
 * is the only honest test; that is also why it answers only the signed-in user
 * about their own devices.
 */
export const notificationsRouter = express.Router();

notificationsRouter.get('/test-push', asyncHandler(async (req, res) => {
  const report = await sendTestPush(req.user);
  const subjectProblem = vapidSubjectProblem();
  const apple = report.results.filter((r) => r.service === 'apple');

  let advice = 'Push works: check the device for the test notification.';
  if (subjectProblem) advice = subjectProblem;
  else if (!report.total) advice = 'No device is subscribed. On iPhone: open the app from its Home Screen icon → Settings → Reminders → "Turn on for this device".';
  else if (!report.ok) advice = 'Every push service refused the test; see results[].status and reason.';

  res.set('Cache-Control', 'no-store').json({
    vapid: { publicKey: vapidKeys().publicKey, subject: process.env.VAPID_SUBJECT || null, subjectOk: !subjectProblem },
    subscriptions: report.total,
    appleSubscriptions: apple.length,
    sent: report.sent,
    results: report.results,
    advice,
  });
}));
