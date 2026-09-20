/**
 * Restore a backup taken by server/db/backup.js.
 *
 *   node scripts/restore-backup.mjs data/backups/routine-tracker-2026-09-20.json.gz
 *   node scripts/restore-backup.mjs <file> --write
 *
 * Without --write it only reports what the file holds, so you can check you
 * picked the right day before anything is touched. With --write it **replaces**
 * the current contents of every table with the snapshot: this is a restore,
 * not a merge.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { config } from '../server/config.js';
import { db } from '../server/db/index.js';
import { importRows, TABLES } from './import-sqlite.mjs';

const [file] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const write = process.argv.includes('--write');

if (!file) {
  console.error('Usage: node scripts/restore-backup.mjs <backup.json.gz> [--write]');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`No such file: ${file}`);
  process.exit(1);
}

const raw = file.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(file)) : fs.readFileSync(file);
const backup = JSON.parse(raw);
if (backup.format !== 'routine-tracker/backup-v1') {
  console.error(`Not a Routine Tracker backup (format: ${backup.format || 'unknown'})`);
  process.exit(1);
}

console.log(`\n  Backup taken: ${backup.taken_at}`);
console.log(`  Into:         ${(config.databaseUrl || 'local PGlite').replace(/:[^:@/]+@/, ':****@')}\n`);

for (const table of TABLES) {
  const inBackup = backup.tables[table]?.length ?? 0;
  const live = (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).n;
  console.log(`  ${table.padEnd(20)} backup ${String(inBackup).padStart(6)}   now ${String(live).padStart(6)}`);
}

if (!write) {
  console.log('\n  Dry run. Nothing was written — add --write to restore.\n');
  await db.close();
  process.exit(0);
}

// One transaction: a half-restored database would be worse than the one we
// started with.
const restored = await importRows(db, backup.tables, { replace: true });
console.log(`\n  Restored ${restored} rows.\n`);
await db.close();
