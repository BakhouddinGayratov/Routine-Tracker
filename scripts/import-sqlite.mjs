/**
 * Move an existing SQLite database into PostgreSQL.
 *
 *   node scripts/import-sqlite.mjs                     # dry run: counts only
 *   node scripts/import-sqlite.mjs --write             # actually import
 *   node scripts/import-sqlite.mjs --write --replace   # wipe the target first
 *
 * Reads data/routine-tracker.sqlite (DATABASE_PATH) with Node's built-in
 * SQLite and writes to DATABASE_URL. Ids are preserved, so every foreign key
 * keeps pointing at the same row, and each table's identity sequence is moved
 * past the highest id afterwards — without that, the next insert would try to
 * reuse id 1 and fail.
 *
 * It refuses to write into a database that already holds users unless
 * --replace is given: importing twice would otherwise duplicate everything.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { config } from '../server/config.js';
import { db } from '../server/db/index.js';

export const TABLES = [
  'users', 'goals', 'routines', 'logs', 'journal',
  'achievements', 'sessions', 'push_subscriptions', 'reminders_sent',
];

/** Read every table of an open SQLite database. */
export function readSqlite(source) {
  const present = new Set(
    source.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
  );
  const rows = {};
  for (const table of TABLES) {
    rows[table] = present.has(table) ? source.prepare(`SELECT * FROM ${table}`).all() : [];
  }
  return rows;
}

/**
 * Copy rows into Postgres, ids and all, then move each identity sequence past
 * the highest id — without that, the next insert would try to reuse id 1.
 *
 * @returns {Promise<number>} rows written
 */
export async function importRows(db, rows, { replace = false } = {}) {
  let imported = 0;

  for (const table of TABLES) {
    const list = rows[table] || [];
    if (replace) await db.prepare(`DELETE FROM ${table}`).run();
    if (!list.length) continue;

    // Only columns the target actually has, so a column added or dropped
    // since the SQLite days does not break the import.
    const columns = (await db.prepare(
      'SELECT column_name FROM information_schema.columns WHERE table_name = ?',
    ).all(table)).map((r) => r.column_name);
    const shared = Object.keys(list[0]).filter((name) => columns.includes(name));

    const placeholders = shared.map((_, i) => `$${i + 1}`).join(', ');
    const insert = db.prepare(
      `INSERT INTO ${table} (${shared.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
    );

    for (const row of list) {
      await insert.run(...shared.map((name) => (row[name] === undefined ? null : row[name])));
      imported += 1;
    }
  }

  for (const table of TABLES) {
    // Only tables whose id is generated have a sequence to move: sessions.id
    // is a text token, and reminders_sent has no id at all — and asking
    // pg_get_serial_sequence about a column that does not exist is an error,
    // not a null, so the column is checked first.
    const hasId = await db.prepare(
      "SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = 'id'",
    ).get(table);
    if (!hasId) continue;
    const { sequence } = await db.prepare("SELECT pg_get_serial_sequence(?, 'id') AS sequence").get(table);
    if (!sequence) continue;
    await db.prepare(
      `SELECT setval($1, COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`,
    ).get(sequence);
  }

  return imported;
}

// --- CLI -------------------------------------------------------------------

// Run the CLI only when this file is the entry point, so the functions above
// can be imported (and tested) without it firing. pathToFileURL gets the
// Windows spelling right — a hand-built "file://D:/…" never matches.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const write = process.argv.includes('--write');
  const replace = process.argv.includes('--replace');

  if (!config.databaseUrl) {
    console.error('DATABASE_URL is not set — there is no Postgres to import into.');
    process.exit(1);
  }
  if (!fs.existsSync(config.databasePath)) {
    console.error(`No SQLite database at ${config.databasePath}`);
    process.exit(1);
  }

  const { DatabaseSync } = await import('node:sqlite');
  const source = new DatabaseSync(config.databasePath, { readOnly: true });
  const rows = readSqlite(source);

  // The password in the URL is never printed back.
  console.log(`\n  From: ${config.databasePath}`);
  console.log(`  To:   ${config.databaseUrl.replace(/:[^:@/]+@/, ':****@')}\n`);
  for (const table of TABLES) {
    console.log(`  ${table.padEnd(20)} ${String(rows[table].length).padStart(6)} rows`);
  }

  const existingUsers = (await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n;
  if (existingUsers && !replace) {
    console.error(`\n  The target already has ${existingUsers} user(s). Re-run with --replace to overwrite it.\n`);
    await db.close();
    process.exit(1);
  }

  if (!write) {
    console.log('\n  Dry run. Nothing was written — add --write to import.\n');
    await db.close();
    process.exit(0);
  }

  const imported = await importRows(db, rows, { replace });
  console.log(`\n  Done: ${imported} rows imported, sequences reset.\n`);
  source.close();
  await db.close();
}
