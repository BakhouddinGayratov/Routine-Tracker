import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { selectDriver } from './driver.js';
import { migrate } from './migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const driver = await selectDriver(config.databaseUrl);
export const driverName = driver.name;

/**
 * The query interface the rest of the server uses.
 *
 *   await db.prepare('SELECT * FROM users WHERE id = ?').get(id)
 *   await db.prepare('INSERT ... VALUES (@title, @user_id)').run({ ... })
 *
 * `prepare()` keeps the shape the code has always used, so the SQL reads the
 * same as before; only the call sites gained an `await`. Placeholders are
 * translated to Postgres's $1, $2 … in one place (below), which is why the
 * queries could keep their named `@parameters`.
 */
function statements(runner) {
  return {
    prepare(sql) {
      const plan = compile(sql);
      const execute = async (args) => runner.query(plan.text, plan.values(args));
      return {
        async get(...args) { return (await execute(args)).rows[0]; },
        async all(...args) { return (await execute(args)).rows; },
        async run(...args) {
          const result = await execute(args);
          return {
            changes: result.rowCount ?? 0,
            // Only meaningful when the statement ends in RETURNING id.
            lastInsertRowid: result.rows?.[0]?.id,
          };
        },
      };
    },
    exec: (sql) => runner.exec(sql),
  };
}

/**
 * Rewrite placeholders once per statement.
 *
 * `@name` takes a single object argument (repeating a name reuses the same
 * $n), `?` takes positional arguments. A statement that already uses $n is
 * passed through untouched.
 *
 * Only text outside string literals is rewritten. A query comparing against
 * an address — LIKE '%@example.com' — otherwise had its "@example" read as a
 * parameter and failed with "bind message supplies N parameters, but the
 * prepared statement requires 0".
 */
function compile(sql) {
  if (/\$\d/.test(sql)) return { text: sql, values: (args) => args };

  const names = [];
  let positional = 0;
  let text = '';
  let quote = null;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];

    if (quote) {
      text += char;
      // '' inside a literal is an escaped quote, not the end of it.
      if (char === quote && !(char === "'" && sql[i + 1] === "'")) quote = null;
      else if (char === quote) { text += sql[i + 1]; i += 1; }
      continue;
    }

    if (char === "'" || char === '"') { quote = char; text += char; continue; }

    if (char === '@') {
      const name = /^[a-z_][a-z0-9_]*/i.exec(sql.slice(i + 1))?.[0];
      if (name) {
        const existing = names.indexOf(name);
        if (existing === -1) names.push(name);
        text += `$${existing === -1 ? names.length : existing + 1}`;
        i += name.length;
        continue;
      }
    }

    if (char === '?') { positional += 1; text += `$${positional}`; continue; }

    text += char;
  }

  if (names.length) {
    return {
      text,
      values: (args) => {
        const source = args[0] || {};
        return names.map((name) => normalise(source[name]));
      },
    };
  }

  return { text, values: (args) => args.map(normalise) };
}

/**
 * SQLite accepted booleans nowhere and numbers everywhere; Postgres is
 * stricter about types but happy with strings for its TEXT columns. The only
 * real mismatch is `undefined`, which pg rejects — it means "not given", so
 * it becomes NULL.
 */
function normalise(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

export const db = {
  ...statements(driver),
  close: () => driver.end(),
};

// The schema is replayed on every boot: every statement is guarded with
// IF NOT EXISTS (or CREATE OR REPLACE), so it creates what is missing and
// touches nothing that already holds data.
await db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));

export const appliedMigrations = await migrate(db);

/**
 * Run `fn` inside a transaction and return its result.
 *
 * `fn` receives its own handle bound to one connection — every query inside
 * must use it, or it would run outside the transaction on another connection.
 * Nested calls join the outer transaction through a SAVEPOINT, so a helper
 * that opens a transaction stays safe when called from a route that already
 * has one.
 */
export async function tx(fn) {
  const connection = await driver.reserve();
  const handle = statements(connection);
  await connection.query('BEGIN');

  try {
    const result = await fn({ ...handle, tx: (nested) => savepoint(handle, connection, nested) });
    await connection.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await connection.query('ROLLBACK');
    } catch {
      // The rollback itself failed (a closed connection); surface the
      // original error, which explains what actually went wrong.
    }
    throw err;
  } finally {
    connection.release();
  }
}

let depth = 0;

async function savepoint(handle, connection, fn) {
  depth += 1;
  const name = `rt_${depth}`;
  await connection.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn(handle);
    await connection.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (err) {
    await connection.query(`ROLLBACK TO SAVEPOINT ${name}`);
    throw err;
  } finally {
    depth -= 1;
  }
}

/** Remove login sessions that have already expired. */
export async function purgeExpiredSessions() {
  await db.prepare('DELETE FROM sessions WHERE expires_at < utc_now()').run();
}
