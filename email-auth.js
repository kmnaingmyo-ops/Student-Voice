import { randomBytes } from 'node:crypto';
import { db } from './database.js';
import { hashPassword } from './password.js';

export function normalizeEmail(value) {
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    const parts = email.split('@');
    if (!/^[\x21-\x7e]+$/.test(email) || email.length > 254 || parts.length !== 2 || parts[0].length > 64
        || !/^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(email)
        || /(^|\.)(invalid|test|localhost)$/.test(parts[1])
        || /(^|\.)example\.(com|net|org)$/.test(parts[1])) return null;
    return email;
}

export function passwordProblem(password, email = '') {
    if (typeof password !== 'string' || [...password].length < 15 || [...password].length > 64) {
        return 'パスワードは15〜64文字で設定してください。';
    }
    const plain = password.normalize('NFKC').toLowerCase();
    const common = /^(password|letmein|welcome|qwerty|administrator|iloveyou|changeme|correcthorsebatterystaple)[\d\W_]*$/u;
    const local = email.split('@')[0];
    const core = value => value.replace(/[0-9\s\p{P}\p{S}]/gu, '');
    const sequential = ['0123456789','9876543210','abcdefghijklmnopqrstuvwxyz','zyxwvutsrqponmlkjihgfedcba'].some(sequence => sequence.repeat(8).includes(plain));
    if (common.test(plain) || /^(.{1,4})\1+$/u.test(plain) || sequential
        || (local && core(local).length >= 4 && core(plain) === core(local))) {
        return '推測されやすいパスワードです。長いフレーズなど、別のものを選んでください。';
    }
    return null;
}

export async function firebaseRequest(action, body) {
    const key = process.env.FIREBASE_WEB_API_KEY;
    if (!key) {
        const error = new Error('メール認証の準備中です。しばらくしてからお試しください。');
        error.status = 503;
        throw error;
    }
    const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:' + action + '?key=' + encodeURIComponent(key), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Firebase-Locale': 'ja' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok) {
        const error = new Error('メールアドレスまたはパスワードを確認してください。');
        error.code = data.error?.message?.split(' : ')[0] || 'AUTH_FAILED';
        error.status = 401;
        if (error.code.startsWith('WEAK_PASSWORD') || error.code === 'PASSWORD_DOES_NOT_MEET_REQUIREMENTS') {
            error.message = 'パスワードが安全基準を満たしていません。長いフレーズなどを選んでください。';
            error.status = 400;
        }
        if (['TOO_MANY_ATTEMPTS_TRY_LATER','QUOTA_EXCEEDED'].includes(error.code)) {
            error.message = '送信回数の上限です。少し待ってからお試しください。';
            error.status = 429;
        }
        throw error;
    }
    return data;
}

export async function verifiedFirebaseUser(idToken) {
    const data = await firebaseRequest('lookup', { idToken });
    const user = data.users?.[0];
    if (!user || user.disabled || !user.emailVerified) return null;
    // Firebase validates the token; compare its issue time with the account's reset time.
    const issued = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()).iat;
    if (!Number.isSafeInteger(issued) || issued < 1 || Number(user.validSince || 0) > issued) return null;
    return user;
}

export function registerEmailAuth(app, limit, startSession) {
    const genericEmail = 'メールを確認してください。届かない場合は迷惑メールフォルダも確認してください。';
    const handle = action => async (req, res, next) => {
        try { await action(req, res, next); } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message });
            next(error);
        }
    };

    app.post('/api/signup', limit, handle(async (req, res) => {
        const email = normalizeEmail(req.body?.email);
        const password = req.body?.password;
        const problem = passwordProblem(password, email || '');
        if (!email || problem) return res.status(400).json({ error: !email ? '有効なメールアドレスを入力してください。' : problem });
        let account;
        try { account = await firebaseRequest('signUp', { email, password, returnSecureToken: true }); }
        catch (error) {
            if (error.code !== 'EMAIL_EXISTS') throw error;
            return res.json({ needsVerification: true, message: '登録済みの場合はログインしてください。未確認の場合は確認メールを再送できます。' });
        }
        await firebaseRequest('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: account.idToken });
        // Never create an authenticated session before inbox ownership is verified.
        res.json({ needsVerification: true, message: genericEmail + ' リンクを開いた後、ログインしてください。' });
    }));

    app.post('/api/student/email-login', limit, handle(async (req, res, next) => {
        const email = normalizeEmail(req.body?.email);
        const password = req.body?.password;
        if (!email || typeof password !== 'string' || !password || password.length > 128) return res.status(400).json({ error: '入力内容を確認してください。' });
        const account = await firebaseRequest('signInWithPassword', { email, password, returnSecureToken: true });
        const verified = await verifiedFirebaseUser(account.idToken);
        if (!verified) return res.status(403).json({ error: '確認メールのリンクを開いてから、もう一度ログインしてください。' });
        let [rows] = await db.execute('SELECT id, password_version FROM students WHERE firebase_uid = ?', [verified.localId]);
        if (!rows.length) {
            try {
                const [created] = await db.execute('INSERT INTO students (username, password_hash, email, firebase_uid, email_verified) VALUES (?, ?, ?, ?, 1)',
                    ['student_' + randomBytes(8).toString('hex'), await hashPassword(randomBytes(32).toString('hex')), normalizeEmail(verified.email), verified.localId]);
                rows = [{ id: created.insertId, password_version: 1 }];
            } catch (error) {
                if (error.code !== 'ER_DUP_ENTRY') throw error;
                [rows] = await db.execute('SELECT id, password_version FROM students WHERE firebase_uid = ?', [verified.localId]);
                if (!rows.length) return res.status(409).json({ error: 'このメールアドレスではログインできません。管理者に相談してください。' });
            }
        }
        startSession(req, res, next, { ...rows[0], firebaseToken: account.idToken, firebaseUid: verified.localId });
    }));

    app.post('/api/student/resend-verification', limit, handle(async (req, res) => {
        const email = normalizeEmail(req.body?.email);
        const password = req.body?.password;
        if (!email || typeof password !== 'string' || !password || password.length > 128) return res.status(400).json({ error: 'メールアドレスとパスワードを入力してください。' });
        try {
            const account = await firebaseRequest('signInWithPassword', { email, password, returnSecureToken: true });
            const lookup = await firebaseRequest('lookup', { idToken: account.idToken });
            if (!lookup.users?.[0]?.emailVerified) await firebaseRequest('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: account.idToken });
        } catch (error) { if (!['INVALID_LOGIN_CREDENTIALS','EMAIL_NOT_FOUND','INVALID_PASSWORD'].includes(error.code)) throw error; }
        res.json({ message: genericEmail });
    }));

    app.post('/api/student/request-password-reset', limit, handle(async (req, res) => {
        const email = normalizeEmail(req.body?.email);
        if (!email) return res.status(400).json({ error: '有効なメールアドレスを入力してください。' });
        try { await firebaseRequest('sendOobCode', { requestType: 'PASSWORD_RESET', email }); }
        catch (error) { if (error.code !== 'EMAIL_NOT_FOUND') throw error; }
        res.json({ message: '登録済みの場合、再設定メールを送信しました。受信トレイと迷惑メールフォルダを確認してください。' });
    }));
}
