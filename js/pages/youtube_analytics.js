// js/pages/youtube_analytics.js
// YouTube分析データ: チャンネルの再生数・視聴時間・登録者・流入元・視聴者の特徴・視聴維持率などを、YouTube Analytics API から読み取って表示する(読み取り専用)。
//
// 仕組み(サーバーは使わない・Googleの認証情報も保存しない)
//   ・ログイン: Google Identity Services の「トークンモデル」。画面を開いている間だけ有効な短いトークンをメモリにだけ置き、DB・ブラウザの保存領域には入れない。
//     https://developers.google.com/identity/oauth2/web/guides/use-token-model
//   ・許可の種類(読み取りのみ): yt-analytics.readonly(分析の閲覧)と youtube.readonly(動画名・チャンネル情報の閲覧)。収益の許可は使わない。
//     https://developers.google.com/youtube/analytics/reference/reports/query
//   ・数字の取得: YouTube Analytics API v2 の reports.query。指標・条件の組み合わせは公式の表に従う。
//     https://developers.google.com/youtube/analytics/channel_reports
//     https://developers.google.com/youtube/analytics/metrics
//     https://developers.google.com/youtube/analytics/dimensions
//   ・日付の基準: Analytics API の日付は太平洋時間(米国西海岸)の1日。直近の数日はまだ集計中のため、最新日は昨日(太平洋時間)までにしている。
//   ・保存するもの: Googleのクライアント ID(ショート投稿予約と共通・秘密の情報ではない)だけ。分析の数字はこの画面のメモリにだけ置き、保存しない。
(function () {
    const GIS_SRC = 'https://accounts.google.com/gsi/client';
    const SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly';
    const REPORTS = 'https://youtubeanalytics.googleapis.com/v2/reports';
    const DATA = 'https://www.googleapis.com/youtube/v3';
    const SETTINGS_TYPE = 'short_upload_settings';   // クライアントIDはショート投稿予約と共通
    const MAX_SPAN = 731;
    const TYPES = { all: 'すべて', SHORTS: 'ショート', VIDEO_ON_DEMAND: 'ロング(通常の動画)' };
    const TYPE_LABEL = { SHORTS: 'ショート', VIDEO_ON_DEMAND: 'ロング', LIVE_STREAM: 'ライブ', STORY: 'ストーリー', UNSPECIFIED: 'その他' };
    const TYPE_COLOR = { SHORTS: '#E8590C', VIDEO_ON_DEMAND: '#1C7ED6', LIVE_STREAM: '#2F9E44', STORY: '#AE3EC9', UNSPECIFIED: '#868E96' };
    const SRC_LABEL = { ADVERTISING: '広告', ANNOTATION: '注釈', CAMPAIGN_CARD: 'キャンペーンカード', END_SCREEN: '終了画面', EXT_URL: '外部サイト・アプリ', HASHTAGS: 'ハッシュタグ', LIVE_REDIRECT: 'ライブのリダイレクト', NO_LINK_EMBEDDED: 'リンクなし(埋め込み)', NO_LINK_OTHER: 'リンクなし(その他)', NOTIFICATION: '通知', PLAYLIST: '再生リスト', PRODUCT_PAGE: '商品ページ', PROMOTED: 'プロモーション', RELATED_VIDEO: '関連動画(おすすめ)', SHORTS: 'ショートフィード', SOUND_PAGE: 'サウンドページ', SUBSCRIBER: '登録チャンネル(ホーム・登録フィード)', YT_CHANNEL: 'チャンネルページ', YT_OTHER_PAGE: 'YouTubeのその他のページ', YT_SEARCH: 'YouTube検索', VIDEO_REMIXES: 'リミックス', WATCH_WITH: '一緒に視聴' };
    const DEVICE_LABEL = { DESKTOP: 'パソコン', GAME_CONSOLE: 'ゲーム機', MOBILE: 'スマートフォン', TABLET: 'タブレット', TV: 'テレビ', AUTOMOTIVE: '車載', WEARABLE: 'ウェアラブル', UNKNOWN_PLATFORM: '不明' };
    const SUBS_LABEL = { SUBSCRIBED: 'チャンネル登録者', UNSUBSCRIBED: '登録していない人' };
    const LOC_LABEL = { BROWSE: 'ホーム・登録フィードなど', CHANNEL: 'チャンネルページ', EMBEDDED: '外部サイトの埋め込み', EXTERNAL_APP: '外部アプリ', MOBILE: 'モバイル(旧)', SEARCH: '検索結果', WATCH: '視聴ページ', YT_OTHER: 'YouTubeのその他' };
    const GENDER_LABEL = { female: '女性', male: '男性', user_specified: '指定なし' };
    const AGE_LABEL = { 'age13-17': '13〜17歳', 'age18-24': '18〜24歳', 'age25-34': '25〜34歳', 'age35-44': '35〜44歳', 'age45-54': '45〜54歳', 'age55-64': '55〜64歳', 'age65-': '65歳以上' };
    const SHARE_LABEL = { COPY_PASTE: 'リンクのコピー', LINE: 'LINE', TWITTER: 'X(Twitter)', FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', INSTAGRAM_STORIES: 'Instagramストーリー', WHATS_APP: 'WhatsApp', MAIL: 'メール', GMAIL: 'Gmail', TEXT_MESSAGE: 'SMS', EMBED: '埋め込み', ANDROID_SYSTEM_SHARE_DIALOG: 'Android共有', IOS_SYSTEM_ACTIVITY_DIALOG: 'iOS共有', TELEGRAM: 'Telegram', DISCORD: 'Discord', OTHER: 'その他', UNKNOWN: '不明' };

    const S = window.YtAnalyticsState = window.YtAnalyticsState || { token: null, tokenExp: 0, clientId: '', rowId: null, preset: '28d', start: '', end: '', type: 'all', metric: 'views', gran: 'day', rankSort: 'views', rankShown: 20, cache: new Map(), vcache: new Map(), channel: null, run: 0, snap: {}, aiModel: '', aiGoal: '', aiBusy: false };
    const charts = {};

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
    const fmtInt = (n) => Math.round(num(n)).toLocaleString('ja-JP');
    const fmtHours = (min) => (num(min) / 60).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
    const fmtDur = (sec) => { const s = Math.round(num(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    const fmtPct = (v, d = 1) => `${num(v).toFixed(d)}%`;
    const sign = (n) => (n > 0 ? '+' : '') + n;

    // ---------- 日付(太平洋時間) ----------
    const ptFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
    const ptToday = () => ptFmt.format(new Date(Date.now()));
    const parseD = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
    const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);
    const addDays = (s, n) => fromMs(parseD(s) + n * 86400e3);
    const diffDays = (a, b) => Math.round((parseD(b) - parseD(a)) / 86400e3);
    const fmtD = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${+m[1]}年${+m[2]}月${+m[3]}日` : s; };
    function currentRange() {
        const end0 = addDays(ptToday(), -1);   // 最新の確定日(太平洋時間の昨日)
        let start, end = end0;
        const p = S.preset;
        if (p === '7d' || p === '28d' || p === '90d' || p === '365d') start = addDays(end, -(parseInt(p, 10) - 1));
        else if (p === 'thisMonth') { start = ptToday().slice(0, 8) + '01'; if (start > end) start = end; }
        else if (p === 'lastMonth') { const t = ptToday(); const first = t.slice(0, 8) + '01'; end = addDays(first, -1); start = end.slice(0, 8) + '01'; }
        else { start = S.start; end = S.end; }
        if (!parseD(start) || !parseD(end)) return { error: '開始日と終了日を入れてください' };
        if (start > end) return { error: '開始日は終了日より前にしてください' };
        if (end > end0) return { error: `終了日は ${fmtD(end0)} までです(それより新しい日はまだ集計中です)` };
        if (diffDays(start, end) + 1 > MAX_SPAN) return { error: `期間は${MAX_SPAN}日までです` };
        const len = diffDays(start, end) + 1;
        const pEnd = addDays(start, -1), pStart = addDays(pEnd, -(len - 1));
        return { start, end, len, prev: { start: pStart, end: pEnd } };
    }

    // ---------- 設定(クライアントID) ----------
    async function loadClientId() {
        const rows = await Store.getCustomers(SETTINGS_TYPE);
        const row = rows.slice().sort((a, b) => Number(a.id) - Number(b.id))[0];
        S.rowId = row ? row.id : null;
        S.clientId = row && typeof row.clientId === 'string' ? row.clientId.trim() : '';
    }
    async function saveClientId(id) {
        if (S.rowId) await Store.updateCustomer(SETTINGS_TYPE, S.rowId, { clientId: id, updatedAt: new Date().toISOString() });
        else await Store.addCustomer(SETTINGS_TYPE, { clientId: id, hour: 19, minute: 0, description: '#Shorts', tags: '', categoryId: '22', kids: 'default', updatedAt: new Date().toISOString() });
        await loadClientId();
        if (S.clientId !== id) throw new Error('保存した内容を確認できませんでした。通信状態を確認してください');   // Storeは保存に失敗しても例外を出さないため、読み直して確認
    }

    // ---------- Googleログイン(トークンモデル) ----------
    let gisLoading = null;
    function loadGis() {
        if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
        if (!gisLoading) {
            gisLoading = new Promise((resolve, reject) => {
                const sc = document.createElement('script');
                sc.src = GIS_SRC; sc.async = true;
                sc.onload = () => (window.google && window.google.accounts && window.google.accounts.oauth2) ? resolve() : reject(new Error('Googleのログイン部品を読み込めませんでした'));
                sc.onerror = () => { gisLoading = null; reject(new Error('Googleのログイン部品を読み込めませんでした。通信状態を確認してください')); };
                document.head.appendChild(sc);
            });
        }
        return gisLoading;
    }
    const tokenOk = () => !!S.token && Date.now() < S.tokenExp;
    async function connect() {
        if (!S.clientId) throw new Error('先に「Googleのクライアント ID」を保存してください');
        await loadGis();
        return new Promise((resolve, reject) => {
            const client = window.google.accounts.oauth2.initTokenClient({
                client_id: S.clientId, scope: SCOPE,
                callback: (resp) => {
                    if (resp && resp.access_token) {
                        const granted = window.google.accounts.oauth2.hasGrantedAllScopes ? window.google.accounts.oauth2.hasGrantedAllScopes(resp, ...SCOPE.split(' ')) : true;
                        if (!granted) { reject(new Error('許可の項目がすべて選ばれていません。ログインし直して、表示された項目すべてにチェックを入れてください')); return; }
                        S.token = resp.access_token;
                        S.tokenExp = Date.now() + Math.max(60, (Number(resp.expires_in) || 3600) - 120) * 1000;
                        resolve();
                    } else reject(new Error(resp && resp.error_description ? resp.error_description : 'Googleにログインできませんでした'));
                },
                error_callback: (err) => reject(new Error(err && err.type === 'popup_closed' ? 'ログインの画面が閉じられました' : 'Googleにログインできませんでした'))
            });
            client.requestAccessToken({ prompt: S.token ? '' : 'consent' });
        });
    }

    // ---------- API呼び出し ----------
    class ApiError extends Error { constructor(status, reason, msg, kind) { super(msg); this.status = status; this.reason = reason; this.kind = kind; } }
    function classify(status, body) {
        let reason = '', msg = '';
        try { const j = JSON.parse(body); reason = (j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || (j.error && j.error.status) || ''; msg = (j.error && j.error.message) || ''; } catch (e) { /* */ }
        const low = (msg + ' ' + reason).toLowerCase();
        if (status === 401) return new ApiError(status, reason, 'ログインの有効期限が切れました。「Googleにログイン」を押してください', 'auth');
        if (status === 403 && (/accessnotconfigured|servicedisabled|has not been used|is disabled|api has not/.test(low))) {
            const which = /reporting/.test(low) ? 'YouTube Reporting API' : /analytics/.test(low) ? 'YouTube Analytics API' :(/data api|youtube\.googleapis|youtube data/.test(low) ? 'YouTube Data API v3' : 'YouTube Analytics API');
            return new ApiError(status, reason, `Google Cloudで「${which}」が有効になっていません。下の「準備」の手順で有効にしてください`, 'setup');
        }
        if (status === 403 && /insufficient|scope/.test(low)) return new ApiError(status, reason, '許可が足りません。「Googleにログイン」を押し直して、表示された項目すべてにチェックを入れてください', 'scope');
        if (/quota|ratelimit|dailylimit/.test(low)) return new ApiError(status, reason, 'YouTubeの1日の読み取り上限に達しました。明日になってからやり直してください', 'quota');
        if (status === 403) return new ApiError(status, reason, `このアカウントでは読み取れません(${reason || '権限がありません'})。投稿したチャンネルのアカウントでログインしているか確認してください`, 'forbidden');
        if (status === 400) return new ApiError(status, reason, `この条件の数字は取得できませんでした${msg ? '(' + msg + ')' : ''}`, 'bad');
        return new ApiError(status, reason, `YouTubeから数字を取得できませんでした(${status}${msg ? ': ' + msg : ''})`, 'other');
    }
    async function api(url, opt) {
        if (!tokenOk()) throw new ApiError(401, '', 'ログインが必要です。「Googleにログイン」を押してください', 'auth');
        let r;
        try { r = await fetch(url, { ...(opt || {}), headers: { ...((opt && opt.headers) || {}), Authorization: 'Bearer ' + S.token } }); }
        catch (e) { throw new ApiError(0, '', 'YouTubeに接続できませんでした。通信状態を確認してください', 'net'); }
        const text = await r.text();
        if (!r.ok) throw classify(r.status, text);
        try { return JSON.parse(text); } catch (e) { throw new ApiError(r.status, '', 'YouTubeからの応答を読み取れませんでした', 'other'); }
    }
    // 条件 p: { start, end, metrics[], dimensions[], filters, sort, max }
    async function report(p) {
        const q = new URLSearchParams({ ids: 'channel==MINE', startDate: p.start, endDate: p.end, metrics: p.metrics.join(',') });
        if (p.dimensions && p.dimensions.length) q.set('dimensions', p.dimensions.join(','));
        if (p.filters) q.set('filters', p.filters);
        if (p.sort) q.set('sort', p.sort);
        if (p.max) q.set('maxResults', String(p.max));
        const key = q.toString();
        if (S.cache.has(key)) return S.cache.get(key);
        const j = await api(REPORTS + '?' + key);
        const cols = (j.columnHeaders || []).map(h => h.name);
        const rows = (j.rows || []).map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
        S.cache.set(key, rows);
        return rows;
    }
    // 種別(ショート/ロング)で絞る: 種別を条件に足して、選んだ種別の行だけ残す
    async function typed(p) {
        if (S.type === 'all') return report(p);
        const rows = await report({ ...p, dimensions: [...(p.dimensions || []), 'creatorContentType'], max: p.max ? p.max * 3 : p.max });
        const out = rows.filter(r => r.creatorContentType === S.type);
        return p.max ? out.slice(0, p.max) : out;
    }
    async function typedSnap(key, p) { const rows = await typed(p); S.snap[key] = rows; return rows; }   // AI分析に渡すため、取得した行を覚えておく(画面のメモリだけ)
    async function dataApi(path, params) {
        const q = new URLSearchParams(params);
        const key = DATA + path + '?' + q.toString();
        if (S.vcache.has(key)) return S.vcache.get(key);
        const j = await api(key);
        S.vcache.set(key, j);
        return j;
    }
    async function videoInfo(ids) {
        const need = ids.filter(id => !S.vcache.has('v:' + id));
        for (let i = 0; i < need.length; i += 50) {
            const chunk = need.slice(i, i + 50);
            try {
                const j = await dataApi('/videos', { part: 'snippet,contentDetails', id: chunk.join(','), maxResults: '50' });
                (j.items || []).forEach(v => S.vcache.set('v:' + v.id, { title: v.snippet && v.snippet.title, publishedAt: v.snippet && v.snippet.publishedAt, thumb: v.snippet && v.snippet.thumbnails && ((v.snippet.thumbnails.medium || v.snippet.thumbnails.default || {}).url), dur: parseIso(v.contentDetails && v.contentDetails.duration) }));
            } catch (e) { if (e.kind === 'auth') throw e; /* 題名が取れなくても、数字は出す */ }
        }
        return Object.fromEntries(ids.map(id => [id, S.vcache.get('v:' + id) || null]));
    }
    function parseIso(d) { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : null; }

    // ---------- 集計の部品 ----------
    const sumBy = (rows, keys) => keys.reduce((o, k) => { o[k] = rows.reduce((a, r) => a + num(r[k]), 0); return o; }, {});
    function weekKey(d) { const dow = new Date(parseD(d)).getUTCDay(); return addDays(d, -((dow + 6) % 7)); }
    function bucketKey(d, gran) { return gran === 'week' ? weekKey(d) : (gran === 'month' ? d.slice(0, 7) : d); }
    function bucketLabel(k, gran) { if (gran === 'month') return `${+k.slice(0, 4)}年${+k.slice(5, 7)}月`; const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k); return gran === 'week' ? `${+m[2]}/${+m[3]}週` : `${+m[2]}/${+m[3]}`; }
    const delta = (cur, prev) => { if (!prev) return cur ? { t: '新規', cls: 'up' } : { t: '±0%', cls: 'flat' }; const p = (cur - prev) / prev * 100; return { t: `${p > 0 ? '+' : ''}${p.toFixed(1)}%`, cls: p > 0.05 ? 'up' : (p < -0.05 ? 'down' : 'flat') }; };

    // ---------- 画面の部品 ----------
    function destroyChart(id) { if (charts[id]) { try { charts[id].destroy(); } catch (e) { /* */ } delete charts[id]; } }
    function makeChart(id, canvas, cfg) {
        destroyChart(id);
        if (!canvas) return;
        if (typeof window.Chart === 'undefined') { canvas.parentElement.innerHTML = '<div class="ya-empty">グラフの部品を読み込めなかったため、表だけ表示しています</div>'; return; }
        try { Chart.defaults.animation = false; charts[id] = new Chart(canvas, cfg); } catch (e) { console.error(e); }
    }
    const box = (id) => document.getElementById(id);
    const setBody = (id, html) => { const el = box(id); if (el) el.innerHTML = html; };
    const loading = (id) => setBody(id, '<div class="ya-loading"><i class="ph ph-spinner ph-spin"></i> 読み込み中…</div>');
    function showErr(id, e) {
        const msg = e && e.message ? e.message : '読み込めませんでした';
        setBody(id, `<div class="ya-err">${esc(msg)}</div>`);
        if (e && e.kind === 'setup') { const g = box('ya-setup'); if (g) g.open = true; }
        if (e && e.kind === 'auth') { S.token = null; S.tokenExp = 0; refreshLogin(); }
    }
    const emptyHtml = (t) => `<div class="ya-empty">${esc(t || 'この期間のデータはありません')}</div>`;
    function barRows(rows, labelOf, valueKey, fmt, total) {
        if (!rows.length) return emptyHtml();
        const max = Math.max(...rows.map(r => num(r[valueKey])), 1);
        return `<div class="ya-bars">${rows.map(r => { const v = num(r[valueKey]); return `<div class="ya-bar-row"><div class="ya-bar-label">${esc(labelOf(r))}</div><div class="ya-bar-track"><div class="ya-bar-fill" style="width:${(v / max * 100).toFixed(1)}%"></div></div><div class="ya-bar-val">${esc(fmt(v))}${total ? ` <span>(${(v / total * 100).toFixed(1)}%)</span>` : ''}</div></div>`; }).join('')}</div>`;
    }
    const regionName = (() => { try { const dn = new Intl.DisplayNames(['ja'], { type: 'region' }); return (c) => { try { return c === 'ZZ' ? '不明' : (dn.of(c) || c); } catch (e) { return c; } }; } catch (e) { return (c) => c; } })();

    // ---------- 各セクション ----------
    async function loadChannel() {
        loading('ya-channel');
        try {
            const j = await dataApi('/channels', { part: 'snippet,statistics', mine: 'true' });
            const c = (j.items || [])[0];
            if (!c) { setBody('ya-channel', emptyHtml('ログインしたアカウントにYouTubeチャンネルがありません')); return; }
            S.channel = c;
            const st = c.statistics || {};
            setBody('ya-channel', `<div class="ya-chan"><div class="ya-chan-name">${esc(c.snippet && c.snippet.title)}</div>
                <div class="ya-chan-stats"><div><span>登録者数</span><b>${st.hiddenSubscriberCount ? '非公開' : fmtInt(st.subscriberCount)}</b></div><div><span>総再生回数</span><b>${fmtInt(st.viewCount)}</b></div><div><span>動画数</span><b>${fmtInt(st.videoCount)}</b></div></div></div>`);
        } catch (e) { showErr('ya-channel', e); }
    }

    const SUM_METRICS = ['views', 'estimatedMinutesWatched', 'likes', 'comments', 'shares', 'subscribersGained', 'subscribersLost'];
    async function seriesFor(range) {
        const base = { start: range.start, end: range.end, sort: 'day' };
        try { return { rows: await report({ ...base, dimensions: ['day', 'creatorContentType'], metrics: SUM_METRICS }), byType: true }; }
        catch (e) {
            if (e.kind !== 'bad') throw e;
            return { rows: await report({ ...base, dimensions: ['day'], metrics: SUM_METRICS }), byType: false };   // 種別ごとの内訳が使えない場合は、全体だけ
        }
    }
    const pick = (series, type) => type === 'all' ? series.rows : series.rows.filter(r => r.creatorContentType === type);
    async function avgPct(range) {
        try { const rows = await typed({ start: range.start, end: range.end, metrics: ['averageViewPercentage'] }); return rows.length ? num(rows[0].averageViewPercentage) : null; }
        catch (e) { if (e.kind === 'bad') return null; throw e; }
    }
    async function loadSummary(range, run) {
        loading('ya-summary'); loading('ya-trend');
        try {
            const [cur, prev, pc, pp] = await Promise.all([seriesFor(range), seriesFor(range.prev), avgPct(range), avgPct(range.prev)]);
            if (run !== S.run) return;
            S.series = cur;
            const typeNote = (!cur.byType && S.type !== 'all') ? '<div class="ya-warn">この期間は、種別(ショート/ロング)ごとの内訳を取得できなかったため、全体の数字を表示しています。</div>' : '';
            const t = S.type !== 'all' && cur.byType ? S.type : 'all';
            const a = sumBy(pick(cur, t), SUM_METRICS), b = sumBy(pick(prev, t), SUM_METRICS);
            const avgDur = (x) => x.views ? x.estimatedMinutesWatched * 60 / x.views : 0;
            S.snap.summary = { range, type: t, cur: a, prev: b, avgDurCur: avgDur(a), avgDurPrev: avgDur(b), avgPctCur: pc, avgPctPrev: pp };
            const tiles = [
                { k: '再生数', v: fmtInt(a.views), d: delta(a.views, b.views) },
                { k: '総再生時間(時間)', v: fmtHours(a.estimatedMinutesWatched), d: delta(a.estimatedMinutesWatched, b.estimatedMinutesWatched) },
                { k: '平均視聴時間', v: fmtDur(avgDur(a)), d: delta(avgDur(a), avgDur(b)) },
                { k: '平均視聴率', v: pc == null ? '—' : fmtPct(pc), d: (pc == null || pp == null) ? null : { t: `${pc - pp > 0.05 ? '+' : ''}${(pc - pp).toFixed(1)}pt`, cls: pc - pp > 0.05 ? 'up' : (pc - pp < -0.05 ? 'down' : 'flat') } },
                { k: '登録者の増減', v: sign(a.subscribersGained - a.subscribersLost), sub: `増 ${fmtInt(a.subscribersGained)} / 減 ${fmtInt(a.subscribersLost)}`, d: delta(a.subscribersGained - a.subscribersLost, b.subscribersGained - b.subscribersLost) },
                { k: 'いいね', v: fmtInt(a.likes), d: delta(a.likes, b.likes) },
                { k: 'コメント', v: fmtInt(a.comments), d: delta(a.comments, b.comments) },
                { k: '共有', v: fmtInt(a.shares), d: delta(a.shares, b.shares) }
            ];
            setBody('ya-summary', `${typeNote}<div class="ya-tiles">${tiles.map(x => `<div class="ya-tile"><div class="ya-tile-k">${esc(x.k)}</div><div class="ya-tile-v">${esc(x.v)}</div>${x.sub ? `<div class="ya-tile-s">${esc(x.sub)}</div>` : ''}${x.d ? `<div class="ya-tile-d ${x.d.cls}">前の期間比 ${esc(x.d.t)}</div>` : ''}</div>`).join('')}</div>
                <div class="ya-note">比べている「前の期間」: ${esc(fmtD(range.prev.start))} 〜 ${esc(fmtD(range.prev.end))}(同じ日数)</div>`);
            renderTrend();
            aiRefresh();
        } catch (e) { if (run !== S.run) return; showErr('ya-summary', e); showErr('ya-trend', e); }
    }
    const TREND_METRICS = { views: '再生数', hours: '総再生時間(時間)', subs: '登録者の増減', likes: 'いいね' };
    function trendValue(rows, metric) {
        const s = sumBy(rows, SUM_METRICS);
        if (metric === 'hours') return s.estimatedMinutesWatched / 60;
        if (metric === 'subs') return s.subscribersGained - s.subscribersLost;
        return s[metric === 'likes' ? 'likes' : 'views'];
    }
    function renderTrend() {
        const el = box('ya-trend'); if (!el || !S.series) return;
        const series = S.series;
        const gran = S.gran;
        const days = Array.from(new Set(series.rows.map(r => r.day))).sort();
        const keys = Array.from(new Set(days.map(d => bucketKey(d, gran)))).sort();
        let sets;
        if (series.byType && S.type === 'all') {
            const types = Array.from(new Set(series.rows.map(r => r.creatorContentType)));
            sets = types.map(t => ({ label: TYPE_LABEL[t] || t, color: TYPE_COLOR[t] || '#868E96', rows: series.rows.filter(r => r.creatorContentType === t) }));
            if (types.length > 1) sets.push({ label: '合計', color: '#212529', rows: series.rows, dash: true });
        } else {
            const t = series.byType ? S.type : 'all';
            sets = [{ label: t === 'all' ? '全体' : (TYPE_LABEL[t] || t), color: TYPE_COLOR[t] || '#212529', rows: pick(series, t) }];
        }
        const datasets = sets.map(ds => ({ label: ds.label, borderColor: ds.color, backgroundColor: ds.color, borderDash: ds.dash ? [5, 4] : [], borderWidth: 2, pointRadius: keys.length > 60 ? 0 : 2, tension: 0.25, data: keys.map(k => +trendValue(ds.rows.filter(r => bucketKey(r.day, gran) === k), S.metric).toFixed(2)) }));
        el.innerHTML = `<div class="ya-ctl"><label>数字 <select id="ya-metric">${Object.entries(TREND_METRICS).map(([k, v]) => `<option value="${k}" ${S.metric === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
            <label>まとめ方 <select id="ya-gran">${[['day', '日ごと'], ['week', '週ごと'], ['month', '月ごと']].map(([k, v]) => `<option value="${k}" ${S.gran === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
            ${keys.length ? '<div class="ya-chart"><canvas id="ya-trend-cv"></canvas></div>' : emptyHtml()}`;
        if (keys.length) makeChart('trend', box('ya-trend-cv'), { type: 'line', data: { labels: keys.map(k => bucketLabel(k, gran)), datasets }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } } });
        box('ya-metric').addEventListener('change', (e) => { S.metric = e.target.value; renderTrend(); });
        box('ya-gran').addEventListener('change', (e) => { S.gran = e.target.value; renderTrend(); });
    }

    const RANK_FULL = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'likes', 'comments', 'shares', 'subscribersGained'];
    const RANK_CORE = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'likes', 'subscribersGained'];
    const RANK_SORTS = { views: ['再生数', 'views'], estimatedMinutesWatched: ['総再生時間', 'estimatedMinutesWatched'], likes: ['いいね', 'likes'], subscribersGained: ['登録者の増加', 'subscribersGained'], averageViewPercentage: ['平均視聴率', 'averageViewPercentage'] };
    async function loadRank(range, run) {
        loading('ya-rank');
        try {
            const sort = S.rankSort === 'estimatedMinutesWatched' ? '-estimatedMinutesWatched' : '-views';
            const p = { start: range.start, end: range.end, dimensions: ['video', 'creatorContentType'], sort, max: 200 };
            let rows, reduced = false;
            try { rows = await report({ ...p, metrics: RANK_FULL }); }
            catch (e) { if (e.kind !== 'bad') throw e; rows = await report({ ...p, metrics: RANK_CORE }); reduced = true; }
            if (run !== S.run) return;
            S.rank = { rows, reduced, sortParam: sort };
            await renderRank(run);
        } catch (e) { if (run !== S.run) return; showErr('ya-rank', e); }
    }
    async function renderRank(run) {
        const el = box('ya-rank'); if (!el || !S.rank) return;
        let rows = S.rank.rows.filter(r => S.type === 'all' || r.creatorContentType === S.type);
        const sk = S.rankSort;
        rows = rows.slice().sort((a, b) => num(b[sk]) - num(a[sk]));
        const shown = rows.slice(0, S.rankShown);
        const info = await videoInfo(shown.map(r => r.video));
        if (run != null && run !== S.run) return;
        const head = `<div class="ya-ctl"><label>並び順 <select id="ya-ranksort">${Object.entries(RANK_SORTS).filter(([k]) => !(S.rank.reduced && k === 'averageViewPercentage')).map(([k, v]) => `<option value="${k}" ${S.rankSort === k ? 'selected' : ''}>${v[0]}が多い順</option>`).join('')}</select></label><span class="ya-note">この期間に見られた動画の上位${Math.min(rows.length, 200)}本の中での順位です。</span></div>`;
        if (!rows.length) { el.innerHTML = head + emptyHtml(); bindRank(); return; }
        const th = (t) => `<th>${t}</th>`;
        el.innerHTML = head + `${S.rank.reduced ? '<div class="ya-warn">一部の数字(平均視聴率・コメント・共有)は、この条件では取得できなかったため表示していません。</div>' : ''}
            <div class="ya-table-wrap"><table class="ya-table"><thead><tr>${th('#')}${th('動画')}${th('種別')}${th('再生数')}${th('総再生時間(時間)')}${th('平均視聴時間')}${S.rank.reduced ? '' : th('平均視聴率')}${th('いいね')}${S.rank.reduced ? '' : th('コメント')}${S.rank.reduced ? '' : th('共有')}${th('登録者増')}${th('')}</tr></thead><tbody>
            ${shown.map((r, i) => { const v = info[r.video]; const title = v && v.title ? v.title : r.video; return `<tr>
                <td>${i + 1}</td>
                <td class="ya-vcell">${v && v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy">` : '<span class="ya-noimg"></span>'}<div><a href="https://www.youtube.com/watch?v=${encodeURIComponent(r.video)}" target="_blank" rel="noopener">${esc(title)}</a><div class="ya-sub">${v && v.publishedAt ? esc(v.publishedAt.slice(0, 10)) + ' 公開' : ''}${v && v.dur != null ? ' ・ ' + fmtDur(v.dur) : ''}</div></div></td>
                <td><span class="ya-chip" style="--c:${TYPE_COLOR[r.creatorContentType] || '#868E96'}">${esc(TYPE_LABEL[r.creatorContentType] || r.creatorContentType || '')}</span></td>
                <td>${fmtInt(r.views)}</td><td>${fmtHours(r.estimatedMinutesWatched)}</td><td>${fmtDur(r.averageViewDuration)}</td>
                ${S.rank.reduced ? '' : `<td>${fmtPct(r.averageViewPercentage)}</td>`}<td>${fmtInt(r.likes)}</td>
                ${S.rank.reduced ? '' : `<td>${fmtInt(r.comments)}</td><td>${fmtInt(r.shares)}</td>`}<td>${sign(fmtInt(r.subscribersGained))}</td>
                <td><button type="button" class="btn-secondary btn-sm" data-ya-ret="${esc(r.video)}">維持率</button></td></tr>`; }).join('')}
            </tbody></table></div>
            ${rows.length > shown.length ? `<div class="ya-more"><button type="button" class="btn-secondary btn-sm" id="ya-more">もっと見る(${shown.length}/${rows.length})</button></div>` : ''}`;
        bindRank();
    }
    function bindRank() {
        const sel = box('ya-ranksort');
        if (sel) sel.addEventListener('change', (e) => {
            S.rankSort = e.target.value; S.rankShown = 20;
            const want = S.rankSort === 'estimatedMinutesWatched' ? '-estimatedMinutesWatched' : '-views';
            if (S.rank && S.rank.sortParam === want) { renderRank(S.run); return; }   // 取得済みの上位200本の中で並べ替える
            const r = currentRange(); if (!r.error) loadRank(r, S.run);               // 「総再生時間順」は、サーバー側で上位200本を取り直す
        });
        const more = box('ya-more');
        if (more) more.addEventListener('click', () => { S.rankShown += 20; renderRank(S.run); });
        document.querySelectorAll('[data-ya-ret]').forEach(b => b.addEventListener('click', () => loadRetention(b.dataset.yaRet)));
    }

    async function loadSources(range, run) {
        ['ya-src', 'ya-kw', 'ya-ext'].forEach(loading);
        const base = { start: range.start, end: range.end };
        const job = async (id, fn) => { try { const h = await fn(); if (run !== S.run) return; setBody(id, h); } catch (e) { if (run !== S.run) return; if (e.kind === 'bad') setBody(id, emptyHtml('この条件のデータは取得できませんでした')); else showErr(id, e); } };
        await Promise.all([
            job('ya-src', async () => {
                const rows = await typedSnap('src', { ...base, dimensions: ['insightTrafficSourceType'], metrics: ['views', 'estimatedMinutesWatched'], sort: '-views' });
                const total = rows.reduce((a, r) => a + num(r.views), 0);
                return barRows(rows, r => SRC_LABEL[r.insightTrafficSourceType] || r.insightTrafficSourceType, 'views', (v) => `${fmtInt(v)}回`, total);
            }),
            job('ya-kw', async () => {
                const rows = await typedSnap('kw', { ...base, dimensions: ['insightTrafficSourceDetail'], metrics: ['views', 'estimatedMinutesWatched'], filters: 'insightTrafficSourceType==YT_SEARCH', sort: '-views', max: 25 });
                return rows.length ? barRows(rows, r => r.insightTrafficSourceDetail, 'views', (v) => `${fmtInt(v)}回`) : emptyHtml('検索から見られたデータはありません');
            }),
            job('ya-ext', async () => {
                const rows = await typedSnap('ext', { ...base, dimensions: ['insightTrafficSourceDetail'], metrics: ['views', 'estimatedMinutesWatched'], filters: 'insightTrafficSourceType==EXT_URL', sort: '-views', max: 25 });
                return rows.length ? barRows(rows, r => r.insightTrafficSourceDetail, 'views', (v) => `${fmtInt(v)}回`) : emptyHtml('外部サイト・アプリから見られたデータはありません');
            })
        ]);
    }

    async function loadAudience(range, run) {
        ['ya-demo', 'ya-country', 'ya-device', 'ya-subs', 'ya-share', 'ya-loc'].forEach(loading);
        const base = { start: range.start, end: range.end };
        const job = async (id, fn) => { try { const h = await fn(); if (run !== S.run) return; setBody(id, h); } catch (e) { if (run !== S.run) return; if (e.kind === 'bad') setBody(id, emptyHtml('この条件のデータは取得できませんでした')); else showErr(id, e); } };
        await Promise.all([
            job('ya-demo', async () => {
                let rows = await typedSnap('demo', { ...base, dimensions: ['ageGroup', 'gender'], metrics: ['viewerPercentage'], sort: 'ageGroup,gender' });
                if (!rows.length) return emptyHtml('視聴者の年齢・性別は、視聴数が少ないと表示されません');
                if (S.type !== 'all') { const tot = rows.reduce((a, r) => a + num(r.viewerPercentage), 0); if (tot > 0) rows = rows.map(r => ({ ...r, viewerPercentage: num(r.viewerPercentage) / tot * 100 })); }
                const ages = Object.keys(AGE_LABEL).filter(a => rows.some(r => r.ageGroup === a));
                const genders = ['female', 'male', 'user_specified'].filter(g => rows.some(r => r.gender === g));
                const val = (a, g) => num((rows.find(r => r.ageGroup === a && r.gender === g) || {}).viewerPercentage);
                const total = (g) => ages.reduce((s, a) => s + val(a, g), 0);
                const html = `<div class="ya-chart ya-chart-s"><canvas id="ya-demo-cv"></canvas></div><div class="ya-note">性別の割合: ${genders.map(g => `${GENDER_LABEL[g]} ${total(g).toFixed(1)}%`).join(' / ')}</div>`;
                setTimeout(() => { if (run !== S.run) return; makeChart('demo', box('ya-demo-cv'), { type: 'bar', data: { labels: ages.map(a => AGE_LABEL[a]), datasets: genders.map(g => ({ label: GENDER_LABEL[g], backgroundColor: g === 'female' ? '#E64980' : (g === 'male' ? '#1C7ED6' : '#868E96'), data: ages.map(a => +val(a, g).toFixed(1)) })) }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, title: { display: true, text: '視聴者の割合(%)' } } } } }); }, 0);
                return html;
            }),
            job('ya-country', async () => {
                const rows = await typedSnap('country', { ...base, dimensions: ['country'], metrics: ['views', 'estimatedMinutesWatched'], sort: '-views', max: 10 });
                const total = rows.reduce((a, r) => a + num(r.views), 0);
                return rows.length ? barRows(rows, r => regionName(r.country), 'views', (v) => `${fmtInt(v)}回`, total) : emptyHtml();
            }),
            job('ya-device', async () => {
                const rows = await typedSnap('device', { ...base, dimensions: ['deviceType'], metrics: ['views', 'estimatedMinutesWatched'], sort: '-views' });
                const total = rows.reduce((a, r) => a + num(r.views), 0);
                return barRows(rows, r => DEVICE_LABEL[r.deviceType] || r.deviceType, 'views', (v) => `${fmtInt(v)}回`, total);
            }),
            job('ya-subs', async () => {
                const rows = await typedSnap('subs', { ...base, dimensions: ['subscribedStatus'], metrics: ['views', 'estimatedMinutesWatched'], sort: '-views' });
                const total = rows.reduce((a, r) => a + num(r.views), 0);
                return barRows(rows, r => SUBS_LABEL[r.subscribedStatus] || r.subscribedStatus, 'views', (v) => `${fmtInt(v)}回`, total);
            }),
            job('ya-share', async () => {
                const rows = await typedSnap('share', { ...base, dimensions: ['sharingService'], metrics: ['shares'], sort: '-shares', max: 10 });
                return rows.length ? barRows(rows, r => SHARE_LABEL[r.sharingService] || r.sharingService, 'shares', (v) => `${fmtInt(v)}回`) : emptyHtml('共有のデータはありません');
            }),
            job('ya-loc', async () => {
                const rows = await typedSnap('loc', { ...base, dimensions: ['insightPlaybackLocationType'], metrics: ['views', 'estimatedMinutesWatched'], sort: '-views' });
                const total = rows.reduce((a, r) => a + num(r.views), 0);
                return barRows(rows, r => LOC_LABEL[r.insightPlaybackLocationType] || r.insightPlaybackLocationType, 'views', (v) => `${fmtInt(v)}回`, total);
            })
        ]);
    }

    async function loadRetention(videoId) {
        const range = currentRange(); if (range.error) return;
        const sec = box('ya-ret-card'); if (sec) { sec.hidden = false; sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        loading('ya-ret');
        const run = S.run;
        try {
            const [rows, info] = await Promise.all([
                report({ start: range.start, end: range.end, dimensions: ['elapsedVideoTimeRatio'], metrics: ['audienceWatchRatio', 'relativeRetentionPerformance'], filters: `video==${videoId};audienceType==ORGANIC`, sort: 'elapsedVideoTimeRatio' }),
                videoInfo([videoId])
            ]);
            if (run !== S.run) return;
            const v = info[videoId];
            if (!rows.length) { setBody('ya-ret', `<div class="ya-ret-title">${esc(v && v.title || videoId)}</div>${emptyHtml('この動画の視聴維持率はまだありません(視聴数が少ないと表示されません)')}`); return; }
            const last = rows[rows.length - 1];
            const rel = rows.reduce((a, r) => a + num(r.relativeRetentionPerformance), 0) / rows.length;
            const dur = v && v.dur;
            setBody('ya-ret', `<div class="ya-ret-title">${esc(v && v.title || videoId)}</div>
                <div class="ya-tiles ya-tiles-s"><div class="ya-tile"><div class="ya-tile-k">動画の終わりの時点まで見ていた人の割合</div><div class="ya-tile-v">${fmtPct(num(last.audienceWatchRatio) * 100)}</div></div>
                <div class="ya-tile"><div class="ya-tile-k">同じ長さの動画と比べた維持率</div><div class="ya-tile-v">${rel >= 0.5 ? '中央値より高め' : '中央値より低め'}</div><div class="ya-tile-s">指数 ${rel.toFixed(2)}(0〜1。0.5が中央値、1に近いほど同じ長さの動画より維持できています)</div></div></div>
                <div class="ya-chart"><canvas id="ya-ret-cv"></canvas></div>
                <div class="ya-note">横軸は動画の再生位置(${dur ? `全体 ${fmtDur(dur)}` : '0〜100%'})、縦軸は、その位置を見ていた人の割合です。右肩下がりが急な場所が、離脱の多い場所です。</div>`);
            makeChart('ret', box('ya-ret-cv'), { type: 'line', data: { labels: rows.map(r => dur ? fmtDur(num(r.elapsedVideoTimeRatio) * dur) : `${Math.round(num(r.elapsedVideoTimeRatio) * 100)}%`), datasets: [{ label: '視聴を続けていた人の割合(%)', borderColor: '#1C7ED6', backgroundColor: 'rgba(28,126,214,.12)', fill: true, pointRadius: 0, borderWidth: 2, data: rows.map(r => +(num(r.audienceWatchRatio) * 100).toFixed(1)) }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: '%' } }, x: { ticks: { maxTicksLimit: 10 } } } } });
        } catch (e) { if (run !== S.run) return; if (e.kind === 'bad') setBody('ya-ret', emptyHtml('この動画の視聴維持率は取得できませんでした')); else showErr('ya-ret', e); }
    }

    // ---------- サムネイルの表示回数・クリック率(YouTube Reporting API) ----------
    // この2つの数字は、通常の集計(Analytics API の reports.query)では取れず、Reporting API の「リーチレポート」で毎日CSVとして配られる。
    //   ・出典: https://developers.google.com/youtube/reporting/v1/reports (ジョブの作り方・ダウンロード・保管期間)
    //          https://developers.google.com/youtube/reporting/v1/reports/channel_reports (channel_reach_basic_a1: date, channel_id, video_id / video_thumbnail_impressions, video_thumbnail_impressions_ctr)
    //   ・流れ: ジョブを1回登録 → Googleが毎日1ファイル(太平洋時間の1日分)作る → このページが未保存の日だけダウンロードして、データベースに「月ごとに1行」で保存する。
    //   ・保管期間は60日(さかのぼり分は30日)なので、ためておかないと消える。保存するのは動画IDと数字だけで、ログイン情報は入れない。
    //   ・ログイン情報(アクセストークン)を送るのは youtubereporting.googleapis.com のURLだけ。
    const REPORTING = 'https://youtubereporting.googleapis.com/v1';
    const REACH_TYPE = 'channel_reach_basic_a1';
    const REACH_JOB_NAME = 'msm-reach-basic';
    const REACH_STORE = 'yt_reach_daily';   // { month:'2026-10', days:{ '2026-10-03': { 動画ID: [表示回数, クリック率(0〜1)] } }, updatedAt }
    const REACH_MAX_DL = 70;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function csvRows(text) {
        const t = String(text || '').replace(/^﻿/, '');
        const rows = []; let row = [], cur = '', q = false;
        const flush = () => { row.push(cur); cur = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; };
        for (let i = 0; i < t.length; i++) {
            const c = t[i];
            if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
            else if (c === '"') q = true;
            else if (c === ',') { row.push(cur); cur = ''; }
            else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; flush(); }
            else cur += c;
        }
        if (cur !== '' || row.length) flush();
        return rows;
    }
    // 1日分のCSV → { 動画ID: [表示回数, クリック率(0〜1)] }。動画IDが空の行(削除済みの動画など)は '_' にまとめる
    function parseReach(text) {
        const rows = csvRows(text);
        if (!rows.length) return {};   // 数字のない日は、見出し行だけ(または空)のファイルになる
        const head = rows[0].map(h => h.trim());
        const iV = head.indexOf('video_id'), iI = head.indexOf('video_thumbnail_impressions'), iC = head.indexOf('video_thumbnail_impressions_ctr');
        if (iV < 0 || iI < 0 || iC < 0) throw new ApiError(0, '', 'レポートの列が想定と違うため読み取れませんでした(video_id / video_thumbnail_impressions / video_thumbnail_impressions_ctr)', 'other');
        const body = rows.slice(1);
        // クリック率の単位は公式の定義に「割合(クリック÷表示)」とあるだけで保存形式の記載がないため、1を超える値があれば%表記とみなして100で割る
        const pct = body.some(r => num(r[iC]) > 1);
        const out = {};
        body.forEach(r => {
            const vid = (r[iV] || '').trim() || '_';
            const imp = num(r[iI]), ctr = num(r[iC]) / (pct ? 100 : 1);
            const o = out[vid] || (out[vid] = { imp: 0, clicks: 0 });
            o.imp += imp; o.clicks += imp * ctr;
        });
        return Object.fromEntries(Object.entries(out).map(([k, o]) => [k, [Math.round(o.imp), o.imp ? +(o.clicks / o.imp).toFixed(6) : 0]]));
    }

    async function fetchReportFile(url) {
        if (!/^https:\/\/youtubereporting\.googleapis\.com\//.test(String(url || ''))) throw new ApiError(0, '', '想定外のダウンロード先だったため中止しました', 'other');
        if (!tokenOk()) throw new ApiError(401, '', 'ログインが必要です。「Googleにログイン」を押してください', 'auth');
        let r;
        try { r = await fetch(url, { headers: { Authorization: 'Bearer ' + S.token } }); }
        catch (e) { throw new ApiError(0, '', 'レポートのファイルを、このブラウザから直接ダウンロードできませんでした(Googleがブラウザからのアクセスを許可していない可能性があります)', 'dl'); }
        const text = await r.text();
        if (!r.ok) throw classify(r.status, text);
        return text;
    }
    async function listJobs() {
        const out = []; let token = '';
        for (let i = 0; i < 10; i++) {
            const j = await api(`${REPORTING}/jobs?pageSize=100${token ? '&pageToken=' + encodeURIComponent(token) : ''}`);
            out.push(...(j.jobs || []));
            token = j.nextPageToken || ''; if (!token) break;
        }
        return out;
    }
    async function createReachJob() {
        try {
            return await api(`${REPORTING}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportTypeId: REACH_TYPE, name: REACH_JOB_NAME }) });
        } catch (e) {
            if (e.status === 409) return null;   // すでに登録済み
            throw e;
        }
    }
    async function listReports(jobId) {
        const out = []; let token = '';
        for (let i = 0; i < 10; i++) {
            const j = await api(`${REPORTING}/jobs/${encodeURIComponent(jobId)}/reports?pageSize=100${token ? '&pageToken=' + encodeURIComponent(token) : ''}`);
            out.push(...(j.reports || []));
            token = j.nextPageToken || ''; if (!token) break;
        }
        return out;
    }

    // ---- 保存(customers テーブル、service_type = yt_reach_daily。月ごとに1行) ----
    async function loadReachStore() {
        const rows = await Store.getCustomers(REACH_STORE);
        const byMonth = new Map(), days = {};
        rows.filter(r => r && typeof r.month === 'string' && r.days && typeof r.days === 'object').sort((a, b) => Number(a.id) - Number(b.id)).forEach(r => {
            if (!byMonth.has(r.month)) byMonth.set(r.month, r);
            Object.assign(days, r.days);
        });
        S.reach = { rows: byMonth, days };
    }
    async function saveReachDays(newDays) {
        const mem = { ...S.reach.days, ...newDays };
        const months = Array.from(new Set(Object.keys(newDays).map(d => d.slice(0, 7)))).sort();
        for (const month of months) {
            const md = Object.fromEntries(Object.entries(mem).filter(([d]) => d.startsWith(month)));
            const row = S.reach.rows.get(month);
            if (row) await Store.updateCustomer(REACH_STORE, row.id, { days: md, updatedAt: new Date().toISOString() });
            else { await Store.addCustomer(REACH_STORE, { month, days: md, updatedAt: new Date().toISOString() }); await sleep(15); }   // idは時刻から作られるため、連続保存で重ならないよう少し間をあける
        }
        await loadReachStore();
        const ok = Object.keys(newDays).every(d => d in S.reach.days);   // Storeは保存に失敗しても例外を出さないため、読み直して確認
        if (!ok) S.reach.days = mem;   // 保存できなかった分も、この画面では表示する
        return ok;
    }

    async function syncReach(job, run) {
        const info = S.reachInfo;
        const list = await listReports(job.id);
        const latest = new Map();   // 同じ日が複数ある(さかのぼり再作成)ときは、新しいものを使う
        list.forEach(r => {
            if (!r || !r.startTime || !r.downloadUrl) return;
            const d = ptFmt.format(new Date(r.startTime));
            const cur = latest.get(d);
            if (!cur || String(r.createTime) > String(cur.createTime)) latest.set(d, r);
        });
        info.available = latest.size;
        const need = Array.from(latest.entries()).filter(([d]) => !(d in S.reach.days)).sort((a, b) => b[0].localeCompare(a[0]));   // 新しい日から
        const batch = need.slice(0, REACH_MAX_DL);
        info.pending = need.length - batch.length;
        const got = {}; let idx = 0, done = 0, firstErr = null;
        const worker = async () => {
            while (idx < batch.length && !firstErr) {
                const [d, r] = batch[idx++];
                try { got[d] = parseReach(await fetchReportFile(r.downloadUrl)); }
                catch (e) { if (!firstErr) firstErr = e; }
                done++;
                if (run === S.run && batch.length > 3) setBody('ya-reach', `<div class="ya-loading"><i class="ph ph-spinner ph-spin"></i> 毎日のレポートを取り込んでいます… ${done}/${batch.length}</div>`);
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, batch.length) }, worker));
        if (run !== S.run) return;
        const keys = Object.keys(got);
        if (keys.length) { info.fetched = keys.length; if (!(await saveReachDays(got))) info.saveFailed = true; }
        if (firstErr) {
            if (!keys.length && ['auth', 'setup', 'scope'].includes(firstErr.kind)) throw firstErr;
            info.syncError = firstErr.message;
        }
    }

    const dateList = (start, end) => { const out = []; for (let d = start; d <= end; d = addDays(d, 1)) out.push(d); return out; };
    function reachAgg(dates, allow) {
        let imp = 0, clicks = 0, n = 0; const per = new Map();
        dates.forEach(d => {
            const day = S.reach.days[d]; if (!day) return; n++;
            Object.entries(day).forEach(([vid, v]) => {
                if (allow && (vid === '_' || !allow.has(vid))) return;
                const i = num(v[0]), c = i * num(v[1]); imp += i; clicks += c;
                const p = per.get(vid) || { imp: 0, clicks: 0 }; p.imp += i; p.clicks += c; per.set(vid, p);
            });
        });
        return { imp, clicks, ctr: imp ? clicks / imp * 100 : null, n, per };
    }

    async function loadReach(range, run, rankP) {
        loading('ya-reach');
        try {
            await loadReachStore();
            S.reachInfo = { hasJob: false, createTime: '', available: 0, fetched: 0, pending: 0, saveFailed: false, syncError: '' };
            const jobs = await listJobs();
            const job = jobs.find(j => j && j.reportTypeId === REACH_TYPE);
            if (job) { S.reachInfo.hasJob = true; S.reachInfo.createTime = job.createTime || ''; S.reachInfo.jobId = job.id; await syncReach(job, run); }
            if (run !== S.run) return;
            if (S.type !== 'all' && rankP) await rankP;
            if (run !== S.run) return;
            await renderReach(range, run);
        } catch (e) { if (run !== S.run) return; showErr('ya-reach', e); }
    }

    async function renderReach(range, run) {
        const el = box('ya-reach'); if (!el) return;
        const info = S.reachInfo || {};
        const stored = Object.keys(S.reach.days).sort();
        const warn = [];
        if (info.syncError) warn.push(`新しい日のレポートを取り込めませんでした: ${info.syncError}`);
        if (info.saveFailed) warn.push('取り込んだ数字をデータベースに保存できませんでした。この画面には表示していますが、レポートは60日で消えるため、通信状態を確認して画面を開き直してください。');
        if (info.pending > 0) warn.push(`まだ取り込めていない日が${info.pending}日分あります。もう一度「この条件で表示する」を押すと続きを取り込みます。`);
        const warnHtml = warn.map(w => `<div class="ya-warn">${esc(w)}</div>`).join('');
        if (!info.hasJob) {
            el.innerHTML = `${warnHtml}<div class="ya-note" style="margin:0 0 10px">サムネイルの表示回数・クリック率は、YouTubeが<b>毎日1回</b>まとめて作る専用のレポートからしか取れません。最初に1回だけ「集計の登録」をすると、登録の約2日後から数字が出はじめ、過去30日分もさかのぼって作られます。登録は、あとから変更・削除もできます。</div>
                ${stored.length ? `<div class="ya-note">保存済みの数字があります(${esc(fmtD(stored[0]))} 〜 ${esc(fmtD(stored[stored.length - 1]))})。</div>` : ''}
                <button type="button" class="btn-primary btn-sm" id="ya-reach-start">集計を登録する(1回だけ)</button> <span class="ya-msg" id="ya-reach-msg"></span>`;
            bindReach(range); return;
        }
        if (!stored.length && info.syncError) {
            el.innerHTML = `${warnHtml}<div class="ya-empty">集計は登録済みで、レポートも作られていますが、この画面に取り込めませんでした。</div>`;
            return;
        }
        if (!stored.length) {
            el.innerHTML = `${warnHtml}<div class="ya-empty">準備中です。集計を登録しました${info.createTime ? '(' + esc(String(info.createTime).slice(0, 10)) + ')' : ''}。最初の数字が出るまで、登録から最大約2日かかります。時間をおいて「この条件で表示する」を押してください。</div>`;
            return;
        }
        // 種別(ショート/ロング)で絞るときは、この期間に再生された動画の種別から判定する(表示されただけで再生されなかった動画は数えられない)
        let allow = null, typeNote = '';
        if (S.type !== 'all') {
            allow = new Set(((S.rank && S.rank.rows) || []).filter(r => r.creatorContentType === S.type).map(r => r.video));
            typeNote = `種別「${TYPES[S.type]}」を選んでいるときは、この期間に再生された${TYPES[S.type]}の動画だけで数えています(1回も再生されなかった動画の表示回数は含みません)。`;
        }
        const dates = dateList(range.start, range.end), pdates = dateList(range.prev.start, range.prev.end);
        const cur = reachAgg(dates, allow), prev = reachAgg(pdates, allow);
        if (!cur.n) {
            el.innerHTML = `${warnHtml}<div class="ya-empty">この期間の数字はまだ保存されていません(保存済み: ${esc(fmtD(stored[0]))} 〜 ${esc(fmtD(stored[stored.length - 1]))})。登録後に作られた日からたまります。</div>`;
            return;
        }
        const full = prev.n === range.len;
        const dImp = full ? delta(cur.imp, prev.imp) : null;
        let dCtr = null;
        if (full && prev.ctr != null && cur.ctr != null) { const d = +(cur.ctr - prev.ctr).toFixed(2); dCtr = { t: `${d > 0 ? '+' : ''}${d.toFixed(2)}pt`, cls: d > 0 ? 'up' : (d < 0 ? 'down' : 'flat') }; }
        const tile = (k, v, s, d) => `<div class="ya-tile"><div class="ya-tile-k">${k}</div><div class="ya-tile-v">${v}</div><div class="ya-tile-s">${s}</div>${d ? `<div class="ya-tile-d ${d.cls}">前の期間比 ${esc(d.t)}</div>` : ''}</div>`;
        const tiles = `<div class="ya-tiles ya-tiles-s">${tile('サムネイルの表示回数', fmtInt(cur.imp), `${cur.n}/${range.len}日分のデータ`, dImp)}${tile('クリック率', cur.ctr == null ? '-' : fmtPct(cur.ctr, 2), '表示されたうち、クリックされた割合', dCtr)}</div>`;
        // 動画ごとの表
        const sortKey = S.reachSort || 'imp', shownN = S.reachShown || 20, avg = cur.ctr;
        const vids = Array.from(cur.per.entries()).filter(([v]) => v !== '_').map(([v, p]) => ({ video: v, imp: p.imp, ctr: p.imp ? p.clicks / p.imp * 100 : 0 }));
        vids.sort((a, b) => sortKey === 'ctrHigh' ? b.ctr - a.ctr : (sortKey === 'ctrLow' ? a.ctr - b.ctr : b.imp - a.imp));
        const shown = vids.slice(0, shownN);
        const infoMap = await videoInfo(shown.map(v => v.video));
        if (run != null && run !== S.run) return;
        const views = new Map(((S.rank && S.rank.rows) || []).map(r => [r.video, num(r.views)]));
        const unknown = cur.per.get('_');
        const head = `<div class="ya-ctl"><label>並び順 <select id="ya-reachsort">${[['imp', '表示回数が多い順'], ['ctrHigh', 'クリック率が高い順'], ['ctrLow', 'クリック率が低い順']].map(([k, v]) => `<option value="${k}" ${sortKey === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label><span class="ya-note">表示回数が少ない動画は、クリック率が大きくぶれます。</span></div>`;
        const table = vids.length ? `<div class="ya-table-wrap"><table class="ya-table ya-table-r"><thead><tr><th>#</th><th>動画</th><th>表示回数</th><th>クリック率</th><th>平均との差</th><th>再生数</th></tr></thead><tbody>
            ${shown.map((r, i) => { const v = infoMap[r.video]; const title = v && v.title ? v.title : r.video; const d = avg == null ? null : +(r.ctr - avg).toFixed(2); return `<tr><td>${i + 1}</td>
                <td class="ya-vcell">${v && v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy">` : '<span class="ya-noimg"></span>'}<div><a href="https://www.youtube.com/watch?v=${encodeURIComponent(r.video)}" target="_blank" rel="noopener">${esc(title)}</a><div class="ya-sub">${v && v.publishedAt ? esc(v.publishedAt.slice(0, 10)) + ' 公開' : ''}</div></div></td>
                <td>${fmtInt(r.imp)}</td><td>${fmtPct(r.ctr, 2)}</td><td class="${d == null ? '' : (d > 0 ? 'ya-up' : (d < 0 ? 'ya-down' : ''))}">${d == null ? '-' : (d > 0 ? '+' : '') + d.toFixed(2) + 'pt'}</td><td>${views.has(r.video) ? fmtInt(views.get(r.video)) : '-'}</td></tr>`; }).join('')}
            </tbody></table></div>${vids.length > shown.length ? `<div class="ya-more"><button type="button" class="btn-secondary btn-sm" id="ya-reach-more">もっと見る(${shown.length}/${vids.length})</button></div>` : ''}` : emptyHtml();
        el.innerHTML = `${warnHtml}${tiles}
            <div class="ya-chart ya-chart-s"><canvas id="ya-reach-cv"></canvas></div>
            ${head}${table}
            <div class="ya-note">${unknown ? `動画が特定できない分(削除された動画など)の表示回数 ${fmtInt(unknown.imp)} 回は、上の合計には入っていますが、表には出していません。<br>` : ''}${esc(typeNote)}${typeNote ? '<br>' : ''}保存済みの日: ${esc(fmtD(stored[0]))} 〜 ${esc(fmtD(stored[stored.length - 1]))}(${stored.length}日分)。数字は、YouTubeが毎日作るレポートを取り込んでデータベースにためたものです。最初のうちは、YouTube Studioの数字と見比べて、単位や大きさが合っているか確認してください。</div>`;
        const series = dates.map(d => { const a = reachAgg([d], allow); return a.n ? a : null; });
        makeChart('reach', box('ya-reach-cv'), { type: 'bar', data: { labels: dates.map(d => bucketLabel(d, 'day')), datasets: [
            { type: 'bar', label: '表示回数', yAxisID: 'y', backgroundColor: 'rgba(116,192,252,.7)', data: series.map(a => a ? a.imp : null) },
            { type: 'line', label: 'クリック率(%)', yAxisID: 'y1', borderColor: '#E8590C', backgroundColor: '#E8590C', pointRadius: 2, borderWidth: 2, spanGaps: false, data: series.map(a => a && a.ctr != null ? +a.ctr.toFixed(2) : null) }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, title: { display: true, text: '表示回数' } }, y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'クリック率(%)' } }, x: { ticks: { maxTicksLimit: 12 } } } } });
        // AI分析に渡す要約(画面のメモリだけ)
        const ids = vids.slice().sort((a, b) => b.imp - a.imp).slice(0, 10);
        const low = vids.slice().sort((a, b) => b.imp - a.imp).slice(0, 30).sort((a, b) => a.ctr - b.ctr).slice(0, 5);
        await videoInfo(Array.from(new Set([...ids, ...low].map(v => v.video))));
        const f = (v) => { const x = S.vcache.get('v:' + v.video) || {}; return { 題名: x.title || v.video, 表示回数: Math.round(v.imp), クリック率_パーセント: +v.ctr.toFixed(2), 再生数: views.has(v.video) ? views.get(v.video) : null }; };
        S.snap.reach = { 注意: 'YouTube上でサムネイルが表示された回数と、そのクリック率', 今期: { 表示回数: Math.round(cur.imp), クリック率_パーセント: cur.ctr == null ? null : +cur.ctr.toFixed(2), データのある日数: cur.n, 期間の日数: range.len }, 前の期間: full ? { 表示回数: Math.round(prev.imp), クリック率_パーセント: prev.ctr == null ? null : +prev.ctr.toFixed(2) } : '前の期間は数字がそろっていないため比較なし', 表示回数の多い上位10本: ids.map(f), 表示回数上位30本のうちクリック率の低い5本: low.map(f) };
        aiRefresh();
        bindReachTable();
    }
    function bindReachTable() {
        const sel = box('ya-reachsort');
        if (sel) sel.addEventListener('change', (e) => { S.reachSort = e.target.value; S.reachShown = 20; const r = currentRange(); if (!r.error) renderReach(r, S.run); });
        const more = box('ya-reach-more');
        if (more) more.addEventListener('click', () => { S.reachShown = (S.reachShown || 20) + 20; const r = currentRange(); if (!r.error) renderReach(r, S.run); });
    }
    function bindReach(range) {
        const start = box('ya-reach-start');
        if (start) start.addEventListener('click', async () => {
            const m = box('ya-reach-msg'); start.disabled = true;
            if (m) { m.textContent = '登録しています…'; m.className = 'ya-msg'; }
            try { await createReachJob(); const r = currentRange(); if (!r.error) { await loadReach(r, S.run, null); } }
            catch (e) { if (m) { m.textContent = e.message || '登録できませんでした'; m.className = 'ya-msg err'; } start.disabled = false; if (e && e.kind === 'setup') showErr('ya-reach', e); }
        });
    }

    // ---------- AI分析(仮説と対策) ----------
    // 画面に出ている数字をOpenAIに渡し、分析・仮説・対策案を文章で返してもらう。AIの返答は「仮説」であり、事実ではない。
    //   ・APIキーは他のAI画面(テロップ生成・AI企画室)と同じく、このブラウザの保存領域にある「openai_api_key」を使う。データベースには入れない。
    //   ・送る内容: 期間・種別、チャンネルの数字、動画の題名と数字、流入元や視聴者の集計。Googleのログイン情報や個人の情報は送らない。
    //   ・呼び出し: Responses API(構造化出力 text.format=json_schema)。 https://developers.openai.com/api/docs/guides/structured-outputs
    const AI_URL = 'https://api.openai.com/v1/responses';
    const AI_MODELS = [['gpt-6.1-sol', 'バランス型(おすすめ)'], ['gpt-6-astra', '最高性能(費用は高め)'], ['gpt-6-luna', '高速・低コスト']];
    const AI_KEY_NAME = 'openai_api_key';
    const AI_HISTORY_TYPE = 'yt_ai_analysis';
    const AREAS = ['全体の推移', '動画ごとの違い', '流入元', '視聴者の特徴', '登録者・共有・反応', 'お問い合わせ・集客への導線'];
    const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
    const strArr = { type: 'array', items: { type: 'string' } };
    const levelEnum = { type: 'string', enum: ['高', '中', '低'] };
    const AI_SCHEMA = {
        type: 'object', additionalProperties: false, required: ['summary', 'sections', 'top_priorities', 'experiments', 'caveats'],
        properties: {
            summary: { type: 'string' },
            sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['area', 'facts', 'why', 'hypothesis', 'actions', 'pitfalls', 'confidence'], properties: {
                area: { type: 'string', enum: AREAS },
                facts: strArr, why: strArr, hypothesis: { type: 'string' },
                actions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['what', 'priority', 'measure'], properties: { what: { type: 'string' }, priority: levelEnum, measure: { type: 'string' } } } },
                pitfalls: { type: 'string' }, confidence: levelEnum
            } } },
            top_priorities: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['action', 'reason'], properties: { action: { type: 'string' }, reason: { type: 'string' } } } },
            experiments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['what', 'hypothesis', 'success_metric'], properties: { what: { type: 'string' }, hypothesis: { type: 'string' }, success_metric: { type: 'string' } } } },
            caveats: strArr
        }
    };
    const aiInstructions = (extra) => `あなたはYouTubeチャンネル運用の分析担当です。渡されたJSONは、あるチャンネルのYouTube Analyticsの集計です。
目的は「チャンネルを、事業のお問い合わせ・集客につなげること」です。この目的に照らして分析し、仮説と対策を日本語で出してください。
${extra ? `\n【運営者からの補足(事業・発信内容・想定する視聴者)】\n${extra}\n` : ''}
守ること:
1. 根拠にしてよいのは、渡されたJSONの数字だけです。JSONにない数字を作らないでください。数字から言えることは「事実(facts)」に、数字から推測したことは「仮説(hypothesis)」に分けて書き、仮説には「仮説」とわかる書き方をしてください。
2. 各項目(area)ごとに、次を出してください。
   - facts: 数字つきの事実(例: 「再生数は前の期間比で+12.3%」)。
   - why: 理由を3階層で書く。1つ目=直接の原因、2つ目=その背景にある仕組み、3つ目=さらに根本にある理由(YouTubeの仕組みや視聴者の行動など)。必ず3つ。
   - hypothesis: 検証できる形の仮説。
   - actions: 次の投稿から実行できる具体的な対策。優先度(高・中・低)と、効果をどの数字で確認するか(measure)を必ず付ける。
   - pitfalls: その対策や見方の落とし穴(やりがちな失敗、数字の読み違い)。
   - confidence: 結論の確からしさ。再生数や登録者の数が少ないとき(目安: 数十回以下)は、断定せず「低」にする。
3. 6つの項目(全体の推移 / 動画ごとの違い / 流入元 / 視聴者の特徴 / 登録者・共有・反応 / お問い合わせ・集客への導線)をすべて出してください。データが無い項目は、factsに「データなし」と書き、その理由と、代わりに見るべき数字を書いてください。
4. 「お問い合わせ・集客への導線」では、YouTubeの数字だけでは問い合わせ数は分からない点を明記し、動画の説明欄・固定コメント・プロフィール・動画内での案内など、問い合わせにつなげる具体策と、その効果を測る方法(例: 専用リンクの計測)を示してください。
5. top_priorities は、最優先の対策を最大3つ(理由つき)。experiments は、次の1〜2週間で試す小さな実験を最大3つ(仮説と、成功の判定に使う数字つき)。
6. caveats には、この分析の限界(期間の短さ、サンプルの少なさ、取得できなかったデータ、因果と相関の違いなど)を書いてください。
7. 専門用語には短い説明を添えてください。励ましや一般論は不要です。この数字から言えることだけを書いてください。
8. 「サムネイルの表示回数とクリック率」が含まれている場合は、「動画ごとの違い」や「流入元」で使ってください。表示回数が多いのにクリック率が低い動画は、サムネイルや題名が見る人に響いていない可能性がある、という見方ができます(仮説として書くこと)。クリック率は、表示される場所(ホーム・検索・関連動画)で大きく違うため、動画どうしの比較は慎重に書いてください。表示回数が少ない動画のクリック率はぶれやすい点も、落とし穴に書いてください。`;

    async function buildPacket() {
        const sm = S.snap.summary; if (!sm) return null;
        const r = sm.range, round = (v, d = 1) => (v == null || !Number.isFinite(Number(v))) ? null : +Number(v).toFixed(d);
        const m = (x, ad, ap) => ({ 再生数: x.views, 総再生時間_分: round(x.estimatedMinutesWatched), 平均視聴時間_秒: round(ad), 平均視聴率_パーセント: round(ap), いいね: x.likes, コメント: x.comments, 共有: x.shares, 登録者増: x.subscribersGained, 登録者減: x.subscribersLost });
        const pct = (c, p) => p ? round((c - p) / p * 100) : null;
        const out = {
            期間: { 開始: r.start, 終了: r.end, 日数: r.len, 前の期間: { 開始: r.prev.start, 終了: r.prev.end }, 日付の基準: '太平洋時間' },
            種別: S.type === 'all' ? 'すべて(ショートとロングの合計)' : TYPES[S.type],
            今期: m(sm.cur, sm.avgDurCur, sm.avgPctCur), 前の期間: m(sm.prev, sm.avgDurPrev, sm.avgPctPrev),
            前の期間との増減率_パーセント: { 再生数: pct(sm.cur.views, sm.prev.views), 総再生時間: pct(sm.cur.estimatedMinutesWatched, sm.prev.estimatedMinutesWatched), 平均視聴時間: pct(sm.avgDurCur, sm.avgDurPrev), いいね: pct(sm.cur.likes, sm.prev.likes), コメント: pct(sm.cur.comments, sm.prev.comments), 共有: pct(sm.cur.shares, sm.prev.shares) }
        };
        if (S.channel) { const st = S.channel.statistics || {}; out.チャンネル全体 = { 登録者数: st.hiddenSubscriberCount ? '非公開' : Number(st.subscriberCount), 総再生回数: Number(st.viewCount), 動画数: Number(st.videoCount) }; }
        // 推移(短い期間は週ごと、長い期間は月ごと)
        if (S.series) {
            const gran = r.len <= 120 ? 'week' : 'month';
            const keys = Array.from(new Set(S.series.rows.map(x => bucketKey(x.day, gran)))).sort();
            out.推移 = { まとめ方: gran === 'week' ? '週ごと(月曜はじまり)' : '月ごと', 行: keys.map(k => {
                const rows = S.series.rows.filter(x => bucketKey(x.day, gran) === k); const row = { 開始: k };
                if (S.series.byType && S.type === 'all') { row.ショート再生数 = sumBy(rows.filter(x => x.creatorContentType === 'SHORTS'), ['views']).views; row.ロング再生数 = sumBy(rows.filter(x => x.creatorContentType === 'VIDEO_ON_DEMAND'), ['views']).views; }
                const t = sumBy(S.series.byType && S.type !== 'all' ? rows.filter(x => x.creatorContentType === S.type) : rows, SUM_METRICS);
                row.再生数 = t.views; row.総再生時間_分 = round(t.estimatedMinutesWatched); row.登録者の増減 = t.subscribersGained - t.subscribersLost; row.いいね = t.likes; return row; }) };
        }
        // 動画(上位10・下位5)
        if (S.rank) {
            const all = S.rank.rows.filter(x => S.type === 'all' || x.creatorContentType === S.type).sort((a, b) => num(b.views) - num(a.views));
            const pick15 = [...all.slice(0, 10), ...(all.length > 15 ? all.slice(-5) : [])];
            await videoInfo(pick15.map(x => x.video));   // 題名が分からない動画(下位など)は、ここで取得しておく
            const f = (x) => { const v = S.vcache.get('v:' + x.video) || {}; return { 題名: v.title || x.video, 種別: TYPE_LABEL[x.creatorContentType] || x.creatorContentType, 公開日: v.publishedAt ? v.publishedAt.slice(0, 10) : null, 長さ_秒: v.dur == null ? null : v.dur, 再生数: num(x.views), 総再生時間_分: round(x.estimatedMinutesWatched), 平均視聴時間_秒: round(x.averageViewDuration), 平均視聴率_パーセント: x.averageViewPercentage == null ? null : round(x.averageViewPercentage), いいね: num(x.likes), コメント: x.comments == null ? null : num(x.comments), 共有: x.shares == null ? null : num(x.shares), 登録者増: num(x.subscribersGained) }; };
            out.動画 = { この期間に見られた動画の本数: all.length, 上位10本: all.slice(0, 10).map(f), 下位5本: all.length > 15 ? all.slice(-5).map(f) : [] };
        }
        const L = (rows, label, key, keyName) => rows.map(x => ({ [keyName]: label(x), 再生数: key === 'shares' ? undefined : num(x.views), 総再生時間_分: key === 'shares' ? undefined : round(x.estimatedMinutesWatched), 共有数: key === 'shares' ? num(x.shares) : undefined }));
        const missing = [];
        const take = (key, name, fn) => { if (S.snap[key]) out[name] = fn(S.snap[key]); else missing.push(name); };
        take('src', '流入元', rows => L(rows, x => SRC_LABEL[x.insightTrafficSourceType] || x.insightTrafficSourceType, 'views', '流入元'));
        take('kw', '検索キーワード上位', rows => L(rows, x => x.insightTrafficSourceDetail, 'views', 'キーワード'));
        take('ext', '外部サイト・アプリ上位', rows => L(rows, x => x.insightTrafficSourceDetail, 'views', '流入元'));
        take('demo', '年齢と性別(視聴者の割合)', rows => rows.map(x => ({ 年齢: AGE_LABEL[x.ageGroup] || x.ageGroup, 性別: GENDER_LABEL[x.gender] || x.gender, 割合_パーセント: round(x.viewerPercentage) })));
        take('country', '国・地域上位', rows => L(rows, x => regionName(x.country), 'views', '国'));
        take('device', '端末', rows => L(rows, x => DEVICE_LABEL[x.deviceType] || x.deviceType, 'views', '端末'));
        take('subs', '登録者か否か', rows => L(rows, x => SUBS_LABEL[x.subscribedStatus] || x.subscribedStatus, 'views', '区分'));
        take('share', '共有された先上位', rows => L(rows, x => SHARE_LABEL[x.sharingService] || x.sharingService, 'shares', '共有先'));
        take('loc', '再生された場所', rows => L(rows, x => LOC_LABEL[x.insightPlaybackLocationType] || x.insightPlaybackLocationType, 'views', '場所'));
        take('reach', 'サムネイルの表示回数とクリック率', x => x);
        if (missing.length) out.取得できなかったデータ = missing;
        return JSON.parse(JSON.stringify(out));   // undefined を除く
    }

    async function callAi(packet, extra, model, key) {
        const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 180000);
        let r;
        try {
            r = await fetch(AI_URL, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({
                model, max_output_tokens: 12000,
                input: [{ role: 'system', content: aiInstructions(extra) }, { role: 'user', content: '次のデータを分析してください。\n' + JSON.stringify(packet) }],
                text: { format: { type: 'json_schema', name: 'channel_analysis', strict: true, schema: AI_SCHEMA } }
            }) });
        } catch (e) { throw new Error(e && e.name === 'AbortError' ? 'AIの応答に時間がかかりすぎました(3分)。もう一度試してください' : 'AIに接続できませんでした。通信状態を確認してください'); }
        finally { clearTimeout(timer); }
        const text = await r.text();
        let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
        if (!r.ok) {
            const msg = j && j.error && j.error.message ? j.error.message : '';
            if (r.status === 401) throw new Error('OpenAIのAPIキーが正しくありません。キーを入れ直してください');
            if (r.status === 429) throw new Error('OpenAIの利用上限か、混雑のため受け付けられませんでした。少し待つか、利用枠を確認してください' + (msg ? `(${msg})` : ''));
            if (r.status === 404 || /model/i.test(msg)) throw new Error(`選んだAIモデルが使えません。別のモデルを選んでください${msg ? `(${msg})` : ''}`);
            throw new Error(`AIから結果を受け取れませんでした(${r.status}${msg ? ': ' + msg : ''})`);
        }
        if (!j) throw new Error('AIの応答を読み取れませんでした');
        if (j.status === 'incomplete') throw new Error('AIの回答が長すぎて途中で終わりました。期間を短くするか、種別を絞ってもう一度試してください');
        const msgItem = (j.output || []).find(o => o.type === 'message');
        const parts = (msgItem && msgItem.content) || [];
        if (parts.some(c => c.type === 'refusal')) throw new Error('AIがこの依頼に回答できませんでした');
        const ot = parts.find(c => c.type === 'output_text');
        if (!ot || !ot.text) throw new Error('AIの応答に回答が含まれていませんでした');
        let res; try { res = JSON.parse(ot.text); } catch (e) { throw new Error('AIの回答の形式が正しくありませんでした。もう一度試してください'); }
        if (!res || !Array.isArray(res.sections)) throw new Error('AIの回答の形式が正しくありませんでした。もう一度試してください');
        return res;
    }
    const lv = (v) => `<span class="ya-lv ya-lv-${v === '高' ? 'h' : (v === '中' ? 'm' : 'l')}">${esc(v)}</span>`;
    const ul = (arr) => (arr && arr.length) ? `<ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
    function aiHtml(res, meta) {
        const secs = AREAS.map(a => (res.sections || []).find(x => x.area === a)).filter(Boolean);
        return `<div class="ya-ai-meta">${esc(meta)}<br>※ AIが数字から考えた<b>仮説</b>です。事実とは限りません。実際に試して、数字で確かめてください。</div>
            <div class="ya-ai-sum">${esc(res.summary)}</div>
            ${(res.top_priorities || []).length ? `<div class="ya-ai-box ya-ai-pri"><div class="ya-ai-t">まず取り組むこと</div><ol>${res.top_priorities.map(x => `<li><b>${esc(x.action)}</b><br><span>${esc(x.reason)}</span></li>`).join('')}</ol></div>` : ''}
            ${secs.map(x => `<div class="ya-ai-sec"><div class="ya-ai-t">${esc(x.area)} <span class="ya-ai-conf">確からしさ ${lv(x.confidence)}</span></div>
                <div class="ya-ai-k">事実(数字)</div>${ul(x.facts)}
                <div class="ya-ai-k">なぜそうなっているか(3階層)</div><ol>${(x.why || []).map(w => `<li>${esc(w)}</li>`).join('')}</ol>
                <div class="ya-ai-k">仮説</div><p>${esc(x.hypothesis)}</p>
                <div class="ya-ai-k">対策</div>${(x.actions || []).length ? `<ul>${x.actions.map(a => `<li>${lv(a.priority)} <b>${esc(a.what)}</b><br><span class="ya-ai-measure">確認する数字: ${esc(a.measure)}</span></li>`).join('')}</ul>` : ''}
                <div class="ya-ai-k">落とし穴</div><p>${esc(x.pitfalls)}</p></div>`).join('')}
            ${(res.experiments || []).length ? `<div class="ya-ai-box"><div class="ya-ai-t">次の1〜2週間で試す実験</div><ul>${res.experiments.map(x => `<li><b>${esc(x.what)}</b><br><span>仮説: ${esc(x.hypothesis)}</span><br><span class="ya-ai-measure">成功の判定: ${esc(x.success_metric)}</span></li>`).join('')}</ul></div>` : ''}
            ${(res.caveats || []).length ? `<div class="ya-ai-box ya-ai-cav"><div class="ya-ai-t">この分析の限界</div>${ul(res.caveats)}</div>` : ''}`;
    }
    async function loadAiHistory() {
        try { const rows = await Store.getCustomers(AI_HISTORY_TYPE); S.aiHist = rows.filter(r => r && r.result && r.createdAt).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 10); }
        catch (e) { S.aiHist = []; }
    }
    function histHtml() {
        if (!S.aiHist || !S.aiHist.length) return '<div class="ya-empty">保存された分析はまだありません</div>';
        return `<ul class="ya-hist">${S.aiHist.map(h => `<li><button type="button" class="btn-secondary btn-sm" data-ya-hist="${esc(h.id)}">開く</button> ${esc(String(h.createdAt).slice(0, 16).replace('T', ' '))} ・ ${esc(h.rangeStart)} 〜 ${esc(h.rangeEnd)} ・ ${esc(h.typeLabel || '')} ・ ${esc(h.model || '')}</li>`).join('')}</ul>`;
    }
    function aiReset() { S.aiBusy = false; const o = box('ya-ai-out'); if (o) o.innerHTML = ''; aiRefresh(); }
    function aiRefresh() {
        const b = box('ya-ai-run'); if (!b) return;
        b.disabled = S.aiBusy || !S.snap.summary;
        const k = box('ya-ai-keybox'); if (k) k.hidden = !!lsGet(AI_KEY_NAME);
    }
    async function runAi() {
        const out = box('ya-ai-out'), msg = box('ya-ai-msg');
        const setMsg = (t, c) => { if (msg) { msg.textContent = t || ''; msg.className = 'ya-msg ' + (c || ''); } };
        const key = lsGet(AI_KEY_NAME);
        if (!key) { setMsg('先にOpenAIのAPIキーを保存してください', 'err'); return; }
        let packet = null;
        try { packet = await buildPacket(); } catch (e) { setMsg('数字の準備でエラーが出ました: ' + (e.message || ''), 'err'); S.aiBusy = false; aiRefresh(); return; }
        if (!packet) { setMsg('先に数字を表示してください(「この条件で表示する」)', 'err'); return; }
        const extra = (box('ya-ai-goal').value || '').trim().slice(0, 2000);
        const model = box('ya-ai-model').value; S.aiModel = model; lsSet('ya_ai_model', model); lsSet('ya_ai_goal', extra);
        S.aiBusy = true; aiRefresh(); setMsg('', '');
        out.innerHTML = '<div class="ya-loading"><i class="ph ph-spinner ph-spin"></i> AIが分析しています(1〜2分かかることがあります)…</div>';
        const range = S.snap.summary.range, run = S.run;
        try {
            const res = await callAi(packet, extra, model, key);
            if (run !== S.run) return;
            const typeLabel = S.type === 'all' ? 'すべて' : TYPES[S.type];
            const meta = `${fmtD(range.start)} 〜 ${fmtD(range.end)} ・ 種別: ${typeLabel} ・ モデル: ${model}`;
            out.innerHTML = aiHtml(res, meta);
            if (box('ya-ai-save').checked) {
                try {
                    const createdAt = new Date().toISOString();
                    await Store.addCustomer(AI_HISTORY_TYPE, { createdAt, model, rangeStart: range.start, rangeEnd: range.end, typeLabel, goal: extra, result: res });
                    await loadAiHistory();
                    if (!S.aiHist.some(h => h.createdAt === createdAt)) throw new Error('not saved');   // Storeは保存に失敗しても例外を出さないため、読み直して確認
                    const hb = box('ya-ai-hist'); if (hb) hb.innerHTML = histHtml(); bindHist();
                    setMsg('分析結果を保存しました', 'ok');
                } catch (e) { setMsg('分析はできましたが、結果を保存できませんでした(この画面にはそのまま表示しています)', 'err'); }
            }
        } catch (e) { if (run === S.run) { out.innerHTML = `<div class="ya-err">${esc(e.message || 'AI分析に失敗しました')}</div>`; } }
        finally { S.aiBusy = false; aiRefresh(); }
    }
    function bindHist() {
        document.querySelectorAll('[data-ya-hist]').forEach(b => b.addEventListener('click', () => {
            const h = (S.aiHist || []).find(x => String(x.id) === b.dataset.yaHist); if (!h) return;
            const o = box('ya-ai-out'); o.innerHTML = aiHtml(h.result, `保存済みの分析(${String(h.createdAt).slice(0, 16).replace('T', ' ')}) ・ ${h.rangeStart} 〜 ${h.rangeEnd} ・ 種別: ${h.typeLabel || ''} ・ モデル: ${h.model || ''}`);
            o.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));
    }

    // ---------- 画面全体 ----------
    function refreshLogin() {
        const ls = box('ya-login-state'); if (!ls) return;
        ls.textContent = tokenOk() ? 'ログイン中(この画面を開いている間だけ有効です)' : (S.clientId ? '未ログイン' : 'クライアント ID を保存してください');
        ls.className = 'ya-login-state' + (tokenOk() ? ' ok' : '');
        const b = box('ya-load'); if (b) b.disabled = !tokenOk();
    }
    function resetSections() {
        ['ya-summary', 'ya-trend', 'ya-rank', 'ya-src', 'ya-kw', 'ya-ext', 'ya-demo', 'ya-country', 'ya-device', 'ya-subs', 'ya-share', 'ya-loc', 'ya-channel', 'ya-reach'].forEach(id => setBody(id, ''));
        Object.keys(charts).forEach(destroyChart);
        const r = box('ya-ret-card'); if (r) r.hidden = true;
    }
    async function runAll() {
        const range = currentRange();
        const msg = box('ya-range-msg');
        if (range.error) { if (msg) { msg.textContent = range.error; msg.className = 'ya-msg err'; } return; }
        if (msg) { msg.textContent = `${fmtD(range.start)} 〜 ${fmtD(range.end)}(${range.len}日間・太平洋時間の日付)`; msg.className = 'ya-msg'; }
        if (!tokenOk()) { refreshLogin(); return; }
        const run = ++S.run;
        S.rankShown = 20; S.snap = {};
        aiReset();
        const r = box('ya-ret-card'); if (r) r.hidden = true;
        S.reachShown = 20;
        const rankP = loadRank(range, run);
        await Promise.all([loadChannel(), loadSummary(range, run), rankP, loadSources(range, run), loadAudience(range, run), loadReach(range, run, rankP)]);
    }

    App.Pages.youtube_analytics = async function () {
        const user = Auth.getCurrentUser();
        if (!user || user.role !== 'admin') {
            App.mount('<div class="card"><p>閲覧権限がありません。YouTube分析データを見られるのは管理者だけです。</p></div>');
            return;
        }
        try { await Promise.all([loadClientId(), loadAiHistory()]); }
        catch (e) { App.mount(`<div class="card"><p>設定を読み込めませんでした: ${esc(e.message || '')}</p></div>`); return; }
        const presets = [['7d', '直近7日'], ['28d', '直近28日'], ['90d', '直近90日'], ['365d', '直近365日'], ['thisMonth', '今月'], ['lastMonth', '先月'], ['custom', '日付を指定']];
        const html = `
        <div class="ya-wrap">
            <details class="card ya-card" id="ya-setup" ${S.clientId ? '' : 'open'}>
                <summary class="ya-h">使う前の準備(最初の1回だけ)</summary>
                <ol class="ya-steps">
                    <li>Google Cloud(console.cloud.google.com)で、ショート投稿予約と同じプロジェクトを開きます。</li>
                    <li>「API とサービス」→「ライブラリ」で、<b>「YouTube Analytics API」</b>・<b>「YouTube Data API v3」</b>・<b>「YouTube Reporting API」</b>の3つを「有効にする」にします(Reporting APIは、サムネイルの表示回数・クリック率に使います)。</li>
                    <li>「Google Auth Platform」→「データアクセス」で、次の2つの許可を追加しておくと確実です(ログインで「アクセスをブロック」と出たとき): <code>yt-analytics.readonly</code> と <code>youtube.readonly</code>。</li>
                    <li>「Googleのクライアント ID」を、下の欄に貼って保存します(ショート投稿予約の設定と共通です)。</li>
                    <li>「Googleにログイン」を押し、チャンネルを持つアカウントで、表示された項目すべてにチェックを入れて「続行」します。</li>
                </ol>
                <div class="ya-note">この画面は<b>読み取り専用</b>です。動画の投稿・変更・削除はできません。収益のデータは読み取らない設定にしています。</div>
            </details>

            <div class="card ya-card">
                <div class="ya-h">ログイン</div>
                <div class="ya-row">
                    <input type="text" id="ya-client" value="${esc(S.clientId)}" placeholder="1234567890-xxxx.apps.googleusercontent.com" autocomplete="off">
                    <button type="button" class="btn-secondary btn-sm" id="ya-save-client">クライアント IDを保存</button>
                    <span class="ya-msg" id="ya-client-msg"></span>
                </div>
                <div class="ya-row">
                    <button type="button" class="btn-primary" id="ya-login"><i class="ph ph-google-logo"></i> Googleにログイン</button>
                    <span class="ya-login-state" id="ya-login-state"></span>
                    <span class="ya-msg" id="ya-login-msg"></span>
                </div>
            </div>

            <div class="card ya-card">
                <div class="ya-h">期間と種別</div>
                <div class="ya-row">
                    <label>期間 <select id="ya-preset">${presets.map(([k, v]) => `<option value="${k}" ${S.preset === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
                    <span id="ya-custom" ${S.preset === 'custom' ? '' : 'hidden'}><input type="date" id="ya-start" value="${esc(S.start)}"> 〜 <input type="date" id="ya-end" value="${esc(S.end)}"></span>
                    <label>種別 <select id="ya-type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${S.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
                    <button type="button" class="btn-primary btn-sm" id="ya-load" disabled>この条件で表示する</button>
                    <span class="ya-msg" id="ya-range-msg"></span>
                </div>
                <div class="ya-note">日付はYouTube Analyticsの基準(太平洋時間の1日)です。日本時間とは半日ほどずれます。直近1〜2日分はまだ集計中のため、最新日は「昨日(太平洋時間)」までです。数字はYouTube Studioと近い値になりますが、完全に一致するとは限りません。</div>
            </div>

            <div class="card ya-card"><div class="ya-h">チャンネル</div><div id="ya-channel"></div></div>
            <div class="card ya-card"><div class="ya-h">サマリー</div><div id="ya-summary"></div></div>
            <div class="card ya-card"><div class="ya-h">推移</div><div id="ya-trend"></div></div>
            <div class="card ya-card" id="ya-ai-card">
                <div class="ya-h">AI分析(仮説と対策)</div>
                <div class="ya-note" style="margin-top:0">いま表示している数字をAI(OpenAI)に渡して、分析・仮説・対策案を文章で出します。目的は「お問い合わせ・集客につなげること」で見ます。
                    <br>AIに送る内容: 期間・種別、チャンネルの数字、動画の題名と数字、流入元や視聴者の集計。Googleのログイン情報や、個人を特定する情報は送りません。</div>
                <div class="form-group" style="margin:12px 0 0"><label style="font-size:0.8rem;color:var(--text-secondary)">補足(任意): 扱っているサービス・発信内容・想定する視聴者・いまの悩みなど。書くほど具体的な提案になります</label>
                    <textarea id="ya-ai-goal" rows="3" maxlength="2000" placeholder="例: MEO対策の集客支援をしている。店舗オーナー向けにショート動画でノウハウを発信。問い合わせはプロフィールのリンクから。" style="width:100%;padding:10px 12px;font-size:0.9rem">${esc(lsGet('ya_ai_goal'))}</textarea></div>
                <div class="ya-row" id="ya-ai-keybox" style="margin-top:10px" ${lsGet(AI_KEY_NAME) ? 'hidden' : ''}>
                    <input type="password" id="ya-ai-key" placeholder="OpenAIのAPIキー (sk-...)" autocomplete="off">
                    <button type="button" class="btn-secondary btn-sm" id="ya-ai-keysave">キーを保存</button>
                    <span class="ya-note" style="margin:0">このブラウザにだけ保存されます(テロップ生成・AI企画室と共通)。データベースには入れません。</span>
                </div>
                <div class="ya-row" style="margin-top:10px">
                    <label>AIモデル <select id="ya-ai-model">${AI_MODELS.map(([k, v]) => `<option value="${k}" ${(lsGet('ya_ai_model') || AI_MODELS[0][0]) === k ? 'selected' : ''}>${k}(${v})</option>`).join('')}</select></label>
                    <label><input type="checkbox" id="ya-ai-save" checked> 結果を保存して、あとで見返せるようにする</label>
                    <button type="button" class="btn-primary" id="ya-ai-run" disabled><i class="ph ph-sparkle"></i> AIで分析する</button>
                    <span class="ya-msg" id="ya-ai-msg"></span>
                </div>
                <div id="ya-ai-out"></div>
                <div class="ya-h" style="margin-top:18px">保存した分析(新しい順・10件)</div>
                <div id="ya-ai-hist">${histHtml()}</div>
            </div>
            <div class="card ya-card"><div class="ya-h">動画ごとのランキング</div><div id="ya-rank"></div></div>
            <div class="card ya-card"><div class="ya-h">サムネイルの表示回数・クリック率</div><div id="ya-reach"></div></div>
            <div class="card ya-card" id="ya-ret-card" hidden><div class="ya-h">動画の視聴維持率</div><div id="ya-ret"></div></div>

            <div class="ya-h2">視聴者はどこから来たか</div>
            <div class="ya-grid">
                <div class="card ya-card"><div class="ya-h">流入元(再生数)</div><div id="ya-src"></div></div>
                <div class="card ya-card"><div class="ya-h">YouTube検索のキーワード(上位25)</div><div id="ya-kw"></div></div>
                <div class="card ya-card"><div class="ya-h">外部サイト・アプリ(上位25)</div><div id="ya-ext"></div></div>
            </div>

            <div class="ya-h2">視聴者の特徴</div>
            <div class="ya-grid">
                <div class="card ya-card"><div class="ya-h">年齢と性別</div><div id="ya-demo"></div></div>
                <div class="card ya-card"><div class="ya-h">国・地域(上位10)</div><div id="ya-country"></div></div>
                <div class="card ya-card"><div class="ya-h">見ている端末</div><div id="ya-device"></div></div>
                <div class="card ya-card"><div class="ya-h">登録者か、そうでないか</div><div id="ya-subs"></div></div>
                <div class="card ya-card"><div class="ya-h">共有された先(上位10)</div><div id="ya-share"></div></div>
                <div class="card ya-card"><div class="ya-h">再生された場所</div><div id="ya-loc"></div></div>
            </div>
            <div class="ya-note">リアルタイムの数字や収益は、この画面には出ません。YouTube Studioで確認してください。サムネイルの表示回数・クリック率は、YouTubeが毎日作るレポートを取り込んでためた数字です(登録の約2日後から出はじめます)。</div>
        </div>
        <style>
            .ya-wrap { display: flex; flex-direction: column; gap: 16px; max-width: 1200px; }
            .ya-card { padding: 20px; min-width: 0; }
            .ya-wrap [hidden] { display: none !important; }
            .ya-h { font-weight: 700; font-size: 1rem; margin-bottom: 12px; cursor: default; }
            summary.ya-h { cursor: pointer; margin-bottom: 0; }
            details[open] > summary.ya-h { margin-bottom: 12px; }
            .ya-h2 { font-weight: 700; font-size: 1.1rem; margin-top: 8px; }
            .ya-steps { margin: 0 0 8px; padding-left: 1.3em; font-size: 0.85rem; line-height: 1.9; color: var(--text-secondary); }
            .ya-steps code { background: #f1f3f5; padding: 1px 5px; border-radius: 4px; font-size: 0.8rem; }
            .ya-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
            .ya-row input[type="text"] { flex: 1 1 320px; max-width: 520px; padding: 10px 12px; font-size: 0.9rem; }
            .ya-row input[type="date"] { width: auto; padding: 8px 10px; font-size: 0.9rem; }
            .ya-row select { padding: 8px 10px; font-size: 0.9rem; width: auto; }
            .ya-row label, .ya-ctl label { font-size: 0.85rem; color: var(--text-secondary); display: inline-flex; align-items: center; gap: 6px; }
            .ya-msg { font-size: 0.85rem; } .ya-msg.ok { color: var(--success); font-weight: 600; } .ya-msg.err { color: #C92A2A; font-weight: 600; }
            .ya-login-state { font-size: 0.85rem; color: var(--text-secondary); } .ya-login-state.ok { color: var(--success); font-weight: 600; }
            .ya-note { font-size: 0.78rem; color: var(--text-secondary); line-height: 1.8; margin-top: 8px; }
            .ya-warn { font-size: 0.82rem; color: #C25E00; background: #FFF4E6; border-radius: 8px; padding: 8px 12px; margin-bottom: 10px; line-height: 1.6; }
            .ya-err { font-size: 0.85rem; color: #C92A2A; background: #FFF5F5; border-radius: 8px; padding: 10px 12px; line-height: 1.7; }
            .ya-empty { font-size: 0.85rem; color: var(--text-secondary); padding: 8px 0; }
            .ya-loading { font-size: 0.85rem; color: var(--text-secondary); padding: 8px 0; }
            .ya-chan-name { font-size: 1.1rem; font-weight: 700; margin-bottom: 8px; }
            .ya-chan-stats { display: flex; gap: 28px; flex-wrap: wrap; } .ya-chan-stats span { display: block; font-size: 0.75rem; color: var(--text-secondary); } .ya-chan-stats b { font-size: 1.2rem; }
            .ya-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; } .ya-tiles-s { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: 12px; }
            .ya-tile { border: 1px solid var(--border-light, #e3e3e3); border-radius: 10px; padding: 12px 14px; }
            .ya-tile-k { font-size: 0.78rem; color: var(--text-secondary); } .ya-tile-v { font-size: 1.5rem; font-weight: 700; margin: 2px 0; } .ya-tile-s { font-size: 0.74rem; color: var(--text-secondary); }
            .ya-tile-d { font-size: 0.76rem; font-weight: 600; margin-top: 2px; } .ya-tile-d.up { color: #2B8A3E; } .ya-tile-d.down { color: #C92A2A; } .ya-tile-d.flat { color: var(--text-secondary); }
            .ya-ctl { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 10px; } .ya-ctl select { padding: 6px 10px; font-size: 0.85rem; width: auto; }
            .ya-chart { position: relative; height: 320px; } .ya-chart-s { height: 280px; }
            .ya-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 16px; }
            .ya-bars { display: flex; flex-direction: column; gap: 8px; }
            .ya-bar-row { display: grid; grid-template-columns: minmax(90px, 38%) 1fr auto; gap: 10px; align-items: center; font-size: 0.82rem; }
            .ya-bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .ya-bar-track { background: #f1f3f5; border-radius: 4px; height: 12px; overflow: hidden; } .ya-bar-fill { height: 100%; background: #4C6EF5; }
            .ya-bar-val { white-space: nowrap; font-variant-numeric: tabular-nums; } .ya-bar-val span { color: var(--text-secondary); font-size: 0.76rem; }
            .ya-table-wrap { overflow-x: auto; } .ya-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; min-width: 860px; }
            .ya-table th, .ya-table td { text-align: right; padding: 8px 8px; border-bottom: 1px solid var(--border-light, #eee); white-space: nowrap; } .ya-table th:nth-child(2), .ya-table td:nth-child(2) { text-align: left; white-space: normal; min-width: 280px; }
            .ya-table th:nth-child(1), .ya-table td:nth-child(1), .ya-table th:nth-child(3), .ya-table td:nth-child(3) { text-align: center; }
            .ya-vcell { display: flex; align-items: center; gap: 10px; } .ya-vcell img, .ya-noimg { width: 72px; height: 40px; object-fit: cover; border-radius: 4px; background: #e9ecef; flex: none; display: block; }
            .ya-vcell a { color: inherit; font-weight: 600; text-decoration: none; } .ya-vcell a:hover { text-decoration: underline; } .ya-sub { font-size: 0.72rem; color: var(--text-secondary); }
            .ya-chip { font-size: 0.74rem; font-weight: 600; color: var(--c); border: 1px solid var(--c); border-radius: 999px; padding: 1px 8px; }
            .ya-table-r { min-width: 640px; } .ya-table-r th:nth-child(3), .ya-table-r td:nth-child(3) { text-align: right; } .ya-up { color: #2B8A3E; font-weight: 600; } .ya-down { color: #C92A2A; font-weight: 600; }
            .ya-more { text-align: center; margin-top: 10px; } .ya-ret-title { font-weight: 700; margin-bottom: 10px; }
            .ya-ai-meta { font-size: 0.78rem; color: var(--text-secondary); line-height: 1.7; margin: 12px 0; } .ya-ai-sum { font-size: 0.95rem; line-height: 1.9; background: #F8F9FA; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
            .ya-ai-box { border: 1px solid var(--border-light, #e3e3e3); border-radius: 10px; padding: 12px 16px; margin-bottom: 14px; font-size: 0.88rem; line-height: 1.8; } .ya-ai-box ol, .ya-ai-box ul { margin: 6px 0 0; padding-left: 1.3em; } .ya-ai-box li { margin-bottom: 6px; } .ya-ai-box li span { color: var(--text-secondary); }
            .ya-ai-pri { border-color: #4C6EF5; background: #F3F6FF; } .ya-ai-cav { background: #FFF9DB; border-color: #FFE066; }
            .ya-ai-sec { border: 1px solid var(--border-light, #e3e3e3); border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; font-size: 0.88rem; line-height: 1.8; }
            .ya-ai-t { font-weight: 700; font-size: 0.98rem; } .ya-ai-conf { font-weight: 400; font-size: 0.78rem; color: var(--text-secondary); margin-left: 8px; }
            .ya-ai-k { font-size: 0.76rem; font-weight: 700; color: #4C6EF5; margin: 10px 0 2px; } .ya-ai-sec ul, .ya-ai-sec ol { margin: 0; padding-left: 1.3em; } .ya-ai-sec p { margin: 0; } .ya-ai-measure { color: var(--text-secondary); font-size: 0.8rem; }
            .ya-lv { display: inline-block; font-size: 0.7rem; font-weight: 700; padding: 0 7px; border-radius: 999px; color: #fff; } .ya-lv-h { background: #E03131; } .ya-lv-m { background: #F08C00; } .ya-lv-l { background: #868E96; }
            .ya-hist { list-style: none; margin: 0; padding: 0; font-size: 0.82rem; } .ya-hist li { margin-bottom: 6px; }
            @media (max-width: 820px) { .ya-grid { grid-template-columns: 1fr; } .ya-bar-row { grid-template-columns: minmax(70px, 34%) 1fr auto; } .ya-chart { height: 260px; } }
        </style>`;
        App.mount(html, () => {
            const msgOf = (id, text, cls) => { const el = box(id); if (el) { el.textContent = text || ''; el.className = 'ya-msg ' + (cls || ''); } };
            refreshLogin(); aiRefresh(); bindHist();
            box('ya-ai-keysave').addEventListener('click', () => { const k = box('ya-ai-key').value.trim(); const m = box('ya-ai-msg'); if (!/^sk-[\w-]{10,}$/.test(k)) { m.textContent = 'APIキーの形が違います(sk- で始まる文字列です)'; m.className = 'ya-msg err'; return; } if (!lsSet(AI_KEY_NAME, k)) { m.textContent = 'このブラウザではキーを保存できませんでした'; m.className = 'ya-msg err'; return; } box('ya-ai-key').value = ''; m.textContent = 'キーを保存しました'; m.className = 'ya-msg ok'; aiRefresh(); });
            box('ya-ai-run').addEventListener('click', () => runAi());
            box('ya-save-client').addEventListener('click', async () => {
                const id = box('ya-client').value.trim();
                if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) { msgOf('ya-client-msg', 'クライアント ID の形が違います(「…apps.googleusercontent.com」で終わる文字列です)', 'err'); return; }
                const u = Auth.getCurrentUser(); if (!u || u.role !== 'admin') { alert('この操作ができるのは管理者だけです。'); return; }
                try { await saveClientId(id); S.token = null; S.tokenExp = 0; refreshLogin(); msgOf('ya-client-msg', '保存しました', 'ok'); }
                catch (e) { msgOf('ya-client-msg', '保存できませんでした: ' + (e.message || ''), 'err'); }
            });
            box('ya-login').addEventListener('click', async () => {
                msgOf('ya-login-msg', '', '');
                try { await connect(); refreshLogin(); msgOf('ya-login-msg', 'ログインしました', 'ok'); runAll(); }
                catch (e) { msgOf('ya-login-msg', e.message || 'ログインできませんでした', 'err'); }
            });
            box('ya-preset').addEventListener('change', (e) => { S.preset = e.target.value; box('ya-custom').hidden = S.preset !== 'custom'; if (S.preset !== 'custom') runAll(); });
            box('ya-start').addEventListener('change', (e) => { S.start = e.target.value; });
            box('ya-end').addEventListener('change', (e) => { S.end = e.target.value; });
            box('ya-type').addEventListener('change', (e) => { S.type = e.target.value; runAll(); });
            box('ya-load').addEventListener('click', () => runAll());
            if (tokenOk()) runAll();   // ページを移動して戻ってきたときは、ログインが生きていればそのまま再表示
        });
    };
})();
