import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export async function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    const key = await scrypt(password, salt, 64);
    return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt' || !/^[a-f0-9]{128}$/.test(parts[2])) {
        return false;
    }
    const expected = Buffer.from(parts[2], 'hex');
    const actual = await scrypt(password, parts[1], 64);
    return timingSafeEqual(actual, expected);
}
