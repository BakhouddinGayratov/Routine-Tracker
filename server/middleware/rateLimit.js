import { ApiError } from '../lib/errors.js';

/**
 * In-memory fixed-window rate limiter.
 *
 * Deliberately dependency-free and per-process: it exists to blunt password
 * guessing and accidental request storms on a single-node deployment. Behind
 * multiple instances you'd move this to a shared store.
 */
export function rateLimit({ windowMs = 60_000, max = 60, key = defaultKey, message } = {}) {
  const hits = new Map();

  // Drop expired buckets so the map can't grow without bound.
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of hits) if (entry.resetAt <= now) hits.delete(k);
  }, windowMs).unref?.();
  void timer;

  return (req, res, next) => {
    const id = key(req);
    const now = Date.now();
    let entry = hits.get(id);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(id, entry);
    }
    entry.count += 1;

    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));

    if (entry.count > max) {
      const seconds = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(seconds));
      return next(ApiError.tooMany(message || `Too many requests. Try again in ${seconds}s.`));
    }
    next();
  };
}

function defaultKey(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/** Limit by IP *and* submitted email so one attacker can't lock out a victim. */
export function emailKey(req) {
  const email = String(req.body?.email || '').toLowerCase().slice(0, 100);
  return `${req.ip}:${email}`;
}
