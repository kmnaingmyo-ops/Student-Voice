import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { realpath } from 'node:fs/promises';
import { dirname, relative, isAbsolute } from 'node:path';
import { migrateDatabase } from './migrations.js';

// Sessions and request counters are deliberately excluded: a restore signs users out.
export const backupTables = ['staff', 'students', 'suggestions', 'reactions', 'comments',
    'staff_security', 'security_events', 'media_files', 'deleted_students'];
const order = { staff: 'id', students: 'id', suggestions: 'id', reactions: 'post_id, student_id',
    comments: 'id', staff_security: 'staff_id', security_events: 'id', media_files: 'name', deleted_students: 'firebase_uid_hash' };
const magic = Buffer.from('SVBKP001');
const maxSize = 100 * 1024 * 1024;
export async function assertExternalBackupPath(file, repository) {
    const folder = relative(await realpath(repository), await realpath(dirname(file)));
    if (!isAbsolute(folder) && folder !== '..' && !folder.startsWith('..\\') && !folder.startsWith('../')) {
        throw new Error('Keep encrypted backups outside the repository.');
    }
}

export function backupKey(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw Error('Use a random 32-byte base64 BACKUP_KEY');
    const key = Buffer.from(value, 'base64');
    if (key.length !== 32 || key.toString('base64') !== value) throw Error('Invalid BACKUP_KEY');
    return key;
}
export function encryptBackup(snapshot, key) {
    const plain = Buffer.from(JSON.stringify(snapshot));
    if (plain.length > maxSize) throw Error('Backup exceeds the 100 MiB school-project limit');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(magic);
    const encrypted = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
    return Buffer.concat([magic, iv, cipher.getAuthTag(), encrypted]);
}
export function decryptBackup(bytes, key) {
    if (bytes.length < 37 || bytes.length > maxSize || !bytes.subarray(0, 8).equals(magic)) throw Error('Invalid backup file');
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(8, 20));
    decipher.setAAD(magic);
    decipher.setAuthTag(bytes.subarray(20, 36));
    const plain = Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()]);
    return JSON.parse(gunzipSync(plain, { maxOutputLength: maxSize }).toString('utf8'));
}
export async function snapshotDatabase(connection) {
    await connection.query("SET time_zone = '+00:00'");
    const [[row]] = await connection.query('SELECT DATABASE() AS name');
    if (!row.name) throw Error('Select the source database first');
    // InnoDB and TiDB give a consistent transaction snapshot. Pause schema changes.
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.beginTransaction();
    try {
        const tables = {};
        let size = 0;
        for (const table of backupTables) {
            tables[table] = [];
            const pageSize = table === 'media_files' ? 1 : 100;
            for (let offset = 0; ; offset += pageSize) {
                const [rows] = await connection.query('SELECT * FROM `' + table + '` ORDER BY ' + order[table] + ' LIMIT ? OFFSET ?', [pageSize, offset]);
                for (const record of rows) {
                    const saved = Object.fromEntries(Object.entries(record)
                        .map(([column, value]) => [column, Buffer.isBuffer(value) ? { binary: value.toString('base64') } : value]));
                    size += Buffer.byteLength(JSON.stringify(saved)) + 1;
                    if (size > maxSize || tables[table].length >= 100000) throw Error('Backup exceeds the school-project size/row limit');
                    tables[table].push(saved);
                }
                if (rows.length < pageSize) break;
            }
        }
        await connection.commit();
        return { version: 1, database: row.name, createdAt: new Date().toISOString(), tables };
    } catch (error) { await connection.rollback(); throw error; }
}
function cell(value) {
    if (value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value;
    if (value && Object.keys(value).length === 1 && typeof value.binary === 'string') {
        const data = Buffer.from(value.binary, 'base64');
        if (data.toString('base64') === value.binary) return data;
    }
    throw Error('Invalid backup field');
}
export async function restoreRecoveryDatabase(connection, snapshot) {
    const [[row]] = await connection.query('SELECT DATABASE() AS name');
    // Never overwrite the live database, even if the operator passes its name by mistake.
    if (!/^sv_restore_[a-z0-9_]+$/.test(row.name || '') || row.name === snapshot.database) throw Error('Restore requires a separate sv_restore_ database');
    const [existing] = await connection.query('SHOW TABLES');
    if (existing.length) throw Error('Restore target must be completely empty');
    const [[encoding]] = await connection.query('SELECT @@character_set_database AS charset');
    if (encoding.charset !== 'utf8mb4') throw Error('Create the recovery database with CHARACTER SET utf8mb4');
    if (snapshot.version !== 1 || !snapshot.tables || Object.keys(snapshot.tables).some(table => !backupTables.includes(table))
        || backupTables.some(table => !(table === 'deleted_students' && snapshot.tables[table] === undefined)
            && (!Array.isArray(snapshot.tables[table]) || snapshot.tables[table].length > 100000))) throw Error('Unsupported backup contents');
    await connection.query("SET time_zone = '+00:00'");
    await migrateDatabase(connection);
    await connection.beginTransaction();
    try {
        for (const table of backupTables) {
            const [columns] = await connection.query('SHOW COLUMNS FROM `' + table + '`');
            const allowed = new Set(columns.map(column => column.Field));
            for (const record of snapshot.tables[table] ?? []) {
                const names = Object.keys(record);
                if (!names.length || names.some(name => !allowed.has(name) || !/^[a-z_]+$/.test(name))) throw Error('Unknown backup column');
                await connection.execute('INSERT INTO `' + table + '` (' + names.map(name => '`' + name + '`').join(',')
                    + ') VALUES (' + names.map(() => '?').join(',') + ')', names.map(name => cell(record[name])));
            }
        }
        await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
}
