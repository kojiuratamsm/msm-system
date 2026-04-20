module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // セキュリティのため、アクセストークンはVercelの環境変数から取得します
        const token = process.env.LINE_ACCESS_TOKEN;
        if (!token) throw new Error('サーバーにLINE_ACCESS_TOKENが設定されていません');

        // LINE API規定により、統計データは「前日」のものを取得します
        const offset = 9 * 60 * 60000; // JST (UTC+9)
        const yesterday = new Date(Date.now() - offset - 24 * 60 * 60000);
        const dateStr = yesterday.toISOString().slice(0, 10).replace(/-/g, '');

        const insightRes = await fetch(`https://api.line.me/v2/bot/insight/followers?date=${dateStr}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const insightData = await insightRes.json();

        // エラーレスポンスの処理
        if (insightData.message && insightData.details) {
             return res.status(400).json({ error: insightData.message, detail: insightData.details[0]?.message });
        }

        res.status(200).json({
            status: insightData.status,
            followers: insightData.followers,
            targetedReaches: insightData.targetedReaches,
            blocks: insightData.blocks,
            date: dateStr
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
};
