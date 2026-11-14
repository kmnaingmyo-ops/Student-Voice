import express from 'express';
import { resolve } from 'node:path';
import session from 'express-session';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db } from './database.js';
import { verifyPassword, hashPassword } from './password.js';
import { uploadImage, saveImage, removeImage } from './media.js';
import { registerSocialRoutes } from './social.js';
import { registerProfileRoutes } from './profile.js';

const secret = process.env.SESSION_SECRET || '';
if (secret.length < 32 || secret.startsWith('CHANGE_')) {
    throw new Error('Set a random SESSION_SECRET of at least 32 characters in .env.');
}

export const app = express();
const categories = ['授業', '学校生活', '設備', 'その他'];
const dummyHash = await hashPassword(randomBytes(32).toString('hex'));

app.disable('x-powered-by');
app.use((req, res, next) => {
    res.set({
        'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' blob:",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
    });
    next();
});
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
app.use(express.json({ limit: '32kb' }));
// Memory sessions are suitable for this local, single-process classroom app.
app.use(session({
    name: 'student_voice_sid',
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'strict', maxAge: 60 * 60 * 1000 },
}));

app.use('/api', (req, res, next) => {
    req.session.csrf ??= randomBytes(32).toString('hex');
    if (req.method !== 'GET') {
        const token = req.get('X-CSRF-Token') || '';
        const expected = req.session.csrf;
        if (!/^[a-f0-9]{64}$/.test(token)
            || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
            return res.status(403).json({ error: 'ページを再読み込みしてください。' });
        }
    }
    next();
});

function requireStaff(req, res, next) {
    if (!req.session.staffId) {
        return res.status(401).json({ error: '先生用ログインが必要です。' });
    }
    next();
}

const limitMessage = { error: '少し待ってから、もう一度お試しください。' };
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, message: limitMessage });
const postLimit = rateLimit({ windowMs: 60 * 1000, limit: 5, message: limitMessage });
const resetLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, message: limitMessage });
const socialLimit = rateLimit({ windowMs: 60 * 1000, limit: 40, message: limitMessage });

async function requireStudent(req, res, next) {
    const [rows] = await db.execute('SELECT password_version FROM students WHERE id = ?', [req.session.studentId || 0]);
    if (!rows.length || rows[0].password_version !== req.session.passwordVersion) {
        delete req.session.studentId;
        return res.status(401).json({ error: '投稿するには生徒アカウントでログインしてください。' });
    }
    next();
}

function studentCredentials(username, password) {
    return typeof username === 'string' && /^[A-Za-z0-9_]{4,32}$/.test(username)
        && typeof password === 'string' && password.length >= 4 && password.length <= 8;
}

function startStudentSession(req, res, next, student) {
    req.session.regenerate(error => {
        if (error) return next(error);
        req.session.studentId = student.id;
        req.session.passwordVersion = student.password_version;
        req.session.csrf = randomBytes(32).toString('hex');
        req.session.save(error => {
            if (error) return next(error);
            res.json({ csrf: req.session.csrf });
        });
    });
}

app.post('/api/signup', loginLimit, async (req, res, next) => {
    const { username, password } = req.body || {};
    if (!studentCredentials(username, password)) {
        return res.status(400).json({ error: 'ユーザー名は半角英数字・_の4〜32文字、パスワードは4〜8文字です。' });
    }
    try {
        const [result] = await db.execute('INSERT INTO students (username, password_hash) VALUES (?, ?)',
            [username, await hashPassword(password)]);
        startStudentSession(req, res, next, { id: result.insertId, password_version: 1 });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'このユーザー名は使用されています。' });
        throw error;
    }
});

app.post('/api/student/login', loginLimit, async (req, res, next) => {
    const { username, password } = req.body || {};
    if (!studentCredentials(username, password)) return res.status(400).json({ error: '入力内容を確認してください。' });
    const [rows] = await db.execute('SELECT id, password_hash, password_version FROM students WHERE username = ?', [username]);
    if (!await verifyPassword(password, rows[0]?.password_hash || dummyHash)) {
        return res.status(401).json({ error: 'ユーザー名またはパスワードを確認してください。' });
    }
    startStudentSession(req, res, next, rows[0]);
});

app.post('/api/student/reset', resetLimit, async (req, res) => {
    const { username, password, code } = req.body || {};
    if (!studentCredentials(username, password) || typeof code !== 'string' || !/^[a-f0-9]{32}$/.test(code)) {
        return res.status(400).json({ error: 'ユーザー名・再設定コード・4〜8文字のパスワードを確認してください。' });
    }
    const digest = createHash('sha256').update(code).digest('hex');
    const [result] = await db.execute(
        'UPDATE students SET password_hash = ?, password_version = password_version + 1, reset_hash = NULL, reset_expires = NULL WHERE username = ? AND reset_hash = ? AND reset_expires > UTC_TIMESTAMP()',
        [await hashPassword(password), username, digest]);
    if (!result.affectedRows) return res.status(400).json({ error: 'コードが無効か、有効期限が切れています。' });
    res.json({ message: 'パスワードを更新しました。新しいパスワードでログインしてください。' });
});

app.post('/api/staff/reset-code', requireStaff, loginLimit, async (req, res) => {
    const username = req.body?.username;
    if (typeof username !== 'string' || !/^[A-Za-z0-9_]{4,32}$/.test(username)) {
        return res.status(400).json({ error: 'ユーザー名を確認してください。' });
    }
    const code = randomBytes(16).toString('hex');
    const [result] = await db.execute(
        'UPDATE students SET reset_hash = ?, reset_expires = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE) WHERE username = ?',
        [createHash('sha256').update(code).digest('hex'), username]);
    if (!result.affectedRows) return res.status(404).json({ error: '生徒アカウントが見つかりません。' });
    res.json({ code, message: '本人確認後に伝えてください。有効期限は15分、使用は1回です。' });
});

app.get('/api/session', async (req, res) => {
    if (req.session.studentId) {
        const [rows] = await db.execute('SELECT password_version FROM students WHERE id = ?', [req.session.studentId]);
        if (!rows.length || rows[0].password_version !== req.session.passwordVersion) {
            delete req.session.studentId;
        }
    }
    res.json({ csrf: req.session.csrf, staff: Boolean(req.session.staffId), student: Boolean(req.session.studentId), categories });
});

app.get('/api/suggestions', async (req, res) => {
    const [rows] = await db.execute(
        "SELECT id, title, category, body, created_at, cover_icon, image_name IS NOT NULL AS has_image, (SELECT COUNT(*) FROM reactions WHERE post_id = suggestions.id) AS reaction_count, (SELECT COUNT(*) FROM comments WHERE post_id = suggestions.id AND hidden = 0) AS comment_count FROM suggestions WHERE status = 'published' ORDER BY id DESC",
    );
    res.json(rows);
});

app.get('/api/suggestions/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(404).json({ error: '記事が見つかりません。' });
    const [rows] = await db.execute(
        "SELECT id, title, category, body, created_at, cover_icon, image_name IS NOT NULL AS has_image FROM suggestions WHERE id = ? AND status = 'published'", [id]);
    if (!rows.length) return res.status(404).json({ error: '記事が見つかりません。' });
    res.json(rows[0]);
});

app.post('/api/suggestions', requireStudent, postLimit, uploadImage, async (req, res) => {
    const { title, body, category } = req.body || {};
    if (typeof title !== 'string' || typeof body !== 'string'
        || !categories.includes(category)
        || !title.trim() || title.trim().length > 60
        || !body.trim() || body.trim().length > 5000) {
        return res.status(400).json({ error: 'カテゴリと文字数を確認してください。' });
    }
    const icon = req.body.cover_icon || 'outline';
    if (!['outline', 'color'].includes(icon)) return res.status(400).json({ error: 'アイコンを選択してください。' });
    const imageName = await saveImage(req.file);
    try {
        await db.execute('INSERT INTO suggestions (title, category, body, student_id, cover_icon, image_name) VALUES (?, ?, ?, ?, ?, ?)',
            [title.trim(), category, body.trim(), req.session.studentId, icon, imageName]);
    } catch (error) {
        await removeImage(imageName);
        throw error;
    }
    res.status(201).json({ message: '記事を受け付けました。先生の確認後に公開されます。' });
});

app.post('/api/login', loginLimit, async (req, res, next) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || !/^[A-Za-z0-9_]{4,32}$/.test(username)
        || typeof password !== 'string' || password.length < 4 || password.length > 128) {
        return res.status(400).json({ error: '入力内容を確認してください。' });
    }
    const [rows] = await db.execute('SELECT id, password_hash FROM staff WHERE username = ?', [username]);
    const valid = await verifyPassword(password, rows[0]?.password_hash || dummyHash);
    if (!valid) {
        return res.status(401).json({ error: 'ユーザー名またはパスワードを確認してください。' });
    }
    req.session.regenerate(error => {
        if (error) return next(error);
        req.session.staffId = rows[0].id;
        req.session.csrf = randomBytes(32).toString('hex');
        req.session.save(error => {
            if (error) return next(error);
            res.json({ csrf: req.session.csrf });
        });
    });
});

app.get('/api/staff/suggestions', requireStaff, async (req, res) => {
    const [rows] = await db.execute(
        "SELECT id, title, category, body, status, cover_icon, image_name IS NOT NULL AS has_image FROM suggestions ORDER BY (status = 'pending') DESC, id DESC",
    );
    res.json(rows);
});

app.post('/api/staff/suggestions/:id', requireStaff, async (req, res) => {
    const id = Number(req.params.id);
    const status = req.body?.status;
    if (!Number.isSafeInteger(id) || id < 1 || !['published', 'hidden'].includes(status)) {
        return res.status(400).json({ error: '入力内容を確認してください。' });
    }
    const [result] = await db.execute('UPDATE suggestions SET status = ? WHERE id = ?', [status, id]);
    if (!result.affectedRows) return res.status(404).json({ error: '投稿が見つかりません。' });
    res.json({ message: '投稿の状態を更新しました。' });
});

app.post('/api/logout', (req, res, next) => {
    req.session.destroy(error => {
        if (error) return next(error);
        res.clearCookie('student_voice_sid');
        res.json({ message: 'ログアウトしました。' });
    });
});

registerSocialRoutes(app, requireStudent, requireStaff, socialLimit);
registerProfileRoutes(app, requireStudent, socialLimit);

app.use((req, res) => res.status(404).json({ error: 'ページが見つかりません。' }));
app.use((error, req, res, next) => {
    const status = error.code?.startsWith('LIMIT_') ? 400
        : [400, 404, 413].includes(error.status) ? error.status : 503;
    console.error('Request failed:', error.code || error.type || 'internal error');
    res.status(status).json({ error: status === 503
        ? '接続できません。データベースの設定を確認してください。'
        : error.code?.startsWith('LIMIT_') ? '画像は1枚・3MBまでです。入力内容を確認してください。'
        : '入力内容を確認してください。' });
});

// Bind to this computer for local school demonstrations.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    app.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => {
        console.log(`Student Voice: http://localhost:${process.env.PORT || 3000}`);
    });
}
