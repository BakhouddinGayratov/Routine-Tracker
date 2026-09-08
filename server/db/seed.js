/**
 * Demo data generator.
 *
 *   node server/db/seed.js [email] [password]
 *
 * Creates (or resets) a demo account with a full routine set and roughly three
 * months of plausible history, so the dashboard, charts and achievements have
 * something real to show during development.
 */
import bcrypt from 'bcryptjs';
import { db, tx } from './index.js';
import { TEMPLATES } from '../lib/starter.js';
import { isDueOn } from '../lib/schedule.js';
import { addDays, todayIn } from '../lib/dates.js';

const email = (process.argv[2] || 'demo@routine.app').toLowerCase();
const password = process.argv[3] || 'demopass123';
const DAYS = 92;

const today = todayIn('UTC');
const start = addDays(today, -(DAYS - 1));

db.prepare('DELETE FROM users WHERE email = ?').run(email);

const info = db.prepare(
  `INSERT INTO users (email, name, password_hash, timezone, locale, theme, daily_goal, avatar_color)
   VALUES (?, ?, ?, 'UTC', 'en', 'dark', 80, '#6366f1')`,
).run(email, 'Demo User', bcrypt.hashSync(password, 10));

const userId = info.lastInsertRowid;

// Take routines from three template packs for a varied, realistic schedule.
const routines = ['morning', 'fitness', 'study']
  .flatMap((id) => TEMPLATES.find((tpl) => tpl.id === id).routines);

// Two goals, each fed by one category of routine. The morning routines stay
// unassigned on purpose, so the demo also shows what "no goal" looks like.
const insertGoal = db.prepare(
  `INSERT INTO goals (user_id, title, description, icon, color, target_date)
   VALUES (?, ?, ?, ?, ?, ?)`,
);

const goalByCategory = {};
tx(() => {
  goalByCategory.fitness = insertGoal.run(
    userId, 'Run a 10K', 'Build up to a full 10 kilometres without stopping.', '🏃', '#f97316',
    addDays(today, 90),
  ).lastInsertRowid;

  goalByCategory.study = insertGoal.run(
    userId, 'Finish the course', 'One chapter at a time, every weekday.', '📚', '#3b82f6',
    addDays(today, 45),
  ).lastInsertRowid;
});

const insertRoutine = db.prepare(
  `INSERT INTO routines (
     user_id, goal_id, title, notes, icon, color, category, priority, start_time, duration_min,
     repeat_type, repeat_days, repeat_every, start_date, goal_type, target_value, unit, sort_order
   ) VALUES (
     @user_id, @goal_id, @title, '', @icon, @color, @category, @priority, @start_time, @duration_min,
     @repeat_type, @repeat_days, 1, @start_date, @goal_type, @target_value, @unit, @sort_order
   )`,
);

const created = [];
tx(() => {
  routines.forEach((routine, index) => {
    const row = {
      user_id: userId,
      goal_id: goalByCategory[routine.category] ?? null,
      title: routine.title,
      icon: routine.icon || '✅',
      color: routine.color || '#6366f1',
      category: routine.category || 'personal',
      priority: routine.priority || 'normal',
      start_time: routine.start_time || null,
      duration_min: routine.duration_min || 0,
      repeat_type: routine.repeat_type || 'daily',
      repeat_days: routine.repeat_days || '',
      start_date: start,
      goal_type: routine.goal_type || 'check',
      target_value: routine.target_value ?? 1,
      unit: routine.unit || '',
      sort_order: index + 1,
    };
    const result = insertRoutine.run(row);
    created.push({ ...row, id: result.lastInsertRowid });
  });
});

const insertLog = db.prepare(
  `INSERT OR IGNORE INTO logs (routine_id, user_id, log_date, status, value, completed_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
);

// Adherence that improves over time, dips at weekends, and varies per routine —
// a flat 80% random draw produces charts that look fake.
let logCount = 0;
tx(() => {
  for (let offset = 0; offset < DAYS; offset += 1) {
    const date = addDays(start, offset);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const ramp = 0.55 + (offset / DAYS) * 0.38;
    const weekendPenalty = weekday === 0 || weekday === 6 ? 0.16 : 0;

    for (const routine of created) {
      if (!isDueOn({ ...routine, end_date: null }, date)) continue;
      const bias = routine.priority === 'high' ? 0.1 : routine.priority === 'low' ? -0.08 : 0;
      const chance = ramp + bias - weekendPenalty;
      const roll = Math.random();

      if (roll < chance) {
        const value = routine.goal_type === 'quantity' ? routine.target_value : 1;
        insertLog.run(routine.id, userId, date, 'done', value, `${date}T${routine.start_time || '12:00'}:00Z`);
        logCount += 1;
      } else if (routine.goal_type === 'quantity' && roll < chance + 0.14) {
        const value = Math.round(routine.target_value * (0.3 + Math.random() * 0.4));
        insertLog.run(routine.id, userId, date, 'partial', value, `${date}T12:00:00Z`);
        logCount += 1;
      }
    }
  }
});

// A handful of journal entries, weighted towards recent days.
const insertJournal = db.prepare(
  `INSERT OR IGNORE INTO journal (user_id, entry_date, mood, energy, body) VALUES (?, ?, ?, ?, ?)`,
);
const notes = [
  'Good focus in the morning block. Slept well, and it showed.',
  'Skipped the gym — travel day. Still hit the reading target.',
  'Rough start, but the evening routine pulled the day back.',
  'Best day this week. Everything done before 20:00.',
  'Low energy. Kept the streak alive with the small habits.',
  'Long work session; deep work blocks are finally sticking.',
];
tx(() => {
  for (let offset = 0; offset < 26; offset += 1) {
    const date = addDays(today, -offset * 2);
    if (date < start) break;
    insertJournal.run(
      userId, date,
      1 + Math.floor(Math.random() * 5),
      1 + Math.floor(Math.random() * 5),
      notes[offset % notes.length],
    );
  }
});

console.log(`
  Seeded demo account
    email:    ${email}
    password: ${password}
    routines: ${created.length}
    logs:     ${logCount}
    range:    ${start} → ${today}
`);
