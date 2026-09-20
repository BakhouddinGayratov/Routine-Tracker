import express from 'express';
import { db } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { validate, v } from '../lib/validate.js';
import { asyncHandler } from '../middleware/error.js';
import { todayIn, isValidDate } from '../lib/dates.js';

export const journalRouter = express.Router();

journalRouter.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
  const entries = (await db.prepare(
    'SELECT * FROM journal WHERE user_id = ? ORDER BY entry_date DESC LIMIT ?',
  ).all(req.user.id, limit));
  res.json({ entries });
}));

journalRouter.get('/:date', asyncHandler(async (req, res) => {
  const date = req.params.date === 'today' ? todayIn(req.user.timezone) : req.params.date;
  if (!isValidDate(date)) throw ApiError.badRequest('Invalid date');
  const entry = (await db.prepare('SELECT * FROM journal WHERE user_id = ? AND entry_date = ?').get(req.user.id, date));
  res.json({ entry: entry || null, date });
}));

journalRouter.put('/:date', asyncHandler(async (req, res) => {
  const date = req.params.date === 'today' ? todayIn(req.user.timezone) : req.params.date;
  if (!isValidDate(date)) throw ApiError.badRequest('Invalid date');

  const data = validate(req.body, {
    mood:   { rule: v.nullable(v.int({ min: 1, max: 5 })), default: null },
    energy: { rule: v.nullable(v.int({ min: 1, max: 5 })), default: null },
    body:   { rule: v.string({ max: 10000 }), default: '' },
  });

  // An entry with nothing in it is noise in the calendar — remove it instead.
  if (!data.body && data.mood === null && data.energy === null) {
    (await db.prepare('DELETE FROM journal WHERE user_id = ? AND entry_date = ?').run(req.user.id, date));
    return res.json({ entry: null, date });
  }

  (await db.prepare(
    `INSERT INTO journal (user_id, entry_date, mood, energy, body)
     VALUES (@user_id, @entry_date, @mood, @energy, @body)
     ON CONFLICT (user_id, entry_date) DO UPDATE SET
       mood = excluded.mood, energy = excluded.energy, body = excluded.body,
       updated_at = utc_now()`,
  ).run({ ...data, user_id: req.user.id, entry_date: date }));

  res.json({ entry: (await db.prepare('SELECT * FROM journal WHERE user_id = ? AND entry_date = ?').get(req.user.id, date)), date });
}));
