/**
 * End-to-end API test.
 *
 * Boots the real server against a throwaway SQLite file and drives it over
 * HTTP, so routing, validation, auth and SQL are all exercised together.
 *
 *   node tests/api.test.js
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

process.env.NODE_ENV = 'test';
// PGlite (in-memory PostgreSQL) unless a test database is named explicitly.
//
// It is set to an empty string rather than deleted: config.js reads .env for
// any variable that is *undefined*, so deleting this one let a developer's
// real DATABASE_URL back in — and the suite, which creates and deletes
// accounts, then ran against the live database. An empty value is defined,
// so .env cannot override it.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
process.env.PORT = '4310';
process.env.JWT_SECRET = 'test-secret-not-used-in-production';

const { app } = await import('../server/index.js');
const { db } = await import('../server/db/index.js');
const base = 'http://localhost:4310';

let passed = 0;
let failed = 0;
let token = null;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${err.message}`);
  }
}

async function api(method, url, body, opts = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && !opts.noAuth ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const dayAfter = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const email = `test${Date.now()}@example.com`;
let routineId = null;

console.log('\nRoutine Tracker — API tests\n');

await test('health check responds', async () => {
  const r = await api('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

await test('protected routes reject anonymous callers', async () => {
  const r = await api('GET', '/api/routines', undefined, { noAuth: true });
  assert.equal(r.status, 401);
});

await test('registration rejects a weak password', async () => {
  const r = await api('POST', '/api/auth/register', { name: 'Test', email: `weak${Date.now()}@x.com`, password: 'short' });
  assert.equal(r.status, 400);
  assert.ok(r.body.error.fields.password);
});

await test('registration rejects a malformed email', async () => {
  const r = await api('POST', '/api/auth/register', { name: 'Test', email: 'not-an-email', password: 'goodpass123' });
  assert.equal(r.status, 400);
});

await test('a user can register', async () => {
  const r = await api('POST', '/api/auth/register', { name: 'Test User', email, password: 'goodpass123', timezone: 'UTC' });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.email, email);
  assert.ok(!('password_hash' in r.body.user), 'password hash must never be returned');
  token = r.body.token;
});

await test('duplicate emails are rejected', async () => {
  const r = await api('POST', '/api/auth/register', { name: 'Other', email, password: 'goodpass123' });
  assert.equal(r.status, 409);
});

await test('a new account gets starter routines', async () => {
  const r = await api('GET', '/api/routines');
  assert.equal(r.status, 200);
  assert.ok(r.body.routines.length >= 5);
});

await test('sign in with the wrong password fails', async () => {
  const r = await api('POST', '/api/auth/login', { email, password: 'wrongpass123' }, { noAuth: true });
  assert.equal(r.status, 401);
});

await test('sign in with the right password succeeds', async () => {
  const r = await api('POST', '/api/auth/login', { email, password: 'goodpass123' }, { noAuth: true });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
  token = r.body.token;
});

await test('a routine can be created', async () => {
  const r = await api('POST', '/api/routines', {
    title: 'Morning run', icon: '🏃', color: '#22c55e', category: 'fitness',
    priority: 'high', start_time: '07:00', duration_min: 30,
    repeat_type: 'daily', start_date: yesterday,
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.routine.title, 'Morning run');
  routineId = r.body.routine.id;
});

await test('an invalid time is rejected', async () => {
  const r = await api('POST', '/api/routines', { title: 'Bad', start_time: '25:99', start_date: today });
  assert.equal(r.status, 400);
  assert.ok(r.body.error.fields.start_time);
});

await test('an end date before the start date is rejected', async () => {
  const r = await api('POST', '/api/routines', { title: 'Bad range', start_date: today, end_date: yesterday });
  assert.equal(r.status, 400);
});

await test('a quantity routine requires a unit', async () => {
  const r = await api('POST', '/api/routines', { title: 'Water', start_date: today, goal_type: 'quantity', target_value: 8 });
  assert.equal(r.status, 400);
});

await test('the day view lists routines that are due', async () => {
  const r = await api('GET', `/api/days/${today}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.items.some((i) => i.id === routineId));
  assert.equal(r.body.items.find((i) => i.id === routineId).status, 'pending');
});

await test('a routine can be marked done', async () => {
  const r = await api('POST', '/api/days/log', { routine_id: routineId, date: today, status: 'done' });
  assert.equal(r.status, 200);
  assert.equal(r.body.log.status, 'done');
});

await test('marking done twice stays a single log row', async () => {
  await api('POST', '/api/days/log', { routine_id: routineId, date: today, status: 'done' });
  const r = await api('GET', `/api/days/${today}`);
  assert.equal(r.body.items.filter((i) => i.id === routineId).length, 1);
  assert.equal(r.body.summary.done >= 1, true);
});

await test('a routine can be un-marked', async () => {
  await api('POST', '/api/days/log', { routine_id: routineId, date: today, status: 'pending' });
  const r = await api('GET', `/api/days/${today}`);
  assert.equal(r.body.items.find((i) => i.id === routineId).status, 'pending');
  await api('POST', '/api/days/log', { routine_id: routineId, date: today, status: 'done' });
});

await test('logging a day the routine is not scheduled for is rejected', async () => {
  const weekly = await api('POST', '/api/routines', {
    title: 'Weekly only', start_date: today, repeat_type: 'weekly', repeat_days: String((new Date().getUTCDay() + 1) % 7),
  });
  const r = await api('POST', '/api/days/log', { routine_id: weekly.body.routine.id, date: today, status: 'done' });
  assert.equal(r.status, 400);
});

await test('a quantity routine tracks partial progress', async () => {
  const created = await api('POST', '/api/routines', {
    title: 'Read', start_date: today, goal_type: 'quantity', target_value: 20, unit: 'pages',
  });
  const id = created.body.routine.id;
  const partial = await api('POST', '/api/days/log', { routine_id: id, date: today, status: 'partial', value: 5 });
  assert.equal(partial.body.status, 'partial');
  const full = await api('POST', '/api/days/log', { routine_id: id, date: today, status: 'partial', value: 20 });
  assert.equal(full.body.status, 'done', 'reaching the target should complete the routine');
});

await test('a routine can be updated', async () => {
  const r = await api('PATCH', `/api/routines/${routineId}`, { title: 'Evening run', priority: 'low' });
  assert.equal(r.status, 200);
  assert.equal(r.body.routine.title, 'Evening run');
  assert.equal(r.body.routine.priority, 'low');
});

await test('a routine can be duplicated', async () => {
  const r = await api('POST', `/api/routines/${routineId}/duplicate`);
  assert.equal(r.status, 201);
  assert.match(r.body.routine.title, /copy/);
  await api('DELETE', `/api/routines/${r.body.routine.id}`);
});

await test('postponing a one-off routine moves its date', async () => {
  const created = await api('POST', '/api/routines', {
    title: 'Call the bank', start_date: today, repeat_type: 'once',
  });
  const id = created.body.routine.id;

  const r = await api('POST', `/api/routines/${id}/postpone`, { date: today });
  assert.equal(r.status, 200);
  assert.equal(r.body.moved, 'shifted');
  assert.equal(r.body.date, tomorrow);
  assert.equal(r.body.routine.start_date, tomorrow);

  const gone = await api('GET', `/api/days/${today}`);
  assert.equal(gone.body.items.some((i) => i.id === id), false, 'it should have left today');
  const arrived = await api('GET', `/api/days/${tomorrow}`);
  assert.equal(arrived.body.items.some((i) => i.id === id), true);

  // Postponing again keeps moving the same routine rather than piling up copies.
  const again = await api('POST', `/api/routines/${id}/postpone`, { date: tomorrow });
  assert.equal(again.body.routine.start_date, dayAfter);
  const all = await api('GET', '/api/routines');
  assert.equal(all.body.routines.filter((x) => x.title === 'Call the bank').length, 1);

  await api('DELETE', `/api/routines/${id}`);
});

await test('postponing a daily routine only skips the day', async () => {
  const created = await api('POST', '/api/routines', { title: 'Stretch', start_date: today });
  const id = created.body.routine.id;

  const r = await api('POST', `/api/routines/${id}/postpone`, { date: today });
  assert.equal(r.body.moved, 'skipped', 'a daily routine already lands on tomorrow');
  assert.equal(r.body.routine.id, id, 'no copy is created');

  const day = await api('GET', `/api/days/${today}`);
  assert.equal(day.body.items.find((i) => i.id === id).status, 'skipped');
  const next = await api('GET', `/api/days/${tomorrow}`);
  assert.equal(next.body.items.find((i) => i.id === id).status, 'pending');

  await api('DELETE', `/api/routines/${id}`);
});

await test('postponing a weekly routine puts a one-off copy on tomorrow', async () => {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const created = await api('POST', '/api/routines', {
    title: 'Deep clean', start_date: today, repeat_type: 'weekly', repeat_days: String(weekday),
  });
  const id = created.body.routine.id;

  const r = await api('POST', `/api/routines/${id}/postpone`, { date: today });
  assert.equal(r.body.moved, 'copied');
  assert.notEqual(r.body.routine.id, id);
  assert.equal(r.body.routine.repeat_type, 'once');
  assert.equal(r.body.routine.start_date, tomorrow);
  assert.equal(r.body.routine.title, 'Deep clean', 'the copy is the same work, so it keeps the name');

  const day = await api('GET', `/api/days/${today}`);
  assert.equal(day.body.items.find((i) => i.id === id).status, 'skipped');
  const next = await api('GET', `/api/days/${tomorrow}`);
  assert.equal(next.body.items.some((i) => i.id === r.body.routine.id), true);

  await api('DELETE', `/api/routines/${r.body.routine.id}`);
  await api('DELETE', `/api/routines/${id}`);
});

await test('a day the routine is not scheduled for cannot be postponed', async () => {
  const created = await api('POST', '/api/routines', {
    title: 'One day only', start_date: today, repeat_type: 'once',
  });
  const r = await api('POST', `/api/routines/${created.body.routine.id}/postpone`, { date: tomorrow });
  assert.equal(r.status, 400);
  await api('DELETE', `/api/routines/${created.body.routine.id}`);
});

await test("another user cannot postpone someone else's routine", async () => {
  const other = await api('POST', '/api/auth/register', { name: 'Other', email: `nosy${Date.now()}@example.com`, password: 'goodpass123' }, { noAuth: true });
  const res = await fetch(`${base}/api/routines/${routineId}/postpone`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${other.body.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: today }),
  });
  assert.equal(res.status, 404);
});

await test('deleting a routine removes it from the day view and its history', async () => {
  const created = await api('POST', '/api/routines', { title: 'Temporary', start_date: today });
  const id = created.body.routine.id;
  await api('POST', '/api/days/log', { routine_id: id, date: today, status: 'done' });

  const r = await api('DELETE', `/api/routines/${id}`);
  assert.equal(r.status, 200);

  const day = await api('GET', `/api/days/${today}`);
  assert.equal(day.body.items.some((i) => i.id === id), false);
  assert.equal((await api('GET', `/api/routines/${id}`)).status, 404);
});

await test("another user's routine is not reachable", async () => {
  const other = await api('POST', '/api/auth/register', { name: 'Other', email: `other${Date.now()}@x.com`, password: 'goodpass123' }, { noAuth: true });
  const res = await fetch(`${base}/api/routines/${routineId}`, { headers: { Authorization: `Bearer ${other.body.token}` } });
  assert.equal(res.status, 404);
});

await test('the week strip returns seven days', async () => {
  const r = await api('GET', `/api/days/${today}/week`);
  assert.equal(r.status, 200);
  assert.equal(r.body.days.length, 7);
});

await test('the month view returns the whole month', async () => {
  const [y, m] = today.split('-');
  const r = await api('GET', `/api/days/month/${y}/${Number(m)}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.days.length >= 28);
});

await test('an invalid month is rejected', async () => {
  const r = await api('GET', '/api/days/month/2025/13');
  assert.equal(r.status, 400);
});

await test('complete-all marks everything for the day', async () => {
  const r = await api('POST', `/api/days/${today}/complete-all`);
  assert.equal(r.status, 200);
  const day = await api('GET', `/api/days/${today}`);
  assert.equal(day.body.summary.pending, 0);
  assert.equal(day.body.summary.rate, 100);
});

await test('the stats overview computes a completion rate', async () => {
  const r = await api('GET', '/api/stats/overview?days=30');
  assert.equal(r.status, 200);
  assert.equal(r.body.totals.rate > 0, true);
  assert.ok(Array.isArray(r.body.series));
  assert.equal(r.body.weekdays.length, 7);
});

await test('a perfect day produces a streak', async () => {
  const r = await api('GET', '/api/stats/overview?days=30');
  assert.equal(r.body.streak.current >= 1, true);
});

await test('the heatmap starts at the first scheduled day, not the window edge', async () => {
  const r = await api('GET', '/api/stats/heatmap?days=60');
  // Routines in this suite start yesterday, so the window is clamped to the
  // eight-week floor rather than padded out to the requested 60 days.
  assert.equal(r.body.to, today);
  assert.equal(r.body.days.length, 56);
  assert.equal(r.body.days.at(-1).date, today);
  // Days before anything was scheduled carry no due count.
  assert.equal(r.body.days[0].due, 0);
});

await test('the shell summary reports level, streak and today', async () => {
  const r = await api('GET', '/api/stats/summary');
  assert.equal(r.status, 200);
  assert.ok(r.body.xp.level >= 1);
  assert.equal(r.body.today.total > 0, true);
  assert.equal(r.body.today.done + r.body.today.pending, r.body.today.total);
});

await test('achievements unlock and persist', async () => {
  const r = await api('GET', '/api/stats/achievements');
  assert.equal(r.status, 200);
  assert.ok(r.body.achievements.find((a) => a.code === 'first_step').unlocked);
  assert.ok(r.body.xp.level >= 1);
  const again = await api('GET', '/api/stats/achievements');
  assert.equal(again.body.newly_unlocked.length, 0, 'a badge should only be reported as new once');
});

await test('a journal entry can be saved and read back', async () => {
  const put = await api('PUT', `/api/journal/${today}`, { mood: 4, energy: 3, body: 'Good day.' });
  assert.equal(put.status, 200);
  const get = await api('GET', `/api/journal/${today}`);
  assert.equal(get.body.entry.mood, 4);
  assert.equal(get.body.entry.body, 'Good day.');
});

await test('an out-of-range mood is rejected', async () => {
  const r = await api('PUT', `/api/journal/${today}`, { mood: 9, body: 'x' });
  assert.equal(r.status, 400);
});

await test('an emptied journal entry is removed', async () => {
  await api('PUT', `/api/journal/${today}`, { mood: null, energy: null, body: '' });
  const get = await api('GET', `/api/journal/${today}`);
  assert.equal(get.body.entry, null);
  await api('PUT', `/api/journal/${today}`, { mood: 4, body: 'Good day.' });
});

await test('a template can be applied', async () => {
  const list = await api('GET', '/api/templates');
  assert.ok(list.body.templates.length > 0);
  const before = (await api('GET', '/api/routines')).body.routines.length;
  const r = await api('POST', '/api/templates/mindful/apply');
  assert.equal(r.status, 201);
  const after = (await api('GET', '/api/routines')).body.routines.length;
  assert.equal(after, before + r.body.created);
});

await test('an unknown template returns 404', async () => {
  const r = await api('POST', '/api/templates/nope/apply');
  assert.equal(r.status, 404);
});

let goalId = null;

await test("routines can be put in the user's own order", async () => {
  const before = await api('GET', '/api/routines');
  const ids = before.body.routines.map((r) => r.id);
  const reversed = [...ids].reverse();
  const r = await api('POST', '/api/routines/reorder', { ids: reversed });
  assert.equal(r.status, 200);
  const after = await api('GET', '/api/routines');
  assert.deepEqual(after.body.routines.map((x) => x.id), reversed);
});

await test('reordering ignores routines that belong to someone else', async () => {
  const other = await api('POST', '/api/auth/register', { name: 'Other', email: `other${Date.now()}@example.com`, password: 'goodpass123' }, { noAuth: true });
  const theirs = await fetch(`${base}/api/routines`, { headers: { Authorization: `Bearer ${other.body.token}` } }).then((x) => x.json());
  const theirId = theirs.routines[0].id;
  const before = theirs.routines.find((x) => x.id === theirId).sort_order;
  await api('POST', '/api/routines/reorder', { ids: [theirId] });
  const check = await fetch(`${base}/api/routines`, { headers: { Authorization: `Bearer ${other.body.token}` } }).then((x) => x.json());
  assert.equal(check.routines.find((x) => x.id === theirId).sort_order, before);
});

await test('a reorder request without ids is rejected', async () => {
  const r = await api('POST', '/api/routines/reorder', { ids: [] });
  assert.equal(r.status, 400);
});

// --- Web Push -----------------------------------------------------------

const webpush = await import('../server/lib/webpush.js');
const { runReminders, clockIn } = await import('../server/lib/reminders.js');
const nodeCrypto = await import('node:crypto');

await test('push encryption matches the RFC 8291 test vector', async () => {
  const body = webpush.encryptPayload(
    Buffer.from('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24', 'base64url'),
    {
      p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    },
    {
      localPrivateKey: Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'),
      salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'),
    },
  );
  assert.equal(body.toString('base64url'),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

await test('the VAPID token is a valid ES256 JWT for the push service', async () => {
  const keys = webpush.vapidKeys();
  const header = webpush.vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { subject: 'mailto:test@example.com' });
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.equal(k, keys.publicKey);
  const [h, c, s] = jwt.split('.');
  const point = Buffer.from(keys.publicKey, 'base64url');
  const publicKey = nodeCrypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') } });
  assert.ok(nodeCrypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), 'signature verifies');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:test@example.com');
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 12 * 3600 + 5);
});

await test('only https endpoints on known push services are accepted', async () => {
  assert.ok(webpush.isAllowedEndpoint('https://fcm.googleapis.com/fcm/send/x'));
  assert.ok(webpush.isAllowedEndpoint('https://web.push.apple.com/abc'));
  assert.ok(webpush.isAllowedEndpoint('https://wns2-by3p.notify.windows.com/w/?token=1'));
  assert.ok(!webpush.isAllowedEndpoint('http://fcm.googleapis.com/fcm/send/x'), 'plain http');
  assert.ok(!webpush.isAllowedEndpoint('https://127.0.0.1/admin'), 'internal address');
  assert.ok(!webpush.isAllowedEndpoint('https://fcm.googleapis.com.evil.example/x'), 'look-alike host');
  assert.ok(!webpush.isAllowedEndpoint('https://user:pass@fcm.googleapis.com/x'), 'credentials in URL');
});

await test("a refused push reports and logs the push service's reason", async () => {
  const keys = nodeCrypto.createECDH('prime256v1');
  keys.generateKeys();
  const sub = {
    id: 7, user_id: 3,
    endpoint: 'https://web.push.apple.com/QGx-test',
    p256dh: keys.getPublicKey().toString('base64url'),
    auth: nodeCrypto.randomBytes(16).toString('base64url'),
  };
  const logged = [];
  const fetchImpl = async () => new Response(JSON.stringify({ reason: 'BadJwtToken' }), { status: 403 });

  const result = await webpush.sendPush(sub, { title: 't' }, { fetchImpl, log: { warn: (m) => logged.push(m) } });
  assert.deepEqual([result.ok, result.gone, result.status, result.reason], [false, false, 403, 'BadJwtToken']);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /apple 403 BadJwtToken/);
  assert.match(logged[0], /subscription 7, user 3/);

  const gone = await webpush.sendPush(sub, { title: 't' }, {
    fetchImpl: async () => new Response('', { status: 410 }), log: { warn: () => {} },
  });
  assert.equal(gone.gone, true, '410 Gone means the subscription must be dropped');
});

await test('the VAPID subject is checked the way Apple checks it', async () => {
  assert.equal(webpush.vapidSubjectProblem('mailto:owner@gmail.com'), null);
  assert.equal(webpush.vapidSubjectProblem('https://routine.example.net'), null);
  assert.match(webpush.vapidSubjectProblem(''), /not set/);
  assert.match(webpush.vapidSubjectProblem('owner@gmail.com'), /mailto:/, 'the mailto: prefix is required');
  assert.match(webpush.vapidSubjectProblem('mailto:admin@routine-tracker.local'), /not a reachable/);
  assert.match(webpush.vapidSubjectProblem('mailto:me@localhost'), /mailto:|reachable/);
});

await test('the push diagnosis reports a user with no subscribed device', async () => {
  const fresh = await api('POST', '/api/auth/register', {
    name: 'Push check', email: `pushcheck${Date.now()}@example.com`, password: 'goodpass123',
  }, { noAuth: true });
  const res = await fetch(`${base}/api/notifications/test-push`, { headers: { Authorization: `Bearer ${fresh.body.token}` } });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.subscriptions, 0);
  assert.equal(body.appleSubscriptions, 0);
  assert.ok(body.vapid.publicKey, 'the public key is shown so it can be compared with the device');
  assert.equal(typeof body.advice, 'string');

  const anonymous = await fetch(`${base}/api/notifications/test-push`);
  assert.equal(anonymous.status, 401);
});

const browserKeys = nodeCrypto.createECDH('prime256v1');
browserKeys.generateKeys();
const subscription = {
  endpoint: `https://fcm.googleapis.com/fcm/send/test-${Date.now()}`,
  keys: { p256dh: browserKeys.getPublicKey().toString('base64url'), auth: nodeCrypto.randomBytes(16).toString('base64url') },
};

await test('the push key is served to signed-in users', async () => {
  const r = await api('GET', '/api/push/key');
  assert.equal(r.status, 200);
  assert.equal(Buffer.from(r.body.publicKey, 'base64url').length, 65);
});

await test('a subscription to an internal address is refused', async () => {
  const r = await api('POST', '/api/push/subscribe', { ...subscription, endpoint: 'https://10.0.0.5/steal' });
  assert.equal(r.status, 400);
  assert.ok(r.body.error.fields.endpoint);
});

await test('a subscription with malformed keys is refused', async () => {
  const r = await api('POST', '/api/push/subscribe', { endpoint: subscription.endpoint, keys: { p256dh: 'abc', auth: 'x' } });
  assert.equal(r.status, 400);
  assert.ok(r.body.error.fields.p256dh && r.body.error.fields.auth);
});

await test('a browser can subscribe to reminders', async () => {
  const r = await api('POST', '/api/push/subscribe', subscription);
  assert.equal(r.status, 201);
});

await test('a due reminder is pushed once, with the routine and its time', async () => {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const created = await api('POST', '/api/routines', {
    title: 'Push me', icon: '🔔', start_time: '10:00', reminder_min: 15, repeat_type: 'once', start_date: todayUtc,
  });
  const id = created.body.routine.id;
  const at = (hh, mm) => new Date(`${todayUtc}T${hh}:${mm}:00Z`);
  const sent = [];
  const send = async (sub, message) => { sent.push({ sub, message }); return { ok: true, gone: false, status: 201 }; };
  const mine = () => sent.filter((s) => s.message.tag === `routine-${id}-${todayUtc}`);

  await runReminders({ now: at('09', '30'), send });
  assert.equal(mine().length, 0, 'not yet due at 09:30');
  await runReminders({ now: at('09', '46'), send });
  assert.equal(mine().length, 1, 'due at 09:45, sent at 09:46');
  assert.equal(mine()[0].sub.endpoint, subscription.endpoint);
  assert.match(mine()[0].message.title, /Push me/);
  assert.match(mine()[0].message.body, /10:00/);
  await runReminders({ now: at('09', '47'), send });
  assert.equal(mine().length, 1, 'never sent twice');
});

await test('a reminder is not pushed once the routine is done', async () => {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const created = await api('POST', '/api/routines', {
    title: 'Already done', start_time: '11:00', reminder_min: 0, repeat_type: 'once', start_date: todayUtc,
  });
  const id = created.body.routine.id;
  await api('POST', '/api/days/log', { routine_id: id, date: todayUtc, status: 'done' });
  const sent = [];
  await runReminders({ now: new Date(`${todayUtc}T11:01:00Z`), send: async (s, m) => { sent.push(m); return { ok: true, gone: false }; } });
  assert.ok(!sent.some((m) => m.tag === `routine-${id}-${todayUtc}`));
});

await test('a subscription the push service reports gone is removed', async () => {
  const todayUtc = new Date().toISOString().slice(0, 10);
  await api('POST', '/api/routines', { title: 'Gone', start_time: '12:00', reminder_min: 0, repeat_type: 'once', start_date: todayUtc });
  const result = await runReminders({ now: new Date(`${todayUtc}T12:00:30Z`), send: async () => ({ ok: false, gone: true, status: 410 }) });
  assert.ok(result.removed >= 1);
  const left = (await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?').get(subscription.endpoint)).n;
  assert.equal(left, 0);
});

await test('reminder time follows the user’s own timezone', async () => {
  const at = new Date('2026-09-19T05:30:00Z');
  assert.deepEqual(clockIn('Asia/Tashkent', at), { date: '2026-09-19', minutes: 10 * 60 + 30 });
  assert.deepEqual(clockIn('America/New_York', at), { date: '2026-09-19', minutes: 60 + 30 });
  assert.deepEqual(clockIn('Not/AZone', at), { date: '2026-09-19', minutes: 5 * 60 + 30 });
});

await test('a browser can unsubscribe', async () => {
  await api('POST', '/api/push/subscribe', subscription);
  const r = await api('DELETE', '/api/push/subscribe', { endpoint: subscription.endpoint });
  assert.equal(r.status, 200);
  assert.equal(r.body.removed, 1);
});

await test('a goal can be created', async () => {
  const r = await api('POST', '/api/goals', { title: 'Run a half marathon', target_date: '2027-01-01' });
  assert.equal(r.status, 201);
  assert.equal(r.body.goal.status, 'active');
  assert.equal(r.body.goal.progress.routines, 0);
  // Nothing scheduled yet is not the same as nothing done.
  assert.equal(r.body.goal.progress.completion, null);
  goalId = r.body.goal.id;
});

await test('a goal without a title is rejected', async () => {
  const r = await api('POST', '/api/goals', { title: '' });
  assert.equal(r.status, 400);
});

await test('a routine can be pointed at a goal', async () => {
  const r = await api('PATCH', `/api/routines/${routineId}`, { goal_id: goalId });
  assert.equal(r.status, 200);
  assert.equal(r.body.routine.goal_id, goalId);
});

await test('a goal reports the progress of its routines', async () => {
  const r = await api('GET', '/api/goals');
  const goal = r.body.goals.find((g) => g.id === goalId);
  assert.equal(goal.progress.routines, 1);
  assert.ok(goal.progress.due > 0);
  assert.equal(goal.progress.series.length, 30, 'one rate per day of the window');
  assert.ok(goal.routines.some((x) => x.id === routineId));
});

await test('an unknown goal cannot be linked', async () => {
  const r = await api('PATCH', `/api/routines/${routineId}`, { goal_id: 999999 });
  assert.equal(r.status, 400);
});

await test('a routine can be detached from its goal', async () => {
  const r = await api('PATCH', `/api/routines/${routineId}`, { goal_id: null });
  assert.equal(r.body.routine.goal_id, null);
  const goals = await api('GET', '/api/goals');
  assert.equal(goals.body.goals.find((g) => g.id === goalId).progress.routines, 0);
});

await test('a goal can be marked as reached', async () => {
  await api('PATCH', `/api/routines/${routineId}`, { goal_id: goalId });
  const r = await api('PATCH', `/api/goals/${goalId}`, { status: 'done' });
  assert.equal(r.body.goal.status, 'done');
});

await test('deleting a goal keeps its routines and clears the link', async () => {
  const del = await api('DELETE', `/api/goals/${goalId}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.unlinked, 1);

  const routine = await api('GET', `/api/routines/${routineId}`);
  assert.equal(routine.status, 200);
  assert.equal(routine.body.routine.goal_id, null);
});

await test('a deleted goal is gone', async () => {
  const r = await api('PATCH', `/api/goals/${goalId}`, { title: 'Nope' });
  assert.equal(r.status, 404);
});

await test('search finds routines by title', async () => {
  const r = await api('GET', '/api/search?q=Evening');
  assert.ok(r.body.routines.some((x) => x.title === 'Evening run'));
});

await test('export returns the full dataset', async () => {
  const r = await api('GET', '/api/export');
  assert.equal(r.status, 200);
  assert.ok(r.body.routines.length > 0);
  assert.ok(r.body.logs.length > 0);
  assert.ok(Array.isArray(r.body.goals));
  assert.equal(r.body.format, 'routine-tracker/v1');
});

await test('CSV export has a header row', async () => {
  const res = await fetch(`${base}/api/export.csv`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  assert.match(text.split('\n')[0], /^date,routine,category/);
});

await test('profile settings can be updated', async () => {
  const r = await api('PATCH', '/api/auth/me', { name: 'Renamed', theme: 'light', daily_goal: 90 });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.name, 'Renamed');
  assert.equal(r.body.user.daily_goal, 90);
});

await test('an invalid theme is rejected', async () => {
  const r = await api('PATCH', '/api/auth/me', { theme: 'neon' });
  assert.equal(r.status, 400);
});

await test('changing the password requires the current one', async () => {
  const bad = await api('POST', '/api/auth/password', { current_password: 'nope12345', new_password: 'brandnew123' });
  assert.equal(bad.status, 400);
  const good = await api('POST', '/api/auth/password', { current_password: 'goodpass123', new_password: 'brandnew123' });
  assert.equal(good.status, 200);
});

await test('the new password works and the old one does not', async () => {
  const old = await api('POST', '/api/auth/login', { email, password: 'goodpass123' }, { noAuth: true });
  assert.equal(old.status, 401);
  const fresh = await api('POST', '/api/auth/login', { email, password: 'brandnew123' }, { noAuth: true });
  assert.equal(fresh.status, 200);
  token = fresh.body.token;
});

await test('a routine can be archived, then deleted', async () => {
  await api('PATCH', `/api/routines/${routineId}`, { archived: true });
  const active = await api('GET', '/api/routines');
  assert.ok(!active.body.routines.some((r) => r.id === routineId));
  const all = await api('GET', '/api/routines?archived=all');
  assert.ok(all.body.routines.some((r) => r.id === routineId));
  const del = await api('DELETE', `/api/routines/${routineId}`);
  assert.equal(del.status, 200);
});

await test('deleting a routine removes its logs', async () => {
  const r = await api('GET', '/api/export');
  assert.ok(!r.body.logs.some((l) => l.routine_id === routineId));
});

await test('signing out invalidates the token', async () => {
  const out = await api('POST', '/api/auth/logout');
  assert.equal(out.status, 200);
  const after = await api('GET', '/api/auth/me');
  assert.equal(after.status, 401);
});

await test('deleting an account removes all of its data', async () => {
  const fresh = await api('POST', '/api/auth/login', { email, password: 'brandnew123' }, { noAuth: true });
  token = fresh.body.token;
  const del = await api('DELETE', '/api/auth/me', { password: 'brandnew123' });
  assert.equal(del.status, 200);
  const relogin = await api('POST', '/api/auth/login', { email, password: 'brandnew123' }, { noAuth: true });
  assert.equal(relogin.status, 401);
});

// --- SQLite import -------------------------------------------------------

const { readSqlite, importRows } = await import('../scripts/import-sqlite.mjs');
const legacyFile = path.join(here, '..', 'data', `legacy-${Date.now()}.sqlite`);

await test('an existing SQLite database is imported with its ids intact', async () => {
  // A miniature of the old database: a user, a goal, a routine pointing at
  // that goal, and a log — enough that every foreign key has to survive.
  const { DatabaseSync } = await import('node:sqlite');
  const legacy = new DatabaseSync(legacyFile);
  legacy.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT, password_hash TEXT,
      avatar_color TEXT, timezone TEXT, locale TEXT, theme TEXT, week_start INTEGER,
      daily_goal INTEGER, reminders_on INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE goals (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, description TEXT,
      icon TEXT, color TEXT, target_date TEXT, status TEXT, sort_order INTEGER,
      created_at TEXT, updated_at TEXT);
    CREATE TABLE routines (id INTEGER PRIMARY KEY, user_id INTEGER, goal_id INTEGER, title TEXT,
      notes TEXT, icon TEXT, color TEXT, category TEXT, priority TEXT, start_time TEXT,
      duration_min INTEGER, repeat_type TEXT, repeat_days TEXT, repeat_every INTEGER,
      start_date TEXT, end_date TEXT, goal_type TEXT, target_value REAL, unit TEXT,
      reminder_min INTEGER, sort_order INTEGER, archived INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE logs (id INTEGER PRIMARY KEY, routine_id INTEGER, user_id INTEGER, log_date TEXT,
      status TEXT, value REAL, note TEXT, completed_at TEXT);
    INSERT INTO users VALUES (9001, 'legacy@example.com', 'Legacy', 'hash', '#6366f1', 'UTC',
      'uz', 'dark', 1, 80, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    INSERT INTO goals VALUES (9002, 9001, 'Old goal', '', '🎯', '#6366f1', NULL, 'active', 1,
      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    INSERT INTO routines VALUES (9003, 9001, 9002, 'Old routine', '', '✅', '#6366f1', 'personal',
      'normal', '07:00', 30, 'daily', '', 1, '2026-01-01', NULL, 'check', 1, '', NULL, 1, 0,
      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    INSERT INTO logs VALUES (9004, 9003, 9001, '2026-01-02', 'done', 1, '', '2026-01-02T07:30:00Z');
  `);

  const rows = readSqlite(legacy);
  legacy.close();
  assert.equal(rows.users.length, 1);
  assert.equal(rows.logs.length, 1);

  const written = await importRows(db, rows);
  assert.equal(written, 4);

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(9001);
  assert.equal(user.email, 'legacy@example.com');
  assert.equal(user.locale, 'uz');

  const routine = await db.prepare('SELECT * FROM routines WHERE id = ?').get(9003);
  assert.equal(routine.goal_id, 9002, 'the link to the goal survives');
  assert.equal(routine.user_id, 9001);

  const log = await db.prepare('SELECT * FROM logs WHERE id = ?').get(9004);
  assert.equal(log.log_date, '2026-01-02');
});

await test('the next new row gets an id past the imported ones', async () => {
  // Without resetting the identity sequences, Postgres would hand out id 1
  // again and the insert would collide with an imported row.
  const created = await db.prepare(
    `INSERT INTO users (email, name, password_hash) VALUES (?, 'After import', 'x') RETURNING id`,
  ).run(`after-import-${Date.now()}@example.com`);
  assert.ok(created.lastInsertRowid > 9001, `expected an id above 9001, got ${created.lastInsertRowid}`);
});

await test('importing the same database twice does not duplicate it', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const legacy = new DatabaseSync(legacyFile, { readOnly: true });
  const rows = readSqlite(legacy);
  legacy.close();

  await importRows(db, rows);
  const count = (await db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(9001)).n;
  assert.equal(count, 1);
});

// --- Database settings and backups ---------------------------------------

const { backupDatabase, snapshot, storageAuth, TABLES } = await import('../server/db/backup.js');

await test('a new sb_secret key goes in apikey only, a legacy JWT in both headers', async () => {
  assert.deepEqual(storageAuth('sb_secret_abc'), { apikey: 'sb_secret_abc' });
  assert.deepEqual(storageAuth('eyJhbGciOi.x.y'), { apikey: 'eyJhbGciOi.x.y', Authorization: 'Bearer eyJhbGciOi.x.y' });
});
const backupDir = path.join(here, '..', 'data', `test-backups-${Date.now()}`);
await test('the database is PostgreSQL and enforces its foreign keys', async () => {
  const { version } = await db.prepare('SELECT version() AS version').get();
  assert.match(version, /PostgreSQL/);

  // A routine pointing at a user that does not exist must be refused; the app
  // leans on ON DELETE CASCADE to make account deletion one statement.
  await assert.rejects(
    db.prepare("INSERT INTO routines (user_id, title, start_date) VALUES (?, 'orphan', '2026-01-01')").run(999999),
    /foreign key|violates/i,
  );
});

await test('an @ inside a string literal is not read as a parameter', async () => {
  // LIKE '%@example.com' used to be rewritten to a $1 placeholder, and the
  // query failed with "bind message supplies 0 parameters".
  const rows = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@example.com'").all();
  assert.equal(typeof rows[0].n, 'number');

  const one = await db.prepare("SELECT 'a@b.com' AS mail, ? AS given").get('x');
  assert.equal(one.mail, 'a@b.com');
  assert.equal(one.given, 'x');

  // The escaped-quote case: '' inside a literal must not end it early.
  const quoted = await db.prepare("SELECT 'it''s @fine' AS text").get();
  assert.equal(quoted.text, "it's @fine");
});

await test('every table the backup names exists', async () => {
  for (const table of TABLES) {
    const row = await db.prepare('SELECT to_regclass(?) AS found').get(table);
    assert.ok(row.found, `table ${table} is missing`);
  }
});

await test('a daily backup holds every row of every table', async () => {
  const { created } = await backupDatabase(db, { dir: backupDir, now: new Date(2026, 8, 18, 12), upload: async () => false });
  assert.ok(created && fs.existsSync(created), 'backup file should exist');
  assert.equal(path.basename(created), 'routine-tracker-2026-09-18.json.gz');

  const saved = JSON.parse(zlib.gunzipSync(fs.readFileSync(created)));
  assert.equal(saved.format, 'routine-tracker/backup-v1');
  for (const table of ['users', 'routines', 'logs', 'goals', 'journal']) {
    const live = (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).n;
    assert.equal(saved.tables[table].length, live, `${table} row count should match`);
  }
});

await test('a backup keeps the data itself, not just the row counts', async () => {
  const taken = await snapshot(db);
  const live = await db.prepare('SELECT id, email, name FROM users ORDER BY id').all();
  assert.deepEqual(taken.tables.users.map((u) => ({ id: u.id, email: u.email, name: u.name })), live);
});

await test('a second backup on the same day is skipped', async () => {
  const { created } = await backupDatabase(db, { dir: backupDir, now: new Date(2026, 8, 18, 20), upload: async () => false });
  assert.equal(created, null);
});

await test('only the newest seven daily backups are kept', async () => {
  for (let day = 19; day <= 27; day += 1) {
    await backupDatabase(db, { dir: backupDir, keep: 7, now: new Date(2026, 8, day, 12), upload: async () => false });
  }
  const kept = fs.readdirSync(backupDir).filter((n) => n.endsWith('.json.gz')).sort();
  assert.equal(kept.length, 7);
  assert.equal(kept[0], 'routine-tracker-2026-09-21.json.gz');
  assert.equal(kept[6], 'routine-tracker-2026-09-27.json.gz');
  assert.ok(!fs.readdirSync(backupDir).some((n) => n.endsWith('.tmp')), 'no temp files left behind');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);

await db.close();
fs.rmSync(backupDir, { recursive: true, force: true });
fs.rmSync(legacyFile, { force: true });

process.exit(failed ? 1 : 0);
