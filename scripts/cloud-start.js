import { readFile } from 'node:fs/promises';
import { db } from '../database.js';
import { hashPassword } from '../password.js';

// Create missing tables without replacing existing school data.
const schema = await readFile(new URL('../database.sql', import.meta.url), 'utf8');
for (const statement of schema.split(';')) {
    const sql = statement.trim();
    if (sql && !/^(CREATE DATABASE|USE )/i.test(sql)) await db.query(sql);
}
// Add email fields to an existing installation without changing account IDs.
const [columns] = await db.query('SHOW COLUMNS FROM students');
for (const [column, definition] of Object.entries({
    email: 'VARCHAR(254) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL UNIQUE',
    firebase_uid: 'VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL UNIQUE',
    email_verified: 'TINYINT(1) NOT NULL DEFAULT 0',
})) {
    if (!columns.some(item => item.Field === column)) await db.query('ALTER TABLE students ADD COLUMN ' + column + ' ' + definition);
}
await db.query('CREATE TABLE IF NOT EXISTS media_files (name VARCHAR(50) PRIMARY KEY, data MEDIUMBLOB NOT NULL)');
const username = process.env.INITIAL_STAFF_USERNAME || '';
const password = process.env.INITIAL_STAFF_PASSWORD || '';
if (!/^[A-Za-z0-9_]{4,32}$/.test(username)) {
    throw new Error('Set a valid initial teacher username in hosting settings.');
}
const [existing] = await db.execute('SELECT id FROM staff WHERE username = ?', [username]);
if (!existing.length) {
    if (password.length < 15 || password.length > 64) throw new Error('New teacher passwords must be 15–64 characters.');
    await db.execute('INSERT INTO staff (username, password_hash) VALUES (?, ?)', [username, await hashPassword(password)]);
}
const { app } = await import('../server.js');
app.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => console.log('Student Voice is online.'));
