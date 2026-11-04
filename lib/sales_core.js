// ============================================================================
// lib/sales_core.js — 営業成績の共通ロジック(画面とサーバーの両方で同じものを使う)
//
//   ・ブラウザ: index.html から <script> で読み込む → window.SalesCore
//   ・サーバー: api/sales-tasks.js から require('../lib/sales_core.js')
//   画面とサーバーで数え方・タスクの作り方が食い違わないよう、計算はすべてここに置く。
//   (DBの読み書きはしない。渡されたデータから「何をすべきか」を返すだけの関数の集まり)
//
// 【データの置き場所】 customers テーブル(既存)。テーブルの作成・変更は不要。
//   service_type='sales_record'   : 1回答=1行。id は回答IDから決まる値(二重登録されない)
//   service_type='sales_settings' : 月ごとの目標(1行)
//   tasks テーブル(既存)          : 前日・当日の自動タスク。id は「行・商談日時・種類」から決まる値
// 【日付】 すべて日本時間(Asia/Tokyo = UTC+9。日本は夏時間なし)で区切る。
// ============================================================================
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SalesCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const H9 = 9 * 3600 * 1000;
    const DAY = 24 * 3600 * 1000;
    const pad = (n) => String(n).padStart(2, '0');
    const jp = (ms) => { const d = new Date(ms + H9); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay() }; };
    const jms = (y, m, d = 1, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi) - H9;   // 日本時間 → UTCミリ秒
    const jstDate = (ms) => { const a = jp(ms); return `${a.y}-${pad(a.m)}-${pad(a.d)}`; };
    const dateStartMs = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? jms(+m[1], +m[2], +m[3]) : NaN; };
    const addDays = (s, n) => jstDate(dateStartMs(s) + n * DAY + DAY / 2);
    const toMs = (v) => { if (v == null || v === '') return NaN; const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? t : NaN; };

    // 2026年9月1日 0:00(日本時間)以降に「完了」した回答だけを営業成績に入れる
    const CUTOFF_MS = jms(2026, 9, 1);
    const SERVICE_RECORD = 'sales_record';
    const SERVICE_SETTINGS = 'sales_settings';
    const ID_RESP_BASE = 5e15;   // 回答ID(数字)からのID: 5,000,000,000,000,000 + 回答ID
    const ID_HASH_BASE = 6e15;   // 回答IDが無い・数字でない場合: 6,000,000,000,000,000 + ハッシュ
    const ID_TASK_BASE = 7e15;   // 自動タスク: 7,000,000,000,000,000 + ハッシュ
    const TASK_SERVICE = '営業成績';

    const STATUS_LABEL = { '': '未設定', won: '成約', lost: '不成約', noshow: 'ドタキャン' };
    // 不成約理由の分類(ヒアリングシート・営業成績で共通。「その他」の詳しい内容は不成約理由(lostReason)の文章欄に書く)
    const LOST_CATEGORIES = ['料金が高い', '必要性を感じていない', '自分で運用したい', '他社と比較検討中', '決裁権がない', 'タイミングが悪い', 'その他'];
    const PLANS = ['(一括)Standard Plan半年契約', '(クレカ)Standard Plan半年契約', '(一括)Premium Plan半年契約', '(クレカ)Premium Plan半年契約'];

    // 53bit に収まる決まった数(同じ入力なら必ず同じ値)
    function hash15(str) {
        let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
            h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
            h2 = (h2 ^ (h2 >>> 13)) >>> 0;
        }
        return (h1 * 1048576 + (h2 & 0xFFFFF)) % 1e15;
    }

    // 店舗名の照合用(再申込の判定): 全角半角・大文字小文字・空白・記号・法人格の違いを無視
    function normalizeStore(s) {
        let t = String(s == null ? '' : s);
        try { t = t.normalize('NFKC'); } catch (e) { /* 古い環境 */ }
        t = t.toLowerCase().replace(/株式会社|有限会社|合同会社|\(株\)|\(有\)|㈱|㈲/g, '');
        return t.replace(/[\s・･\-‐ー―_.,、。()（）「」『』【】\[\]'"!！?？&＆/／]/g, '');
    }
    function looksLikeTest(s) { return /てすと|テスト|test/i.test(String(s || '').normalize ? String(s || '').normalize('NFKC') : String(s || '')); }

    // Q1(店舗名・企業名)の質問を探す。見つからなければ1問目
    function storeQuestion(form) {
        const qs = (form && Array.isArray(form.questions)) ? form.questions : [];
        return qs.find(q => /店舗名|企業名/.test(q && q.title || '')) || qs[0] || null;
    }
    function answerText(v) {
        if (v == null) return '';
        if (Array.isArray(v)) return v.map(answerText).filter(Boolean).join('、');
        if (typeof v === 'object') {
            const parts = [];
            ['date', 'start', 'startTime', 'time', 'end', 'label', 'value'].forEach(k => { if (v[k] != null && v[k] !== '') parts.push(String(v[k])); });
            return parts.length ? parts.join(' ') : JSON.stringify(v);
        }
        return String(v);
    }

    // 回答 → 紐づけキー(変わらない回答ID。無ければ 完了日時+店舗名)
    function responseKey(resp, storeName) {
        const rid = resp && resp.id != null && String(resp.id).trim() !== '' ? String(resp.id).trim() : '';
        if (rid) return `resp:${rid}`;
        return `ts:${resp && resp.submittedAt || ''}|${normalizeStore(storeName)}`;
    }
    function recordIdForKey(key) {
        const m = /^resp:(\d{1,15})$/.exec(key);
        if (m && Number(m[1]) < 1e15) return ID_RESP_BASE + Number(m[1]);
        return ID_HASH_BASE + hash15(key);
    }
    function isEligibleResponse(resp) {
        if (!resp || resp.status !== 'completed') return false;
        const t = toMs(resp.submittedAt);
        return Number.isFinite(t) && t >= CUTOFF_MS;
    }

    // 回答から営業成績の行(自動の項目だけ)を作る。個人情報は「回答の写し(Q1〜Q8)」以外は持たない
    // (端末情報・Meet URL などは写さない)
    function buildRecord(resp, form, nowIso) {
        const sq = storeQuestion(form);
        const answers = (resp && resp.answers) || {};
        const storeName = sq ? answerText(answers[sq.id]).trim() : '';
        const qs = (form && Array.isArray(form.questions)) ? form.questions : [];
        const qa = qs.map((q, i) => ({ n: i + 1, title: String(q.title || ''), answer: answerText(answers[q.id]) }));
        const key = responseKey(resp, storeName);
        return {
            id: recordIdForKey(key),
            data: {
                v: 1, key,
                responseId: resp && resp.id != null ? String(resp.id) : '',
                completedAt: new Date(toMs(resp.submittedAt)).toISOString(),
                storeName, storeKey: normalizeStore(storeName),
                qa, qaSavedAt: nowIso,
                excluded: false,
                meetingAt: null, status: '', plan: '', wonDate: '', lostReason: '',
                meetings: [], history: [{ at: nowIso, by: 'system', action: 'create', detail: '分析フォームの完了回答から自動追加' }],
                createdAt: nowIso, updatedAt: nowIso, updatedBy: 'system'
            }
        };
    }

    // 同期: まだ営業成績に無い「9/1以降の完了」だけを追加候補にする(既存の行は一切書き換えない)
    function planSync(responses, records, form, nowIso) {
        const have = new Set((records || []).map(r => r.key));
        const haveIds = new Set((records || []).map(r => Number(r.id)));
        const inserts = [];
        let before = 0, notCompleted = 0, noTime = 0;
        for (const resp of (responses || [])) {
            if (!resp || resp.status !== 'completed') { notCompleted++; continue; }
            const t = toMs(resp.submittedAt);
            if (!Number.isFinite(t)) { noTime++; continue; }
            if (t < CUTOFF_MS) { before++; continue; }
            const rec = buildRecord(resp, form, nowIso);
            if (have.has(rec.data.key) || haveIds.has(rec.id) || inserts.some(x => x.id === rec.id)) continue;
            inserts.push({ id: rec.id, service_type: SERVICE_RECORD, data: rec.data });
        }
        return { inserts, before, notCompleted, noTime };
    }

    // 再申込: 同じ店舗(照合用キー)の2回目以降。除外した行・店舗名が空の行は判定に使わない
    function repeatKeys(records) {
        const seen = new Set(), out = new Set();
        (records || []).filter(r => !r.excluded && r.storeKey).slice()
            .sort((a, b) => toMs(a.completedAt) - toMs(b.completedAt) || String(a.key).localeCompare(String(b.key)))
            .forEach(r => { if (seen.has(r.storeKey)) out.add(r.key); else seen.add(r.storeKey); });
        return out;
    }

    function currentMeeting(d) { const ms = (d && d.meetings) || []; return ms.length ? ms[ms.length - 1] : null; }

    // 表示ラベル(プルダウンの選択肢とは別。表示だけ)
    function displayLabel(d, now) {
        if (d.status === 'won') return { key: 'won', text: '成約' };
        if (d.status === 'lost') return { key: 'lost', text: '不成約' };
        if (d.status === 'noshow') return { key: 'noshow', text: 'ドタキャン' };
        const t = toMs(d.meetingAt);
        if (!Number.isFinite(t)) return { key: 'adjusting', text: '日程調整中' };
        if (t > now) return { key: 'planned', text: '商談予定' };
        return { key: 'missing', text: '結果未入力', alert: true };
    }

    // ---------- 操作(すべて履歴を残す) ----------
    // 戻り値: { data } または { error }。data は新しいオブジェクト(元は変えない)
    function applyAction(src, action, payload, by, nowMs) {
        const d = JSON.parse(JSON.stringify(src));
        const nowIso = new Date(nowMs).toISOString();
        d.meetings = Array.isArray(d.meetings) ? d.meetings : [];
        d.history = Array.isArray(d.history) ? d.history : [];
        const log = (act, detail) => d.history.push({ at: nowIso, by: by || '', action: act, detail });
        const fmt = (iso) => { const t = toMs(iso); if (!Number.isFinite(t)) return '(なし)'; const a = jp(t); return `${a.y}/${a.m}/${a.d} ${a.h}:${pad(a.mi)}`; };
        const cur = currentMeeting(d);
        const validAt = (v) => Number.isFinite(toMs(v));

        if (action === 'setMeeting') {
            const at = payload && payload.at ? new Date(toMs(payload.at)).toISOString() : null;
            if (payload && payload.at && !validAt(payload.at)) return { error: '商談日の形式が正しくありません。' };
            if (d.status) return { error: '結果が入っている行の商談日は直接変更できません。日程が変わった場合は「日程変更」(ドタキャンの場合は「再調整」)を使ってください。' };
            if (!cur || cur.outcome) {
                if (!at) return { data: d };
                d.meetings.push({ at, via: 'initial', setAt: nowIso, setBy: by || '', outcome: null });
                log('meeting', `商談日を入力: ${fmt(at)}`);
            } else if (!at) {
                d.meetings.pop();
                log('meeting', `商談日を削除: ${fmt(cur.at)}`);
            } else {
                if (toMs(cur.at) === toMs(at)) return { data: d };
                log('meeting', `商談日を修正: ${fmt(cur.at)} → ${fmt(at)}(入力の修正。予定数には数えない)`);
                cur.at = at; cur.fixedAt = nowIso;
            }
        } else if (action === 'setStatus') {
            const s = payload && payload.status;
            if (!['', 'won', 'lost', 'noshow'].includes(s)) return { error: '成約状況の値が正しくありません。' };
            if (s === d.status) return { data: d };
            if (s && !cur) return { error: '先に商談日を入力してください。' };
            if (cur) { cur.outcome = s || null; cur.outcomeAt = s ? nowIso : null; cur.outcomeBy = s ? (by || '') : null; }
            log('status', `成約状況: ${STATUS_LABEL[d.status || '']} → ${STATUS_LABEL[s]}`);
            if (s === 'won' && !d.wonDate) { d.wonDate = jstDate(nowMs); log('wonDate', `成約日を自動記録: ${d.wonDate}`); }
            if (s !== 'won' && d.wonDate) { log('wonDate', `成約日を解除: ${d.wonDate}`); d.wonDate = ''; }
            d.status = s;
        } else if (action === 'reschedule' || action === 'readjust') {
            const at = payload && payload.at;
            if (!validAt(at)) return { error: '新しい商談日を入力してください。' };
            if (!cur) return { error: '元の商談日がありません。商談日の欄に入力してください。' };
            if (action === 'reschedule' && d.status) return { error: '日程変更は、結果が「未設定」の行で使えます。' };
            if (action === 'readjust' && d.status !== 'noshow') return { error: '再調整は、ドタキャンの行で使えます。' };
            const iso = new Date(toMs(at)).toISOString();
            if (action === 'reschedule') { cur.outcome = 'reschedule'; cur.outcomeAt = nowIso; cur.outcomeBy = by || ''; }
            d.meetings.push({ at: iso, via: action, setAt: nowIso, setBy: by || '', outcome: null });
            log(action, `${action === 'reschedule' ? '日程変更' : '再調整(ドタキャン後)'}: ${fmt(cur.at)} → ${fmt(iso)}。成約状況は未設定に戻しました`);
            d.status = '';
        } else if (action === 'setPlan') {
            const p = payload && payload.plan || '';
            if (p && !PLANS.includes(p)) return { error: '成約プランの値が正しくありません。' };
            if (p === d.plan) return { data: d };
            log('plan', `成約プラン: ${d.plan || '(なし)'} → ${p || '(なし)'}`); d.plan = p;
        } else if (action === 'setWonDate') {
            const s = payload && payload.date || '';
            if (!Number.isFinite(dateStartMs(s))) return { error: '成約日の形式が正しくありません。' };
            if (d.status !== 'won') return { error: '成約日は成約の行で入力できます。' };
            if (s === d.wonDate) return { data: d };
            log('wonDate', `成約日を修正: ${d.wonDate || '(なし)'} → ${s}`); d.wonDate = s;
        } else if (action === 'setLostReason') {
            const r = String(payload && payload.reason || '').slice(0, 5000);
            if (r === (d.lostReason || '')) return { data: d };
            log('lostReason', `不成約理由を${d.lostReason ? '更新' : '入力'}(${r.length}文字)`); d.lostReason = r;
        } else if (action === 'setLostCategory') {
            const c = String(payload && payload.category || '');
            if (c && !LOST_CATEGORIES.includes(c)) return { error: '不成約理由の分類の値が正しくありません。' };
            if (c && d.status !== 'lost') return { error: '不成約理由の分類は、不成約の行で選べます。' };
            if (c === (d.lostCategory || '')) return { data: d };
            log('lostCategory', `不成約理由の分類: ${d.lostCategory || '(なし)'} → ${c || '(なし)'}`); d.lostCategory = c;
        } else if (action === 'exclude') {
            const v = !!(payload && payload.excluded);
            if (v === !!d.excluded) return { data: d };
            d.excluded = v; d.excludedAt = v ? nowIso : null; d.excludedBy = v ? (by || '') : null;
            log('exclude', v ? '営業成績から除外' : '除外を取り消し');
        } else return { error: '不明な操作です。' };
        d.meetingAt = (currentMeeting(d) || {}).at || null;
        d.updatedAt = nowIso; d.updatedBy = by || '';
        return { data: d };
    }

    // ---------- 集計 ----------
    // 期間 [a, b) の数字。除外した行は数えない(includeExcluded=true で除外前)
    function metrics(records, a, b, opts) {
        const o = opts || {};
        const inP = (t) => Number.isFinite(t) && t >= a && t < b;
        const c = { completed: 0, scheduled: 0, held: 0, noshow: 0, reschedule: 0, lost: 0, won: 0, wonByMeeting: 0 };
        const days = { noshow: [], held: [], won: [] };
        for (const r of (records || [])) {
            if (r.excluded && !o.includeExcluded) continue;
            const ct = toMs(r.completedAt);
            if (inP(ct)) c.completed++;
            if (r.status === 'won' && inP(dateStartMs(r.wonDate))) c.won++;
            for (const m of (r.meetings || [])) {
                const t = toMs(m.at);
                if (!inP(t)) continue;
                c.scheduled++;
                const dd = Number.isFinite(ct) ? (t - ct) / DAY : null;
                if (m.outcome === 'won' || m.outcome === 'lost') { c.held++; if (dd != null) days.held.push(dd); }
                if (m.outcome === 'won') { c.wonByMeeting++; if (dd != null) days.won.push(dd); }
                if (m.outcome === 'lost') c.lost++;
                if (m.outcome === 'noshow') { c.noshow++; if (dd != null) days.noshow.push(dd); }
                if (m.outcome === 'reschedule') c.reschedule++;
            }
        }
        const rate = (n, d) => (d > 0 ? n / d * 100 : null);   // 分母0 → null(画面では「算出不可」)
        const avg = (l) => (l.length ? l.reduce((s, x) => s + x, 0) / l.length : null);
        return {
            ...c,
            heldRate: rate(c.held, c.scheduled),
            noshowRate: rate(c.noshow, c.scheduled),
            // 成約率 = 商談日が期間内の商談のうち、実施した商談(成約+不成約)に占める成約の割合(商談日基準なので100%を超えない)
            winRate: rate(c.wonByMeeting, c.held),
            completeToWonRate: rate(c.won, c.completed),
            avgDays: { noshow: avg(days.noshow), held: avg(days.held), won: avg(days.won) },
            nDays: { noshow: days.noshow.length, held: days.held.length, won: days.won.length }
        };
    }
    // 完了 → 商談日(今の商談日)までの日数
    function daysToMeeting(r) {
        const a = toMs(r.completedAt), b = toMs(r.meetingAt);
        return (Number.isFinite(a) && Number.isFinite(b)) ? (b - a) / DAY : null;
    }

    // ---------- 自動タスク(前日・当日) ----------
    function taskId(key, meetingAt, kind) { return ID_TASK_BASE + hash15(`${key}|${toMs(meetingAt)}|${kind}`); }
    const TASK_TEXT = { prev: '前日リマインド送信', day: '当日リマインド送信', meeting: '商談' };
    function taskRow(rec, kind, date, nowIso) {
        const name = rec.storeName || '(店舗名なし)';
        return {
            id: taskId(rec.key, rec.meetingAt, kind),
            data: {
                text: `${name} ${TASK_TEXT[kind]}`, customer: name, date, service: TASK_SERVICE, done: false,
                auto: 'sales', adminOnly: true, kind, salesKey: rec.key, salesRecordId: rec.id, meetingAt: rec.meetingAt, createdAt: nowIso
            }
        };
    }
    // records: [{id, ...data}]  tasks: [{id, ...data}]
    // 戻り値: create = 今日必要で、まだ無いタスク / remove = 取り消す未完了の自動タスクのid
    function planTasks(records, tasks, nowMs) {
        const today = jstDate(nowMs);
        const nowIso = new Date(nowMs).toISOString();
        const valid = new Set(), create = [];
        const existing = new Set((tasks || []).map(t => Number(t.id)));
        for (const r of (records || [])) {
            if (r.excluded || r.status || !Number.isFinite(toMs(r.meetingAt))) continue;
            const md = jstDate(toMs(r.meetingAt)), prev = addDays(md, -1);
            ['prev', 'day', 'meeting'].forEach(k => valid.add(taskId(r.key, r.meetingAt, k)));
            const want = today === prev ? [['prev', prev]] : today === md ? [['day', md], ['meeting', md]] : [];
            for (const [k, date] of want) {
                const row = taskRow(r, k, date, nowIso);
                if (!existing.has(row.id) && !create.some(x => x.id === row.id)) create.push(row);
            }
        }
        const remove = (tasks || []).filter(t => t.auto === 'sales' && !t.done && !valid.has(Number(t.id))).map(t => Number(t.id));
        return { create, remove };
    }

    // ---------- ヒアリングシート(customers.service_type='hearing_sheet') ----------
    // シート1枚 = 営業成績の1行(=1商談)。シートの id は営業成績の行のキーから決まる値 → 何回作成処理が走っても二重にならない。
    //   商談ID = 営業成績の行の id(salesRecordId)/ 店舗ID = 店舗名を照合用に整えた値(storeKey。再申込の判定と同じ)
    //   店舗名・商談日はシートに写さない(毎回、営業成績の行から読む → 変更が必ず反映される)。
    const SERVICE_SHEET = 'hearing_sheet';
    const ID_SHEET_BASE = 8e15;   // 8,000,000,000,000,000 + ハッシュ(1e15未満)→ 最大 9e15 で、JSの安全な整数(約9.007e15)に収まる
    const SHEET_NOTES = ['method', 'price', 'ideal', 'worry', 'issue'];
    const SHEET_SECTIONS = ['intro', 'trigger', 'current', 'reason', 'ideal', 'meo', 'transition'];
    const SHEET_FIELDS = [...SHEET_NOTES.map(k => 'notes.' + k), ...SHEET_SECTIONS.map(k => 'checks.' + k), 'nextAction', 'nextContactDate', 'owner'];
    // マニュアルの（回答）ごとの入力欄: 'answers.<セクション>-<番号>'(例 answers.trigger-1)
    function isSheetField(f) { return SHEET_FIELDS.includes(f) || /^answers\.[a-z]+-\d{1,3}$/.test(String(f)); }
    function sheetIdForKey(key) { return ID_SHEET_BASE + hash15(`sheet|${key}`); }
    function buildSheet(rec, nowIso) {
        const notes = {}; SHEET_NOTES.forEach(k => { notes[k] = ''; });
        const checks = {}; SHEET_SECTIONS.forEach(k => { checks[k] = false; });
        return {
            id: sheetIdForKey(rec.key),
            service_type: SERVICE_SHEET,
            data: {
                v: 1, salesKey: rec.key, salesRecordId: Number(rec.id), storeKey: rec.storeKey || normalizeStore(rec.storeName),
                notes, checks, answers: {}, nextAction: '', nextContactDate: '', owner: '',
                fieldMeta: {}, createdAt: nowIso, updatedAt: nowIso, updatedBy: 'system'
            }
        };
    }
    // records: 営業成績の行 [{id, ...data}] / sheets: 既存のシート [{id, ...data}]
    // 戻り値: まだシートが無い営業成績の行のぶんだけ、新しいシート(既存のシートは一切書き換えない)
    function planSheets(records, sheets, nowIso) {
        const have = new Set((sheets || []).map(x => Number(x.id)));
        const haveKeys = new Set((sheets || []).map(x => x.salesKey));
        const inserts = [];
        for (const r of (records || [])) {
            if (!r || !r.key) continue;
            const row = buildSheet(r, nowIso);
            if (have.has(row.id) || haveKeys.has(r.key) || inserts.some(x => x.id === row.id)) continue;
            inserts.push(row);
        }
        return inserts;
    }
    function getField(d, f) { const [a, b] = f.split('.'); return b ? ((d && d[a]) || {})[b] : (d || {})[a]; }
    function setField(d, f, v) { const [a, b] = f.split('.'); if (b) { d[a] = { ...(d[a] || {}) }; d[a][b] = v; } else d[a] = v; }
    function progressOf(d) {
        const c = (d && d.checks) || {};
        const done = SHEET_SECTIONS.filter(k => c[k]).length;
        return { done, total: SHEET_SECTIONS.length, pct: Math.round(done / SHEET_SECTIONS.length * 100) };
    }
    // 欄ごとの保存(同時編集の対策)
    //   latest: 保存直前に読み直した最新 / changes: { 欄: { base: 読み込んだときの値, val: 自分の値 } }
    //   ほかの人が同じ欄を先に変えていた(最新 ≠ base かつ 最新 ≠ 自分の値)ときは、その欄は保存せず conflicts に入れる。
    //   ほかの欄の変更はそのまま残す(上書きしない)。
    function mergeSheet(latest, changes, by, nowMs) {
        const d = JSON.parse(JSON.stringify(latest || {}));
        const nowIso = new Date(nowMs).toISOString();
        const saved = [], conflicts = [];
        let changed = false;
        d.fieldMeta = { ...(d.fieldMeta || {}) };
        for (const f of Object.keys(changes || {})) {
            if (!isSheetField(f)) continue;
            const { base, val } = changes[f];
            const cur = getField(d, f);
            const same = (x, y) => JSON.stringify(x == null ? '' : x) === JSON.stringify(y == null ? '' : y);
            if (same(cur, val)) { saved.push(f); continue; }
            if (!same(cur, base)) { conflicts.push({ field: f, theirs: cur, mine: val, meta: d.fieldMeta[f] || null }); continue; }
            setField(d, f, val);
            d.fieldMeta[f] = { at: nowIso, by: by || '' };
            saved.push(f); changed = true;
        }
        if (changed) { d.updatedAt = nowIso; d.updatedBy = by || ''; }
        return { data: d, saved, conflicts, changed };
    }

    // ---------- 月ごとの目標 ----------
    function monthKey(ms) { const a = jp(ms); return `${a.y}-${pad(a.m)}`; }
    function goalOf(settings, ym) {
        const g = settings && settings.months && settings.months[ym];
        const n = (v) => (v === '' || v == null || !Number.isFinite(Number(v))) ? null : Number(v);
        return g ? { won: n(g.won), held: n(g.held), wonGood: n(g.wonGood), wonPoor: n(g.wonPoor), heldGood: n(g.heldGood), heldPoor: n(g.heldPoor) } : { won: null, held: null, wonGood: null, wonPoor: null, heldGood: null, heldPoor: null };
    }

    return {
        H9, DAY, pad, jp, jms, jstDate, dateStartMs, addDays, toMs,
        CUTOFF_MS, SERVICE_RECORD, SERVICE_SETTINGS, TASK_SERVICE, STATUS_LABEL, PLANS, LOST_CATEGORIES,
        hash15, normalizeStore, looksLikeTest, storeQuestion, answerText,
        responseKey, recordIdForKey, isEligibleResponse, buildRecord, planSync, repeatKeys,
        currentMeeting, displayLabel, applyAction, metrics, daysToMeeting,
        taskId, planTasks, monthKey, goalOf,
        SERVICE_SHEET, SHEET_NOTES, SHEET_SECTIONS, SHEET_FIELDS, isSheetField, sheetIdForKey, buildSheet, planSheets, getField, setField, progressOf, mergeSheet
    };
});
