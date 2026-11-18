let csrf = '';
let signedIn = false;
let studentSignedIn = false;
let viewVersion = 0;
const notice = document.querySelector('#notice');
const statuses = { pending: '確認待ち', published: '公開中', hidden: '非公開' };
let publicPosts = [];
let selectedCategory = 'すべて';
let currentPage = 1;
const pageSize = 6;
const iconSources = { outline: '/icons/blog-outline.png', color: '/icons/blog-color.png' };
const reactionChoices = { like: '👍 いいね', love: '❤️ 大好き', haha: '😆 笑った', wow: '😮 すごい', sad: '😢 悲しい', care: '🤗 応援' };

function topicThumbnail(post) {
    const title = post.title || '';
    const topics = [
        [/図書|読書|本の|本を|一冊|library/i, 'library'],
        [/実験|理科|科学|science/i, 'science'],
        [/給食|食事|昼食|lunch/i, 'lunch'],
        [/文化祭|行事|festival/i, 'festival'],
        [/校庭|校舎|設備|campus/i, 'campus'],
        [/ノート|復習|勉強|notes/i, 'notes'],
        [/学期|目標|挑戦|goals/i, 'goals'],
        [/体育|リレー|部活|sport/i, 'sports'],
        [/雨|傘|rain/i, 'rain'],
    ];
    const match = topics.find(([pattern]) => pattern.test(title));
    const fallback = { '授業': 'notes', '学校生活': 'campus', '設備': 'campus', 'その他': 'goals' };
    return '/thumbnails/' + (match?.[1] || fallback[post.category] || 'campus') + '.jpg';
}

function cover(post) {
    const customIcon = post.cover_icon === 'color';
    const art = element('div', '', 'cover ' + (customIcon && !post.has_image ? 'icon-cover' : 'photo-cover'));
    art.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img');
    image.src = post.has_image ? '/api/suggestions/' + post.id + '/image' : customIcon ? iconSources.color : topicThumbnail(post);
    image.alt = '';
    image.loading = 'lazy';
    image.className = customIcon && !post.has_image ? 'cover-icon' : 'cover-photo';
    art.append(image);
    return art;
}

function metadata(post) {
    const meta = element('div', '', 'meta');
    const date = new Date(post.created_at);
    meta.append(element('span', post.category, 'tag'));
    if (!Number.isNaN(date.getTime())) {
        const time = element('time', new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(date));
        time.dateTime = date.toISOString();
        meta.append(time);
    }
    return meta;
}

function blogCard(post, featured = false) {
    const card = element('article', '', featured ? 'featured' : 'blog-card');
    const imageLink = element('a', '');
    imageLink.href = '#post/' + post.id;
    imageLink.setAttribute('aria-label', post.title + 'を読む');
    imageLink.append(cover(post));
    const content = element('div', '', featured ? 'featured-content' : 'card-content');
    const titleLink = element('a', post.title);
    titleLink.href = '#post/' + post.id;
    const heading = element('h2', '');
    heading.append(titleLink);
    const link = element('a', '記事を読む ↗', 'read-link');
    link.href = '#post/' + post.id;
    link.setAttribute('aria-label', post.title + 'の全文を読む');
    content.append(metadata(post), heading, element('p', post.body, 'excerpt'), link);
    const socialLink = element('a', '❤️ ' + (post.reaction_count || 0) + '　💬 ' + (post.comment_count || 0) + ' コメント', 'social-summary');
    socialLink.href = '#post/' + post.id;
    socialLink.setAttribute('aria-label', post.title + 'のリアクションとコメント');
    content.append(socialLink);
    card.append(imageLink, content);
    return card;
}

function renderBlog() {
    renderRecentPosts();
    const filtered = publicPosts.filter(post => selectedCategory === 'すべて' || post.category === selectedCategory);
    const featured = document.querySelector('#featured-post');
    featured.replaceChildren();
    // All approved stories appear in the journal grid beneath the cinematic hero.
    const remaining = filtered;
    const pages = Math.max(1, Math.ceil(remaining.length / pageSize));
    currentPage = Math.min(currentPage, pages);
    const grid = document.querySelector('#public-posts');
    grid.replaceChildren();
    for (const post of remaining.slice((currentPage - 1) * pageSize, currentPage * pageSize)) {
        grid.append(blogCard(post));
    }
    if (!filtered.length) grid.append(element('p', 'このカテゴリの記事はまだありません。最初の記事を書いてみませんか。', 'empty'));
    document.querySelector('.board-heading').hidden = false;
    document.querySelector('#post-count').textContent = filtered.length + ' 件の記事';
    const pagination = document.querySelector('#pagination');
    pagination.replaceChildren();
    if (pages > 1) {
        for (let page = 1; page <= pages; page++) {
            const button = element('button', String(page));
            button.setAttribute('aria-label', page + 'ページ目');
            if (page === currentPage) button.setAttribute('aria-current', 'page');
            button.addEventListener('click', () => {
                currentPage = page;
                renderBlog();
                document.querySelector('.board-heading').scrollIntoView({ block: 'start' });
            });
            pagination.append(button);
        }
    }
    for (const button of document.querySelectorAll('#category-filters button')) {
        button.setAttribute('aria-pressed', String(button.textContent === selectedCategory));
    }
}

function renderRecentPosts() {
    const target = document.querySelector('#recent-posts');
    target.replaceChildren();
    document.querySelector('#recent-stories').hidden = !publicPosts.length;
    for (const post of publicPosts.slice(0, 2)) {
        const link = element('a', '', 'recent-story');
        link.href = '#post/' + post.id;
        link.append(cover(post), element('span', post.title, 'recent-title'));
        target.append(link);
    }
}

for (const category of ['すべて', '授業', '学校生活', '設備', 'その他']) {
    const button = element('button', category);
    button.setAttribute('aria-pressed', String(category === selectedCategory));
    button.addEventListener('click', () => { selectedCategory = category; currentPage = 1; renderBlog(); });
    document.querySelector('#category-filters').append(button);
}

function renderArticle(post, social) {
    const target = document.querySelector('#article-content');
    target.replaceChildren(metadata(post), element('h1', post.title), cover(post),
        element('div', post.body, 'body'), element('p', 'Student Voice · 生徒のブログ', 'article-author'));
    document.title = post.title + ' | Student Voice';
    const socialSection = element('section', '', 'article-social');
    socialSection.append(element('h2', 'リアクション'));
    const reactions = element('div', '', 'reaction-bar');
    for (const [kind, label] of Object.entries(reactionChoices)) {
        const count = social.reactions.find(reaction => reaction.kind === kind)?.total || 0;
        const button = element('button', label + ' ' + count, 'reaction-button');
        button.setAttribute('aria-pressed', String(social.mine === kind));
        button.addEventListener('click', async () => {
            if (!studentSignedIn) { showMessage('リアクションには生徒ログインが必要です。', true); return; }
            reactions.querySelectorAll('button').forEach(node => { node.disabled = true; });
            try {
                await api('/suggestions/' + post.id + '/reaction', { kind: social.mine === kind ? null : kind });
                await refreshSocial(post);
            } catch (error) {
                showMessage(error.message, true);
                reactions.querySelectorAll('button').forEach(node => { node.disabled = false; });
            }
        });
        reactions.append(button);
    }
    socialSection.append(reactions, element('h2', 'コメント · ' + social.commentCount));
    if (studentSignedIn) {
        const form = element('form', '', 'comment-form stack');
        const label = element('label', 'コメントを書く');
        const input = document.createElement('textarea');
        input.maxLength = 500;
        input.rows = 3;
        input.required = true;
        label.append(input);
        const button = element('button', 'コメントを投稿');
        form.append(label, element('p', 'コメントにはユーザー名が表示されます。500文字まで。', 'comment-help'), button);
        form.addEventListener('submit', async event => {
            event.preventDefault();
            button.disabled = true;
            try {
                await api('/suggestions/' + post.id + '/comments', { body: input.value });
                await refreshSocial(post);
                showMessage('コメントを投稿しました。');
            } catch (error) { showMessage(error.message, true); button.disabled = false; }
        });
        socialSection.append(form);
    } else {
        const login = element('a', 'ログインしてリアクション・コメントする →', 'button secondary');
        login.href = '#account';
        socialSection.append(login);
    }
    if (!social.comments.length) socialSection.append(element('p', '最初のコメントを書いてみませんか。', 'comment-help'));
    if (social.commentCount > 50) socialSection.append(element('p', '最新の50件を表示しています。', 'comment-help'));
    for (const comment of social.comments) {
        const card = element('article', '', 'comment');
        card.append(element('strong', comment.username), element('p', comment.body, 'body'));
        socialSection.append(card);
    }
    target.append(socialSection);
}

async function refreshSocial(post) {
    const route = location.hash;
    const data = await api('/suggestions/' + post.id + '/social');
    if (location.hash === route && route === '#post/' + post.id) renderArticle(post, data);
}

function showMessage(message, error = false) {
    notice.textContent = message;
    notice.className = error ? 'error' : 'notice';
    const dialog = document.querySelector('#feedback-dialog');
    notice.hidden = !message || Boolean(dialog?.showModal);
    if (!message || !dialog?.showModal) return;
    dialog.dataset.kind = error ? 'error' : 'success';
    document.querySelector('#feedback-title').textContent = error ? 'もう一度、確認してみよう。' : 'できました！';
    document.querySelector('#feedback-icon').textContent = error ? '!' : '✓';
    document.querySelector('#feedback-message').textContent = message;
    if (!dialog.open) dialog.showModal();
}

async function api(path, data) {
    const multipart = data instanceof FormData;
    const response = await fetch('/api' + path, {
        method: data ? 'POST' : 'GET',
        headers: data ? multipart ? { 'X-CSRF-Token': csrf } : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {},
        body: data ? multipart ? data : JSON.stringify(data) : undefined,
    });
    const result = await response.json();
    if (!response.ok) {
        if (response.status === 401) signedIn = false;
        throw new Error(result.error || '通信に失敗しました。');
    }
    return result;
}

function element(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
}

function renderPosts(target, posts, staffView) {
    target.replaceChildren();
    if (!posts.length) target.append(element('p', '投稿はまだありません。', 'panel'));
    for (const post of posts) {
        const card = element('article', '', 'panel');
        card.append(element('span', post.category, 'tag'));
        if (staffView) card.append(element('span', statuses[post.status], 'tag'));
        card.append(element('h2', post.title), element('p', post.body, 'body'));
        card.prepend(cover(post));
        if (staffView) {
            const actions = element('div', '', 'actions');
            for (const [status, label] of [['published', '公開する'], ['hidden', '非公開にする']]) {
                if (post.status === status) continue;
                const button = element('button', label, status === 'hidden' ? 'secondary' : '');
                button.addEventListener('click', async () => {
                    button.disabled = true;
                    try {
                        const result = await api('/staff/suggestions/' + post.id, { status });
                        await navigate();
                        showMessage(result.message);
                    } catch (error) {
                        showMessage(error.message, true);
                    } finally {
                        button.disabled = false;
                    }
                });
                actions.append(button);
            }
            card.append(actions);
        }
        target.append(card);
    }
}

async function navigate() {
    window.scrollTo(0, 0);
    const version = ++viewVersion;
    const route = location.hash.slice(1);
    const articleId = /^post\/([1-9]\d*)$/.exec(route)?.[1];
    const page = articleId ? 'article' : route === 'signup' ? 'account'
        : ['board', 'submit', 'staff', 'account', 'forgot', 'profile'].includes(route) ? route : 'board';
    document.title = 'Student Voice | みんなのスクールブログ';
    showMessage('');
    for (const section of document.querySelectorAll('main > section')) {
        section.hidden = section.id !== page;
    }
    for (const link of document.querySelectorAll('nav a')) {
        if (link.hash === '#' + page) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    }
    // Clear previously displayed private data before requesting the current session.
    document.querySelector('#staff-posts').replaceChildren();
    document.querySelector('#staff-comments').replaceChildren();
    document.querySelector('#reset-code').textContent = '';
    document.querySelector('#suggestion-form').hidden = true;
    document.querySelector('#writing-workspace').hidden = true;
    document.querySelector('#student-session').hidden = true;
    document.querySelector('#student-forms').hidden = true;
    document.querySelector('#dashboard').hidden = true;
    for (const link of document.querySelectorAll('[data-staff-link]')) link.hidden = true;
    document.querySelector('#login-panel').hidden = false;
    document.querySelector('#article-content').replaceChildren();
    document.querySelector('#profile-content').hidden = true;
    document.querySelector('#profile-login').hidden = false;
    document.querySelector('#my-posts').replaceChildren();
    document.querySelector('#profile-name').textContent = '';
    document.querySelector('#profile-username').textContent = '';
    document.querySelector('#profile-bio').textContent = '';
    document.querySelector('#profile-joined').textContent = '';
    document.querySelector('#profile-avatar').src = iconSources.outline;
    document.querySelector('#profile-form').reset();
    document.querySelector('#student-login-panel').hidden = route === 'signup';
    document.querySelector('#signup-panel').hidden = route !== 'signup';
    for (const link of document.querySelectorAll('.auth-tabs a')) {
        if (link.hash === '#' + route || (!route && link.hash === '#account')) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    }
    try {
        const session = await api('/session');
        if (version !== viewVersion) return;
        csrf = session.csrf;
        signedIn = session.staff;
        for (const link of document.querySelectorAll('[data-staff-link]')) link.hidden = !session.staff;
        studentSignedIn = session.student;
        document.querySelector('#suggestion-form').hidden = !session.student;
        document.querySelector('#writing-workspace').hidden = !session.student;
        document.querySelector('#post-login').hidden = session.student;
        document.querySelector('#student-session').hidden = !session.student;
        document.querySelector('#student-forms').hidden = session.student;
        document.querySelector('#nav-login').hidden = session.student;
        document.querySelector('#nav-signup').hidden = session.student;
        document.querySelector('#nav-account').hidden = !session.student;
        if (page === 'profile' && session.student) {
            const profile = await api('/profile');
            if (version === viewVersion) renderProfile(profile);
        }
        if (page === 'board') {
            const posts = await api('/suggestions');
            if (version === viewVersion) { publicPosts = posts; renderBlog(); }
        }
        if (page === 'article') {
            const post = await api('/suggestions/' + articleId);
            const social = await api('/suggestions/' + articleId + '/social');
            if (version === viewVersion) renderArticle(post, social);
        }
        if (page === 'staff' && signedIn) {
            const posts = await api('/staff/suggestions');
            const comments = await api('/staff/comments');
            if (version !== viewVersion) return;
            document.querySelector('#login-panel').hidden = true;
            document.querySelector('#dashboard').hidden = false;
            renderPosts(document.querySelector('#staff-posts'), posts, true);
            renderStaffComments(comments);
        }
    } catch (error) {
        if (version === viewVersion) showMessage(error.message, true);
    }
}

function onForm(id, path, done) {
    document.querySelector(id).addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button[type="submit"], button:not([type])');
        button.disabled = true;
        try {
            const data = new FormData(form);
            const result = await api(typeof path === 'function' ? path(data) : path, ['#suggestion-form', '#profile-form'].includes(id) ? data : Object.fromEntries(data));
            form.reset();
            await done(result);
        } catch (error) {
            showMessage(error.message, true);
        } finally {
            button.disabled = false;
        }
    });
}

const message = document.querySelector('#suggestion-form textarea');
const count = document.querySelector('#count');
message.addEventListener('input', () => {
    count.textContent = message.value.length + ' / 5000';
    document.querySelector('#writing-progress').value = message.value.length;
});
for (const button of document.querySelectorAll('.writing-prompts button')) {
    button.addEventListener('click', () => {
        const form = document.querySelector('#suggestion-form');
        form.elements.category.value = button.dataset.category;
        form.elements.category.dispatchEvent(new Event('change', { bubbles: true }));
        message.placeholder = button.dataset.prompt;
        for (const option of document.querySelectorAll('.writing-prompts button')) {
            option.setAttribute('aria-pressed', String(option === button));
        }
        message.focus();
    });
}

const successDialog = document.querySelector('#post-success');
document.querySelector('#success-close').addEventListener('click', () => successDialog.close());
document.querySelector('#success-profile').addEventListener('click', () => successDialog.close());

onForm('#suggestion-form', '/suggestions', async result => {
    count.textContent = '0 / 5000';
    document.querySelector('#writing-progress').value = 0;
    updateCoverPreview();
    showMessage('');
    // Native dialog keeps keyboard focus inside and supports Escape to close.
    successDialog.showModal();
});
onForm('#login-form', '/login', async result => {
    csrf = result.csrf;
    await navigate();
    showMessage('ログインしました。');
});

async function studentLoggedIn(result) {
    csrf = result.csrf;
    location.hash = 'submit';
    await navigate();
}
onForm('#student-login-form', data => String(data.get('email') || '').includes('@') ? '/student/email-login' : '/student/login', async result => {
    await studentLoggedIn(result);
    showMessage('おかえりなさい！今日の発見を、あなたの言葉でつづってみよう。');
});
onForm('#signup-form', '/signup', async result => {
    location.hash = 'account';
    await navigate();
    showMessage(result.message);
});
onForm('#email-reset-form', '/student/request-password-reset', async result => showMessage(result.message));
document.querySelector('#resend-verification').addEventListener('click', async event => {
    const button = event.currentTarget;
    const form = document.querySelector('#student-login-form');
    if (!form.reportValidity()) return;
    button.disabled = true;
    try {
        const result = await api('/student/resend-verification', Object.fromEntries(new FormData(form)));
        showMessage(result.message);
    } catch (error) { showMessage(error.message, true); }
    finally { button.disabled = false; }
});
onForm('#reset-form', '/student/reset', async result => {
    await navigate();
    showMessage(result.message);
});
onForm('#reset-code-form', '/staff/reset-code', async result => {
    document.querySelector('#reset-code').textContent = result.code + ' — ' + result.message;
    showMessage('再設定コードを発行しました。画面に表示されたコードを生徒に渡してください。');
});
onForm('#profile-form', '/profile', async result => {
    await navigate();
    showMessage(result.message);
});

document.querySelector('#profile-logout').addEventListener('click', async () => {
    try {
        await api('/logout', {});
        await navigate();
        showMessage('ログアウトしました。');
    } catch (error) { showMessage(error.message, true); }
});

function renderProfile(profile) {
    document.querySelector('#profile-login').hidden = true;
    document.querySelector('#profile-content').hidden = false;
    document.querySelector('#profile-name').textContent = profile.display_name || profile.username;
    document.querySelector('#profile-username').textContent = profile.email || '@' + profile.username;
    document.querySelector('#profile-bio').textContent = profile.bio || '自己紹介を追加してみましょう。';
    document.querySelector('#profile-joined').textContent = '登録日 ' + new Intl.DateTimeFormat('ja-JP').format(new Date(profile.created_at));
    document.querySelector('#profile-avatar').src = profile.has_avatar ? '/api/profile/avatar?v=' + Date.now() : iconSources.outline;
    const form = document.querySelector('#profile-form');
    form.elements.display_name.value = profile.display_name;
    form.elements.bio.value = profile.bio;
    const posts = document.querySelector('#my-posts');
    document.querySelector('#my-post-count').textContent = profile.posts.length + ' 件の記事';
    document.querySelector('#stat-total').textContent = profile.posts.length;
    document.querySelector('#stat-published').textContent = profile.posts.filter(post => post.status === 'published').length;
    document.querySelector('#stat-pending').textContent = profile.posts.filter(post => post.status === 'pending').length;
    if (!profile.posts.length) {
        const empty = element('div', '', 'profile-empty');
        empty.append(element('h3', 'まだ白紙。でも、可能性はいっぱい。'), element('p', '今日の小さな発見から、最初の物語を始めてみよう。'));
        const link = element('a', '最初の記事を書く ↗', 'button');
        link.href = '#submit';
        empty.append(link);
        posts.append(empty);
    }
    for (const post of profile.posts) {
        const card = element('article', '', 'panel');
        card.append(element('span', statuses[post.status], 'tag'), element('h2', post.title), element('p', post.body, 'excerpt'));
        if (post.status === 'published') {
            const link = element('a', '記事を見る ↗', 'read-link');
            link.href = '#post/' + post.id;
            card.append(link);
        }
        posts.append(card);
    }
}
document.querySelector('#student-logout').addEventListener('click', async () => {
    try {
        await api('/logout', {});
        await navigate();
        showMessage('ログアウトしました。');
    } catch (error) {
        showMessage(error.message, true);
    }
});
document.querySelector('#logout').addEventListener('click', async () => {
    try {
        await api('/logout', {});
        signedIn = false;
        await navigate();
        showMessage('ログアウトしました。');
    } catch (error) {
        showMessage(error.message, true);
    }
});
function renderStaffComments(comments) {
    const target = document.querySelector('#staff-comments');
    if (!comments.length) target.append(element('p', 'コメントはまだありません。', 'panel'));
    for (const comment of comments) {
        const card = element('article', '', 'panel');
        card.append(element('span', comment.hidden ? '非公開' : '公開中', 'tag'),
            element('h3', comment.title), element('strong', comment.username), element('p', comment.body, 'body'));
        const button = element('button', comment.hidden ? 'コメントを公開する' : 'コメントを非公開にする', 'secondary');
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                await api('/staff/comments/' + comment.id, { hidden: !comment.hidden });
                await navigate();
                showMessage('コメントの公開状態を変更しました。');
            } catch (error) { showMessage(error.message, true); button.disabled = false; }
        });
        card.append(button);
        target.append(card);
    }
}

let previewUrl = null;
function updateCoverPreview() {
    const form = document.querySelector('#suggestion-form');
    const upload = form.elements.cover_mode.value === 'upload';
    const input = document.querySelector('#post-image');
    const preview = document.querySelector('#cover-preview');
    input.disabled = !upload;
    input.required = upload;
    form.elements.cover_icon.disabled = upload;
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    if (upload && input.files[0]) {
        if (input.files[0].size > 3 * 1024 * 1024) {
            input.value = '';
            showMessage('画像は3MBまでです。', true);
        } else {
            previewUrl = URL.createObjectURL(input.files[0]);
        }
    }
    preview.src = previewUrl || (form.elements.cover_icon.value === 'color' ? iconSources.color : topicThumbnail({ category: form.elements.category.value, title: form.elements.title.value }));
    preview.hidden = upload && !previewUrl;
}
document.querySelector('.cover-picker').addEventListener('change', updateCoverPreview);
document.querySelector('#suggestion-form select[name="category"]').addEventListener('change', updateCoverPreview);
document.querySelector('#suggestion-form input[name="title"]').addEventListener('input', () => {
    if (document.querySelector('#suggestion-form').elements.cover_mode.value === 'icon') updateCoverPreview();
});
updateCoverPreview();
window.addEventListener('hashchange', navigate);
navigate();

// A deliberate toggle helps students check typing without exposing it by default.
for (const toggle of document.querySelectorAll('.password-toggle')) {
    toggle.addEventListener('click', () => {
        const input = document.getElementById(toggle.getAttribute('aria-controls'));
        const showing = input.type === 'password';
        input.type = showing ? 'text' : 'password';
        toggle.textContent = showing ? '隠す' : '表示';
        toggle.setAttribute('aria-pressed', String(showing));
    });
}

// Native dialogs support keyboard focus, Escape and an explicit close button.
document.querySelector('#feedback-close').addEventListener('click', () => {
    document.querySelector('#feedback-dialog').close();
});
