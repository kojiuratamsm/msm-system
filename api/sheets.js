const { getAccessToken } = require('../lib/googleAuth');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { id, tab } = req.query;
        if (!id || !tab) throw new Error("Missing id or tab parameter");

        // Google API アクセストークン取得(サービスアカウントの秘密鍵は環境変数から読み込む)
        const accessToken = await getAccessToken('https://www.googleapis.com/auth/spreadsheets.readonly');

        // スプレッドシート値を取得
        const range = `${encodeURIComponent(tab)}!A:R`;
        const sheetRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!sheetRes.ok) {
            const errBody = await sheetRes.text();
            throw new Error(`Sheets API responded with ${sheetRes.status}: ${errBody}`);
        }

        const sheetData = await sheetRes.json();
        res.status(200).json({ values: sheetData.values || [] });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
};
