// ============================================================================
// api/youtube-proxy.js
// 「YouTube分析データ」画面のための、サーバー側の自動ログイン + 読み取り専用の中継。
//
// 仕組み:
//   1) Vercelの環境変数に預けた「更新用の鍵(リフレッシュトークン)」で、サーバーがGoogleに自動でログインする。
//      → 画面側で毎回「Googleにログイン」を押さなくて済む。
//   2) 画面は、このファイル(同じサイト内の /api/youtube-proxy)にだけ問い合わせる。
//      このファイルが、決められた読み取りだけをYouTubeに中継する。
//
// 必要な環境変数(Vercel > Settings > Environment Variables):
//   YT_CLIENT_ID      Google CloudのOAuthクライアントID
//   YT_CLIENT_SECRET  同じクライアントの「クライアント シークレット」
//   YT_REFRESH_TOKEN  更新用の鍵(OAuth 2.0 Playground などで1回だけ取得)
//   これらがひとつでも無いときは 503(not_configured)を返し、画面は今までどおりの手動ログインに戻る。
//
// 出典(仕様):
//   - アクセストークンの更新: POST https://oauth2.googleapis.com/token (client_id, client_secret, refresh_token, grant_type=refresh_token)
//     https://developers.google.com/identity/protocols/oauth2/web-server#offline
//   - 更新用の鍵が使えなくなる条件(取り消し・6か月未使用・「テスト中」は7日): https://developers.google.com/identity/protocols/oauth2
//
// 安全面の作り:
//   ・GETだけ。中継できるのは「チャンネルの分析(reports.query)」「自分のチャンネル情報」「動画の題名など」だけ。
//     対象は常に自分のチャンネル(ids=channel==MINE)に固定し、許可した項目名以外は受け付けない。
//   ・アクセストークンも更新用の鍵も、レスポンスには一切含めない。
//   ・CORSの許可(Access-Control-Allow-Origin)は付けない。同じサイトの画面からだけ使える。
//   ・注意: このサイトにはまだ本物のログイン認証が無いため、URLを直接知っている人は、この読み取りを呼べてしまう。
//     読めるのは、このチャンネルの分析の数字だけ(書き込み・削除・収益は不可)。
// ============================================================================

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ANALYTICS_URL = 'https://youtubeanalytics.googleapis.com/v2/reports';
const DATA_URL = 'https://www.googleapis.com/youtube/v3';

let cache = { token: '', exp: 0 };

function configured() {
    return !!(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET && process.env.YT_REFRESH_TOKEN);
}

async function getAccessToken() {
    if (cache.token && Date.now() < cache.exp) return cache.token;
    const body = new URLSearchParams({
        client_id: process.env.YT_CLIENT_ID,
        client_secret: process.env.YT_CLIENT_SECRET,
        refresh_token: process.env.YT_REFRESH_TOKEN,
        grant_type: 'refresh_token'
    });
    let r;
    try { r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }); }
    catch (e) { const err = new Error('network'); err.code = 'network'; throw err; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) { const err = new Error(j.error || 'token_error'); err.code = j.error || 'token_error'; throw err; }
    cache = { token: j.access_token, exp: Date.now() + Math.max(60, (Number(j.expires_in) || 3600) - 120) * 1000 };
    return cache.token;
}

// ---- 許可する項目(これ以外は受け付けない) ----
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_LIST = /^[A-Za-z]{1,40}(,[A-Za-z]{1,40}){0,19}$/;
const RE_SORT = /^-?[A-Za-z]{1,40}(,-?[A-Za-z]{1,40}){0,4}$/;
const RE_FILTER = /^[A-Za-z0-9_=,;:\-]{1,200}$/;
const RE_MAX = /^\d{1,3}$/;
const RE_VIDS = /^[A-Za-z0-9_-]{1,32}(,[A-Za-z0-9_-]{1,32}){0,49}$/;
const ANALYTICS_PARAMS = { startDate: RE_DATE, endDate: RE_DATE, metrics: RE_LIST, dimensions: RE_LIST, sort: RE_SORT, filters: RE_FILTER, maxResults: RE_MAX };

function buildTarget(q) {
    const t = q.t;
    if (t === 'analytics') {
        const out = new URLSearchParams({ ids: 'channel==MINE' });
        for (const k of Object.keys(q)) {
            if (k === 't') continue;
            if (!ANALYTICS_PARAMS[k]) return { error: `許可されていない項目です: ${k}` };
            if (typeof q[k] !== 'string' || !ANALYTICS_PARAMS[k].test(q[k])) return { error: `${k} の値が正しくありません` };
            out.set(k, q[k]);
        }
        if (!out.get('startDate') || !out.get('endDate') || !out.get('metrics')) return { error: 'startDate・endDate・metrics は必須です' };
        return { url: `${ANALYTICS_URL}?${out.toString()}` };
    }
    if (t === 'channels') {
        const extra = Object.keys(q).filter(k => k !== 't');
        if (extra.length) return { error: `許可されていない項目です: ${extra[0]}` };
        return { url: `${DATA_URL}/channels?${new URLSearchParams({ part: 'snippet,statistics', mine: 'true' }).toString()}` };
    }
    if (t === 'videos') {
        const extra = Object.keys(q).filter(k => !['t', 'id'].includes(k));
        if (extra.length) return { error: `許可されていない項目です: ${extra[0]}` };
        if (typeof q.id !== 'string' || !RE_VIDS.test(q.id)) return { error: 'id の値が正しくありません' };
        return { url: `${DATA_URL}/videos?${new URLSearchParams({ part: 'snippet,contentDetails', id: q.id, maxResults: '50' }).toString()}` };
    }
    return { error: 't の値が正しくありません' };
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed', message: 'GETだけ使えます' });
    const q = req.query || {};
    if (!configured()) return res.status(503).json({ error: 'not_configured', message: 'サーバーの自動ログインはまだ設定されていません' });

    let token;
    try { token = await getAccessToken(); }
    catch (e) {
        if (e.code === 'network') return res.status(502).json({ error: 'network', message: 'Googleに接続できませんでした' });
        // invalid_grant など: 更新用の鍵が失効・取り消し・「テスト中」で7日経過した
        return res.status(401).json({ error: 'refresh_token_invalid', message: 'サーバーの更新用の鍵が使えなくなりました。取り直しが必要です' });
    }
    if (q.t === 'ping') return res.status(200).json({ ok: true });

    const target = buildTarget(q);
    if (target.error) return res.status(400).json({ error: 'bad_request', message: target.error });
    try {
        const r = await fetch(target.url, { headers: { Authorization: 'Bearer ' + token } });
        const text = await r.text();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(r.status).send(text);
    } catch (e) {
        return res.status(502).json({ error: 'network', message: 'YouTubeに接続できませんでした' });
    }
};
module.exports._reset = () => { cache = { token: '', exp: 0 }; };
