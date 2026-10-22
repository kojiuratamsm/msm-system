// js/pages/short_upload.js
// ショート投稿予約: 編集済みの動画をまとめて選び、公開日時をつけて YouTube へアップロードし、YouTube 側の「予約公開」にする。
//
// 仕組み(サーバーは使わない・Googleの認証情報も保存しない)
//   ・ログイン: Google Identity Services の「トークンモデル」で、この画面を開いている間だけ有効な短い期間のアクセストークンをもらう。
//     トークンは画面のメモリにだけ置き、データベースにもブラウザの保存領域にも入れない。
//     https://developers.google.com/identity/oauth2/web/guides/use-token-model
//   ・アップロード: YouTube Data API の videos.insert(再開できるアップロード方式)。必要な許可は youtube.upload のみ。
//     https://developers.google.com/youtube/v3/docs/videos/insert
//     https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
//   ・予約公開: 「非公開(private)」でアップロードして status.publishAt を指定する。公開は YouTube が時刻どおりに行う。
//     publishAt が過去だと「すぐ公開」になるため、必ず「今から10分以上先」の日時だけを送る。
//     https://developers.google.com/youtube/v3/docs/videos
//   ・ショート: 縦長か正方形で3分以内の動画は自動でショートになる(ショート専用の指定はない)。
//     https://support.google.com/youtube/answer/15424877
//   ・保存するもの: 設定(クライアントID・公開時刻・説明文など。秘密の情報ではない)と、アップロードした記録(動画ID・公開予定日時)だけ。
(function () {
    const GIS_SRC = 'https://accounts.google.com/gsi/client';
    const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
    const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
    const SETTINGS_TYPE = 'short_upload_settings';
    const LOG_TYPE = 'short_upload_log';
    const JST = 9 * 3600e3;
    const MIN_LEAD = 10 * 60e3;                 // 公開日時は「今から10分以上先」だけ(過去だとすぐ公開されてしまうため)
    const TITLE_MAX = 100;
    const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|mpg|mpeg|wmv|3gp)$/i;
    const DEFAULTS = { clientId: '', hour: 19, minute: 0, description: '#Shorts', tags: '', categoryId: '22', kids: 'default' };

    const S = window.ShortUploadState = window.ShortUploadState || { items: [], settings: null, settingsRowId: null, log: [], token: null, tokenExp: 0, uploading: false, seq: 0 };

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const pad = (n) => String(n).padStart(2, '0');
    const WD = '日月火水木金土';
    // 日本時間(UTC+9)で日付を扱う(端末の時刻設定に左右されないように)
    const jp = (ms) => { const d = new Date(ms + JST); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), w: d.getUTCDay() }; };
    const jms = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi) - JST;
    const dayKey = (ms) => { const p = jp(ms); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
    const toInput = (ms) => { const p = jp(ms); return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`; };
    const fromInput = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s || ''); return m ? jms(+m[1], +m[2], +m[3], +m[4], +m[5]) : null; };
    const fmtDT = (ms) => { const p = jp(ms); return `${p.y}年${p.m}月${p.d}日(${WD[p.w]}) ${pad(p.h)}:${pad(p.mi)}`; };
    const fmtSize = (b) => b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`;

    // ---------- 設定・記録の読み書き ----------
    async function loadSettings() {
        const rows = await Store.getCustomers(SETTINGS_TYPE);
        const row = rows.slice().sort((a, b) => Number(a.id) - Number(b.id))[0];
        S.settingsRowId = row ? row.id : null;
        const s = { ...DEFAULTS };
        if (row) {
            if (typeof row.clientId === 'string') s.clientId = row.clientId.trim();
            const h = Number(row.hour), mi = Number(row.minute);
            if (Number.isInteger(h) && h >= 0 && h <= 23) s.hour = h;
            if (Number.isInteger(mi) && mi >= 0 && mi <= 59) s.minute = mi;
            ['description', 'tags'].forEach(k => { if (typeof row[k] === 'string') s[k] = row[k]; });
            if (typeof row.categoryId === 'string' && /^\d{1,3}$/.test(row.categoryId)) s.categoryId = row.categoryId;
            if (['default', 'yes', 'no'].includes(row.kids)) s.kids = row.kids;
        }
        S.settings = s;
    }
    async function saveSettings(s) {
        const payload = { ...s, updatedAt: new Date().toISOString() };
        if (S.settingsRowId) await Store.updateCustomer(SETTINGS_TYPE, S.settingsRowId, payload);
        else await Store.addCustomer(SETTINGS_TYPE, payload);
        await loadSettings();
        // 保存できたかを読み直して確認する(Storeは保存に失敗しても例外を出さないため)
        const got = S.settings;
        if (got.clientId !== s.clientId || got.hour !== s.hour || got.minute !== s.minute || got.description !== s.description || got.tags !== s.tags || got.kids !== s.kids) throw new Error('保存した内容を確認できませんでした。通信状態を確認してください');
    }
    async function loadLog() {
        const rows = await Store.getCustomers(LOG_TYPE);
        S.log = rows.filter(r => r && r.videoId).sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
    }

    // ---------- 公開日時の自動割り当て(1日1本・設定した時刻) ----------
    function nextSlot(now, occupied) {
        const st = S.settings, t = jp(now);
        for (let i = 0; i < 800; i++) {
            const c = jms(t.y, t.m, t.d + i, st.hour, st.minute);
            if (c < now + MIN_LEAD) continue;
            if (occupied.has(dayKey(c))) continue;
            return c;
        }
        return null;
    }
    function assignSlots() {
        const now = Date.now();
        const occupied = new Set(S.log.filter(r => r.mode === 'scheduled' && r.publishAt).map(r => dayKey(Date.parse(r.publishAt))));
        S.items.forEach(it => { if ((it.manual || it.state === 'done') && it.publishAt) occupied.add(dayKey(it.publishAt)); });
        S.items.forEach(it => {
            if (it.manual || it.state === 'done' || it.state === 'up') return;
            const c = nextSlot(now, occupied);
            it.publishAt = c;
            if (c) occupied.add(dayKey(c));
        });
    }

    // ---------- 動画ファイルの確認(ショートになる動画か) ----------
    function probe(file) {
        return new Promise(resolve => {
            let done = false;
            const v = document.createElement('video');
            const url = URL.createObjectURL(file);
            const finish = (r) => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(r); };
            v.preload = 'metadata'; v.muted = true;
            v.onloadedmetadata = () => finish({ w: v.videoWidth, h: v.videoHeight, dur: v.duration });
            v.onerror = () => finish(null);
            setTimeout(() => finish(null), 5000);
            v.src = url;
        });
    }
    function shortsNote(info) {
        if (!info || !info.w || !info.h) return { cls: 'unknown', text: 'ショートの条件(縦長か正方形・3分以内)は、この端末では確認できませんでした' };
        const warn = [];
        if (info.h < info.w) warn.push('横長です');
        if (info.dur > 180) warn.push(`${Math.round(info.dur)}秒と3分を超えています`);
        const base = `${info.w}×${info.h}・${Math.round(info.dur)}秒`;
        return warn.length ? { cls: 'warn', text: `${base} — ${warn.join('・')}。このままだとショートとして扱われません` } : { cls: 'ok', text: `${base} — ショートの条件(縦長か正方形・3分以内)を満たしています` };
    }
    const cleanTitle = (name) => {
        let t = String(name || '').replace(/\.[^.]+$/, '').trim();
        t = t.replace(/</g, '＜').replace(/>/g, '＞');   // YouTubeのタイトルには < > が使えないため全角にする
        if (t.length > TITLE_MAX) t = t.slice(0, TITLE_MAX);
        return t || '無題';
    };

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
        const st = S.settings;
        if (!st.clientId) throw new Error('先に「Googleのクライアント ID」を設定して保存してください');
        await loadGis();
        return new Promise((resolve, reject) => {
            const client = window.google.accounts.oauth2.initTokenClient({
                client_id: st.clientId,
                scope: SCOPE,
                callback: (resp) => {
                    if (resp && resp.access_token) {
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

    // ---------- YouTube へアップロード(再開できる方式) ----------
    class UploadError extends Error { constructor(msg, kind) { super(msg); this.kind = kind || 'fatal'; } }
    function apiErrorMessage(status, body) {
        let reason = '', msg = '';
        try { const j = JSON.parse(body); reason = (j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || ''; msg = (j.error && j.error.message) || ''; } catch (e) { /* */ }
        const map = {
            quotaExceeded: '1日のアップロードの上限に達しました。明日になってからやり直してください',
            uploadLimitExceeded: 'このチャンネルのアップロード上限に達しています。しばらくしてからやり直してください',
            youtubeSignupRequired: 'ログインしたGoogleアカウントにYouTubeチャンネルがありません',
            forbidden: 'このアカウントではアップロードできません(権限がありません)',
            invalidTitle: 'タイトルが使えない形式です', invalidDescription: '説明文が使えない形式です', invalidTags: 'タグが使えない形式です',
            invalidPublishAt: '公開日時が使えない形式です', invalidCategoryId: 'カテゴリが正しくありません', mediaBodyRequired: '動画ファイルが空です'
        };
        if (status === 401) return 'ログインの有効期限が切れました。「Googleにログイン」を押してから、残りを再開してください';
        return (map[reason] || `YouTubeにアップロードできませんでした(${status}${msg ? ': ' + msg : ''})`) + (reason ? `[${reason}]` : '');
    }
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    function xhrPut(url, blob, headers, onProgress) {
        return new Promise((resolve, reject) => {
            const x = new XMLHttpRequest();
            x.open('PUT', url);
            Object.entries(headers).forEach(([k, v]) => x.setRequestHeader(k, v));
            x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded); };
            x.onload = () => resolve({ status: x.status, body: x.responseText, range: x.getResponseHeader('Range') });
            x.onerror = () => reject(new Error('network'));
            x.ontimeout = () => reject(new Error('network'));
            x.send(blob);
        });
    }
    async function uploadOne(it) {
        const st = S.settings, file = it.file;
        const meta = {
            snippet: { title: it.title, description: st.description || '', categoryId: st.categoryId || '22' },
            status: { privacyStatus: 'private' }
        };
        const tags = (st.tags || '').split(/[,、]/).map(x => x.trim()).filter(Boolean);
        if (tags.length) meta.snippet.tags = tags;
        if (!it.test) meta.status.publishAt = new Date(it.publishAt).toISOString();
        if (st.kids === 'yes') meta.status.selfDeclaredMadeForKids = true;
        if (st.kids === 'no') meta.status.selfDeclaredMadeForKids = false;
        const ctype = (file.type && file.type.startsWith('video/')) ? file.type : 'application/octet-stream';

        // 1) アップロードの受付(セッションURLをもらう)
        let init;
        try {
            init = await fetch(UPLOAD_URL, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + S.token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(file.size), 'X-Upload-Content-Type': ctype },
                body: JSON.stringify(meta)
            });
        } catch (e) { throw new UploadError('YouTubeに接続できませんでした。通信状態を確認してください', 'network'); }
        if (!init.ok) throw new UploadError(apiErrorMessage(init.status, await init.text().catch(() => '')), init.status === 401 ? 'auth' : 'fatal');
        const sessionUrl = init.headers.get('Location');
        if (!sessionUrl) throw new UploadError('アップロードの受付はできましたが、続きの送り先を受け取れませんでした(ブラウザの制限の可能性があります)', 'fatal');

        // 2) 動画本体を送る。途切れたら、どこまで届いたかを確認して続きから送る(最大3回)
        const total = file.size;
        let start = 0, tries = 0;
        for (;;) {
            try {
                const headers = { 'Authorization': 'Bearer ' + S.token, 'Content-Type': ctype };
                if (start > 0) headers['Content-Range'] = `bytes ${start}-${total - 1}/${total}`;
                const r = await xhrPut(sessionUrl, start > 0 ? file.slice(start) : file, headers, (loaded) => setProgress(it, (start + loaded) / total));
                if (r.status === 200 || r.status === 201) {
                    let j = null; try { j = JSON.parse(r.body); } catch (e) { /* */ }
                    if (!j || !j.id) throw new UploadError('アップロードは完了しましたが、動画IDを受け取れませんでした。YouTube Studioで確認してください', 'fatal');
                    return j.id;
                }
                if ([500, 502, 503, 504].includes(r.status)) throw new Error('retry');
                if (r.status === 404) throw new UploadError('アップロードの受付の期限が切れました。もう一度やり直してください', 'fatal');
                throw new UploadError(apiErrorMessage(r.status, r.body), r.status === 401 ? 'auth' : 'fatal');
            } catch (e) {
                if (e instanceof UploadError) throw e;
                if (++tries > 3) throw new UploadError('通信が途切れて、アップロードを続けられませんでした。もう一度やり直してください', 'network');
                await sleep((window.__suBackoff != null ? window.__suBackoff : 1000) * tries);
                // どこまで届いたかを確認する
                try {
                    const q = await xhrPut(sessionUrl, new Blob([]), { 'Authorization': 'Bearer ' + S.token, 'Content-Range': `bytes */${total}` });
                    if (q.status === 200 || q.status === 201) { let j = null; try { j = JSON.parse(q.body); } catch (e2) { /* */ } if (j && j.id) return j.id; }
                    const m = /bytes=0-(\d+)/.exec(q.range || '');
                    start = m ? Number(m[1]) + 1 : 0;
                } catch (e2) { /* 確認もできなければ、同じ位置からもう一度試す */ }
            }
        }
    }
    function setProgress(it, ratio) {
        const el = document.querySelector(`[data-su-prog="${it.id}"]`);
        if (el) { el.style.width = Math.min(100, Math.round(ratio * 100)) + '%'; el.parentElement.title = Math.round(ratio * 100) + '%'; }
        const t = document.querySelector(`[data-su-pct="${it.id}"]`);
        if (t) t.textContent = Math.min(100, Math.round(ratio * 100)) + '%';
    }

    // ---------- 画面 ----------
    function itemProblem(it) {
        if (it.state === 'done') return '';
        if (!it.title.trim()) return 'タイトルを入れてください';
        if (it.title.length > TITLE_MAX) return `タイトルは${TITLE_MAX}文字までです(今 ${it.title.length}文字)`;
        if (/[<>]/.test(it.title)) return 'タイトルに < > は使えません';
        if (!it.test) {
            if (!it.publishAt) return '公開日時を入れてください';
            if (it.publishAt < Date.now() + MIN_LEAD) return '公開日時は、今から10分以上先にしてください(過ぎた時刻だと、すぐ公開されてしまいます)';
        }
        return '';
    }
    function stateLabel(it) {
        if (it.state === 'up') return '<span class="su-st su-up">アップロード中 <b data-su-pct="' + it.id + '">0%</b></span>';
        if (it.state === 'done') return `<span class="su-st su-done">完了${it.test ? '(非公開のまま)' : '(予約公開)'}</span>`;
        if (it.state === 'err') return '<span class="su-st su-err">失敗</span>';
        return '<span class="su-st">待機中</span>';
    }
    function rowHtml(it, idx) {
        const locked = it.state === 'up' || it.state === 'done';
        const prob = itemProblem(it);
        return `<div class="su-row ${it.state}" data-su-row="${it.id}">
            <div class="su-row-main">
                <div class="su-num">${idx + 1}</div>
                <div class="su-fields">
                    <input type="text" class="su-title" data-su-title="${it.id}" value="${esc(it.title)}" ${locked ? 'disabled' : ''} maxlength="200" aria-label="タイトル">
                    <div class="su-file">${esc(it.file.name)} ・ ${fmtSize(it.file.size)}</div>
                    <div class="su-short ${it.note.cls}" data-su-note="${it.id}">${esc(it.note.text)}</div>
                </div>
                <div class="su-when">
                    <label>公開日時(日本時間)</label>
                    <input type="datetime-local" data-su-when="${it.id}" value="${it.publishAt ? toInput(it.publishAt) : ''}" ${locked || it.test ? 'disabled' : ''}>
                    <div class="su-hint">${it.test ? '(テスト: 公開しません)' : (it.publishAt ? fmtDT(it.publishAt) : '')}</div>
                </div>
                <div class="su-stat">${stateLabel(it)}<button type="button" class="btn-secondary btn-sm" data-su-del="${it.id}" ${S.uploading || it.state === 'up' ? 'disabled' : ''}>${it.state === 'done' ? '一覧から消す' : '外す'}</button></div>
            </div>
            <div class="su-bar" style="${it.state === 'up' || it.state === 'done' ? '' : 'display:none;'}"><div data-su-prog="${it.id}" style="width:${it.state === 'done' ? 100 : 0}%"></div></div>
            <div class="su-problem" data-su-problem="${it.id}">${esc(it.error || prob)}</div>
        </div>`;
    }
    function logHtml() {
        if (!S.log.length) return '<div class="su-empty">まだアップロードの記録はありません</div>';
        const now = Date.now();
        return `<table class="su-log"><thead><tr><th>タイトル</th><th>公開予定</th><th>状態</th><th></th></tr></thead><tbody>${S.log.slice(0, 40).map(r => {
            const t = r.publishAt ? Date.parse(r.publishAt) : null;
            const state = r.mode === 'test' ? 'テスト(非公開のまま)' : (t && t > now ? '予約中' : '公開時刻を過ぎました');
            return `<tr><td>${esc(r.title || '')}</td><td>${t ? esc(fmtDT(t)) : '-'}</td><td>${esc(state)}</td><td><a href="https://studio.youtube.com/video/${encodeURIComponent(r.videoId)}/edit" target="_blank" rel="noopener">YouTube Studioで開く</a></td></tr>`;
        }).join('')}</tbody></table><div class="su-note">「公開時刻を過ぎました」は、予定の時刻を過ぎたという意味です。公開されたかどうかは、YouTube Studioで確認してください。</div>`;
    }

    App.Pages.short_upload = async function () {
        const user = Auth.getCurrentUser();
        if (!user || user.role !== 'admin') {
            App.mount('<div class="card"><p>閲覧権限がありません。ショート投稿予約を使えるのは管理者だけです。</p></div>');
            return;
        }
        try { await Promise.all([loadSettings(), loadLog()]); }
        catch (e) { App.mount(`<div class="card"><p>設定を読み込めませんでした: ${esc(e.message || '')}</p></div>`); return; }
        const st = S.settings;
        const html = `
        <div class="su-wrap">
            <div class="card su-card">
                <div class="su-h">使う前の準備(最初の1回だけ)</div>
                <ol class="su-steps">
                    <li>Google Cloud(console.cloud.google.com)でプロジェクトを作り、「YouTube Data API v3」を有効にします。</li>
                    <li>「OAuth 同意画面」を作り、テストユーザーに、YouTubeチャンネルを持つGoogleアカウントを追加します。</li>
                    <li>「認証情報」で「OAuth クライアント ID」(種類: ウェブ アプリケーション)を作り、「承認済みの JavaScript 生成元」にこの管理サイトのURL(例: https://○○.vercel.app)を入れます。</li>
                    <li>できた「クライアント ID」を、下の設定に貼り付けて保存します(秘密の情報ではありません)。</li>
                    <li>まず「テスト」にチェックを入れて、短い動画を1本アップロードします(非公開のまま残り、公開されません)。YouTube Studioで見えれば準備完了です。</li>
                </ol>
            </div>

            <div class="card su-card">
                <div class="su-h">設定</div>
                <div class="su-grid">
                    <div class="form-group su-wide"><label>Googleのクライアント ID</label><input type="text" id="su-client" value="${esc(st.clientId)}" placeholder="1234567890-xxxx.apps.googleusercontent.com" autocomplete="off"></div>
                    <div class="form-group"><label>毎日の公開時刻(日本時間)</label>
                        <div class="su-time"><select id="su-hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === st.hour ? 'selected' : ''}>${h}時</option>`).join('')}</select>
                        <select id="su-minute">${[0, 15, 30, 45].concat([st.minute]).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b).map(m => `<option value="${m}" ${m === st.minute ? 'selected' : ''}>${pad(m)}分</option>`).join('')}</select></div></div>
                    <div class="form-group"><label>子ども向けの設定</label>
                        <select id="su-kids"><option value="default" ${st.kids === 'default' ? 'selected' : ''}>チャンネルの設定に従う(おすすめ)</option><option value="no" ${st.kids === 'no' ? 'selected' : ''}>すべて「子ども向けではない」にする</option><option value="yes" ${st.kids === 'yes' ? 'selected' : ''}>すべて「子ども向け」にする</option></select></div>
                    <div class="form-group su-wide"><label>説明文(すべての動画に入ります)</label><textarea id="su-desc" rows="3" placeholder="例: #Shorts">${esc(st.description)}</textarea></div>
                    <div class="form-group su-wide"><label>タグ(カンマ区切り・空欄でも可)</label><input type="text" id="su-tags" value="${esc(st.tags)}" placeholder="例: MEO,集客,店舗"></div>
                </div>
                <div class="su-btns"><button type="button" class="btn-primary" id="su-save-settings">設定を保存する</button><span class="su-msg" id="su-settings-msg"></span></div>
            </div>

            <div class="card su-card">
                <div class="su-h">アップロードする動画</div>
                <div class="su-top">
                    <button type="button" class="btn-secondary" id="su-login"><i class="ph ph-google-logo"></i> Googleにログイン</button>
                    <span class="su-login-state" id="su-login-state"></span>
                </div>
                <label class="su-drop" id="su-drop"><i class="ph ph-upload-simple"></i><span>ここに動画をドラッグするか、クリックして選びます(複数選べます)</span><input type="file" id="su-files" accept="video/*,.mp4,.mov,.m4v,.webm" multiple hidden></label>
                <div class="su-hintline">タイトルはファイル名から入ります(あとで直せます)。公開日時は、設定の時刻に1日1本ずつ、空いている日へ順番に入ります。</div>
                <div id="su-list"></div>
                <div class="su-btns">
                    <label class="su-check"><input type="checkbox" id="su-test"> テスト(非公開のままにする・予約公開しない)</label>
                    <button type="button" class="btn-primary" id="su-start" disabled><i class="ph ph-paper-plane-tilt"></i> アップロードを始める</button>
                    <span class="su-msg" id="su-run-msg"></span>
                </div>
                <div class="su-note">アップロードが終わるまで、この画面を開いたままにしてください(閉じたり、別の画面に移ると途中で止まります)。公開は、YouTubeが決めた時刻にやってくれます。</div>
            </div>

            <div class="card su-card">
                <div class="su-h">アップロードの記録</div>
                <div id="su-log">${logHtml()}</div>
            </div>
        </div>
        <style>
            .su-wrap { display: flex; flex-direction: column; gap: 16px; max-width: 1100px; }
            .su-card { padding: 20px; }
            .su-h { font-weight: 700; font-size: 1rem; margin-bottom: 12px; }
            .su-steps { margin: 0; padding-left: 1.3em; font-size: 0.85rem; line-height: 1.9; color: var(--text-secondary); }
            .su-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
            .su-wide { grid-column: 1 / -1; }
            .su-time { display: flex; gap: 8px; }
            .su-time select { width: auto; }
            .su-btns { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 14px; }
            .su-msg { font-size: 0.85rem; }
            .su-msg.ok { color: var(--success); font-weight: 600; } .su-msg.err { color: #C92A2A; font-weight: 600; }
            .su-top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
            .su-login-state { font-size: 0.85rem; color: var(--text-secondary); }
            .su-login-state.ok { color: var(--success); font-weight: 600; }
            .su-drop { display: flex; align-items: center; justify-content: center; gap: 10px; border: 2px dashed var(--border-light, #ccc); border-radius: 12px; padding: 22px 12px; cursor: pointer; color: var(--text-secondary); font-size: 0.9rem; text-align: center; }
            .su-drop.is-over { border-color: var(--primary-color, #4c6ef5); background: rgba(76,110,245,.06); }
            .su-drop i { font-size: 1.5rem; }
            .su-hintline { font-size: 0.78rem; color: var(--text-secondary); margin: 8px 0 12px; line-height: 1.7; }
            .su-row { border: 1px solid var(--border-light, #e3e3e3); border-radius: 10px; padding: 12px; margin-bottom: 10px; }
            .su-row.done { background: rgba(47,158,68,.05); } .su-row.err { border-color: #FFA8A8; background: #FFF8F8; }
            .su-row-main { display: grid; grid-template-columns: 28px 1fr 230px 150px; gap: 12px; align-items: start; }
            .su-num { font-weight: 700; color: var(--text-secondary); padding-top: 8px; }
            .su-fields input.su-title { width: 100%; font-weight: 600; padding: 10px 12px; font-size: 0.95rem; }
            .su-file { font-size: 0.76rem; color: var(--text-secondary); margin-top: 4px; word-break: break-all; }
            .su-short { font-size: 0.76rem; margin-top: 4px; line-height: 1.5; }
            .su-short.ok { color: var(--success); } .su-short.warn { color: #C25E00; font-weight: 600; } .su-short.unknown { color: var(--text-secondary); }
            .su-when label { font-size: 0.74rem; color: var(--text-secondary); display: block; margin-bottom: 2px; }
            .su-when input { width: 100%; } .su-hint { font-size: 0.74rem; color: var(--text-secondary); margin-top: 3px; }
            .su-stat { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
            .su-st { font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); } .su-st.su-done { color: var(--success); } .su-st.su-err { color: #C92A2A; } .su-st.su-up { color: var(--primary-color, #4c6ef5); }
            .su-bar { height: 6px; background: #eee; border-radius: 3px; margin-top: 10px; overflow: hidden; } .su-bar div { height: 100%; background: var(--primary-color, #4c6ef5); transition: width .2s; }
            .su-problem { font-size: 0.78rem; color: #C92A2A; margin-top: 6px; line-height: 1.6; }
            .su-problem:empty { display: none; }
            .su-check { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; cursor: pointer; }
            .su-note { font-size: 0.78rem; color: var(--text-secondary); line-height: 1.8; margin-top: 12px; }
            .su-empty { color: var(--text-secondary); font-size: 0.9rem; }
            .su-log { width: 100%; border-collapse: collapse; font-size: 0.85rem; } .su-log th, .su-log td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--border-light, #eee); }
            @media (max-width: 820px) { .su-row-main { grid-template-columns: 24px 1fr; } .su-when, .su-stat { grid-column: 2; } .su-grid { grid-template-columns: 1fr; } }
        </style>`;

        App.mount(html, () => {
            const $ = (id) => document.getElementById(id);
            const setMsg = (id, text, cls) => { const el = $(id); if (el) { el.textContent = text || ''; el.className = 'su-msg ' + (cls || ''); } };
            const renderList = () => {
                const box = $('su-list'); if (!box) return;
                box.innerHTML = S.items.length ? S.items.map(rowHtml).join('') : '';
                refresh();
            };
            const refresh = () => {
                S.items.forEach(it => { const el = document.querySelector(`[data-su-problem="${it.id}"]`); if (el) el.textContent = it.error || itemProblem(it); const h = document.querySelector(`[data-su-when="${it.id}"]`); if (h && h.nextElementSibling) h.nextElementSibling.textContent = it.test ? '(テスト: 公開しません)' : (it.publishAt ? fmtDT(it.publishAt) : ''); });
                const pending = S.items.filter(it => it.state === 'wait' || it.state === 'err');
                const bad = pending.some(it => itemProblem(it));
                $('su-start').disabled = S.uploading || !pending.length || bad;
                $('su-login').disabled = S.uploading;
                const ls = $('su-login-state');
                ls.textContent = tokenOk() ? 'ログイン中(この画面を開いている間だけ有効です)' : (S.settings.clientId ? '未ログイン' : 'クライアント ID を設定してください');
                ls.className = 'su-login-state' + (tokenOk() ? ' ok' : '');
            };
            const addFiles = async (fileList) => {
                const files = Array.from(fileList || []);
                const rejected = [];
                for (const f of files) {
                    if (!(f.type && f.type.startsWith('video/')) && !VIDEO_EXT.test(f.name)) { rejected.push(f.name); continue; }
                    if (f.size === 0) { rejected.push(f.name + '(空のファイル)'); continue; }
                    const it = { id: ++S.seq, file: f, title: cleanTitle(f.name), publishAt: null, manual: false, state: 'wait', error: '', test: $('su-test').checked, note: { cls: 'unknown', text: '動画の情報を確認中…' } };
                    S.items.push(it);
                    probe(f).then(info => { it.note = shortsNote(info); const el = document.querySelector(`[data-su-note="${it.id}"]`); if (el) { el.textContent = it.note.text; el.className = 'su-short ' + it.note.cls; } });
                }
                assignSlots(); renderList();
                setMsg('su-run-msg', rejected.length ? `動画ではないファイルは追加しませんでした: ${rejected.join('、')}` : '', rejected.length ? 'err' : '');
            };

            $('su-save-settings').addEventListener('click', async () => {
                const next = { clientId: $('su-client').value.trim(), hour: Number($('su-hour').value), minute: Number($('su-minute').value), description: $('su-desc').value, tags: $('su-tags').value.trim(), categoryId: S.settings.categoryId || '22', kids: $('su-kids').value };
                if (next.clientId && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(next.clientId)) { setMsg('su-settings-msg', 'クライアント ID の形が違います(「…apps.googleusercontent.com」で終わる文字列です)', 'err'); return; }
                if (next.description.length > 5000) { setMsg('su-settings-msg', '説明文は5000文字までです', 'err'); return; }
                if (next.tags.length > 450) { setMsg('su-settings-msg', 'タグが長すぎます(合計500文字まで)', 'err'); return; }
                try {
                    if (!checkAdminLocal()) return;
                    await saveSettings(next);
                    S.token = null; S.tokenExp = 0;
                    S.items.forEach(it => { if (!it.manual && it.state === 'wait') it.publishAt = null; });
                    assignSlots(); renderList();
                    setMsg('su-settings-msg', '保存しました', 'ok');
                } catch (e) { setMsg('su-settings-msg', '保存できませんでした: ' + (e.message || ''), 'err'); }
            });
            $('su-login').addEventListener('click', async () => {
                setMsg('su-run-msg', '', '');
                try { await connect(); refresh(); setMsg('su-run-msg', 'ログインしました', 'ok'); }
                catch (e) { setMsg('su-run-msg', e.message || 'ログインできませんでした', 'err'); }
            });
            $('su-files').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
            const drop = $('su-drop');
            ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
            ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
            drop.addEventListener('drop', (e) => addFiles(e.dataTransfer && e.dataTransfer.files));
            $('su-test').addEventListener('change', () => { S.items.forEach(it => { if (it.state === 'wait' || it.state === 'err') it.test = $('su-test').checked; }); assignSlots(); renderList(); });
            const list = $('su-list');
            list.addEventListener('input', (e) => {
                const id = e.target.dataset && e.target.dataset.suTitle; if (!id) return;
                const it = S.items.find(x => String(x.id) === id); if (!it) return;
                it.title = e.target.value; it.error = ''; refresh();
            });
            list.addEventListener('change', (e) => {
                const id = e.target.dataset && e.target.dataset.suWhen; if (!id) return;
                const it = S.items.find(x => String(x.id) === id); if (!it) return;
                const ms = fromInput(e.target.value);
                if (ms) { it.publishAt = ms; it.manual = true; } else { it.publishAt = null; it.manual = false; }
                it.error = '';
                assignSlots(); renderList();   // 手入力した日と重ならないよう、自動の日付を付け直す
            });
            list.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-su-del]'); if (!b || b.disabled) return;
                S.items = S.items.filter(x => String(x.id) !== b.dataset.suDel);
                assignSlots(); renderList();
            });
            $('su-start').addEventListener('click', async () => {
                if (!checkAdminLocal()) return;
                const pending = S.items.filter(it => it.state === 'wait' || it.state === 'err');
                if (!pending.length || pending.some(itemProblem)) return;
                setMsg('su-run-msg', '', '');
                if (!tokenOk()) {
                    try { await connect(); } catch (e) { setMsg('su-run-msg', e.message || 'ログインできませんでした', 'err'); refresh(); return; }
                }
                S.uploading = true; refresh();
                let okN = 0, ngN = 0;
                for (const it of pending) {
                    if (itemProblem(it)) { it.state = 'err'; it.error = itemProblem(it); ngN++; continue; }
                    if (!tokenOk()) { setMsg('su-run-msg', 'ログインの有効期限が切れました。「Googleにログイン」を押してから、残りを再開してください', 'err'); break; }
                    it.state = 'up'; it.error = ''; renderList(); S.uploading = true; refresh();
                    try {
                        const videoId = await uploadOne(it);
                        it.state = 'done'; it.videoId = videoId; okN++;
                        try {
                            await Store.addCustomer(LOG_TYPE, { videoId, title: it.title, fileName: it.file.name, publishAt: it.test ? null : new Date(it.publishAt).toISOString(), mode: it.test ? 'test' : 'scheduled', uploadedAt: new Date().toISOString(), uploadedBy: user.email || '' });
                            // 保存できたかを読み直して確認する(Storeは保存に失敗しても例外を出さないため)
                            await loadLog();
                            if (!S.log.some(r => r.videoId === videoId)) throw new Error('not saved');
                        } catch (e) { it.error = '動画はアップロードできましたが、記録を保存できませんでした(YouTube Studioで確認できます)'; }
                        await new Promise(r => setTimeout(r, 5));   // 記録の保存IDが重ならないように少し間をあける
                    } catch (e) {
                        it.state = 'err'; it.error = e.message || 'アップロードに失敗しました'; ngN++;
                        if (e.kind === 'auth') { S.token = null; S.tokenExp = 0; renderList(); break; }
                    }
                    renderList();
                }
                S.uploading = false;
                try { await loadLog(); const lb = $('su-log'); if (lb) lb.innerHTML = logHtml(); } catch (e) { /* */ }
                renderList();
                setMsg('su-run-msg', okN || ngN ? `${okN}本アップロードしました${ngN ? `(失敗 ${ngN}本)` : ''}` : '', ngN ? 'err' : 'ok');
            });
            function checkAdminLocal() {
                const u = Auth.getCurrentUser();
                if (!u || u.role !== 'admin') { alert('この操作ができるのは管理者だけです。'); return false; }
                return true;
            }
            // ページを移動して戻ってきたときは、前の一覧をそのまま出す
            assignSlots(); renderList();
        });
    };
})();
