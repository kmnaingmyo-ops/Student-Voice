import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';

const page = file => readFile(new URL('../public/' + file, import.meta.url), 'utf8');
async function until(predicate) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await delay(10);
    }
    assert.fail('Dashboard did not finish updating.');
}

test('moderation moves a card to Trash and restores it without leaving the dashboard', async () => {
    const dom = new JSDOM(await page('index.html'), { url: 'https://fixture.invalid/#staff', runScripts: 'outside-only' });
    const { window } = dom;
    const { document } = window;
    let sessionReads = 0;
    let confirm = false;
    let finish;
    window.confirm = () => confirm;
    window.scrollTo = () => {};
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    window.fetch = async (path, options) => {
        const ok = data => ({ ok: true, json: async () => data });
        if (path === '/api/session') { sessionReads++; return ok({ staff: true, student: false, csrf: 'sample' }); }
        if (path === '/api/staff/suggestions' || path === '/api/staff/comments') return ok([]);
        if (path === '/api/staff/security') return ok({ mfaEnabled: false });
        if (path === '/api/staff/media-usage') return ok({ bytes: 0, quota: 100 });
        if (path === '/api/staff/students') return ok({ next: null, students: [
            { id: 1, username: 'fictional_one', account_status: 'active' },
            { id: 2, username: 'fictional_two', account_status: 'active' },
        ] });
        assert.match(path, /^\/api\/staff\/students\/1\/(archive|restore)$/);
        assert.equal(options.method, 'POST');
        assert.equal(options.headers['X-CSRF-Token'], 'sample');
        await new Promise(resolve => { finish = resolve; });
        return ok({ message: 'Fictional change saved' });
    };
    try {
        window.eval((await page('app.js')) + '\n' + (await page('security-ui.js')));
        const dashboard = document.querySelector('#dashboard');
        const login = document.querySelector('#login-panel');
        const list = document.querySelector('#staff-students');
        await until(() => list.children.length === 2 && !dashboard.hidden);
        const unaffected = list.children[1];
        const visibility = [];
        const observer = new window.MutationObserver(records => visibility.push(...records));
        for (const view of [dashboard, login]) observer.observe(view, { attributes: true, attributeFilter: ['hidden'] });
        const trash = list.children[0].querySelector('button:last-child');
        trash.click();
        assert.equal(finish, undefined, 'cancelling the confirmation sends no write');
        confirm = true;
        trash.click();
        assert.equal(dashboard.hidden, false);
        assert.equal(login.hidden, true);
        assert.equal(trash.disabled, true);
        finish();
        await until(() => list.children[0].querySelector('.tag').textContent === 'ゴミ箱');
        const restore = list.children[0].querySelector('button');
        restore.click();
        finish();
        await until(() => list.children[0].querySelector('.tag').textContent === '利用停止中');
        assert.equal(list.children[1], unaffected);
        assert.equal(sessionReads, 1);
        assert.equal(visibility.length, 0, 'the login form and dashboard never change visibility');
        observer.disconnect();
    } finally { window.close(); }
});
