import { isDueOn } from './schedule.js';
import { addDays, dateRange, daysBetween, weekday } from './dates.js';

/**
 * Build a per-day summary for a date range.
 *
 * For every day we count how many routines were *due* (from their recurrence
 * rules) and how many were actually logged as done. A day with nothing
 * scheduled has `due === 0` and is excluded from rate averages so that rest
 * days don't drag the numbers down.
 *
 * @returns {Array<{date, due, done, skipped, rate}>}
 */
export function buildDailySeries(routines, logs, from, to) {
  const byDate = new Map();
  for (const log of logs) {
    if (!byDate.has(log.log_date)) byDate.set(log.log_date, new Map());
    byDate.get(log.log_date).set(log.routine_id, log);
  }

  return dateRange(from, to).map((date) => {
    const dayLogs = byDate.get(date);
    let due = 0;
    let done = 0;
    let skipped = 0;

    for (const routine of routines) {
      if (!isDueOn(routine, date)) continue;
      due += 1;
      const log = dayLogs?.get(routine.id);
      if (!log) continue;
      if (log.status === 'done') done += 1;
      else if (log.status === 'skipped') skipped += 1;
      else if (log.status === 'partial') done += partialCredit(routine, log);
    }

    return {
      date,
      due,
      done: round(done),
      skipped,
      rate: due === 0 ? null : round((done / due) * 100),
    };
  });
}

/** A partial quantity log counts as the fraction of the target reached. */
function partialCredit(routine, log) {
  if (routine.goal_type !== 'quantity' || !routine.target_value) return 0.5;
  return Math.min(1, Math.max(0, log.value / routine.target_value));
}

/**
 * Day-level streaks: consecutive days meeting `goalRate` (percent).
 * Days with nothing scheduled are transparent — they neither extend nor break
 * a streak, because punishing a planned rest day is bad habit design.
 * Today is only allowed to break the streak once it is over.
 */
export function computeStreak(series, goalRate = 100, today = null) {
  let current = 0;
  let longest = 0;
  let running = 0;

  for (const day of series) {
    if (day.due === 0) continue;
    if (day.rate >= goalRate) {
      running += 1;
      longest = Math.max(longest, running);
    } else {
      running = 0;
    }
  }

  // Walk backwards for the *current* streak so an unfinished today is forgiven.
  for (let i = series.length - 1; i >= 0; i--) {
    const day = series[i];
    if (day.due === 0) continue;
    if (day.rate >= goalRate) {
      current += 1;
    } else if (today && day.date === today) {
      continue; // the day isn't over yet
    } else {
      break;
    }
  }

  return { current, longest: Math.max(longest, current) };
}

/** Per-routine completion + streak stats over the range. */
export function routineStats(routine, logs, from, to, today) {
  const done = new Set(
    logs.filter((l) => l.routine_id === routine.id && l.status === 'done').map((l) => l.log_date),
  );
  const dates = dateRange(from, to).filter((d) => isDueOn(routine, d));
  const completed = dates.filter((d) => done.has(d));

  let current = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    if (done.has(dates[i])) current += 1;
    else if (dates[i] === today) continue;
    else break;
  }

  let longest = 0;
  let run = 0;
  for (const d of dates) {
    if (done.has(d)) { run += 1; longest = Math.max(longest, run); }
    else run = 0;
  }

  return {
    id: routine.id,
    title: routine.title,
    icon: routine.icon,
    color: routine.color,
    category: routine.category,
    due: dates.length,
    done: completed.length,
    rate: dates.length ? round((completed.length / dates.length) * 100) : null,
    streak: current,
    best_streak: Math.max(longest, current),
    last_done: completed.length ? completed[completed.length - 1] : null,
  };
}

/** Average completion rate per weekday (0 = Sunday). */
export function weekdayBreakdown(series) {
  const buckets = Array.from({ length: 7 }, () => ({ due: 0, done: 0 }));
  for (const day of series) {
    if (day.due === 0) continue;
    const bucket = buckets[weekday(day.date)];
    bucket.due += day.due;
    bucket.done += day.done;
  }
  return buckets.map((b, i) => ({
    weekday: i,
    due: b.due,
    done: round(b.done),
    rate: b.due ? round((b.done / b.due) * 100) : null,
  }));
}

/** Completion rate grouped by routine category. */
export function categoryBreakdown(routines, logs, from, to) {
  const map = new Map();
  for (const routine of routines) {
    const stats = routineStats(routine, logs, from, to, null);
    const entry = map.get(routine.category) || { category: routine.category, due: 0, done: 0, routines: 0 };
    entry.due += stats.due;
    entry.done += stats.done;
    entry.routines += 1;
    map.set(routine.category, entry);
  }
  return [...map.values()]
    .map((e) => ({ ...e, rate: e.due ? round((e.done / e.due) * 100) : null }))
    .sort((a, b) => b.due - a.due);
}

/**
 * Total XP. Each completed routine is worth points weighted by priority, with a
 * bonus for perfect days — enough structure to make progress feel earned
 * without turning the app into a slot machine.
 */
export function computeXp(routines, logs, series) {
  const weight = { low: 5, normal: 10, high: 15 };
  const byId = new Map(routines.map((r) => [r.id, r]));
  let xp = 0;
  for (const log of logs) {
    if (log.status !== 'done') continue;
    const routine = byId.get(log.routine_id);
    xp += weight[routine?.priority] ?? 10;
  }
  xp += series.filter((d) => d.due > 0 && d.rate === 100).length * 25;
  return Math.round(xp);
}

/** XP → level curve. Each level costs 20% more than the previous one. */
export function levelFromXp(xp) {
  let level = 1;
  let need = 100;
  let spent = 0;
  while (xp >= spent + need) {
    spent += need;
    level += 1;
    need = Math.round(need * 1.2);
  }
  return { level, xp, into_level: xp - spent, level_size: need, progress: round(((xp - spent) / need) * 100) };
}

export function round(n) {
  return Math.round(n * 10) / 10;
}

export { addDays, daysBetween };
