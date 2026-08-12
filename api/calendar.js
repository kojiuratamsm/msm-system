const { getAccessToken } = require('../lib/googleAuth');

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
            return res.status(500).json({ error: '管理者用カレンダー連携設定がされていません。' });
        }
        const secretsData = secretsRes[0].data;
        const googleCalendarId = secretsData.googleCalendarId;

        if (!googleCalendarId) {
            return res.status(500).json({ error: 'GoogleカレンダーIDが設定されていません。' });
        }

        const question = (formData.questions || []).find(q => q.id === qId);
        if (!question) {
            return res.status(404).json({ error: '質問定義が見つかりません。' });
        }

        const duration = parseInt(question.duration || 30);
        const startHour = question.startHour || '09:00';
        const endHour = question.endHour || '18:00';

        // 2. Google API アクセストークン取得(サービスアカウントの秘密鍵は環境変数から読み込む)
        const accessToken = await getAccessToken('https://www.googleapis.com/auth/calendar.readonly');

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

        const busyPeriods = (eventsData.items || []).map(event => {
            return {
                start: new Date(event.start.dateTime || event.start.date),
                end: new Date(event.end.dateTime || event.end.date)
            };
        });

        const availableSlots = {};

        for (let i = 1; i <= 14; i++) {
            const targetDate = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
            const dayOfWeek = targetDate.getDay();
            if (dayOfWeek === 0 || dayOfWeek === 6) continue;

            const dateStr = targetDate.toISOString().slice(0, 10);
            const slots = [];

            const [startH, startM] = startHour.split(':').map(Number);
            const [endH, endM] = endHour.split(':').map(Number);

            const startTime = new Date(targetDate.getTime());
            startTime.setHours(startH, startM, 0, 0);

            const endTime = new Date(targetDate.getTime());
            endTime.setHours(endH, endM, 0, 0);

            let slotStart = new Date(startTime.getTime());
            while (slotStart.getTime() + duration * 60 * 1000 <= endTime.getTime()) {
                const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);

                if (slotStart.getTime() > Date.now()) {
                    const isBusy = busyPeriods.some(busy => {
                        return (slotStart.getTime() < busy.end.getTime() && slotEnd.getTime() > busy.start.getTime());
                    });

                    if (!isBusy) {
                        const timeStr = slotStart.toTimeString().slice(0, 5);
                        slots.push(timeStr);
                    }
                }

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
