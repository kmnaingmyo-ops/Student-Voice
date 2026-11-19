import { readFile } from 'node:fs/promises';
import { hashPassword } from './password.js';

// Run with an operator connection; the web account should not need schema privileges.
export async function migrateDatabase(db, options = {}) {
    // Create missing tables without replacing existing school data.
    const schema = await readFile(new URL('./database.sql', import.meta.url), 'utf8');
    for (const statement of schema.split(';')) {
        const sql = statement.trim();
        if (sql && !/^(CREATE DATABASE|USE )/i.test(sql)) await db.query(sql);
    }
    // Add email fields to an existing installation without changing account IDs.
    const [columns] = await db.query('SHOW COLUMNS FROM students');
    for (const [column, definition] of Object.entries({
        email: 'VARBINARY(254) DEFAULT NULL',
        firebase_uid: 'VARBINARY(128) DEFAULT NULL',
        email_verified: 'TINYINT(1) NOT NULL DEFAULT 0',
    })) {
        if (!columns.some(item => item.Field === column)) await db.query('ALTER TABLE students ADD COLUMN ' + column + ' ' + definition);
    }
    // TiDB requires ADD COLUMN and CREATE UNIQUE INDEX to be separate statements.
    const [indexes] = await db.query('SHOW INDEX FROM students');
    for (const column of ['email', 'firebase_uid']) {
        const unique = indexes.some(index => Number(index.Non_unique) === 0
            && index.Column_name === column
            && indexes.filter(item => item.Key_name === index.Key_name).length === 1);
        if (!unique) await db.query('CREATE UNIQUE INDEX uq_students_' + column + ' ON students (' + column + ')');
    }
    await db.query('CREATE TABLE IF NOT EXISTS media_files (name VARCHAR(50) PRIMARY KEY, data MEDIUMBLOB NOT NULL)');
    const username = options.username;
    const password = options.password || '';
    if (username === undefined) return;
    if (!/^[A-Za-z0-9_]{4,32}$/.test(username)) {
        throw new Error('Set a valid initial teacher username in hosting settings.');
    }
    const [existing] = await db.execute('SELECT id FROM staff WHERE username = ?', [username]);
    if (!existing.length) {
        if (password.length < 15 || password.length > 64) throw new Error('New teacher passwords must be 15–64 characters.');
        await db.execute('INSERT INTO staff (username, password_hash) VALUES (?, ?)', [username, await hashPassword(password)]);
    }
}
