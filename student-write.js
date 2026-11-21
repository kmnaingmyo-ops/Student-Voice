import { db } from './database.js';

// Lock the account before writing so a ban or logout-all cannot be bypassed
// by a request that passed authentication just before the account changed.
export async function withStudentWrite(req, work) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [[student]] = await connection.execute('SELECT id, account_status, password_version, avatar_name FROM students WHERE id = ? FOR UPDATE', [req.session.studentId]);
        if (!student || student.account_status !== 'active' || student.password_version !== req.session.passwordVersion) {
            throw Object.assign(new Error('もう一度ログインしてください。'), { status: 401 });
        }
        const result = await work(connection, student);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

export function integerSetting(name, fallback, minimum, maximum) {
    const value = process.env[name];
    if (!value) return fallback;
    const parsed = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new Error(name + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
    }
    return parsed;
}
