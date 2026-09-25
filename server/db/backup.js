/**
 * Daily database backups (TZ MS-05).
 *
 * Supabase's free plan takes no backups of its own — its documentation tells
 * free projects to export their data themselves — so the app does it: one
 * gzipped JSON snapshot of every table per day, oldest ones pruned.
 *
 *   data/backups/routine-tracker-2026-09-20.json.gz
 *
 * A snapshot is written to disk and, when object storage is configured,
 * uploaded there as well. That matters on a host with an ephemeral disk
 * (Render), where a local file disappears on the next deploy: BACKUP_BUCKET
 * with SUPABASE_URL and SUPABASE_SERVICE_KEY sends it to Supabase Storage.
 *
 * To restore: `node scripts/restore-backup.mjs <file>`.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzip = promisify(zlib.gzip);

const PREFIX = 'routine-tracker-';
const BACKUP_NAME = /^routine-tracker-(\d{4}-\d{2}-\d{2})\.json\.gz$/;
const HOUR = 60 * 60 * 1000;

// Every table that holds user data, parents before children so a restore can
// insert them in this order without tripping a foreign key.
export const TABLES = [
  'users', 'goals', 'routines', 'logs', 'journal',
  'achievements', 'sessions', 'push_subscriptions', 'reminders_sent',
];

/** The server's own calendar date — a backup belongs to the day it was taken. */
function localDate(now) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Every row of every table, as one JSON document. */
export async function snapshot(db) {
  const data = {};
  for (const table of TABLES) {
    data[table] = await db.prepare(`SELECT * FROM ${table}`).all();
  }
  return { format: 'routine-tracker/backup-v1', taken_at: new Date().toISOString(), tables: data };
}

/**
 * Take today's backup if there is none yet, then prune to the newest `keep`.
 *
 * @param {object} db
 * @param {{ dir: string, keep?: number, now?: Date, upload?: Function }} options
 * @returns {Promise<{ created: string|null, removed: string[], uploaded: boolean }>}
 */
export async function backupDatabase(db, { dir, keep = 7, now = new Date(), upload = uploadToStorage }) {
  fs.mkdirSync(dir, { recursive: true });

  const name = `${PREFIX}${localDate(now)}.json.gz`;
  const target = path.join(dir, name);
  if (fs.existsSync(target)) return { created: null, removed: prune(dir, keep), uploaded: false };

  const body = await gzip(JSON.stringify(await snapshot(db)));

  // Write to a temporary name and rename, so a crash half-way never leaves a
  // truncated file that looks like a good backup.
  const temp = `${target}.tmp`;
  fs.rmSync(temp, { force: true });
  fs.writeFileSync(temp, body);
  fs.renameSync(temp, target);

  const uploaded = await upload(name, body).catch(() => false);
  return { created: target, removed: prune(dir, keep), uploaded };
}

/** Delete all but the newest `keep` backups. ISO dates sort chronologically. */
function prune(dir, keep) {
  const backups = fs.readdirSync(dir).filter((name) => BACKUP_NAME.test(name)).sort();
  const excess = backups.slice(0, Math.max(0, backups.length - keep));
  for (const name of excess) fs.rmSync(path.join(dir, name), { force: true });
  return excess;
}

/**
 * Supabase has two kinds of server key. The legacy service_role key is a JWT
 * and goes in the Authorization header as well as apikey. The newer secret
 * key (sb_secret_…) is not a JWT: the gateway reads it from apikey and
 * rejects it as a bearer token, so the old header alone failed every upload.
 */
export function storageAuth(key) {
  return key.startsWith('sb_')
    ? { apikey: key }
    : { apikey: key, Authorization: `Bearer ${key}` };
}

/**
 * Send a snapshot to Supabase Storage. Returns false when storage is not
 * configured, which is the normal case on a machine that keeps its own disk.
 */
async function uploadToStorage(name, body) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const bucket = process.env.BACKUP_BUCKET;
  if (!url || !key || !bucket) return false;

  const res = await fetch(`${url.replace(/\/$/, '')}/storage/v1/object/${bucket}/${name}`, {
    method: 'POST',
    headers: {
      ...storageAuth(key),
      'Content-Type': 'application/gzip',
      'x-upsert': 'true',
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  return res.ok;
}

/**
 * Back up now if today's copy is missing, then check again every hour, so a
 * server left running for weeks still gets exactly one backup per day.
 *
 * A failed backup is logged and retried next hour; it never stops the app,
 * because a backup problem is not a reason to stop serving the live data.
 */
export function scheduleBackups(db, options, log = console) {
  const run = async () => {
    try {
      const { created, removed, uploaded } = await backupDatabase(db, options);
      if (created) {
        const notes = [uploaded ? 'uploaded' : null, removed.length ? `removed ${removed.length} older` : null]
          .filter(Boolean).join(', ');
        log.log(`  backup: ${path.basename(created)}${notes ? ` (${notes})` : ''}`);
      }
    } catch (err) {
      log.error(`  backup FAILED, retrying in an hour: ${err.message}`);
    }
  };

  run();
  const timer = setInterval(run, HOUR);
  timer.unref();
  return timer;
}
