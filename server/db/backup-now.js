/**
 * `npm run backup` — take today's backup right now.
 *
 * The running server already does this once a day on its own; this is for a
 * backup before a risky change, or on a machine where the server is not left
 * running. Safe to run while the server is up (WAL allows a second reader).
 */
import { db } from './index.js';
import { config } from '../config.js';
import { backupDatabase } from './backup.js';

const { created, removed } = backupDatabase(db, config.backup);
console.log(created ? `Backup written: ${created}` : `Today's backup already exists in ${config.backup.dir}`);
if (removed.length) console.log(`Removed ${removed.length} older backup(s): ${removed.join(', ')}`);
db.close();
