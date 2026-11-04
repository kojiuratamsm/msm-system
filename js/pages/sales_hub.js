// js/pages/sales_hub.js
// 「営業」: サイドバーの「営業」から開く入口(営業 / 営業成績)と、
//   ・営業管理(sales_manage) … ヒアリングシート一覧・営業成績一覧
//   ・ヒアリングシート(hearing_sheet) … 商談中に使う画面(左: 商談マニュアル / 右: 入力欄)
// 営業成績のページ(sales_performance.js)の中身・機能は変えていない(入口と現在地の表示だけ)。
//
// 【データ】(作り方・計算は lib/sales_core.js)
//   customers.service_type='hearing_sheet'  シート1枚 = 営業成績の1行(=1商談)。id は営業成績の行から決まる値 → 二重に作られない。
//     シートに保存するのは「ヒアリングの5つのメモ・進捗チェック・次回アクション・次回連絡予定日・商談担当者」だけ。
//     店舗名・商談日・成約状況・成約プラン・不成約理由は、営業成績の行(sales_record)に1か所だけ持つ(シートからの変更も
//     営業成績の画面と同じ処理 SalesCore.applyAction で営業成績の行に保存する)→ 2つの画面が食い違うことがない。
//   分析フォームの回答(meo_form_response)は読むだけ。書き換えない。
// 【保存】 入力が止まって約0.8秒後・欄から離れたとき・チェックや選択はすぐに保存。保存の直前に最新を読み直し、
//   変えた欄だけを書き込む(ほかの人が同じ欄を先に変えていたら上書きせず、両方を見せて選んでもらう)。
//   保存できなかった入力は、この端末(ブラウザ)に一時保管し、次に開いたときにも自動で送り直す。
(function () {
    const C = window.SalesCore;
    const { jp, jms, pad, toMs } = C;
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const WD = ['日', '月', '火', '水', '木', '金', '土'];
    const fmtDT = (v) => { const t = toMs(v); if (!Number.isFinite(t)) return ''; const a = jp(t); return `${a.y}/${a.m}/${a.d}(${WD[a.wd]}) ${a.h}:${pad(a.mi)}`; };
    const fmtDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? `${+m[1]}/${+m[2]}/${+m[3]}` : ''; };
    const toLocalInput = (v) => { const t = toMs(v); if (!Number.isFinite(t)) return ''; const a = jp(t); return `${a.y}-${pad(a.m)}-${pad(a.d)}T${pad(a.h)}:${pad(a.mi)}`; };
    const fromLocalInput = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || '')); return m ? new Date(jms(+m[1], +m[2], +m[3], +m[4], +m[5])).toISOString() : null; };
    const same = (x, y) => JSON.stringify(x == null ? '' : x) === JSON.stringify(y == null ? '' : y);
    const ls = {
        get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できなくても動作は続ける */ } },
        del(k) { try { localStorage.removeItem(k); } catch (e) { /* 同上 */ } }
    };
    const isAdmin = () => { const u = Auth.getCurrentUser(); return !!(u && u.role === 'admin'); };
    const denied = () => App.mount('<div class="card" style="margin-top:24px; padding:40px; text-align:center;"><h3 class="card-title">営業は管理者のみ閲覧できます</h3></div>');

    const MESSAGE = ['この人の人生を変えてあげろ。', '助けてあげろ。', '営業＝HELP', '分析診断にくると言うことは、集客に困っている。', '無責任に売るな。', '目の前の人を助けるために俺らのサービスがあるんだ。'];
    const NOTES = [
        { k: 'method', label: '現在の集客方法' },
        { k: 'price', label: '一人当たりの単価感' },
        { k: 'ideal', label: '一番理想的な姿' },
        { k: 'worry', label: '何に悩んでいるのか？' },
        { k: 'issue', label: '何が課題なのか？' }
    ];
    const FIELD_LABEL = Object.assign({ nextAction: '次回アクション', nextContactDate: '次回連絡予定日', owner: '商談担当者', 'rec.lostReason': '不成約理由' },
        ...NOTES.map(n => ({ ['notes.' + n.k]: n.label })),
        ...C.SHEET_SECTIONS.map(k => ({ ['checks.' + k]: '進捗チェック' })));
    const LABEL_CLS = { won: 'hs-lb-won', lost: 'hs-lb-lost', noshow: 'hs-lb-noshow', adjusting: 'hs-lb-adj', planned: 'hs-lb-plan', missing: 'hs-lb-miss' };

    // ---------- 入口・現在地 ----------
    const SALES_PAGES = window.SALES_PAGES = {
        sales_manage: { label: '営業', icon: 'ph-clipboard-text', desc: 'ヒアリングシート一覧・営業成績一覧' },
        sales_performance: { label: '営業成績', icon: 'ph-chart-bar', desc: '成約率・目標・商談結果の入力' },
        hearing_sheet: { label: 'ヒアリングシート', parent: 'sales_manage' }
    };
    window.SalesBreadcrumb = function (target, extra) {
        const info = SALES_PAGES[target];
        const el = document.getElementById('page-title');
        if (!info || !el) return;
        const parent = info.parent ? SALES_PAGES[info.parent] : null;
        const backTo = info.parent || 'sales_hub';
        el.innerHTML = `<span class="sns-crumb">
            <button type="button" class="sns-back" onclick="App.navigate('${backTo}')" title="ひとつ前のメニューに戻る"><i class="ph ph-arrow-left"></i><span>戻る</span></button>
            <span class="sns-crumb-path"><a href="#" onclick="App.navigate('sales_hub'); return false;">営業</a>${parent ? `<span class="sns-sep">＞</span><a href="#" onclick="App.navigate('${info.parent}'); return false;">${esc(parent.label)}</a>` : ''}<span class="sns-sep">＞</span><b>${esc(info.label)}${extra ? `：${esc(extra)}` : ''}</b></span>
        </span>`;
    };

    App.Pages.sales_hub = async function () {
        if (!isAdmin()) return denied();
        const btn = (k) => {
            const p = SALES_PAGES[k];
            return `<button type="button" class="sns-page" data-target="${k}" onclick="App.navigate('${k}')">
                <i class="ph ${p.icon}"></i><span class="sns-page-label">${esc(p.label)}</span><span class="sns-page-desc">${esc(p.desc)}</span>
                <i class="ph ph-caret-right sns-page-go"></i></button>`;
        };
        App.mount(`<div class="card sns-card">
            <div class="sns-step">営業のメニュー</div>
            <div class="sns-pages">${btn('sales_manage')}${btn('sales_performance')}</div>
        </div>`);
    };

    // ---------- 共通: 読み込み・シートの自動作成 ----------
    let ensuring = null;
    // 営業成績の行ごとのシートが無ければ作る(何回呼んでも二重にならない)。戻り値: 作った枚数
    window.HearingSheetEnsure = async function (records) {
        if (ensuring) return ensuring;
        ensuring = (async () => {
            const recs = records || (await Store.getAllRows(C.SERVICE_RECORD)).rows;
            const sheets = (await Store.getAllRows(C.SERVICE_SHEET)).rows;
            const ins = C.planSheets(recs, sheets, new Date().toISOString());
            if (ins.length) await Store.salesUpsertIgnore('customers', ins);
            return ins.length;
        })();
        try { return await ensuring; } finally { ensuring = null; }
    };
    // 分析フォームの完了 → 営業成績 → シート を最新にしてから、全部読む
    async function loadAll() {
        if (window.SalesSyncAll) {
            try { await window.SalesSyncAll(); } catch (e) { console.error('sales sync', e); M.syncErr = e.message || '同期に失敗しました。'; }
        }
        const recs = (await Store.getAllRows(C.SERVICE_RECORD)).rows;
        try { await window.HearingSheetEnsure(recs); } catch (e) { console.error('sheet ensure', e); M.syncErr = M.syncErr || ('ヒアリングシートの自動作成に失敗しました: ' + (e.message || '')); }
        const sheets = (await Store.getAllRows(C.SERVICE_SHEET)).rows;
        return { recs, sheets };
    }

    // ---------- 営業管理(ヒアリングシート一覧・営業成績一覧) ----------
    const MUI = window.SalesManageUi = window.SalesManageUi || { tab: 'sheets', q: '', when: 'all', showExcluded: false };
    const M = { recs: [], sheets: [], syncErr: '' };
    let manageTimer = null;

    App.Pages.sales_manage = async function () {
        if (!isAdmin()) return denied();
        M.syncErr = '';
        let data;
        try { data = await loadAll(); }
        catch (e) {
            console.error(e);
            App.mount(`<div class="card" style="padding:32px; border-left:4px solid #E03131;"><h3 style="margin-bottom:8px;">営業のデータを読み込めませんでした</h3><p style="line-height:1.8;">${esc(e.message || '')}</p>
                <button class="btn-primary" style="margin-top:16px;" onclick="App.navigate('sales_manage')">もう一度読み込む</button></div>`);
            return;
        }
        M.recs = data.recs; M.sheets = data.sheets;
        App.mount(`<div id="hm-root"></div>${STYLE}`, () => {
            window.hmSet = (patch) => { Object.assign(MUI, patch); renderManage(patch.q === undefined); };
            window.hmOpen = (sheetId) => App.navigate('hearing_sheet', { id: String(sheetId) });
            window.hmOpenSales = (key) => App.navigate('sales_performance', { focus: key });
            renderManage(true);
            if (manageTimer) clearInterval(manageTimer);
            manageTimer = setInterval(async () => {
                if (!document.getElementById('hm-root')) { clearInterval(manageTimer); manageTimer = null; return; }
                if (document.visibilityState && document.visibilityState !== 'visible') return;
                try {
                    const d = await loadAll();
                    if (!document.getElementById('hm-root')) return;
                    M.recs = d.recs; M.sheets = d.sheets; renderManage(false);
                } catch (e) { console.error('sales manage poll', e); }
            }, 60000);
        });
    };

    function joined() {
        const byKey = new Map(M.sheets.map(s => [s.salesKey, s]));
        const rep = C.repeatKeys(M.recs);
        return M.recs.map(r => ({ r, s: byKey.get(r.key) || null, repeat: rep.has(r.key) }));
    }
    function whenOf(r, now) {
        const t = toMs(r.meetingAt);
        if (!Number.isFinite(t)) return 'none';
        const today = C.jstDate(now), d = C.jstDate(t);
        return d === today ? 'today' : d > today ? 'future' : 'past';
    }
    function sortRows(list, now) {
        const today = C.jstDate(now);
        const rank = (r) => { const w = whenOf(r, now); return w === 'today' ? 0 : w === 'future' ? 1 : w === 'none' ? 2 : 3; };
        return list.slice().sort((a, b) => {
            const ra = rank(a.r), rb = rank(b.r);
            if (ra !== rb) return ra - rb;
            const ta = toMs(a.r.meetingAt), tb = toMs(b.r.meetingAt);
            if (ra <= 1) return ta - tb;
            if (ra === 3) return tb - ta;
            return toMs(b.r.completedAt) - toMs(a.r.completedAt);
        });
    }
    function renderManage(full) {
        const root = document.getElementById('hm-root');
        if (!root) return;
        const now = Date.now();
        const all = joined();
        const vis = all.filter(x => MUI.showExcluded || !x.r.excluded);
        const q = (MUI.q || '').trim();
        const qn = C.normalizeStore(q);
        const hit = (x) => !q || C.normalizeStore(x.r.storeName).includes(qn) || String(x.r.storeName || '').includes(q);
        const sheetList = sortRows(vis.filter(hit).filter(x => MUI.when === 'all' || whenOf(x.r, now) === MUI.when || (MUI.when === 'missing' && C.displayLabel(x.r, now).key === 'missing')), now);
        const salesList = vis.filter(hit).slice().sort((a, b) => toMs(b.r.completedAt) - toMs(a.r.completedAt));
        if (full) {
            root.innerHTML = `
                ${M.syncErr ? `<div class="card hs-warn">${esc(M.syncErr)}</div>` : ''}
                <div class="card hm-card">
                    <div class="hm-tabs" role="tablist">
                        <button type="button" class="hm-tab ${MUI.tab === 'sheets' ? 'is-on' : ''}" onclick="hmSet({tab:'sheets'})" role="tab" aria-selected="${MUI.tab === 'sheets'}"><i class="ph ph-clipboard-text"></i> ヒアリングシート一覧 <span class="hm-n" id="hm-n-sheets"></span></button>
                        <button type="button" class="hm-tab ${MUI.tab === 'sales' ? 'is-on' : ''}" onclick="hmSet({tab:'sales'})" role="tab" aria-selected="${MUI.tab === 'sales'}"><i class="ph ph-chart-bar"></i> 営業成績一覧 <span class="hm-n" id="hm-n-sales"></span></button>
                    </div>
                    <div class="hm-filters">
                        <input type="search" class="input-field hm-q" placeholder="店舗名で探す" value="${esc(MUI.q)}" oninput="hmSet({q:this.value})">
                        ${MUI.tab === 'sheets' ? `<select class="input-field hm-when" onchange="hmSet({when:this.value})">
                            ${[['all', 'すべての商談日'], ['today', '今日の商談'], ['future', 'これからの商談'], ['missing', '結果未入力'], ['none', '商談日が未入力'], ['past', '過去の商談']].map(([v, l]) => `<option value="${v}" ${MUI.when === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
                        <label class="hm-check"><input type="checkbox" ${MUI.showExcluded ? 'checked' : ''} onchange="hmSet({showExcluded:this.checked})"> 除外した行も表示</label>
                    </div>
                    <div id="hm-list"></div>
                    <div class="kpi-mini hm-foot">ヒアリングシートは、営業成績に新しい行(分析フォームの完了)が追加されると自動で作られます。店舗名・商談日・成約状況は営業成績のデータをそのまま表示しています。</div>
                </div>`;
        }
        const ns = document.getElementById('hm-n-sheets'), nr = document.getElementById('hm-n-sales');
        if (ns) ns.textContent = String(vis.filter(x => x.s).length);
        if (nr) nr.textContent = String(vis.length);
        const el = document.getElementById('hm-list');
        if (!el) return;
        if (MUI.tab === 'sheets') {
            const rows = sheetList.map(({ r, s, repeat }) => {
                const lb = C.displayLabel(r, now);
                const pg = s ? C.progressOf(s) : { done: 0, total: 7, pct: 0 };
                const w = whenOf(r, now);
                return `<tr class="${r.excluded ? 'hm-ex' : ''} ${w === 'today' ? 'hm-today' : ''}" data-key="${esc(r.key)}">
                    <td class="hm-nowrap">${r.meetingAt ? esc(fmtDT(r.meetingAt)) : '<span class="hm-muted">(未入力)</span>'}${w === 'today' ? ' <span class="hm-badge hm-badge-today">今日</span>' : ''}</td>
                    <td>${s ? `<button class="hm-link" onclick="hmOpen('${s.id}')">${esc(r.storeName || '(店舗名なし)')}</button>` : esc(r.storeName || '(店舗名なし)')}${repeat ? ' <span class="hm-badge">再申込</span>' : ''}${r.excluded ? ' <span class="hm-badge hm-badge-ex">除外中</span>' : ''}</td>
                    <td><span class="hs-label ${LABEL_CLS[lb.key]}">${lb.text}</span></td>
                    <td class="hm-nowrap"><div class="hm-pg"><div class="hm-pg-bar"><i style="width:${pg.pct}%"></i></div><span>${pg.done}/${pg.total}</span></div></td>
                    <td>${s ? esc(s.owner || '') : ''}</td>
                    <td class="hm-nowrap">${s ? esc(fmtDate(s.nextContactDate)) : ''}</td>
                    <td class="hm-nowrap hm-muted">${s && s.updatedBy !== 'system' ? esc(fmtDT(s.updatedAt)) : '-'}</td>
                    <td>${s ? `<button class="btn-primary btn-sm" onclick="hmOpen('${s.id}')">シートを開く</button>` : '<span class="hm-muted">作成待ち</span>'}</td>
                </tr>`;
            }).join('');
            el.innerHTML = `<div class="hm-table-wrap"><table class="hm-table"><thead><tr><th>商談日</th><th>店舗名</th><th>成約状況</th><th>進捗</th><th>商談担当者</th><th>次回連絡予定日</th><th>最終更新</th><th></th></tr></thead>
                <tbody>${rows || '<tr><td colspan="8" class="hm-empty">該当するシートはありません</td></tr>'}</tbody></table></div>`;
        } else {
            const rows = salesList.map(({ r, s, repeat }) => {
                const lb = C.displayLabel(r, now);
                const extra = r.status === 'won' ? esc(r.plan || '') + (r.wonDate ? ` <span class="hm-muted">(成約日 ${esc(fmtDate(r.wonDate))})</span>` : '')
                    : r.status === 'lost' ? `${r.lostCategory ? `<b>[${esc(r.lostCategory)}]</b> ` : ''}${esc(String(r.lostReason || '').slice(0, 60))}${String(r.lostReason || '').length > 60 ? '…' : ''}` : '';
                return `<tr class="${r.excluded ? 'hm-ex' : ''}" data-key="${esc(r.key)}">
                    <td class="hm-nowrap">${esc(fmtDT(r.completedAt))}</td>
                    <td>${esc(r.storeName || '(店舗名なし)')}${repeat ? ' <span class="hm-badge">再申込</span>' : ''}${r.excluded ? ' <span class="hm-badge hm-badge-ex">除外中</span>' : ''}</td>
                    <td class="hm-nowrap">${r.meetingAt ? esc(fmtDT(r.meetingAt)) : '<span class="hm-muted">(未入力)</span>'}</td>
                    <td><span class="hs-label ${LABEL_CLS[lb.key]}">${lb.text}</span></td>
                    <td class="hm-extra">${extra}</td>
                    <td class="hm-nowrap">${s ? `<button class="btn-secondary btn-sm" onclick="hmOpen('${s.id}')">シート</button> ` : ''}<button class="btn-secondary btn-sm" onclick="hmOpenSales('${esc(r.key)}')">営業成績で開く</button></td>
                </tr>`;
            }).join('');
            el.innerHTML = `<div class="hm-table-wrap"><table class="hm-table"><thead><tr><th>完了日時</th><th>店舗名</th><th>商談日</th><th>成約状況</th><th>成約プラン / 不成約理由</th><th></th></tr></thead>
                <tbody>${rows || '<tr><td colspan="6" class="hm-empty">該当する行はありません</td></tr>'}</tbody></table></div>
                <div class="kpi-mini hm-foot">営業成績のデータをそのまま表示しています(ここでは変更できません)。成約状況などの入力は、ヒアリングシートまたは「営業成績」の画面で行ってください。</div>`;
        }
    }

    // ---------- ヒアリングシート ----------
    // H: 開いているシートの状態
    //   base   … 欄ごとの「サーバーにある(と分かっている)値」
    //   dirty  … まだ保存できていない欄 { 欄: 値 }
    //   conflicts … ほかの人が同じ欄を先に変えていた欄 { 欄: { theirs, meta } }
    let H = null, sheetTimer = null;
    const draftKey = (id) => `msm_hs_draft_${id}`;
    const scrollKey = (id) => `msm_hs_scroll_${id}`;
    const UIKEY = 'msm_hs_ui';

    App.Pages.hearing_sheet = async function (opts) {
        if (!isAdmin()) return denied();
        const o = (opts && typeof opts === 'object') ? opts : { id: opts };
        let sheetId = o.id ? String(o.id) : '';
        // 営業成績の行から開いた場合(シートがまだ無ければ作る)
        if (!sheetId && o.salesKey) sheetId = String(C.sheetIdForKey(o.salesKey));
        let row = sheetId ? await Store.salesGetRow('customers', sheetId) : null;
        if (!row && o.salesKey) {
            await window.HearingSheetEnsure();
            row = await Store.salesGetRow('customers', sheetId);
        }
        if (!row || !row.data || !row.data.salesKey) {
            App.mount(`<div class="card" style="padding:32px;"><h3>ヒアリングシートが見つかりませんでした</h3><p class="kpi-note">一覧から開き直してください。</p><button class="btn-primary" style="margin-top:12px;" onclick="App.navigate('sales_manage')">一覧に戻る</button></div>`);
            return;
        }
        const recRow = await Store.salesGetRow('customers', row.data.salesRecordId);
        if (!recRow || !recRow.data) {
            App.mount(`<div class="card" style="padding:32px;"><h3>このシートの営業成績の行が見つかりませんでした</h3><p class="kpi-note">営業成績のデータは変更していません。一覧から開き直してください。</p><button class="btn-primary" style="margin-top:12px;" onclick="App.navigate('sales_manage')">一覧に戻る</button></div>`);
            return;
        }
        const user = Auth.getCurrentUser();
        H = {
            id: String(row.id), sheet: row.data, rec: { ...recRow.data, id: recRow.id },
            base: {}, dirty: {}, conflicts: {}, saving: false, again: false, timer: null, retry: null,
            state: 'saved', err: '', pending: null, me: user && user.email || '', myName: user && user.name || '',
            users: [], qa: null, qaSource: '', others: []
        };
        C.SHEET_FIELDS.forEach(f => { H.base[f] = C.getField(H.sheet, f); });
        H.base['rec.lostReason'] = H.rec.lostReason || '';
        // 保存できずに端末に残っていた入力を戻す
        const draft = ls.get(draftKey(H.id)) || {};
        Object.keys(draft).forEach(f => {
            const dv = draft[f]; if (!dv || !(f in H.base)) return;
            const cur = H.base[f];
            if (same(cur, dv.val)) return;
            if (same(cur, dv.base)) H.dirty[f] = dv.val;
            else H.conflicts[f] = { theirs: cur, mine: dv.val, meta: (H.sheet.fieldMeta || {})[f] || null };
        });
        // 付随情報(失敗してもシートは使える)
        await Promise.all([
            Store.getUsers().then(us => { H.users = (us || []).map(u => u && u.name).filter(Boolean); }).catch(() => {}),
            loadQa().catch(e => console.error('qa', e)),
            Store.getAllRows(C.SERVICE_RECORD).then(res => {
                const sk = H.rec.storeKey;
                H.others = sk ? res.rows.filter(r => r.storeKey === sk && r.key !== H.rec.key).sort((a, b) => toMs(b.completedAt) - toMs(a.completedAt)) : [];
            }).catch(() => {})
        ]);
        App.mount(`<div id="hs-root" class="hs-root" data-sheet="${esc(H.id)}">${sheetHtml()}</div>${STYLE}`, () => {
            bindSheet();
            if (window.SalesBreadcrumb) window.SalesBreadcrumb('hearing_sheet', H.rec.storeName || '(店舗名なし)');
            if (Object.keys(H.dirty).length) schedule(0);
            renderState();
        });
    };

    // 分析フォームの回答: 原本(meo_form_response)を読むだけ。原本が無い(リセット済みなど)ときは、営業成績にある写しを出す
    async function loadQa() {
        const rid = H.rec.responseId;
        let orig = null, form = null;
        if (rid && /^\d+$/.test(rid)) {
            [orig, form] = await Promise.all([Store.salesGetRow('customers', rid).catch(() => null), Store.getMEOForm().catch(() => null)]);
        }
        const answers = orig && orig.data && orig.data.answers;
        if (answers && form && Array.isArray(form.questions) && form.questions.length) {
            const list = form.questions.map((q, i) => ({ n: i + 1, title: String(q.title || ''), answer: C.answerText(answers[q.id]) }));
            // 今のフォームに無い質問(削除された質問)の回答は、写しから補う
            (H.rec.qa || []).forEach(x => { if (!list.some(y => y.title === x.title) && x.answer) list.push({ n: list.length + 1, title: x.title, answer: x.answer, old: true }); });
            H.qa = list; H.qaSource = 'orig';
        } else {
            H.qa = (H.rec.qa || []).slice(); H.qaSource = 'copy';
        }
    }

    function val(f) { return f in H.dirty ? H.dirty[f] : H.base[f]; }

    function sheetHtml() {
        const r = H.rec;
        const manual = window.HearingManual ? window.HearingManual.get() : null;
        const ui = ls.get(UIKEY) || {};
        const tab = ui.tab === 'input' ? 'input' : 'manual';
        return `
            <div class="hs-message" role="note">${MESSAGE.map(l => `<div>${esc(l)}</div>`).join('')}</div>
            <div class="card hs-info" id="hs-info">${infoHtml()}</div>
            <div class="hs-tabs" role="tablist">
                <button type="button" class="hs-tab ${tab === 'manual' ? 'is-on' : ''}" data-tab="manual" onclick="hsTab('manual')"><i class="ph ph-book-open"></i> マニュアル</button>
                <button type="button" class="hs-tab ${tab === 'input' ? 'is-on' : ''}" data-tab="input" onclick="hsTab('input')"><i class="ph ph-pencil-simple-line"></i> 入力欄</button>
            </div>
            <div class="hs-cols" id="hs-cols" data-tab="${tab}">
                <section class="hs-left" id="hs-left" aria-label="商談マニュアル">${manualHtml(manual)}</section>
                <section class="hs-right" id="hs-right" aria-label="入力欄">${rightHtml()}</section>
            </div>`;
    }

    function infoHtml() {
        const r = H.rec;
        const lb = C.displayLabel(r, Date.now());
        const pg = C.progressOf({ checks: Object.fromEntries(C.SHEET_SECTIONS.map(k => [k, !!val('checks.' + k)])) });
        const pend = H.pending;
        const canRes = !!r.meetingAt && (!r.status || r.status === 'noshow');
        const statusSel = `<select id="hs-status" class="input-field hs-status" onchange="hsStatus(this.value)" ${r.excluded ? 'disabled' : ''} aria-label="成約状況">
            <option value="" ${!r.status && !pend ? 'selected' : ''}>未設定</option>
            <option value="won" ${r.status === 'won' && !pend ? 'selected' : ''} ${!r.meetingAt ? 'disabled' : ''}>成約</option>
            <option value="lost" ${r.status === 'lost' && !pend ? 'selected' : ''} ${!r.meetingAt ? 'disabled' : ''}>不成約</option>
            <option value="noshow" ${r.status === 'noshow' && !pend ? 'selected' : ''} ${!r.meetingAt ? 'disabled' : ''}>ドタキャン</option>
            <option value="reschedule" ${pend ? 'selected' : ''} ${canRes ? '' : 'disabled'}>日程変更</option></select>`;
        const meeting = r.status
            ? `<div class="hs-v">${r.meetingAt ? esc(fmtDT(r.meetingAt)) : '<span class="hm-muted">(未入力)</span>'}</div>`
            : `<input type="datetime-local" id="hs-meeting" class="input-field hs-meeting" value="${esc(toLocalInput(r.meetingAt))}" onchange="hsMeeting(this.value)" ${r.excluded ? 'disabled' : ''}>`;
        const ownerList = [...new Set([...(H.users || []), H.myName].filter(Boolean))];
        return `
            <div class="hs-info-grid">
                <div class="hs-f hs-f-store"><div class="hs-k">店舗名</div><div class="hs-v hs-store">${esc(r.storeName || '(店舗名なし)')}${r.excluded ? ' <span class="hm-badge hm-badge-ex">除外中</span>' : ''}</div></div>
                <div class="hs-f"><div class="hs-k">商談日付</div>${meeting}${!r.status && !r.meetingAt ? '<div class="hs-hint">商談日が入ると成約状況を選べます</div>' : ''}${!r.status && r.meetingAt ? '<div class="hs-hint">日程が変わった場合は『日程変更』を選んでください</div>' : ''}</div>
                <div class="hs-f"><div class="hs-k">成約状況</div>${statusSel}<div><span class="hs-label ${LABEL_CLS[lb.key]}">${lb.text}</span></div></div>
                <div class="hs-f"><div class="hs-k">商談担当者</div><input type="text" id="hs-owner" class="input-field" list="hs-owner-list" data-field="owner" value="${esc(val('owner'))}" placeholder="担当者名" autocomplete="off"><datalist id="hs-owner-list">${ownerList.map(n => `<option value="${esc(n)}">`).join('')}</datalist>${H.myName && !val('owner') ? `<button type="button" class="hs-me" onclick="hsOwnerMe()">自分(${esc(H.myName)})にする</button>` : ''}${conflictHtml('owner')}</div>
                <div class="hs-f"><div class="hs-k">進捗</div><div class="hm-pg hs-pg"><div class="hm-pg-bar"><i style="width:${pg.pct}%"></i></div><b id="hs-pct">${pg.pct}%</b><span class="hm-muted">(${pg.done}/${pg.total})</span></div></div>
                <div class="hs-f"><div class="hs-k">保存状態</div><div id="hs-save" class="hs-save" aria-live="polite"></div><div class="hs-updated" id="hs-updated">${updatedText()}</div></div>
            </div>
            ${pend ? `<div class="hs-newdate"><b>${pend === 'readjust' ? '再調整後' : '変更後'}の新しい商談日</b>
                <input type="datetime-local" id="hs-newdate" class="input-field" style="width:auto;">
                <button class="btn-primary btn-sm" onclick="hsSaveNewDate()">保存</button><button class="btn-secondary btn-sm" onclick="hsCancelNewDate()">キャンセル</button>
                <span class="kpi-mini">保存すると、元の商談日は営業成績の履歴に残り(「日程変更」として集計)、成約状況は「未設定」に戻ります。</span></div>` : ''}`;
    }
    function updatedText() {
        const s = H.sheet;
        const a = s.updatedBy && s.updatedBy !== 'system' ? `シート ${fmtDT(s.updatedAt)}(${s.updatedBy})` : 'シート まだ入力なし';
        return `最終更新: ${esc(a)}`;
    }

    function manualHtml(manual) {
        const secs = window.HearingManual ? window.HearingManual.SECTIONS : [];
        const nav = `<nav class="hs-nav" aria-label="セクション">${secs.map((s, i) => `<button type="button" class="hs-nav-btn ${val('checks.' + s.id) ? 'is-done' : ''}" data-sec="${s.id}" onclick="hsJump('${s.id}')"><i class="ph ${val('checks.' + s.id) ? 'ph-check-circle' : 'ph-circle'}"></i>${i + 1}. ${esc(s.title)}</button>`).join('')}
            <button type="button" class="hs-nav-ex" onclick="hsToggleEx()" id="hs-ex-all">回答例をすべて開く</button></nav>`;
        const body = manual ? manual.map((s, i) => `
            <div class="hs-sec" id="hs-sec-${s.id}" data-sec="${s.id}">
                <div class="hs-sec-head"><h3>${i + 1}. ${esc(s.title)}</h3>
                    <label class="hs-check ${val('checks.' + s.id) ? 'is-done' : ''}"><input type="checkbox" data-field="checks.${s.id}" ${val('checks.' + s.id) ? 'checked' : ''}> 完了</label></div>
                ${conflictHtml('checks.' + s.id)}
                ${s.blocks.map(blockHtml).join('') || '<div class="hm-muted">(このセクションの本文はありません)</div>'}
            </div>`).join('')
            : `<div class="hs-warn">商談マニュアルの本文が未設定です(js/pages/hearing_manual.js の RAW に本文を入れると表示されます)。</div>
               ${secs.map((s, i) => `<div class="hs-sec" id="hs-sec-${s.id}" data-sec="${s.id}"><div class="hs-sec-head"><h3>${i + 1}. ${esc(s.title)}</h3><label class="hs-check ${val('checks.' + s.id) ? 'is-done' : ''}"><input type="checkbox" data-field="checks.${s.id}" ${val('checks.' + s.id) ? 'checked' : ''}> 完了</label></div>${conflictHtml('checks.' + s.id)}</div>`).join('')}`;
        return nav + `<div class="hs-manual">${body}</div>`;
    }
    function blockHtml(b) {
        const text = b.lines.map(l => esc(l)).join('<br>');
        if (b.type === 'ex') return `<details class="hs-b hs-b-ex"><summary>${esc(b.label)}<span class="hs-ex-hint">(クリックで開閉)</span></summary><div class="hs-b-text">${text}</div></details>`;
        if (b.type === 'branch') return `<div class="hs-b hs-b-branch">${esc(b.label)}${text ? `<div class="hs-b-text">${text}</div>` : ''}</div>`;
        if (b.type === 'text') return `<div class="hs-b hs-b-plain"><div class="hs-b-text">${text}</div></div>`;
        const go = b.type === 'q' && b.field ? `<button type="button" class="hs-go" onclick="hsGoField('${b.field}', '${b.qid}')" title="右側の入力欄へ移動">入力欄「${esc((NOTES.find(n => n.k === b.field) || {}).label || '')}」へ <i class="ph ph-arrow-right"></i></button>` : '';
        return `<div class="hs-b hs-b-${b.type}" ${b.qid ? `id="${b.qid}" data-field-target="${b.field || ''}"` : ''}>${b.label ? `<span class="hs-b-label">${esc(b.label)}</span>` : ''}<div class="hs-b-text">${text}</div>${go}</div>`;
    }

    function rightHtml() {
        const r = H.rec;
        const notes = NOTES.map(n => `
            <div class="hs-note" id="hs-note-${n.k}">
                <div class="hs-note-head"><label for="hs-in-${n.k}">${esc(n.label)}</label><button type="button" class="hs-back-q" onclick="hsGoQuestion('${n.k}')" title="マニュアルの該当する質問へ"><i class="ph ph-arrow-left"></i> マニュアルの質問へ</button></div>
                <textarea id="hs-in-${n.k}" class="input-field hs-ta" data-field="notes.${n.k}" rows="5" placeholder="${esc(n.label)}を入力">${esc(val('notes.' + n.k))}</textarea>
                ${conflictHtml('notes.' + n.k)}
            </div>`).join('');
        let result = '';
        if (r.status === 'won') {
            result = `<div class="hs-row"><label>成約プラン<select class="input-field" onchange="hsPlan(this.value)"><option value="">成約プランを選択</option>${C.PLANS.map(p => `<option ${r.plan === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
                <label>成約日<input type="date" class="input-field" value="${esc(r.wonDate)}" onchange="hsWonDate(this.value)"></label></div>`;
        } else if (r.status === 'lost') {
            result = `<div class="hs-row"><label>不成約理由<select class="input-field" id="hs-lostcat" onchange="hsLostCat(this.value)"><option value="">理由を選択</option>${C.LOST_CATEGORIES.map(c => `<option ${r.lostCategory === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label></div>
                <label class="hs-lbl">${r.lostCategory === 'その他' ? 'その他の理由(自由入力)' : '詳しい理由・メモ(任意)'}<textarea id="hs-lostreason" class="input-field hs-ta-s" data-field="rec.lostReason" rows="3" placeholder="${r.lostCategory === 'その他' ? '理由を入力してください' : '補足があれば入力'}">${esc(val('rec.lostReason'))}</textarea></label>
                ${conflictHtml('rec.lostReason')}
                <div class="kpi-mini">不成約理由は営業成績にも同じ内容が保存されます。</div>`;
        } else if (r.status === 'noshow') {
            result = `<div class="kpi-mini">ドタキャンです。次回アクション・次回連絡予定日を入力しておきましょう。新しい日程が決まったら、成約状況で「日程変更」を選んで新しい商談日を入れてください。</div>`;
        }
        const qa = H.qa && H.qa.length ? `<dl class="hs-qa">${H.qa.map(x => `<dt>Q${x.n}. ${esc(x.title)}${x.old ? ' <span class="hm-muted">(今のフォームに無い質問)</span>' : ''}</dt><dd>${esc(x.answer) || '<span class="hm-muted">(回答なし)</span>'}</dd>`).join('')}</dl>
            <div class="kpi-mini">${H.qaSource === 'orig' ? '分析フォームの回答(原本)を表示しています。ここからは変更できません。' : '分析フォームの原本が見つからないため、営業成績に保存してある回答の写しを表示しています。'}</div>`
            : '<div class="hm-muted">分析フォームの回答はありません。</div>';
        const others = H.others.length ? `<div class="card hs-card"><div class="hs-card-title"><i class="ph ph-clock-counter-clockwise"></i> この店舗のほかの商談(${H.others.length}件)</div>
            <ul class="hs-others">${H.others.map(o => `<li><button class="hm-link" onclick="App.navigate('hearing_sheet', {salesKey: '${esc(o.key)}'})">${esc(fmtDT(o.completedAt))} 申込</button> ・ 商談日 ${o.meetingAt ? esc(fmtDT(o.meetingAt)) : '(未入力)'} ・ ${esc(C.displayLabel(o, Date.now()).text)}</li>`).join('')}</ul></div>` : '';
        const qaOpen = (ls.get(UIKEY) || {}).qa !== false;
        return `
            <div class="card hs-card"><div class="hs-card-title"><i class="ph ph-notepad"></i> ヒアリング内容</div>${notes}</div>
            <div class="card hs-card" id="hs-result"><div class="hs-card-title"><i class="ph ph-flag"></i> 結果・次回</div>
                ${result}
                <label class="hs-lbl">次回アクション<textarea id="hs-next" class="input-field hs-ta-s" data-field="nextAction" rows="3" placeholder="例: 見積もりを送る / 再提案の資料を用意する">${esc(val('nextAction'))}</textarea></label>
                ${conflictHtml('nextAction')}
                <label class="hs-lbl">次回連絡予定日<input type="date" id="hs-nextdate" class="input-field" data-field="nextContactDate" value="${esc(val('nextContactDate'))}" style="width:auto;"></label>
                ${conflictHtml('nextContactDate')}
            </div>
            <details class="card hs-card hs-qa-card" ${qaOpen ? 'open' : ''} ontoggle="hsQaToggle(this.open)"><summary class="hs-card-title"><i class="ph ph-list-checks"></i> 分析フォームの回答(読み取り専用)</summary>${qa}</details>
            ${others}`;
    }

    function conflictHtml(f) {
        const c = H.conflicts[f];
        if (!c) return '';
        const show = (v) => typeof v === 'boolean' ? (v ? '完了' : '未完了') : (String(v == null ? '' : v) || '(空欄)');
        return `<div class="hs-conflict" data-conflict="${esc(f)}">
            <div><b>ほかの人(または別の画面)が、この欄を先に更新していました。</b>${c.meta && c.meta.by ? `(${esc(c.meta.by)} ${esc(fmtDT(c.meta.at))})` : ''} あなたの入力はまだ保存していません。</div>
            <div class="hs-conflict-theirs"><span>保存されている内容:</span><div>${esc(show(c.theirs))}</div></div>
            <div class="hs-conflict-mine"><span>あなたの入力:</span><div>${esc(show(c.mine))}</div></div>
            <div class="hs-btns"><button type="button" class="btn-secondary btn-sm" onclick="hsResolve('${esc(f)}', 'theirs')">保存されている内容を使う</button><button type="button" class="btn-primary btn-sm" onclick="hsResolve('${esc(f)}', 'mine')">あなたの入力で上書きする</button></div>
        </div>`;
    }

    // ---------- 画面の操作 ----------
    function bindSheet() {
        const root = document.getElementById('hs-root');
        if (!root) return;
        // 入力欄(文字): 入力が止まって0.8秒後 / 欄から離れたとき に保存
        root.addEventListener('input', (e) => {
            const f = e.target && e.target.getAttribute('data-field');
            if (!f || e.target.type === 'checkbox') return;
            onChange(f, e.target.value, 800);
        });
        root.addEventListener('change', (e) => {
            const f = e.target && e.target.getAttribute('data-field');
            if (!f) return;
            if (e.target.type === 'checkbox') { onChange(f, !!e.target.checked, 0); refreshChecks(); }
            else onChange(f, e.target.value, 0);
        });
        root.addEventListener('focusout', (e) => {
            const f = e.target && e.target.getAttribute && e.target.getAttribute('data-field');
            if (f && f in H.dirty) schedule(0);
        });
        // スクロール位置を覚える(左右それぞれ)
        const L = document.getElementById('hs-left'), R = document.getElementById('hs-right');
        const saved = ls.get(scrollKey(H.id));
        let st = null;
        const remember = () => { clearTimeout(st); st = setTimeout(() => ls.set(scrollKey(H.id), { l: L.scrollTop, r: R.scrollTop, p: (document.getElementById('page-content') || {}).scrollTop || 0 }), 200); };
        L.addEventListener('scroll', remember, { passive: true });
        R.addEventListener('scroll', remember, { passive: true });
        fitHeight();
        window.removeEventListener('resize', fitHeight);
        window.addEventListener('resize', fitHeight);
        if (saved) { L.scrollTop = saved.l || 0; R.scrollTop = saved.r || 0; }
        // ページを閉じる・再読み込みするとき: 未保存があれば端末に残し、送信も試みる
        window.onbeforeunload = () => {
            if (!H || !document.getElementById('hs-root')) return undefined;
            if (Object.keys(H.dirty).length) { writeDraft(); flush(); return '保存中の入力があります。'; }
            return undefined;
        };
        if (sheetTimer) clearInterval(sheetTimer);
        sheetTimer = setInterval(() => {
            if (!document.getElementById('hs-root')) { clearInterval(sheetTimer); sheetTimer = null; return; }
            if (document.visibilityState && document.visibilityState !== 'visible') return;
            refreshFromServer().catch(e => console.error('sheet refresh', e));
        }, 20000);
    }

    // 左右の欄の高さを、画面の残りの高さに合わせる(それぞれが別々にスクロールする)
    function fitHeight() {
        const cols = document.getElementById('hs-cols');
        const pc = document.getElementById('page-content');
        if (!cols || !pc) { window.removeEventListener('resize', fitHeight); return; }
        if (window.innerWidth <= 900) { cols.style.height = ''; return; }
        const top = cols.getBoundingClientRect().top - pc.getBoundingClientRect().top + pc.scrollTop;
        const h = Math.max(460, pc.clientHeight - top - 24);
        cols.style.height = h + 'px';
    }

    function onChange(f, v, delay) {
        if (!H) return;
        if (H.conflicts[f]) { H.conflicts[f].mine = v; return; }   // 競合の解決待ち: 選んでもらうまで保存しない
        if (same(v, H.base[f])) delete H.dirty[f]; else H.dirty[f] = v;
        writeDraft();
        H.state = Object.keys(H.dirty).length ? 'dirty' : H.state;
        renderState();
        schedule(delay);
    }
    function schedule(delay) {
        clearTimeout(H.timer);
        H.timer = setTimeout(() => flush(), delay);
    }
    function writeDraft() {
        if (!H) return;
        const d = {};
        Object.keys(H.dirty).forEach(f => { d[f] = { val: H.dirty[f], base: H.base[f] }; });
        if (Object.keys(d).length) ls.set(draftKey(H.id), d); else ls.del(draftKey(H.id));
    }

    // 保存(シートの欄 と 営業成績の不成約理由の文章)
    async function flush() {
        const h = H;
        if (!h) return;
        if (h.saving) { h.again = true; return; }
        const fields = Object.keys(h.dirty);
        if (!fields.length) { if (h.state === 'dirty') { h.state = 'saved'; renderState(); } return; }
        h.saving = true; h.state = 'saving'; renderState();
        clearTimeout(h.retry);
        const sent = {};
        fields.forEach(f => { sent[f] = h.dirty[f]; });
        try {
            const sheetFields = fields.filter(f => !f.startsWith('rec.'));
            if (sheetFields.length) {
                const row = await Store.salesGetRow('customers', h.id);
                if (!row || !row.data) throw new Error('シートが見つかりませんでした。');
                const changes = {};
                sheetFields.forEach(f => { changes[f] = { base: h.base[f], val: sent[f] }; });
                const m = C.mergeSheet(row.data, changes, h.me, Date.now());
                let latest = row.data;
                if (m.changed) {
                    await Store.salesUpdateData('customers', h.id, m.data);
                    const again = await Store.salesGetRow('customers', h.id);
                    if (!again || !again.data || m.saved.some(f => !same(C.getField(again.data, f), sent[f]))) throw new Error('保存した内容を確認できませんでした。');
                    latest = again.data;
                }
                m.saved.forEach(f => { h.base[f] = sent[f]; if (same(h.dirty[f], sent[f])) delete h.dirty[f]; });
                m.conflicts.forEach(c => { h.conflicts[c.field] = { theirs: c.theirs, mine: h.dirty[c.field] !== undefined ? h.dirty[c.field] : c.mine, meta: c.meta }; delete h.dirty[c.field]; });
                applyLatestSheet(h, latest);
                if (m.conflicts.length) rerenderConflicts(m.conflicts.map(c => c.field));
            }
            if ('rec.lostReason' in sent) await saveLostReason(h, sent['rec.lostReason']);
            writeDraft();
            h.state = Object.keys(h.conflicts).length ? 'conflict' : (Object.keys(h.dirty).length ? 'dirty' : 'saved');
            h.err = '';
        } catch (e) {
            console.error('sheet save', e);
            h.state = 'error'; h.err = e.message || '保存に失敗しました。';
            writeDraft();
            h.retry = setTimeout(() => flush(), 10000);   // 10秒後に送り直す
        } finally {
            h.saving = false;
            if (H === h) renderState();
            if (h.again) { h.again = false; if (Object.keys(h.dirty).length) schedule(300); }
        }
    }
    // 最新のシートの内容を画面に反映(自分がまだ保存していない欄・入力中の欄はそのまま)
    function applyLatestSheet(h, latest) {
        h.sheet = latest;
        C.SHEET_FIELDS.forEach(f => {
            const sv = C.getField(latest, f);
            if (same(sv, h.base[f])) return;
            if (f in h.dirty || h.conflicts[f]) return;   // 自分がまだ保存していない欄は、そのまま(保存時に競合を確認する)
            h.base[f] = sv;
            if (H !== h) return;
            const el = document.querySelector(`#hs-root [data-field="${f}"]`);
            if (el) { if (el.type === 'checkbox') el.checked = !!sv; else el.value = sv == null ? '' : sv; }
        });
        if (H === h) { refreshChecks(); const u = document.getElementById('hs-updated'); if (u) u.innerHTML = updatedText(); }
    }
    function rerenderConflicts(fields) {
        fields.forEach(f => {
            const el = document.querySelector(`#hs-root [data-field="${f}"]`);
            if (!el) return;
            const old = document.querySelector(`#hs-root [data-conflict="${CSS.escape(f)}"]`);
            if (old) old.remove();
            const holder = el.closest('.hs-note, .hs-f, .hs-sec, .hs-lbl') || el.parentElement;
            const div = document.createElement('div');
            div.innerHTML = conflictHtml(f);
            const box = div.firstElementChild;
            if (!box) return;
            if (holder.classList.contains('hs-sec')) holder.querySelector('.hs-sec-head').after(box);
            else if (holder.classList.contains('hs-lbl')) holder.after(box);
            else holder.appendChild(box);
        });
    }
    window.hsResolve = (f, which) => {
        if (!H || !H.conflicts[f]) return;
        const c = H.conflicts[f];
        delete H.conflicts[f];
        H.base[f] = c.theirs;
        const el = document.querySelector(`#hs-root [data-field="${f}"]`);
        if (which === 'theirs') {
            delete H.dirty[f];
            if (el) { if (el.type === 'checkbox') el.checked = !!c.theirs; else el.value = c.theirs == null ? '' : c.theirs; }
        } else {
            H.dirty[f] = c.mine;
            if (el) { if (el.type === 'checkbox') el.checked = !!c.mine; else el.value = c.mine == null ? '' : c.mine; }
        }
        const box = document.querySelector(`#hs-root [data-conflict="${CSS.escape(f)}"]`);
        if (box) box.remove();
        writeDraft(); refreshChecks();
        H.state = Object.keys(H.conflicts).length ? 'conflict' : 'saved';
        renderState();
        schedule(0);
    };

    // 営業成績の行への保存(成約状況など)。営業成績の画面と同じ SalesCore.applyAction を使う。
    //   保存直前に最新を読み、その操作に関係する項目をほかの人が先に変えていたら保存しない(最新を表示し直す)
    const GUARD = {
        setStatus: ['status', 'meetingAt'], reschedule: ['status', 'meetingAt'], readjust: ['status', 'meetingAt'], setMeeting: ['status', 'meetingAt'],
        setPlan: ['plan', 'status'], setWonDate: ['wonDate', 'status'], setLostCategory: ['lostCategory', 'status'], setLostReason: ['lostReason']
    };
    async function recAct(action, payload) {
        const h = H;
        if (!h) return false;
        h.state = 'saving'; renderState();
        try {
            const row = await Store.salesGetRow('customers', h.rec.id);
            if (!row || !row.data) throw new Error('営業成績の行が見つかりませんでした。');
            const latest = row.data;
            const changedByOthers = (GUARD[action] || []).some(k => !same(latest[k], h.rec[k]));
            if (changedByOthers) {
                h.rec = { ...latest, id: h.rec.id }; h.pending = null;
                rerenderRec();
                h.state = 'saved'; renderState();
                alert('この商談は、ほかの人(または営業成績の画面)が先に更新していました。最新の内容を表示し直したので、必要ならもう一度操作してください。');
                return false;
            }
            const r = C.applyAction(latest, action, payload, h.me, Date.now());
            if (r.error) { alert(r.error); rerenderRec(); h.state = 'saved'; renderState(); return false; }
            if (JSON.stringify(r.data) !== JSON.stringify(latest)) {
                await Store.salesUpdateData('customers', h.rec.id, r.data);
                const again = await Store.salesGetRow('customers', h.rec.id);
                if (!again || !again.data || again.data.updatedAt !== r.data.updatedAt) throw new Error('保存した内容を確認できませんでした。通信状態を確認して、再読み込みしてください。');
                h.rec = { ...again.data, id: h.rec.id };
                // 自動タスク(前日・当日)を作り直す(失敗しても次にダッシュボードを開いたときに作られる)
                if (window.SalesTaskSync) window.SalesTaskSync().catch(e => console.error(e));
            } else h.rec = { ...latest, id: h.rec.id };
            h.pending = null;
            rerenderRec();
            h.state = Object.keys(h.dirty).length ? 'dirty' : 'saved'; h.err = ''; renderState();
            return true;
        } catch (e) {
            console.error('sales save', e);
            h.state = 'error'; h.err = e.message || '保存に失敗しました。'; renderState();
            alert(h.err);
            rerenderRec();
            return false;
        }
    }
    async function saveLostReason(h, text) {
        const row = await Store.salesGetRow('customers', h.rec.id);
        if (!row || !row.data) throw new Error('営業成績の行が見つかりませんでした。');
        const cur = row.data.lostReason || '';
        if (same(cur, text)) { h.base['rec.lostReason'] = text; if (same(h.dirty['rec.lostReason'], text)) delete h.dirty['rec.lostReason']; h.rec = { ...row.data, id: h.rec.id }; return; }
        if (!same(cur, h.base['rec.lostReason'])) {
            h.conflicts['rec.lostReason'] = { theirs: cur, mine: h.dirty['rec.lostReason'] !== undefined ? h.dirty['rec.lostReason'] : text, meta: null };
            delete h.dirty['rec.lostReason'];
            h.rec = { ...row.data, id: h.rec.id };
            rerenderConflicts(['rec.lostReason']);
            return;
        }
        const r = C.applyAction(row.data, 'setLostReason', { reason: text }, h.me, Date.now());
        if (r.error) throw new Error(r.error);
        await Store.salesUpdateData('customers', h.rec.id, r.data);
        const again = await Store.salesGetRow('customers', h.rec.id);
        if (!again || !again.data || again.data.updatedAt !== r.data.updatedAt) throw new Error('保存した内容を確認できませんでした。');
        h.rec = { ...again.data, id: h.rec.id };
        h.base['rec.lostReason'] = text;
        if (same(h.dirty['rec.lostReason'], text)) delete h.dirty['rec.lostReason'];
    }
    // 営業成績の行が変わったとき: 上部の情報と「結果・次回」を描き直す(入力中の欄はそのまま)
    function rerenderRec() {
        if (!H) return;
        if (!('rec.lostReason' in H.dirty) && !H.conflicts['rec.lostReason']) H.base['rec.lostReason'] = H.rec.lostReason || '';
        const info = document.getElementById('hs-info');
        if (info) {
            const a = document.activeElement;
            const keepOwner = a && a.id === 'hs-owner';
            if (!keepOwner) info.innerHTML = infoHtml();
        }
        const res = document.getElementById('hs-result');
        const a = document.activeElement;
        if (res && !(a && res.contains(a))) {
            const tmp = document.createElement('div');
            tmp.innerHTML = rightHtml();
            const fresh = tmp.querySelector('#hs-result');
            if (fresh) res.replaceWith(fresh);
        }
        renderState();
        if (window.SalesBreadcrumb) window.SalesBreadcrumb('hearing_sheet', H.rec.storeName || '(店舗名なし)');
    }
    // 開いている間、約20秒ごとに最新を読み直す(ほかの人の入力・営業成績の画面での変更を反映)
    async function refreshFromServer() {
        const h = H;
        if (!h || h.saving) return;
        const [row, recRow] = await Promise.all([Store.salesGetRow('customers', h.id), Store.salesGetRow('customers', h.rec.id)]);
        if (H !== h) return;
        if (row && row.data) applyLatestSheet(h, row.data);
        if (recRow && recRow.data && recRow.data.updatedAt !== h.rec.updatedAt && !h.pending) {
            h.rec = { ...recRow.data, id: h.rec.id };
            rerenderRec();
        }
    }

    function refreshChecks() {
        if (!H) return;
        C.SHEET_SECTIONS.forEach(k => {
            const on = !!val('checks.' + k);
            document.querySelectorAll(`#hs-root .hs-nav-btn[data-sec="${k}"]`).forEach(b => { b.classList.toggle('is-done', on); const i = b.querySelector('i'); if (i) i.className = `ph ${on ? 'ph-check-circle' : 'ph-circle'}`; });
            document.querySelectorAll(`#hs-root input[data-field="checks.${k}"]`).forEach(c => { c.checked = on; const l = c.closest('.hs-check'); if (l) l.classList.toggle('is-done', on); });
        });
        const pg = C.progressOf({ checks: Object.fromEntries(C.SHEET_SECTIONS.map(k => [k, !!val('checks.' + k)])) });
        const bar = document.querySelector('#hs-info .hs-pg .hm-pg-bar i'); if (bar) bar.style.width = pg.pct + '%';
        const p = document.getElementById('hs-pct'); if (p) p.textContent = pg.pct + '%';
        const n = document.querySelector('#hs-info .hs-pg .hm-muted'); if (n) n.textContent = `(${pg.done}/${pg.total})`;
    }
    function renderState() {
        const el = document.getElementById('hs-save');
        if (!el || !H) return;
        const map = {
            saving: ['hs-st-saving', 'ph-spinner ph-spin', '保存中…'],
            dirty: ['hs-st-saving', 'ph-pencil-simple', '入力中(自動で保存します)'],
            saved: ['hs-st-saved', 'ph-check-circle', '保存済み'],
            error: ['hs-st-error', 'ph-warning', '保存エラー'],
            conflict: ['hs-st-error', 'ph-warning', '確認が必要な欄があります']
        };
        const [cls, icon, text] = map[H.state] || map.saved;
        el.className = `hs-save ${cls}`;
        el.setAttribute('data-state', H.state);
        el.innerHTML = `<i class="ph ${icon}"></i> ${text}${H.state === 'error' ? `<div class="hs-save-err">${esc(H.err)}(この端末に一時保管し、自動で送り直します)</div>` : ''}`;
    }

    window.hsTab = (t) => {
        const cols = document.getElementById('hs-cols'); if (cols) cols.setAttribute('data-tab', t);
        document.querySelectorAll('#hs-root .hs-tab').forEach(b => b.classList.toggle('is-on', b.getAttribute('data-tab') === t));
        const ui = ls.get(UIKEY) || {}; ui.tab = t; ls.set(UIKEY, ui);
    };
    window.hsQaToggle = (open) => { const ui = ls.get(UIKEY) || {}; ui.qa = !!open; ls.set(UIKEY, ui); };
    // 片側の欄の中だけをスクロールする(もう片方・ページ全体は動かさない)
    function scrollInside(box, el) {
        if (!box || !el) return;
        const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 8;
        box.scrollTo({ top, behavior: 'smooth' });
    }
    const flash = (el) => { if (!el) return; el.classList.remove('hs-flash'); void el.offsetWidth; el.classList.add('hs-flash'); };
    window.hsJump = (sec) => {
        if (window.innerWidth <= 900) window.hsTab('manual');
        const el = document.getElementById('hs-sec-' + sec);
        if (window.innerWidth <= 900) { if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        else scrollInside(document.getElementById('hs-left'), el);
        flash(el);
    };
    window.hsGoField = (k) => {
        const note = document.getElementById('hs-note-' + k);
        const ta = document.getElementById('hs-in-' + k);
        if (window.innerWidth <= 900) { window.hsTab('input'); if (note) note.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        else scrollInside(document.getElementById('hs-right'), note);
        flash(note);
        if (ta) setTimeout(() => ta.focus({ preventScroll: true }), 50);
    };
    window.hsGoQuestion = (k) => {
        const q = document.querySelector(`#hs-left [data-field-target="${k}"]`);
        if (!q) { alert('この入力欄に対応する質問がマニュアルにありません。'); return; }
        if (window.innerWidth <= 900) { window.hsTab('manual'); q.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        else scrollInside(document.getElementById('hs-left'), q);
        flash(q);
    };
    window.hsToggleEx = () => {
        const all = [...document.querySelectorAll('#hs-left details.hs-b-ex')];
        const open = !all.every(d => d.open);
        all.forEach(d => { d.open = open; });
        const b = document.getElementById('hs-ex-all'); if (b) b.textContent = open ? '回答例をすべて閉じる' : '回答例をすべて開く';
    };
    window.hsStatus = (v) => {
        if (!H) return;
        if (v === 'reschedule') { H.pending = H.rec.status === 'noshow' ? 'readjust' : 'reschedule'; rerenderRec(); return; }
        H.pending = null;
        recAct('setStatus', { status: v });
    };
    window.hsCancelNewDate = () => { if (!H) return; H.pending = null; rerenderRec(); };
    window.hsSaveNewDate = () => {
        if (!H) return;
        const inp = document.getElementById('hs-newdate');
        const at = inp ? fromLocalInput(inp.value) : null;
        if (!at) { alert('新しい商談日(日時)を入力してください。'); return; }
        recAct(H.pending === 'readjust' ? 'readjust' : 'reschedule', { at });
    };
    window.hsOwnerMe = () => {
        const el = document.getElementById('hs-owner');
        if (!el || !H) return;
        el.value = H.myName;
        onChange('owner', H.myName, 0);
        const b = document.querySelector('#hs-root .hs-me'); if (b) b.remove();
    };
    window.hsMeeting = (v) => recAct('setMeeting', { at: v ? fromLocalInput(v) : null });
    window.hsPlan = (v) => recAct('setPlan', { plan: v });
    window.hsWonDate = (v) => recAct('setWonDate', { date: v });
    window.hsLostCat = (v) => recAct('setLostCategory', { category: v });

    // テスト用に中身を公開(画面の動作には使わない)
    window.HearingInternals = { get H() { return H; }, flush, refreshFromServer, M, MUI, loadAll };

    const STYLE = `<style>
        .hs-warn { padding: 12px 16px; margin-bottom: 12px; border-left: 4px solid #F59F00; background: #FFF9DB; border-radius: 8px; font-size: 0.85rem; line-height: 1.7; }
        .hm-card { padding: 16px 18px; }
        .hm-tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--border-light, #e9ecef); margin-bottom: 12px; flex-wrap: wrap; }
        .hm-tab { border: none; background: none; padding: 10px 14px; font-size: 0.95rem; font-weight: 700; color: var(--text-secondary); cursor: pointer; border-bottom: 3px solid transparent; font-family: inherit; display: inline-flex; align-items: center; gap: 6px; }
        .hm-tab.is-on { color: var(--text-primary); border-bottom-color: var(--primary, #111); }
        .hm-n { background: #F1F3F5; border-radius: 10px; padding: 0 8px; font-size: 0.75rem; }
        .hm-filters { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
        .hm-filters .input-field { width: auto; min-width: 180px; margin: 0; height: 38px; padding: 6px 10px; font-size: 0.9rem; box-sizing: border-box; }
        .hm-check { font-size: 0.85rem; display: inline-flex; gap: 6px; align-items: center; }
        .hm-table-wrap { overflow-x: auto; }
        .hm-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
        .hm-table th { text-align: left; font-size: 0.78rem; color: var(--text-secondary); padding: 8px; border-bottom: 1px solid var(--border-light, #e9ecef); white-space: nowrap; }
        .hm-table td { padding: 10px 8px; border-bottom: 1px solid var(--border-light, #f1f3f5); vertical-align: middle; }
        .hm-table tr.hm-today td { background: #FFF9DB; }
        .hm-table tr.hm-ex td { opacity: 0.55; }
        .hm-nowrap { white-space: nowrap; }
        .hm-muted { color: #868E96; font-size: 0.82rem; }
        .hm-empty { text-align: center; color: #868E96; padding: 24px !important; }
        .hm-link { background: none; border: none; padding: 0; color: #1C7ED6; font-weight: 700; cursor: pointer; text-align: left; font-family: inherit; font-size: inherit; }
        .hm-link:hover { text-decoration: underline; }
        .hm-badge { display: inline-block; font-size: 0.7rem; padding: 1px 6px; border-radius: 6px; background: #E7F5FF; color: #1971C2; font-weight: 700; }
        .hm-badge-ex { background: #F1F3F5; color: #495057; }
        .hm-badge-today { background: #FFE066; color: #5C3D00; }
        .hm-pg { display: inline-flex; align-items: center; gap: 6px; }
        .hm-pg-bar { width: 70px; height: 8px; background: #E9ECEF; border-radius: 4px; overflow: hidden; }
        .hm-pg-bar i { display: block; height: 100%; background: #37B24D; }
        .hm-extra { font-size: 0.82rem; max-width: 320px; }
        .hm-foot { margin-top: 10px; }
        .hs-label { display: inline-block; font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; background: #F1F3F5; color: #495057; margin-top: 4px; }
        .hs-lb-won { background: #D3F9D8; color: #2B8A3E; } .hs-lb-lost { background: #FFE3E3; color: #C92A2A; } .hs-lb-noshow { background: #FFF3BF; color: #8F5B00; }
        .hs-lb-plan { background: #E7F5FF; color: #1971C2; } .hs-lb-adj { background: #F1F3F5; color: #495057; } .hs-lb-miss { background: #FFE8CC; color: #D9480F; }

        .hs-message { background: #fff; color: #E03131; font-weight: 800; font-size: 1.3rem; line-height: 1.55; padding: 14px 20px; border: 2px solid #FFC9C9; border-radius: 12px; margin-bottom: 12px; letter-spacing: 0.02em; }
        .hs-info { padding: 12px 16px; margin-bottom: 12px; }
        .hs-info-grid { display: grid; grid-template-columns: minmax(180px, 1.4fr) minmax(200px, 1.2fr) minmax(150px, 1fr) minmax(160px, 1fr) minmax(130px, 0.8fr) minmax(170px, 1fr); gap: 12px 16px; align-items: start; }
        .hs-k { font-size: 0.72rem; color: var(--text-secondary); font-weight: 700; margin-bottom: 4px; }
        .hs-v { font-weight: 700; }
        .hs-store { font-size: 1.15rem; word-break: break-word; }
        .hs-info .input-field { margin: 0; padding: 6px 8px; font-size: 0.9rem; width: 100%; box-sizing: border-box; }
        .hs-status { font-weight: 700; }
        .hs-me { border: none; background: none; color: #1C7ED6; font-size: 0.72rem; cursor: pointer; padding: 2px 0; font-family: inherit; text-decoration: underline; }
        .hs-hint { font-size: 0.7rem; color: #868E96; margin-top: 3px; }
        .hs-save { font-size: 0.85rem; font-weight: 700; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
        .hs-st-saved { color: #2B8A3E; } .hs-st-saving { color: #1971C2; } .hs-st-error { color: #C92A2A; }
        .hs-save-err { width: 100%; font-size: 0.72rem; font-weight: 500; }
        .hs-updated { font-size: 0.7rem; color: #868E96; margin-top: 3px; word-break: break-all; }
        .hs-newdate { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; padding: 10px; background: #F8F9FA; border-radius: 8px; }
        .hs-tabs { display: none; }
        .hs-cols { display: grid; grid-template-columns: 45fr 55fr; gap: 16px; min-height: 460px; }
        .hs-left, .hs-right { overflow-y: auto; overscroll-behavior: contain; min-height: 0; border-radius: 12px; }
        .hs-left { background: #fff; border: 1px solid var(--border-light, #e9ecef); padding: 0 16px 24px; }
        .hs-right { padding-right: 4px; }
        .hs-nav { position: sticky; top: 0; z-index: 2; background: #fff; display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 16px 10px; margin: 0 -16px 8px; border-bottom: 1px solid var(--border-light, #e9ecef); }
        .hs-nav-btn { border: 1px solid #DEE2E6; background: #fff; border-radius: 16px; padding: 4px 10px; font-size: 0.78rem; cursor: pointer; font-family: inherit; display: inline-flex; align-items: center; gap: 4px; }
        .hs-nav-btn.is-done { background: #EBFBEE; border-color: #8CE99A; color: #2B8A3E; font-weight: 700; }
        .hs-nav-ex { border: none; background: none; color: #868E96; font-size: 0.75rem; cursor: pointer; text-decoration: underline; margin-left: auto; font-family: inherit; }
        .hs-sec { padding: 12px 0 8px; border-bottom: 1px dashed #DEE2E6; }
        .hs-sec-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
        .hs-sec-head h3 { font-size: 1.05rem; margin: 0; }
        .hs-check { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem; font-weight: 700; padding: 4px 10px; border: 1px solid #DEE2E6; border-radius: 16px; cursor: pointer; white-space: nowrap; }
        .hs-check.is-done { background: #EBFBEE; border-color: #8CE99A; color: #2B8A3E; }
        .hs-check input { width: 16px; height: 16px; margin: 0; }
        .hs-b { border-radius: 10px; padding: 10px 12px; margin: 8px 0; line-height: 1.75; font-size: 0.95rem; border: 1px solid transparent; }
        .hs-b-label { display: inline-block; font-size: 0.75rem; font-weight: 800; padding: 1px 8px; border-radius: 8px; margin-bottom: 4px; }
        .hs-b-text { word-break: break-word; }
        .hs-b-ura { background: #E7F5FF; border-color: #A5D8FF; color: #1864AB; font-weight: 700; }
        .hs-b-ura .hs-b-label { background: #1C7ED6; color: #fff; }
        .hs-b-q { background: #FFF4E6; border: 2px solid #FF922B; color: #D9480F; font-weight: 800; font-size: 1.02rem; box-shadow: 0 2px 6px rgba(255, 146, 43, 0.18); }
        .hs-b-q .hs-b-label { background: #F76707; color: #fff; }
        .hs-b-ref { background: #FFF9F2; border: 1px dashed #FFC078; color: #9C4A14; font-size: 0.9rem; }
        .hs-b-ref .hs-b-label { background: #FFE8CC; color: #D9480F; }
        .hs-b-ans { background: #F1F3F5; border-color: #DEE2E6; color: #495057; }
        .hs-b-ans .hs-b-label { background: #868E96; color: #fff; }
        .hs-b-ex { background: #F8F9FA; border-color: #E9ECEF; color: #868E96; font-size: 0.88rem; padding: 6px 12px; }
        .hs-b-ex summary { cursor: pointer; font-weight: 700; font-size: 0.8rem; color: #868E96; }
        .hs-ex-hint { font-weight: 400; margin-left: 6px; font-size: 0.72rem; }
        .hs-b-ex .hs-b-text { margin-top: 4px; }
        .hs-b-note { background: #FFF9DB; border-color: #FFEC99; color: #5C3D00; font-size: 0.88rem; }
        .hs-b-note .hs-b-label { background: none; color: #5C3D00; padding: 0; margin-right: 4px; }
        .hs-b-branch { font-weight: 800; color: #495057; padding: 6px 0 0; margin-bottom: 0; }
        .hs-b-plain { padding: 2px 4px; }
        .hs-go { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; border: 1px solid #FFA94D; background: #fff; color: #D9480F; border-radius: 14px; padding: 2px 10px; font-size: 0.75rem; font-weight: 700; cursor: pointer; font-family: inherit; }
        .hs-go:hover { background: #FFE8CC; }
        .hs-card { padding: 14px 16px; margin-bottom: 12px; }
        .hs-card-title { font-weight: 800; font-size: 0.95rem; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; cursor: default; }
        details.hs-card > summary { cursor: pointer; list-style: revert; }
        .hs-note { margin-bottom: 14px; border-radius: 10px; }
        .hs-note-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 4px; }
        .hs-note-head label { font-weight: 800; font-size: 0.95rem; }
        .hs-back-q { border: none; background: none; color: #D9480F; font-size: 0.75rem; cursor: pointer; font-family: inherit; white-space: nowrap; }
        .hs-ta { width: 100%; min-height: 130px; font-size: 1rem; line-height: 1.7; resize: vertical; margin: 0; }
        .hs-ta-s { width: 100%; min-height: 80px; font-size: 0.95rem; line-height: 1.6; resize: vertical; margin: 4px 0 0; }
        .hs-lbl { display: block; font-weight: 700; font-size: 0.85rem; margin: 10px 0 2px; }
        .hs-lbl .input-field { font-weight: 400; }
        .hs-row { display: flex; gap: 12px; flex-wrap: wrap; }
        .hs-row label { display: flex; flex-direction: column; font-weight: 700; font-size: 0.85rem; gap: 4px; }
        .hs-row .input-field { margin: 0; width: auto; min-width: 200px; }
        .hs-qa dt { font-weight: 700; font-size: 0.82rem; color: var(--text-secondary); margin-top: 8px; }
        .hs-qa dd { margin: 2px 0 0; white-space: pre-wrap; word-break: break-word; font-size: 0.92rem; }
        .hs-others { margin: 0; padding-left: 18px; font-size: 0.85rem; line-height: 1.9; }
        .hs-conflict { margin-top: 6px; padding: 10px; border: 2px solid #FA5252; background: #FFF5F5; border-radius: 8px; font-size: 0.82rem; line-height: 1.6; }
        .hs-conflict-theirs, .hs-conflict-mine { margin-top: 6px; } .hs-conflict span { font-weight: 700; font-size: 0.75rem; color: #868E96; }
        .hs-conflict div div { white-space: pre-wrap; background: #fff; border-radius: 6px; padding: 4px 8px; }
        .hs-btns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
        @keyframes hsFlash { from { box-shadow: 0 0 0 4px rgba(255, 146, 43, 0.6); } to { box-shadow: 0 0 0 0 rgba(255, 146, 43, 0); } }
        .hs-flash { animation: hsFlash 1.4s ease-out; }
        @media (max-width: 1280px) { .hs-info-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (max-width: 900px) {
            .hs-message { font-size: 1.05rem; padding: 10px 14px; }
            .hs-info-grid { grid-template-columns: 1fr 1fr; }
            .hs-f-store { grid-column: 1 / -1; }
            .hs-tabs { display: flex; gap: 8px; margin-bottom: 10px; position: sticky; top: -16px; z-index: 3; background: var(--bg-primary, #F8F9FA); padding: 6px 0; }
            .hs-tab { flex: 1; padding: 10px; border: 1px solid #DEE2E6; border-radius: 10px; background: #fff; font-weight: 700; font-family: inherit; font-size: 0.95rem; cursor: pointer; }
            .hs-tab.is-on { background: var(--primary, #111); color: #fff; border-color: var(--primary, #111); }
            .hs-cols { display: block; height: auto !important; min-height: 0; }
            .hs-left, .hs-right { overflow: visible; }
            .hs-cols[data-tab="manual"] .hs-right { display: none; }
            .hs-cols[data-tab="input"] .hs-left { display: none; }
            .hs-nav { top: 40px; }
        }
        @media (max-width: 520px) { .hs-info-grid { gap: 10px 12px; } .hs-info-grid .hs-f:nth-child(2) { grid-column: 1 / -1; } .hm-filters .input-field { min-width: 0; width: 100%; } }
    </style>`;
})();
