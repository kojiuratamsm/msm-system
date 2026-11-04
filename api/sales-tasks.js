// ============================================================================
// api/sales-tasks.js — 営業成績の毎日の自動処理(Vercel の cron から呼ばれる)
//
//   1) 分析フォームの「完了」回答(2026/9/1以降)のうち、まだ営業成績に無いものを追加する
//      (営業成績ページを開いたときにも同じ同期をする。これはページを開かない日の保険)
//   2) 商談日をもとに、今日(日本時間)の自動タスクを作る
//        商談日の前日: 「(店舗名) 前日リマインド送信」
//        商談日の当日: 「(店舗名) 当日リマインド送信」「(店舗名) 商談」
//      商談日が変わった・結果が入った行の、未完了の自動タスクは取り消す(完了済みは残す)
//   3) 営業成績の行ごとのヒアリングシート(service_type='hearing_sheet')が無ければ作る(既存のシートは書き換えない)
//
// 【実行時刻】 vercel.json の "0 15 * * *"(UTC 15:00 = 日本時間 0:00)。
//   Vercel Hobby プランは「1日1回・実行時刻は最大59分ずれる(0:00〜0:59のどこか)」仕様。
//   出典: https://vercel.com/docs/cron-jobs/usage-and-pricing
//   遅れても困らないよう、ダッシュボードを開いたときにも同じ処理(今日分の作成)を行う。
// 【二重登録の防止】 営業成績の行の id は回答IDから、タスクの id は「行・商談日時・種類」から決まる値。
//   すでに同じ id があれば何もしない(PostgREST の resolution=ignore-duplicates)。
// 【書き込む先】 customers(service_type='sales_record' / 'hearing_sheet' の追加のみ)と tasks だけ。分析フォームの回答・計測は読むだけ。
// 【認証】 CRON_SECRET を設定している場合は、Vercel が付ける Authorization: Bearer <値> を確認する。
// ============================================================================
const Core = require('../lib/sales_core.js');

// 既存の api/*.js と同じ接続先・キー(キーの保管方法は今回変更しない)
const SUPABASE_URL = 'https://xztaacxjlluzqzehendp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dGFhY3hqbGx1enF6ZWhlbmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzM4NzMsImV4cCI6MjA4OTgwOTg3M30.79wvIPepXjvPZwLHOPX7KullShvdvCB7LS2gZO5CtuQ';
const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

async function sb(path, opts) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...(opts || {}), headers: { ...H, ...((opts && opts.headers) || {}) } });
    if (!r.ok) { const t = await r.text().catch(() => ''); const e = new Error(`Supabase ${r.status}: ${t.slice(0, 200)}`); e.status = r.status; throw e; }
    return r;
}
// id の小さい順に全件読む(1回の上限を超えても途中で止まらない)
async function readAll(table, filter) {
    const rows = [];
    let last = null;
    for (let guard = 0; guard < 1000; guard++) {
        const q = `${table}?select=id,data${filter ? '&' + filter : ''}${last !== null ? `&id=gt.${last}` : ''}&order=id.asc&limit=1000`;
        const data = await (await sb(q)).json();
        if (!Array.isArray(data) || data.length === 0) break;
        for (const r of data) { last = r.id; rows.push({ id: r.id, ...(r.data || {}) }); }
    }
    return rows;
}
async function insertIgnore(table, rows) {
    if (!rows.length) return;
    await sb(`${table}?on_conflict=id`, { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(rows) });
}

async function run(nowMs) {
    const out = { added: 0, tasksCreated: 0, tasksRemoved: 0, sheetsCreated: 0, syncSkipped: '' };
    // 1) 同期(分析フォームの質問定義が読めないときは、店舗名を取り違えないよう同期しない)
    const forms = await (await sb('customers?select=id,data&service_type=eq.meo_form')).json();
    const form = Array.isArray(forms) && forms[0] && forms[0].data;
    let records = await readAll('customers', 'service_type=eq.sales_record');
    if (form && Array.isArray(form.questions) && form.questions.length) {
        const responses = await readAll('customers', 'service_type=eq.meo_form_response');
        const plan = Core.planSync(responses, records, form, new Date(nowMs).toISOString());
        await insertIgnore('customers', plan.inserts);
        out.added = plan.inserts.length;
        if (plan.inserts.length) records = await readAll('customers', 'service_type=eq.sales_record');
    } else out.syncSkipped = 'form_not_found';
    // 2) タスク
    const tasks = await readAll('tasks', '');
    const tp = Core.planTasks(records, tasks, nowMs);
    await insertIgnore('tasks', tp.create);
    for (const id of tp.remove) await sb(`tasks?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    out.tasksCreated = tp.create.length;
    out.tasksRemoved = tp.remove.length;
    // 3) ヒアリングシート(id は営業成績の行から決まる値。すでにあれば何もしない)
    const sheets = await readAll('customers', `service_type=eq.${Core.SERVICE_SHEET}`);
    const sp = Core.planSheets(records, sheets, new Date(nowMs).toISOString());
    await insertIgnore('customers', sp);
    out.sheetsCreated = sp.length;
    return out;
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
    try {
        const result = await run(Date.now());
        return res.status(200).json({ ok: true, today: Core.jstDate(Date.now()), ...result });
    } catch (e) {
        console.error('sales-tasks failed', e);
        return res.status(500).json({ error: 'server_error', message: e.message || 'サーバーでエラーが起きました' });
    }
};
module.exports._run = run;
