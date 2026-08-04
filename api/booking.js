const crypto = require('crypto');

// サービスアカウント情報 (Google カレンダー書き込み権限が必要)
const rawKey = [
  "-----BEGIN PRIVATE KEY-----",
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDC/er6UCuECphg",
  "/dY88rp5GFgRBgaSO2EuS0jJGDCo+diUBblCNdj7eUEhCcXlQMeT6MopXqfvBt6D",
  "NK1nhrhnj5m96VSoDEvc38K5EiWf+adEdvxZkfGivrIf+2mGaS2jimZDqc3smvGV",
  "xeKs9TvLjiqJKQkGnpmrjviBZLLKWSTDjXseDtiqKofroGxbn9yFtBif1Zs+p19z",
  "T2RvnODulAbiElcG5fHswRDkFLR6rFycfvtHuMaGatlD0gTsqpftk6Pg69VejLLa",
  "ruSBYIO3IVay9HEkdIJWym+17ZOnl/NIvCImPETXTJx2Lk+HB6ixnvkjCIvG47Vl",
  "RuDnxHhHAgMBAAECggEAD3cwQfZF3U0x1M+NRHxECgLCSWde8g4/oPpbpYeDpINc",
  "iDEEBppawWdWoRYzWgGPUs3t6uYVD8JNt75f2ow26A/ds9Bj5IhFJBmjSiaEUXHt",
  "sGJ3lWsb7TqOyjaYog6JjiUWA1ved1u6uZRebDVvLq/x87sLejjuG0tVrn2cKKxR",
  "l/6ERQrdnOjU4RUHfptgBh9rVmQric4Z2QDTaxdy8qYRmJ3pD9h+0nkq/lMIuJw6",
  "SNfEAYC1+t7lE/IllkOcW+5iboAhxpqWggXM5TR3Hv1q0EH/RO7sWSooSS4BrVtJ",
  "DINvIa2r3t+gssyCyT7xq+upMcUoP0vWTyGDyv1RMQKBgQD/xo2hLmrsnC253CZi",
  "HEV5IrQ6lTxX5iyJWWwXx127vNh+x8QD9l+dYqLpo6osxmO3PX4c1hfRkNuoMjO+",
  "W44WnZf7io42jRR/ksar+AHyVGuiOoxkLWCNLOIXrDvAUWavqcS8lqGF4UE9F37e",
  "eQ/ngAydNbRFGLWFvhfiziWI5QKBgQDDKbZ0zITDlRtZo21nWOuLmWYJr5wGRvb2",
  "c/tQAqBcvj28X0ekb+TbVmf0pd6Cy/m0MRmmI2KIoWXTDxhwHQUhTE1LtE5wF+Dy",
  "7kHomqNnJ/pFLpcoGuwZzRiiu6svEi4w0UablRS131DV8TFh/wJY8EyqQxrZnoPN",
  "NFeHYikFuwKBgESoT6xMgXcyFTQm3EbJv/xcTHTNSn1t09aqolFfutGCR7sAdKV7",
  "pP7iU0jUHgIW3v15DDlBXvNqJwxnLWyTtvhrJTjoYHRUOoRkKeBPmnYqIxpRDQ52",
  "/8vlmGsyWHevYhkVQTI+XO1LIe/8NpoRdSt3O+uXVuSVVWSpOlAvdfPhAoGAGyJ5",
  "k9O7wdXBb70hQPVECqzRWxdnghfrzmhh0MYMtdhdjQtSUrKcB0MEQSeuwFDL7xnE",
  "jyzsTkLifW3j3/Ko+/A37waqwTsQs7Ycw9J8VaNhUK0hpxnXKd8yRa4CJxFICtGO",
  "F6OqtX7PJm/ahd2G3gbLIgEigo9fk/BrGw+y1HECgYEA2+a10V3TgI8zT28oVkOD",
  "RqWlT8vDJkRoMfg0trDZA/dLCN25WoYY3FsZlaeyafpkb6twsYzqumRU4HmxCxBa",
  "aO7mo+H7hsDlj2WR0gmKythdkhLRWhHAM4BcSNL6LvFjRqyweAsgEt5sI6W7sgj/",
  "/Ahtrk6IZagRBT3CCJppGss=",
  "-----END PRIVATE KEY-----\n"
].join("\n");

const CLIENT_EMAIL = "msm-sheet-bot@meo-dashbord-492610.iam.gserviceaccount.com";

// Google Auth JWTトークン生成 (書き込み権限スコープに変更)
function getGoogleAuthToken() {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: CLIENT_EMAIL,
        scope: 'https://www.googleapis.com/auth/calendar',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
    };
    const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const signatureInput = `${b64(header)}.${b64(payload)}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signatureInput);
    const signature = sign.sign(rawKey, 'base64url');
    return `${signatureInput}.${signature}`;
}

async function getAccessToken() {
    const jwt = getGoogleAuthToken();
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt
        })
    });
    const data = await tokenRes.json();
    return data.access_token;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { formId, qId, answers, responseId } = req.body;
    if (!formId || !qId || !answers || !responseId) {
        return res.status(400).json({ error: 'パラメータが不足しています。' });
    }

    try {
        // 1. Supabaseからフォームデータと秘密情報を取得する
        const supabaseUrl = 'https://xztaacxjlluzqzehendp.supabase.co';
        const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dGFhY3hqbGx1enF6ZWhlbmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzM4NzMsImV4cCI6MjA4OTgwOTg3M30.79wvIPepXjvPZwLHOPX7KullShvdvCB7LS2gZO5CtuQ';

        // フォームデータ取得
        const formFetch = await fetch(`${supabaseUrl}/rest/v1/customers?service_type=eq.meo_form&id=eq.${formId}`, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
        });
        const formDataRes = await formFetch.json();
        if (!formDataRes || formDataRes.length === 0) {
            return res.status(404).json({ error: 'フォーム定義が見つかりません。' });
        }
        const formData = formDataRes[0].data;

        // 秘密情報（UTAGE API / カレンダーID）取得
        const secretsFetch = await fetch(`${supabaseUrl}/rest/v1/customers?service_type=eq.meo_form_secrets`, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
        });
        const secretsRes = await secretsFetch.json();
        if (!secretsRes || secretsRes.length === 0) {
            return res.status(500).json({ error: '外部システム連携設定がされていません。' });
        }
        const secretsData = secretsRes[0].data;

        const googleCalendarId = secretsData.googleCalendarId;
        const utageApiKey = secretsData.utageApiKey;
        const utageScenarioId = secretsData.utageScenarioId;

        // 質問定義の特定
        const question = (formData.questions || []).find(q => q.id === qId);
        if (!question) {
            return res.status(404).json({ error: '日程調整の質問定義が見つかりません。' });
        }

        const duration = parseInt(question.duration || 30);
        const bookingVal = answers[qId]; // "2026-08-10 14:00"

        if (!bookingVal) {
            return res.status(400).json({ error: '日程が選択されていません。' });
        }

        // 回答データからメールアドレス・お名前を動的に抽出
        let email = '';
        let name = '';
        let desc = '【フォーム回答内容】\n';

        formData.questions.forEach((q, idx) => {
            const ans = answers[q.id];
            const ansStr = Array.isArray(ans) ? ans.join(', ') : (ans || '-');
            desc += `Q${idx+1}. ${q.title}: ${ansStr}\n`;

            const title = q.title || '';
            if (title.includes('メール') || title.toLowerCase().includes('email') || title.toLowerCase().includes('mail')) {
                email = ans;
            }
            if (title.includes('名') || title.includes('氏名') || title.toLowerCase().includes('name')) {
                if (!name) name = ans;
            }
        });

        // 2. Google OAuth トークンを取得
        const accessToken = await getAccessToken();

        // 3. Google カレンダーに予定を追加（Google Meetの自動発行付き）
        const startDateTime = new Date(bookingVal.replace(' ', 'T') + ':00+09:00');
        const endDateTime = new Date(startDateTime.getTime() + duration * 60 * 1000);

        const eventBody = {
            summary: `【面談予約】${name || '未入力'}様`,
            description: desc,
            start: { dateTime: startDateTime.toISOString(), timeZone: 'Asia/Tokyo' },
            end: { dateTime: endDateTime.toISOString(), timeZone: 'Asia/Tokyo' },
            attendees: email ? [{ email: email }] : [],
            conferenceData: {
                createRequest: {
                    requestId: `meet-${Date.now()}`,
                    conferenceSolutionKey: { type: 'hangoutsMeet' }
                }
            }
        };

        const calRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(googleCalendarId)}/events?conferenceDataVersion=1`,
            {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(eventBody)
            }
        );

        const calData = await calRes.json();
        let conferenceUrl = '';
        if (calData.conferenceData && calData.conferenceData.entryPoints) {
            const meetPoint = calData.conferenceData.entryPoints.find(ep => ep.entryPointType === 'video');
            if (meetPoint) conferenceUrl = meetPoint.uri;
        }

        // 4. UTAGE API 読者登録 (もし設定されていれば実行)
        let utageResult = null;
        if (utageApiKey && utageScenarioId && email) {
            try {
                // UTAGE 読者登録 API 連携
                const utagePayload = {
                    email: email,
                    name: name || '未入力',
                    scenario_id: utageScenarioId,
                    custom_fields: {
                        "面談希望日時": bookingVal,
                        "ミーティングURL": conferenceUrl || 'Googleカレンダーより配信'
                    }
                };

                const utageRes = await fetch('https://api.utage-system.com/v1/contacts', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${utageApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(utagePayload)
                });

                utageResult = await utageRes.json();
            } catch (utError) {
                console.error("UTAGE integration failed:", utError);
                // カレンダー登録が成功している場合は、全体をエラーにせず警告ログのみにする
            }
        }

        // 5. 最終的な回答データを Supabase に「完了」ステータスで確定保存
        const responseData = {
            id: responseId,
            formId: formId,
            answers: answers,
            submittedAt: new Date().toISOString(),
            status: 'completed',
            device: req.headers['user-agent'] || 'unknown',
            meetUrl: conferenceUrl || null
        };

        await fetch(`${supabaseUrl}/rest/v1/customers?service_type=eq.meo_form_response&id=eq.${responseId}`, {
            method: 'PATCH',
            headers: { 
                'apikey': supabaseKey, 
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({ data: responseData })
        });

        // 統計情報の 'submission' ログを記録
        const statId = Date.now() + Math.floor(Math.random() * 1000);
        const statData = { type: 'submission', detail: null, timestamp: new Date().toISOString() };
        await fetch(`${supabaseUrl}/rest/v1/customers`, {
            method: 'POST',
            headers: { 
                'apikey': supabaseKey, 
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ id: statId, service_type: 'meo_form_stats', data: statData })
        });

        res.status(200).json({ 
            success: true, 
            meetUrl: conferenceUrl,
            htmlLink: calData.htmlLink 
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
};
