import express from 'express';
import { db } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../middleware/error.js';
import { TEMPLATES, applyTemplate } from '../lib/starter.js';
import { publicUser } from '../lib/auth.js';
import { describeRepeat } from '../lib/schedule.js';

export const miscRouter = express.Router();

miscRouter.get('/templates', (_req, res) => {
  res.json({
    templates: TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      icon: t.icon,
      accent: t.accent,
      count: t.routines.length,
      preview: t.routines.map((r) => ({
        title: r.title,
        icon: r.icon,
        start_time: r.start_time || null,
        repeat_label: describeRepeat({ repeat_type: r.repeat_type || 'daily', repeat_days: r.repeat_days || '', repeat_every: 1, start_date: '' }),
      })),
    })),
  });
});

miscRouter.post('/templates/:id/apply', asyncHandler(async (req, res) => {
  const count = applyTemplate(req.user, req.params.id);
  if (count === null) throw ApiError.notFound('Template not found');
  res.status(201).json({ ok: true, created: count });
}));

/** Full data export — the user's data belongs to them. */
miscRouter.get('/export', asyncHandler(async (req, res) => {
  const payload = {
    exported_at: new Date().toISOString(),
    format: 'routine-tracker/v1',
    user: publicUser(req.user),
    goals: db.prepare('SELECT * FROM goals WHERE user_id = ? ORDER BY id').all(req.user.id),
    routines: db.prepare('SELECT * FROM routines WHERE user_id = ? ORDER BY id').all(req.user.id),
    logs: db.prepare('SELECT * FROM logs WHERE user_id = ? ORDER BY log_date').all(req.user.id),
    journal: db.prepare('SELECT * FROM journal WHERE user_id = ? ORDER BY entry_date').all(req.user.id),
    achievements: db.prepare('SELECT code, unlocked_at FROM achievements WHERE user_id = ?').all(req.user.id),
  };

  res.set('Content-Disposition', `attachment; filename="routine-tracker-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(payload);
}));

/** CSV export of the log history, for spreadsheets. */
miscRouter.get('/export.csv', asyncHandler(async (req, res) => {
  const rows = db.prepare(
    `SELECT l.log_date, r.title, r.category, r.start_time, l.status, l.value, r.unit, l.note
     FROM logs l JOIN routines r ON r.id = l.routine_id
     WHERE l.user_id = ? ORDER BY l.log_date DESC, r.start_time`,
  ).all(req.user.id);

  const header = ['date', 'routine', 'category', 'time', 'status', 'value', 'unit', 'note'];
  const escape = (val) => {
    const s = String(val ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header.join(',')]
    .concat(rows.map((r) => [r.log_date, r.title, r.category, r.start_time || '', r.status, r.value, r.unit, r.note].map(escape).join(',')))
    .join('\n');

  res.type('text/csv');
  res.set('Content-Disposition', `attachment; filename="routine-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
}));

/** Search across routines and journal entries — powers the command palette. */
miscRouter.get('/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ routines: [], journal: [] });
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const routines = db.prepare(
    `SELECT id, title, icon, color, category, start_time, archived FROM routines
     WHERE user_id = ? AND (title LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')
     ORDER BY archived, title LIMIT 12`,
  ).all(req.user.id, like, like, like);

  const journal = db.prepare(
    `SELECT entry_date, mood, substr(body, 1, 140) AS excerpt FROM journal
     WHERE user_id = ? AND body LIKE ? ESCAPE '\\' ORDER BY entry_date DESC LIMIT 8`,
  ).all(req.user.id, like);

  res.json({ routines: routines.map((r) => ({ ...r, archived: !!r.archived })), journal });
}));
