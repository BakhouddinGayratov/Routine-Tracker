import express from 'express';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { ApiError } from '../lib/errors.js';
import { validate, v } from '../lib/validate.js';
import {
  hashPassword, verifyPassword, issueToken, revokeSession, revokeAllSessions, publicUser,
} from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit, emailKey } from '../middleware/rateLimit.js';
import { asyncHandler } from '../middleware/error.js';
import { seedStarterRoutines } from '../lib/starter.js';
import { CATEGORIES } from './routines.js';

/**
 * What a person may preset for their new routines. Every key is optional; an
 * absent key keeps the app's own default. Repeats are limited to the two that
 * need no further input — "weekly" would also need the days, and a preset
 * that opens the form half-filled helps no one.
 */
const ROUTINE_DEFAULTS = {
  repeat_type:  v.oneOf(['once', 'daily']),
  duration_min: v.oneOf(['0', '15', '30', '45', '60', '90', '120']),
  reminder_min: v.nullable(v.oneOf(['0', '5', '10', '15', '30', '60'])),
  category:     v.oneOf(CATEGORIES),
  priority:     v.oneOf(['low', 'normal', 'high']),
  icon:         v.emoji(),
  color:        v.color(),
};

/** A validator rule for the whole defaults object; stores it as JSON text. */
function routineDefaultsRule(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const err = new Error(`${field} must be an object`);
    err.field = field;
    throw err;
  }
  const clean = validate(value, ROUTINE_DEFAULTS, { partial: true });
  // oneOf compares as text; the form works with numbers.
  for (const key of ['duration_min', 'reminder_min']) {
    if (clean[key] !== undefined && clean[key] !== null) clean[key] = Number(clean[key]);
  }
  return JSON.stringify(clean);
}

export const authRouter = express.Router();

const COOKIE = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProd,
  path: '/',
  maxAge: 30 * 86400 * 1000,
};

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: 'Too many sign-up attempts. Try again later.' });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 12, key: emailKey, message: 'Too many sign-in attempts. Please wait a few minutes.' });

authRouter.post('/register', registerLimiter, asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    name: v.string({ min: 2, max: 60 }),
    email: v.email(),
    password: v.password(),
    timezone: { rule: v.string({ max: 60 }), default: 'UTC' },
    locale: { rule: v.oneOf(['en', 'uz', 'ru']), default: 'en' },
  });

  const existing = (await db.prepare('SELECT id FROM users WHERE email = ?').get(data.email));
  if (existing) throw ApiError.conflict('An account with this email already exists');

  const password_hash = await hashPassword(data.password);
  const palette = ['#c4492f', '#2f8a7c', '#4b4fb0', '#d0782a', '#7a4ba0', '#4f8f3a', '#b3477a'];

  const info = (await db.prepare(
    `INSERT INTO users (email, name, password_hash, timezone, locale, avatar_color)
     VALUES (@email, @name, @password_hash, @timezone, @locale, @avatar_color)
     RETURNING id`,
  ).run({
    email: data.email,
    name: data.name,
    password_hash,
    timezone: data.timezone || 'UTC',
    locale: data.locale,
    avatar_color: palette[Math.floor(Math.random() * palette.length)],
  }));

  const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid));

  // A brand new account with an empty dashboard is a dead end; give people a
  // small, obviously-editable starter set so the app explains itself.
  await seedStarterRoutines(user);

  const { token } = await issueToken(user, req.get('user-agent'));
  res.cookie('token', token, COOKIE);
  res.status(201).json({ user: publicUser(user), token });
}));

authRouter.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    email: v.email(),
    password: v.string({ min: 1, max: 200, trim: false }),
  });

  const user = (await db.prepare('SELECT * FROM users WHERE email = ?').get(data.email));
  // Same message and comparable timing for "no such user" and "wrong password"
  // so the endpoint can't be used to enumerate registered emails.
  const ok = user
    ? await verifyPassword(data.password, user.password_hash)
    : await verifyPassword(data.password, '$2a$12$............................................invalid');

  if (!user || !ok) throw ApiError.unauthorized('Email or password is incorrect');

  const { token } = await issueToken(user, req.get('user-agent'));
  res.cookie('token', token, COOKIE);
  res.json({ user: publicUser(user), token });
}));

authRouter.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  await revokeSession(req.sessionId);
  res.clearCookie('token', { ...COOKIE, maxAge: undefined });
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

authRouter.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    name: v.string({ min: 2, max: 60 }),
    avatar_color: v.color(),
    timezone: v.string({ max: 60 }),
    locale: v.oneOf(['en', 'uz', 'ru']),
    theme: v.oneOf(['light', 'dark', 'ink']),   // Daftar, Tablo, Siyoh
    week_start: v.int({ min: 0, max: 1 }),
    daily_goal: v.int({ min: 10, max: 100 }),
    reminders_on: v.bool(),
    // Replaced whole, not merged: the Settings form always sends every key,
    // and "reset to the app default" is sending the object without it.
    routine_defaults: routineDefaultsRule,
  }, { partial: true });

  if (Object.keys(data).length === 0) throw ApiError.badRequest('Nothing to update');

  const sets = Object.keys(data).map((k) => `${k} = @${k}`).join(', ');
  (await db.prepare(
    `UPDATE users SET ${sets}, updated_at = utc_now() WHERE id = @id`,
  ).run({ ...data, id: req.user.id }));

  res.json({ user: publicUser((await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id))) });
}));

authRouter.post('/password', requireAuth, asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    current_password: v.string({ min: 1, max: 200, trim: false }),
    new_password: v.password(),
  });

  const ok = await verifyPassword(data.current_password, req.user.password_hash);
  if (!ok) throw ApiError.badRequest('Your current password is incorrect', { current_password: 'Incorrect password' });

  (await db.prepare(
    "UPDATE users SET password_hash = ?, updated_at = utc_now() WHERE id = ?",
  ).run(await hashPassword(data.new_password), req.user.id));

  // Other devices keep a token minted with the old password — cut them off.
  await revokeAllSessions(req.user.id, req.sessionId);
  res.json({ ok: true });
}));

authRouter.get('/sessions', requireAuth, asyncHandler(async (req, res) => {
  const rows = (await db.prepare(
    'SELECT id, user_agent, created_at, last_seen, expires_at FROM sessions WHERE user_id = ? ORDER BY last_seen DESC',
  ).all(req.user.id));
  res.json({ sessions: rows.map((s) => ({ ...s, current: s.id === req.sessionId })) });
}));

authRouter.delete('/sessions/:id', requireAuth, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
}));

authRouter.delete('/me', requireAuth, asyncHandler(async (req, res) => {
  const data = validate(req.body, { password: v.string({ min: 1, max: 200, trim: false }) });
  const ok = await verifyPassword(data.password, req.user.password_hash);
  if (!ok) throw ApiError.badRequest('Password is incorrect', { password: 'Incorrect password' });

  // ON DELETE CASCADE removes routines, logs, journal, achievements, sessions.
  (await db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id));
  res.clearCookie('token', { ...COOKIE, maxAge: undefined });
  res.json({ ok: true });
}));
