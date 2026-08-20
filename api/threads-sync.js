// ============================================================================
// api/threads-sync.js
// Threads運用代行ページの「フォロワー数」「プロフィール閲覧数」を
// Threads公式APIから取得し、Supabase(customers / threads_insight_settings)に
// 保存するサーバーレス関数。
//
// 呼び出され方は2パターン:
//   1) Vercelのcron機能から毎朝9:00(JST)に自動実行される (GETリクエスト)
//      → vercel.json の "0 0 * * *"(UTC 0:00 = JST 9:00)で登録。
//        Vercel Hobbyプランはcronの実行が1日1回・時刻の前後±1時間程度ずれる
//        場合がある仕様のため、「だいたい9時ごろ」と考えてください。
//        出典: https://vercel.com/docs/cron-jobs/usage-and-pricing (本セッション内でWebFetch確認済み)
//   2) 管理画面インサイトタブの「今すぐ更新」ボタンから手動実行される (POSTリクエスト)
//      → 1日2回まで。UTC日付をそのまま「サイクル日」として使うことで、
//        UTC 0:00(= JST 9:00)に自動的にリセットされる仕組み。
//
// 【重要な注意・一次情報について】
// 取得できる指標(views, likes, replies, reposts, quotes, clicks,
// followers_count, follower_demographics / データは2024年4月13日以降のみ)は、
// 本セッション内でMeta公式ドキュメント(https://developers.facebook.com/docs/threads/insights/)
// をWebFetchで確認済みです。
// 一方、この関数が実際に投げるHTTPリクエストの形式(ホスト名 graph.threads.net、
// エンドポイントパス /v1.0/{threads-user-id}/threads_insights、パラメータ名
// metric / access_token)については、実装時点でMeta公式ドキュメントへの
// WebFetchアクセスが一時的なレート制限にかかっており、一次情報での再確認が
// できませんでした。そのため、公式ドキュメントと同じ内容を参照している
// 複数の第三者ライブラリ・解説記事(下記出典)で共通して使われている形式を
// もとに実装しています。
//   - https://github.com/spoolappio/threads-graph-api
//   - https://developers.facebook.com/docs/threads/reference/insights/
//   - https://www.ayrshare.com/blog/threads-api-integration-authorization-posting-analytics-with-ayrshare/
//   - https://creativewritingwizard.com/2024/08/13/a-guide-to-getting-threads-metrics-via-threads-api/
// 実際にAPIキーを取得し、初回の同期を行う際は、レスポンスやエラー内容を
// 必ず確認し、上記の公式ドキュメントと照合してください。もしパラメータ名や
// エンドポイントが異なっていた場合は、この関数の apiUrl の組み立て部分だけを
// 修正すれば動作するように設計しています。
// ============================================================================

const SUPABASE_URL = 'https://xztaacxjlluzqzehendp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dGFhY3hqbGx1enF6ZWhlbmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzM4NzMsImV4cCI6MjA4OTgwOTg3M30.79wvIPepXjvPZwLHOPX7KullShvdvCB7LS2gZO5CtuQ';

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    // GET  = Vercel Cronからの自動実行、または動作確認
    // POST = 管理画面の「今すぐ更新」ボタンからの手動実行(1日2回まで)
    const isManual = req.method === 'POST';

    try {
        const settingsFetch = await fetch(`${SUPABASE_URL}/rest/v1/customers?service_type=eq.threads_insight_settings`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
        const settingsRows = await settingsFetch.json();
        const settingsRow = (settingsRows && settingsRows[0]) || null;
        const settings = settingsRow ? (settingsRow.data || {}) : {};

        const accessToken = settings.accessToken;
        const threadsUserId = settings.threadsUserId;

        if (!accessToken || !threadsUserId) {
            return res.status(400).json({ error: 'Threads APIキーまたはUser IDが設定されていません。管理画面「Threads運用代行」→インサイトタブの「APIキーを登録する」から設定してください。' });
        }

        // --- 手動更新の場合だけ、1日2回までの制限をチェックする ---
        // UTC日付をそのまま「サイクル日」として使う: UTC 0:00 = JST 9:00 のため、
        // 「毎朝9時にリセット」という要件と自動的に一致する。
        const cycleDate = new Date().toISOString().slice(0, 10);
        const manualCount = settings.manualRefreshDate === cycleDate ? (Number(settings.manualRefreshCount) || 0) : 0;

        if (isManual && manualCount >= 2) {
            return res.status(429).json({ error: '本日の手動更新回数(2回)を使い切りました。毎朝9:00(JST)にリセットされます。' });
        }

        // --- Threads Graph API 呼び出し ---
        const metricList = 'views,followers_count';
        const apiUrl = `https://graph.threads.net/v1.0/${encodeURIComponent(threadsUserId)}/threads_insights?metric=${metricList}&access_token=${encodeURIComponent(accessToken)}`;

        const apiRes = await fetch(apiUrl);
        const apiJson = await apiRes.json();

        if (!apiRes.ok || apiJson.error) {
            const msg = (apiJson.error && apiJson.error.message) || `Threads APIエラー (status ${apiRes.status})`;
            return res.status(502).json({ error: 'Threads APIからの取得に失敗しました: ' + msg });
        }

        // レスポンス形式の揺れ(lifetime指標=total_value / time-series指標=values[])の
        // どちらにも対応できるようにしておく
        const pickMetric = (name) => {
            const m = (apiJson.data || []).find(d => d.name === name);
            if (!m) return null;
            if (m.total_value && typeof m.total_value.value !== 'undefined') return m.total_value.value;
            if (Array.isArray(m.values) && m.values.length > 0) return m.values[m.values.length - 1].value;
            return null;
        };

        const followers = pickMetric('followers_count');
        const profileViews = pickMetric('views');

        const updateData = { lastSyncedAt: new Date().toISOString() };
        if (followers !== null) updateData.followers = followers;
        if (profileViews !== null) updateData.profileViews = profileViews;
        if (isManual) {
            updateData.manualRefreshCount = manualCount + 1;
            updateData.manualRefreshDate = cycleDate;
        }

        if (settingsRow) {
            const merged = { ...settings, ...updateData };
            await fetch(`${SUPABASE_URL}/rest/v1/customers?id=eq.${settingsRow.id}`, {
                method: 'PATCH',
                headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ data: merged })
            });
        } else {
            await fetch(`${SUPABASE_URL}/rest/v1/customers`, {
                method: 'POST',
                headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ id: Date.now(), service_type: 'threads_insight_settings', data: updateData })
            });
        }

        return res.status(200).json({
            success: true,
            followers,
            profileViews,
            manualRefreshRemaining: isManual ? Math.max(0, 2 - (manualCount + 1)) : Math.max(0, 2 - manualCount)
        });
    } catch (e) {
        console.error('Threads sync error:', e);
        return res.status(500).json({ error: e.message });
    }
};
