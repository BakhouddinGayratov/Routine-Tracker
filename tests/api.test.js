/**
 * End-to-end API test.
 *
 * Boots the real server against a throwaway SQLite file and drives it over
 * HTTP, so routing, validation, auth and SQL are all exercised together.
 *
 *   node tests/api.test.js
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbFile = path.join(here, '..', 'data', `test-${Date.now()}.sqlite`);

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = dbFile;
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

await test('search finds routines by title', async () => {
  const r = await api('GET', '/api/search?q=Evening');
  assert.ok(r.body.routines.some((x) => x.title === 'Evening run'));
});

await test('export returns the full dataset', async () => {
  const r = await api('GET', '/api/export');
  assert.equal(r.status, 200);
  assert.ok(r.body.routines.length > 0);
  assert.ok(r.body.logs.length > 0);
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

console.log(`\n  ${passed} passed, ${failed} failed\n`);

// Windows keeps a lock on an open database file, so the connection has to be
// closed before the throwaway database can be removed.
db.close();

for (const file of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
process.exit(failed ? 1 : 0);
