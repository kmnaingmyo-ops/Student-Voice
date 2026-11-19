import { registerEmailAuth, verifiedFirebaseUser, passwordProblem } from './email-auth.js';
import express from 'express';
import { resolve } from 'node:path';
import session from 'express-session';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db } from './database.js';
import { verifyPassword, hashPassword } from './password.js';
import { uploadImage, saveImage, removeImage } from './media.js';
import { registerSocialRoutes } from './social.js';
import { registerProfileRoutes } from './profile.js';
import { initSecurity, DatabaseSessionStore, DatabaseRateStore, securityLogging, requireStaff, hasStaffSession, staffSecurity, startStaffSession, registerSecurityRoutes, fingerprint } from './security.js';

const secret = process.env.SESSION_SECRET || '';
if (secret.length < 32 || /^(CHANGE_|replace-|example)/i.test(secret) || /^(.)\1+$/.test(secret)) {
    throw new Error('Set a random SESSION_SECRET of at least 32 characters in .env.');
}

export const app = express();
const categories = ['授業', '学校生活', '設備', 'その他'];
const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
await initSecurity();

app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use((req, res, next) => {
    res.set({
        'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' blob:",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'X-Frame-Options': 'DENY',
        ...(process.env.NODE_ENV === 'production' ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
    });
    next();
});
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
app.use(express.json({ limit: '32kb' }));
app.use(session({
    store: new DatabaseSessionStore(),
    name: 'student_voice_sid',
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, sameSite: 'strict', maxAge: 60 * 60 * 1000 },
}));
app.use(securityLogging);

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

const limitMessage = { error: '少し待ってから、もう一度お試しください。' };
const limiter = (prefix, windowMs, limit, extra = {}) => rateLimit({ windowMs, limit, message: limitMessage, store: new DatabaseRateStore(prefix), standardHeaders: 'draft-8', legacyHeaders: false, ...extra });
const loginLimit = limiter('login', 15 * 60 * 1000, 10);
const postLimit = limiter('post', 60 * 1000, 5);
const resetLimit = limiter('reset', 15 * 60 * 1000, 5);
const socialLimit = limiter('social', 60 * 1000, 40);
const mfaLimit = limiter('mfa-account', 15 * 60 * 1000, 5, { keyGenerator: req => String(req.session.staffChallenge?.id || 'guest') });
app.use('/api', limiter('api', 60 * 1000, 180));
app.use(['/api/login', '/api/student/login', '/api/student/email-login', '/api/student/request-password-reset'],
    limiter('auth-account', 15 * 60 * 1000, 20, { keyGenerator: req => {
        const identity = req.body?.email || req.body?.username;
        return fingerprint(typeof identity === 'string' ? identity.trim().toLowerCase().slice(0, 254) : ipKeyGenerator(req.ip));
    } }));
registerSecurityRoutes(app, loginLimit, mfaLimit);

async function requireStudent(req, res, next) {
    const [rows] = await db.execute('SELECT password_version FROM students WHERE id = ?', [req.session.studentId || 0]);
    if (!rows.length || rows[0].password_version !== req.session.passwordVersion) {
        delete req.session.studentId;
        return res.status(401).json({ error: '投稿するには生徒アカウントでログインしてください。' });
    }
    if (req.session.firebaseToken) {
        try {
            const user = await verifiedFirebaseUser(req.session.firebaseToken);
            if (!user || user.localId !== req.session.firebaseUid) {
                delete req.session.studentId;
                return res.status(401).json({ error: 'もう一度ログインしてください。' });
            }
        } catch (error) {
            if (error.status === 401) {
                delete req.session.studentId;
                return res.status(401).json({ error: 'もう一度ログインしてください。' });
            }
            throw error;
        }
    }
    next();
}

function studentCredentials(username, password, minimum = 15) {
    return typeof username === 'string' && /^[A-Za-z0-9_]{4,32}$/.test(username)
        && typeof password === 'string' && [...password].length >= minimum && [...password].length <= 64;
}

function startStudentSession(req, res, next, student) {
    req.session.regenerate(error => {
        if (error) return next(error);
        req.session.studentId = student.id;
        req.session.passwordVersion = student.password_version;
        if (student.firebaseToken) {
            req.session.firebaseToken = student.firebaseToken;
            req.session.firebaseUid = student.firebaseUid;
        }
        req.session.csrf = randomBytes(32).toString('hex');
        req.session.save(error => {
            if (error) return next(error);
            res.json({ csrf: req.session.csrf });
        });
    });
}

registerEmailAuth(app, loginLimit, startStudentSession);

app.post('/api/student/login', loginLimit, async (req, res, next) => {
    const { username: oldUsername, email, password } = req.body || {};
    const username = oldUsername || email;
    if (!studentCredentials(username, password, 4)) return res.status(400).json({ error: '入力内容を確認してください。' });
    const [rows] = await db.execute('SELECT id, password_hash, password_version FROM students WHERE username = ? AND firebase_uid IS NULL', [username]);
    if (!await verifyPassword(password, rows[0]?.password_hash || dummyHash)) {
        return res.status(401).json({ error: 'ユーザー名またはパスワードを確認してください。' });
    }
    if (passwordProblem(password, username)) {
        // This challenge proves the old password, but grants no student privileges.
        await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
        req.session.studentUpgrade = { id: rows[0].id, at: Date.now(), version: rows[0].password_version, tag: fingerprint(rows[0].password_hash) };
        req.session.csrf = randomBytes(32).toString('hex');
        await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
        return res.json({ passwordUpgradeRequired: true, csrf: req.session.csrf });
    }
    startStudentSession(req, res, next, rows[0]);
});

app.post('/api/student/upgrade-password', loginLimit, async (req, res, next) => {
    const challenge = req.session.studentUpgrade;
    const restart = () => {
        delete req.session.studentUpgrade;
        return res.status(401).json({ error: '有効期限が切れました。もう一度ログインしてください。' });
    };
    if (!challenge || !Number.isFinite(challenge.at) || Date.now() - challenge.at > 300000 || challenge.at > Date.now()) return restart();
    const { password, password_confirmation: confirmation } = req.body || {};
    const [rows] = await db.execute('SELECT id, username, password_hash, password_version FROM students WHERE id = ? AND firebase_uid IS NULL', [challenge.id]);
    const student = rows[0];
    if (!student || student.password_version !== challenge.version || fingerprint(student.password_hash) !== challenge.tag) return restart();
    const problem = passwordProblem(password, student.username);
    if (problem) return res.status(400).json({ error: problem });
    if (password !== confirmation) return res.status(400).json({ error: '確認用パスワードが一致しません。' });
    // Compare the original hash and version so a concurrent reset cannot be overwritten.
    const [updated] = await db.execute('UPDATE students SET password_hash = ?, password_version = password_version + 1, reset_hash = NULL, reset_expires = NULL WHERE id = ? AND firebase_uid IS NULL AND password_version = ? AND password_hash = ?',
        [await hashPassword(password), student.id, student.password_version, student.password_hash]);
    if (updated.affectedRows !== 1) return restart();
    startStudentSession(req, res, next, { id: student.id, password_version: student.password_version + 1 });
});

app.post('/api/student/reset', resetLimit, async (req, res) => {
    const { username, password, code } = req.body || {};
    if (!studentCredentials(username, password) || passwordProblem(password) || typeof code !== 'string' || !/^[a-f0-9]{32}$/.test(code)) {
        return res.status(400).json({ error: 'ユーザー名・再設定コード・15〜64文字のパスワードを確認してください。' });
    }
    const digest = createHash('sha256').update(code).digest('hex');
    const [result] = await db.execute(
        'UPDATE students SET password_hash = ?, password_version = password_version + 1, reset_hash = NULL, reset_expires = NULL WHERE username = ? AND firebase_uid IS NULL AND reset_hash = ? AND reset_expires > UTC_TIMESTAMP()',
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
    if (req.session.staffId && !await hasStaffSession(req)) delete req.session.staffId;
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
    const security = await staffSecurity(rows[0].id);
    if (security.secret_cipher) {
        await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
        req.session.staffChallenge = { id: rows[0].id, at: Date.now(), passwordTag: fingerprint(security.password_hash), epoch: Number(security.epoch), strongPassword: !passwordProblem(password) };
        req.session.csrf = randomBytes(32).toString('hex');
        return res.json({ mfaRequired: true, csrf: req.session.csrf });
    }
    await startStaffSession(req, res, rows[0].id, false, !passwordProblem(password));
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

app.post('/api/student/logout-all', requireStudent, async (req, res) => {
    await db.execute('UPDATE students SET password_version = password_version + 1 WHERE id = ?', [req.session.studentId]);
    req.session.destroy(() => {});
    res.json({ message: 'すべての端末からログアウトしました。' });
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
    app.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => {
        console.log(`Student Voice: http://localhost:${process.env.PORT || 3000}`);
    });
}
