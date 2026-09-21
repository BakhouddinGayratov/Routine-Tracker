import express from 'express';
import { db, tx } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { validate, v } from '../lib/validate.js';
import { asyncHandler } from '../middleware/error.js';
import { describeRepeat, isDueOn } from '../lib/schedule.js';
import { todayIn, addDays, dateRange } from '../lib/dates.js';
import { routineStats } from '../lib/stats.js';

export const routinesRouter = express.Router();

export const CATEGORIES = ['health', 'fitness', 'work', 'study', 'personal', 'mindfulness', 'social', 'finance', 'home', 'other'];

const writeSchema = {
  title:        v.string({ min: 1, max: 120 }),
  goal_id:      { rule: v.nullable(v.int({ min: 1 })), default: null },
  notes:        { rule: v.string({ max: 2000 }), default: '' },
  icon:         { rule: v.emoji(), default: '✅' },
  color:        { rule: v.color(), default: '#6366f1' },
  category:     { rule: v.oneOf(CATEGORIES), default: 'personal' },
  priority:     { rule: v.oneOf(['low', 'normal', 'high']), default: 'normal' },
  start_time:   { rule: v.nullable(v.time()), default: null },
  duration_min: { rule: v.int({ min: 0, max: 1440 }), default: 0 },
  repeat_type:  { rule: v.oneOf(['daily', 'weekly', 'interval', 'monthly', 'once']), default: 'daily' },
  repeat_days:  { rule: v.numberList({ min: 0, max: 31 }), default: '' },
  repeat_every: { rule: v.int({ min: 1, max: 365 }), default: 1 },
  start_date:   v.date(),
  end_date:     { rule: v.nullable(v.date()), default: null },
  goal_type:    { rule: v.oneOf(['check', 'quantity']), default: 'check' },
  target_value: { rule: v.number({ min: 0.01, max: 1e6 }), default: 1 },
  unit:         { rule: v.string({ max: 20 }), default: '' },
  reminder_min: { rule: v.nullable(v.int({ min: 0, max: 1440 })), default: null },
};

function decorate(routine) {
  return { ...routine, archived: !!routine.archived, repeat_label: describeRepeat(routine) };
}

async function ownedRoutine(userId, id) {
  const routine = (await db.prepare('SELECT * FROM routines WHERE id = ? AND user_id = ?').get(id, userId));
  if (!routine) throw ApiError.notFound('Routine not found');
  return routine;
}

/**
 * A goal id arrives from the client, so it has to be proven to belong to this
 * account — the foreign key alone would happily point at someone else's goal.
 */
async function assertGoalOwned(userId, goalId) {
  if (!goalId) return;
  const goal = (await db.prepare('SELECT id FROM goals WHERE id = ? AND user_id = ?').get(goalId, userId));
  if (!goal) throw ApiError.badRequest('That goal does not exist', { goal_id: 'Unknown goal' });
}

/** Reject rules that would never fire, before they silently disappear from the UI. */
function assertCoherent(data) {
  if (data.end_date && data.start_date && data.end_date < data.start_date) {
    throw ApiError.badRequest('The end date must be after the start date', { end_date: 'Must be after the start date' });
  }
  if (data.repeat_type === 'weekly' && data.repeat_days) {
    const days = data.repeat_days.split(',').filter(Boolean).map(Number);
    if (days.some((d) => d > 6)) {
      throw ApiError.badRequest('Weekdays must be between 0 (Sunday) and 6 (Saturday)', { repeat_days: 'Invalid weekday' });
    }
  }
  if (data.repeat_type === 'monthly' && data.repeat_days) {
    const days = data.repeat_days.split(',').filter(Boolean).map(Number);
    if (days.some((d) => d < 1 || d > 31)) {
      throw ApiError.badRequest('Month days must be between 1 and 31', { repeat_days: 'Invalid day of month' });
    }
  }
  if (data.goal_type === 'quantity' && !data.unit) {
    throw ApiError.badRequest('Add a unit for a measurable routine (pages, km, glasses…)', { unit: 'Unit is required' });
  }
}

/**
 * The library, in the user's own order (drag-and-drop on the Routines page
 * writes sort_order). It used to sort by start time first, which made
 * sort_order a mere tie-break and any reordering invisible. The day view
 * has its own endpoint and stays in clock order.
 */
routinesRouter.get('/', asyncHandler(async (req, res) => {
  const includeArchived = req.query.archived === 'all' || req.query.archived === '1';
  const rows = (await db.prepare(
    `SELECT * FROM routines
     WHERE user_id = ? ${includeArchived ? '' : 'AND archived = 0'}
     ORDER BY archived ASC, sort_order ASC, id ASC`,
  ).all(req.user.id));

  res.json({ routines: rows.map(decorate), categories: CATEGORIES });
}));

routinesRouter.get('/:id', asyncHandler(async (req, res) => {
  const routine = await ownedRoutine(req.user.id, req.params.id);
  const today = todayIn(req.user.timezone);
  const from = addDays(today, -89);

  const logs = (await db.prepare(
    'SELECT * FROM logs WHERE routine_id = ? AND log_date BETWEEN ? AND ? ORDER BY log_date',
  ).all(routine.id, from, today));

  const history = dateRange(from, today)
    .filter((d) => isDueOn(routine, d))
    .map((date) => {
      const log = logs.find((l) => l.log_date === date);
      return { date, status: log?.status || 'pending', value: log?.value ?? 0, note: log?.note || '' };
    });

  res.json({
    routine: decorate(routine),
    stats: routineStats(routine, logs, from, today, today),
    history,
  });
}));

routinesRouter.post('/', asyncHandler(async (req, res) => {
  const body = { start_date: todayIn(req.user.timezone), ...req.body };
  const data = validate(body, writeSchema);
  assertCoherent(data);
  await assertGoalOwned(req.user.id, data.goal_id);

  const sort_order = (await db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM routines WHERE user_id = ?')
    .get(req.user.id)).next;

  const info = (await db.prepare(
    `INSERT INTO routines (
       user_id, goal_id, title, notes, icon, color, category, priority, start_time, duration_min,
       repeat_type, repeat_days, repeat_every, start_date, end_date,
       goal_type, target_value, unit, reminder_min, sort_order
     ) VALUES (
       @user_id, @goal_id, @title, @notes, @icon, @color, @category, @priority, @start_time, @duration_min,
       @repeat_type, @repeat_days, @repeat_every, @start_date, @end_date,
       @goal_type, @target_value, @unit, @reminder_min, @sort_order
     ) RETURNING id`,
  ).run({ ...data, user_id: req.user.id, sort_order }));

  const routine = (await db.prepare('SELECT * FROM routines WHERE id = ?').get(info.lastInsertRowid));
  res.status(201).json({ routine: decorate(routine) });
}));

routinesRouter.patch('/:id', asyncHandler(async (req, res) => {
  const existing = await ownedRoutine(req.user.id, req.params.id);
  const data = validate(req.body, { ...writeSchema, archived: v.bool(), sort_order: v.int({ min: 0, max: 1e6 }) }, { partial: true });
  if (Object.keys(data).length === 0) throw ApiError.badRequest('Nothing to update');
  assertCoherent({ ...existing, ...data });
  if ('goal_id' in data) await assertGoalOwned(req.user.id, data.goal_id);

  const sets = Object.keys(data).map((k) => `${k} = @${k}`).join(', ');
  (await db.prepare(
    `UPDATE routines SET ${sets}, updated_at = utc_now()
     WHERE id = @id AND user_id = @user_id`,
  ).run({ ...data, id: existing.id, user_id: req.user.id }));

  res.json({ routine: decorate((await db.prepare('SELECT * FROM routines WHERE id = ?').get(existing.id))) });
}));

/** Reorder in one request so drag-and-drop doesn't fire N calls. */
routinesRouter.post('/reorder', asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
  if (!ids?.length) throw ApiError.badRequest('Send an array of routine ids');

  await tx(async (t) => {
    const update = t.prepare('UPDATE routines SET sort_order = ? WHERE id = ? AND user_id = ?');
    for (const [index, id] of ids.entries()) await update.run(index + 1, id, req.user.id);
  });

  res.json({ ok: true });
}));

routinesRouter.delete('/:id', asyncHandler(async (req, res) => {
  const routine = await ownedRoutine(req.user.id, req.params.id);
  (await db.prepare('DELETE FROM routines WHERE id = ? AND user_id = ?').run(routine.id, req.user.id));
  res.json({ ok: true });
}));

/**
 * Move one day's occurrence to the next day.
 *
 * What "postpone" means depends on the routine. A one-off has nothing to
 * recur, so the routine itself changes date. A repeating one must keep its
 * rule — the day being left is marked skipped, and the occurrence reappears
 * tomorrow: for a daily routine the rule already lands there, so nothing is
 * created; for a weekly, monthly or every-N-days routine it would not, so a
 * single-day copy is placed on tomorrow instead.
 */
routinesRouter.post('/:id/postpone', asyncHandler(async (req, res) => {
  const routine = await ownedRoutine(req.user.id, req.params.id);
  const { date: from } = validate(
    { date: req.body?.date ?? todayIn(req.user.timezone) },
    { date: v.date() },
  );
  if (!isDueOn(routine, from)) throw ApiError.badRequest('That routine is not scheduled on that day');

  const to = addDays(from, 1);

  const result = await tx(async (t) => {
    if (routine.repeat_type === 'once') {
      // An end date still sitting on the old day would hide the routine the
      // moment it moves past it, so it travels with the start date.
      const end_date = routine.end_date && routine.end_date < to ? to : routine.end_date;
      await t.prepare(
        'UPDATE routines SET start_date = ?, end_date = ?, updated_at = utc_now() WHERE id = ? AND user_id = ?',
      ).run(to, end_date, routine.id, req.user.id);
      // A log on the old day describes an occurrence that no longer exists.
      await t.prepare('DELETE FROM logs WHERE routine_id = ? AND log_date = ?').run(routine.id, from);
      return { moved: 'shifted', id: routine.id };
    }

    await t.prepare(
      `INSERT INTO logs (routine_id, user_id, log_date, status, value, note)
       VALUES (@routine_id, @user_id, @log_date, 'skipped', 0, '')
       ON CONFLICT (routine_id, log_date)
       DO UPDATE SET status = 'skipped', value = 0, completed_at = utc_now()`,
    ).run({ routine_id: routine.id, user_id: req.user.id, log_date: from });

    if (isDueOn(routine, to)) return { moved: 'skipped', id: routine.id };

    const { next: sort_order } = await t.prepare(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM routines WHERE user_id = ?',
    ).get(req.user.id);

    // The copy keeps the title: it is the same piece of work, just later.
    const info = await t.prepare(
      `INSERT INTO routines (
         user_id, goal_id, title, notes, icon, color, category, priority, start_time, duration_min,
         repeat_type, repeat_days, repeat_every, start_date, end_date,
         goal_type, target_value, unit, reminder_min, sort_order
       )
       SELECT user_id, goal_id, title, notes, icon, color, category, priority, start_time, duration_min,
              'once', '', 1, ?, NULL,
              goal_type, target_value, unit, reminder_min, ?
       FROM routines WHERE id = ? AND user_id = ?
       RETURNING id`,
    ).run(to, sort_order, routine.id, req.user.id);

    return { moved: 'copied', id: info.lastInsertRowid };
  });

  const moved = await db.prepare('SELECT * FROM routines WHERE id = ?').get(result.id);
  res.json({ ok: true, moved: result.moved, date: to, routine: decorate(moved) });
}));

/** Copy a routine, including its schedule — handy for near-identical habits. */
routinesRouter.post('/:id/duplicate', asyncHandler(async (req, res) => {
  const source = await ownedRoutine(req.user.id, req.params.id);
  const sort_order = (await db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM routines WHERE user_id = ?')
    .get(req.user.id)).next;

  const info = (await db.prepare(
    `INSERT INTO routines (
       user_id, goal_id, title, notes, icon, color, category, priority, start_time, duration_min,
       repeat_type, repeat_days, repeat_every, start_date, end_date,
       goal_type, target_value, unit, reminder_min, sort_order
     )
     SELECT user_id, goal_id, title || ' (copy)', notes, icon, color, category, priority, start_time, duration_min,
            repeat_type, repeat_days, repeat_every, start_date, end_date,
            goal_type, target_value, unit, reminder_min, ?
     FROM routines WHERE id = ? AND user_id = ?
     RETURNING id`,
  ).run(sort_order, source.id, req.user.id));

  res.status(201).json({ routine: decorate((await db.prepare('SELECT * FROM routines WHERE id = ?').get(info.lastInsertRowid))) });
}));
