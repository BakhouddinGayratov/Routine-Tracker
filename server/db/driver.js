/**
 * Database driver selection.
 *
 * Node 22.13+ ships SQLite in the runtime (`node:sqlite`), so the app needs no
 * native module, no compiler and no prebuilt binary — `npm install` stays pure
 * JavaScript and `npm start` works on any platform.
 *
 * `better-sqlite3` is still supported as a fallback for older runtimes, but it
 * is not a declared dependency: install it yourself if you need it.
 *
 * Set DATABASE_DRIVER to `node` or `better-sqlite3` to pin one explicitly;
 * the default, `auto`, prefers the built-in.
 */

/** @returns {{ open: (path: string) => object, name: string }} */
export async function selectDriver(preference = 'auto') {
  const wantNode = preference === 'auto' || preference === 'node';
  const wantBetter = preference === 'auto' || preference === 'better-sqlite3';

  if (wantNode) {
    const builtin = await loadBuiltin();
    if (builtin) return builtin;
    if (preference === 'node') {
      throw new Error(
        'DATABASE_DRIVER=node was requested, but this Node build has no node:sqlite. ' +
        `Node 22.13 or newer is required (running ${process.version}).`,
      );
    }
  }

  if (wantBetter) {
    const native = await loadBetterSqlite3();
    if (native) return native;

    if (preference === 'better-sqlite3') {
      throw new Error(
        'DATABASE_DRIVER=better-sqlite3 was requested, but the module could not be loaded.\n' +
        '  Either install it (npm install better-sqlite3), or unset DATABASE_DRIVER to use\n' +
        "  Node's built-in node:sqlite, which needs no native build.",
      );
    }
  }

  // Reached only when the runtime has no node:sqlite and no fallback is installed.
  throw new Error(
    'No SQLite driver available.\n' +
    `  This Node (${process.version}) has no built-in node:sqlite, which needs Node 22.13 or newer.\n` +
    '  Either upgrade Node (https://nodejs.org), or install the fallback driver:\n' +
    '      npm install better-sqlite3',
  );
}

async function loadBuiltin() {
  const restore = muteSqliteExperimentalWarning();
  try {
    const { DatabaseSync } = await import('node:sqlite');
    if (typeof DatabaseSync !== 'function') return null;
    return {
      name: 'node:sqlite',
      open: (path) => new DatabaseSync(path),
    };
  } catch {
    return null;   // older Node, or the module is behind a flag
  } finally {
    // Node emits the notice while the module loads; anything later is unrelated
    // and should be printed normally.
    restore();
  }
}

async function loadBetterSqlite3() {
  try {
    const { default: Database } = await import('better-sqlite3');
    return {
      name: 'better-sqlite3',
      open: (path) => new Database(path),
    };
  } catch {
    return null;   // not installed, or its native binding failed to load
  }
}

/**
 * Hide Node's "SQLite is an experimental feature" notice while the module loads.
 *
 * The surface this app uses (open, prepare, run/get/all, exec) has been stable
 * since node:sqlite was unflagged, so the notice only worries the person
 * running the app. It has to be done by wrapping `process.emitWarning`: a
 * 'warning' listener does *not* replace Node's default printing.
 *
 * Only that one warning is swallowed — every other warning is forwarded
 * untouched — and the original function is restored as soon as the import is
 * done, so nothing else is ever hidden.
 *
 * @returns {() => void} restores the original `process.emitWarning`
 */
function muteSqliteExperimentalWarning() {
  const original = process.emitWarning;

  process.emitWarning = (warning, ...rest) => {
    const text = typeof warning === 'string' ? warning : warning?.message ?? '';
    const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
    if (type === 'ExperimentalWarning' && /sqlite/i.test(text)) return;
    return original.call(process, warning, ...rest);
  };

  return () => { process.emitWarning = original; };
}
