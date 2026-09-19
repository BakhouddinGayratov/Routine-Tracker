import express from 'express';
import { db } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { validate, v } from '../lib/validate.js';
import { asyncHandler } from '../middleware/error.js';
import { todayIn, addDays } from '../lib/dates.js';
import { buildDailySeries, round } from '../lib/stats.js';

export const goalsRouter = express.Router();

/** Progress is reported over a rolling window, the same one the stats page uses. */
const WINDOW_DAYS = 30;

const writeSchema = {
  title:       v.string({ min: 1, max: 120 }),
  description: { rule: v.string({ max: 2000 }), default: '' },
  icon:        { rule: v.emoji(), default: '🎯' },
  color:       { rule: v.color(), default: '#6366f1' },
  target_date: { rule: v.nullable(v.date()), default: null },
  status:      { rule: v.oneOf(['active', 'done', 'archived']), default: 'active' },
};

function ownedGoal(userId, id) {
  const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(id, userId);
  if (!goal) throw ApiError.notFound('Goal not found');
  return goal;
}

/**
 * How the routines pointing at a goal have gone over the window.
 *
 * A goal with no routines reports `completion: null` rather than 0, because
 * "nothing planned yet" and "planned and missed" are different answers and the
 * UI should not show a fresh goal as a failure.
 */
function progressFor(routines, logs, from, to) {
  if (!routines.length) return { routines: 0, due: 0, done: 0, completion: null, series: [] };

  const series = buildDailySeries(routines, logs, from, to);
  const due = series.reduce((sum, day) => sum + day.due, 0);
  const done = series.reduce((sum, day) => sum + day.done, 0);

  return {
    routines: routines.length,
    due,
    done: round(done),
    completion: due === 0 ? null : round((done / due) * 100),
    // One completion rate per day of the window, oldest first, for the card's
    // trend line; null on days with nothing scheduled for this goal.
    series: series.map((day) => day.rate),
  };
}

function decorate(goal, routines, logs, from, to) {
  return {
    ...goal,
    progress: progressFor(routines, logs, from, to),
    routines: routines.map((r) => ({
      id: r.id,
      title: r.title,
      icon: r.icon,
      color: r.color,
      start_time: r.start_time,
    })),
  };
}

goalsRouter.get('/', asyncHandler(async (req, res) => {
  const includeArchived = req.query.status === 'all';
  const goals = db.prepare(
    `SELECT * FROM goals
     WHERE user_id = ? ${includeArchived ? '' : "AND status != 'archived'"}
     ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'done' THEN 1 ELSE 2 END,
              sort_order ASC, id ASC`,
  ).all(req.user.id);

  const to = todayIn(req.user.timezone);
  const from = addDays(to, -(WINDOW_DAYS - 1));

  // One pass over the routines and logs, then split per goal — a query per
  // goal would turn a page of ten goals into twenty round-trips.
  const routines = db.prepare('SELECT * FROM routines WHERE user_id = ? AND archived = 0').all(req.user.id);
  const logs = db.prepare('SELECT * FROM logs WHERE user_id = ? AND log_date BETWEEN ? AND ?')
    .all(req.user.id, from, to);

  res.json({
    goals: goals.map((goal) => decorate(goal, routines.filter((r) => r.goal_id === goal.id), logs, from, to)),
    unassigned: routines.filter((r) => !r.goal_id).length,
    window_days: WINDOW_DAYS,
  });
}));

goalsRouter.post('/', asyncHandler(async (req, res) => {
  const data = validate(req.body, writeSchema);

  const sort_order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM goals WHERE user_id = ?')
    .get(req.user.id).next;

  const info = db.prepare(
    `INSERT INTO goals (user_id, title, description, icon, color, target_date, status, sort_order)
     VALUES (@user_id, @title, @description, @icon, @color, @target_date, @status, @sort_order)`,
  ).run({ ...data, user_id: req.user.id, sort_order });

  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(info.lastInsertRowid);
  const today = todayIn(req.user.timezone);
  res.status(201).json({ goal: decorate(goal, [], [], today, today) });
}));

goalsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const existing = ownedGoal(req.user.id, req.params.id);
  const data = validate(req.body, { ...writeSchema, sort_order: v.int({ min: 0, max: 1e6 }) }, { partial: true });
  if (Object.keys(data).length === 0) throw ApiError.badRequest('Nothing to update');

  const sets = Object.keys(data).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(
    `UPDATE goals SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = @id AND user_id = @user_id`,
  ).run({ ...data, id: existing.id, user_id: req.user.id });

  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(existing.id);
  const to = todayIn(req.user.timezone);
  const from = addDays(to, -(WINDOW_DAYS - 1));
  const routines = db.prepare('SELECT * FROM routines WHERE user_id = ? AND goal_id = ? AND archived = 0')
    .all(req.user.id, goal.id);
  const logs = db.prepare('SELECT * FROM logs WHERE user_id = ? AND log_date BETWEEN ? AND ?')
    .all(req.user.id, from, to);

  res.json({ goal: decorate(goal, routines, logs, from, to) });
}));

/**
 * Deleting a goal keeps its routines: the schema's ON DELETE SET NULL clears
 * the link, so the work survives even when the reason for it is dropped.
 */
goalsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const goal = ownedGoal(req.user.id, req.params.id);
  const unlinked = db.prepare('SELECT COUNT(*) AS n FROM routines WHERE goal_id = ? AND user_id = ?')
    .get(goal.id, req.user.id).n;

  db.prepare('DELETE FROM goals WHERE id = ? AND user_id = ?').run(goal.id, req.user.id);
  res.json({ ok: true, unlinked });
}));
