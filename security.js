import session from 'express-session';
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { db } from './database.js';
import { hashPassword, verifyPassword } from './password.js';
import { passwordProblem } from './email-auth.js';

const master = process.env.SESSION_SECRET || '';
const previous = process.env.SESSION_SECRET_PREVIOUS || '';
const mac = (key, value) => createHmac('sha256', key).update(String(value)).digest('hex');
const keys = [master, previous].filter(Boolean).map(secret => {
    const derive = label => Buffer.from(hkdfSync('sha256', secret, 'student-voice/v2', label, 32));
    return {
        secret, id: mac(secret, 'student-voice/key-id/v2').slice(0, 16),
        legacy: createHmac('sha256', secret).update('student-voice/encryption/v1').digest(),
        sessionId: derive('session-id'), sessionData: derive('session-data'),
        mfa: derive('mfa-secret'), recovery: derive('mfa-recovery'),
    };
});
const current = keys[0];
export const fingerprint = value => mac(master, value);
export const matchesFingerprint = (value, tag) => keys.some(key => mac(key.secret, value) === tag);

function cipherKey(key, purpose) {
    return purpose.startsWith('mfa:') ? key.mfa : key.sessionData;
}

// Purpose-specific keys and the record identifier prevent encrypted data swapping.
export function seal(value, purpose) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', cipherKey(current, purpose), iv);
    cipher.setAAD(Buffer.from(purpose));
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return 'v2:' + current.id + ':' + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
function openSeal(value, purpose) {
    const v2 = /^v2:([a-f0-9]{16}):([A-Za-z0-9+/=]+)$/.exec(value);
    const data = Buffer.from(v2?.[2] ?? value, 'base64');
    for (const key of keys) {
        if (v2 && v2[1] !== key.id) continue;
        try {
            const cipher = createDecipheriv('aes-256-gcm', v2 ? cipherKey(key, purpose) : key.legacy, data.subarray(0, 12), { authTagLength: 16 });
            cipher.setAAD(Buffer.from(purpose));
            cipher.setAuthTag(data.subarray(12, 28));
            const plain = JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString());
            return { plain, key, needsUpgrade: !v2 || key !== current };
        } catch {
            // Old unversioned records can only be identified by successful authentication.
        }
    }
    throw new Error('Encrypted record could not be opened.');
}
export function unseal(value, purpose) { return openSeal(value, purpose).plain; }

function openMfa(value, staffId) {
    const opened = openSeal(value, 'mfa:' + staffId);
    // Existing recovery codes cannot be rehashed without their original values.
    // Refer to the old key by ID. Never put a master secret inside a database row.
    const payload = typeof opened.plain === 'string'
        ? { secret: opened.plain, legacyRecoveryKeyId: opened.key.id }
        : opened.plain;
    return { ...opened, payload };
}

function sessionIds(sid) {
    const login = 'session:' + sid;
    return keys.flatMap(key => [mac(key.sessionId, login), mac(key.secret, login)]);
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
        const ids = sessionIds(sid);
        const placeholders = ids.map(() => '?').join(',');
        db.execute('SELECT id, data FROM app_sessions WHERE id IN (' + placeholders + ') AND expires_at > ?', [...ids, Date.now()])
            .then(([rows]) => {
                const row = rows[0];
                const id = row?.id.toString();
                callback(null, row ? { ...unseal(row.data, id), persistedSession: id } : null);
            }).catch(callback);
    }
    set(sid, value, callback = () => {}) {
        const id = value.persistedSession || sessionIds(sid)[0];
        const expiry = new Date(value.cookie.expires || Date.now() + 3600000).getTime();
        const { persistedSession, ...data } = value;
        // An in-flight request may still hold a session after logout deletes it.
        // Existing sessions may only update a row, never recreate a deleted one.
        const write = persistedSession
            ? db.execute('UPDATE app_sessions SET data = ?, expires_at = ? WHERE id = ? AND expires_at > ?', [seal(data, id), expiry, id, Date.now()])
            : db.execute('INSERT INTO app_sessions (id, data, expires_at) VALUES (?, ?, ?)', [id, seal(data, id), expiry]);
        write.then(() => { value.persistedSession = id; callback(); }).catch(callback);
    }
    destroy(sid, callback = () => {}) {
        const ids = sessionIds(sid);
        db.execute('DELETE FROM app_sessions WHERE id IN (' + ids.map(() => '?').join(',') + ')', ids).then(() => callback()).catch(callback);
    }
    touch(sid, value, callback = () => {}) {
        const expiry = new Date(value.cookie.expires || Date.now() + 3600000).getTime();
        // Touch extends an expiry without overwriting newer session data.
        db.execute('UPDATE app_sessions SET expires_at = GREATEST(expires_at, ?) WHERE id = ? AND expires_at > ?', [expiry, value.persistedSession || sessionIds(sid)[0], Date.now()])
            .then(() => callback()).catch(callback);
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
            const event = (req.moderationEvent || req.route?.path || '/api/unknown').replace(/[^a-zA-Z0-9/_:-]/g, '').slice(0, 64);
            audit(req, req.method + ':' + event.slice(0, 58), res.statusCode).catch(() => console.error('Audit persistence failed'));
        }
    });
    next();
}

export async function staffSecurity(identity, { byUsername = false, connection = db } = {}) {
    const column = byUsername ? 's.username' : 's.id';
    const [[row]] = await connection.execute('SELECT s.id, s.password_hash, ss.secret_cipher, ss.last_step, ss.recovery_hashes, COALESCE(ss.epoch, 1) AS epoch FROM staff s LEFT JOIN staff_security ss ON ss.staff_id = s.id WHERE ' + column + ' = ?', [identity]);
    return row;
}
// Reuse the complete session check wherever private teacher content is served.
export async function hasStaffSession(req) {
    if (!req.session?.staffId || !Number.isSafeInteger(req.session.staffAuthenticatedAt)
        || Date.now() - req.session.staffAuthenticatedAt > 3600000) return false;
    const row = await staffSecurity(req.session.staffId);
    return Boolean(row && matchesFingerprint(row.password_hash, req.session.staffPasswordTag)
        && Number(row.epoch) === req.session.staffEpoch && (!row.secret_cipher || req.session.staffMfa));
}
export async function requireStaff(req, res, next) {
    if (!await hasStaffSession(req)) return res.status(401).json({ error: '管理者アカウントでログインしてください。' });
    next();
}
export async function startStaffSession(req, res, row, mfa = false, strongPassword = false) {
    // Bind this session to the credential and epoch checked during login.
    // Re-reading here could stamp a concurrent password reset into an old login.
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.staffId = row.id;
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
    app.post('/api/staff/mfa-login', authLimit, (req, res, next) => {
        const challenge = req.session.staffChallenge;
        if (!challenge || !Number.isFinite(challenge.at) || Date.now() - challenge.at > 300000) return res.status(401).json({ error: 'ログインからやり直してください。' });
        next();
    }, mfaLimit, async (req, res) => {
        const challenge = req.session.staffChallenge;
        const code = req.body?.code;
        const connection = await db.getConnection();
        let acceptedAccount;
        try {
            await connection.beginTransaction();
            const [[row]] = await connection.execute('SELECT * FROM staff_security WHERE staff_id = ? FOR UPDATE', [challenge.id]);
            const account = await staffSecurity(challenge.id, { connection });
            if (row?.secret_cipher && account && matchesFingerprint(account.password_hash, challenge.passwordTag) && challenge.epoch === Number(account.epoch)) {
                const mfa = openMfa(row.secret_cipher, challenge.id);
                const step = otpStep(mfa.payload.secret, code);
                if (step !== null && step > Number(row.last_step)) {
                    await connection.execute('UPDATE staff_security SET last_step = ? WHERE staff_id = ?', [step, challenge.id]);
                    acceptedAccount = account;
                } else if (typeof code === 'string' && /^[a-f0-9]{16}$/.test(code)) {
                    const hashes = JSON.parse(row.recovery_hashes || '[]');
                    const recoveryKey = mfa.payload.recoveryKey
                        ? Buffer.from(mfa.payload.recoveryKey, 'base64')
                        : keys.find(key => key.id === mfa.payload.legacyRecoveryKeyId)?.secret;
                    const digest = recoveryKey && mac(recoveryKey, 'recovery:' + challenge.id + ':' + code);
                    const found = digest ? hashes.findIndex(hash => typeof hash === 'string' && hash.length === digest.length
                        && timingSafeEqual(Buffer.from(hash), Buffer.from(digest))) : -1;
                    if (found >= 0) {
                        hashes.splice(found, 1);
                        await connection.execute('UPDATE staff_security SET recovery_hashes = ? WHERE staff_id = ?', [JSON.stringify(hashes), challenge.id]);
                        acceptedAccount = account;
                    }
                }
                if (acceptedAccount && mfa.needsUpgrade) {
                    await connection.execute('UPDATE staff_security SET secret_cipher = ? WHERE staff_id = ?', [seal(mfa.payload, 'mfa:' + challenge.id), challenge.id]);
                }
            }
            await connection.commit();
        } catch (error) { await connection.rollback(); throw error; }
        finally { connection.release(); }
        if (!acceptedAccount) return res.status(401).json({ error: '認証コードが無効か、使用済みです。' });
        await startStaffSession(req, res, acceptedAccount, true, challenge.strongPassword);
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
            [seal({ secret: setup.secret, recoveryKey: current.recovery.toString('base64') }, 'mfa:' + id), step,
                JSON.stringify(codes.map(code => mac(current.recovery, 'recovery:' + id + ':' + code))), id]);
        if (!changed.affectedRows) return res.status(409).json({ error: '設定済みです。もう一度ログインしてください。' });
        delete req.session.mfaSetup;
        req.session.staffEpoch += 1;
        req.session.staffMfa = true;
        res.json({ recoveryCodes: codes, message: '二段階認証を有効にしました。回復コードは一度だけ表示されます。安全な場所に保存してください。' });
    });
    app.post('/api/staff/mfa-recovery-codes', requireStaff, authLimit, async (req, res) => {
        const id = req.session.staffId;
        const row = await staffSecurity(id);
        const password = req.body?.password;
        if (typeof password !== 'string' || password.length > 128 || !await verifyPassword(password, row.password_hash)) {
            return res.status(400).json({ error: '現在のパスワードを確認してください。' });
        }
        if (!row?.secret_cipher) return res.status(409).json({ error: '二段階認証を有効にしてください。' });
        const { payload } = openMfa(row.secret_cipher, id);
        const step = otpStep(payload.secret, req.body?.code);
        if (step === null || step <= Number(row.last_step)) return res.status(400).json({ error: '次の認証コードが表示されてから、もう一度お試しください。' });
        const recoveryCodes = Array.from({ length: 8 }, () => randomBytes(8).toString('hex'));
        const hashes = recoveryCodes.map(code => mac(current.recovery, 'recovery:' + id + ':' + code));
        const [changed] = await db.execute('UPDATE staff_security SET recovery_hashes = ?, secret_cipher = ?, last_step = ?, epoch = epoch + 1 WHERE staff_id = ? AND epoch = ? AND last_step < ? AND EXISTS (SELECT 1 FROM staff WHERE id = ? AND password_hash = ?)',
            [JSON.stringify(hashes), seal({ secret: payload.secret, recoveryKey: current.recovery.toString('base64') }, 'mfa:' + id),
                step, id, row.epoch, step, id, row.password_hash]);
        if (!changed.affectedRows) return res.status(409).json({ error: '状態が変わりました。もう一度お試しください。' });
        req.session.staffEpoch = Number(row.epoch) + 1;
        res.json({ recoveryCodes, message: '新しい回復コードを安全な場所に保存してください。' });
    });
    app.post('/api/staff/change-password', requireStaff, authLimit, async (req, res) => {
        const row = await staffSecurity(req.session.staffId);
        if (!await verifyPassword(String(req.body?.currentPassword || ''), row.password_hash)) return res.status(401).json({ error: '現在のパスワードを確認してください。' });
        const problem = passwordProblem(req.body?.password);
        if (problem) return res.status(400).json({ error: problem });
        const [changed] = await db.execute('UPDATE staff SET password_hash = ? WHERE id = ? AND password_hash = ?', [await hashPassword(req.body.password), req.session.staffId, row.password_hash]);
        if (!changed.affectedRows) return res.status(409).json({ error: '状態が変わりました。もう一度ログインしてください。' });
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
