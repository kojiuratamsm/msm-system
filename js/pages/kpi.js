// js/pages/kpi.js
// KPI状況(KPI管理): 分析フォームの「アクセス数・開始数・完了数」から、日間・月間・年間のKPIを
// 目標・判定・前期間比較・着地見込み・改善提案つきで表示するページ。
//
// 【データの出どころ(既存のものをそのまま読むだけ。計測の仕組み・データは変更しない)】
//   customers テーブルの service_type='meo_form_stats' の行(analyticsform/form.js・api/booking.js が記録)
//     data.type = 'view'(アクセス) / 'start'(開始) / 'submission'(完了) / 'reach'(設問到達・KPIでは使わない)
//     data.timestamp = 記録時刻(ISO・UTC)、data.session = ブラウザのタブごとの番号(予約経由の完了には無い)
//   ・アクセス・開始は「同じタブの中では1回だけ」記録される(再読み込みでは増えない)= 人数ではなくセッション単位の回数。
//   ・Supabase は1回の読み込み件数に上限があるため、Store.getAllRows で分けて全件読み、総件数と照合する。
//     取得エラー・件数の不一致・ページングの異常があれば、不完全なデータでは表示せずエラーにする。
// 【目標・判定基準の保存先】 customers テーブルの service_type='kpi_settings' の行(1件)。data.settings に保存。
// 【日付】 すべて日本時間(UTC+9)で区切る。日=0:00〜翌0:00の直前、月=1日〜翌月1日の直前、年=1/1〜翌年1/1の直前。
(function () {
    const H9 = 9 * 3600 * 1000;
    const DAY = 24 * 3600 * 1000;
    const jp = (ms) => { const d = new Date(ms + H9); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay() }; };
    const jms = (y, m, d = 1, h = 0) => Date.UTC(y, m - 1, d, h) - H9;   // 日本時間の y/m/d h:00 を UTC ミリ秒に(繰り上がりも自動)
    const WD = ['日', '月', '火', '水', '木', '金', '土'];
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const pad = (n) => String(n).padStart(2, '0');

    const METRICS = [
        { key: 'access', label: 'アクセス数', kind: 'count', tip: 'フォームを開いた回数。同じタブで再読み込みしても数えません(別のタブ・後日は再度数えます)。人数ではなくセッション単位の回数です。' },
        { key: 'start', label: '開始数', kind: 'count', tip: '診断を開始した回数(同じタブの中で1回まで)。' },
        { key: 'complete', label: '完了数', kind: 'count', tip: '提出(完了)した回数。予約付きフォームは予約処理の完了時に記録されます。' },
        { key: 'startRate', label: '開始率', kind: 'rate', num: 'start', den: 'access', formula: '開始数 ÷ アクセス数 × 100', tip: 'アクセスのうち開始に進んだ割合。' },
        { key: 'completeRate', label: '開始後の完了率', kind: 'rate', num: 'complete', den: 'start', formula: '完了数 ÷ 開始数 × 100', tip: '開始したうち完了まで進んだ割合。' },
        { key: 'accessCompleteRate', label: 'アクセスからの完了率', kind: 'rate', num: 'complete', den: 'access', formula: '完了数 ÷ アクセス数 × 100', tip: 'アクセスのうち完了まで進んだ割合。' }
    ];
    const MK = Object.fromEntries(METRICS.map(m => [m.key, m]));
    const TYPE_LABEL = { daily: '日間', monthly: '月間', yearly: '年間' };
    const STATUS = {
        good: { icon: '🟢', label: '良好', cls: 'good', rank: 3 },
        normal: { icon: '🟡', label: '通常', cls: 'normal', rank: 1 },
        poor: { icon: '🔴', label: '要改善', cls: 'poor', rank: 0 },
        hold: { icon: '⚪', label: '判定保留', cls: 'hold', rank: 2 }
    };
    const EV_TYPE = { view: 'access', start: 'start', submission: 'complete' };

    // ---------- 数値の表示 ----------
    const fmtN = (n) => (n == null || !Number.isFinite(n)) ? '-' : Math.round(n).toLocaleString();
    const fmt1 = (n) => (n == null || !Number.isFinite(n)) ? '-' : (Math.round(n * 10) / 10).toFixed(1);
    const fmtP = (n) => (n == null || !Number.isFinite(n)) ? '算出不可' : `${fmt1(n)}%`;

    // ---------- 計算(テストしやすいように外からも呼べるようにしておく) ----------
    const Calc = {
        rate(num, den) { return (den == null || num == null || den === 0) ? null : num / den * 100; },
        achievement(actual, target) { return (target == null || !(target > 0) || actual == null) ? null : actual / target * 100; },
        diff(actual, target) { return (target == null || actual == null) ? null : actual - target; },
        metricsFromCounts(c) {
            return {
                access: c.access, start: c.start, complete: c.complete,
                startRate: Calc.rate(c.start, c.access),
                completeRate: Calc.rate(c.complete, c.start),
                accessCompleteRate: Calc.rate(c.complete, c.access)
            };
        },
        // 件数の判定。pace = 期間の経過割合(0〜1、終わった期間は1)
        judgeCount(actual, set, pace, noData) {
            const s = set || {};
            const T = num(s.target);
            if (noData) return { status: 'hold', reason: 'この期間は計測データがありません(計測開始前)。' };
            if (T == null || T <= 0) return { status: 'hold', reason: '目標未設定のため判定していません。' };
            const good = num(s.good), poor = num(s.poor), minS = num(s.minSample);
            const paceTarget = T * pace;
            const paceAch = paceTarget > 0 ? actual / paceTarget * 100 : null;
            const base = pace < 1
                ? `今の時点の目安(目標${fmtN(T)}件 × 経過${fmt1(pace * 100)}% = ${fmt1(paceTarget)}件)に対して実績${fmtN(actual)}件(${fmtP(paceAch)})`
                : `目標${fmtN(T)}件に対して実績${fmtN(actual)}件(${fmtP(paceAch)})`;
            if (good == null && poor == null) return { status: 'hold', reason: `${base}。判定基準(良好・要改善の境界)が未設定のため判定保留です。`, paceTarget, paceAch };
            if (pace < 1 && paceTarget < 1) return { status: 'hold', reason: `${base}。今の時点で見込まれる件数がまだ1件未満のため、判断するには早い(サンプル不足)として判定保留です。`, paceTarget, paceAch, sample: true };
            if (minS != null && paceTarget < minS) return { status: 'hold', reason: `${base}。今の時点の目安件数が${fmtN(minS)}件未満のため、判断するには早い(サンプル不足)として判定保留です。`, paceTarget, paceAch, sample: true };
            let status = 'normal';
            if (good != null && paceAch >= good) status = 'good';
            else if (poor != null && paceAch < poor) status = 'poor';
            const crit = [good != null ? `良好: ${fmt1(good)}%以上` : null, poor != null ? `要改善: ${fmt1(poor)}%未満` : null].filter(Boolean).join(' / ');
            return { status, reason: `${base}。基準(${crit})と比べて「${STATUS[status].label}」。${pace < 1 ? '※期間の途中なので、最終目標ではなく経過に見合った目安と比べています。' : ''}`, paceTarget, paceAch };
        },
        // 率の判定
        judgeRate(numV, denV, set, noData) {
            const s = set || {};
            if (noData) return { status: 'hold', reason: 'この期間は計測データがありません(計測開始前)。' };
            const r = Calc.rate(numV, denV);
            if (r == null) return { status: 'hold', reason: '分母が0件のため算出不可です。' };
            const good = num(s.good), poor = num(s.poor), minS = num(s.minSample);
            const base = `実績${fmtP(r)}(${fmtN(numV)} ÷ ${fmtN(denV)})`;
            if (good == null && poor == null) return { status: 'hold', reason: `${base}。判定基準(良好・要改善の境界)が未設定のため判定保留です。` };
            if (minS != null && denV < minS) return { status: 'hold', reason: `${base}。分母が${fmtN(minS)}件未満のため、率がぶれやすい(サンプル不足)として判定保留です。`, sample: true };
            let status = 'normal';
            if (good != null && r >= good) status = 'good';
            else if (poor != null && r < poor) status = 'poor';
            const crit = [good != null ? `良好: ${fmt1(good)}%以上` : null, poor != null ? `要改善: ${fmt1(poor)}%未満` : null].filter(Boolean).join(' / ');
            return { status, reason: `${base}。基準(${crit})と比べて「${STATUS[status].label}」。` };
        }
    };
    function num(v) { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
    window.KpiCalc = Calc;

    // ---------- 目標・判定基準 ----------
    function defaultSettings() {
        const one = () => Object.fromEntries(METRICS.map(m => [m.key, { target: null, good: null, poor: null, minSample: m.kind === 'rate' ? 10 : null }]));
        return { daily: one(), monthly: one(), yearly: one() };
    }
    function mergeSettings(saved) {
        const d = defaultSettings();
        if (!saved || typeof saved !== 'object') return d;
        for (const t of Object.keys(d)) for (const k of Object.keys(d[t])) {
            const v = saved[t] && saved[t][k];
            if (v && typeof v === 'object') ['target', 'good', 'poor', 'minSample'].forEach(f => { if (f in v) d[t][k][f] = num(v[f]); });
        }
        return d;
    }
    function validateSettings(st) {
        const errs = [];
        for (const t of ['daily', 'monthly', 'yearly']) for (const m of METRICS) {
            const s = st[t][m.key], where = `${TYPE_LABEL[t]}「${m.label}」`;
            for (const f of ['target', 'good', 'poor', 'minSample']) {
                if (s[f] != null && (!Number.isFinite(s[f]) || s[f] < 0)) errs.push(`${where}: 0以上の数字を入れてください。`);
            }
            if (m.kind === 'rate') {
                ['target', 'good', 'poor'].forEach(f => { if (s[f] != null && s[f] > 100) errs.push(`${where}: 率は0〜100%で入れてください。`); });
            } else {
                if ((s.good != null || s.poor != null) && !(s.target > 0)) errs.push(`${where}: 件数の判定は目標に対する達成率で行うため、先に目標値(1以上)を入れてください。`);
                if (s.target != null && !Number.isInteger(s.target)) errs.push(`${where}: 目標件数は整数で入れてください。`);
            }
            if (s.good != null && s.poor != null && s.poor > s.good) errs.push(`${where}: 「要改善の境界」は「良好の境界」以下にしてください(今: 良好${s.good} / 要改善${s.poor})。`);
            if (s.minSample != null && !Number.isInteger(s.minSample)) errs.push(`${where}: サンプル不足の件数は整数で入れてください。`);
        }
        return [...new Set(errs)];
    }
    async function loadSettings() {
        const rows = await Store.getCustomers('kpi_settings');
        const row = rows.slice().sort((a, b) => Number(a.id) - Number(b.id))[0];
        return { rowId: row ? row.id : null, settings: mergeSettings(row && row.settings), updatedAt: row && row.updatedAt, updatedBy: row && row.updatedBy };
    }
    async function saveSettings(rowId, settings, user) {
        const payload = { settings, updatedAt: new Date().toISOString(), updatedBy: user && user.email ? user.email : '' };
        if (rowId) await Store.updateCustomer('kpi_settings', rowId, payload);
        else await Store.addCustomer('kpi_settings', payload);
        const again = await loadSettings();
        if (JSON.stringify(again.settings) !== JSON.stringify(mergeSettings(settings))) throw new Error('保存した内容を確認できませんでした。通信状態を確認してください。');
        return again;
    }

    // ---------- 期間 ----------
    function buildPeriod(sel, now) {
        const t = jp(now);
        let start, end, label, type, bucket;
        if (sel.mode === 'daily') {
            let y = t.y, m = t.m, d = t.d;
            if (sel.sub === 'yesterday') { const p = jp(jms(y, m, d) - 1); y = p.y; m = p.m; d = p.d; }
            if (sel.sub === 'pick' && /^\d{4}-\d{2}-\d{2}$/.test(sel.day || '')) [y, m, d] = sel.day.split('-').map(Number);
            start = jms(y, m, d); end = jms(y, m, d + 1); type = 'daily'; bucket = 'hour';
            label = `${y}年${m}月${d}日(${WD[jp(start).wd]})`;
        } else if (sel.mode === 'monthly') {
            let y = t.y, m = t.m;
            if (sel.sub === 'last') { m -= 1; if (m < 1) { m = 12; y -= 1; } }
            if (sel.sub === 'pick' && /^\d{4}-\d{2}$/.test(sel.month || '')) [y, m] = sel.month.split('-').map(Number);
            start = jms(y, m, 1); end = jms(y, m + 1, 1); type = 'monthly'; bucket = 'day';
            label = `${y}年${m}月`;
        } else if (sel.mode === 'yearly') {
            const y = sel.sub === 'last' ? t.y - 1 : t.y;
            start = jms(y, 1, 1); end = jms(y + 1, 1, 1); type = 'yearly'; bucket = 'month';
            label = `${y}年`;
        } else {
            // その他の期間(直近7日・直近30日・任意)。目標件数は「日間目標 × 日数」、率の基準は月間の設定を使う
            if (sel.sub === 'range' && /^\d{4}-\d{2}-\d{2}$/.test(sel.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(sel.to || '')) {
                const [y1, m1, d1] = sel.from.split('-').map(Number), [y2, m2, d2] = sel.to.split('-').map(Number);
                start = jms(y1, m1, d1); end = jms(y2, m2, d2 + 1);
                if (end <= start) end = start + DAY;
                label = `${y1}/${m1}/${d1}〜${y2}/${m2}/${d2}`;
            } else {
                const n = sel.sub === 'last30' ? 30 : 7;
                end = jms(t.y, t.m, t.d + 1); start = end - n * DAY;
                label = `直近${n}日間(${jp(start).m}/${jp(start).d}〜${t.m}/${t.d})`;
            }
            type = 'custom';
            bucket = (end - start) / DAY > 62 ? 'month' : 'day';
        }
        const days = Math.round((end - start) / DAY);
        return { start, end, label, type, bucket, days };
    }
    function prevPeriod(p) {
        if (p.type === 'daily') return { start: p.start - DAY, end: p.start };
        if (p.type === 'monthly') { const a = jp(p.start); return { start: jms(a.y, a.m - 1, 1), end: p.start }; }
        if (p.type === 'yearly') { const a = jp(p.start); return { start: jms(a.y - 1, 1, 1), end: p.start }; }
        return { start: p.start - (p.end - p.start), end: p.start };
    }
    const PREV_LABEL = { daily: '前日', monthly: '前月', yearly: '前年', custom: '前の同じ日数' };

    function buckets(p) {
        const list = [];
        if (p.bucket === 'hour') for (let h = 0; h < 24; h++) list.push({ start: p.start + h * 3600e3, end: p.start + (h + 1) * 3600e3, label: `${h}時` });
        else if (p.bucket === 'day') for (let s = p.start; s < p.end; s += DAY) { const a = jp(s); list.push({ start: s, end: s + DAY, label: `${a.m}/${a.d}` }); }
        else { let a = jp(p.start); let s = p.start; while (s < p.end) { const e = Math.min(jms(a.y, a.m + 1, 1), p.end); list.push({ start: s, end: e, label: `${a.m}月` }); s = e; a = jp(s); } }
        return list;
    }

    // ---------- 集計 ----------
    function countIn(events, a, b) {
        const c = { access: 0, start: 0, complete: 0 };
        for (const e of events) if (e.t >= a && e.t < b) c[e.k]++;
        return c;
    }
    // データの有無: 計測開始(最初の記録)より前は「データなし」。未来は「未到来」
    function coverage(firstT, a, b, now) {
        const effEnd = Math.min(b, now);
        if (a >= now) return 'future';
        if (firstT == null || firstT >= effEnd) return 'none';
        if (firstT > a) return 'partial';
        return 'full';
    }

    // ---------- ページ ----------
    const UI = window.KpiUiState = window.KpiUiState || { mode: 'daily', sub: 'today', day: '', month: '', from: '', to: '' };
    let charts = [];

    App.Pages.kpi = async function () {
        const user = Auth.getCurrentUser();
        const isAdmin = !!(user && user.role === 'admin');
        let events, settingsInfo, loadInfo;
        try {
            const [res, si] = await Promise.all([Store.getAllRows('meo_form_stats'), loadSettings()]);
            settingsInfo = si;
            events = [];
            let badTime = 0, otherType = 0;
            for (const r of res.rows) {
                const k = EV_TYPE[r.type];
                if (!k) { otherType++; continue; }                  // 設問到達(reach)など、KPIの対象外の種類
                const t = typeof r.timestamp === 'string' ? Date.parse(r.timestamp) : NaN;
                if (!Number.isFinite(t)) { badTime++; continue; }    // 時刻がない・読めない記録は集計しない
                events.push({ t, k, s: r.session || null });
            }
            events.sort((a, b) => a.t - b.t);
            loadInfo = { loaded: res.rows.length, total: res.total, pages: res.pages, used: events.length, badTime, otherType };
        } catch (e) {
            console.error(e);
            App.mount(`<div class="card kpi-load-error" style="padding:32px; border-left:4px solid #E03131;"><h3 style="margin-bottom:8px;">KPIデータを読み込めませんでした</h3>
                <p style="line-height:1.8;">${esc(e.message || '')}</p>
                <p style="color:var(--text-secondary); font-size:0.85rem; line-height:1.8;">記録の一部しか読み込めていない可能性があるため、不正確な数字を出さないよう、KPIは表示していません。時間をおいてもう一度読み込んでください。</p>
                <button class="btn-primary" style="margin-top:16px;" onclick="App.navigate('kpi')">もう一度読み込む</button></div>`);
            return;
        }
        const firstT = events.length ? events[0].t : null;

        App.mount(`<div id="kpi-root"></div>${STYLE}`, () => {
            window.kpiSet = (patch) => { Object.assign(UI, patch); render(); };
            window.kpiOpenSettings = () => openSettings();
            render();
        });

        function render() {
            charts.forEach(c => { try { c.destroy(); } catch (e) { /* */ } });
            charts = [];
            const now = Date.now();
            const p = buildPeriod(UI, now);
            const root = document.getElementById('kpi-root');
            if (!root) return;
            if (p.start >= now) { root.innerHTML = header(p) + `<div class="card kpi-empty">選んだ期間はまだ始まっていません。</div>`; return; }

            const st = settingsInfo.settings;
            const setType = p.type === 'custom' ? null : p.type;
            const setsFor = (key) => {
                if (setType) return st[setType][key];
                // その他の期間: 件数 = 日間目標 × 日数(良好・要改善の境界は日間の設定)、率 = 月間の設定
                if (MK[key].kind === 'count') { const d = st.daily[key]; return { ...d, target: d.target != null ? d.target * p.days : null }; }
                return st.monthly[key];
            };
            const inProgress = now < p.end;
            const effEnd = Math.min(p.end, now);
            const pace = inProgress ? (effEnd - p.start) / (p.end - p.start) : 1;
            const cov = coverage(firstT, p.start, p.end, now);
            const noData = cov === 'none';
            const cur = countIn(events, p.start, effEnd);
            const curM = Calc.metricsFromCounts(cur);

            // 比較: 期間の途中なら前期間の「同じ経過分」と比べる(途中経過と確定値を混同しない)
            const pp = prevPeriod(p);
            const ppEnd = inProgress ? Math.min(pp.start + (effEnd - p.start), pp.end) : pp.end;
            const prevCov = coverage(firstT, pp.start, ppEnd, now);
            const prevC = countIn(events, pp.start, ppEnd);
            const prevM = Calc.metricsFromCounts(prevC);
            const prevFullC = countIn(events, pp.start, pp.end);
            let wkC = null, wkCov = null;
            if (p.type === 'daily') {
                wkCov = coverage(firstT, p.start - 7 * DAY, effEnd - 7 * DAY, now);
                wkC = Calc.metricsFromCounts(countIn(events, p.start - 7 * DAY, effEnd - 7 * DAY));
            }

            // 判定
            const results = {};
            for (const m of METRICS) {
                const set = setsFor(m.key);
                const j = m.kind === 'count'
                    ? Calc.judgeCount(cur[m.key], set, pace, noData)
                    : Calc.judgeRate(cur[MK[m.key].num], cur[MK[m.key].den], set, noData);
                results[m.key] = { m, set, j, value: curM[m.key] };
            }

            // 画面の並び: 1.期間切り替え 2.数値カード 3.ゲージ 4.ファネル 5.棒グラフ(推移・比較)と率の推移 6.判定・比較 7.改善提案 8.計算式
            const sugg = suggestionsHtml(p, results, cur, inProgress);
            root.innerHTML = header(p)
                + statusLine(p, inProgress, effEnd, cov, now)
                + overviewHtml(results, sugg.top)
                + `<div class="kpi-cards kpi-cards-6">${METRICS.map(m => cardHtml(results[m.key], cur)).join('')}</div>`
                + gaugesHtml(results, inProgress, pace)
                + funnelHtml(p, results, cur, effEnd)
                + chartsHtml(p, inProgress, prevCov)
                + judgeHtml(results, p, inProgress, cur, prevM, prevCov, wkC, wkCov, prevFullC)
                + sugg.html
                + formulaHtml(cur, curM, p)
                + criteriaHtml(isAdmin);
            drawCharts(p, now, setsFor, results, inProgress, pace, cur, prevC, prevCov);
        }

        function header(p) {
            const tabs = ['daily', 'monthly', 'yearly'].map(t => `<button type="button" class="kpi-tab ${UI.mode === t ? 'is-on' : ''}" onclick="kpiSet({ mode: '${t}', sub: '${t === 'daily' ? 'today' : t === 'monthly' ? 'this' : 'this'}' })">${TYPE_LABEL[t]}KPI</button>`).join('');
            let sub = '';
            if (UI.mode === 'daily') sub = `
                <select onchange="kpiSet({ sub: this.value })"><option value="today" ${UI.sub === 'today' ? 'selected' : ''}>今日</option><option value="yesterday" ${UI.sub === 'yesterday' ? 'selected' : ''}>昨日</option><option value="pick" ${UI.sub === 'pick' ? 'selected' : ''}>日付を選ぶ</option></select>
                ${UI.sub === 'pick' ? `<input type="date" value="${esc(UI.day)}" onchange="kpiSet({ day: this.value })">` : ''}`;
            else if (UI.mode === 'monthly') sub = `
                <select onchange="kpiSet({ sub: this.value })"><option value="this" ${UI.sub === 'this' ? 'selected' : ''}>今月</option><option value="last" ${UI.sub === 'last' ? 'selected' : ''}>先月</option><option value="pick" ${UI.sub === 'pick' ? 'selected' : ''}>月を選ぶ</option></select>
                ${UI.sub === 'pick' ? `<input type="month" value="${esc(UI.month)}" onchange="kpiSet({ month: this.value })">` : ''}`;
            else if (UI.mode === 'yearly') sub = `
                <select onchange="kpiSet({ sub: this.value })"><option value="this" ${UI.sub === 'this' ? 'selected' : ''}>今年</option><option value="last" ${UI.sub === 'last' ? 'selected' : ''}>昨年</option></select>`;
            else sub = `
                ${UI.sub === 'range' ? `<input type="date" value="${esc(UI.from)}" onchange="kpiSet({ from: this.value })"><span>〜</span><input type="date" value="${esc(UI.to)}" onchange="kpiSet({ to: this.value })">` : ''}`;
            return `
            <div class="card kpi-head">
                <div class="kpi-head-row">
                    <div class="kpi-tabs" role="tablist">${tabs}</div>
                    <div class="kpi-other">
                        <select onchange="if (this.value) kpiSet({ mode: 'custom', sub: this.value })" title="日間・月間・年間以外の期間">
                            <option value="">その他の期間…</option>
                            <option value="last7" ${UI.mode === 'custom' && UI.sub === 'last7' ? 'selected' : ''}>直近7日間</option>
                            <option value="last30" ${UI.mode === 'custom' && UI.sub === 'last30' ? 'selected' : ''}>直近30日間</option>
                            <option value="range" ${UI.mode === 'custom' && UI.sub === 'range' ? 'selected' : ''}>任意の期間</option>
                        </select>
                        <button type="button" class="btn-secondary btn-sm" onclick="kpiOpenSettings()"><i class="ph ph-sliders-horizontal"></i> 目標・判定基準</button>
                    </div>
                </div>
                <div class="kpi-head-row" style="margin-top:12px;">
                    <div class="kpi-period"><b>${esc(p.label)}</b> ${sub}</div>
                </div>
            </div>`;
        }

        // ひと目で分かる判定のまとめ(良い・悪い・最優先)
        function overviewHtml(results, top) {
            const cnt = (k) => METRICS.filter(m => results[m.key].j.status === k).length;
            return `<div class="card kpi-overview">
                <div class="kpi-ov-chips">${['poor', 'normal', 'good', 'hold'].map(k => `<span class="kpi-chip kpi-chip-${STATUS[k].cls}">${STATUS[k].icon} ${STATUS[k].label} ${cnt(k)}</span>`).join('')}</div>
                <div class="kpi-ov-top">${top ? `最優先で改善: <b>${STATUS[top.j.status].icon} ${top.m.label}</b>(${STATUS[top.j.status].label})<a href="#kpi-sugg" class="kpi-ov-link">改善提案を見る ↓</a>` : cnt('good') && !cnt('poor') && !cnt('normal') ? '判定できた指標はすべて良好です' : '目標・判定基準を設定すると、良し悪しと最優先の改善項目が表示されます'}</div>
            </div>`;
        }

        function statusLine(p, inProgress, effEnd, cov, now) {
            const e = jp(effEnd - 1);
            const parts = [];
            if (inProgress) {
                const pct = (effEnd - p.start) / (p.end - p.start) * 100;
                parts.push(`<span class="kpi-badge kpi-badge-run">途中経過</span> ${p.type === 'daily' ? `0:00〜${jp(now).h}:${pad(jp(now).mi)}まで` : `${e.m}/${e.d}まで`}の実績 ・ 期間の経過 <b>${fmt1(pct)}%</b>(参考進捗率)`);
            } else parts.push(`<span class="kpi-badge kpi-badge-fix">確定</span> 期間が終わった確定値です`);
            if (cov === 'none') parts.push(`<span class="kpi-warn">この期間は計測データがありません(計測の記録は ${firstT ? fmtDate(firstT) : 'まだありません'} から)</span>`);
            else if (cov === 'partial') parts.push(`<span class="kpi-warn">計測の記録が ${fmtDate(firstT)} からのため、期間の途中からの集計です</span>`);
            if (p.type === 'custom') parts.push(`<span class="kpi-note">この期間の目標件数は「日間目標 × ${p.days}日」、率の判定は月間の基準を使っています</span>`);
            parts.push(`<span class="kpi-loadinfo" title="分析フォームの計測記録(meo_form_stats)を全件読み込み、総件数と照合しています">データの読み込み: 記録 <b>${loadInfo.loaded.toLocaleString()}件</b> / 総数 ${loadInfo.total.toLocaleString()}件(一致・問い合わせ${loadInfo.pages}回) ・ 集計に使用 ${loadInfo.used.toLocaleString()}件 ・ 集計対象外: 時刻が不正 ${loadInfo.badTime.toLocaleString()}件、KPI対象外の種類(設問到達など) ${loadInfo.otherType.toLocaleString()}件</span>`);
            return `<div class="kpi-status">${parts.join('<br>')}</div>`;
        }

        function compareText(m, cur, prev, cov, label) {
            if (cov === 'none' || cov === 'future') return `<span class="kpi-cmp-na">${label}: 比較データなし</span>`;
            const note = cov === 'partial' ? '(比較先は一部期間のみ計測)' : '';
            if (m.kind === 'count') {
                const a = cur, b = prev;
                const d = a - b;
                const pct = b > 0 ? `${d >= 0 ? '+' : ''}${fmt1(d / b * 100)}%` : '前期間0件のため率は算出不可';
                return `<span class="${d > 0 ? 'kpi-up' : d < 0 ? 'kpi-down' : ''}">${label}: ${fmtN(b)} → ${fmtN(a)}(${d >= 0 ? '+' : ''}${fmtN(d)}件・${pct})${note}</span>`;
            }
            if (cur == null || prev == null) return `<span class="kpi-cmp-na">${label}: ${prev == null ? '比較先が算出不可' : '算出不可'}</span>`;
            const d = cur - prev;
            return `<span class="${d > 0 ? 'kpi-up' : d < 0 ? 'kpi-down' : ''}">${label}: ${fmtP(prev)} → ${fmtP(cur)}(${d >= 0 ? '+' : ''}${fmt1(d)}pt)${note}</span>`;
        }

        // ---------- 2. 主要KPIの数値カード(実績と判定だけをひと目で) ----------
        function cardHtml(r, cur) {
            const { m, set, j, value } = r;
            const T = num(set && set.target);
            const st = STATUS[j.status];
            let main, sub = '';
            if (m.kind === 'count') main = `${fmtN(value)}<small>件</small>`;
            else {
                const nm = MK[m.key];
                main = value == null ? '<span class="kpi-na">算出不可</span>' : `${fmt1(value)}<small>%</small>`;
                sub = `${fmtN(cur[nm.num])} ÷ ${fmtN(cur[nm.den])}`;
            }
            const target = m.kind === 'count' ? (T > 0 ? `${fmtN(T)}件` : null) : (T != null ? `${fmt1(T)}%` : null);
            return `
            <div class="kpi-card kpi-st-${st.cls}" data-metric="${m.key}" data-status="${j.status}">
                <div class="kpi-card-head">
                    <span class="kpi-card-title">${m.label} <i class="ph ph-question kpi-tip" title="${esc(m.tip + (m.formula ? ' 計算式: ' + m.formula : ''))}"></i></span>
                    <span class="kpi-chip kpi-chip-${st.cls}">${st.icon} ${st.label}</span>
                </div>
                <div class="kpi-main">${main}</div>
                <div class="kpi-mini">${sub ? `${sub} ・ ` : ''}目標 ${target ? `<b>${target}</b>` : '<span class="kpi-unset">目標未設定</span>'}</div>
            </div>`;
        }

        // ---------- 3. 目標達成度のゲージ(半円) ----------
        // 外側の太い弧 = 最終目標に対する達成率(0〜100%。100%超は満タンにして、実際の%は数字で表示)
        // 内側の細い弧 = 期間の経過(参考進捗率。件数の途中経過のときだけ)
        function gaugeList(results) {
            const list = ['access', 'start', 'complete'].map(k => results[k]);
            ['startRate', 'completeRate', 'accessCompleteRate'].forEach(k => { if (num(results[k].set && results[k].set.target) != null) list.push(results[k]); });
            return list;
        }
        function gaugesHtml(results, inProgress, pace) {
            const list = gaugeList(results);
            const rateUnset = ['startRate', 'completeRate', 'accessCompleteRate'].filter(k => num(results[k].set && results[k].set.target) == null).map(k => MK[k].label);
            // 着地見込み(件数・期間の途中だけ)。目標の有無にかかわらず、最終目標の達成率とは別の情報として出す
            const forecastHtml = (m, value, T) => {
                if (m.kind !== 'count' || !inProgress || !(pace > 0)) return '';
                const proj = value / pace, low = pace < 0.2 || value < 10;
                return `<div class="kpi-forecast" data-forecast="${m.key}"><b>着地見込み ${fmtN(proj)}件</b>${T > 0 ? `(目標比 ${fmtP(proj / T * 100)})` : ''}${low ? ' <span class="kpi-lowacc">予測精度が低い</span>' : ''}
                    <div class="kpi-mini">今までの実績 ${fmtN(value)}件 ÷ 経過割合 ${fmt1(pace * 100)}%。今までと同じペースが期間の最後まで続いた場合の目安です${low ? '(経過が短い・件数が少ないため、ぶれやすい)' : ''}。</div></div>`;
            };
            const one = (r) => {
                const { m, set, j, value } = r;
                const T = num(set && set.target);
                const st = STATUS[j.status];
                const head = `<div class="kpi-g-title">${m.label}<span class="kpi-chip kpi-chip-${st.cls}">${st.icon} ${st.label}</span></div>`;
                if (m.kind === 'count' ? !(T > 0) : T == null) {
                    return `<div class="kpi-gauge is-empty" data-metric="${m.key}" data-gauge="none">${head}
                        <div class="kpi-g-empty"><b>目標未設定</b><div class="kpi-mini">実績 ${m.kind === 'count' ? fmtN(value) + '件' : fmtP(value)}。「目標・判定基準」で目標を入れるとゲージを表示します。</div></div>${forecastHtml(m, value, null)}</div>`;
                }
                if (value == null) {
                    return `<div class="kpi-gauge is-empty" data-metric="${m.key}" data-gauge="na">${head}
                        <div class="kpi-g-empty"><b>算出不可</b><div class="kpi-mini">分母(${MK[MK[m.key].den].label})が0件のため、率と達成率を計算できません。</div></div></div>`;
                }
                const a = Calc.achievement(value, T);
                const over = a != null && a > 100;
                const unit = m.kind === 'count' ? '件' : '%';
                const valTxt = m.kind === 'count' ? `${fmtN(value)}件` : fmtP(value);
                const tgtTxt = m.kind === 'count' ? `${fmtN(T)}件` : `${fmt1(T)}%`;
                const d = value - T;
                const gapTxt = m.kind === 'count'
                    ? (d >= 0 ? `<b class="kpi-up">+${fmtN(d)}件(超過)</b>` : `<b class="kpi-down">${fmtN(d)}件(あと${fmtN(-d)}件)</b>`)
                    : `<b class="${d >= 0 ? 'kpi-up' : 'kpi-down'}">${d >= 0 ? '+' : ''}${fmt1(d)}pt</b>`;
                let paceRow = '';
                if (m.kind === 'count' && inProgress) {
                    paceRow = `<div class="kpi-g-row kpi-g-pace"><span>参考: 期間の経過</span><b>${fmt1(pace * 100)}%</b></div>
                        <div class="kpi-g-row"><span>今の時点の目安</span><b>${fmt1(j.paceTarget != null ? j.paceTarget : T * pace)}件(達成 ${fmtP(j.paceAch != null ? j.paceAch : Calc.achievement(value, T * pace))})</b></div>`;
                }
                const forecastRow = forecastHtml(m, value, T);
                return `<div class="kpi-gauge" data-metric="${m.key}" data-gauge="on" data-ach="${a == null ? '' : a}">
                    ${head}
                    <div class="kpi-g-box"><canvas id="kpi-gauge-${m.key}"></canvas>
                        <div class="kpi-g-center"><div class="kpi-g-pct">${fmtP(a)}</div><div class="kpi-g-cap">最終目標に対する達成率</div>${over ? '<div class="kpi-g-over">100%超過</div>' : ''}</div>
                    </div>
                    <div class="kpi-g-row"><span>実績</span><b>${valTxt}</b></div>
                    <div class="kpi-g-row"><span>目標</span><b>${tgtTxt}</b></div>
                    <div class="kpi-g-row"><span>目標との差</span>${gapTxt}</div>
                    ${paceRow}${forecastRow}
                </div>`;
            };
            return `<div class="kpi-sec-title">目標達成度</div>
                <div class="kpi-gauges">${list.map(one).join('')}</div>
                <div class="kpi-note">外側の太い弧は<b>最終目標に対する達成率</b>(100%を超えても弧は満タンまで。実際の%は中央の数字)。${inProgress ? '内側の細い弧は<b>期間の経過(参考進捗率)</b>で、太い弧がこれより先なら経過に対して順調です。着地見込みは「今までのペースが続いた場合」の別の目安です。' : 'この期間は終わっているため確定値です。'}${rateUnset.length ? ` 目標が未設定の率(${rateUnset.join('、')})のゲージは表示していません。` : ''}</div>`;
        }

        // ---------- 4. ファネル(アクセス → 開始 → 完了) ----------
        function funnelHtml(p, results, cur, effEnd) {
            const max = Math.max(cur.access, cur.start, cur.complete);
            const width = (n) => (max > 0 ? n / max * 100 : 0);   // 幅は件数に比例(見た目で意味を変えない)
            const stages = [
                { key: 'access', label: 'フォームアクセス', ev: 'view', n: cur.access },
                { key: 'start', label: '診断開始', ev: 'start', n: cur.start, rateKey: 'startRate' },
                { key: 'complete', label: '診断完了', ev: 'submission', n: cur.complete, rateKey: 'completeRate' }
            ];
            const warns = [];
            if (cur.start > cur.access) warns.push(`開始数(${fmtN(cur.start)}件)がアクセス数(${fmtN(cur.access)}件)より多くなっています。`);
            if (cur.complete > cur.start) warns.push(`完了数(${fmtN(cur.complete)}件)が開始数(${fmtN(cur.start)}件)より多くなっています。`);
            const stageHtml = (s, i) => {
                const prev = i ? stages[i - 1] : null;
                let flow = '';
                if (prev) {
                    const rate = Calc.rate(s.n, prev.n);
                    const diff = prev.n - s.n;
                    const st = STATUS[results[s.rateKey].j.status];
                    flow = `<div class="kpi-fs-flow">前段階から <b>${fmtP(rate)}</b> ・ ${diff >= 0 ? `${fmtN(diff)}件減少` : `<span class="kpi-down">${fmtN(-diff)}件増加(前段階より多い)</span>`} <span class="kpi-chip kpi-chip-${st.cls}">${st.icon} ${st.label}</span></div>`;
                }
                const w = width(s.n);
                return `<div class="kpi-fs" data-stage="${s.key}">
                    <div class="kpi-fs-label">${i + 1}. ${s.label}<small>(${s.ev})</small></div>
                    <div class="kpi-fs-track"><div class="kpi-fs-shape kpi-fs-${s.key}" style="width:${w}%"></div></div>
                    <div class="kpi-fs-num"><b>${fmtN(s.n)}</b>件</div>
                    ${flow}
                </div>`;
            };
            const rates = ['startRate', 'completeRate', 'accessCompleteRate'].map(k => {
                const r = results[k], st = STATUS[r.j.status];
                return `<div class="kpi-fr" data-rate="${k}"><div class="kpi-fr-head">${MK[k].label}<span class="kpi-chip kpi-chip-${st.cls}">${st.icon} ${st.label}</span></div>
                    <div class="kpi-fr-val">${r.value == null ? '<span class="kpi-na">算出不可</span>' : fmtP(r.value)}</div>
                    <div class="kpi-mini">${MK[k].formula.replace('開始数', 'start').replace('アクセス数', 'view').replace('完了数', 'submission')} = ${fmtN(cur[MK[k].num])} ÷ ${fmtN(cur[MK[k].den])}</div></div>`;
            }).join('');
            // セッション(タブ)で紐づけた流れ: セッション番号があり、同じ期間に view → start → submission と確実につながる分だけ
            const inP = events.filter(e => e.t >= p.start && e.t < effEnd);
            const viewS = new Set(inP.filter(e => e.k === 'access' && e.s).map(e => e.s));
            const startS = new Set(inP.filter(e => e.k === 'start' && e.s && viewS.has(e.s)).map(e => e.s));
            const doneS = new Set(inP.filter(e => e.k === 'complete' && e.s && startS.has(e.s)).map(e => e.s));
            const noSessComplete = inP.filter(e => e.k === 'complete' && !e.s).length;
            const noSessOther = inP.filter(e => e.k !== 'complete' && !e.s).length;
            const smax = Math.max(viewS.size, 1);
            const sRow = (label, n, base) => `<div class="kpi-ss"><span>${label}</span><div class="kpi-fs-track"><div class="kpi-fs-shape kpi-fs-sess" style="width:${n / smax * 100}%"></div></div><b>${fmtN(n)}</b>${base != null ? `<small>${fmtP(Calc.rate(n, base))}</small>` : '<small></small>'}</div>`;
            return `
            <div class="card kpi-funnel">
                <div class="kpi-sec-title" style="margin-top:0;">フォームの段階別の状況(ファネル)</div>
                <div class="kpi-fn-grid">
                    <div class="kpi-fn-left">${stages.map(stageHtml).join('')}</div>
                    <div class="kpi-fn-right">${rates}</div>
                </div>
                ${warns.length ? `<div class="kpi-fn-warn">⚠ データの注意: ${warns.join(' ')}予約経由の完了や、前の期間に開始して今回完了した回答などが考えられます。件数は補正せず、そのまま表示しています。</div>` : ''}
                <div class="kpi-note">※ファネルの幅は件数に比例しています。数字は<b>期間内のイベント件数を並べた比較</b>で、同じ人の行動を追ったものではありません(率はこの期間の合計件数から計算。日別の率の平均ではありません)。</div>
                <div class="kpi-sess" data-sess-view="${viewS.size}" data-sess-start="${startS.size}" data-sess-done="${doneS.size}" data-nosess-complete="${noSessComplete}">
                    <div class="kpi-sess-title">セッション単位の流れ(参考: 同じタブのセッション番号で確実に紐づけできた分のみ)</div>
                    ${sRow('アクセスしたセッション', viewS.size, null)}
                    ${sRow('→ そのうち開始', startS.size, viewS.size)}
                    ${sRow('→ そのうち完了', doneS.size, startS.size)}
                    <div class="kpi-mini">予約経由の完了 ${fmtN(noSessComplete)}件はセッション番号が記録されないため、ここには含めていません${noSessOther ? `(セッション番号のない古いアクセス・開始の記録 ${fmtN(noSessOther)}件も対象外)` : ''}。そのため件数のファネルより少なくなります。</div>
                </div>
            </div>`;
        }

        // ---------- 5. 件数の推移・前期間との比較(棒グラフ)と率の推移 ----------
        function chartsHtml(p, inProgress, prevCov) {
            const barTitle = p.bucket === 'hour' ? '時間帯別の推移(日本時間)' : p.bucket === 'day' ? '日別の推移' : '月別の推移';
            const lineTitle = p.type === 'daily' ? '率の推移(この日までの直近14日・日別)' : `率の推移(${p.bucket === 'day' ? '日別' : '月別'})`;
            const cmpLabel = `${PREV_LABEL[p.type]}${inProgress ? '(同じ経過分)' : ''}との件数比較`;
            const noCmp = prevCov === 'none' || prevCov === 'future';
            return `
            <div class="kpi-charts">
                <div class="card"><div class="kpi-sec-title" style="margin-top:0;">${barTitle}: アクセス・開始・完了</div><div class="kpi-chart-box"><canvas id="kpi-bar"></canvas></div><div class="kpi-note">計測開始前は「データなし」、これからの時間・日は「未到来」として棒を出していません(0件とは区別しています)。</div></div>
                <div class="card"><div class="kpi-sec-title" style="margin-top:0;">${cmpLabel}</div>
                    ${noCmp ? `<div class="kpi-g-empty kpi-cmp-none" style="height:260px;"><b>比較データなし</b><div class="kpi-mini">比較する${PREV_LABEL[p.type]}は計測開始前のため、比較のグラフは表示していません。</div></div>`
                        : `<div class="kpi-chart-box"><canvas id="kpi-cmpbar"></canvas></div><div class="kpi-note">${prevCov === 'partial' ? '※比較先の期間は途中からしか計測していません。' : ''}${inProgress ? '期間の途中なので、前の期間も同じ経過分(同じ日数・時刻まで)で比べています。' : ''}</div>`}
                </div>
                <div class="card kpi-chart-wide"><div class="kpi-sec-title" style="margin-top:0;">${lineTitle}</div><div class="kpi-chart-box"><canvas id="kpi-line"></canvas></div><div class="kpi-note">分母が0件の日は「算出不可」として線を切っています(0%にはしていません)。点線は目標率です(設定がある場合)。</div></div>
            </div>`;
        }

        // ---------- 6. 判定・前期間との比較(一覧)と判定の内訳(ドーナツ) ----------
        function judgeHtml(results, p, inProgress, cur, prevM, prevCov, wkM, wkCov, prevFullC) {
            const cnt = (k) => METRICS.filter(m => results[m.key].j.status === k).length;
            const rows = METRICS.map(m => {
                const r = results[m.key], st = STATUS[r.j.status];
                const T = num(r.set && r.set.target);
                const v = m.kind === 'count' ? `${fmtN(r.value)}件` : fmtP(r.value);
                const t = m.kind === 'count' ? (T > 0 ? `${fmtN(T)}件` : '目標未設定') : (T != null ? `${fmt1(T)}%` : '目標未設定');
                const prevLabel = `${PREV_LABEL[p.type]}${inProgress ? '(同じ経過分)' : ''}`;
                const cmp = [compareText(m, r.value, prevM[m.key], prevCov, prevLabel)];
                if (wkM) cmp.push(compareText(m, r.value, wkM[m.key], wkCov, `先週の同じ曜日${inProgress ? '(同時刻まで)' : ''}`));
                if (inProgress && m.kind === 'count' && prevCov !== 'none' && prevCov !== 'future') cmp.push(`<span class="kpi-cmp-na">${PREV_LABEL[p.type]}の確定値: ${fmtN(prevFullC[m.key])}件</span>`);
                return `<div class="kpi-judge" data-metric="${m.key}" data-status="${r.j.status}">
                    <div class="kpi-j-name">${m.label}</div>
                    <div class="kpi-j-val"><span>実績</span><b>${v}</b></div>
                    <div class="kpi-j-val"><span>目標</span><b class="${t === '目標未設定' ? 'kpi-unset' : ''}">${t}</b></div>
                    <div class="kpi-j-st"><span class="kpi-chip kpi-chip-${st.cls}">${st.icon} ${st.label}</span><details class="kpi-why"><summary>判定の理由</summary><div>${esc(r.j.reason)}</div></details></div>
                    <div class="kpi-cmp">${cmp.join('<br>')}</div>
                </div>`;
            }).join('');
            const judgedAny = METRICS.some(m => results[m.key].j.status !== 'hold');
            return `<div class="kpi-sec-title">判定と前の期間との比較</div>
                <div class="kpi-judge-wrap">
                    <div class="card kpi-donut-card"><div class="kpi-donut-title">6つの指標の判定の内訳</div>
                        ${judgedAny ? '<div class="kpi-donut-box"><canvas id="kpi-donut"></canvas></div>' : '<div class="kpi-g-empty" style="height:150px;"><b>すべて判定保留</b><div class="kpi-mini">目標・判定基準が未設定、またはデータ不足のため。</div></div>'}
                        <div class="kpi-donut-legend">${['good', 'normal', 'poor', 'hold'].map(k => `<span class="kpi-chip kpi-chip-${STATUS[k].cls}">${STATUS[k].icon} ${STATUS[k].label} ${cnt(k)}</span>`).join('')}</div>
                    </div>
                    <div class="card kpi-judge-list">${rows}</div>
                </div>`;
        }

        function drawCharts(p, now, setsFor, results, inProgress, pace, cur, prevC, prevCov) {
            if (typeof Chart === 'undefined') return;
            const COL = { good: '#2F9E44', normal: '#F59F00', poor: '#E03131', hold: '#ADB5BD' };
            // ゲージ
            gaugeList(results).forEach(r => {
                const el = document.getElementById(`kpi-gauge-${r.m.key}`);
                if (!el) return;
                const T = num(r.set && r.set.target);
                const a = Calc.achievement(r.value, T);
                const fill = Math.max(0, Math.min(100, a || 0));
                const datasets = [{ data: [fill, 100 - fill], backgroundColor: [COL[r.j.status], '#E9ECEF'], borderWidth: 0 }];
                if (r.m.kind === 'count' && inProgress) {
                    const pp = Math.max(0, Math.min(100, pace * 100));
                    datasets.push({ data: [pp, 100 - pp], backgroundColor: ['#495057', 'rgba(0,0,0,0)'], borderWidth: 0, weight: 0.28 });
                }
                charts.push(new Chart(el, {
                    type: 'doughnut',
                    data: { labels: ['達成', '未達'], datasets },
                    options: { rotation: -90, circumference: 180, cutout: '72%', responsive: true, maintainAspectRatio: false, events: [], plugins: { legend: { display: false }, tooltip: { enabled: false } } }
                }));
            });
            // 件数の推移
            const bk = buckets(p);
            const series = (list) => list.map(b => {
                const c = coverage(firstT, b.start, b.end, now);
                return { c, n: (c === 'none' || c === 'future') ? null : countIn(events, b.start, Math.min(b.end, now)) };
            });
            const rows = series(bk);
            const ds = (key, label, color) => ({ label, data: rows.map(r => r.n ? r.n[key] : null), backgroundColor: color, borderRadius: 3 });
            const barEl = document.getElementById('kpi-bar');
            if (barEl) charts.push(new Chart(barEl, {
                type: 'bar',
                data: { labels: bk.map(b => b.label), datasets: [ds('access', 'アクセス', '#A5C8FF'), ds('start', '開始', '#4C8DF6'), ds('complete', '完了', '#1864AB')] },
                options: {
                    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    plugins: { tooltip: { callbacks: { footer: (items) => { const r = rows[items[0].dataIndex]; return r.c === 'future' ? '未到来' : r.c === 'none' ? 'データなし(計測開始前)' : ''; } } } },
                    scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
                }
            }));
            // 前の期間との件数比較
            const cmpEl = document.getElementById('kpi-cmpbar');
            if (cmpEl) charts.push(new Chart(cmpEl, {
                type: 'bar',
                data: {
                    labels: ['アクセス', '開始', '完了'],
                    datasets: [
                        { label: `${PREV_LABEL[p.type]}${inProgress ? '(同じ経過分)' : ''}`, data: [prevC.access, prevC.start, prevC.complete], backgroundColor: '#CED4DA', borderRadius: 3 },
                        { label: 'この期間', data: [cur.access, cur.start, cur.complete], backgroundColor: '#4C8DF6', borderRadius: 3 }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
            }));
            // 率の推移
            let lb = bk, lrows = rows;
            if (p.type === 'daily') {
                lb = [];
                for (let i = 13; i >= 0; i--) { const s = p.start - i * DAY; const a = jp(s); lb.push({ start: s, end: s + DAY, label: `${a.m}/${a.d}` }); }
                lrows = series(lb);
            }
            const rateOf = (r, nk, dk) => (r.n ? Calc.rate(r.n[nk], r.n[dk]) : null);
            const lineSets = [
                { label: '開始率', key: 'startRate', color: '#4C8DF6' },
                { label: '開始後の完了率', key: 'completeRate', color: '#1864AB' },
                { label: 'アクセスからの完了率', key: 'accessCompleteRate', color: '#7048E8' }
            ];
            const datasets = [];
            lineSets.forEach(l => {
                const mk = MK[l.key];
                datasets.push({ label: l.label, data: lrows.map(r => rateOf(r, mk.num, mk.den)), borderColor: l.color, backgroundColor: l.color, spanGaps: false, tension: 0.2, pointRadius: 3 });
                const set = p.type === 'daily' ? settingsInfo.settings.daily[l.key] : setsFor(l.key);
                const T = num(set && set.target);
                if (T != null) datasets.push({ label: `${l.label}の目標(${fmt1(T)}%)`, data: lb.map(() => T), borderColor: l.color, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false });
            });
            const lineEl = document.getElementById('kpi-line');
            if (lineEl) charts.push(new Chart(lineEl, {
                type: 'line',
                data: { labels: lb.map(b => b.label), datasets },
                options: {
                    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw == null ? '算出不可/データなし' : fmt1(c.raw) + '%'}` } } },
                    scales: { y: { min: 0, suggestedMax: 100, ticks: { callback: (v) => v + '%' } } }
                }
            }));
            // 判定の内訳(実際の6指標の判定の数)
            const donutEl = document.getElementById('kpi-donut');
            if (donutEl) {
                const keys = ['good', 'normal', 'poor', 'hold'];
                const counts = keys.map(k => METRICS.filter(m => results[m.key].j.status === k).length);
                charts.push(new Chart(donutEl, {
                    type: 'doughnut',
                    data: { labels: keys.map(k => STATUS[k].label), datasets: [{ data: counts, backgroundColor: keys.map(k => COL[k]), borderWidth: 2 }] },
                    options: { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.label}: ${c.raw}指標` } } } }
                }));
            }
        }

        // ---------- 改善提案 ----------
        function suggestionsHtml(p, results, cur, inProgress) {
            const recheck = p.type === 'daily' ? { span: '3日〜1週間', how: '日間KPIで毎日' }
                : p.type === 'monthly' ? { span: '1〜2週間後と月末', how: '月間KPIの日別推移' }
                    : p.type === 'yearly' ? { span: '翌月末・翌四半期末', how: '年間KPIの月別推移' }
                        : { span: '同じ日数の次の期間', how: 'この期間設定' };
            const judged = METRICS.map(m => results[m.key]).filter(r => r.j.status !== 'hold');
            const holds = METRICS.map(m => results[m.key]).filter(r => r.j.status === 'hold');
            if (!judged.length) {
                const unset = holds.filter(r => /未設定/.test(r.j.reason)).map(r => r.m.label);
                const sample = holds.filter(r => r.j.sample).map(r => r.m.label);
                return { top: null, html: `<div class="card kpi-sugg kpi-sugg-hold" id="kpi-sugg"><div class="kpi-sugg-head">⚪ まだ良し悪しを判定できません</div>
                    <ul class="kpi-ul">
                        ${unset.length ? `<li>目標・判定基準が未設定: ${unset.join('、')} → 右上の「目標・判定基準」から設定すると、判定と改善提案が出ます。設定画面に過去の実績(参考値)も表示されます。</li>` : ''}
                        ${sample.length ? `<li>サンプル不足: ${sample.join('、')} → 件数がたまるまで判定を保留しています。</li>` : ''}
                        ${cur.access + cur.start + cur.complete === 0 ? '<li>この期間の計測件数が0件、または計測開始前です。</li>' : ''}
                    </ul></div>` };
            }
            // 優先順位: 要改善 → 通常。同じなら目標(基準)に対する不足の割合が大きい順。同じならファネルの上流から
            const order = ['access', 'startRate', 'start', 'completeRate', 'complete', 'accessCompleteRate'];
            const shortfall = (r) => {
                if (r.m.kind === 'count') return r.j.paceAch != null ? 100 - r.j.paceAch : 0;
                const g = num(r.set.good), v = r.value;
                return g ? (g - v) / g * 100 : 0;
            };
            const issues = judged.filter(r => r.j.status === 'poor' || r.j.status === 'normal')
                .sort((a, b) => STATUS[a.j.status].rank - STATUS[b.j.status].rank || shortfall(b) - shortfall(a) || order.indexOf(a.m.key) - order.indexOf(b.m.key));
            if (!issues.length) {
                return { top: null, html: `<div class="card kpi-sugg kpi-sugg-good" id="kpi-sugg"><div class="kpi-sugg-head">🟢 判定できた指標はすべて「良好」です(ケースD)</div>
                    <ul class="kpi-ul"><li><b>次の行動:</b> 今の導線・フォームの内容は変えずに維持し、${recheck.span}続けて同じ結果になるか(再現性)を確認します。</li>
                    <li>判定保留の指標(${holds.map(r => r.m.label).join('、') || 'なし'})があれば、目標・基準を設定して他のボトルネックがないか確認します。</li>
                    <li><b>再確認する指標:</b> アクセス数・開始率・開始後の完了率 / <b>期間:</b> ${recheck.span}(${recheck.how})</li></ul></div>` };
            }
            const caseOf = (r) => {
                const k = r.m.key;
                if (k === 'access') return 'A';
                if (k === 'start' || k === 'startRate') return results.access.j.status === 'poor' && k === 'start' ? 'A' : 'B';
                if (k === 'complete') return results.completeRate.j.status === 'poor' || results.startRate.j.status !== 'poor' ? 'C' : 'B';
                if (k === 'completeRate') return 'C';
                // アクセスからの完了率: 開始率と開始後の完了率の、判定の悪い方
                const sr = results.startRate.j, cr = results.completeRate.j;
                if (STATUS[sr.status].rank < STATUS[cr.status].rank) return 'B';
                return 'C';
            };
            const CASES = {
                A: { name: 'アクセス数が少ない', causes: ['LINEなど今ある集客の導線からフォームへの誘導が少ない', 'リンクの表示位置が目立たない', '案内文が分かりにくく、押す理由が伝わっていない', 'フォームへ誘導する機会(配信回数・案内の場面)が足りない'], action: '今ある導線(LINE配信・リッチメニュー・プロフィール等)のうち1か所だけ、リンクの位置か案内文を変えて、変更日をメモする', re: 'アクセス数' },
                B: { name: 'アクセスはあるが開始率が低い', causes: ['フォーム冒頭の説明で、入力するメリットが伝わっていない', '最初の入力項目・開始ボタンが見つけにくい', 'スマートフォンで操作しにくい', 'CTA(ボタン)や案内文が分かりにくい'], action: 'スマートフォンでフォームを開き、冒頭の説明と開始ボタンを確認。冒頭の一文か開始ボタンの文言のどちらか1つだけを変えて比べる', re: '開始率(開始数 ÷ アクセス数)' },
                C: { name: '開始後の完了率が低い', causes: ['入力項目・必須項目が多い', '入力エラーで先に進めない', '送信ボタンの動作・送信処理のエラー', 'スマートフォンで操作しにくい'], action: '分析フォームの「設問ごとの到達・離脱状況」で離脱の多い設問を確認し、その設問の必須を外す・選択肢を減らすなど1つだけ変える。あわせてスマートフォンで最後まで送信できるか試す', re: '開始後の完了率(完了数 ÷ 開始数)' }
            };
            const card = (r, i) => {
                const c = CASES[caseOf(r)];
                const T = num(r.set.target);
                const v = r.m.kind === 'count' ? `${fmtN(r.value)}件` : fmtP(r.value);
                const tgt = T == null ? '目標未設定' : r.m.kind === 'count' ? `${fmtN(T)}件${inProgress && r.j.paceTarget != null ? `(今の時点の目安 ${fmt1(r.j.paceTarget)}件)` : ''}` : `${fmt1(T)}%`;
                let gap = '-';
                if (T != null && r.value != null) {
                    if (r.m.kind === 'count') { const base = inProgress && r.j.paceTarget != null ? r.j.paceTarget : T; const d = r.value - base; gap = `${d >= 0 ? '+' : ''}${fmt1(d)}件${inProgress ? '(今の時点の目安との差)' : ''}`; }
                    else gap = `${r.value - T >= 0 ? '+' : ''}${fmt1(r.value - T)}pt`;
                }
                const headTxt = `${i === 0 ? '最優先: ' : `${i + 1}番目: `}${STATUS[r.j.status].icon} ${r.m.label}(${STATUS[r.j.status].label}) — ケース${caseOf(r)}「${c.name}」`;
                return `
                <details class="kpi-sugg-item ${i === 0 ? 'is-top' : ''}" ${i === 0 ? 'open' : ''}>
                    <summary class="kpi-sugg-head">${headTxt}</summary>
                    <table class="kpi-sugg-table">
                        <tr><th>1. 対象KPI</th><td>${r.m.label}</td></tr>
                        <tr><th>2. 現在の実績</th><td>${v}</td></tr>
                        <tr><th>3. 目標値</th><td>${tgt}</td></tr>
                        <tr><th>4. 目標との差</th><td>${gap}</td></tr>
                        <tr><th>5. 判定理由</th><td>${esc(r.j.reason)}</td></tr>
                        <tr><th>6. 原因の候補(仮説)</th><td>${c.causes.map(x => `・${x}`).join('<br>')}<div class="kpi-mini">※数字だけでは原因を決められないため、確認すべき候補として挙げています。</div></td></tr>
                        <tr><th>7. 次の行動</th><td><b>${c.action}</b></td></tr>
                        <tr><th>8. 再確認する指標</th><td>${c.re}${r.m.key !== 'access' ? '・アクセス数(母数が変わっていないか)' : ''}</td></tr>
                        <tr><th>9. 再確認する期間</th><td>${recheck.span}(${recheck.how})</td></tr>
                    </table>
                </details>`;
            };
            return { top: issues[0], html: `<div class="card kpi-sugg" id="kpi-sugg"><div class="kpi-sec-title" style="margin-top:0;">改善提案(実際の数値と判定から自動作成)</div>${issues.slice(0, 3).map(card).join('')}
                ${issues.length > 3 ? `<div class="kpi-note">ほかに ${issues.slice(3).map(r => r.m.label).join('、')} も目標・基準に届いていません。</div>` : ''}</div>` };
        }

        function formulaHtml(cur, m, p) {
            return `<details class="card kpi-formula"><summary>計算式と、この期間の計算内容を見る</summary>
                <table class="kpi-sugg-table">
                    <tr><th>開始率</th><td>開始数 ÷ アクセス数 × 100 = ${fmtN(cur.start)} ÷ ${fmtN(cur.access)} × 100 = <b>${fmtP(m.startRate)}</b></td></tr>
                    <tr><th>開始後の完了率</th><td>完了数 ÷ 開始数 × 100 = ${fmtN(cur.complete)} ÷ ${fmtN(cur.start)} × 100 = <b>${fmtP(m.completeRate)}</b></td></tr>
                    <tr><th>アクセスからの完了率</th><td>完了数 ÷ アクセス数 × 100 = ${fmtN(cur.complete)} ÷ ${fmtN(cur.access)} × 100 = <b>${fmtP(m.accessCompleteRate)}</b></td></tr>
                    <tr><th>目標達成率</th><td>実績値 ÷ 目標値 × 100(目標が0・未設定のときは算出しません)</td></tr>
                    <tr><th>目標との差</th><td>実績値 − 目標値(率はポイント差)</td></tr>
                    <tr><th>参考進捗率</th><td>期間の経過割合(日間は時刻、月間・年間は日時で計算)。期間の途中は「目標 × 経過割合」を今の時点の目安として判定します</td></tr>
                    <tr><th>着地見込み</th><td>今までの実績 ÷ 経過割合(今までと同じペースが続いた場合の直線的な目安)</td></tr>
                    <tr><th>注意</th><td>率は期間内の合計件数から計算しています(日別の率の平均ではありません)。分母が0件のときは0%ではなく「算出不可」。数値は小数点以下1桁で表示。期間: ${esc(p.label)}(日本時間)</td></tr>
                </table></details>`;
        }

        function criteriaHtml(isAdminUser) {
            const info = settingsInfo;
            return `<div class="kpi-note" style="margin:8px 0 24px;">判定基準の最終更新: ${info.updatedAt ? `${fmtDate(Date.parse(info.updatedAt))}${info.updatedBy ? `(${esc(info.updatedBy)})` : ''}` : 'まだ設定されていません'} ・ ${isAdminUser ? '「目標・判定基準」から変更できます' : '変更できるのは管理者だけです'}</div>`;
        }

        // ---------- 目標・判定基準の設定 ----------
        function referenceValues(type, now) {
            // 過去実績(参考): 日間=直近30日の1日あたり、月間=直近の終わった3か月の1か月あたり、年間=昨年
            const t = jp(now);
            let a, b, n, label;
            if (type === 'daily') { b = jms(t.y, t.m, t.d); a = b - 30 * DAY; n = 30; label = '直近30日の1日あたり'; }
            else if (type === 'monthly') { b = jms(t.y, t.m, 1); a = jms(t.y, t.m - 3, 1); n = 3; label = '直近3か月の1か月あたり'; }
            else { a = jms(t.y - 1, 1, 1); b = jms(t.y, 1, 1); n = 1; label = '昨年の実績'; }
            const cov = coverage(firstT, a, b, now);
            if (cov === 'none') return { label, none: true };
            const c = countIn(events, a, b);
            return { label, partial: cov === 'partial', access: c.access / n, start: c.start / n, complete: c.complete / n, ...Object.fromEntries(['startRate', 'completeRate', 'accessCompleteRate'].map(k => [k, Calc.metricsFromCounts(c)[k]])) };
        }

        function openSettings() {
            let tab = UI.mode === 'monthly' || UI.mode === 'yearly' ? UI.mode : 'daily';
            const draft = JSON.parse(JSON.stringify(settingsInfo.settings));
            const ov = document.createElement('div');
            ov.className = 'modal-overlay active';
            ov.id = 'kpi-settings-modal';
            const draw = () => {
                const ref = referenceValues(tab, Date.now());
                const ro = !isAdmin;
                ov.innerHTML = `
                <div class="modal-content" style="max-width:1000px;">
                    <div class="modal-header"><h3 class="modal-title">目標・判定基準</h3><button class="modal-close" id="kpi-set-close"><i class="ph ph-x"></i></button></div>
                    <div class="kpi-tabs" style="margin-bottom:12px;">${['daily', 'monthly', 'yearly'].map(t => `<button type="button" class="kpi-tab ${t === tab ? 'is-on' : ''}" data-tab="${t}">${TYPE_LABEL[t]}</button>`).join('')}</div>
                    <div class="kpi-help">
                        ・<b>件数</b>(アクセス・開始・完了)の良好/要改善は「目標に対する達成率(%)」で入れます。期間の途中は「目標 × 期間の経過割合」を今の時点の目安として比べます。<br>
                        ・<b>率</b>の良好/要改善は「率そのもの(%)」で入れます。<br>
                        ・良好の境界以上 → 🟢良好 / 要改善の境界未満 → 🔴要改善 / その間 → 🟡通常。境界が両方空欄なら ⚪判定保留。<br>
                        ・<b>サンプル不足</b>: 件数は「今の時点の目安件数」、率は「分母の件数」がこの数より少ないと判定保留にします(率の初期値10件は仮の値です。変更できます)。<br>
                        ・ここで変えるのは判定の基準だけで、計測データは変わりません。業界の標準値は入れていません。自社の過去実績(右端)を参考に決めてください。
                    </div>
                    ${ro ? '<div class="kpi-warn" style="margin-bottom:10px;">閲覧のみ: 変更できるのは管理者だけです。</div>' : ''}
                    <div class="table-container" style="overflow-x:auto;">
                    <table class="kpi-set-table">
                        <thead><tr><th>指標</th><th>目標値</th><th>良好の境界(以上)</th><th>要改善の境界(未満)</th><th>通常の範囲</th><th>サンプル不足(件未満)</th><th>過去実績(参考)<div class="kpi-mini">${esc(ref.label)}</div></th></tr></thead>
                        <tbody>${METRICS.map(m => {
                            const s = draft[tab][m.key];
                            const unit = m.kind === 'count' ? (m.kind === 'count' ? '件' : '%') : '%';
                            const inp = (f, u, step) => `<input type="number" min="0" ${m.kind === 'rate' && f !== 'minSample' ? 'max="100"' : ''} step="${step}" value="${s[f] ?? ''}" data-f="${f}" data-k="${m.key}" ${ro ? 'disabled' : ''}><span>${u}</span>`;
                            const normal = normalText(s);
                            const refV = ref.none ? 'データなし' : m.kind === 'count' ? `${fmt1(ref[m.key])}件` : fmtP(ref[m.key]);
                            return `<tr>
                                <td><b>${m.label}</b><div class="kpi-mini">${m.kind === 'count' ? '件数' : '率'}</div></td>
                                <td>${inp('target', unit, m.kind === 'count' ? 1 : 0.1)}</td>
                                <td>${inp('good', m.kind === 'count' ? '%(達成率)' : '%', 0.1)}</td>
                                <td>${inp('poor', m.kind === 'count' ? '%(達成率)' : '%', 0.1)}</td>
                                <td class="kpi-mini" id="kpi-normal-${m.key}">${normal}</td>
                                <td>${inp('minSample', '件', 1)}</td>
                                <td class="kpi-mini">${refV}${ref.partial ? '<br>(一部期間のみ)' : ''}</td></tr>`;
                        }).join('')}</tbody>
                    </table></div>
                    <div id="kpi-set-err" class="kpi-err" style="display:none;"></div>
                    <div class="modal-footer" style="align-items:center;">
                        <button class="btn-secondary" id="kpi-set-cancel">${ro ? '閉じる' : 'キャンセル'}</button>
                        ${ro ? '' : '<button class="btn-primary" id="kpi-set-save">保存する</button>'}
                    </div>
                </div>`;
                ov.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; draw(); });
                ov.querySelectorAll('input[data-f]').forEach(inp => inp.oninput = () => {
                    draft[tab][inp.dataset.k][inp.dataset.f] = num(inp.value);
                    const cell = ov.querySelector(`#kpi-normal-${inp.dataset.k}`);
                    if (cell) cell.textContent = normalText(draft[tab][inp.dataset.k]);
                });
                ov.querySelector('#kpi-set-close').onclick = close;
                ov.querySelector('#kpi-set-cancel').onclick = close;
                const save = ov.querySelector('#kpi-set-save');
                if (save) save.onclick = async () => {
                    if (!checkAdminLocal()) return;
                    const errs = validateSettings(draft);
                    const box = ov.querySelector('#kpi-set-err');
                    if (errs.length) { box.style.display = ''; box.innerHTML = '保存できません:<br>' + errs.map(esc).join('<br>'); return; }
                    save.disabled = true; save.textContent = '保存中...';
                    try {
                        settingsInfo = await saveSettings(settingsInfo.rowId, draft, user);
                        try { await Store.logAction(user.email, 'KPIの目標・判定基準を変更しました'); } catch (e) { /* */ }
                        close();
                        render();
                    } catch (e) {
                        box.style.display = ''; box.textContent = '保存に失敗しました: ' + (e.message || '');
                        save.disabled = false; save.textContent = '保存する';
                    }
                };
            };
            const close = () => ov.remove();
            draw();
            document.body.appendChild(ov);
        }
        function checkAdminLocal() {
            const u = Auth.getCurrentUser();
            if (!u || u.role !== 'admin') { alert('目標・判定基準を変更できるのは管理者だけです。'); return false; }
            return true;
        }
    };

    function normalText(s) {
        if (s.good == null && s.poor == null) return '—(基準未設定)';
        if (s.good != null && s.poor != null) return `${fmt1(s.poor)}%以上 ${fmt1(s.good)}%未満`;
        if (s.good != null) return `${fmt1(s.good)}%未満`;
        return `${fmt1(s.poor)}%以上`;
    }
    function fmtDate(ms) { const a = jp(ms); return `${a.y}/${a.m}/${a.d} ${a.h}:${pad(a.mi)}`; }

    // テスト用に中身を公開(画面の動作には使わない)
    window.KpiInternals = { buildPeriod, prevPeriod, buckets, countIn, coverage, validateSettings, mergeSettings, defaultSettings, jms, jp };

    const STYLE = `<style>
        .kpi-head { padding: 16px 20px; margin-bottom: 14px; }
        .kpi-head-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .kpi-tabs { display: inline-flex; background: var(--bg-tertiary, #f1f3f5); border-radius: 12px; padding: 4px; gap: 4px; }
        .kpi-tab { border: none; background: transparent; padding: 10px 18px; border-radius: 9px; font-weight: 700; font-size: 0.95rem; cursor: pointer; color: var(--text-secondary); font-family: inherit; }
        .kpi-tab.is-on { background: var(--primary, #111); color: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.15); }
        .kpi-other { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .kpi-other select, .kpi-period select, .kpi-period input { width: auto; padding: 6px 10px; font-size: 0.85rem; }
        .kpi-period { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 1.1rem; }
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
        .kpi-err { margin-top: 10px; color: #C92A2A; background: #FFF0F0; border-radius: 8px; padding: 10px 12px; font-size: 0.82rem; line-height: 1.7; }
        @media (max-width: 900px) { .kpi-cards-6 { grid-template-columns: repeat(2, minmax(0, 1fr)); } .kpi-charts { grid-template-columns: 1fr; } .kpi-fn-grid, .kpi-judge-wrap { grid-template-columns: 1fr; } .kpi-judge { grid-template-columns: 1fr 1fr; } .kpi-j-name, .kpi-judge .kpi-cmp { grid-column: 1 / -1; } }
        @media (max-width: 600px) { .kpi-fs { grid-template-columns: 1fr 70px; } .kpi-fs-track { grid-column: 1 / -1; grid-row: 2; } .kpi-fs-flow { grid-column: 1 / -1; justify-content: flex-start; } .kpi-ss { grid-template-columns: 1fr 50px 50px; } .kpi-ss .kpi-fs-track { grid-column: 1 / -1; grid-row: 2; } .kpi-gauges { grid-template-columns: 1fr; } }
        @media (max-width: 600px) { .kpi-tab { padding: 9px 12px; font-size: 0.85rem; } .kpi-main { font-size: 1.7rem; } .kpi-fn-arrow { display: none; } .kpi-sugg-table th { white-space: normal; width: 30%; } }
    </style>`;
})();
