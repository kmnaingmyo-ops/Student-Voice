import { db } from './database.js';
import { uploadImage, saveImage, removeImage, sendImage } from './media.js';

export function registerProfileRoutes(app, requireStudent, limit) {
    app.get('/api/profile', requireStudent, async (req, res) => {
        const [students] = await db.execute(
            'SELECT username, CONVERT(email USING utf8mb4) AS email, display_name, bio, avatar_name IS NOT NULL AS has_avatar, created_at FROM students WHERE id = ?',
            [req.session.studentId]);
        const [posts] = await db.execute(
            'SELECT id, title, category, body, status, created_at FROM suggestions WHERE student_id = ? ORDER BY id DESC',
            [req.session.studentId]);
        res.json({ ...students[0], posts });
    });

    app.get('/api/profile/avatar', requireStudent, async (req, res, next) => {
        const [students] = await db.execute('SELECT avatar_name FROM students WHERE id = ?', [req.session.studentId]);
        const name = students[0]?.avatar_name;
        if (!/^[a-f0-9]{32}\.webp$/.test(name || '')) return res.status(404).end();
        await sendImage(res, name, next);
    });

    app.post('/api/profile', requireStudent, limit, uploadImage, async (req, res) => {
        const { display_name: displayName, bio, remove_avatar: removeAvatar } = req.body || {};
        if (typeof displayName !== 'string' || displayName.trim().length > 40
            || typeof bio !== 'string' || bio.trim().length > 300
            || (removeAvatar !== undefined && removeAvatar !== '1')
            || (removeAvatar === '1' && req.file)) {
            return res.status(400).json({ error: '表示名は40文字、自己紹介は300文字までです。画像の変更と削除は別々に行ってください。' });
        }
        const connection = await db.getConnection();
        let newName = null;
        let previousName = null;
        try {
            newName = await saveImage(req.file);
            await connection.beginTransaction();
            const [rows] = await connection.execute('SELECT avatar_name FROM students WHERE id = ? FOR UPDATE', [req.session.studentId]);
            previousName = rows[0].avatar_name;
            const avatar = removeAvatar === '1' ? null : newName || previousName;
            await connection.execute('UPDATE students SET display_name = ?, bio = ?, avatar_name = ? WHERE id = ?',
                [displayName.trim(), bio.trim(), avatar, req.session.studentId]);
            await connection.commit();
            if (avatar === previousName) previousName = null;
        } catch (error) {
            await connection.rollback();
            await removeImage(newName);
            throw error;
        } finally {
            connection.release();
        }
        // The profile is already saved. A missing older file should not fail the request.
        if (previousName) {
            await removeImage(previousName).catch(() => console.error('Could not remove an old profile image.'));
        }
        res.json({ message: 'プロフィールを保存しました。' });
    });
}
