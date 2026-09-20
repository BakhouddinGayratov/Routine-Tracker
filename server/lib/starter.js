import { db, tx } from '../db/index.js';
import { todayIn } from './dates.js';

/**
 * Ready-made routine packs.
 *
 * Building a routine system from a blank page is the hardest part of starting,
 * so the app ships opinionated packs a user can apply in one click and then
 * edit freely.
 */
export const TEMPLATES = [
  {
    id: 'morning',
    name: 'Morning Kickstart',
    description: 'A calm, repeatable start to the day.',
    icon: '🌅',
    accent: '#f59e0b',
    routines: [
      { title: 'Wake up',           icon: '⏰', start_time: '06:30', duration_min: 5,  category: 'personal', color: '#f59e0b', priority: 'high' },
      { title: 'Drink water',       icon: '💧', start_time: '06:40', duration_min: 2,  category: 'health',   color: '#0ea5e9', goal_type: 'quantity', target_value: 2, unit: 'glasses' },
      { title: 'Stretch',           icon: '🧘', start_time: '06:45', duration_min: 10, category: 'fitness',  color: '#22c55e' },
      { title: 'Plan the day',      icon: '🗒️', start_time: '07:00', duration_min: 10, category: 'work',     color: '#6366f1', priority: 'high' },
      { title: 'Healthy breakfast', icon: '🥣', start_time: '07:30', duration_min: 20, category: 'health',   color: '#ec4899' },
    ],
  },
  {
    id: 'deepwork',
    name: 'Deep Work',
    description: 'Protected focus blocks on weekdays.',
    icon: '🎯',
    accent: '#6366f1',
    routines: [
      { title: 'Focus block #1', icon: '🧠', start_time: '09:00', duration_min: 90, category: 'work',  color: '#6366f1', priority: 'high', repeat_type: 'weekly', repeat_days: '1,2,3,4,5' },
      { title: 'Inbox sweep',    icon: '📧', start_time: '11:00', duration_min: 20, category: 'work',  color: '#64748b', repeat_type: 'weekly', repeat_days: '1,2,3,4,5' },
      { title: 'Focus block #2', icon: '🧠', start_time: '14:00', duration_min: 90, category: 'work',  color: '#6366f1', priority: 'high', repeat_type: 'weekly', repeat_days: '1,2,3,4,5' },
      { title: 'Shutdown ritual',icon: '🌇', start_time: '18:00', duration_min: 15, category: 'work',  color: '#a855f7', repeat_type: 'weekly', repeat_days: '1,2,3,4,5' },
    ],
  },
  {
    id: 'fitness',
    name: 'Fitness Base',
    description: 'Move often, recover properly.',
    icon: '🏋️',
    accent: '#22c55e',
    routines: [
      { title: 'Strength training', icon: '🏋️', start_time: '18:30', duration_min: 60, category: 'fitness', color: '#22c55e', priority: 'high', repeat_type: 'weekly', repeat_days: '1,3,5' },
      { title: 'Walk 8 000 steps',  icon: '🚶', duration_min: 0,  category: 'fitness', color: '#14b8a6', goal_type: 'quantity', target_value: 8000, unit: 'steps' },
      { title: 'Sleep by 23:00',    icon: '😴', start_time: '23:00', duration_min: 0, category: 'health',  color: '#8b5cf6', priority: 'high' },
    ],
  },
  {
    id: 'study',
    name: 'Study Plan',
    description: 'Consistent learning that actually sticks.',
    icon: '📚',
    accent: '#0ea5e9',
    routines: [
      { title: 'Read 20 pages',   icon: '📖', start_time: '20:00', duration_min: 30, category: 'study', color: '#0ea5e9', goal_type: 'quantity', target_value: 20, unit: 'pages' },
      { title: 'Language practice', icon: '🗣️', start_time: '21:00', duration_min: 20, category: 'study', color: '#f97316' },
      { title: 'Review notes',    icon: '🗂️', duration_min: 15, category: 'study', color: '#8b5cf6', repeat_type: 'weekly', repeat_days: '0,6' },
    ],
  },
  {
    id: 'mindful',
    name: 'Mind & Reset',
    description: 'Small habits that lower the noise.',
    icon: '🧘',
    accent: '#a855f7',
    routines: [
      { title: 'Meditate',        icon: '🧘', start_time: '07:15', duration_min: 10, category: 'mindfulness', color: '#a855f7' },
      { title: 'Gratitude note',  icon: '🙏', start_time: '22:00', duration_min: 5,  category: 'mindfulness', color: '#ec4899' },
      { title: 'No screens hour', icon: '📵', start_time: '22:30', duration_min: 60, category: 'mindfulness', color: '#64748b' },
      { title: 'Weekly review',   icon: '🔍', start_time: '17:00', duration_min: 45, category: 'personal',    color: '#6366f1', repeat_type: 'weekly', repeat_days: '0' },
    ],
  },
];

const DEFAULTS = {
  notes: '',
  icon: '✅',
  color: '#6366f1',
  category: 'personal',
  priority: 'normal',
  start_time: null,
  duration_min: 0,
  repeat_type: 'daily',
  repeat_days: '',
  repeat_every: 1,
  end_date: null,
  goal_type: 'check',
  target_value: 1,
  unit: '',
  reminder_min: null,
};

const INSERT = `
  INSERT INTO routines (
    user_id, title, notes, icon, color, category, priority, start_time, duration_min,
    repeat_type, repeat_days, repeat_every, start_date, end_date,
    goal_type, target_value, unit, reminder_min, sort_order
  ) VALUES (
    @user_id, @title, @notes, @icon, @color, @category, @priority, @start_time, @duration_min,
    @repeat_type, @repeat_days, @repeat_every, @start_date, @end_date,
    @goal_type, @target_value, @unit, @reminder_min, @sort_order
  )`;

/** Insert a template's routines for a user. Returns how many were created. */
export async function applyTemplate(user, templateId) {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) return null;

  const start_date = todayIn(user.timezone);
  const base = (await db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max FROM routines WHERE user_id = ?')
    .get(user.id)).max;

  await tx(async (t) => {
    const insert = t.prepare(INSERT);
    for (const [index, item] of template.routines.entries()) {
      await insert.run({ ...DEFAULTS, ...item, user_id: user.id, start_date, sort_order: base + index + 1 });
    }
  });

  return template.routines.length;
}

/** Small starter set applied at sign-up so the first dashboard isn't empty. */
export async function seedStarterRoutines(user) {
  const start_date = todayIn(user.timezone);
  const starters = [
    { title: 'Drink water',    icon: '💧', start_time: '08:00', duration_min: 2,  category: 'health',      color: '#0ea5e9', goal_type: 'quantity', target_value: 8, unit: 'glasses' },
    { title: 'Plan my day',    icon: '🗒️', start_time: '09:00', duration_min: 10, category: 'work',        color: '#6366f1', priority: 'high' },
    { title: 'Move your body', icon: '🏃', start_time: '18:00', duration_min: 30, category: 'fitness',     color: '#22c55e' },
    { title: 'Read',           icon: '📖', start_time: '21:00', duration_min: 20, category: 'study',       color: '#f97316', goal_type: 'quantity', target_value: 20, unit: 'pages' },
    { title: 'Reflect on today',icon: '🌙', start_time: '22:00', duration_min: 5, category: 'mindfulness', color: '#a855f7' },
  ];

  await tx(async (t) => {
    const insert = t.prepare(INSERT);
    for (const [index, item] of starters.entries()) {
      await insert.run({ ...DEFAULTS, ...item, user_id: user.id, start_date, sort_order: index + 1 });
    }
  });
}
