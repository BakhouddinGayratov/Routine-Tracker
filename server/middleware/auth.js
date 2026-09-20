import { db } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { verifyToken } from '../lib/auth.js';

/**
 * Resolve the caller from a bearer token (or the `token` cookie, which is what
 * the browser client uses so the token is never readable from JavaScript).
 * Attaches `req.user` and `req.sessionId`.
 */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const token = bearer || req.cookies?.token;
    if (!token) throw ApiError.unauthorized();

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      throw ApiError.unauthorized('Your session has expired, please sign in again');
    }

    const session = await db
      .prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > utc_now()')
      .get(payload.sid);
    if (!session || session.user_id !== payload.sub) {
      throw ApiError.unauthorized('Your session has expired, please sign in again');
    }

    const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub));
    if (!user) throw ApiError.unauthorized();

    // Cheap "last seen" tracking; one write per request is fine at this scale.
    (await db.prepare("UPDATE sessions SET last_seen = utc_now() WHERE id = ?").run(session.id));

    req.user = user;
    req.sessionId = session.id;
    next();
  } catch (err) {
    next(err);
  }
}
