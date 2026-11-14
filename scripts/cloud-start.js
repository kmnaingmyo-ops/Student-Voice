import { readFile } from 'node:fs/promises';
import { db } from '../database.js';
import { hashPassword } from '../password.js';

// Create missing tables without replacing existing school data.
const schema = await readFile(new URL('../database.sql', import.meta.url), 'utf8');
for (const statement of schema.split(';')) {
    const sql = statement.trim();
    if (sql && !/^(CREATE DATABASE|USE )/i.test(sql)) await db.query(sql);
}
await db.query('CREATE TABLE IF NOT EXISTS media_files (name VARCHAR(50) PRIMARY KEY, data MEDIUMBLOB NOT NULL)');
const username = process.env.INITIAL_STAFF_USERNAME || '';
const password = process.env.INITIAL_STAFF_PASSWORD || '';
if (!/^[A-Za-z0-9_]{4,32}$/.test(username) || password.length < 4 || password.length > 8) {
    throw new Error('Set the initial teacher username and a 4–8 character password in hosting settings.');
}
const [existing] = await db.execute('SELECT id FROM staff WHERE username = ?', [username]);
if (!existing.length) {
    await db.execute('INSERT INTO staff (username, password_hash) VALUES (?, ?)', [username, await hashPassword(password)]);
}
const { app } = await import('../server.js');
app.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => console.log('Student Voice is online.'));
