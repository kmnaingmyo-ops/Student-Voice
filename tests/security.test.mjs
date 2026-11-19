import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SESSION_SECRET = 'isolated-unit-test-key-never-a-production-secret';
const { seal, unseal, otpStep } = await import('../security.js');

test('encrypted session data rejects tampering and another record identity', () => {
    const sealed = seal({ firebaseToken: 'fixture-token' }, 'session-A');
    assert(!sealed.includes('fixture-token'));
    assert.deepEqual(unseal(sealed, 'session-A'), { firebaseToken: 'fixture-token' });
    assert.throws(() => unseal(sealed, 'session-B'));
    const bytes = Buffer.from(sealed, 'base64');
    bytes[bytes.length - 1] ^= 1;
    assert.throws(() => unseal(bytes.toString('base64'), 'session-A'));
});
test('TOTP matches RFC 6238 SHA-1 fixture and rejects malformed codes', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    assert.equal(otpStep(secret, '287082', 59000), 1);
    assert.equal(otpStep(secret, '000000', 59000), null);
    assert.equal(otpStep(secret, '28708', 59000), null);
    assert.equal(otpStep(secret, { token: '287082' }, 59000), null);
});
