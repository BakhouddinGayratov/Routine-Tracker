import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/index.js';

const ROUNDS = 12;

export async function hashPassword(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/**
 * Create a login session and sign a token for it.
 *
 * The JWT carries the session id, so revoking a session (logout, password
 * change, "sign out everywhere") invalidates the token immediately instead of
 * waiting for it to expire.
 */
export function issueToken(user, userAgent = '') {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + parseDuration(config.jwtExpiresIn)).toISOString();

  db.prepare(
    `INSERT INTO sessions (id, user_id, user_agent, expires_at)
     VALUES (@id, @user_id, @user_agent, @expires_at)`,
  ).run({
    id: sessionId,
    user_id: user.id,
    user_agent: String(userAgent).slice(0, 250),
    expires_at: expiresAt.slice(0, 19) + 'Z',
  });

  const token = jwt.sign({ sub: user.id, sid: sessionId }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });

  return { token, sessionId, expiresAt };
}

export function revokeSession(sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function revokeAllSessions(userId, exceptSessionId = null) {
  if (exceptSessionId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, exceptSessionId);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

/** '30d' | '12h' | '45m' | '30s' | '3600' → milliseconds */
function parseDuration(value) {
  const match = /^(\d+)\s*([smhd])?$/.exec(String(value).trim());
  if (!match) return 30 * 86400000;
  const amount = Number(match[1]);
  const unit = match[2] || 's';
  return amount * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
}

/** Shape a user row for the client — never leaks password_hash. */
export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar_color: row.avatar_color,
    timezone: row.timezone,
    locale: row.locale,
    theme: row.theme,
    week_start: row.week_start,
    daily_goal: row.daily_goal,
    reminders_on: !!row.reminders_on,
    created_at: row.created_at,
  };
}
