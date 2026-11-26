export default async function handler(req, res) {
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234';
    const providedPassword =
        req.headers['x-admin-password'] ||
        (req.body && req.body.password) ||
        (req.query && req.query.password);

    if (!providedPassword || providedPassword !== adminPassword) {
        return res.status(401).json({ error: '管理者パスワードが正しくありません。' });
    }

    try {
        const sessionMap = new Map();

        // 1. サーバーメモリ内のログを取得
        if (globalThis.__filegenAdminLogs instanceof Map) {
            for (const [id, entry] of globalThis.__filegenAdminLogs.entries()) {
                sessionMap.set(id, entry);
            }
        }

        // 2. Vercel KV / Upstash Redis が設定されていれば永続ログを取得して統合
        const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
        const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
        if (kvUrl && kvToken) {
            try {
                const kvRes = await fetch(`${kvUrl}/hgetall/filegen_admin_sessions`, {
                    headers: { Authorization: `Bearer ${kvToken}` }
                });
                if (kvRes.ok) {
                    const kvData = await kvRes.json();
                    const result = kvData.result;
                    if (Array.isArray(result)) {
                        for (let i = 0; i < result.length; i += 2) {
                            const key = result[i];
                            const val = typeof result[i + 1] === 'string' ? JSON.parse(result[i + 1]) : result[i + 1];
                            if (val) sessionMap.set(key, val);
                        }
                    } else if (result && typeof result === 'object') {
                        for (const [key, rawVal] of Object.entries(result)) {
                            const val = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
                            if (val) sessionMap.set(key, val);
                        }
                    }
                }
            } catch (kvErr) {
                console.error('KV read warning:', kvErr);
            }
        }

        const sessions = Array.from(sessionMap.values()).sort(
            (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
        );

        return res.status(200).json({
            sessions,
            storageMode: kvUrl && kvToken ? 'Vercel KV (永続保存)' : 'サーバーメモリ (一時保存)'
        });
    } catch (err) {
        console.error('Error in /api/admin-logs:', err);
        return res.status(500).json({ error: 'ログの取得中にエラーが発生しました。' });
    }
}
