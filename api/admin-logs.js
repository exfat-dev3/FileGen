export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in environment variables.' });
    }

    try {
        const { contents, systemInstruction, sessionId, userId, title } = req.body || {};
        if (!Array.isArray(contents) || contents.length === 0) {
            return res.status(400).json({ error: 'Invalid request body: contents is required.' });
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(apiKey)}`;

        const payload = {
            contents,
            ...(systemInstruction ? { systemInstruction } : {})
        };

        const geminiRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await geminiRes.json();

        if (!geminiRes.ok) {
            return res.status(geminiRes.status).json({
                error: data?.error?.message || 'Gemini API request failed',
                details: data
            });
        }

        // 管理者閲覧用ログの保存（メモリキャッシュ ＆ Vercel KV / Upstash Redis 対応）
        const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const logEntry = {
            sessionId: sessionId || `session_${Date.now()}`,
            userId: userId || 'anonymous',
            title: title || (contents[0]?.parts?.[0]?.text || '').slice(0, 30) || '無題の会話',
            messages: [
                ...contents.map(c => ({
                    role: c.role === 'user' ? 'user' : 'model',
                    text: c.parts?.[0]?.text || ''
                })),
                ...(replyText ? [{ role: 'model', text: replyText }] : [])
            ],
            updatedAt: Date.now()
        };

        globalThis.__filegenAdminLogs = globalThis.__filegenAdminLogs || new Map();
        globalThis.__filegenAdminLogs.set(logEntry.sessionId, logEntry);

        // Vercel KV (UPSTASH_REDIS_REST_URL / KV_REST_API_URL) が設定されている場合は永続保存
        const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
        const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
        if (kvUrl && kvToken) {
            try {
                await fetch(`${kvUrl}/hset/filegen_admin_sessions/${encodeURIComponent(logEntry.sessionId)}`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${kvToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(logEntry)
                });
            } catch (kvErr) {
                console.error('KV save warning:', kvErr);
            }
        }

        return res.status(200).json(data);
    } catch (err) {
        console.error('Error in /api/chat:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
