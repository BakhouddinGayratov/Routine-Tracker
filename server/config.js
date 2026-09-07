import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

// Minimal .env reader — the app has no runtime dependency on dotenv.
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// In development we persist a generated secret so restarts don't log everyone
// out. In production a missing secret is a hard error — silently generating one
// would invalidate every token on each deploy.
function resolveJwtSecret() {
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set when NODE_ENV=production');
  }
  const cache = path.join(DATA_DIR, '.jwt-secret');
  if (fs.existsSync(cache)) return fs.readFileSync(cache, 'utf8').trim();
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(cache, generated, { mode: 0o600 });
  return generated;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3000),
  dataDir: DATA_DIR,
  publicDir: path.join(ROOT, 'public'),
  databasePath: path.resolve(ROOT, process.env.DATABASE_PATH || './data/routine-tracker.sqlite'),
  // 'auto' prefers Node's built-in node:sqlite and falls back to better-sqlite3.
  databaseDriver: process.env.DATABASE_DRIVER || 'auto',
  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
