import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import * as OTPAuth from 'otpauth';
import { randomBytes } from 'node:crypto';

test('database-backed sessions, permissions, MFA replay/recovery and revocation', { skip: process.env.SECURITY_TEST_DB !== 'true' }, async () => {
    const name = process.env.DB_NAME;
    assert.match(name || '', /^sv_security_[a-z0-9_]+$/);
    process.env.SESSION_SECRET = 'isolated-integration-key-never-production'.repeat(2);
    const connection = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', multipleStatements: true });
    let server, pool;
    const runtimeUser = 'svt_' + randomBytes(5).toString('hex');
    const runtimePassword = randomBytes(32).toString('base64');
    try {
        await connection.query((await readFile(new URL('../database.sql', import.meta.url), 'utf8')).replaceAll('student_voice', name));
        await connection.query('USE ' + name);
        await connection.query('CREATE USER ?@? IDENTIFIED BY ?', [runtimeUser, '%', runtimePassword]);
        const permissions = (await readFile(new URL('../runtime-permissions.sql', import.meta.url), 'utf8'))
            .replace(/^--.*$/gm, '').replaceAll('`student_voice`', '`' + name + '`')
            .replaceAll("'sv_runtime'@'%'", "'" + runtimeUser + "'@'%'");
        await connection.query('CREATE TABLE media_files (name VARCHAR(50) PRIMARY KEY, data MEDIUMBLOB NOT NULL)');
        for (const sql of permissions.split(';').map(value => value.trim()).filter(Boolean)) await connection.query(sql);
        process.env.DB_USER = runtimeUser;
        process.env.DB_PASSWORD = runtimePassword;
        process.env.DB_AUTO_MIGRATE = 'false';
        const { hashPassword } = await import('../password.js');
        const password = 'private teacher testing passphrase';
        const [{ insertId: id }] = await connection.execute('INSERT INTO staff (username, password_hash) VALUES (?, ?)', ['testteacher', await hashPassword(password)]);
        const { app } = await import('../server.js');
        pool = (await import('../database.js')).db;
        const denied = error => ['ER_TABLEACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR'].includes(error.code);
        await assert.rejects(pool.query('CREATE TABLE should_not_create (id INT)'), denied);
        await assert.rejects(pool.query('ALTER TABLE staff ADD COLUMN should_not_alter INT'), denied);
        await assert.rejects(pool.query('DROP TABLE staff'), denied);
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.on('listening', resolve));
        const base = 'http://127.0.0.1:' + server.address().port + '/api';
        const client = () => {
            let cookie = '', csrf = '';
            return async (path, data, badCsrf = false) => {
                const response = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { Cookie: cookie, ...(data ? { 'Content-Type': 'application/json', 'X-CSRF-Token': badCsrf ? 'bad' : csrf } : {}) }, body: data ? JSON.stringify(data) : undefined });
                const cookies = response.headers.getSetCookie();
                if (cookies.length) cookie = cookies.map(item => item.split(';')[0]).join('; ');
                const body = await response.json();
                if (body.csrf) csrf = body.csrf;
                return { status: response.status, body, headers: response.headers };
            };
        };
        const a = client(), old = client(), fresh = client();
        const initial = await a('/session');
        assert.equal(initial.headers.get('x-content-type-options'), 'nosniff');
        assert.equal((await a('/staff/suggestions')).status, 401);
        assert.equal((await a('/staff/security-events')).status, 401);
        assert.equal((await a('/login', { username: 'testteacher', password }, true)).status, 403);
        await old('/session');
        assert.equal((await a('/login', { username: 'testteacher', password })).status, 200);
        assert.equal((await old('/login', { username: 'testteacher', password })).status, 200);
        assert.equal((await a('/staff/suggestions')).status, 200);
        const monitor = await a('/staff/security-events');
        assert.equal(monitor.status, 200);
        assert(monitor.body.events.length <= 50);
        assert(!JSON.stringify(monitor.body).includes(password));
        const setup = await a('/staff/mfa-setup', { password });
        assert.equal(setup.status, 200);
        const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.body.secret), algorithm: 'SHA1', digits: 6, period: 30 });
        const code = totp.generate();
        const enabled = await a('/staff/mfa-enable', { code });
        assert.equal(enabled.status, 200);
        assert.equal(enabled.body.recoveryCodes.length, 8);
        assert.equal((await old('/staff/suggestions')).status, 401);
        assert.equal((await a('/staff/security')).body.mfaEnabled, true);
        const [[stored]] = await connection.execute('SELECT secret_cipher, recovery_hashes FROM staff_security WHERE staff_id = ?', [id]);
        assert(!stored.secret_cipher.includes(setup.body.secret));
        assert(!stored.recovery_hashes.includes(enabled.body.recoveryCodes[0]));
        await fresh('/session');
        assert.equal((await fresh('/login', { username: 'testteacher', password })).body.mfaRequired, true);
        assert.equal((await fresh('/staff/suggestions')).status, 401);
        assert.equal((await fresh('/staff/mfa-login', { code })).status, 401, 'enrollment code cannot be replayed');
        const nextCode = totp.generate({ timestamp: Date.now() + 30000 });
        assert.equal((await fresh('/staff/mfa-login', { code: nextCode })).status, 200);
        assert.equal((await fresh('/staff/suggestions')).status, 200);
        // Separate the recovery scenario from the preceding IP attempt budget.
        await connection.query('DELETE FROM security_limits');
        const recovery = client();
        await recovery('/session');
        await recovery('/login', { username: 'testteacher', password });
        assert.equal((await recovery('/staff/mfa-login', { code: enabled.body.recoveryCodes[0] })).status, 200);
        const replay = client();
        await replay('/session');
        await replay('/login', { username: 'testteacher', password });
        assert.equal((await replay('/staff/mfa-login', { code: enabled.body.recoveryCodes[0] })).status, 401);
        assert.equal((await a('/staff/logout-all', {})).status, 200);
        assert.equal((await fresh('/staff/suggestions')).status, 401);
        await connection.query('DELETE FROM security_limits');
        const change = client();
        await change('/session');
        await change('/login', { username: 'testteacher', password });
        assert.equal((await change('/staff/mfa-login', { code: enabled.body.recoveryCodes[1] })).status, 200);
        assert.equal((await change('/staff/change-password', { currentPassword: password, password: 'short' })).status, 400);
        assert.equal((await change('/staff/change-password', { currentPassword: password, password: 'a new unique teacher testing passphrase' })).status, 200);
        assert.equal((await recovery('/staff/suggestions')).status, 401);
        await connection.execute('INSERT INTO students (username, password_hash) VALUES (?, ?)', ['studentfixture', await hashPassword('1234')]);
        const studentA = client(), studentB = client();
        for (const student of [studentA, studentB]) {
            await student('/session');
            assert.equal((await student('/student/login', { username: 'studentfixture', password: '1234' })).status, 200);
        }
        assert.equal((await studentA('/student/logout-all', {})).status, 200);
        assert.equal((await studentB('/profile')).status, 401);
        const { DatabaseRateStore, DatabaseSessionStore } = await import('../security.js');
        const limitA = new DatabaseRateStore('test'), limitB = new DatabaseRateStore('test');
        limitA.init({ windowMs: 60000 }); limitB.init({ windowMs: 60000 });
        assert.equal((await limitA.increment('shared-client')).totalHits, 1);
        assert.equal((await limitB.increment('shared-client')).totalHits, 2);
        const storeA = new DatabaseSessionStore(), storeB = new DatabaseSessionStore();
        await new Promise((resolve, reject) => storeA.set('fixture-session-id', { firebaseToken: 'not-plaintext', cookie: { expires: new Date(Date.now() + 60000) } }, error => error ? reject(error) : resolve()));
        const restored = await new Promise((resolve, reject) => storeB.get('fixture-session-id', (error, data) => error ? reject(error) : resolve(data)));
        assert.equal(restored.firebaseToken, 'not-plaintext');
        const [sessions] = await connection.query('SELECT id, data FROM app_sessions');
        assert(sessions.every(item => !item.data.includes('not-plaintext') && item.id.toString() !== 'fixture-session-id'));
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (pool) await pool.end();
        // Only the explicitly named disposable test database can be removed.
        await connection.query('DROP DATABASE ' + name);
        await connection.query('DROP USER IF EXISTS ?@?', [runtimeUser, '%']);
        await connection.end();
    }
});
