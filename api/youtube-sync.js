// ============================================================================
// api/youtube-sync.js
// サムネイルの表示回数・クリック率を、YouTube Reporting API から毎日取り込んで Supabase に保存する。
//
// 呼ばれ方:
//   1) Vercelのcron(毎日1回)から GET で自動実行(vercel.json の crons)。
//      CRON_SECRET という環境変数を設定しておくと、Vercelが Authorization: Bearer <値> を付けて呼ぶ。
//      設定してあるときは、それが無い GET は 401 で断る。
//      出典: https://vercel.com/docs/cron-jobs/manage-cron-jobs (Securing cron jobs)
//      Hobbyプランは1日1回・指定した時の「1時間のどこか」で実行される。
//      出典: https://vercel.com/docs/cron-jobs/usage-and-pricing
//   2) 画面から POST { action: 'status' | 'sync' | 'create-job' }。
//        status     … 集計の登録(ジョブ)があるかを返すだけ。何も変更しない。
//        sync       … まだ保存していない日のレポートを取り込む。何度呼んでも同じ結果になる(冪等)。
//        create-job … 集計の登録(ジョブ)を作る。すでにあれば何もしない。画面の「集計を登録する」ボタンからだけ呼ばれる。
//
// 必要な環境変数: YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN(youtube-proxy.js と共通)。無ければ 503。
//
// Reporting API の仕様(本セッションで公式を確認):
//   - ジョブ一覧   GET  https://youtubereporting.googleapis.com/v1/jobs
//   - ジョブ作成   POST https://youtubereporting.googleapis.com/v1/jobs  { reportTypeId, name }  (409 = すでに存在)
//   - レポート一覧 GET  https://youtubereporting.googleapis.com/v1/jobs/{jobId}/reports  (pageSize, pageToken)
//   - ダウンロード downloadUrl に GET + Authorization ヘッダ
//   - レポートは太平洋時間の1日分のCSV。保管は60日(さかのぼり分は30日)。
//   - リーチレポート channel_reach_basic_a1: date, channel_id, video_id / video_thumbnail_impressions, video_thumbnail_impressions_ctr
//   https://developers.google.com/youtube/reporting/v1/reports
//   https://developers.google.com/youtube/reporting/v1/reports/channel_reports
//
// 保存の形(画面側のブラウザ取り込みと同じ): customers テーブル、service_type = 'yt_reach_daily'、月ごとに1行
//   data = { month: '2026-10', days: { '2026-10-03': { 動画ID: [表示回数, クリック率(0〜1)] } }, updatedAt }
//   動画IDが空の行は '_' にまとめる。
// ============================================================================

const SUPABASE_URL = 'https://xztaacxjlluzqzehendp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dGFhY3hqbGx1enF6ZWhlbmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzM4NzMsImV4cCI6MjA4OTgwOTg3M30.79wvIPepXjvPZwLHOPX7KullShvdvCB7LS2gZO5CtuQ';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REPORTING = 'https://youtubereporting.googleapis.com/v1';
const REACH_TYPE = 'channel_reach_basic_a1';
const REACH_JOB_NAME = 'msm-reach-basic';
const STORE = 'yt_reach_daily';
const MAX_DL = 60;          // 1回の実行で取り込む最大日数(残りは次の実行で続きから)
const CONCURRENCY = 5;
const BUDGET_MS = 200000;   // これを超えたら、残りは次回に回す

let cache = { token: '', exp: 0 };
const configured = () => !!(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET && process.env.YT_REFRESH_TOKEN);

async function getAccessToken() {
    if (cache.token && Date.now() < cache.exp) return cache.token;
    const body = new URLSearchParams({ client_id: process.env.YT_CLIENT_ID, client_secret: process.env.YT_CLIENT_SECRET, refresh_token: process.env.YT_REFRESH_TOKEN, grant_type: 'refresh_token' });
    let r;
    try { r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }); }
    catch (e) { const err = new Error('network'); err.code = 'network'; throw err; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) { const err = new Error(j.error || 'token_error'); err.code = j.error || 'token_error'; throw err; }
    cache = { token: j.access_token, exp: Date.now() + Math.max(60, (Number(j.expires_in) || 3600) - 120) * 1000 };
    return cache.token;
}

// ---------- CSV ----------
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
const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
// 1日分のCSV → { 動画ID: [表示回数, クリック率(0〜1)] }
function parseReach(text) {
    const rows = csvRows(text);
    if (!rows.length) return {};
    const head = rows[0].map(h => h.trim());
    const iV = head.indexOf('video_id'), iI = head.indexOf('video_thumbnail_impressions'), iC = head.indexOf('video_thumbnail_impressions_ctr');
    if (iV < 0 || iI < 0 || iC < 0) throw new Error('レポートの列が想定と違います');
    const body = rows.slice(1);
    const pct = body.some(r => num(r[iC]) > 1);   // 1を超える値があれば%表記とみなす(公式に保存形式の記載がないため)
    const out = {};
    body.forEach(r => {
        const vid = (r[iV] || '').trim() || '_';
        const imp = num(r[iI]), ctr = num(r[iC]) / (pct ? 100 : 1);
        const o = out[vid] || (out[vid] = { imp: 0, clicks: 0 });
        o.imp += imp; o.clicks += imp * ctr;
    });
    return Object.fromEntries(Object.entries(out).map(([k, o]) => [k, [Math.round(o.imp), o.imp ? +(o.clicks / o.imp).toFixed(6) : 0]]));
}
const ptFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });

// ---------- Google API ----------
async function gget(url, token) {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const text = await r.text();
    if (!r.ok) { const err = new Error(`Google API ${r.status}`); err.status = r.status; err.body = text; throw err; }
    return text;
}
async function listPaged(urlBase, key, token) {
    const out = []; let pt = '';
    for (let i = 0; i < 10; i++) {
        const j = JSON.parse(await gget(`${urlBase}${urlBase.includes('?') ? '&' : '?'}pageSize=100${pt ? '&pageToken=' + encodeURIComponent(pt) : ''}`, token));
        out.push(...(j[key] || []));
        pt = j.nextPageToken || ''; if (!pt) break;
    }
    return out;
}
async function findJob(token) {
    return (await listPaged(`${REPORTING}/jobs`, 'jobs', token)).find(j => j && j.reportTypeId === REACH_TYPE) || null;
}
async function createJob(token) {
    const r = await fetch(`${REPORTING}/jobs`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ reportTypeId: REACH_TYPE, name: REACH_JOB_NAME }) });
    if (r.status === 409) return findJob(token);   // すでに登録済み
    const text = await r.text();
    if (!r.ok) { const err = new Error(`Google API ${r.status}`); err.status = r.status; err.body = text; throw err; }
    return JSON.parse(text);
}

// ---------- Supabase ----------
const sbHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
async function sbRows() {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/customers?service_type=eq.${STORE}&select=id,data`, { headers: sbHeaders });
    if (!r.ok) throw new Error(`Supabase ${r.status}`);
    const rows = await r.json();
    return (Array.isArray(rows) ? rows : []).filter(x => x && x.data && typeof x.data.month === 'string' && x.data.days && typeof x.data.days === 'object').sort((a, b) => Number(a.id) - Number(b.id));
}
const daysOf = (rows) => { const d = {}; rows.forEach(r => Object.assign(d, r.data.days)); return d; };
async function sbSave(rows, newDays) {
    const byMonth = new Map(); rows.forEach(r => { if (!byMonth.has(r.data.month)) byMonth.set(r.data.month, r); });
    const all = { ...daysOf(rows), ...newDays };
    const months = Array.from(new Set(Object.keys(newDays).map(d => d.slice(0, 7)))).sort();
    let offset = 0;
    for (const month of months) {
        const md = Object.fromEntries(Object.entries(all).filter(([d]) => d.startsWith(month)));
        const row = byMonth.get(month);
        const now = new Date().toISOString();
        let r;
        if (row) r = await fetch(`${SUPABASE_URL}/rest/v1/customers?id=eq.${row.id}`, { method: 'PATCH', headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ data: { ...row.data, days: md, updatedAt: now } }) });
        else r = await fetch(`${SUPABASE_URL}/rest/v1/customers`, { method: 'POST', headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ id: Date.now() + (offset++), service_type: STORE, data: { month, days: md, updatedAt: now } }) });
        if (!r.ok) throw new Error(`Supabase ${r.status}`);
    }
    const after = daysOf(await sbRows());
    return Object.keys(newDays).every(d => d in after);   // 書いた日が読み直せるか確認
}

// ---------- 取り込み ----------
async function syncReach(job, token) {
    const started = Date.now();
    const list = await listPaged(`${REPORTING}/jobs/${encodeURIComponent(job.id)}/reports`, 'reports', token);
    const latest = new Map();   // 同じ日が複数(さかのぼり再作成)のときは、新しく作られた方
    list.forEach(r => {
        if (!r || !r.startTime || !r.downloadUrl) return;
        const d = ptFmt.format(new Date(r.startTime));
        const cur = latest.get(d);
        if (!cur || String(r.createTime) > String(cur.createTime)) latest.set(d, r);
    });
    const rows = await sbRows();
    const stored = daysOf(rows);
    const need = Array.from(latest.entries()).filter(([d]) => !(d in stored)).sort((a, b) => b[0].localeCompare(a[0]));
    const batch = need.slice(0, MAX_DL);
    const got = {}; let idx = 0, firstErr = '';
    const worker = async () => {
        while (idx < batch.length && !firstErr && Date.now() - started < BUDGET_MS) {
            const [d, r] = batch[idx++];
            try {
                let u; try { u = new URL(r.downloadUrl); } catch (e) { u = null; }
                if (!u || u.protocol !== 'https:' || u.hostname !== 'youtubereporting.googleapis.com') throw new Error('想定外のダウンロード先のため中止しました');   // ログイン情報は Google のこのホスト以外には送らない
                got[d] = parseReach(await gget(r.downloadUrl, token));
            } catch (e) { if (!firstErr) firstErr = e.message || 'download_failed'; }
        }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
    const fetched = Object.keys(got).length;
    let saved = true;
    if (fetched) saved = await sbSave(rows, got);
    return { available: latest.size, fetched, pending: need.length - fetched, saved, syncError: firstErr };
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    let action;
    if (req.method === 'GET') {
        const secret = process.env.CRON_SECRET;
        if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
        action = 'sync';
    } else if (req.method === 'POST') {
        let body = req.body;
        if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
        action = body && body.action;
        if (!['status', 'sync', 'create-job'].includes(action)) return res.status(400).json({ error: 'bad_request', message: 'action が正しくありません' });
    } else return res.status(405).json({ error: 'method_not_allowed' });

    if (!configured()) return res.status(503).json({ error: 'not_configured', message: 'サーバーの自動ログインはまだ設定されていません' });
    let token;
    try { token = await getAccessToken(); }
    catch (e) {
        if (e.code === 'network') return res.status(502).json({ error: 'network', message: 'Googleに接続できませんでした' });
        return res.status(401).json({ error: 'refresh_token_invalid', message: 'サーバーの更新用の鍵が使えなくなりました。取り直しが必要です' });
    }
    try {
        let job = await findJob(token);
        if (action === 'create-job' && !job) job = await createJob(token);
        if (!job) return res.status(200).json({ ok: true, hasJob: false });
        const base = { ok: true, hasJob: true, createTime: job.createTime || '' };
        if (action !== 'sync') return res.status(200).json(base);
        return res.status(200).json({ ...base, ...(await syncReach(job, token)) });
    } catch (e) {
        if (e.status) {
            let msg = '';
            try { const j = JSON.parse(e.body); msg = (j.error && j.error.message) || ''; } catch (x) { /* */ }
            const code = /has not been used|is disabled|accessNotConfigured/i.test(msg + (e.body || '')) ? 'api_disabled' : 'google_error';
            return res.status(e.status === 401 || e.status === 403 ? e.status : 502).json({ error: code, message: msg || `Googleからエラーが返りました(${e.status})` });
        }
        return res.status(500).json({ error: 'server_error', message: e.message || 'サーバーでエラーが起きました' });
    }
};
module.exports._reset = () => { cache = { token: '', exp: 0 }; };
module.exports._parseReach = parseReach;
