import { db } from './database.js';
import { sendImage } from './media.js';
import { hasStaffSession } from './security.js';

const reactionKinds = ['like', 'love', 'haha', 'wow', 'sad', 'care'];

function postId(value) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 1) {
        const error = new Error('Article not found');
        error.status = 404;
        throw error;
    }
    return id;
}

// Lock the article so publishing/hiding and social writes stay consistent.
async function withPublishedPost(id, action) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [posts] = await connection.execute("SELECT id FROM suggestions WHERE id = ? AND status = 'published' AND archived = 0 FOR UPDATE", [id]);
        if (!posts.length) {
            const error = new Error('Article not found');
            error.status = 404;
            throw error;
        }
        await action(connection);
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

export function registerSocialRoutes(app, requireStudent, requireStaff, socialLimit) {
    app.get('/api/suggestions/:id/image', async (req, res, next) => {
        const id = postId(req.params.id);
        const [rows] = await db.execute('SELECT image_name, status, archived FROM suggestions WHERE id = ?', [id]);
        const post = rows[0];
        if (!post || ((post.archived || post.status !== 'published') && !await hasStaffSession(req))
            || !/^[a-f0-9]{32}\.webp$/.test(post.image_name || '')) {
            return res.status(404).end();
        }
        await sendImage(res, post.image_name, next);
    });

    app.get('/api/suggestions/:id/social', async (req, res) => {
        const id = postId(req.params.id);
        const [posts] = await db.execute("SELECT id FROM suggestions WHERE id = ? AND status = 'published' AND archived = 0", [id]);
        if (!posts.length) return res.status(404).json({ error: '記事が見つかりません。' });
        const [counts] = await db.execute('SELECT kind, COUNT(*) AS total FROM reactions WHERE post_id = ? GROUP BY kind', [id]);
        const [mine] = await db.execute('SELECT kind FROM reactions WHERE post_id = ? AND student_id = ?', [id, req.session.studentId || 0]);
        const [comments] = await db.execute(
            'SELECT c.id, c.body, c.created_at, s.username FROM comments c JOIN students s ON s.id = c.student_id WHERE c.post_id = ? AND c.hidden = 0 AND c.archived = 0 ORDER BY c.id DESC LIMIT 50', [id]);
        const [total] = await db.execute('SELECT COUNT(*) AS total FROM comments WHERE post_id = ? AND hidden = 0 AND archived = 0', [id]);
        res.json({ reactions: counts, mine: mine[0]?.kind || null, comments: comments.reverse(), commentCount: total[0].total });
    });

    app.post('/api/suggestions/:id/reaction', requireStudent, socialLimit, async (req, res) => {
        const id = postId(req.params.id);
        const kind = req.body?.kind;
        if (kind !== null && !reactionKinds.includes(kind)) return res.status(400).json({ error: 'リアクションを選んでください。' });
        await withPublishedPost(id, async connection => {
            if (kind === null) {
                await connection.execute('DELETE FROM reactions WHERE post_id = ? AND student_id = ?', [id, req.session.studentId]);
            } else {
                await connection.execute('INSERT INTO reactions (post_id, student_id, kind) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE kind = ?',
                    [id, req.session.studentId, kind, kind]);
            }
        });
        res.json({ message: 'リアクションを更新しました。' });
    });

    app.post('/api/suggestions/:id/comments', requireStudent, socialLimit, async (req, res) => {
        const id = postId(req.params.id);
        const body = req.body?.body;
        if (typeof body !== 'string' || !body.trim() || body.trim().length > 500) {
            return res.status(400).json({ error: 'コメントは1〜500文字で入力してください。' });
        }
        await withPublishedPost(id, connection => connection.execute(
            'INSERT INTO comments (post_id, student_id, body) VALUES (?, ?, ?)', [id, req.session.studentId, body.trim()]));
        res.status(201).json({ message: 'コメントを投稿しました。' });
    });

    app.get('/api/staff/comments', requireStaff, async (req, res) => {
        const before = Number(req.query.before ?? 4294967296);
        if (!Number.isSafeInteger(before) || before < 1 || before > 4294967296) return res.status(400).json({ error: 'ページを確認してください。' });
        const [rows] = await db.execute(
            'SELECT c.id, c.body, c.hidden, c.archived, s.username, p.title FROM comments c JOIN students s ON s.id = c.student_id JOIN suggestions p ON p.id = c.post_id WHERE c.id < ? ORDER BY c.id DESC LIMIT 100', [before]);
        res.json(rows);
    });

    app.post('/api/staff/comments/:id/:action', requireStaff, async (req, res) => {
        const id = postId(req.params.id);
        const action = req.params.action;
        if (!['archive', 'restore'].includes(action)) return res.status(400).json({ error: '入力内容を確認してください。' });
        const archived = action === 'archive';
        const [result] = await db.execute('UPDATE comments SET archived = ?, hidden = 1 WHERE id = ? AND archived = ?', [archived, id, !archived]);
        if (!result.affectedRows) return res.status(409).json({ error: 'コメントが見つからないか、状態が変わりました。' });
        req.moderationEvent = '/api/staff/comments/' + id + '/' + action;
        res.json({ message: archived ? 'コメントをゴミ箱に移動しました。' : 'コメントを非公開の状態で復元しました。' });
    });

    app.post('/api/staff/comments/:id', requireStaff, async (req, res) => {
        const id = postId(req.params.id);
        const hidden = req.body?.hidden;
        if (typeof hidden !== 'boolean') return res.status(400).json({ error: '入力内容を確認してください。' });
        const [result] = await db.execute('UPDATE comments SET hidden = ? WHERE id = ? AND archived = 0', [hidden, id]);
        if (!result.affectedRows) return res.status(404).json({ error: 'コメントが見つかりません。' });
        res.json({ message: 'コメントの公開状態を変更しました。' });
    });
}
