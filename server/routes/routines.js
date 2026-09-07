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

function ownedRoutine(userId, id) {
  const routine = db.prepare('SELECT * FROM routines WHERE id = ? AND user_id = ?').get(id, userId);
  if (!routine) throw ApiError.notFound('Routine not found');
  return routine;
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

routinesRouter.get('/', asyncHandler(async (req, res) => {
  const includeArchived = req.query.archived === 'all' || req.query.archived === '1';
  const rows = db.prepare(
    `SELECT * FROM routines
     WHERE user_id = ? ${includeArchived ? '' : 'AND archived = 0'}
     ORDER BY archived ASC,
              CASE WHEN start_time IS NULL THEN 1 ELSE 0 END,
              start_time ASC, sort_order ASC, id ASC`,
  ).all(req.user.id);

  res.json({ routines: rows.map(decorate), categories: CATEGORIES });
}));

routinesRouter.get('/:id', asyncHandler(async (req, res) => {
  const routine = ownedRoutine(req.user.id, req.params.id);
  const today = todayIn(req.user.timezone);
  const from = addDays(today, -89);

  const logs = db.prepare(
    'SELECT * FROM logs WHERE routine_id = ? AND log_date BETWEEN ? AND ? ORDER BY log_date',
  ).all(routine.id, from, today);

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

  const sort_order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM routines WHERE user_id = ?')
    .get(req.user.id).next;

  const info = db.prepare(
    `INSERT INTO routines (
       user_id, title, notes, icon, color, category, priority, start_time, duration_min,
       repeat_type, repeat_days, repeat_every, start_date, end_date,
       goal_type, target_value, unit, reminder_min, sort_order
     ) VALUES (
       @user_id, @title, @notes, @icon, @color, @category, @priority, @start_time, @duration_min,
       @repeat_type, @repeat_days, @repeat_every, @start_date, @end_date,
       @goal_type, @target_value, @unit, @reminder_min, @sort_order
     )`,
  ).run({ ...data, user_id: req.user.id, sort_order });

  const routine = db.prepare('SELECT * FROM routines WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ routine: decorate(routine) });
}));

routinesRouter.patch('/:id', asyncHandler(async (req, res) => {
  const existing = ownedRoutine(req.user.id, req.params.id);
  const data = validate(req.body, { ...writeSchema, archived: v.bool(), sort_order: v.int({ min: 0, max: 1e6 }) }, { partial: true });
  if (Object.keys(data).length === 0) throw ApiError.badRequest('Nothing to update');
  assertCoherent({ ...existing, ...data });

  const sets = Object.keys(data).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(
    `UPDATE routines SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = @id AND user_id = @user_id`,
  ).run({ ...data, id: existing.id, user_id: req.user.id });

  res.json({ routine: decorate(db.prepare('SELECT * FROM routines WHERE id = ?').get(existing.id)) });
}));

/** Reorder in one request so drag-and-drop doesn't fire N calls. */
routinesRouter.post('/reorder', asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
  if (!ids?.length) throw ApiError.badRequest('Send an array of routine ids');

  const stmt = db.prepare('UPDATE routines SET sort_order = ? WHERE id = ? AND user_id = ?');
  tx(() => ids.forEach((id, i) => stmt.run(i + 1, id, req.user.id)));

  res.json({ ok: true });
}));

routinesRouter.delete('/:id', asyncHandler(async (req, res) => {
  const routine = ownedRoutine(req.user.id, req.params.id);
  db.prepare('DELETE FROM routines WHERE id = ? AND user_id = ?').run(routine.id, req.user.id);
  res.json({ ok: true });
}));

/** Copy a routine, including its schedule — handy for near-identical habits. */
routinesRouter.post('/:id/duplicate', asyncHandler(async (req, res) => {
  const source = ownedRoutine(req.user.id, req.params.id);
  const sort_order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM routines WHERE user_id = ?')
    .get(req.user.id).next;

  const info = db.prepare(
    `INSERT INTO routines (
       user_id, title, notes, icon, color, category, priority, start_time, duration_min,
       repeat_type, repeat_days, repeat_every, start_date, end_date,
       goal_type, target_value, unit, reminder_min, sort_order
     )
     SELECT user_id, title || ' (copy)', notes, icon, color, category, priority, start_time, duration_min,
            repeat_type, repeat_days, repeat_every, start_date, end_date,
            goal_type, target_value, unit, reminder_min, ?
     FROM routines WHERE id = ? AND user_id = ?`,
  ).run(sort_order, source.id, req.user.id);

  res.status(201).json({ routine: decorate(db.prepare('SELECT * FROM routines WHERE id = ?').get(info.lastInsertRowid)) });
}));
