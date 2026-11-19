// Administrator security controls. Secrets are displayed only during enrollment.
async function loadStaffSecurity() {
    const status = await api('/staff/security');
    document.querySelector('#security-status').textContent = (status.mfaEnabled ? '二段階認証：有効。' : '二段階認証：未設定。認証アプリの設定をおすすめします。')
        + (status.passwordUpgradeNeeded ? ' パスワードを15文字以上の強いものに変更してください。' : '');
    document.querySelector('#mfa-setup-form').hidden = status.mfaEnabled;
}
onForm('#mfa-login-form', '/staff/mfa-login', async result => {
    csrf = result.csrf;
    document.querySelector('#mfa-login-form').hidden = true;
    await navigate();
    showMessage('二段階認証でログインしました。');
});
onForm('#mfa-setup-form', '/staff/mfa-setup', async result => {
    document.querySelector('#mfa-secret').textContent = result.secret;
    document.querySelector('#mfa-enrollment').hidden = false;
    document.querySelector('#mfa-setup-form').reset();
});
onForm('#mfa-enable-form', '/staff/mfa-enable', async result => {
    document.querySelector('#mfa-secret').textContent = '';
    document.querySelector('#mfa-enrollment').hidden = true;
    document.querySelector('#mfa-recovery-codes').textContent = result.recoveryCodes.join('\n');
    document.querySelector('#mfa-recovery').hidden = false;
    await loadStaffSecurity();
    showMessage(result.message);
});
document.querySelector('#mfa-hide-codes').addEventListener('click', () => {
    document.querySelector('#mfa-recovery-codes').textContent = '';
    document.querySelector('#mfa-recovery').hidden = true;
});
onForm('#staff-password-form', '/staff/change-password', async result => {
    document.querySelector('#staff-password-form').reset();
    await navigate();
    showMessage(result.message);
});
document.querySelector('#staff-logout-all').addEventListener('click', async () => {
    try { const result = await api('/staff/logout-all', {}); await navigate(); showMessage(result.message); }
    catch (error) { showMessage(error.message, true); }
});
const logoutAll = element('button', 'すべての端末からログアウト', 'secondary');
logoutAll.type = 'button';
document.querySelector('#profile-logout').after(logoutAll);
logoutAll.addEventListener('click', async () => {
    try { const result = await api('/student/logout-all', {}); await navigate(); showMessage(result.message); }
    catch (error) { showMessage(error.message, true); }
});
document.querySelector('#security-refresh').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
        const data = await api('/staff/security-events');
        const counts = data.summary;
        document.querySelector('#security-monitor-summary').textContent = '過去24時間：拒否 ' + counts.denied + '件 ／ 回数制限 ' + counts.limited + '件 ／ サーバーエラー ' + counts.errors + '件'
            + (Number(counts.denied) >= 20 || Number(counts.errors) > 0 ? ' — 操作記録を確認してください。' : '');
        const list = document.querySelector('#security-monitor-events');
        list.replaceChildren();
        for (const entry of data.events) {
            const row = element('article', '', 'security-event');
            const date = new Date(entry.occurred_at);
            row.append(element('strong', String(entry.status)), element('span', entry.event),
                element('small', new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'medium' }).format(date) + ' · ' + entry.actor),
                element('small', '照会ID: ' + entry.request_id));
            list.append(row);
        }
        if (!data.events.length) list.append(element('p', '記録はまだありません。'));
    } catch (error) { showMessage(error.message, true); }
    finally { button.disabled = false; }
});
