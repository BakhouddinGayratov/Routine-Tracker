/**
 * Database driver selection (PostgreSQL).
 *
 * Two drivers, one SQL dialect:
 *
 *   - `pg` against a real server (Supabase in production) whenever
 *     DATABASE_URL is set.
 *   - PGlite, Postgres itself compiled to WebAssembly, when it is not. The
 *     test suite runs on this: same engine, same SQL, no server to install
 *     and no container to start, so `npm test` still works anywhere.
 *
 * Both are wrapped to a single tiny interface — `query(sql, params)`,
 * `exec(sql)`, `reserve()`, `end()` — so db/index.js never branches on which
 * one it got.
 */

/** @returns {Promise<{ name: string, query: Function, exec: Function, reserve: Function, end: Function }>} */
export async function selectDriver(connectionString) {
  return connectionString ? postgres(connectionString) : pglite();
}

// Postgres counts (COUNT, SUM) come back as bigint, which both drivers hand
// over as a string — "10" instead of 10 — because a bigint can outgrow a JS
// number. Every count in this app is small, and the code compares and adds
// them as numbers, so they are parsed back to numbers in one place.
const INT8 = 20;

async function postgres(connectionString) {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(INT8, Number);

  // Supabase (and most managed Postgres) require TLS. sslmode in the URL wins;
  // otherwise TLS is on with the platform's certificate chain unaccepted only
  // if PGSSLROOTCERT is supplied — see MIGRATION_SUPABASE.md.
  const ssl = /sslmode=/.test(connectionString)
    ? undefined
    : { rejectUnauthorized: Boolean(process.env.PGSSLROOTCERT), ca: process.env.PGSSLROOTCERT || undefined };

  const pool = new pg.Pool({
    connectionString,
    ssl,
    max: Number(process.env.PGPOOL_MAX) || 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // A pool error (the server closed an idle connection) must not crash the
  // process; the next query simply opens a new one.
  pool.on('error', (err) => console.error(`  database pool: ${err.message}`));

  return {
    name: 'postgres',
    query: (sql, params) => pool.query(sql, params),
    exec: (sql) => pool.query(sql),
    // One dedicated connection, which a transaction needs: BEGIN and COMMIT
    // must run on the same one.
    reserve: async () => {
      const client = await pool.connect();
      return {
        query: (sql, params) => client.query(sql, params),
        exec: (sql) => client.query(sql),
        release: () => client.release(),
      };
    },
    end: () => pool.end(),
  };
}

async function pglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create(process.env.PGLITE_DATA_DIR || undefined);

  const parsers = { [INT8]: Number };
  const run = async (sql, params) => {
    const result = await db.query(sql, params, { parsers });
    // PGlite reports affected rows as `affectedRows`; pg calls it `rowCount`.
    return { rows: result.rows || [], rowCount: result.affectedRows ?? (result.rows?.length || 0) };
  };

  return {
    name: 'pglite',
    query: run,
    exec: (sql) => db.exec(sql),
    // PGlite is a single connection, so it is already "reserved".
    reserve: async () => ({ query: run, exec: (sql) => db.exec(sql), release: () => {} }),
    end: () => db.close(),
  };
}
