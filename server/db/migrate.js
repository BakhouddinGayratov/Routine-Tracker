/**
 * Schema migrations.
 *
 * `schema.sql` is replayed on every boot, but every statement in it is guarded
 * with IF NOT EXISTS — which creates anything new and touches nothing that is
 * already there. What it cannot do is alter a table that already exists, and
 * an existing database is exactly the one that must not be thrown away: it
 * holds the accounts, routines, logs and journal entries.
 *
 * So each change that alters an existing table gets a migration here. They run
 * in order, once, recorded in the schema_migrations table, which means a
 * deployed database upgrades itself on the next start and keeps all its rows.
 *
 * Rules for adding one:
 *   - bump the version by one and never renumber or edit a released migration;
 *   - make it additive where possible (a new nullable column, a new table);
 *   - write it so re-running it is harmless — `addColumn` already checks.
 */

const MIGRATIONS = [
  // The SQLite database had a migration here (routines.goal_id). On Postgres
  // the schema starts complete, and the SQLite data is brought over by
  // scripts/import-sqlite.mjs, so version 1 is a no-op kept for the record.
  { version: 1, name: 'baseline', async up() {} },
];

export const SCHEMA_VERSION = MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;

/**
 * Bring `db` up to the current schema version.
 *
 * @returns {Promise<string[]>} the names of the migrations that actually ran
 */
export async function migrate(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT utc_now()
    )
  `);

  const done = new Set((await db.prepare('SELECT version FROM schema_migrations').all())
    .map((row) => Number(row.version)));
  const applied = [];

  for (const migration of MIGRATIONS) {
    if (done.has(migration.version)) continue;

    // One transaction per migration: a failure leaves the database on the last
    // version that did work, rather than half-way through this one. Postgres
    // rolls back DDL too, which SQLite could not promise.
    await db.exec('BEGIN');
    try {
      await migration.up(db);
      await db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
        .run(migration.version, migration.name);
      await db.exec('COMMIT');
    } catch (err) {
      await db.exec('ROLLBACK');
      throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${err.message}`);
    }
    applied.push(`${migration.version}. ${migration.name}`);
  }

  return applied;
}

/** ALTER TABLE ADD COLUMN, but only when the column is actually missing. */
export async function addColumn(db, table, column, definition) {
  const exists = await db.prepare(
    'SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ?',
  ).get(table, column);
  if (exists) return;
  await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
