module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { type, ref, answers, formData } = req.body;
    if (!type) {
        return res.status(400).json({ error: 'パラメータが不足しています。' });
    }

    try {
        const supabaseUrl = 'https://xztaacxjlluzqzehendp.supabase.co';
        const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dGFhY3hqbGx1enF6ZWhlbmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzM4NzMsImV4cCI6MjA4OTgwOTg3M30.79wvIPepXjvPZwLHOPX7KullShvdvCB7LS2gZO5CtuQ';

        // 秘密情報の取得
        const secretsFetch = await fetch(`${supabaseUrl}/rest/v1/customers?service_type=eq.meo_form_secrets`, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
        });
        const secretsRes = await secretsFetch.json();
        const secretsData = (secretsRes && secretsRes.length > 0) ? secretsRes[0].data : {};
        
        const cwToken = secretsData.chatworkApiKey;
        const cwRoomId = secretsData.chatworkRoomId;

        if (!cwToken || !cwRoomId) {
            return res.status(200).json({ success: false, error: 'Chatwork連携が設定されていません。' });
        }

        const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
        let message = '';

        if (type === 'access') {
            message = `診断フォームにアクセスがありました。\n日時: ${now}\n場所: ${formData?.title || '分析フォーム'}\n登録経路: ${ref || '不明'}`;
        } else if (type === 'submit') {
            message = `診断フォームの受付が完了しました。\n日時: ${now}\n場所: ${formData?.title || '分析フォーム'}\n登録経路: ${ref || '不明'}\n\n`;
            
            if (formData && formData.questions && answers) {
                formData.questions.forEach((q, idx) => {
                    const ans = answers[q.id];
                    const ansStr = Array.isArray(ans) ? ans.join(', ') : (ans || '-');
                    message += `Q. ${q.title}\nA. ${ansStr}\n\n`;
                });
            }
        }

        const params = new URLSearchParams();
        params.append('body', message);

        const cwRes = await fetch(`https://api.chatwork.com/v2/rooms/${cwRoomId}/messages`, {
            method: 'POST',
            headers: {
                'X-ChatWorkToken': cwToken,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        });

        if (!cwRes.ok) {
            throw new Error(`Chatwork API Error: ${cwRes.status}`);
        }

        return res.status(200).json({ success: true });
    } catch (e) {
        console.error('Chatwork API Error:', e);
        return res.status(500).json({ error: 'Chatwork通知に失敗しました。' });
    }
};
