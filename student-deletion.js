import { createHash } from 'node:crypto';
import { db } from './database.js';
import { firebaseRequest } from './email-auth.js';
import { verifyPassword } from './password.js';
import { removeImage } from './media.js';
import { staffSecurity } from './security.js';

async function removeStudentData(id, verifyIdentity) {
    const connection = await db.getConnection();
    let images;
    try {
        await connection.beginTransaction();
        const [[student]] = await connection.execute('SELECT id, firebase_uid, avatar_name, password_hash, password_version, account_status FROM students WHERE id = ? FOR UPDATE', [id]);
        if (!student || !verifyIdentity(student)) throw Object.assign(new Error('アカウントが見つからないか、状態が変わりました。'), { status: 409 });
        // A teacher cannot delete another person's Firebase credential with the public API key.
        // This pseudonymous marker prevents that credential from recreating the local account.
        if (student.firebase_uid) {
            const marker = createHash('sha256').update(student.firebase_uid).digest();
            await connection.execute('INSERT IGNORE INTO deleted_students (firebase_uid_hash) VALUES (?)', [marker]);
        }
        const [posts] = await connection.execute('SELECT image_name FROM suggestions WHERE student_id = ? FOR UPDATE', [id]);
        images = [student.avatar_name, ...posts.map(post => post.image_name)];
        for (const table of ['reactions', 'comments']) {
            await connection.execute('DELETE FROM ' + table + ' WHERE student_id = ? OR post_id IN (SELECT id FROM suggestions WHERE student_id = ?)', [id, id]);
        }
        await connection.execute('DELETE FROM suggestions WHERE student_id = ?', [id]);
        await connection.execute('DELETE FROM students WHERE id = ?', [id]);
        if (process.env.MEDIA_STORAGE === 'database') {
            for (const image of images) await removeImage(image, connection);
        }
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
    if (process.env.MEDIA_STORAGE !== 'database') {
        for (const image of images) await removeImage(image).catch(() => console.error('Could not remove an old local student image.'));
    }
}

export function registerStudentDeletion(app, requireStudent, requireStaff, loginLimit) {
    const confirmed = req => req.body?.confirmation === 'DELETE' && typeof req.body.password === 'string' && req.body.password.length <= 128;
    const denied = res => res.status(400).json({ error: '現在のパスワードと確認文字 DELETE を入力してください。' });

    app.post('/api/student/delete-account', requireStudent, loginLimit, async (req, res) => {
        if (!confirmed(req)) return denied(res);
        const id = req.session.studentId;
        const [[student]] = await db.execute('SELECT CONVERT(email USING utf8mb4) AS email, firebase_uid, password_hash FROM students WHERE id = ?', [id]);
        if (!student) return denied(res);
        // Require fresh proof of identity before a permanent operation, even with a valid session.
        let firebaseToken;
        if (student.firebase_uid) {
            try {
                const account = await firebaseRequest('signInWithPassword', { email: student.email, password: req.body.password, returnSecureToken: true });
                if (account.localId !== student.firebase_uid.toString()) return denied(res);
                firebaseToken = account.idToken;
            } catch (error) {
                if (error.status === 401) return denied(res);
                throw error;
            }
        } else if (!await verifyPassword(req.body.password, student.password_hash)) return denied(res);
        await removeStudentData(id, row => row.account_status === 'active' && row.password_version === req.session.passwordVersion
            && row.password_hash === student.password_hash);
        let providerPending = false;
        if (firebaseToken) {
            try { await firebaseRequest('delete', { idToken: firebaseToken }); }
            catch { providerPending = true; req.moderationEvent = '/api/student/deleted-provider-pending'; }
        }
        await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
        res.clearCookie('student_voice_sid');
        res.json({ message: providerPending ? 'サイトのデータを削除しました。認証アカウントの削除については先生に確認してください。'
            : 'アカウントと投稿した記事を完全に削除しました。' });
    });

    app.post('/api/staff/students/:id/delete-permanently', requireStaff, loginLimit, async (req, res) => {
        const id = Number(req.params.id);
        if (!confirmed(req) || !Number.isSafeInteger(id) || id < 1) return denied(res);
        const teacher = await staffSecurity(req.session.staffId);
        if (!teacher || !await verifyPassword(req.body.password, teacher.password_hash)) return denied(res);
        await removeStudentData(id, row => row.account_status === 'archived');
        req.moderationEvent = '/api/staff/students/' + id + '/delete-permanently';
        res.json({ message: 'サイトのアカウントと記事を完全に削除しました。メール認証は必要に応じて担当者が確認してください。' });
    });
}
