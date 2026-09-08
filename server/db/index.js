import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { selectDriver } from './driver.js';
import { migrate } from './migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

const driver = await selectDriver(config.databaseDriver);

export const db = driver.open(config.databasePath);
export const driverName = driver.name;

// PRAGMAs go through exec() rather than a driver-specific helper, so the same
// statements work on both drivers.
//   WAL keeps readers from blocking the single writer, which is all this app
//   needs to stay responsive under concurrent requests.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

// Create anything that is missing, then upgrade anything that already exists.
// Both steps preserve existing rows, so a database survives an app update.
db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));

export const appliedMigrations = migrate(db);

/**
 * Run `fn` inside a transaction and return its result.
 *
 * `fn` must be synchronous — SQLite here is synchronous, and awaiting inside a
 * transaction would let unrelated requests interleave with it.
 *
 * Nested calls join the outer transaction through a SAVEPOINT, so a helper that
 * opens a transaction stays safe when called from a route that already has one.
 */
let depth = 0;

export function tx(fn) {
  db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT rt_${depth}`);
  depth += 1;

  try {
    const result = fn();
    depth -= 1;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE rt_${depth}`);
    return result;
  } catch (err) {
    depth -= 1;
    try {
      if (depth === 0) {
        db.exec('ROLLBACK');
      } else {
        db.exec(`ROLLBACK TO rt_${depth}`);
        db.exec(`RELEASE rt_${depth}`);
      }
    } catch {
      // The rollback itself failed (a closed or corrupt handle); surface the
      // original error, which explains what actually went wrong.
    }
    throw err;
  }
}

/** Remove login sessions that have already expired. */
export function purgeExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%SZ','now')").run();
}
