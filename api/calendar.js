const crypto = require('crypto');

// サービスアカウント情報 (api/sheets.js と同一の大本の認証キーを使用)
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

// Google Auth JWTトークン生成
function getGoogleAuthToken() {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: CLIENT_EMAIL,
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
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
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { formId, qId } = req.query;
    if (!formId || !qId) {
        return res.status(400).json({ error: 'formId と qId は必須項目です。' });
    }

    try {
        // 1. Supabaseからフォームデータと秘密情報を取得する
        // Serverless APIのため直接 Supabase REST API を呼び出します
        const supabaseUrl = 'https://xztaacxjlluzqzehendp.supabase.co';
        // state.js と同じパブリックキーを使用
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

        // 秘密情報（カレンダーID）取得
        const secretsFetch = await fetch(`${supabaseUrl}/rest/v1/customers?service_type=eq.meo_form_secrets`, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
        });
        const secretsRes = await secretsFetch.json();
        if (!secretsRes || secretsRes.length === 0) {
            return res.status(500).json({ error: '管理者用カレンダー連携設定がされていません。' });
        }
        const secretsData = secretsRes[0].data;
        const googleCalendarId = secretsData.googleCalendarId;

        if (!googleCalendarId) {
            return res.status(500).json({ error: 'GoogleカレンダーIDが設定されていません。' });
        }

        // 質問定義の特定
        const question = (formData.questions || []).find(q => q.id === qId);
        if (!question) {
            return res.status(404).json({ error: '質問定義が見つかりません。' });
        }

        const duration = parseInt(question.duration || 30);
        const startHour = question.startHour || '09:00';
        const endHour = question.endHour || '18:00';

        // 2. Google OAuth トークンを取得
        const accessToken = await getAccessToken();

        // 3. Google カレンダーの既存予定を取得 (今日から14日後まで)
        const now = new Date();
        const timeMin = now.toISOString();
        const timeMax = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

        const eventsRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(googleCalendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );
        const eventsData = await eventsRes.json();
        if (eventsData.error) {
            return res.status(500).json({ error: 'カレンダーの同期に失敗しました: ' + eventsData.error.message });
        }

        // 予定の開始・終了時刻を解析
        const busyPeriods = (eventsData.items || []).map(event => {
            return {
                start: new Date(event.start.dateTime || event.start.date),
                end: new Date(event.end.dateTime || event.end.date)
            };
        });

        // 4. 空きスロットを生成・判定
        const availableSlots = {};

        for (let i = 1; i <= 14; i++) {
            const targetDate = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
            
            // 土日は除外（必要に応じて設定変更できるように）
            const dayOfWeek = targetDate.getDay();
            if (dayOfWeek === 0 || dayOfWeek === 6) continue;

            const dateStr = targetDate.toISOString().slice(0, 10);
            const slots = [];

            // スロット生成のループ
            const [startH, startM] = startHour.split(':').map(Number);
            const [endH, endM] = endHour.split(':').map(Number);

            const startTime = new Date(targetDate.getTime());
            startTime.setHours(startH, startM, 0, 0);

            const endTime = new Date(targetDate.getTime());
            endTime.setHours(endH, endM, 0, 0);

            let slotStart = new Date(startTime.getTime());
            while (slotStart.getTime() + duration * 60 * 1000 <= endTime.getTime()) {
                const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);
                
                // すでに過ぎている時間は除外
                if (slotStart.getTime() > Date.now()) {
                    // 重複チェック
                    const isBusy = busyPeriods.some(busy => {
                        return (slotStart.getTime() < busy.end.getTime() && slotEnd.getTime() > busy.start.getTime());
                    });

                    if (!isBusy) {
                        const timeStr = slotStart.toTimeString().slice(0, 5); // "HH:MM"
                        slots.push(timeStr);
                    }
                }

                // 次のスロットへ
                slotStart = new Date(slotStart.getTime() + duration * 60 * 1000);
            }

            if (slots.length > 0) {
                availableSlots[dateStr] = slots;
            }
        }

        res.status(200).json({ availableSlots });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
};
