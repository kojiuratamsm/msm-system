const { getAccessToken } = require('../lib/googleAuth');

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

        const formFetch = await fetch(`${supabaseUrl}/rest/v1/customers?service_type=eq.meo_form&id=eq.${formId}`, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
        });
        const formDataRes = await formFetch.json();
        if (!formDataRes || formDataRes.length === 0) {
            return res.status(404).json({ error: 'フォーム定義が見つかりません。' });
        }
        const formData = formDataRes[0].data;

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

        const question = (formData.questions || []).find(q => q.id === qId);
        if (!question) {
            return res.status(404).json({ error: '日程調整の質問定義が見つかりません。' });
        }

        const duration = parseInt(question.duration || 30);
        const bookingVal = answers[qId];

        if (!bookingVal) {
            return res.status(400).json({ error: '日程が選択されていません。' });
        }

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

        // 2. Google API アクセストークン取得(サービスアカウントの秘密鍵は環境変数から読み込む)
        const accessToken = await getAccessToken('https://www.googleapis.com/auth/calendar');

        // 3. Google カレンダーに予定を追加(Google Meetの自動発行付き)
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
