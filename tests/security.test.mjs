import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SESSION_SECRET = 'isolated-unit-test-key-never-a-production-secret';
const { seal, unseal, otpStep } = await import('../security.js');

test('encrypted session data rejects tampering and another record identity', () => {
    const sealed = seal({ firebaseToken: 'fixture-token' }, 'session-A');
    assert(!sealed.includes('fixture-token'));
    assert.deepEqual(unseal(sealed, 'session-A'), { firebaseToken: 'fixture-token' });
    assert.throws(() => unseal(sealed, 'session-B'));
    const [version, id, payload] = sealed.split(':');
    assert.equal(version, 'v2');
    const bytes = Buffer.from(payload, 'base64');
    bytes[bytes.length - 1] ^= 1;
    assert.throws(() => unseal([version, id, bytes.toString('base64')].join(':'), 'session-A'));
    assert.throws(() => unseal(seal({ secret: 'fixture' }, 'mfa:7'), 'session-A'));
});
test('TOTP matches RFC 6238 SHA-1 fixture and rejects malformed codes', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    assert.equal(otpStep(secret, '287082', 59000), 1);
    assert.equal(otpStep(secret, '000000', 59000), null);
    assert.equal(otpStep(secret, '28708', 59000), null);
    assert.equal(otpStep(secret, { token: '287082' }, 59000), null);
});


test('previous master opens old unversioned MFA without re-enrollment', async () => {
    const { createCipheriv, createHmac, randomBytes } = await import('node:crypto');
    const old = process.env.SESSION_SECRET;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', createHmac('sha256', old).update('student-voice/encryption/v1').digest(), iv);
    cipher.setAAD(Buffer.from('mfa:7'));
    const body = Buffer.concat([cipher.update(JSON.stringify('fixture-seed')), cipher.final()]);
    const legacy = Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
    process.env.SESSION_SECRET_PREVIOUS = old;
    process.env.SESSION_SECRET = 'different-follow-up-unit-test-master-key';
    try {
        const rotation = await import('../security.js?rotation');
        assert.equal(rotation.unseal(legacy, 'mfa:7'), 'fixture-seed');
        assert.equal(rotation.unseal(seal('v2 from old key', 'mfa:7'), 'mfa:7'), 'v2 from old key');
        const upgraded = rotation.seal('fixture-seed', 'mfa:7');
        assert.equal(rotation.unseal(upgraded, 'mfa:7'), 'fixture-seed');
        assert.throws(() => unseal(upgraded, 'mfa:7'));
    } finally {
        process.env.SESSION_SECRET = old;
        delete process.env.SESSION_SECRET_PREVIOUS;
    }
});


test('legacy cutoff is off unless a strict UTC date is configured', async () => {
    const { parseLegacyCutoff } = await import('../email-auth.js');
    assert.equal(parseLegacyCutoff(''), null);
    assert.equal(parseLegacyCutoff('2028-02-29'), Date.UTC(2028, 1, 29));
    assert.throws(() => parseLegacyCutoff('2027-02-29'));
    assert.throws(() => parseLegacyCutoff('tomorrow'));
});


test('signup blocks disposable domains and uses an optional exact school allowlist', async () => {
    const { signupDomainAllowed } = await import('../email-auth.js');
    assert.equal(signupDomainAllowed('alias@sub.mailinator.com'), false);
    assert.equal(signupDomainAllowed('student@school.edu', ' SCHOOL.EDU, alumni.school.edu '), true);
    assert.equal(signupDomainAllowed('student@unrelated.school.edu', 'school.edu'), false);
    assert.equal(signupDomainAllowed('student@school.edu', ''), true);
});
