import mysql from 'mysql2/promise';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateDatabase } from './migrations.js';
import { assertExternalBackupPath, backupKey, encryptBackup, decryptBackup, snapshotDatabase, restoreRecoveryDatabase } from './recovery.js';

// Load a separate private operator environment file, never the web service's secrets.
const [action, filename] = process.argv.slice(2);
let connection;
try {
    if (!['migrate', 'backup', 'restore-test'].includes(action)) throw Error('Use migrate, backup FILE.svbackup, or restore-test FILE.svbackup');
    if (!process.env.OPERATOR_DB_USER || process.env.OPERATOR_DB_PASSWORD === undefined) throw Error('Set separate OPERATOR_DB_USER and OPERATOR_DB_PASSWORD');
    if (action !== 'migrate' && (!filename || extname(filename) !== '.svbackup')) throw Error('Choose a .svbackup file outside the repository');
    const file = filename ? resolve(filename) : '';
    if (file) await assertExternalBackupPath(file, fileURLToPath(new URL('./', import.meta.url)));
    const key = action !== 'migrate' ? backupKey(process.env.BACKUP_KEY) : null;
    let snapshot;
    if (action === 'restore-test') {
        if ((await stat(file)).size > 100 * 1024 * 1024) throw Error('Backup file is too large');
        snapshot = decryptBackup(await readFile(file), key);
    }
    connection = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
        database: process.env.DB_NAME, user: process.env.OPERATOR_DB_USER, password: process.env.OPERATOR_DB_PASSWORD,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
        dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
    if (action === 'migrate') {
        await migrateDatabase(connection, process.env.INITIAL_STAFF_USERNAME ? {
            username: process.env.INITIAL_STAFF_USERNAME, password: process.env.INITIAL_STAFF_PASSWORD,
        } : {});
        console.log('Database migration completed.');
    } else if (action === 'backup') {
        const bytes = encryptBackup(await snapshotDatabase(connection), key);
        await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
        console.log('Encrypted backup saved. Preserve BACKUP_KEY separately; no sessions were exported.');
    } else {
        await restoreRecoveryDatabase(connection, snapshot);
        console.log('Backup restored into the isolated recovery database. Verify records before planning any production switch.');
    }
} catch {
    // Database errors can contain SQL values. Never dump them or operator credentials.
    console.error('Maintenance failed. Check the action, private settings, file/key, database privileges, and empty sv_restore_ target. No production restore is supported.');
    process.exitCode = 1;
} finally { if (connection) await connection.end(); }
