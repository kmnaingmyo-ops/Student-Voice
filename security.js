import session from 'express-session';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { db } from './database.js';
import { hashPassword, verifyPassword } from './password.js';
import { passwordProblem } from './email-auth.js';

const master = process.env.SESSION_SECRET || '';
const key = createHmac('sha256', master).update('student-voice/encryption/v1').digest();
export const fingerprint = value => createHmac('sha256', master).update(String(value)).digest('hex');

// Authenticated encryption protects tokens and authenticator keys in database backups.
export function seal(value, purpose) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(purpose));
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
export function unseal(value, purpose) {
    const data = Buffer.from(value, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12), { authTagLength: 16 });
    cipher.setAAD(Buffer.from(purpose));
    cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString());
}

export async function initSecurity() {
    if (process.env.DB_AUTO_MIGRATE !== 'false') {
        await db.query('CREATE TABLE IF NOT EXISTS app_sessions (id VARBINARY(64) PRIMARY KEY, data MEDIUMTEXT NOT NULL, expires_at BIGINT NOT NULL, INDEX (expires_at))');
        await db.query('CREATE TABLE IF NOT EXISTS security_limits (id VARBINARY(64) PRIMARY KEY, hits INT UNSIGNED NOT NULL, reset_at BIGINT NOT NULL, INDEX (reset_at))');
        await db.query('CREATE TABLE IF NOT EXISTS staff_security (staff_id INT UNSIGNED PRIMARY KEY, secret_cipher TEXT NULL, last_step BIGINT NOT NULL DEFAULT -1, recovery_hashes TEXT NULL, epoch INT UNSIGNED NOT NULL DEFAULT 1)');
        await db.query('CREATE TABLE IF NOT EXISTS security_events (id CHAR(36) PRIMARY KEY, occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, event VARCHAR(64) NOT NULL, actor VARCHAR(64) NOT NULL, request_id CHAR(36) NOT NULL, status SMALLINT NOT NULL, INDEX (occurred_at))');
    }
    // Bounded retention; repeat without relying on a single instance's timers.
    await cleanupSecurity();
}
async function cleanupSecurity() {
    await db.execute('DELETE FROM app_sessions WHERE expires_at < ?', [Date.now()]);
    await db.execute('DELETE FROM security_limits WHERE reset_at < ?', [Date.now()]);
    await db.query('DELETE FROM security_events WHERE occurred_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)');
}
const cleanupTimer = setInterval(() => cleanupSecurity().catch(() => console.error('Security cleanup failed')), 3600000);
cleanupTimer.unref();

export class DatabaseSessionStore extends session.Store {
    get(sid, callback) {
        const id = fingerprint('session:' + sid);
        db.execute('SELECT data FROM app_sessions WHERE id = ? AND expires_at > ?', [id, Date.now()])
            .then(([rows]) => callback(null, rows.length ? unseal(rows[0].data, id) : null)).catch(callback);
    }
    set(sid, value, callback = () => {}) {
        const id = fingerprint('session:' + sid);
        const expiry = new Date(value.cookie.expires || Date.now() + 3600000).getTime();
        db.execute('INSERT INTO app_sessions (id, data, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), expires_at = VALUES(expires_at)',
            [id, seal(value, id), expiry]).then(() => callback()).catch(callback);
    }
    destroy(sid, callback = () => {}) {
        db.execute('DELETE FROM app_sessions WHERE id = ?', [fingerprint('session:' + sid)]).then(() => callback()).catch(callback);
    }
    touch(sid, value, callback = () => {}) {
        this.set(sid, value, callback);
    }
}

// Shared fixed-window counters work across processes and survive server restarts.
export class DatabaseRateStore {
    constructor(prefix) { this.prefix = prefix; this.localKeys = false; }
    init(options) { this.windowMs = options.windowMs; }
    async increment(value) {
        const now = Date.now();
        const id = fingerprint(this.prefix + ':' + value);
        await db.execute('INSERT INTO security_limits (id, hits, reset_at) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE hits = IF(reset_at <= ?, 1, hits + 1), reset_at = IF(reset_at <= ?, VALUES(reset_at), reset_at)', [id, now + this.windowMs, now, now]);
        const [[row]] = await db.execute('SELECT hits, reset_at FROM security_limits WHERE id = ?', [id]);
        return { totalHits: Number(row.hits), resetTime: new Date(Number(row.reset_at)) };
    }
    async decrement(value) {
        await db.execute('UPDATE security_limits SET hits = GREATEST(0, hits - 1) WHERE id = ?', [fingerprint(this.prefix + ':' + value)]);
    }
    async resetKey(value) {
        await db.execute('DELETE FROM security_limits WHERE id = ?', [fingerprint(this.prefix + ':' + value)]);
    }
}

export async function audit(req, event, status = 200) {
    const actor = req.session?.staffId ? 'staff:' + req.session.staffId : req.session?.studentId ? 'student:' + req.session.studentId : req.auditActor || 'guest';
    const record = { id: randomUUID(), event, actor, requestId: req.requestId || randomUUID(), status };
    console.info(JSON.stringify({ type: 'security', ...record }));
    await db.execute('INSERT INTO security_events (id, event, actor, request_id, status) VALUES (?, ?, ?, ?, ?)', [record.id, event, actor, record.requestId, status]);
}
export function securityLogging(req, res, next) {
    req.requestId = randomUUID();
    req.auditActor = req.session?.staffId ? 'staff:' + req.session.staffId : req.session?.studentId ? 'student:' + req.session.studentId : 'guest';
    res.setHeader('X-Request-ID', req.requestId);
    res.once('finish', () => {
        // Never log request bodies, email addresses, cookies, tokens, or URL queries.
        if (req.path.startsWith('/api') && (req.method !== 'GET' || res.statusCode >= 400)) {
            const event = (req.route?.path || '/api/unknown').replace(/[^a-zA-Z0-9/_:-]/g, '').slice(0, 64);
            audit(req, req.method + ':' + event.slice(0, 58), res.statusCode).catch(() => console.error('Audit persistence failed'));
        }
    });
    next();
}

export async function staffSecurity(id) {
    const [[row]] = await db.execute('SELECT s.password_hash, ss.secret_cipher, ss.last_step, ss.recovery_hashes, COALESCE(ss.epoch, 1) AS epoch FROM staff s LEFT JOIN staff_security ss ON ss.staff_id = s.id WHERE s.id = ?', [id]);
    return row;
}
export async function requireStaff(req, res, next) {
    if (!req.session.staffId || !req.session.staffAuthenticatedAt || Date.now() - req.session.staffAuthenticatedAt > 3600000) {
        return res.status(401).json({ error: '管理者ログインが必要です。' });
    }
    const row = await staffSecurity(req.session.staffId);
    if (!row || fingerprint(row.password_hash) !== req.session.staffPasswordTag || Number(row.epoch) !== req.session.staffEpoch
        || (row.secret_cipher && !req.session.staffMfa)) {
        return res.status(401).json({ error: 'もう一度ログインしてください。' });
    }
    next();
}
export async function startStaffSession(req, res, id, mfa = false, strongPassword = false) {
    const row = await staffSecurity(id);
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.staffId = id;
    req.session.staffEpoch = Number(row.epoch);
    req.session.staffPasswordTag = fingerprint(row.password_hash);
    req.session.staffAuthenticatedAt = Date.now();
    req.session.staffMfa = mfa;
    req.session.staffStrongPassword = strongPassword;
    req.session.csrf = randomBytes(32).toString('hex');
    await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    res.json({ csrf: req.session.csrf });
}
export function otpStep(secret, token, timestamp = Date.now()) {
    if (typeof token !== 'string' || !/^\d{6}$/.test(token)) return null;
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 });
    const delta = totp.validate({ token, timestamp, window: 1 });
    return delta === null ? null : Math.floor(timestamp / 30000) + delta;
}

export function registerSecurityRoutes(app, authLimit, mfaLimit) {
    app.get('/api/staff/security-events', requireStaff, async (req, res) => {
        const [[summary]] = await db.query('SELECT COUNT(*) AS total, COALESCE(SUM(status IN (401, 403)), 0) AS denied, COALESCE(SUM(status = 429), 0) AS limited, COALESCE(SUM(status >= 500), 0) AS errors FROM security_events WHERE occurred_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)');
        const [events] = await db.query('SELECT occurred_at, event, actor, request_id, status FROM security_events ORDER BY occurred_at DESC, id DESC LIMIT 50');
        res.json({ summary, events, retentionDays: 30 });
    });
    app.post('/api/staff/mfa-login', authLimit, mfaLimit, async (req, res) => {
        const challenge = req.session.staffChallenge;
        const code = req.body?.code;
        if (!challenge || Date.now() - challenge.at > 300000) return res.status(401).json({ error: 'ログインからやり直してください。' });
        const connection = await db.getConnection();
        let accepted = false;
        try {
            await connection.beginTransaction();
            const [[row]] = await connection.execute('SELECT * FROM staff_security WHERE staff_id = ? FOR UPDATE', [challenge.id]);
            const account = await staffSecurity(challenge.id);
            if (row?.secret_cipher && account && challenge.passwordTag === fingerprint(account.password_hash) && challenge.epoch === Number(account.epoch)) {
                const step = otpStep(unseal(row.secret_cipher, 'mfa:' + challenge.id), code);
                if (step !== null && step > Number(row.last_step)) {
                    await connection.execute('UPDATE staff_security SET last_step = ? WHERE staff_id = ?', [step, challenge.id]);
                    accepted = true;
                } else if (typeof code === 'string' && /^[a-f0-9]{16}$/.test(code)) {
                    const hashes = JSON.parse(row.recovery_hashes || '[]');
                    const digest = fingerprint('recovery:' + challenge.id + ':' + code);
                    const found = hashes.findIndex(hash => timingSafeEqual(Buffer.from(hash), Buffer.from(digest)));
                    if (found >= 0) {
                        hashes.splice(found, 1);
                        await connection.execute('UPDATE staff_security SET recovery_hashes = ? WHERE staff_id = ?', [JSON.stringify(hashes), challenge.id]);
                        accepted = true;
                    }
                }
            }
            await connection.commit();
        } catch (error) { await connection.rollback(); throw error; }
        finally { connection.release(); }
        if (!accepted) return res.status(401).json({ error: '認証コードが無効か、使用済みです。' });
        await startStaffSession(req, res, challenge.id, true, challenge.strongPassword);
    });
    app.get('/api/staff/security', requireStaff, async (req, res) => {
        const row = await staffSecurity(req.session.staffId);
        res.json({ mfaEnabled: Boolean(row.secret_cipher), passwordUpgradeNeeded: !req.session.staffStrongPassword });
    });
    app.post('/api/staff/mfa-setup', requireStaff, authLimit, async (req, res) => {
        const row = await staffSecurity(req.session.staffId);
        if (!await verifyPassword(String(req.body?.password || ''), row.password_hash)) return res.status(401).json({ error: 'パスワードを確認してください。' });
        if (row.secret_cipher) return res.status(409).json({ error: '二段階認証は設定済みです。' });
        const secret = new OTPAuth.Secret({ size: 20 }).base32;
        req.session.mfaSetup = { secret, at: Date.now() };
        res.json({ secret, message: '認証アプリで「設定キーを入力」を選び、このキーを登録してください。' });
    });
    app.post('/api/staff/mfa-enable', requireStaff, authLimit, async (req, res) => {
        const setup = req.session.mfaSetup;
        if (!setup || Date.now() - setup.at > 300000) return res.status(400).json({ error: '設定をやり直してください。' });
        const step = otpStep(setup.secret, req.body?.code);
        if (step === null) return res.status(400).json({ error: '認証アプリの6桁のコードを確認してください。' });
        const id = req.session.staffId;
        const codes = Array.from({ length: 8 }, () => randomBytes(8).toString('hex'));
        await db.execute('INSERT IGNORE INTO staff_security (staff_id) VALUES (?)', [id]);
        const [changed] = await db.execute('UPDATE staff_security SET secret_cipher = ?, last_step = ?, recovery_hashes = ?, epoch = epoch + 1 WHERE staff_id = ? AND secret_cipher IS NULL',
            [seal(setup.secret, 'mfa:' + id), step, JSON.stringify(codes.map(code => fingerprint('recovery:' + id + ':' + code))), id]);
        if (!changed.affectedRows) return res.status(409).json({ error: '設定済みです。もう一度ログインしてください。' });
        delete req.session.mfaSetup;
        req.session.staffEpoch += 1;
        req.session.staffMfa = true;
        res.json({ recoveryCodes: codes, message: '二段階認証を有効にしました。回復コードは一度だけ表示されます。安全な場所に保存してください。' });
    });
    app.post('/api/staff/change-password', requireStaff, authLimit, async (req, res) => {
        const row = await staffSecurity(req.session.staffId);
        if (!await verifyPassword(String(req.body?.currentPassword || ''), row.password_hash)) return res.status(401).json({ error: '現在のパスワードを確認してください。' });
        const problem = passwordProblem(req.body?.password);
        if (problem) return res.status(400).json({ error: problem });
        await db.execute('UPDATE staff SET password_hash = ? WHERE id = ?', [await hashPassword(req.body.password), req.session.staffId]);
        req.session.destroy(() => {});
        res.json({ message: 'パスワードを更新しました。すべての端末でログインし直してください。' });
    });
    app.post('/api/staff/logout-all', requireStaff, async (req, res) => {
        await db.execute('INSERT IGNORE INTO staff_security (staff_id) VALUES (?)', [req.session.staffId]);
        await db.execute('UPDATE staff_security SET epoch = epoch + 1 WHERE staff_id = ?', [req.session.staffId]);
        req.session.destroy(() => {});
        res.json({ message: 'すべての端末からログアウトしました。' });
    });
}
