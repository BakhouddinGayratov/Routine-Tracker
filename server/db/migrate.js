/**
 * Schema migrations.
 *
 * `schema.sql` is replayed on every boot, but every statement in it is guarded
 * with IF NOT EXISTS — which creates anything new and touches nothing that is
 * already there. What it cannot do is add a column to a table that already
 * exists, and an existing database is exactly the one that must not be thrown
 * away: it holds the accounts, routines, logs and journal entries.
 *
 * So each change that alters an existing table gets a migration here. They run
 * in order, once, tracked by SQLite's own `user_version`, which means an old
 * database upgrades itself on the next start and keeps all of its rows.
 *
 * Rules for adding one:
 *   - bump the version by one and never renumber or edit a released migration;
 *   - make it additive where possible (a new nullable column, a new table);
 *   - write it so re-running it is harmless — `addColumn` already checks.
 */

const MIGRATIONS = [
  {
    version: 1,
    name: 'link routines to goals',
    up(db) {
      // The goals table itself comes from schema.sql; only the pointer on an
      // existing routines table has to be added by hand.
      addColumn(db, 'routines', 'goal_id', 'INTEGER REFERENCES goals(id) ON DELETE SET NULL');
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;

/**
 * Bring `db` up to the current schema version.
 *
 * @returns {string[]} the names of the migrations that actually ran
 */
export function migrate(db) {
  const current = readVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > current);
  const applied = [];

  for (const migration of pending) {
    // One transaction per migration: a failure leaves the database on the last
    // version that did work, rather than half-way through this one.
    db.exec('BEGIN');
    try {
      migration.up(db);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${err.message}`);
    }
    applied.push(`${migration.version}. ${migration.name}`);
  }

  return applied;
}

function readVersion(db) {
  const row = db.prepare('PRAGMA user_version').get();
  return Number(row?.user_version ?? 0);
}

/** ALTER TABLE ADD COLUMN, but only when the column is actually missing. */
function addColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
