import express from 'express';
import { db } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../middleware/error.js';
import { vapidKeys, isAllowedEndpoint, sendPush } from '../lib/webpush.js';
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

/** Send a test notification to every browser of this account. */
pushRouter.post('/test', asyncHandler(async (req, res) => {
  const subscriptions = (await db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(req.user.id));
  if (!subscriptions.length) throw ApiError.badRequest('No browser is subscribed to notifications yet');

  const message = { title: 'Routine Tracker', body: pushText(req.user.locale, 'test'), tag: 'rt-test', url: '/settings' };
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      const result = await sendPush(subscription, message);
      if (result.gone) (await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(subscription.id));
      else if (result.ok) sent += 1;
    } catch { /* reported through the count below */ }
  }
  res.json({ ok: sent > 0, sent, total: subscriptions.length });
}));
