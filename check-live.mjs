import assert from 'node:assert/strict';

// Public, low-volume checks: no login credentials or student content are logged.
const target = new URL(process.env.LIVE_SITE_URL || 'https://student-voice-p2mf.onrender.com');
assert(target.protocol === 'https:' && !target.username && !target.password,
    'LIVE_SITE_URL must be an HTTPS address without credentials');
const base = target.origin;
let passed = 0;
const pass = label => { passed++; console.log('PASS: ' + label); };
async function request(path, options = {}) {
    return fetch(base + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(90000) });
}
function headers(response) {
    const h = response.headers;
    assert.equal(h.get('x-content-type-options'), 'nosniff', 'Missing MIME protection');
    assert.equal(h.get('x-frame-options'), 'DENY', 'Missing frame protection');
    assert.equal(h.get('referrer-policy'), 'no-referrer', 'Missing referrer protection');
    assert.match(h.get('strict-transport-security') || '', /max-age=(\d+)/i, 'Missing HSTS');
    const age = Number(/max-age=(\d+)/i.exec(h.get('strict-transport-security'))[1]);
    assert(age >= 31536000, 'HSTS must last at least one year');
    for (const directive of ["default-src 'self'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"]) {
        assert((h.get('content-security-policy') || '').split(';').some(item => item.trim() === directive), 'Missing CSP directive: ' + directive);
    }
    for (const permission of ['camera=()', 'microphone=()', 'geolocation=()']) {
        assert((h.get('permissions-policy') || '').includes(permission), 'Missing permission restriction');
    }
    assert.equal(h.get('x-powered-by'), null, 'Framework disclosure');
}
try {
    // Render Free can take approximately a minute to wake after inactivity.
    const home = await request('/');
    assert.equal(home.status, 200, 'Homepage unavailable');
    headers(home);
    assert.match(await home.text(), /Student Voice/i, 'Unexpected homepage');
    pass('Homepage and browser security headers');

    const session = await request('/api/session');
    assert.equal(session.status, 200, 'Session endpoint unavailable');
    headers(session);
    assert.match(session.headers.get('cache-control') || '', /no-store/i, 'Session response must not be cached');
    const data = await session.json();
    assert.equal(data.staff, false, 'Guest unexpectedly has administrator access');
    assert.equal(data.student, false, 'Guest unexpectedly has student access');
    assert.match(data.csrf || '', /^[a-f0-9]{64}$/, 'Missing CSRF token');
    const cookie = session.headers.getSetCookie().find(value => value.startsWith('student_voice_sid='));
    assert(cookie, 'Missing session cookie');
    for (const flag of [/;\s*Secure(?:;|$)/i, /;\s*HttpOnly(?:;|$)/i, /;\s*SameSite=Strict(?:;|$)/i]) {
        assert.match(cookie, flag, 'Session cookie is missing a security attribute');
    }
    const cookieHeader = cookie.split(';')[0];
    pass('Guest session, CSRF token, private caching, and secure cookie');

    const posts = await request('/api/suggestions', { headers: { Cookie: cookieHeader } });
    assert.equal(posts.status, 200, 'Public articles unavailable');
    assert(Array.isArray(await posts.json()), 'Unexpected public article response');
    pass('Public articles and database connection');

    for (const path of ['/api/staff/suggestions', '/api/staff/security', '/api/staff/security-events']) {
        const response = await request(path, { headers: { Cookie: cookieHeader } });
        assert.equal(response.status, 401, 'Guest can access a private administrator endpoint');
        await response.arrayBuffer();
    }
    pass('Administrator endpoints reject guests');

    // Empty requests stop at authorization/CSRF checks; no article is created.
    const deniedPost = await request('/api/suggestions', { method: 'POST', headers: {
        Cookie: cookieHeader, 'Content-Type': 'application/json', 'X-CSRF-Token': data.csrf,
    }, body: '{}' });
    assert.equal(deniedPost.status, 401, 'Guest can submit an article');
    await deniedPost.arrayBuffer();
    const missingToken = await request('/api/suggestions', { method: 'POST', headers: {
        Cookie: cookieHeader, 'Content-Type': 'application/json',
    }, body: '{}' });
    assert.equal(missingToken.status, 403, 'Request without CSRF token was accepted');
    await missingToken.arrayBuffer();
    pass('Guest posting and requests without CSRF tokens are blocked');
    console.log('Live security checks passed (' + passed + ' groups).');
} catch (error) {
    // Do not dump response bodies, cookies, tokens, or upstream error objects.
    console.error('FAIL: ' + (error instanceof assert.AssertionError ? error.message : 'Live site request failed or timed out'));
    process.exitCode = 1;
}
