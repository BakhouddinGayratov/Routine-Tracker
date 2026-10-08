import express from 'express';
import { db } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { validate, v } from '../lib/validate.js';
import { asyncHandler } from '../middleware/error.js';

/**
 * Quick notes — short things to keep in mind, shown on their own page and
 * beside the journal while writing.
 */
export const notesRouter = express.Router();

// Plenty for scraps of paper; a cap stops one account from filling the table.
const MAX_NOTES = 500;

const writeSchema = {
  body: v.string({ min: 1, max: 2000 }),
  pinned: { rule: v.bool(), default: 0 },
  done: { rule: v.bool(), default: 0 },
};

function decorate(note) {
  return { ...note, pinned: !!note.pinned, done: !!note.done };
}

async function ownedNote(userId, id) {
  const note = await db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(id, userId);
  if (!note) throw ApiError.notFound('Note not found');
  return note;
}

/** Pinned first, then open before done, newest change first within each. */
notesRouter.get('/', asyncHandler(async (req, res) => {
  const notes = await db.prepare(
    `SELECT * FROM notes WHERE user_id = ?
     ORDER BY pinned DESC, done ASC, updated_at DESC, id DESC`,
  ).all(req.user.id);
  res.json({ notes: notes.map(decorate) });
}));

notesRouter.post('/', asyncHandler(async (req, res) => {
  const data = validate(req.body, writeSchema);
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM notes WHERE user_id = ?').get(req.user.id);
  if (n >= MAX_NOTES) throw ApiError.badRequest(`You can keep up to ${MAX_NOTES} notes; delete a few old ones first`);

  const info = await db.prepare(
    'INSERT INTO notes (user_id, body, pinned, done) VALUES (?, ?, ?, ?) RETURNING id',
  ).run(req.user.id, data.body, data.pinned, data.done);
  const note = await db.prepare('SELECT * FROM notes WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ note: decorate(note) });
}));

notesRouter.patch('/:id', asyncHandler(async (req, res) => {
  const note = await ownedNote(req.user.id, req.params.id);
  const data = validate(req.body, writeSchema, { partial: true });
  if (Object.keys(data).length === 0) throw ApiError.badRequest('Nothing to update');

  const sets = Object.keys(data).map((k) => `${k} = @${k}`).join(', ');
  await db.prepare(`UPDATE notes SET ${sets}, updated_at = utc_now() WHERE id = @id AND user_id = @user_id`)
    .run({ ...data, id: note.id, user_id: req.user.id });
  res.json({ note: decorate(await db.prepare('SELECT * FROM notes WHERE id = ?').get(note.id)) });
}));

notesRouter.delete('/:id', asyncHandler(async (req, res) => {
  const note = await ownedNote(req.user.id, req.params.id);
  await db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(note.id, req.user.id);
  res.json({ ok: true });
}));
