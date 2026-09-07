import express from 'express';
import { db, tx } from '../db/index.js';
import { asyncHandler } from '../middleware/error.js';
import { todayIn, addDays } from '../lib/dates.js';
import { isDueOn } from '../lib/schedule.js';
import {
  buildDailySeries, computeStreak, routineStats, weekdayBreakdown,
  categoryBreakdown, computeXp, levelFromXp, round,
} from '../lib/stats.js';
import { evaluate } from '../lib/achievements.js';

export const statsRouter = express.Router();

function loadWindow(user, days) {
  const today = todayIn(user.timezone);
  const from = addDays(today, -(days - 1));
  const routines = db.prepare('SELECT * FROM routines WHERE user_id = ?').all(user.id);
  const logs = db.prepare('SELECT * FROM logs WHERE user_id = ? AND log_date BETWEEN ? AND ?')
    .all(user.id, from, today);
  return { today, from, routines, logs };
}

/** Headline numbers for the dashboard. */
statsRouter.get('/overview', asyncHandler(async (req, res) => {
  const days = Math.min(365, Math.max(7, Number(req.query.days) || 30));
  const { today, from, routines, logs } = loadWindow(req.user, days);
  const active = routines.filter((r) => !r.archived);

  const series = buildDailySeries(active, logs, from, today);
  const tracked = series.filter((d) => d.due > 0);
  const totalDue = tracked.reduce((s, d) => s + d.due, 0);
  const totalDone = tracked.reduce((s, d) => s + d.done, 0);

  const streak = computeStreak(series, req.user.daily_goal, today);
  const perfect = computeStreak(series, 100, today);

  // Compare the window with the one immediately before it.
  const prevFrom = addDays(from, -days);
  const prevLogs = db.prepare('SELECT * FROM logs WHERE user_id = ? AND log_date BETWEEN ? AND ?')
    .all(req.user.id, prevFrom, addDays(from, -1));
  const prevSeries = buildDailySeries(active, prevLogs, prevFrom, addDays(from, -1)).filter((d) => d.due > 0);
  const prevDue = prevSeries.reduce((s, d) => s + d.due, 0);
  const prevDone = prevSeries.reduce((s, d) => s + d.done, 0);
  const prevRate = prevDue ? (prevDone / prevDue) * 100 : null;
  const rate = totalDue ? (totalDone / totalDue) * 100 : null;

  const perRoutine = active
    .map((r) => routineStats(r, logs, from, today, today))
    .filter((r) => r.due > 0)
    .sort((a, b) => b.rate - a.rate);

  res.json({
    range: { from, to: today, days },
    totals: {
      routines: active.length,
      archived: routines.length - active.length,
      due: totalDue,
      done: round(totalDone),
      rate: rate === null ? null : round(rate),
      delta: rate === null || prevRate === null ? null : round(rate - prevRate),
      perfect_days: tracked.filter((d) => d.rate === 100).length,
      active_days: tracked.length,
      minutes: round(
        logs.filter((l) => l.status === 'done')
          .reduce((sum, l) => sum + (routines.find((r) => r.id === l.routine_id)?.duration_min || 0), 0),
      ),
    },
    streak,
    perfect_streak: perfect,
    series,
    weekdays: weekdayBreakdown(series),
    categories: categoryBreakdown(active, logs, from, today),
    top: perRoutine.slice(0, 5),
    struggling: [...perRoutine].reverse().slice(0, 5),
  });
}));

/**
 * Lightweight numbers for the app shell: level, streak and today's progress.
 *
 * Deliberately separate from /achievements, which *persists* newly unlocked
 * badges — the shell polls this often and must not consume the "newly
 * unlocked" signal the achievements page uses to celebrate.
 */
statsRouter.get('/summary', asyncHandler(async (req, res) => {
  const today = todayIn(req.user.timezone);
  const routines = db.prepare('SELECT * FROM routines WHERE user_id = ?').all(req.user.id);
  const active = routines.filter((r) => !r.archived);
  const logs = db.prepare('SELECT * FROM logs WHERE user_id = ?').all(req.user.id);

  const firstDate = logs.reduce((min, l) => (min && min < l.log_date ? min : l.log_date), null) || today;
  const series = buildDailySeries(active, logs, firstDate, today);
  const level = levelFromXp(computeXp(routines, logs, series));

  const dueToday = active.filter((r) => isDueOn(r, today));
  const doneToday = new Set(
    logs.filter((l) => l.log_date === today && l.status === 'done').map((l) => l.routine_id),
  );

  res.json({
    date: today,
    xp: level,
    streak: computeStreak(series, req.user.daily_goal, today),
    today: {
      total: dueToday.length,
      done: dueToday.filter((r) => doneToday.has(r.id)).length,
      pending: dueToday.filter((r) => !doneToday.has(r.id)).length,
    },
  });
}));

/** GitHub-style activity heatmap. */
statsRouter.get('/heatmap', asyncHandler(async (req, res) => {
  const days = Math.min(371, Math.max(30, Number(req.query.days) || 364));
  const { today, from, routines, logs } = loadWindow(req.user, days);
  const active = routines.filter((r) => !r.archived);

  // Start at the first day anything was actually scheduled: a long empty run
  // before the account existed says nothing and reads as failure. A floor of
  // eight weeks keeps a brand new account's grid from collapsing to one column.
  const earliest = active.reduce((min, r) => (min && min <= r.start_date ? min : r.start_date), null);
  const floor = addDays(today, -55);
  const clamped = earliest && earliest > from ? earliest : from;
  const start = clamped > floor ? floor : clamped;

  res.json({ from: start, to: today, days: buildDailySeries(active, logs, start, today) });
}));

/** Per-routine leaderboard for the stats page. */
statsRouter.get('/routines', asyncHandler(async (req, res) => {
  const days = Math.min(365, Math.max(7, Number(req.query.days) || 30));
  const { today, from, routines, logs } = loadWindow(req.user, days);
  const rows = routines
    .filter((r) => !r.archived)
    .map((r) => routineStats(r, logs, from, today, today))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
  res.json({ range: { from, to: today, days }, routines: rows });
}));

/**
 * Gamification: XP, level and badges.
 *
 * Newly earned badges are persisted so the client can celebrate them exactly
 * once, while progress on locked ones is recomputed live.
 */
statsRouter.get('/achievements', asyncHandler(async (req, res) => {
  const today = todayIn(req.user.timezone);
  const routines = db.prepare('SELECT * FROM routines WHERE user_id = ?').all(req.user.id);
  const logs = db.prepare('SELECT * FROM logs WHERE user_id = ?').all(req.user.id);
  const active = routines.filter((r) => !r.archived);

  const firstDate = logs.reduce((min, l) => (min && min < l.log_date ? min : l.log_date), null) || today;
  const series = buildDailySeries(active, logs, firstDate, today);
  const doneLogs = logs.filter((l) => l.status === 'done');
  const byId = new Map(routines.map((r) => [r.id, r]));

  const xp = computeXp(routines, logs, series);
  const level = levelFromXp(xp);

  const snapshot = {
    totalDone: doneLogs.length,
    perfectDays: series.filter((d) => d.due > 0 && d.rate === 100).length,
    bestStreak: computeStreak(series, req.user.daily_goal, today).longest,
    routineCount: active.length,
    categoryCount: new Set(active.map((r) => r.category)).size,
    earlyDone: doneLogs.filter((l) => (byId.get(l.routine_id)?.start_time || '99:99') < '08:00').length,
    lateDone: doneLogs.filter((l) => (byId.get(l.routine_id)?.start_time || '00:00') >= '21:00').length,
    journalCount: db.prepare('SELECT COUNT(*) AS n FROM journal WHERE user_id = ?').get(req.user.id).n,
    level: level.level,
  };

  const unlockedRows = db.prepare('SELECT code, unlocked_at FROM achievements WHERE user_id = ?').all(req.user.id);
  const unlockedSet = new Set(unlockedRows.map((r) => r.code));
  const badges = evaluate(snapshot, unlockedSet);

  const fresh = badges.filter((b) => b.unlocked && !unlockedSet.has(b.code));
  if (fresh.length) {
    const stmt = db.prepare('INSERT OR IGNORE INTO achievements (user_id, code) VALUES (?, ?)');
    tx(() => fresh.forEach((b) => stmt.run(req.user.id, b.code)));
  }

  const unlockedAt = new Map(unlockedRows.map((r) => [r.code, r.unlocked_at]));
  res.json({
    xp: level,
    stats: snapshot,
    newly_unlocked: fresh.map((b) => b.code),
    achievements: badges.map((b) => ({ ...b, unlocked_at: unlockedAt.get(b.code) || null })),
  });
}));
