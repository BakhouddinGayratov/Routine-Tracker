/**
 * Daily database backups (TZ MS-05).
 *
 * One file per day in the backup folder, named by date, keeping the newest
 * `keep` (7 by default) and deleting older ones:
 *
 *   data/backups/routine-tracker-2026-09-18.sqlite
 *
 * To restore: stop the server, copy the chosen backup over
 * data/routine-tracker.sqlite, delete routine-tracker.sqlite-wal and -shm next
 * to it, and start the server again.
 */
import fs from 'node:fs';
import path from 'node:path';

const PREFIX = 'routine-tracker-';
const BACKUP_NAME = /^routine-tracker-(\d{4}-\d{2}-\d{2})\.sqlite$/;
const HOUR = 60 * 60 * 1000;

/** The server's own calendar date — a backup belongs to the day it was taken. */
function localDate(now) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Take today's backup if there is none yet, then prune to the newest `keep`.
 *
 * The copy is made with SQLite's `VACUUM INTO`, not a file copy: the database
 * runs in WAL mode, so the main file alone can be missing committed rows that
 * still live in the -wal file, and a copy taken during a write can catch it
 * half-done. VACUUM INTO writes one transactionally consistent snapshot.
 *
 * It writes to a temporary name and renames at the end, so a crash half-way
 * never leaves a truncated file that looks like a good backup.
 *
 * @param {object} db   an open database handle (either driver)
 * @param {{ dir: string, keep?: number, now?: Date }} options
 * @returns {{ created: string|null, removed: string[] }}
 */
export function backupDatabase(db, { dir, keep = 7, now = new Date() }) {
  fs.mkdirSync(dir, { recursive: true });

  const target = path.join(dir, `${PREFIX}${localDate(now)}.sqlite`);
  let created = null;

  if (!fs.existsSync(target)) {
    const temp = `${target}.tmp`;
    fs.rmSync(temp, { force: true });
    // The path comes from server config, never from a request, but it is still
    // quoted properly: a folder name with an apostrophe must not break the SQL.
    db.exec(`VACUUM INTO '${temp.replace(/'/g, "''")}'`);
    fs.renameSync(temp, target);
    created = target;
  }

  return { created, removed: prune(dir, keep) };
}

/** Delete all but the newest `keep` backups. ISO dates sort chronologically. */
function prune(dir, keep) {
  const backups = fs.readdirSync(dir).filter((name) => BACKUP_NAME.test(name)).sort();
  const excess = backups.slice(0, Math.max(0, backups.length - keep));
  for (const name of excess) fs.rmSync(path.join(dir, name), { force: true });
  return excess;
}

/**
 * Back up now if today's copy is missing, then check again every hour, so a
 * server left running for weeks still gets exactly one backup per day.
 *
 * A failed backup is logged and retried next hour; it never stops the app,
 * because a backup problem is not a reason to stop serving the live data.
 */
export function scheduleBackups(db, options, log = console) {
  const run = () => {
    try {
      const { created, removed } = backupDatabase(db, options);
      if (created) {
        const note = removed.length ? `, removed ${removed.length} older` : '';
        log.log(`  backup: ${path.relative(process.cwd(), created)}${note}`);
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
