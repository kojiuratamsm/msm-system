// js/pages/sales_performance.js
// 営業成績: 分析フォームの「完了」回答(2026/9/1以降)を1回答=1行で自動追加し、商談(Zoom)の結果を記録して
// 成約率・ドタキャン率などを日間・月間・年間で見るページ(管理者のみ)。
//
// 【データ】(計算・タスクの作り方は lib/sales_core.js にまとめてある。サーバーの自動実行も同じものを使う)
//   customers.service_type='sales_record'   1回答=1行。id は回答IDから決まる値 → 何回同期しても二重登録されない
//   customers.service_type='sales_settings' 月ごとの目標(1行)
//   分析フォームの回答(meo_form_response)・計測(meo_form_stats)は読むだけ。書き換えない。
// 【同期】 ページを開いたとき・再読み込みしたときに必ず同期し、開いている間も約1分ごとに新しい完了を確認する。
//          毎日0:00(日本時間)の自動実行(api/sales-tasks.js)でも同期する。
// 【日付】 すべて日本時間。期間の選び方・ゲージの見た目・判定はKPI状況と同じ(KpiInternals / KpiCalc を使う)。
(function () {
    const C = window.SalesCore;
    const { jp, jms, jstDate, pad, toMs, DAY } = C;
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const WD = ['日', '月', '火', '水', '木', '金', '土'];
    const fmtN = (n) => (n == null || !Number.isFinite(n)) ? '-' : Math.round(n).toLocaleString();
    const fmt1 = (n) => (n == null || !Number.isFinite(n)) ? '-' : (Math.round(n * 10) / 10).toFixed(1);
    const fmtP = (n) => (n == null || !Number.isFinite(n)) ? '算出不可' : `${fmt1(n)}%`;
    const fmtDT = (v) => { const t = toMs(v); if (!Number.isFinite(t)) return ''; const a = jp(t); return `${a.y}/${a.m}/${a.d} ${a.h}:${pad(a.mi)}`; };
    const fmtD = (v) => { const t = toMs(v); if (!Number.isFinite(t)) return ''; const a = jp(t); return `${a.y}/${a.m}/${a.d}(${WD[a.wd]})`; };
    const toLocalInput = (v) => { const t = toMs(v); if (!Number.isFinite(t)) return ''; const a = jp(t); return `${a.y}-${pad(a.m)}-${pad(a.d)}T${pad(a.h)}:${pad(a.mi)}`; };
    // <input type="datetime-local"> の値を「日本時間」として読む(パソコンの時間帯設定に左右されない)
    const fromLocalInput = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || '')); return m ? new Date(jms(+m[1], +m[2], +m[3], +m[4], +m[5])).toISOString() : null; };
    const STATUS = {
        good: { icon: '🟢', label: '良好', cls: 'good' }, normal: { icon: '🟡', label: '通常', cls: 'normal' },
        poor: { icon: '🔴', label: '要改善', cls: 'poor' }, hold: { icon: '⚪', label: '判定保留', cls: 'hold' }, na: { icon: '⚪', label: '算出不可', cls: 'na' }
    };
    const GCOL = { good: '#2F9E44', normal: '#F59F00', poor: '#E03131', hold: '#ADB5BD', na: '#868E96' };   // KPI状況のゲージと同じ色
    const LABEL_CLS = { won: 'sp-lb-won', lost: 'sp-lb-lost', noshow: 'sp-lb-noshow', adjusting: 'sp-lb-adj', planned: 'sp-lb-plan', missing: 'sp-lb-miss' };

    const UI = window.SalesUiState = window.SalesUiState || { mode: 'monthly', sub: 'this', day: '', month: '', from: '', to: '', basis: 'all', status: 'all', q: '', showExcluded: false };
    const S = { records: [], settings: { rowId: null, data: { months: {} } }, submissions: [], form: null, loadErr: '', syncInfo: null, pending: {}, focusKey: null, newCount: 0 };
    let charts = [], pollTimer = null;

    // ---------- 読み込み・同期 ----------
    async function loadRecords() {
        const res = await Store.getAllRows(C.SERVICE_RECORD);
        S.records = res.rows.map(r => ({ ...r, id: r.id }));
    }
    async function loadSettings() {
        const rows = await Store.getCustomers(C.SERVICE_SETTINGS);
        const row = rows.slice().sort((a, b) => Number(a.id) - Number(b.id))[0];
        S.settings = { rowId: row ? row.id : null, data: { months: (row && row.months) || {}, updatedAt: row && row.updatedAt, updatedBy: row && row.updatedBy } };
    }
    // 分析フォームの完了回答を営業成績に追加(既存の行は書き換えない)。戻り値: 追加した件数
    async function syncResponses() {
        const form = await Store.getMEOForm();
        if (!form || !Array.isArray(form.questions) || form.questions.length === 0) {
            throw new Error('分析フォームの質問定義を読み込めなかったため、店舗名を正しく取り込めません。同期を中止しました(時間をおいて再読み込みしてください)。');
        }
        S.form = form;
        const res = await Store.getAllRows('meo_form_response');
        const plan = C.planSync(res.rows, S.records, form, new Date().toISOString());
        if (plan.inserts.length) {
            await Store.salesUpsertIgnore('customers', plan.inserts);
            await loadRecords();
        }
        S.syncInfo = { at: Date.now(), added: plan.inserts.length, before: plan.before, noTime: plan.noTime, responses: res.rows.length };
        // 営業成績の行ごとのヒアリングシートが無ければ作る(js/pages/sales_hub.js。失敗しても営業成績の表示は止めない)
        try { if (window.HearingSheetEnsure) await window.HearingSheetEnsure(S.records); } catch (e) { console.error('hearing sheet ensure', e); }
        return plan.inserts.length;
    }
    async function loadSubmissions() {
        const res = await Store.getAllRows('meo_form_stats');
        S.submissions = res.rows.filter(r => r.type === 'submission').map(r => Date.parse(r.timestamp)).filter(Number.isFinite);
    }

    // 自動タスク(前日・当日)を今日の分だけ作り、不要になった未完了の自動タスクを取り消す。ダッシュボードからも呼ぶ
    async function syncTasks(records) {
        const recs = records || (await Store.getAllRows(C.SERVICE_RECORD)).rows;
        const tasks = await Store.salesGetTasks();
        const plan = C.planTasks(recs, tasks, Date.now());
        if (plan.create.length) await Store.salesUpsertIgnore('tasks', plan.create);
        for (const id of plan.remove) await Store.salesDeleteTask(id);
        return plan;
    }
    window.SalesTaskSync = syncTasks;
    // 営業(js/pages/sales_hub.js)から呼ぶ: 分析フォームの完了 → 営業成績 の同期(ヒアリングシートの作成も含む)と自動タスク
    window.SalesSyncAll = async function () {
        await loadRecords();
        await syncResponses();
        try { await syncTasks(S.records); } catch (e) { console.error(e); }
        return S.records;
    };

    // ---------- 1行の操作(保存前に最新を読み、他の人の更新を上書きしない。保存後に読み直して確認) ----------
    async function act(id, action, payload) {
        const rec = S.records.find(r => String(r.id) === String(id));
        if (!rec) return;
        const user = Auth.getCurrentUser();
        try {
            const row = await Store.salesGetRow('customers', rec.id);
            if (!row || !row.data) throw new Error('この行が見つかりませんでした。再読み込みしてください。');
            if ((row.data.updatedAt || '') !== (rec.updatedAt || '')) {
                alert('この行は、ほかの人(または別の画面)が先に更新していました。最新の内容を表示し直すので、もう一度操作してください。');
                Object.assign(rec, row.data);
                render();
                return;
            }
            const r = C.applyAction(row.data, action, payload, user && user.email || '', Date.now());
            if (r.error) { alert(r.error); render(); return; }
            if (JSON.stringify(r.data) === JSON.stringify(row.data)) { render(); return; }
            await Store.salesUpdateData('customers', rec.id, r.data);
            const again = await Store.salesGetRow('customers', rec.id);
            if (!again || !again.data || again.data.updatedAt !== r.data.updatedAt) throw new Error('保存した内容を確認できませんでした。通信状態を確認して、再読み込みしてください。');
            Object.keys(rec).forEach(k => { if (k !== 'id') delete rec[k]; });
            Object.assign(rec, again.data);
            delete S.pending[rec.id];
            render();
            try { await syncTasks(S.records); } catch (e) { console.error(e); toast('タスクの更新に失敗しました(次にダッシュボードを開いたときに再作成されます)'); }
        } catch (e) {
            console.error(e);
            alert(e.message || '保存に失敗しました。');
            render();
        }
    }
    function toast(msg) {
        const el = document.getElementById('sp-toast');
        if (!el) return;
        el.textContent = msg; el.style.display = 'block';
        clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    // ---------- ページ ----------
    App.Pages.sales_performance = async function (opts) {
        const user = Auth.getCurrentUser();
        if (!user || user.role !== 'admin') {
            App.mount('<div class="card" style="margin-top:24px; padding:40px; text-align:center;"><h3 class="card-title">営業成績は管理者のみ閲覧できます</h3></div>');
            return;
        }
        S.focusKey = opts && opts.focus ? String(opts.focus) : null;
        S.loadErr = '';
        try {
            await Promise.all([loadRecords(), loadSettings(), loadSubmissions()]);
        } catch (e) {
            console.error(e);
            App.mount(`<div class="card" style="padding:32px; border-left:4px solid #E03131;"><h3 style="margin-bottom:8px;">営業成績を読み込めませんでした</h3><p style="line-height:1.8;">${esc(e.message || '')}</p>
                <p style="color:var(--text-secondary); font-size:0.85rem;">不完全な数字を出さないよう、表示を止めています。時間をおいてもう一度読み込んでください。</p>
                <button class="btn-primary" style="margin-top:16px;" onclick="App.navigate('sales_performance')">もう一度読み込む</button></div>`);
            return;
        }
        try { await syncResponses(); } catch (e) { console.error(e); S.loadErr = e.message || '同期に失敗しました。'; }
        try { await syncTasks(S.records); } catch (e) { console.error(e); }

        App.mount(`<div id="sp-root"></div><div id="sp-toast" class="sp-toast"></div>${STYLE}`, () => {
            bindGlobals();
            render();
            if (S.focusKey) setTimeout(() => {
                const el = document.querySelector(`[data-key="${CSS.escape(S.focusKey)}"]`);
                if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('sp-focus'); }
            }, 50);
            startPolling();
        });
    };

    // 開いている間、約1分ごとに新しい「完了」を確認して追加する(入力中は画面を書き換えずにお知らせだけ)
    function startPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(async () => {
            if (!document.getElementById('sp-root')) { clearInterval(pollTimer); pollTimer = null; return; }
            if (document.visibilityState && document.visibilityState !== 'visible') return;
            try {
                const added = await syncResponses();
                if (!added) return;
                const a = document.activeElement;
                const editing = a && document.getElementById('sp-root').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
                if (editing || document.getElementById('sp-modal')) { S.newCount += added; showNewBanner(); }
                else { S.newCount = 0; render(); toast(`新しい完了を${added}件追加しました`); }
                try { await syncTasks(S.records); } catch (e) { console.error(e); }
            } catch (e) { console.error('sales poll', e); }
        }, 60000);
    }
    function showNewBanner() {
        const el = document.getElementById('sp-new');
        if (el) { el.innerHTML = `新しい完了が<b>${S.newCount}件</b>あります。<button class="btn-primary btn-sm" onclick="spApplyNew()">一覧に反映する</button>`; el.style.display = 'flex'; }
    }

    function bindGlobals() {
        window.spSet = (patch) => { Object.assign(UI, patch); render(); };
        window.spPickDay = (day) => {
            const t = jp(Date.now()); const today = `${t.y}-${pad(t.m)}-${pad(t.d)}`;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) { const y = jp(jms(t.y, t.m, t.d) - 1); day = `${y.y}-${pad(y.m)}-${pad(y.d)}`; }
            if (day > today) day = today;
            Object.assign(UI, { mode: 'daily', sub: 'pick', day }); render();
        };
        window.spShiftDay = (delta) => {
            const p0 = window.KpiInternals.buildPeriod(UI, Date.now());
            const a = jp(p0.start + delta * DAY + DAY / 2), t = jp(Date.now());
            const today = `${t.y}-${pad(t.m)}-${pad(t.d)}`, day = `${a.y}-${pad(a.m)}-${pad(a.d)}`;
            if (day >= today) { Object.assign(UI, { mode: 'daily', sub: 'today' }); render(); return; }
            window.spPickDay(day);
        };
        window.spApplyNew = () => { S.newCount = 0; render(); };
        window.spMeeting = (id, v) => act(id, 'setMeeting', { at: v ? fromLocalInput(v) : null });
        window.spStatus = (id, v) => {
            if (v === 'reschedule') { S.pending[id] = 'reschedule'; render(); return; }
            delete S.pending[id];
            act(id, 'setStatus', { status: v });
        };
        window.spStartReadjust = (id) => { S.pending[id] = 'readjust'; render(); };
        window.spCancelPending = (id) => { delete S.pending[id]; render(); };
        window.spSaveNewDate = (id) => {
            const inp = document.getElementById(`sp-newdate-${id}`);
            const at = inp ? fromLocalInput(inp.value) : null;
            if (!at) { alert('新しい商談日(日時)を入力してください。'); return; }
            act(id, S.pending[id] === 'readjust' ? 'readjust' : 'reschedule', { at });
        };
        window.spPlan = (id, v) => act(id, 'setPlan', { plan: v });
        window.spWonDate = (id, v) => act(id, 'setWonDate', { date: v });
        window.spReason = (id, v) => act(id, 'setLostReason', { reason: v });
        window.spLostCat = (id, v) => act(id, 'setLostCategory', { category: v });
        window.spExclude = (id, v) => {
            if (v && !confirm('この行を営業成績から除外します(集計に入れません)。あとで取り消せます。よろしいですか？')) return;
            act(id, 'exclude', { excluded: v });
        };
        window.spOpenReason = (id) => openReason(id);
        window.spOpenDetail = (id) => openDetail(id);
        window.spOpenGoals = () => openGoals();
        window.spCsv = () => downloadCsv();
        window.spFilter = (patch) => { Object.assign(UI, patch); renderList(); };
    }

    // ---------- 期間 ----------
    const KI = () => window.KpiInternals;
    function periodNow() { return KI().buildPeriod(UI, Date.now()); }
    function prevWindow(p, now) {
        const pv = KI().prevPeriod(p);
        const inProgress = now < p.end;
        // 期間の途中なら、前の期間の「同じ経過分」と比べる
        const end = inProgress ? Math.min(pv.end, pv.start + (now - p.start)) : pv.end;
        return { start: pv.start, end, inProgress };
    }
    const PREV_LABEL = { daily: '前日', monthly: '前月', yearly: '前年', custom: '前の同じ日数' };

    // ---------- 画面 ----------
    function render() {
        charts.forEach(c => { try { c.destroy(); } catch (e) { /* */ } });
        charts = [];
        const root = document.getElementById('sp-root');
        if (!root) return;
        const now = Date.now();
        const p = periodNow();
        const effEnd = Math.min(p.end, now);
        const cur = C.metrics(S.records, p.start, effEnd);
        const pw = prevWindow(p, now);
        const prev = C.metrics(S.records, pw.start, pw.end);
        root.innerHTML = `
            ${S.loadErr ? `<div class="card sp-warn"><b>同期できませんでした:</b> ${esc(S.loadErr)}</div>` : ''}
            <div id="sp-new" class="sp-new" style="display:none;"></div>
            ${headerHtml(p, now)}
            ${goalsBarHtml(p)}
            ${gaugesHtml(p, now)}
            <div class="kpi-sec-title">数字(${esc(p.label)}${now < p.end ? '・途中経過' : ''})</div>
            <div class="kpi-cards sp-cards">${cardsHtml(cur, prev, p, pw)}</div>
            <div class="kpi-note">比較は${PREV_LABEL[p.type]}${pw.inProgress ? 'の同じ経過分' : ''}と比べています。商談予定数・商談数・ドタキャン・日程変更・不成約は「商談の予定日」、成約数は「成約日」、診断完了数は「完了日時」で数えます。分母が0のときは「算出不可」と表示します(0%にしません)。除外した行は数えません。</div>
            ${reconcileHtml(p, now)}
            ${insightHtml(p, effEnd)}
            <div class="kpi-sec-title" id="sp-list-title">営業成績の一覧</div>
            <div class="card sp-list-card">${filtersHtml()}<div id="sp-list"></div></div>
            ${S.syncInfo ? `<div class="kpi-note">最終同期: ${fmtDT(new Date(S.syncInfo.at).toISOString())}(この画面を開いたとき・再読み込み時、および開いている間は約1分ごとに自動で同期します)</div>` : ''}`;
        renderList();
        drawGauges(p, now);
        if (S.newCount) showNewBanner();
    }

    function headerHtml(p, now) {
        const t = jp(now);
        const todayStr = `${t.y}-${pad(t.m)}-${pad(t.d)}`, thisMonth = `${t.y}-${pad(t.m)}`;
        const shown = jp(p.start), shownStr = `${shown.y}-${pad(shown.m)}-${pad(shown.d)}`;
        const TL = { daily: '日間', monthly: '月間', yearly: '年間' };
        const tabs = ['daily', 'monthly', 'yearly'].map(tp => `<button type="button" class="kpi-tab ${UI.mode === tp ? 'is-on' : ''}" onclick="spSet({ mode: '${tp}', sub: '${tp === 'daily' ? 'today' : 'this'}' })">${TL[tp]}</button>`).join('');
        let sub = '';
        if (UI.mode === 'daily') {
            const isPick = UI.sub === 'pick';
            sub = `<div class="kpi-daybar">
                <div class="kpi-seg" role="group" aria-label="日付の選び方">
                    <button type="button" class="${UI.sub === 'today' ? 'is-on' : ''}" onclick="spSet({ sub: 'today' })">今日</button>
                    <button type="button" class="${UI.sub === 'yesterday' ? 'is-on' : ''}" onclick="spSet({ sub: 'yesterday' })">昨日</button>
                    <button type="button" class="${isPick ? 'is-on' : ''}" onclick="spPickDay('${shownStr < todayStr ? shownStr : ''}')"><i class="ph ph-calendar-blank"></i> 日付を指定</button>
                </div>
                <div class="kpi-daynav">
                    <button type="button" class="btn-secondary btn-sm" onclick="spShiftDay(-1)">◀ 前日</button>
                    ${isPick ? `<input type="date" id="sp-day-input" value="${esc(shownStr)}" max="${todayStr}" onchange="spPickDay(this.value)">` : ''}
                    <button type="button" class="btn-secondary btn-sm" onclick="spShiftDay(1)" ${shownStr >= todayStr ? 'disabled' : ''}>翌日 ▶</button>
                </div></div>`;
        } else if (UI.mode === 'monthly') sub = `
            <select onchange="spSet({ sub: this.value })"><option value="this" ${UI.sub === 'this' ? 'selected' : ''}>今月</option><option value="last" ${UI.sub === 'last' ? 'selected' : ''}>先月</option><option value="pick" ${UI.sub === 'pick' ? 'selected' : ''}>月を選ぶ</option></select>
            ${UI.sub === 'pick' ? `<input type="month" value="${esc(UI.month)}" max="${thisMonth}" onchange="spSet({ month: this.value > '${thisMonth}' ? '${thisMonth}' : this.value })">` : ''}`;
        else if (UI.mode === 'yearly') sub = `<select onchange="spSet({ sub: this.value })"><option value="this" ${UI.sub === 'this' ? 'selected' : ''}>今年</option><option value="last" ${UI.sub === 'last' ? 'selected' : ''}>昨年</option></select>`;
        else sub = UI.sub === 'range' ? `<input type="date" value="${esc(UI.from)}" max="${todayStr}" onchange="spSet({ from: this.value })"><span>〜</span><input type="date" value="${esc(UI.to)}" max="${todayStr}" onchange="spSet({ to: this.value })">` : '';
        let showing;
        if (p.type === 'daily') {
            const label = `${shown.y}年${shown.m}月${shown.d}日（${WD[shown.wd]}）`;
            showing = shownStr === todayStr ? `表示中：今日 ${label}<span class="kpi-showing-sub">途中経過</span>` : `表示中：${label}<span class="kpi-showing-sub">確定値</span>`;
        } else showing = `表示中：${esc(p.label)}${now < p.end ? '<span class="kpi-showing-sub">途中経過</span>' : '<span class="kpi-showing-sub">確定値</span>'}`;
        return `<div class="card kpi-head">
            <div class="kpi-head-row">
                <div class="kpi-tabs" role="tablist">${tabs}</div>
                <div class="kpi-other">
                    <select onchange="if (this.value) spSet({ mode: 'custom', sub: this.value })" title="日間・月間・年間以外の期間">
                        <option value="">その他の期間…</option>
                        <option value="last7" ${UI.mode === 'custom' && UI.sub === 'last7' ? 'selected' : ''}>直近7日間</option>
                        <option value="last30" ${UI.mode === 'custom' && UI.sub === 'last30' ? 'selected' : ''}>直近30日間</option>
                        <option value="range" ${UI.mode === 'custom' && UI.sub === 'range' ? 'selected' : ''}>任意の期間</option>
                    </select>
                    <button type="button" class="btn-secondary btn-sm" onclick="spOpenGoals()"><i class="ph ph-sliders-horizontal"></i> 目標・判定基準</button>
                </div>
            </div>
            <div class="kpi-head-row" style="margin-top:12px;"><div class="kpi-period">${UI.mode === 'daily' ? '' : `<b>${esc(p.label)}</b>`} ${sub}</div></div>
            <div class="kpi-showing" data-showing="${p.type === 'daily' ? shownStr : esc(p.label)}">${showing}</div>
        </div>`;
    }

    // 画面上部: 表示中の月の目標(入力は「目標・判定基準」から。月ごとに別々に保存)
    function goalsBarHtml(p) {
        const ym = C.monthKey(p.type === 'yearly' || p.type === 'custom' ? Date.now() : p.start);
        const g = C.goalOf(S.settings.data, ym);
        const v = (n) => n == null ? '<span class="kpi-unset">未設定</span>' : `<b>${fmtN(n)}件</b>`;
        const crit = (gd, pr) => (gd == null && pr == null) ? '基準未設定' : [gd != null ? `良好 ${fmt1(gd)}%以上` : null, pr != null ? `要改善 ${fmt1(pr)}%未満` : null].filter(Boolean).join(' / ');
        return `<div class="card sp-goals" data-goal-month="${ym}">
            <div class="sp-goals-title"><i class="ph ph-target"></i> ${ym.replace('-', '年')}月の目標</div>
            <div class="sp-goals-items">
                <div>成約目標 ${v(g.won)}<small>${esc(crit(g.wonGood, g.wonPoor))}</small></div>
                <div>商談数(実施)目標 ${v(g.held)}<small>${esc(crit(g.heldGood, g.heldPoor))}</small></div>
            </div>
            <button type="button" class="btn-secondary btn-sm" onclick="spOpenGoals()"><i class="ph ph-pencil-simple"></i> 目標を入力</button>
        </div>`;
    }

    // ---------- 目標達成度のゲージ(KPI状況と同じ見た目・判定色) ----------
    // 月間: 月の実績 ÷ 月目標(内側の細い弧 = 月の経過)
    // 日間: その日の数字は数値カードで表示し、ゲージは「月初からその日までの累計 ÷ 月目標」
    // 年間: 目標を入力した月の目標の合計 ÷ それらの月の実績の合計(未入力の月は「未設定」。0扱いにしない)
    function gaugeData(p, now) {
        const metricsOf = (a, b) => C.metrics(S.records, a, Math.min(b, now));
        const GKEYS = [{ key: 'won', label: '成約数', field: 'won', good: 'wonGood', poor: 'wonPoor' }, { key: 'held', label: '商談数(実施)', field: 'held', good: 'heldGood', poor: 'heldPoor' }];
        if (p.type === 'custom') return { note: 'その他の期間では、月ごとの目標に対するゲージは表示しません(日間・月間・年間で表示します)。', list: [] };
        if (p.type === 'monthly' || p.type === 'daily') {
            const a = jp(p.start), ms = jms(a.y, a.m, 1), me = jms(a.y, a.m + 1, 1);
            const ym = C.monthKey(ms), g = C.goalOf(S.settings.data, ym);
            const upto = p.type === 'daily' ? Math.min(p.end, now) : Math.min(me, now);
            const m = metricsOf(ms, upto);
            const pace = Math.max(0, Math.min(1, (upto - ms) / (me - ms)));
            const inProgress = upto < me;
            const scope = p.type === 'daily' ? `${a.m}/1〜${jp(upto - 1).m}/${jp(upto - 1).d}の累計(月目標に対して)` : `${a.y}年${a.m}月`;
            return { scope, inProgress, list: GKEYS.map(k => ({ ...k, value: m[k.field], T: g[k.field], good: g[k.good], poor: g[k.poor], pace, inProgress })) };
        }
        // 年間
        const y = jp(p.start).y;
        return {
            scope: `${y}年(目標を入力した月の合計)`, inProgress: now < p.end,
            list: GKEYS.map(k => {
                let T = 0, val = 0, expected = 0, setMonths = [], unset = [];
                for (let mo = 1; mo <= 12; mo++) {
                    const g = C.goalOf(S.settings.data, `${y}-${pad(mo)}`);
                    const ms = jms(y, mo, 1), me = jms(y, mo + 1, 1);
                    if (g[k.field] == null) { unset.push(mo); continue; }
                    setMonths.push(mo);
                    T += g[k.field];
                    if (ms < now) val += metricsOf(ms, me)[k.field];
                    expected += g[k.field] * Math.max(0, Math.min(1, (now - ms) / (me - ms)));
                }
                const pace = T > 0 ? expected / T : 1;
                const gy = C.goalOf(S.settings.data, `${y}-${pad(jp(Math.min(now, p.end - 1)).m)}`);   // 判定基準は表示中の月(今年なら今月)の設定
                return { ...k, value: val, T: setMonths.length ? T : null, good: gy[k.good], poor: gy[k.poor], pace, inProgress: pace < 1, setMonths, unset, fullYear: metricsOf(p.start, p.end)[k.field] };
            })
        };
    }
    function gaugesHtml(p, now) {
        const gd = gaugeData(p, now);
        if (!gd.list.length) return `<div class="kpi-sec-title">目標達成度</div><div class="kpi-note">${esc(gd.note)}</div>`;
        const dayNums = p.type === 'daily' ? (() => { const m = C.metrics(S.records, p.start, Math.min(p.end, now)); return `<div class="sp-daynums"><div>この日の商談数(実施) <b>${fmtN(m.held)}件</b></div><div>この日の成約数 <b>${fmtN(m.won)}件</b></div></div>`; })() : '';
        const one = (r) => {
            const j = window.KpiCalc.judgeCount(r.value, { target: r.T, good: r.good, poor: r.poor }, r.inProgress ? r.pace : 1, false);
            r.j = j;
            const st = STATUS[j.status];
            const head = `<div class="kpi-g-title">${r.label}<span class="kpi-chip kpi-chip-${st.cls}">${st.icon} ${st.label}</span></div><div class="kpi-short kpi-short-${st.cls}" title="${esc(j.reason)}">${esc(j.short)}</div>`;
            const yearInfo = r.setMonths ? `<div class="kpi-mini sp-ymonths">目標を入力した月: ${r.setMonths.length ? r.setMonths.map(m => m + '月').join('・') : 'なし'}${r.unset.length ? ` / <b>未設定</b>: ${r.unset.map(m => m + '月').join('・')}(0件扱いにしていません)` : ''}<br>年間の実績(全月): ${fmtN(r.fullYear)}件</div>` : '';
            if (!(r.T > 0)) return `<div class="kpi-gauge is-empty" data-metric="${r.key}" data-gauge="none">${head}<div class="kpi-g-empty"><b>目標未設定</b><div class="kpi-mini">実績 ${fmtN(r.value)}件。「目標・判定基準」で月の目標を入れるとゲージを表示します。</div></div>${yearInfo}</div>`;
            const a = window.KpiCalc.achievement(r.value, r.T);
            const d = r.value - r.T;
            const fc = (r.inProgress && r.pace > 0 && !r.setMonths) ? (() => { const proj = r.value / r.pace, low = r.pace < 0.2 || r.value < 10; return `<div class="kpi-forecast" data-forecast="${r.key}"><b>着地見込み ${fmtN(proj)}件</b>(目標比 ${fmtP(proj / r.T * 100)})${low ? ' <span class="kpi-lowacc">予測精度が低い</span>' : ''}<div class="kpi-mini">今までの実績 ${fmtN(r.value)}件 ÷ 経過割合 ${fmt1(r.pace * 100)}%。今までと同じペースが月末まで続いた場合の目安です。</div></div>`; })() : '';
            return `<div class="kpi-gauge" data-metric="${r.key}" data-gauge="on" data-ach="${a == null ? '' : a}" data-value="${r.value}" data-target="${r.T}">
                ${head}
                <div class="kpi-g-box"><canvas id="sp-gauge-${r.key}"></canvas>
                    <div class="kpi-g-center"><div class="kpi-g-pct">${fmtP(a)}</div><div class="kpi-g-cap">目標に対する達成率</div>${a > 100 ? '<div class="kpi-g-over">100%超過</div>' : ''}</div></div>
                <div class="kpi-g-row"><span>実績</span><b>${fmtN(r.value)}件</b></div>
                <div class="kpi-g-row"><span>目標</span><b>${fmtN(r.T)}件</b></div>
                <div class="kpi-g-row"><span>目標との差</span>${d >= 0 ? `<b class="kpi-up">+${fmtN(d)}件(超過)</b>` : `<b class="kpi-down">${fmtN(d)}件(あと${fmtN(-d)}件)</b>`}</div>
                ${r.inProgress ? `<div class="kpi-g-row kpi-g-pace"><span>参考: 期間の経過</span><b>${fmt1(r.pace * 100)}%</b></div>` : ''}
                ${fc}${yearInfo}
            </div>`;
        };
        S._gauges = gd.list;
        const html = gd.list.map(one).join('');
        return `<div class="kpi-sec-title">目標達成度 <span class="sp-scope">${esc(gd.scope)}</span></div>${dayNums}
            <div class="kpi-gauges sp-gauges">${html}</div>
            <div class="kpi-note">外側の太い弧は<b>目標に対する達成率</b>(100%を超えても弧は満タンまで)。${gd.inProgress ? '内側の細い弧は<b>期間の経過</b>です。' : ''}成約は「成約日」、商談数(実施)は「商談の予定日」で数えます。${p.type === 'daily' ? '日間は、その日までの月の累計を月目標と比べます。' : ''}</div>`;
    }
    function drawGauges() {
        if (typeof Chart === 'undefined' || !S._gauges) return;
        S._gauges.forEach(r => {
            const el = document.getElementById(`sp-gauge-${r.key}`);
            if (!el || !r.j) return;
            const a = window.KpiCalc.achievement(r.value, r.T);
            const fill = Math.max(0, Math.min(100, a || 0));
            const datasets = [{ data: [fill, 100 - fill], backgroundColor: [GCOL[r.j.status], '#E9ECEF'], borderWidth: 0 }];
            if (r.inProgress) { const pp = Math.max(0, Math.min(100, r.pace * 100)); datasets.push({ data: [pp, 100 - pp], backgroundColor: ['#495057', 'rgba(0,0,0,0)'], borderWidth: 0, weight: 0.28 }); }
            charts.push(new Chart(el, { type: 'doughnut', data: { labels: ['達成', '未達'], datasets }, options: { rotation: -90, circumference: 180, cutout: '72%', responsive: true, maintainAspectRatio: false, events: [], plugins: { legend: { display: false }, tooltip: { enabled: false } } } }));
        });
    }

    // ---------- 数値カード ----------
    const CARDS = [
        { key: 'completed', label: '診断完了数', tip: '分析フォームの完了日時が期間内の件数' },
        { key: 'scheduled', label: '商談予定数', tip: '商談の予定日が期間内の件数。日程変更・ドタキャンの前の予定日も、その日の分として数えます(入力の修正は数えません)' },
        { key: 'held', label: '商談数(実施)', tip: '商談の予定日が期間内で、成約または不成約になった件数' },
        { key: 'noshow', label: 'ドタキャン数', tip: '予定日が期間内の商談のうちドタキャン' },
        { key: 'reschedule', label: '日程変更数', tip: '予定日が期間内の商談のうち日程変更' },
        { key: 'lost', label: '不成約数', tip: '予定日が期間内の商談のうち不成約' },
        { key: 'won', label: '成約数', tip: '成約日が期間内の件数' },
        { key: 'heldRate', label: '実施率', rate: ['held', 'scheduled'], tip: '商談数 ÷ 商談予定数' },
        { key: 'noshowRate', label: 'ドタキャン率', rate: ['noshow', 'scheduled'], tip: 'ドタキャン数 ÷ 商談予定数' },
        { key: 'winRate', label: '成約率', rate: ['wonByMeeting', 'held'], tip: '予定日が期間内の商談のうち、実施した商談(成約+不成約)に占める成約の割合。分子も商談の予定日で数えるので、月をまたいでも100%を超えません' },
        { key: 'completeToWonRate', label: '完了→成約率', rate: ['won', 'completed'], tip: '成約数 ÷ 診断完了数' }
    ];
    function cardsHtml(cur, prev, p, pw) {
        return CARDS.map(c => {
            const v = cur[c.key], pv = prev[c.key];
            const main = c.rate ? (v == null ? '<span class="kpi-na">算出不可</span>' : `${fmt1(v)}<small>%</small>`) : `${fmtN(v)}<small>件</small>`;
            const sub = c.rate ? `${fmtN(cur[c.rate[0]])} ÷ ${fmtN(cur[c.rate[1]])}` : '';
            let cmp;
            if (c.rate) cmp = (v == null || pv == null) ? `<span class="kpi-cmp-na">${PREV_LABEL[p.type]}: ${fmtP(pv)}(比較不可)</span>` : `${PREV_LABEL[p.type]} ${fmtP(pv)} → <b class="${v - pv >= 0 ? 'kpi-up' : 'kpi-down'}">${v - pv >= 0 ? '+' : ''}${fmt1(v - pv)}pt</b>`;
            else { const d = v - pv; cmp = `${PREV_LABEL[p.type]}${pw.inProgress ? '同時点' : ''} ${fmtN(pv)}件 → <b class="${d > 0 ? 'kpi-up' : d < 0 ? 'kpi-down' : ''}">${d > 0 ? '+' : ''}${fmtN(d)}件</b>`; }
            return `<div class="kpi-card sp-card" data-metric="${c.key}" data-value="${v == null ? '' : v}">
                <div class="kpi-card-head"><span class="kpi-card-title">${c.label} <i class="ph ph-question kpi-tip" title="${esc(c.tip)}"></i></span></div>
                <div class="kpi-main">${main}</div>
                <div class="kpi-mini">${sub ? sub + ' ・ ' : ''}${cmp}</div>
            </div>`;
        }).join('');
    }

    // ---------- KPI状況との照合(診断完了数) ----------
    function reconcileHtml(p, now) {
        const a = Math.max(p.start, C.CUTOFF_MS), b = Math.min(p.end, now);
        if (b <= a) return `<div class="card sp-recon"><b>KPI状況との照合:</b> この期間は営業成績の対象(2026/9/1以降)ではありません。</div>`;
        const after = C.metrics(S.records, a, b).completed;
        const before = C.metrics(S.records, a, b, { includeExcluded: true }).completed;
        const kpi = S.submissions.filter(t => t >= a && t < b).length;
        const same = before === kpi;
        // 日ごとの差分
        const byDay = {};
        S.records.forEach(r => { const t = toMs(r.completedAt); if (t >= a && t < b) { const d = jstDate(t); (byDay[d] = byDay[d] || { s: 0, k: 0 }).s++; } });
        S.submissions.forEach(t => { if (t >= a && t < b) { const d = jstDate(t); (byDay[d] = byDay[d] || { s: 0, k: 0 }).k++; } });
        const diffs = Object.keys(byDay).sort().filter(d => byDay[d].s !== byDay[d].k);
        return `<div class="card sp-recon ${same ? 'is-ok' : 'is-ng'}" data-recon="${same ? 'ok' : 'ng'}" data-kpi="${kpi}" data-before="${before}" data-after="${after}">
            <div><b>KPI状況との照合(診断完了数${p.start < C.CUTOFF_MS ? '・2026/9/1以降の分' : ''})</b></div>
            <div class="sp-recon-nums"><span>営業成績(除外後) <b>${fmtN(after)}件</b></span><span>営業成績(除外前・KPI状況と同じ基準) <b>${fmtN(before)}件</b></span><span>KPI状況 <b>${fmtN(kpi)}件</b></span>
                <span class="${same ? 'kpi-up' : 'kpi-down'}">${same ? '✓ 一致' : `差 ${before - kpi > 0 ? '+' : ''}${before - kpi}件`}</span></div>
            ${diffs.length ? `<table class="sp-mini-table"><thead><tr><th>日付</th><th>営業成績(除外前)</th><th>KPI状況</th><th>差</th></tr></thead><tbody>${diffs.map(d => `<tr><td>${d}</td><td>${byDay[d].s}</td><td>${byDay[d].k}</td><td>${byDay[d].s - byDay[d].k}</td></tr>`).join('')}</tbody></table>
            <div class="kpi-note">差が出る主な理由: 分析フォームの「データをリセット」でKPI状況の記録が消えた(営業成績は残る) / 完了時に回答の保存か完了の記録の片方だけ失敗した / 日付の境目(0:00前後)の数秒のずれ。</div>` : ''}
        </div>`;
    }

    // ---------- 営業改善に使う見方 ----------
    function insightHtml(p, effEnd) {
        const m = C.metrics(S.records, p.start, effEnd);
        const d = (v, n) => v == null ? `<span class="kpi-cmp-na">算出不可(0件)</span>` : `<b>${fmt1(v)}日</b><small>(${n}件)</small>`;
        const lost = [];
        S.records.forEach(r => { if (r.excluded) return; (r.meetings || []).forEach(mt => { const t = toMs(mt.at); if (mt.outcome === 'lost' && t >= p.start && t < effEnd) lost.push({ r, t }); }); });
        lost.sort((x, y) => y.t - x.t);
        return `<div class="kpi-sec-title">営業改善のための見方</div>
        <div class="sp-insight">
            <div class="card sp-ins-card"><div class="sp-ins-title">診断完了 → 商談日までの平均日数(商談の予定日が期間内)</div>
                <div class="sp-avg"><div>ドタキャン ${d(m.avgDays.noshow, m.nDays.noshow)}</div><div>実施(成約+不成約) ${d(m.avgDays.held, m.nDays.held)}</div><div>成約 ${d(m.avgDays.won, m.nDays.won)}</div></div>
                <div class="kpi-note">日程の空き(完了から商談までの日数)がドタキャンに影響しているかを比べるための数字です。件数が少ないうちは参考程度に見てください。</div></div>
            <div class="card sp-ins-card"><div class="sp-ins-title">不成約理由の一覧(商談の予定日が期間内・${lost.length}件)</div>
                ${lost.length ? `<div class="sp-reasons">${lost.map(x => `<div class="sp-reason-item"><div class="sp-reason-head"><button class="sp-link" onclick="spOpenDetail('${x.r.id}')">${esc(x.r.storeName || '(店舗名なし)')}</button><span>${fmtD(new Date(x.t).toISOString())}</span></div><div class="sp-reason-text">${x.r.lostCategory ? `<b>[${esc(x.r.lostCategory)}]</b> ` : ''}${esc(x.r.lostReason || (x.r.lostCategory ? '' : '(理由未入力)'))}</div></div>`).join('')}</div>` : '<div class="kpi-note">この期間の不成約はありません。</div>'}
            </div>
        </div>`;
    }

    // ---------- 一覧 ----------
    function filtered() {
        const now = Date.now(), p = periodNow();
        const rep = C.repeatKeys(S.records);
        const q = C.normalizeStore(UI.q || '');
        return S.records.filter(r => {
            if (r.excluded && !UI.showExcluded) return false;
            if (UI.basis === 'completed') { const t = toMs(r.completedAt); if (!(t >= p.start && t < p.end)) return false; }
            if (UI.basis === 'meeting') { if (!(r.meetings || []).some(m => { const t = toMs(m.at); return t >= p.start && t < p.end; })) return false; }
            if (q && !(r.storeKey || '').includes(q)) return false;
            const lb = C.displayLabel(r, now).key;
            if (UI.status === 'unset' && r.status) return false;
            if (['adjusting', 'planned', 'missing', 'won', 'lost', 'noshow'].includes(UI.status) && lb !== UI.status) return false;
            if (UI.status === 'trouble' && !(r.meetings || []).some(m => m.outcome === 'noshow' || m.outcome === 'reschedule')) return false;
            return true;
        }).map(r => ({ r, repeat: rep.has(r.key) })).sort((a, b) => toMs(b.r.completedAt) - toMs(a.r.completedAt));
    }
    // 絞り込み欄は一覧の外に置く(入力中に作り直さないので、店舗名の検索中もカーソルが外れない)
    function filtersHtml() {
        const opt = (v, l, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`;
        return `<div class="sp-filters">
            <label>期間 <select onchange="spFilter({ basis: this.value })">${opt('all', 'すべての期間', UI.basis)}${opt('completed', '完了日時が表示中の期間', UI.basis)}${opt('meeting', '商談日が表示中の期間', UI.basis)}</select></label>
            <label>成約状況 <select onchange="spFilter({ status: this.value })">${opt('all', 'すべて', UI.status)}${opt('unset', '未設定(すべて)', UI.status)}${opt('adjusting', '└ 日程調整中', UI.status)}${opt('planned', '└ 商談予定', UI.status)}${opt('missing', '└ 結果未入力', UI.status)}${opt('won', '成約', UI.status)}${opt('lost', '不成約', UI.status)}${opt('noshow', 'ドタキャン', UI.status)}${opt('trouble', 'ドタキャン・日程変更が起きた行', UI.status)}</select></label>
            <label>店舗名 <input type="search" value="${esc(UI.q)}" placeholder="店舗名で検索" oninput="spFilter({ q: this.value })" id="sp-q"></label>
            <label class="sp-chk"><input type="checkbox" ${UI.showExcluded ? 'checked' : ''} onchange="spFilter({ showExcluded: this.checked })"> 除外した行も表示</label>
            <button class="btn-secondary btn-sm" onclick="spCsv()"><i class="ph ph-download-simple"></i> CSV出力</button>
            <span class="sp-count" id="sp-count"></span>
        </div>`;
    }
    function renderList() {
        const el = document.getElementById('sp-list');
        if (!el) return;
        const now = Date.now();
        const list = filtered();
        const cnt = document.getElementById('sp-count');
        if (cnt) cnt.textContent = `${list.length}件`;
        const rows = list.map(({ r, repeat }) => rowHtml(r, repeat, now)).join('');
        el.innerHTML = `<div class="sp-table-wrap"><table class="sp-table"><thead><tr>
            <th>完了日時</th><th>店舗名</th><th title="診断完了から今の商談日までの日数">完了→商談</th><th>商談日</th><th>成約状況</th><th>成約プラン / 不成約理由</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="7" class="sp-empty">該当する行はありません</td></tr>'}</tbody></table></div>`;
    }
    function rowHtml(r, repeat, now) {
        const id = String(r.id);
        const lb = C.displayLabel(r, now);
        const pend = S.pending[id];
        const dd = C.daysToMeeting(r);
        const statusSel = `<select class="sp-status" onchange="spStatus('${id}', this.value)" ${r.excluded ? 'disabled' : ''}>
            <option value="" ${!r.status && !pend ? 'selected' : ''}>未設定</option>
            <option value="won" ${r.status === 'won' ? 'selected' : ''}>成約</option>
            <option value="lost" ${r.status === 'lost' ? 'selected' : ''}>不成約</option>
            <option value="noshow" ${r.status === 'noshow' ? 'selected' : ''}>ドタキャン</option>
            <option value="reschedule" ${pend === 'reschedule' ? 'selected' : ''} ${r.status || !r.meetingAt ? 'disabled' : ''}>日程変更</option></select>`;
        let extra = '';
        if (pend) {
            extra = `<div class="sp-newdate"><div class="sp-mini-label">${pend === 'readjust' ? '再調整後' : '変更後'}の新しい商談日</div>
                <input type="datetime-local" id="sp-newdate-${id}">
                <div class="sp-btns"><button class="btn-primary btn-sm" onclick="spSaveNewDate('${id}')">保存</button><button class="btn-secondary btn-sm" onclick="spCancelPending('${id}')">キャンセル</button></div>
                <div class="kpi-mini">保存すると、元の商談日は履歴に残り、成約状況は「未設定(商談予定)」に戻ります。</div></div>`;
        } else if (r.status === 'won') {
            extra = `<select class="sp-plan" onchange="spPlan('${id}', this.value)"><option value="">成約プランを選択</option>${C.PLANS.map(pl => `<option ${r.plan === pl ? 'selected' : ''}>${esc(pl)}</option>`).join('')}</select>
                <label class="sp-mini-label">成約日 <input type="date" value="${esc(r.wonDate)}" onchange="spWonDate('${id}', this.value)"></label>`;
        } else if (r.status === 'lost') {
            extra = `<select class="sp-plan sp-lostcat" onchange="spLostCat('${id}', this.value)"><option value="">理由の分類を選択</option>${C.LOST_CATEGORIES.map(c => `<option ${r.lostCategory === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
                <textarea class="sp-reason" rows="2" placeholder="不成約理由を入力" onchange="spReason('${id}', this.value)">${esc(r.lostReason)}</textarea>
                <button class="btn-secondary btn-sm sp-full" onclick="spOpenReason('${id}')"><i class="ph ph-arrows-out-simple"></i> 全文</button>`;
        } else if (r.status === 'noshow') {
            extra = `<button class="btn-primary btn-sm" onclick="spStartReadjust('${id}')"><i class="ph ph-calendar-plus"></i> 再調整</button>`;
        }
        const meetingCell = r.status
            ? `<div class="sp-mt-fixed">${r.meetingAt ? esc(fmtDT(r.meetingAt)) : '-'}</div>`
            : `<input type="datetime-local" class="sp-meeting" value="${esc(toLocalInput(r.meetingAt))}" onchange="spMeeting('${id}', this.value)" ${r.excluded ? 'disabled' : ''}>`;
        return `<tr data-key="${esc(r.key)}" data-id="${id}" class="${r.excluded ? 'sp-excluded' : ''} ${lb.alert ? 'sp-row-alert' : ''}">
            <td class="sp-nowrap">${esc(fmtDT(r.completedAt).replace(' ', '\n'))}</td>
            <td><button class="sp-link sp-store" onclick="spOpenDetail('${id}')">${esc(r.storeName || '(店舗名なし)')}</button>
                ${repeat ? '<span class="sp-badge sp-badge-repeat">再申込</span>' : ''}${r.excluded ? '<span class="sp-badge sp-badge-ex">除外中</span>' : ''}${!r.excluded && C.looksLikeTest(r.storeName) ? '<span class="sp-badge sp-badge-test" title="店舗名に「てすと」「テスト」などが含まれています">テスト?</span>' : ''}</td>
            <td class="sp-nowrap">${dd == null ? '-' : fmt1(dd) + '日'}</td>
            <td class="sp-meet-td">${meetingCell}${r.status ? '' : '<div class="sp-hint">日程が変わった場合は『日程変更』を選んでください</div>'}</td>
            <td>${statusSel}<div><span class="sp-label ${LABEL_CLS[lb.key]}" data-label="${lb.key}">${lb.text}</span></div></td>
            <td class="sp-extra">${extra}</td>
            <td><button class="btn-secondary btn-sm sp-ex-btn" onclick="spExclude('${id}', ${!r.excluded})">${r.excluded ? '除外を<br>取り消す' : '営業成績から<br>除外'}</button></td>
        </tr>`;
    }

    // ---------- モーダル(不成約理由の全文・詳細・目標) ----------
    function modal(html, cls) {
        closeModal();
        const ov = document.createElement('div');
        ov.id = 'sp-modal'; ov.className = `sp-overlay ${cls || ''}`;
        ov.innerHTML = html;
        ov.addEventListener('click', (e) => { if (e.target === ov) closeModal(); });
        document.body.appendChild(ov);
        return ov;
    }
    function closeModal() { const o = document.getElementById('sp-modal'); if (o) o.remove(); if (S.newCount) showNewBanner(); }
    window.spCloseModal = closeModal;

    function openReason(id) {
        const r = S.records.find(x => String(x.id) === String(id)); if (!r) return;
        const ov = modal(`<div class="sp-dialog"><div class="sp-dlg-head"><b>不成約理由: ${esc(r.storeName)}</b><button class="btn-icon" onclick="spCloseModal()"><i class="ph ph-x"></i></button></div>
            <textarea id="sp-reason-full" rows="12">${esc(r.lostReason)}</textarea>
            <div class="sp-btns" style="justify-content:flex-end;"><button class="btn-secondary" onclick="spCloseModal()">閉じる</button><button class="btn-primary" id="sp-reason-save">保存</button></div></div>`);
        ov.querySelector('#sp-reason-save').onclick = async () => { const v = ov.querySelector('#sp-reason-full').value; closeModal(); await act(id, 'setLostReason', { reason: v }); };
    }

    function openDetail(id) {
        const r = S.records.find(x => String(x.id) === String(id)); if (!r) return;
        const rep = C.repeatKeys(S.records).has(r.key);
        const lb = C.displayLabel(r, Date.now());
        const VIA = { initial: '初回の入力', reschedule: '日程変更', readjust: '再調整(ドタキャン後)' };
        const OUT = { won: '成約', lost: '不成約', noshow: 'ドタキャン', reschedule: '日程変更' };
        const meetings = (r.meetings || []).map((m, i) => `<tr><td>${i + 1}</td><td>${esc(fmtDT(m.at))}</td><td>${VIA[m.via] || ''}</td><td>${m.outcome ? OUT[m.outcome] : '(結果なし)'}</td><td>${esc(m.setBy || '')}</td></tr>`).join('');
        const hist = (r.history || []).slice().reverse().map(h => `<tr><td class="sp-nowrap">${esc(fmtDT(h.at))}</td><td>${esc(h.by === 'system' ? '自動' : h.by)}</td><td>${esc(h.detail)}</td></tr>`).join('');
        modal(`<div class="sp-panel" role="dialog" aria-label="詳細">
            <div class="sp-dlg-head"><div><b class="sp-panel-title">${esc(r.storeName || '(店舗名なし)')}</b> ${rep ? '<span class="sp-badge sp-badge-repeat">再申込</span>' : ''}${r.excluded ? '<span class="sp-badge sp-badge-ex">除外中</span>' : ''}
                <div class="kpi-mini">完了日時 ${esc(fmtDT(r.completedAt))} ・ <span class="sp-label ${LABEL_CLS[lb.key]}">${lb.text}</span></div></div>
                <button class="btn-icon" onclick="spCloseModal()" aria-label="閉じる"><i class="ph ph-x"></i></button></div>
            <div class="sp-panel-body">
                <div class="sp-sec"><div class="sp-sec-title">分析フォームの回答</div>
                    <dl class="sp-qa">${(r.qa || []).map(x => `<dt>Q${x.n}. ${esc(x.title)}</dt><dd>${esc(x.answer) || '<span class="kpi-cmp-na">(回答なし)</span>'}</dd>`).join('')}</dl>
                    <div class="kpi-mini">回答日時 ${esc(fmtDT(r.completedAt))}(回答内容は営業成績に追加した時点の写しです。分析フォームのデータをリセットしても残ります)</div></div>
                <div class="sp-sec"><div class="sp-sec-title">成約プラン・不成約理由</div>
                    <div>成約プラン: ${esc(r.plan) || '-'} ・ 成約日: ${esc(r.wonDate) || '-'}</div>
                    <div class="sp-reason-text" style="margin-top:6px;">不成約理由: ${r.lostCategory ? `[${esc(r.lostCategory)}] ` : ''}${esc(r.lostReason) || (r.lostCategory ? '' : '-')}</div></div>
                <div class="sp-sec"><div class="sp-sec-title">商談日の履歴</div>
                    ${meetings ? `<table class="sp-mini-table"><thead><tr><th>#</th><th>商談日</th><th>入力のきっかけ</th><th>結果</th><th>入力者</th></tr></thead><tbody>${meetings}</tbody></table>` : '<div class="kpi-note">まだ商談日はありません。</div>'}</div>
                <div class="sp-sec"><div class="sp-sec-title">変更の履歴(誰が・いつ・何を)</div>
                    <table class="sp-mini-table"><thead><tr><th>日時</th><th>担当</th><th>内容</th></tr></thead><tbody>${hist}</tbody></table></div>
            </div></div>`, 'sp-side');
    }

    function openGoals() {
        const now = Date.now();
        const p = periodNow();
        let ym = C.monthKey(p.type === 'monthly' || p.type === 'daily' ? p.start : now);
        const draw = () => {
            const g = C.goalOf(S.settings.data, ym);
            const v = (x) => x == null ? '' : x;
            const ov = modal(`<div class="sp-dialog"><div class="sp-dlg-head"><b>目標・判定基準(月ごと)</b><button class="btn-icon" onclick="spCloseModal()"><i class="ph ph-x"></i></button></div>
                <label class="sp-mini-label">対象の月 <input type="month" id="sp-g-month" value="${ym}"></label>
                <div class="kpi-note">目標は月ごとに別々に保存します(ほかの月には影響しません)。良好・要改善は、KPI状況と同じく「今の時点の目安(目標 × 期間の経過)に対する達成率(%)」で判定します。</div>
                <table class="sp-goal-table"><thead><tr><th></th><th>目標(件)</th><th>良好(%以上)</th><th>要改善(%未満)</th></tr></thead><tbody>
                    <tr><th>月の成約目標</th><td><input type="number" min="0" step="1" id="sp-g-won" value="${v(g.won)}"></td><td><input type="number" min="0" step="0.1" id="sp-g-wonGood" value="${v(g.wonGood)}"></td><td><input type="number" min="0" step="0.1" id="sp-g-wonPoor" value="${v(g.wonPoor)}"></td></tr>
                    <tr><th>月の商談数(実施)目標</th><td><input type="number" min="0" step="1" id="sp-g-held" value="${v(g.held)}"></td><td><input type="number" min="0" step="0.1" id="sp-g-heldGood" value="${v(g.heldGood)}"></td><td><input type="number" min="0" step="0.1" id="sp-g-heldPoor" value="${v(g.heldPoor)}"></td></tr>
                </tbody></table>
                <div id="sp-g-err" class="sp-err"></div>
                <div class="sp-btns" style="justify-content:flex-end;"><button class="btn-secondary" onclick="spCloseModal()">閉じる</button><button class="btn-primary" id="sp-g-save">この月の目標を保存</button></div></div>`);
            ov.querySelector('#sp-g-month').onchange = (e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { ym = e.target.value; draw(); } };
            ov.querySelector('#sp-g-save').onclick = async () => {
                const val = (k) => { const s = ov.querySelector(`#sp-g-${k}`).value.trim(); return s === '' ? null : Number(s); };
                const n = { won: val('won'), held: val('held'), wonGood: val('wonGood'), wonPoor: val('wonPoor'), heldGood: val('heldGood'), heldPoor: val('heldPoor') };
                const errs = [];
                ['won', 'held'].forEach(k => { if (n[k] != null && (!Number.isInteger(n[k]) || n[k] < 0)) errs.push('目標は0以上の整数で入力してください。'); });
                ['wonGood', 'wonPoor', 'heldGood', 'heldPoor'].forEach(k => { if (n[k] != null && !(n[k] >= 0)) errs.push('基準(%)は0以上で入力してください。'); });
                if (n.wonGood != null && n.wonPoor != null && n.wonPoor > n.wonGood) errs.push('成約: 要改善の基準が良好の基準より大きくなっています。');
                if (n.heldGood != null && n.heldPoor != null && n.heldPoor > n.heldGood) errs.push('商談数: 要改善の基準が良好の基準より大きくなっています。');
                if (errs.length) { ov.querySelector('#sp-g-err').textContent = [...new Set(errs)].join(' '); return; }
                try { await saveGoals(ym, n); closeModal(); render(); toast(`${ym}の目標を保存しました`); }
                catch (e) { ov.querySelector('#sp-g-err').textContent = e.message || '保存に失敗しました。'; }
            };
        };
        draw();
    }
    async function saveGoals(ym, g) {
        const user = Auth.getCurrentUser();
        await loadSettings();   // 最新を読み直し、ほかの月の目標を消さない
        const months = { ...(S.settings.data.months || {}) };
        months[ym] = g;
        const payload = { months, updatedAt: new Date().toISOString(), updatedBy: user && user.email || '' };
        if (S.settings.rowId) await Store.updateCustomer(C.SERVICE_SETTINGS, S.settings.rowId, payload);
        else await Store.addCustomer(C.SERVICE_SETTINGS, payload);
        await loadSettings();
        if (JSON.stringify(S.settings.data.months[ym]) !== JSON.stringify(g)) throw new Error('保存した内容を確認できませんでした。通信状態を確認してください。');
    }

    // ---------- CSV(表示中の一覧) ----------
    function downloadCsv() {
        const now = Date.now();
        const cell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
        const head = ['完了日時', '店舗名', '再申込', '除外', '完了→商談(日)', '商談日', '成約状況', '表示ラベル', '成約プラン', '成約日', '不成約理由', '商談回数', 'ドタキャン回数', '日程変更回数', '不成約理由の分類'];
        const lines = [head.map(cell).join(',')];
        filtered().forEach(({ r, repeat }) => {
            const ms = r.meetings || [];
            const dd = C.daysToMeeting(r);
            lines.push([fmtDT(r.completedAt), r.storeName, repeat ? '再申込' : '', r.excluded ? '除外' : '', dd == null ? '' : fmt1(dd), fmtDT(r.meetingAt), C.STATUS_LABEL[r.status || ''], C.displayLabel(r, now).text, r.plan, r.wonDate, r.lostReason,
                ms.length, ms.filter(m => m.outcome === 'noshow').length, ms.filter(m => m.outcome === 'reschedule').length, r.lostCategory || ''].map(cell).join(','));
        });
        const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `営業成績_${jstDate(now)}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    // テスト用に中身を公開(画面の動作には使わない)
    window.SalesInternals = { S, UI, render, syncResponses, syncTasks, filtered };

    // KPI状況(js/pages/kpi.js)と同じ見た目にするため、KPI状況のスタイルを写して使う + 営業成績用の追加分
    const STYLE = `<style>
        /* ↓ js/pages/kpi.js の STYLE と同じ内容(見た目をKPI状況とそろえるため) */
        .kpi-head { padding: 16px 20px; margin-bottom: 14px; }
        .kpi-head-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .kpi-tabs { display: inline-flex; background: var(--bg-tertiary, #f1f3f5); border-radius: 12px; padding: 4px; gap: 4px; }
        .kpi-tab { border: none; background: transparent; padding: 10px 18px; border-radius: 9px; font-weight: 700; font-size: 0.95rem; cursor: pointer; color: var(--text-secondary); font-family: inherit; }
        .kpi-tab.is-on { background: var(--primary, #111); color: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.15); }
        .kpi-other { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .kpi-other select, .kpi-period select, .kpi-period input { width: auto; padding: 6px 10px; font-size: 0.85rem; }
        .kpi-period { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 1.1rem; }
        .kpi-daybar { display: flex; align-items: center; gap: 10px 14px; flex-wrap: wrap; }
        .kpi-seg { display: inline-flex; border: 1px solid var(--border-light, #ddd); border-radius: 10px; overflow: hidden; }
        .kpi-seg button { border: none; background: #fff; padding: 8px 14px; font-size: 0.88rem; font-weight: 600; cursor: pointer; font-family: inherit; color: var(--text-secondary); display: inline-flex; align-items: center; gap: 4px; }
        .kpi-seg button + button { border-left: 1px solid var(--border-light, #ddd); }
        .kpi-seg button.is-on { background: #1C64D8; color: #fff; }
        .kpi-daynav { display: inline-flex; align-items: center; gap: 6px; }
        .kpi-daynav input[type=date] { width: auto; padding: 6px 10px; font-size: 0.9rem; }
        .kpi-daynav button:disabled { opacity: .4; cursor: not-allowed; }
        .kpi-showing { margin-top: 12px; padding: 10px 14px; background: #F1F6FF; border-left: 4px solid #1C64D8; border-radius: 8px; font-size: 1.05rem; font-weight: 800; color: #1A3D7C; }
        .kpi-showing-sub { display: inline-block; margin-left: 10px; font-size: 0.78rem; font-weight: 600; color: #4A6FA5; }
        .kpi-short { font-size: 0.72rem; margin-top: 6px; line-height: 1.5; color: var(--text-secondary); }
        .kpi-short-hold, .kpi-short-na { color: #495057; font-weight: 600; }
        .kpi-short-poor { color: #C92A2A; } .kpi-short-good { color: #2B8A3E; } .kpi-short-normal { color: #B07500; }
        .kpi-chip-na { background: #E9ECEF; color: #495057; border: 1px dashed #868E96; }
        .kpi-st-na { border-top-color: #868E96; }
        .kpi-daily-note { margin: 10px 0 0; padding: 10px 14px; background: #FFF9DB; border: 1px solid #FFE066; border-radius: 10px; font-size: 0.82rem; line-height: 1.7; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: space-between; }
        .kpi-status { font-size: 0.85rem; line-height: 1.9; margin: 0 4px 14px; color: var(--text-secondary); }
        .kpi-badge { display: inline-block; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; margin-right: 4px; }
        .kpi-badge-run { background: #E7F1FF; color: #1C64D8; }
        .kpi-badge-fix { background: #EBFBEE; color: #2B8A3E; }
        .kpi-warn { color: #C25E00; font-weight: 600; }
        .kpi-loadinfo { font-size: 0.75rem; color: var(--text-secondary); }
        .kpi-note { font-size: 0.75rem; color: var(--text-secondary); line-height: 1.7; margin-top: 8px; }
        .kpi-sec-title { font-weight: 800; font-size: 1rem; margin: 18px 0 10px; }
        .kpi-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
        .kpi-card { background: var(--bg-secondary, #fff); border-radius: 14px; padding: 16px; border: 1px solid var(--border-light, #eee); border-top: 4px solid #CED4DA; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
        .kpi-st-good { border-top-color: #2F9E44; } .kpi-st-normal { border-top-color: #F59F00; } .kpi-st-poor { border-top-color: #E03131; } .kpi-st-hold { border-top-color: #ADB5BD; }
        .kpi-card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .kpi-card-title { font-weight: 700; font-size: 0.9rem; }
        .kpi-tip { color: var(--text-secondary); cursor: help; }
        .kpi-chip { display: inline-flex; align-items: center; gap: 3px; font-size: 0.72rem; font-weight: 700; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
        .kpi-chip-good { background: #EBFBEE; color: #2B8A3E; } .kpi-chip-normal { background: #FFF9DB; color: #B07500; } .kpi-chip-poor { background: #FFF0F0; color: #C92A2A; } .kpi-chip-hold { background: #F1F3F5; color: #495057; }
        .kpi-main { font-size: 2rem; font-weight: 800; margin: 6px 0 2px; line-height: 1.2; }
        .kpi-main small { font-size: 0.9rem; font-weight: 600; margin-left: 2px; color: var(--text-secondary); }
        .kpi-na { font-size: 1.3rem; color: var(--text-secondary); }
        .kpi-unset { color: var(--text-secondary); font-weight: 600; }
        .kpi-row { font-size: 0.82rem; margin-top: 4px; }
        .kpi-mini { font-size: 0.72rem; color: var(--text-secondary); line-height: 1.6; margin-left: 4px; }
        .kpi-bar { position: relative; height: 8px; background: #E9ECEF; border-radius: 4px; margin: 6px 0; overflow: visible; }
        .kpi-bar-fill { height: 100%; background: #4C8DF6; border-radius: 4px; }
        .kpi-bar-pace { position: absolute; top: -3px; width: 2px; height: 14px; background: #212529; }
        .kpi-up { color: #2B8A3E; } .kpi-down { color: #C92A2A; } .kpi-cmp-na { color: var(--text-secondary); }
        .kpi-cmp { font-size: 0.75rem; line-height: 1.7; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-light, #e5e5e5); }
        .kpi-forecast { font-size: 0.8rem; margin-top: 8px; padding: 8px 10px; background: #F8F9FA; border-radius: 8px; }
        .kpi-lowacc { display: inline-block; font-size: 0.7rem; font-weight: 700; color: #C25E00; background: #FFF4E5; padding: 1px 6px; border-radius: 4px; }
        .kpi-why { margin-top: 8px; font-size: 0.78rem; }
        .kpi-why summary { cursor: pointer; color: var(--info, #4285F4); font-weight: 600; }
        .kpi-why > div { margin-top: 6px; line-height: 1.7; color: var(--text-primary, #333); }
        .kpi-sugg { padding: 16px 20px; margin: 18px 0 4px; }
        .kpi-overview { padding: 12px 18px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
        .kpi-ov-chips { display: flex; gap: 6px; flex-wrap: wrap; }
        .kpi-ov-chips .kpi-chip { font-size: 0.85rem; padding: 5px 12px; }
        .kpi-ov-top { font-size: 0.9rem; }
        .kpi-ov-link { margin-left: 10px; font-size: 0.8rem; color: var(--info, #4285F4); text-decoration: none; }
        .kpi-sugg-item summary { cursor: pointer; list-style: none; }
        .kpi-sugg-item summary::-webkit-details-marker { display: none; }
        .kpi-sugg-item:not([open]) summary::after { content: ' ▸ 開く'; font-size: 0.75rem; color: var(--info, #4285F4); font-weight: 600; }
        .kpi-sugg-table, .kpi-formula table { white-space: normal; min-width: 0 !important; table-layout: auto; }
        .kpi-sugg-table tbody tr:hover { background: transparent; }
        .kpi-sugg-table th { background: transparent; text-transform: none; letter-spacing: 0; border-bottom: 1px solid var(--border-light, #eee); }
        .kpi-sugg-table td { border-bottom: 1px solid var(--border-light, #eee); word-break: normal; overflow-wrap: anywhere; }
        .kpi-sugg-hold { border-left: 4px solid #ADB5BD; } .kpi-sugg-good { border-left: 4px solid #2F9E44; }
        .kpi-sugg-head { font-weight: 800; margin-bottom: 8px; }
        .kpi-sugg-item { border: 1px solid var(--border-light, #e5e5e5); border-radius: 12px; padding: 12px 14px; margin-top: 10px; }
        .kpi-sugg-item.is-top { border: 2px solid #E03131; background: #FFFAFA; }
        .kpi-sugg-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
        .kpi-sugg-table th { text-align: left; white-space: nowrap; padding: 5px 10px 5px 0; vertical-align: top; color: var(--text-secondary); width: 1%; }
        .kpi-sugg-table td { padding: 5px 0; line-height: 1.6; }
        .kpi-ul { margin: 0; padding-left: 18px; font-size: 0.85rem; line-height: 1.8; }
        .kpi-funnel { padding: 16px 20px; margin-top: 18px; }
        .kpi-cards-6 { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 12px; }
        .kpi-cards-6 .kpi-card { padding: 12px 14px; }
        .kpi-cards-6 .kpi-main { font-size: 1.7rem; }
        .kpi-gauges { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
        .kpi-gauge { background: var(--bg-secondary, #fff); border: 1px solid var(--border-light, #eee); border-radius: 14px; padding: 14px 16px; }
        .kpi-g-title { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-weight: 700; font-size: 0.9rem; }
        .kpi-g-box { position: relative; height: 130px; margin: 8px 0 6px; }
        .kpi-g-center { position: absolute; left: 0; right: 0; bottom: 4px; text-align: center; pointer-events: none; }
        .kpi-g-pct { font-size: 1.3rem; font-weight: 800; line-height: 1.1; }
        .kpi-g-cap { font-size: 0.62rem; color: var(--text-secondary); }
        .kpi-g-over { display: inline-block; margin-top: 2px; font-size: 0.68rem; font-weight: 700; color: #2B8A3E; background: #EBFBEE; border-radius: 999px; padding: 1px 8px; }
        .kpi-g-row { display: flex; justify-content: space-between; gap: 8px; font-size: 0.8rem; padding: 3px 0; border-bottom: 1px dashed var(--border-light, #eee); }
        .kpi-g-row span { color: var(--text-secondary); }
        .kpi-g-pace b { color: #495057; }
        .kpi-g-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; min-height: 150px; background: #F8F9FA; border-radius: 10px; margin-top: 8px; padding: 12px; color: var(--text-secondary); }
        .kpi-g-empty b { font-size: 1.1rem; color: #495057; }
        .kpi-fn-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 18px; align-items: start; }
        .kpi-fs { display: grid; grid-template-columns: 150px minmax(0, 1fr) 90px; align-items: center; gap: 8px 12px; padding: 8px 0; }
        .kpi-fs-label { font-weight: 700; font-size: 0.85rem; }
        .kpi-fs-label small { display: block; font-weight: 500; color: var(--text-secondary); font-size: 0.7rem; }
        .kpi-fs-track { display: flex; justify-content: center; height: 34px; background: #F8F9FA; border-radius: 6px; }
        .kpi-fs-shape { height: 100%; border-radius: 6px; min-width: 2px; }
        .kpi-fs-access { background: #A5C8FF; } .kpi-fs-start { background: #4C8DF6; } .kpi-fs-complete { background: #1864AB; } .kpi-fs-sess { background: #91A7FF; }
        .kpi-fs-num { font-size: 0.8rem; text-align: right; } .kpi-fs-num b { font-size: 1.2rem; }
        .kpi-fs-flow { grid-column: 2 / 4; font-size: 0.78rem; color: var(--text-secondary); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: center; }
        .kpi-fn-right { display: grid; gap: 10px; }
        .kpi-fr { background: #F8F9FA; border-radius: 10px; padding: 10px 12px; }
        .kpi-fr-head { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-weight: 700; font-size: 0.82rem; }
        .kpi-fr-val { font-size: 1.4rem; font-weight: 800; margin: 2px 0; }
        .kpi-fn-warn { margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: #FFF4E5; color: #C25E00; font-size: 0.8rem; line-height: 1.7; font-weight: 600; }
        .kpi-sess { margin-top: 14px; padding: 12px 14px; border: 1px dashed var(--border-light, #ddd); border-radius: 10px; }
        .kpi-sess-title { font-weight: 700; font-size: 0.82rem; margin-bottom: 6px; }
        .kpi-ss { display: grid; grid-template-columns: 150px minmax(0, 1fr) 60px 60px; align-items: center; gap: 8px; font-size: 0.78rem; padding: 3px 0; }
        .kpi-ss .kpi-fs-track { height: 16px; } .kpi-ss small { color: var(--text-secondary); text-align: right; }
        .kpi-chart-wide { grid-column: 1 / -1; }
        .kpi-judge-wrap { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 14px; align-items: start; }
        .kpi-donut-card { padding: 14px 16px; }
        .kpi-donut-title { font-weight: 700; font-size: 0.85rem; margin-bottom: 6px; }
        .kpi-donut-box { position: relative; height: 170px; }
        .kpi-donut-legend { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
        .kpi-judge-list { padding: 4px 16px; }
        .kpi-judge { display: grid; grid-template-columns: 150px 120px 120px 150px minmax(0, 1fr); gap: 10px; align-items: start; padding: 12px 0; border-bottom: 1px solid var(--border-light, #eee); font-size: 0.82rem; }
        .kpi-judge:last-child { border-bottom: none; }
        .kpi-j-name { font-weight: 700; }
        .kpi-j-val span { display: block; font-size: 0.7rem; color: var(--text-secondary); }
        .kpi-judge .kpi-cmp { margin: 0; padding: 0; border: none; }
        .kpi-judge .kpi-why { margin-top: 4px; }
        .kpi-fn { display: flex; align-items: stretch; gap: 8px; flex-wrap: wrap; }
        .kpi-fn-stage { flex: 1; min-width: 150px; background: #F8F9FA; border-radius: 12px; padding: 12px; }
        .kpi-fn-label { font-weight: 700; font-size: 0.85rem; }
        .kpi-fn-num { font-size: 1.6rem; font-weight: 800; }
        .kpi-fn-num small { font-size: 0.8rem; color: var(--text-secondary); }
        .kpi-fn-rate { font-size: 0.78rem; margin-top: 4px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .kpi-fn-arrow { display: flex; align-items: center; font-size: 1.4rem; color: var(--text-secondary); }
        .kpi-fn-bars { margin-top: 12px; display: grid; gap: 6px; }
        .kpi-fn-bars > div { display: flex; align-items: center; gap: 8px; font-size: 0.75rem; }
        .kpi-fn-bars span { width: 56px; color: var(--text-secondary); }
        .kpi-fn-bars > div > div { height: 12px; background: #4C8DF6; border-radius: 6px; }
        .kpi-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 18px; }
        .kpi-chart-box { position: relative; height: 280px; }
        .kpi-formula { padding: 14px 20px; margin-top: 18px; }
        .kpi-formula summary { cursor: pointer; font-weight: 700; }
        .kpi-empty { padding: 32px; text-align: center; color: var(--text-secondary); }
        .kpi-help { font-size: 0.78rem; color: var(--text-secondary); line-height: 1.8; background: var(--bg-tertiary, #f6f7f9); border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; }
        .kpi-set-table th, .kpi-set-table td { padding: 8px 6px; font-size: 0.8rem; vertical-align: middle; }
        .kpi-set-table input { width: 84px; padding: 6px 8px; font-size: 0.85rem; border: 1px solid var(--border-light, #ddd); border-radius: 6px; }
        .kpi-set-table td span { font-size: 0.72rem; color: var(--text-secondary); margin-left: 4px; }
        .kpi-warnbox { margin-top: 10px; color: #8A4B00; background: #FFF6E5; border: 1px solid #F2C879; border-radius: 8px; padding: 10px 12px; font-size: 0.82rem; line-height: 1.7; }
        .kpi-warnbox ul { margin: 6px 0 0; padding-left: 1.2em; }
        .kpi-err { margin-top: 10px; color: #C92A2A; background: #FFF0F0; border-radius: 8px; padding: 10px 12px; font-size: 0.82rem; line-height: 1.7; }
        @media (max-width: 900px) { .kpi-cards-6 { grid-template-columns: repeat(2, minmax(0, 1fr)); } .kpi-charts { grid-template-columns: 1fr; } .kpi-fn-grid, .kpi-judge-wrap { grid-template-columns: 1fr; } .kpi-judge { grid-template-columns: 1fr 1fr; } .kpi-j-name, .kpi-judge .kpi-cmp { grid-column: 1 / -1; } }
        @media (max-width: 600px) { .kpi-fs { grid-template-columns: 1fr 70px; } .kpi-fs-track { grid-column: 1 / -1; grid-row: 2; } .kpi-fs-flow { grid-column: 1 / -1; justify-content: flex-start; } .kpi-ss { grid-template-columns: 1fr 50px 50px; } .kpi-ss .kpi-fs-track { grid-column: 1 / -1; grid-row: 2; } .kpi-gauges { grid-template-columns: 1fr; } }
        @media (max-width: 600px) { .kpi-tab { padding: 9px 12px; font-size: 0.85rem; } .kpi-main { font-size: 1.7rem; } .kpi-fn-arrow { display: none; } .kpi-sugg-table th { white-space: normal; width: 30%; } }
            /* ↑ ここまでKPI状況と同じ */

        .sp-warn { padding: 12px 16px; margin-bottom: 12px; border-left: 4px solid #E03131; background: #FFF5F5; }
        .sp-new { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 14px; margin-bottom: 12px; border-radius: 10px; background: #E7F5FF; color: #1864AB; }
        .sp-toast { display: none; position: fixed; bottom: 20px; right: 20px; background: #212529; color: #fff; padding: 10px 16px; border-radius: 10px; z-index: 3000; font-size: 0.85rem; }
        .sp-goals { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding: 12px 18px; margin-bottom: 14px; }
        .sp-goals-title { font-weight: 800; }
        .sp-goals-items { display: flex; gap: 20px; flex-wrap: wrap; flex: 1; font-size: 0.9rem; }
        .sp-goals-items small { display: block; color: var(--text-secondary); font-size: 0.72rem; }
        .sp-scope { font-size: 0.78rem; font-weight: 600; color: var(--text-secondary); margin-left: 6px; }
        .sp-daynums { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
        .sp-daynums > div { background: #F8F9FA; border-radius: 10px; padding: 8px 14px; font-size: 0.9rem; }
        .sp-ymonths { margin-top: 8px; }
        .sp-cards { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
        .sp-card .kpi-main { font-size: 1.8rem; }
        .sp-recon { padding: 12px 16px; margin-top: 14px; border-left: 4px solid #CED4DA; }
        .sp-recon.is-ok { border-left-color: #2F9E44; } .sp-recon.is-ng { border-left-color: #E03131; }
        .sp-recon-nums { display: flex; gap: 8px 18px; flex-wrap: wrap; margin-top: 6px; font-size: 0.88rem; }
        .sp-mini-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-top: 8px; }
        .sp-mini-table th, .sp-mini-table td { border-bottom: 1px solid var(--border-light, #eee); padding: 5px 6px; text-align: left; vertical-align: top; }
        .sp-insight { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .sp-ins-card { padding: 14px 16px; }
        .sp-ins-title { font-weight: 700; font-size: 0.9rem; margin-bottom: 8px; }
        .sp-avg { display: flex; gap: 10px 20px; flex-wrap: wrap; font-size: 0.9rem; }
        .sp-avg small { color: var(--text-secondary); margin-left: 2px; }
        .sp-reasons { max-height: 260px; overflow-y: auto; }
        .sp-reason-item { padding: 8px 0; border-bottom: 1px dashed var(--border-light, #eee); }
        .sp-reason-head { display: flex; justify-content: space-between; gap: 8px; font-size: 0.8rem; color: var(--text-secondary); }
        .sp-reason-text { white-space: pre-wrap; font-size: 0.85rem; line-height: 1.6; word-break: break-word; }
        .sp-list-card { padding: 12px 14px; }
        .sp-filters { display: flex; gap: 8px 14px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; font-size: 0.85rem; }
        .sp-filters select, .sp-filters input[type=search] { width: auto; padding: 6px 10px; font-size: 0.85rem; }
        .sp-chk { display: inline-flex; align-items: center; gap: 4px; }
        .sp-chk input { width: auto; }
        .sp-count { margin-left: auto; color: var(--text-secondary); }
        .sp-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .sp-table { width: 100%; min-width: 1000px; border-collapse: collapse; font-size: 0.85rem; }
        .sp-table th { text-align: left; font-size: 0.75rem; color: var(--text-secondary); padding: 8px; border-bottom: 2px solid var(--border-light, #eee); white-space: nowrap; }
        .sp-table td { padding: 8px; border-bottom: 1px solid var(--border-light, #eee); vertical-align: top; }
        .sp-table select, .sp-table input { width: auto; max-width: 100%; padding: 5px 8px; font-size: 0.82rem; }
        .sp-nowrap { white-space: pre; }
        .sp-empty { text-align: center; color: var(--text-secondary); padding: 24px !important; }
        .sp-excluded { opacity: .5; }
        .sp-row-alert { background: #FFF5F5; }
        .sp-focus { outline: 3px solid #1C64D8; outline-offset: -3px; }
        .sp-link { background: none; border: none; padding: 0; color: #1C64D8; font-weight: 700; cursor: pointer; text-align: left; font-family: inherit; font-size: inherit; }
        .sp-link:hover { text-decoration: underline; }
        .sp-badge { display: inline-block; font-size: 0.68rem; font-weight: 700; padding: 1px 7px; border-radius: 999px; margin-left: 6px; vertical-align: middle; }
        .sp-badge-repeat { background: #F3F0FF; color: #6741D9; } .sp-badge-ex { background: #E9ECEF; color: #495057; } .sp-badge-test { background: #FFF4E5; color: #C25E00; }
        .sp-label { display: inline-block; margin-top: 4px; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
        .sp-lb-won { background: #EBFBEE; color: #2B8A3E; } .sp-lb-lost { background: #F1F3F5; color: #495057; } .sp-lb-noshow { background: #FFF0F0; color: #C92A2A; }
        .sp-lb-adj { background: #F8F9FA; color: #868E96; } .sp-lb-plan { background: #E7F5FF; color: #1864AB; } .sp-lb-miss { background: #E03131; color: #fff; }
        .sp-hint { font-size: 0.68rem; color: var(--text-secondary); margin-top: 3px; line-height: 1.4; white-space: normal; }
        .sp-meet-td { width: 210px; min-width: 210px; }
        .sp-meet-td input { width: 100% !important; }
        .sp-ex-btn { white-space: nowrap; font-size: 0.72rem !important; line-height: 1.3; padding: 4px 8px !important; }
        .sp-status { min-width: 110px; }
        .sp-mt-fixed { white-space: nowrap; }
        .sp-extra { min-width: 230px; }
        .sp-reason { width: 220px !important; height: 52px !important; min-height: 0 !important; resize: none; overflow: hidden; display: block; line-height: 1.4; font-size: 0.8rem !important; padding: 6px 8px !important; }
        .sp-full { margin-top: 4px; }
        .sp-plan { display: block; margin-bottom: 4px; }
        .sp-mini-label { display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--text-secondary); margin: 2px 0; }
        .sp-newdate { background: #F8F9FA; border-radius: 8px; padding: 8px; }
        .sp-btns { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
        .sp-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 16px; }
        .sp-overlay.sp-side { justify-content: flex-end; padding: 0; }
        .sp-dialog { background: #fff; border-radius: 14px; padding: 18px; width: min(640px, 100%); max-height: 90vh; overflow-y: auto; }
        .sp-dialog textarea { width: 100%; min-height: 220px; }
        .sp-dlg-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 12px; }
        .sp-panel { background: #fff; width: min(560px, 100%); height: 100%; overflow-y: auto; padding: 18px 20px; box-shadow: -8px 0 24px rgba(0,0,0,.15); }
        .sp-panel-title { font-size: 1.15rem; }
        .sp-sec { margin-bottom: 18px; }
        .sp-sec-title { font-weight: 800; font-size: 0.9rem; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 2px solid var(--border-light, #eee); }
        .sp-qa dt { font-size: 0.78rem; color: var(--text-secondary); margin-top: 8px; }
        .sp-qa dd { margin: 2px 0 0; white-space: pre-wrap; word-break: break-word; }
        .sp-goal-table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 0.85rem; }
        .sp-goal-table th, .sp-goal-table td { padding: 6px; text-align: left; }
        .sp-goal-table input { width: 100%; padding: 6px 8px; }
        .sp-err { color: #C92A2A; font-size: 0.85rem; min-height: 1em; }
        @media (max-width: 900px) { .sp-insight { grid-template-columns: 1fr; } }
        @media (max-width: 600px) { .sp-goals { padding: 10px 12px; flex-direction: column; align-items: flex-start; gap: 8px; } .sp-goals-items { gap: 10px 16px; } .sp-count { margin-left: 0; } .sp-goal-table th { font-size: 0.75rem; } .sp-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } .sp-card .kpi-main { font-size: 1.4rem; } }
    </style>`;
})();
