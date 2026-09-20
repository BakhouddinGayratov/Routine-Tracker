import express from 'express';
import { db, tx } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { validate, v } from '../lib/validate.js';
import { asyncHandler } from '../middleware/error.js';
import { dueOn, isDueOn } from '../lib/schedule.js';
import { todayIn, isValidDate, addDays, monthBounds, dateRange } from '../lib/dates.js';
import { buildDailySeries, computeStreak, round } from '../lib/stats.js';

export const daysRouter = express.Router();

async function activeRoutines(userId) {
  return (await db.prepare('SELECT * FROM routines WHERE user_id = ? AND archived = 0').all(userId));
}

/**
 * Everything the day view needs in one request: the routines due that day,
 * their logs, the journal entry and a progress summary.
 */
daysRouter.get('/:date', asyncHandler(async (req, res) => {
  const date = req.params.date === 'today' ? todayIn(req.user.timezone) : req.params.date;
  if (!isValidDate(date)) throw ApiError.badRequest('Invalid date');

  const routines = await activeRoutines(req.user.id);
  const due = dueOn(routines, date);
  const logs = (await db.prepare('SELECT * FROM logs WHERE user_id = ? AND log_date = ?').all(req.user.id, date));
  const logByRoutine = new Map(logs.map((l) => [l.routine_id, l]));

  const items = due.map((routine) => {
    const log = logByRoutine.get(routine.id);
    return {
      ...routine,
      archived: !!routine.archived,
      status: log?.status || 'pending',
      value: log?.value ?? 0,
      log_note: log?.note || '',
      completed_at: log?.completed_at || null,
    };
  });

  const doneCount = items.filter((i) => i.status === 'done').length;
  const skipped = items.filter((i) => i.status === 'skipped').length;
  const journal = (await db.prepare('SELECT * FROM journal WHERE user_id = ? AND entry_date = ?').get(req.user.id, date)) || null;

  // 90 days of context is enough for the streak shown on the day header.
  const windowStart = addDays(date, -120);
  const rangeLogs = (await db.prepare('SELECT * FROM logs WHERE user_id = ? AND log_date BETWEEN ? AND ?')
    .all(req.user.id, windowStart, date));
  const series = buildDailySeries(routines, rangeLogs, windowStart, date);
  const streak = computeStreak(series, req.user.daily_goal, todayIn(req.user.timezone));

  res.json({
    date,
    today: todayIn(req.user.timezone),
    items,
    journal,
    summary: {
      total: items.length,
      done: doneCount,
      skipped,
      pending: items.length - doneCount - skipped,
      rate: items.length ? round((doneCount / items.length) * 100) : null,
      minutes_planned: items.reduce((sum, i) => sum + (i.duration_min || 0), 0),
      minutes_done: items.filter((i) => i.status === 'done').reduce((sum, i) => sum + (i.duration_min || 0), 0),
    },
    streak,
  });
}));

/**
 * Week strip for the day header: completion rate for each day of the week that
 * contains `date`, respecting the user's preferred first day of the week.
 */
daysRouter.get('/:date/week', asyncHandler(async (req, res) => {
  const date = req.params.date === 'today' ? todayIn(req.user.timezone) : req.params.date;
  if (!isValidDate(date)) throw ApiError.badRequest('Invalid date');

  const weekStart = req.user.week_start === 0 ? 0 : 1;
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const offset = (dow - weekStart + 7) % 7;
  const from = addDays(date, -offset);
  const to = addDays(from, 6);

  const routines = await activeRoutines(req.user.id);
  const logs = (await db.prepare('SELECT * FROM logs WHERE user_id = ? AND log_date BETWEEN ? AND ?')
    .all(req.user.id, from, to));

  res.json({ from, to, days: buildDailySeries(routines, logs, from, to) });
}));

/** Month grid for the calendar view. */
daysRouter.get('/month/:year/:month', asyncHandler(async (req, res) => {
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  if (!Number.isInteger(year) || year < 1970 || year > 2200) throw ApiError.badRequest('Invalid year');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw ApiError.badRequest('Invalid month');

  const { first, last } = monthBounds(year, month);
  const routines = await activeRoutines(req.user.id);
  const logs = (await db.prepare('SELECT * FROM logs WHERE user_id = ? AND log_date BETWEEN ? AND ?')
    .all(req.user.id, first, last));
  const journal = (await db.prepare('SELECT entry_date, mood, energy FROM journal WHERE user_id = ? AND entry_date BETWEEN ? AND ?')
    .all(req.user.id, first, last));
  const moodByDate = new Map(journal.map((j) => [j.entry_date, j]));

  const days = buildDailySeries(routines, logs, first, last).map((d) => ({
    ...d,
    mood: moodByDate.get(d.date)?.mood ?? null,
    energy: moodByDate.get(d.date)?.energy ?? null,
  }));

  res.json({ year, month, first, last, days, today: todayIn(req.user.timezone) });
}));

/**
 * Log a routine for a day.
 *
 * Idempotent upsert keyed on (routine, date): tapping the same checkbox twice
 * updates one row rather than racing to create two.
 */
daysRouter.post('/log', asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    routine_id: v.int({ min: 1 }),
    date: v.date(),
    status: { rule: v.oneOf(['done', 'skipped', 'partial', 'pending']), default: 'done' },
    value: { rule: v.number({ min: 0, max: 1e9 }), default: 0 },
    note: { rule: v.string({ max: 500 }), default: '' },
  });

  const routine = (await db.prepare('SELECT * FROM routines WHERE id = ? AND user_id = ?')
    .get(data.routine_id, req.user.id));
  if (!routine) throw ApiError.notFound('Routine not found');
  if (!isDueOn(routine, data.date)) {
    throw ApiError.badRequest('This routine is not scheduled for that day');
  }

  // 'pending' means "clear the log" — that keeps un-checking a box a single,
  // obvious operation for the client.
  if (data.status === 'pending') {
    (await db.prepare('DELETE FROM logs WHERE routine_id = ? AND log_date = ?').run(routine.id, data.date));
    return res.json({ log: null, status: 'pending' });
  }

  // A quantity routine that reaches its target is complete, not partial.
  let status = data.status;
  let value = data.value;
  if (routine.goal_type === 'quantity') {
    if (status === 'done' && !value) value = routine.target_value;
    if (status === 'partial' && value >= routine.target_value) status = 'done';
  } else {
    value = status === 'done' ? 1 : 0;
  }

  (await db.prepare(
    `INSERT INTO logs (routine_id, user_id, log_date, status, value, note)
     VALUES (@routine_id, @user_id, @log_date, @status, @value, @note)
     ON CONFLICT (routine_id, log_date) DO UPDATE SET
       status = excluded.status,
       value = excluded.value,
       note = excluded.note,
       completed_at = utc_now()`,
  ).run({
    routine_id: routine.id,
    user_id: req.user.id,
    log_date: data.date,
    status,
    value,
    note: data.note,
  }));

  const log = (await db.prepare('SELECT * FROM logs WHERE routine_id = ? AND log_date = ?').get(routine.id, data.date));
  res.json({ log, status });
}));

/** Mark every remaining routine of a day as done. */
daysRouter.post('/:date/complete-all', asyncHandler(async (req, res) => {
  const date = req.params.date === 'today' ? todayIn(req.user.timezone) : req.params.date;
  if (!isValidDate(date)) throw ApiError.badRequest('Invalid date');

  const due = dueOn(await activeRoutines(req.user.id), date);
  await tx(async (t) => {
    const stmt = t.prepare(
      `INSERT INTO logs (routine_id, user_id, log_date, status, value)
       VALUES (?, ?, ?, 'done', ?)
       ON CONFLICT (routine_id, log_date) DO UPDATE SET
         status = 'done', value = excluded.value,
         completed_at = utc_now()`,
    );
    for (const r of due) await stmt.run(r.id, req.user.id, date, r.goal_type === 'quantity' ? r.target_value : 1);
  });

  res.json({ ok: true, count: due.length });
}));

/** Copy every log from one day to another — "same as yesterday" in one tap. */
daysRouter.post('/:date/copy-from', asyncHandler(async (req, res) => {
  const target = req.params.date === 'today' ? todayIn(req.user.timezone) : req.params.date;
  const source = String(req.body?.source || '');
  if (!isValidDate(target) || !isValidDate(source)) throw ApiError.badRequest('Invalid date');

  const routines = await activeRoutines(req.user.id);
  const sourceLogs = (await db.prepare("SELECT * FROM logs WHERE user_id = ? AND log_date = ? AND status = 'done'")
    .all(req.user.id, source));
  const dueIds = new Set(dueOn(routines, target).map((r) => r.id));

  let count = 0;
  await tx(async (t) => {
    const stmt = t.prepare(
      `INSERT INTO logs (routine_id, user_id, log_date, status, value)
       VALUES (?, ?, ?, 'done', ?)
       ON CONFLICT (routine_id, log_date) DO UPDATE SET status = 'done', value = excluded.value`,
    );
    for (const log of sourceLogs) {
      if (!dueIds.has(log.routine_id)) continue;   // not scheduled on the target day
      await stmt.run(log.routine_id, req.user.id, target, log.value);
      count += 1;
    }
  });

  res.json({ ok: true, count });
}));

/** Upcoming routines for the next N days — the "what's next" panel. */
daysRouter.get('/upcoming/list', asyncHandler(async (req, res) => {
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
  const today = todayIn(req.user.timezone);
  const to = addDays(today, days - 1);
  const routines = await activeRoutines(req.user.id);
  const logs = (await db.prepare('SELECT * FROM logs WHERE user_id = ? AND log_date BETWEEN ? AND ?')
    .all(req.user.id, today, to));
  const logged = new Set(logs.map((l) => `${l.routine_id}:${l.log_date}`));

  const out = [];
  for (const date of dateRange(today, to)) {
    for (const routine of dueOn(routines, date)) {
      out.push({
        date,
        id: routine.id,
        title: routine.title,
        icon: routine.icon,
        color: routine.color,
        category: routine.category,
        start_time: routine.start_time,
        duration_min: routine.duration_min,
        priority: routine.priority,
        logged: logged.has(`${routine.id}:${date}`),
      });
    }
  }

  res.json({ from: today, to, items: out });
}));
