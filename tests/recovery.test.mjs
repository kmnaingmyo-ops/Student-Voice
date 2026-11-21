import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { migrateDatabase } from '../migrations.js';
import { backupKey, encryptBackup, decryptBackup, snapshotDatabase, restoreRecoveryDatabase } from '../recovery.js';

test('encrypted backups reject wrong keys and tampering', () => {
    const key = backupKey(randomBytes(32).toString('base64'));
    const data = { version: 1, private: 'fictional school data' };
    const bytes = encryptBackup(data, key);
    assert(!bytes.includes(Buffer.from(data.private)));
    assert.deepEqual(decryptBackup(bytes, key), data);
    assert.throws(() => decryptBackup(bytes, randomBytes(32)));
    const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1;
    assert.throws(() => decryptBackup(changed, key));
    assert.throws(() => backupKey('short'));
});

test('restore preserves articles, media, binary emails and MFA while excluding sessions',
    { skip: process.env.SECURITY_TEST_DB !== 'true' }, async () => {
    assert.match(process.env.DB_NAME || '', /^sv_security_[a-z0-9_]+$/);
    const suffix = randomBytes(6).toString('hex');
    const source = 'sv_security_recovery_' + suffix, target = 'sv_restore_' + suffix;
    const connection = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
    try {
        await connection.query('CREATE DATABASE ' + source + ' CHARACTER SET utf8mb4');
        await connection.query('USE ' + source);
        await migrateDatabase(connection);
        await connection.execute('INSERT INTO staff (id, username, password_hash) VALUES (1, ?, ?)', ['fixtureteacher', 'fixture-hash']);
        await connection.execute('INSERT INTO students (id, username, email, password_hash) VALUES (1, ?, ?, ?)', ['fixturestudent', Buffer.from('fixture@school.invalid'), 'fixture-hash']);
        await connection.execute("INSERT INTO suggestions (id, student_id, title, category, body, status) VALUES (1, 1, ?, ?, ?, 'published')", ['Recovery fixture', '授業', 'Fictional restore-test article']);
        await connection.query("INSERT INTO reactions VALUES (1, 1, 'love')");
        await connection.execute('INSERT INTO comments (post_id, student_id, body) VALUES (1, 1, ?)', ['Fictional comment']);
        await connection.execute('INSERT INTO media_files VALUES (?, ?)', ['fixture.webp', Buffer.from([0, 1, 128, 255])]);
        await connection.execute('INSERT INTO staff_security (staff_id, secret_cipher, recovery_hashes) VALUES (1, ?, ?)', ['encrypted-fixture-key', '["hashed-fixture-code"]']);
        await connection.execute('INSERT INTO app_sessions VALUES (?, ?, ?)', [Buffer.from('fixture-session'), 'should-not-restore', Date.now() + 60000]);
        await connection.execute('INSERT INTO security_limits VALUES (?, 1, ?)', [Buffer.from('fixture-limit'), Date.now() + 60000]);
        const before = await snapshotDatabase(connection);
        const key = randomBytes(32), backup = encryptBackup(before, key);
        await assert.rejects(restoreRecoveryDatabase(connection, before), /separate sv_restore_/);
        await connection.query('CREATE DATABASE ' + target + ' CHARACTER SET utf8mb4');
        await connection.query('USE ' + target);
        await restoreRecoveryDatabase(connection, decryptBackup(backup, key));
        const after = await snapshotDatabase(connection);
        assert.deepEqual(after.tables, before.tables);
        for (const table of ['app_sessions', 'security_limits']) {
            const [[row]] = await connection.query('SELECT COUNT(*) AS count FROM ' + table);
            assert.equal(Number(row.count), 0);
        }
        await assert.rejects(restoreRecoveryDatabase(connection, before), /completely empty/);
    } finally {
        for (const name of [target, source]) await connection.query('DROP DATABASE IF EXISTS ' + name);
        await connection.end();
    }
});

test('separate migrations preserve existing accounts and can run twice',
    { skip: process.env.SECURITY_TEST_DB !== 'true' }, async () => {
    assert.match(process.env.DB_NAME || '', /^sv_security_[a-z0-9_]+$/);
    const name = 'sv_security_migration_' + randomBytes(6).toString('hex');
    const connection = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' });
    try {
        await connection.query('CREATE DATABASE ' + name + ' CHARACTER SET utf8mb4');
        await connection.query('USE ' + name);
        await connection.query('CREATE TABLE students (id INT UNSIGNED PRIMARY KEY, username VARCHAR(32) UNIQUE, password_hash VARCHAR(255) NOT NULL)');
        await connection.query("INSERT INTO students VALUES (7, 'oldstudent', 'unchanged-fixture-hash')");
        await migrateDatabase(connection);
        await migrateDatabase(connection);
        const [[student]] = await connection.query('SELECT id, username, password_hash, email, firebase_uid FROM students');
        assert.equal(student.id, 7);
        assert.equal(student.password_hash, 'unchanged-fixture-hash');
        assert.equal(student.email, null);
        assert.equal(student.firebase_uid, null);
        const [indexes] = await connection.query('SHOW INDEX FROM students');
        for (const column of ['email', 'firebase_uid']) assert(indexes.some(index => index.Column_name === column && Number(index.Non_unique) === 0));
    } finally {
        await connection.query('DROP DATABASE IF EXISTS ' + name);
        await connection.end();
    }
});


test('backup paths must be outside the repository', async () => {
    const { mkdtemp, mkdir, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { assertExternalBackupPath } = await import('../recovery.js');
    const root = await mkdtemp(join(tmpdir(), 'sv-backup-path-'));
    const repo = join(root, 'checkout');
    try {
        await mkdir(join(repo, 'backups'), { recursive: true });
        await assert.rejects(assertExternalBackupPath(join(repo, 'backups', 'example.svbackup'), repo), /outside the repository/);
        await assertExternalBackupPath(join(root, 'example.svbackup'), repo);
    } finally { await rm(root, { recursive: true, force: true }); }
});
