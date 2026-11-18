import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { db } from '../database.js';
import { hashPassword } from '../password.js';

const prompt = createInterface({ input: stdin, output: stdout });
try {
    const username = (await prompt.question('Staff username (4–32 letters, digits or underscores): ')).trim();
    const password = await prompt.question('Password (15–64 characters, visible while typing): ');
    if (!/^[A-Za-z0-9_]{4,32}$/.test(username) || password.length < 15 || password.length > 64) {
        throw new Error('Check the username and password length.');
    }
    const hash = await hashPassword(password);
    await db.execute(
        'INSERT INTO staff (username, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash = ?',
        [username, hash, hash],
    );
    console.log('Staff account saved.');
} catch (error) {
    console.error(error.code ? 'Database error. Check .env and the SQL import.' : error.message);
    process.exitCode = 1;
} finally {
    prompt.close();
    await db.end();
}
