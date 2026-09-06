import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);

// WAL keeps readers from blocking the single writer, which is all this app
// needs to stay responsive under concurrent requests.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));

/** Run `fn` inside a transaction; nested calls join the outer transaction. */
export function transaction(fn) {
  return db.transaction(fn)();
}

/** Remove login sessions that have already expired. */
export function purgeExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%SZ','now')").run();
}
