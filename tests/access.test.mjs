import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import * as OTPAuth from 'otpauth';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

test('database-backed sessions, permissions, MFA replay/recovery and revocation', { skip: process.env.SECURITY_TEST_DB !== 'true' }, async () => {
    const name = process.env.DB_NAME;
    assert.match(name || '', /^sv_security_[a-z0-9_]+$/);
    process.env.SESSION_SECRET = 'isolated-integration-key-never-production'.repeat(2);
    process.env.MEDIA_STORAGE = 'database';
    process.env.MEDIA_QUOTA_BYTES = '1024';
    process.env.COMMENTS_PER_ACCOUNT_HOUR = '3';
    const connection = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', multipleStatements: true });
    let server, pool, stopContainer;
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
        pool = (await import('../database.js')).db;
        const { startStaffSession, staffSecurity, hasStaffSession } = await import('../security.js');
        const checkedStaff = await staffSecurity(id);
        await connection.execute('UPDATE staff SET password_hash = ? WHERE id = ?', [await hashPassword('other teacher credential'), id]);
        const issued = { session: { regenerate: done => done(), save: done => done() } };
        await startStaffSession(issued, { json() {} }, checkedStaff);
        assert.equal(await hasStaffSession(issued), false, 'old verification must not pick up new credentials');
        await connection.execute('UPDATE staff SET password_hash = ? WHERE id = ?', [checkedStaff.password_hash, id]);

        const denied = error => ['ER_TABLEACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR'].includes(error.code);
        await assert.rejects(pool.query('CREATE TABLE should_not_create (id INT)'), denied);
        await assert.rejects(pool.query('ALTER TABLE staff ADD COLUMN should_not_alter INT'), denied);
        await assert.rejects(pool.query('DROP TABLE staff'), denied);
        let base;
        if (process.env.SECURITY_TEST_CONTAINER === 'true') {
            const { startRestrictedContainer } = await import('./container-runner.mjs');
            const container = await startRestrictedContainer();
            base = container.base;
            stopContainer = container.stop;
        } else {
            const { app } = await import('../server.js');
            server = app.listen(0, '127.0.0.1');
            await new Promise(resolve => server.on('listening', resolve));
            base = 'http://127.0.0.1:' + server.address().port + '/api';
        }
        const client = () => {
            let cookie = '', csrf = '';
            return async (path, data, badCsrf = false) => {
                const form = data instanceof FormData;
                const response = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { Cookie: cookie, 'X-Forwarded-Proto': 'https', ...(data ? { ...(!form ? { 'Content-Type': 'application/json' } : {}), 'X-CSRF-Token': badCsrf ? 'bad' : csrf } : {}) }, body: data ? form ? data : JSON.stringify(data) : undefined });
                const cookies = response.headers.getSetCookie();
                if (cookies.length) cookie = cookies.map(item => item.split(';')[0]).join('; ');
                const body = response.headers.get('content-type')?.includes('application/json')
                    ? await response.json() : Buffer.from(await response.arrayBuffer());
                if (body.csrf) csrf = body.csrf;
                return { status: response.status, body, headers: response.headers };
            };
        };
        const a = client(), old = client(), fresh = client();
        const initial = await a('/session');
        assert.equal(initial.headers.get('x-content-type-options'), 'nosniff');
        if (stopContainer) {
            assert.match(initial.headers.get('strict-transport-security'), /max-age=31536000/);
            assert(initial.headers.getSetCookie().some(value => /;\s*Secure(?:;|$)/i.test(value)));
        }
        assert.equal((await a('/staff/suggestions')).status, 401);
        assert.equal((await a('/staff/security-events')).status, 401);
        assert.equal((await a('/login', { username: 'testteacher', password }, true)).status, 403);
        assert.equal((await a('/staff/mfa-login', { code: '123456' })).status, 401);
        await old('/session');
        assert.equal((await a('/login', { username: 'testteacher', password })).status, 200);
        assert.equal((await old('/login', { username: 'testteacher', password })).status, 200);
        assert.equal((await a('/staff/suggestions')).status, 200);
        const imageName = randomBytes(16).toString('hex') + '.webp';
        const imageBytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).webp().toBuffer();
        await connection.execute('INSERT INTO media_files (name, data) VALUES (?, ?)', [imageName, imageBytes]);
        const [{ insertId: privatePost }] = await connection.execute('INSERT INTO suggestions (title, category, body, image_name) VALUES (?, ?, ?, ?)', ['Private fixture', '授業', 'Fictional pending article', imageName]);
        const privateImage = '/suggestions/' + privatePost + '/image';
        assert.equal((await fresh(privateImage)).status, 404);
        assert.equal((await old(privateImage)).status, 200);
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
        assert.equal((await old(privateImage)).status, 404, 'revoked teacher sessions cannot read pending images');
        assert.deepEqual((await a(privateImage)).body, imageBytes);
        assert.equal((await a('/staff/security')).body.mfaEnabled, true);
        const [[stored]] = await connection.execute('SELECT secret_cipher, recovery_hashes FROM staff_security WHERE staff_id = ?', [id]);
        assert(!stored.secret_cipher.includes(setup.body.secret));
        assert(!stored.recovery_hashes.includes(enabled.body.recoveryCodes[0]));
        await fresh('/session');
        assert.equal((await fresh('/login', { username: 'testteacher', password })).body.mfaRequired, true);
        assert.equal((await fresh('/staff/suggestions')).status, 401);
        assert.equal((await fresh(privateImage)).status, 404);
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
        assert.equal((await fresh(privateImage)).status, 404);
        await connection.query('DELETE FROM security_limits');
        const change = client();
        await change('/session');
        await change('/login', { username: 'testteacher', password });
        assert.equal((await change('/staff/mfa-login', { code: enabled.body.recoveryCodes[1] })).status, 200);
        assert.equal((await change('/staff/change-password', { currentPassword: password, password: 'short' })).status, 400);
        assert.equal((await change('/staff/change-password', { currentPassword: password, password: 'a new unique teacher testing passphrase' })).status, 200);
        assert.equal((await recovery('/staff/suggestions')).status, 401);
        assert.equal((await recovery(privateImage)).status, 404);
        const [{ insertId: studentId }] = await connection.execute('INSERT INTO students (username, password_hash) VALUES (?, ?)', ['studentfixture', await hashPassword('violet rivers under starlight')]);
        const studentA = client(), studentB = client();
        for (const student of [studentA, studentB]) {
            await student('/session');
            assert.equal((await student('/student/login', { username: 'studentfixture', password: 'violet rivers under starlight' })).status, 200);
        }
        // Attempt to cross account boundaries using otherwise valid signed-in sessions.
        const [{ insertId: otherId }] = await connection.execute('INSERT INTO students (username, password_hash) VALUES (?, ?)', ['otherfixture', await hashPassword('copper mountains after rainfall')]);
        const other = client(), guest = client(), moderator = client();
        await other('/session');
        await guest('/session');
        assert.equal((await other('/student/login', { username: 'otherfixture', password: 'copper mountains after rainfall' })).status, 200);
        assert.equal((await studentA('/profile', { display_name: 'Owner fixture', bio: 'Fictional bio', student_id: otherId, username: 'forged' })).status, 200);
        const [[untouched]] = await connection.execute('SELECT display_name FROM students WHERE id = ?', [otherId]);
        assert.equal(untouched.display_name, '');
        assert.equal((await studentA('/profile?student_id=' + otherId)).body.username, 'studentfixture');

        const article = { title: "Ownership fixture's article", body: 'Fictional school story', category: '授業', student_id: otherId, status: 'published' };
        assert.equal((await studentA('/suggestions', article)).status, 201);
        const [[posted]] = await connection.execute('SELECT id, student_id, status FROM suggestions WHERE title = ?', [article.title]);
        assert.equal(posted.student_id, studentId);
        assert.equal(posted.status, 'pending');
        assert((await studentA('/profile')).body.posts.some(post => post.id === posted.id));
        assert(!(await other('/profile')).body.posts.some(post => post.id === posted.id));
        assert.equal((await guest('/suggestions/' + posted.id)).status, 404);
        assert.equal((await other('/suggestions/' + posted.id + '/social')).status, 404);
        assert.equal((await other('/suggestions/' + posted.id + '/reaction', { kind: 'love' })).status, 404);
        for (const path of ['/staff/suggestions', '/staff/comments', '/staff/security-events']) assert.equal((await studentA(path)).status, 401);
        assert.equal((await studentA('/staff/suggestions/' + posted.id, { status: 'published' })).status, 401);

        await moderator('/session');
        await moderator('/login', { username: 'testteacher', password: 'a new unique teacher testing passphrase' });
        assert.equal((await moderator('/staff/mfa-login', { code: enabled.body.recoveryCodes[2] })).status, 200);
        assert.deepEqual((await moderator(privateImage)).body, imageBytes);
        assert.equal((await moderator('/staff/suggestions/' + privatePost, { status: 'published' })).status, 200);
        assert.deepEqual((await guest(privateImage)).body, imageBytes);
        assert.equal((await moderator('/staff/suggestions/' + privatePost, { status: 'hidden' })).status, 200);
        assert.equal((await guest(privateImage)).status, 404);
        assert.equal((await other(privateImage)).status, 404);
        assert.deepEqual((await moderator(privateImage)).body, imageBytes);
        assert.equal((await moderator('/staff/suggestions/' + posted.id, { status: 'published' })).status, 200);
        assert.equal((await guest('/suggestions/' + posted.id)).status, 200);
        assert.equal((await studentA('/suggestions/' + posted.id + '/reaction', { kind: 'love' })).status, 200);
        assert.equal((await other('/suggestions/' + posted.id + '/reaction', { kind: 'haha', student_id: studentId })).status, 200);
        assert.equal((await studentA('/suggestions/' + posted.id + '/social')).body.mine, 'love');
        assert.equal((await other('/suggestions/' + posted.id + '/social')).body.mine, 'haha');
        assert.equal((await other('/suggestions/' + posted.id + '/reaction', { kind: null, student_id: studentId })).status, 200);
        assert.equal((await studentA('/suggestions/' + posted.id + '/social')).body.mine, 'love');
        assert.equal((await other('/suggestions/' + posted.id + '/comments', { body: 'Fictional comment', student_id: studentId })).status, 201);
        const [[comment]] = await connection.execute('SELECT id, student_id FROM comments WHERE post_id = ?', [posted.id]);
        assert.equal(comment.student_id, otherId);
        assert.equal((await guest('/suggestions/' + posted.id + '/social')).body.comments.length, 0);
        assert.equal((await other('/suggestions/' + posted.id + '/social')).body.comments[0].review_pending, 1);
        assert.equal((await moderator('/staff/comments')).body.find(item => item.id === comment.id).review_pending, 1);

        assert.equal((await studentA('/staff/comments/' + comment.id, { hidden: true })).status, 401);
        assert.equal((await moderator('/staff/comments/' + comment.id, { hidden: true })).status, 200);
        assert.equal((await guest('/suggestions/' + posted.id + '/social')).body.commentCount, 0);
        assert.equal((await moderator('/staff/suggestions/' + posted.id, { status: 'hidden' })).status, 200);
        assert.equal((await guest('/suggestions/' + posted.id)).status, 404);
        assert.equal((await studentA('/suggestions/' + posted.id + '/comments', { body: 'Blocked on hidden post' })).status, 404);

        await connection.query('DELETE FROM security_limits');
        const postPath = '/staff/suggestions/' + posted.id;
        const commentPath = '/staff/comments/' + comment.id;
        const studentPath = '/staff/students/' + otherId;
        assert.equal((await guest('/staff/students')).status, 401);
        assert.equal((await studentA(studentPath + '/ban', {})).status, 401);
        assert.equal((await moderator(studentPath + '/ban', {}, true)).status, 403);
        const students = (await moderator('/staff/students')).body.students;
        assert(students.some(student => student.id === otherId && student.account_status === 'active'));
        assert(students.every(student => !('password_hash' in student) && !('reset_hash' in student)));
        assert.equal((await moderator(studentPath + '/ban', {})).status, 200);
        assert.equal((await other('/session')).body.student, false);
        assert.equal((await other('/profile')).status, 401);
        const { withStudentWrite } = await import('../student-write.js');
        await assert.rejects(withStudentWrite({ session: { studentId: otherId, passwordVersion: 1 } }, () => assert.fail('revoked request reached write')), { status: 401 });

        const otherCredentials = { username: 'otherfixture', password: 'copper mountains after rainfall' };
        assert.equal((await other('/student/login', otherCredentials)).status, 403);
        assert.equal((await moderator(studentPath + '/archive', {})).status, 200);
        assert.equal((await moderator(studentPath + '/unban', {})).status, 409);
        assert.equal((await moderator(studentPath + '/restore', {})).status, 200);
        assert.equal((await other('/student/login', otherCredentials)).status, 403);
        assert.equal((await moderator(studentPath + '/unban', {})).status, 200);
        assert.equal((await other('/student/login', otherCredentials)).status, 200);

        assert.equal((await moderator(postPath, { status: 'published' })).status, 200);
        assert.equal((await moderator(commentPath, { hidden: false })).status, 200);
        assert.equal((await moderator(commentPath + '/archive', {})).status, 200);
        assert.equal((await guest('/suggestions/' + posted.id + '/social')).body.commentCount, 0);
        assert.equal((await moderator(commentPath, { hidden: false })).status, 404);
        assert.equal((await moderator(commentPath + '/restore', {})).status, 200);
        assert.equal((await guest('/suggestions/' + posted.id + '/social')).body.commentCount, 0);
        assert.equal((await moderator(commentPath, { hidden: false })).status, 200);
        assert.equal((await guest('/suggestions/' + posted.id + '/social')).body.commentCount, 1);

        for (const text of ['second from other', 'third from other', 'fourth from other']) {
            assert.equal((await other('/suggestions/' + posted.id + '/comments', { body: text })).status, 201);
        }
        assert.equal((await other('/suggestions/' + posted.id + '/comments', { body: 'blocked after account budget' })).status, 429);
        assert.equal((await studentA('/suggestions/' + posted.id + '/comments', { body: 'different account' })).status, 201);
        assert.equal((await moderator(postPath + '/archive', {})).status, 200);
        assert.equal((await guest('/suggestions/' + posted.id)).status, 404);
        assert(!(await studentA('/profile')).body.posts.some(post => post.id === posted.id));
        assert.equal((await moderator(postPath, { status: 'published' })).status, 404);
        assert.equal((await moderator(postPath + '/restore', {})).status, 200);
        assert.equal((await guest('/suggestions/' + posted.id)).status, 404);
        assert((await studentA('/profile')).body.posts.some(post => post.id === posted.id && post.status === 'hidden'));

        const avatar = bytes => {
            const data = new FormData();
            data.set('display_name', 'Owner fixture'); data.set('bio', 'Fictional bio');
            data.set('image', new Blob([bytes], { type: 'image/png' }), 'fixture.png');
            return data;
        };
        assert.equal((await studentA('/profile', avatar(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')))).status, 400);
        assert.equal((await studentA('/profile', avatar(Buffer.alloc(3 * 1024 * 1024 + 1)))).status, 400);
        const [[mediaAfterRejectedUploads]] = await connection.query('SELECT COUNT(*) AS total FROM media_files');
        assert.equal(Number(mediaAfterRejectedUploads.total), 1);
        const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).withMetadata({ orientation: 1 }).png().toBuffer();
        assert((await sharp(png).metadata()).exif);
        assert.equal((await studentA('/profile', avatar(png))).status, 200);
        const quotaName = randomBytes(16).toString('hex') + '.webp';
        await connection.execute('INSERT INTO media_files (name, data) VALUES (?, ?)', [quotaName, Buffer.alloc(1024)]);
        assert.equal((await studentA('/profile', avatar(png))).status, 507);
        assert.equal((await moderator('/staff/media-usage')).body.quota, 1024);
        await connection.execute('DELETE FROM media_files WHERE name = ?', [quotaName]);
        const savedAvatar = await studentA('/profile/avatar');
        assert.equal(savedAvatar.headers.get('content-type'), 'image/webp');
        const savedMetadata = await sharp(savedAvatar.body).metadata();
        assert.equal(savedMetadata.format, 'webp');
        assert.equal(savedMetadata.exif, undefined);
        assert.equal((await other('/profile/avatar')).status, 404);
        assert.equal((await studentA('/student/logout-all', {})).status, 200);
        assert.equal((await studentB('/profile')).status, 401);
        // Weak legacy passwords prove identity only; they never grant posting access.
        await connection.query('DELETE FROM security_limits');
        const [{ insertId: legacyId }] = await connection.execute('INSERT INTO students (username, password_hash, display_name, bio) VALUES (?, ?, ?, ?)', ['legacyfixture', await hashPassword('1234'), 'Keep my name', 'Keep my profile']);
        const [{ insertId: legacyPost }] = await connection.execute('INSERT INTO suggestions (student_id, title, category, body) VALUES (?, ?, ?, ?)', [legacyId, 'Keep my article', '授業', 'Fictional legacy article']);
        const upgrade = client(), rival = client(), outsider = client();
        for (const c of [upgrade, rival, outsider]) await c('/session');
        assert.equal((await outsider('/student/upgrade-password', { password: 'a beautiful afternoon in spring' })).status, 401);
        for (const c of [upgrade, rival]) {
            const result = await c('/student/login', { username: 'legacyfixture', password: '1234' });
            assert.equal(result.body.passwordUpgradeRequired, true);
            const [[policy]] = await connection.execute('SELECT must_reset_password FROM students WHERE id = ?', [legacyId]);
            assert.equal(policy.must_reset_password, 1);
            assert.equal((await c('/session')).body.student, false);
            assert.equal((await c('/profile')).status, 401);
        }
        const expired = client();
        await expired('/session');
        await expired('/student/login', { username: 'legacyfixture', password: '1234' });
        const { seal, unseal } = await import('../security.js');
        const [challengeRows] = await connection.query('SELECT id, data FROM app_sessions');
        for (const row of challengeRows) {
            const value = unseal(row.data, row.id.toString());
            if (value.studentUpgrade?.id !== legacyId) continue;
            value.studentUpgrade.at = Date.now() - 300001;
            await connection.execute('UPDATE app_sessions SET data = ? WHERE id = ?', [seal(value, row.id.toString()), row.id]);
        }
        assert.equal((await expired('/student/upgrade-password', { password: 'a beautiful afternoon in spring' })).status, 401);
        // Restart the other two challenges after the deliberate expiry fixture.
        for (const c of [upgrade, rival]) await c('/student/login', { username: 'legacyfixture', password: '1234' });
        await connection.query('DELETE FROM security_limits');
        const newPassword = 'a beautiful afternoon in spring';
        const fields = { password: newPassword, password_confirmation: newPassword };
        assert.equal((await upgrade('/student/upgrade-password', fields, true)).status, 403);
        assert.equal((await upgrade('/student/upgrade-password', { password: '1234', password_confirmation: '1234' })).status, 400);
        assert.equal((await upgrade('/student/upgrade-password', { ...fields, password_confirmation: 'different' })).status, 400);
        assert.equal((await upgrade('/student/upgrade-password', fields)).status, 200);
        const [[preserved]] = await connection.execute('SELECT display_name, bio, password_version, must_reset_password FROM students WHERE id = ?', [legacyId]);
        assert.equal(preserved.display_name, 'Keep my name');
        assert.equal(preserved.bio, 'Keep my profile');
        assert.equal(preserved.password_version, 2);
        assert.equal(preserved.must_reset_password, 0);
        const [[owned]] = await connection.execute('SELECT student_id FROM suggestions WHERE id = ?', [legacyPost]);
        assert.equal(owned.student_id, legacyId);
        assert.equal((await upgrade('/profile')).status, 200);
        assert.equal((await upgrade('/student/upgrade-password', fields)).status, 401, 'challenge is single use');
        assert.equal((await rival('/student/upgrade-password', fields)).status, 401, 'concurrent stale challenge cannot overwrite a new password');
        assert.equal((await outsider('/student/login', { username: 'legacyfixture', password: '1234' })).status, 401);
        const relogin = await outsider('/student/login', { username: 'legacyfixture', password: newPassword });
        assert.equal(relogin.status, 200);
        assert.equal(relogin.body.passwordUpgradeRequired, undefined);
        assert.equal((await outsider('/profile')).status, 200);
        await connection.query('DELETE FROM security_limits');
        const deletePassword = 'fictional deletion test credential';
        const [{ insertId: deleteId }] = await connection.execute('INSERT INTO students (username, password_hash, avatar_name) VALUES (?, ?, ?)', ['deletefixture', await hashPassword(deletePassword), imageName]);
        const [{ insertId: deletePost }] = await connection.execute('INSERT INTO suggestions (student_id, title, category, body) VALUES (?, ?, ?, ?)', [deleteId, 'Delete fixture', '授業', 'Fictional']);
        await connection.execute('UPDATE students SET avatar_name = NULL WHERE id = ?', [studentId]);
        await connection.execute('UPDATE suggestions SET image_name = NULL WHERE id = ?', [privatePost]);
        await connection.execute('INSERT INTO comments (post_id, student_id, body) VALUES (?, ?, ?), (?, ?, ?)', [deletePost, otherId, 'comment on deleted post', posted.id, deleteId, 'deleted student comment']);
        await connection.execute('INSERT INTO reactions (post_id, student_id, kind) VALUES (?, ?, ?), (?, ?, ?)', [deletePost, otherId, 'love', posted.id, deleteId, 'like']);
        const deletion = client();
        await deletion('/session');
        await deletion('/student/login', { username: 'deletefixture', password: deletePassword });
        assert.equal((await deletion('/student/delete-account', { password: 'wrong', confirmation: 'DELETE' })).status, 400);
        assert.equal((await deletion('/student/delete-account', { password: deletePassword, confirmation: 'DELETE' }, true)).status, 403);
        assert.equal((await deletion('/student/delete-account', { password: deletePassword, confirmation: 'DELETE' })).status, 200);
        assert.equal((await deletion('/profile')).status, 401);
        for (const [sql, values] of [
            ['SELECT id FROM students WHERE id = ?', [deleteId]], ['SELECT id FROM suggestions WHERE id = ?', [deletePost]],
            ['SELECT id FROM comments WHERE student_id = ? OR post_id = ?', [deleteId, deletePost]],
            ['SELECT post_id FROM reactions WHERE student_id = ? OR post_id = ?', [deleteId, deletePost]],
            ['SELECT name FROM media_files WHERE name = ?', [imageName]],
        ]) {
            const [rows] = await connection.execute(sql, values);
            assert.equal(rows.length, 0);
        }
        const teacherDelete = '/staff/students/' + otherId + '/delete-permanently';
        const proof = { password: 'a new unique teacher testing passphrase', confirmation: 'DELETE' };
        assert.equal((await guest(teacherDelete, proof)).status, 401);
        assert.equal((await moderator(teacherDelete, proof)).status, 409, 'active student must be archived first');
        await moderator('/staff/students/' + otherId + '/archive', {});
        assert.equal((await moderator(teacherDelete, proof)).status, 200);
        const [[unrelatedPost]] = await connection.execute('SELECT student_id FROM suggestions WHERE id = ?', [posted.id]);
        assert.equal(unrelatedPost.student_id, studentId);

        await connection.query('DELETE FROM security_limits');
        await connection.execute('UPDATE staff_security SET last_step = -1 WHERE staff_id = ?', [id]);
        const renewal = await moderator('/staff/mfa-recovery-codes', { password: proof.password, code: totp.generate() });
        assert.equal(renewal.status, 200);
        assert.equal(renewal.body.recoveryCodes.length, 8);
        const checkCodes = client();
        await checkCodes('/session');
        await checkCodes('/login', { username: 'testteacher', password: proof.password });
        assert.equal((await checkCodes('/staff/mfa-login', { code: enabled.body.recoveryCodes[4] })).status, 401);
        assert.equal((await checkCodes('/staff/mfa-login', { code: renewal.body.recoveryCodes[0] })).status, 200);

        const { DatabaseRateStore, DatabaseSessionStore } = await import('../security.js');
        const limitA = new DatabaseRateStore('test'), limitB = new DatabaseRateStore('test');
        limitA.init({ windowMs: 60000 }); limitB.init({ windowMs: 60000 });
        assert.equal((await limitA.increment('shared-client')).totalHits, 1);
        assert.equal((await limitB.increment('shared-client')).totalHits, 2);
        const storeA = new DatabaseSessionStore(), storeB = new DatabaseSessionStore();
        await new Promise((resolve, reject) => storeA.set('fixture-session-id', { firebaseToken: 'not-plaintext', cookie: { expires: new Date(Date.now() + 60000) } }, error => error ? reject(error) : resolve()));
        const restored = await new Promise((resolve, reject) => storeB.get('fixture-session-id', (error, data) => error ? reject(error) : resolve(data)));
        assert.equal(restored.firebaseToken, 'not-plaintext');
        await new Promise((resolve, reject) => storeA.destroy('fixture-session-id', error => error ? reject(error) : resolve()));
        await new Promise((resolve, reject) => storeB.touch('fixture-session-id', restored, error => error ? reject(error) : resolve()));
        await new Promise((resolve, reject) => storeB.set('fixture-session-id', restored, error => error ? reject(error) : resolve()));
        const revoked = await new Promise((resolve, reject) => storeA.get('fixture-session-id', (error, data) => error ? reject(error) : resolve(data)));
        assert.equal(revoked, null, 'stale touches and writes cannot restore a signed-out session');

        const [sessions] = await connection.query('SELECT id, data FROM app_sessions');
        assert(sessions.every(item => !item.data.includes('not-plaintext') && item.id.toString() !== 'fixture-session-id'));
    } finally {
        if (stopContainer) await stopContainer();
        if (server) await new Promise(resolve => server.close(resolve));
        if (pool) await pool.end();
        // Only the explicitly named disposable test database can be removed.
        await connection.query('DROP DATABASE ' + name);
        await connection.query('DROP USER IF EXISTS ?@?', [runtimeUser, '%']);
        await connection.end();
    }
});
