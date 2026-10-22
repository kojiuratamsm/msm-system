// js/pages/meo_progress.js
// 今月のMEO作業状況: 「契約中」の全店舗の「投稿状況」と「写真/動画アップロード」の進み具合を1画面で見るページ。
//
// ・データは顧客管理(MEO対策チャンネル)のチェックをそのまま使う(posts / media の 'YYYY-MM')。このページでチェックしても同じ所に保存される。
// ・目標件数はプランごと(「契約プランの管理」の「月の投稿数」「月の写真/動画」。初期値 12件 / 6件)。
// ・遅れの判定: 「月の何%が過ぎたか」から「今日までに終わっているべき件数」を出し、実際の件数と比べる。
//     今日までの予定 = 目標 × 経過した割合(小数点以下切り捨て)
//     足りない件数が 0 → 順調 / 目標の2割以上 → 遅れ / それ以外 → やや遅れ。投稿と写真/動画の悪い方をその店舗の状態にする。
//   過去の月を選んだときは、月が終わっているので「目標まで全部」終わっているべきとして判定する。
// ・遅れている店舗ほど上に並べる(遅れ → やや遅れ → 順調 → 完了。同じ状態なら足りない割合が大きい順)。
App.Pages.meo_progress = async function (selectedYm) {
    const dept = Auth.getDepartment();
    if (dept !== 'all' && dept !== 'meo') {
        App.mount('<div class="card"><p>閲覧権限がありません。</p></div>');
        return;
    }
    const W = window.MeoWork;
    const now = new Date();
    const monthOpts = W.monthOptions(12, now);
    const ym = monthOpts.some(o => o.key === selectedYm) ? selectedYm : monthOpts[0].key;
    const isCurrent = ym === monthOpts[0].key;
    const [yy, mm] = ym.split('-').map(Number);
    const daysInMonth = new Date(yy, mm, 0).getDate();
    const ratio = isCurrent ? now.getDate() / daysInMonth : 1;

    const all = await Store.getCustomers('meo');
    await W.migrateLegacyPosts(all);
    const targets = all.filter(d => d.tag === '契約中' && (!d.startMonth || d.startMonth <= ym));

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const LEVELS = {
        late: { label: '遅れ', cls: 'late', icon: 'ph-warning-circle', rank: 0 },
        slight: { label: 'やや遅れ', cls: 'slight', icon: 'ph-clock-countdown', rank: 1 },
        ok: { label: '順調', cls: 'ok', icon: 'ph-check-circle', rank: 2 },
        done: { label: '完了', cls: 'done', icon: 'ph-seal-check', rank: 3 }
    };

    // 1店舗分の計算
    function calc(d) {
        const plan = window.MeoPlans.find(d.plan);
        const tp = plan ? plan.postsPerMonth : W.POSTS_MAX;
        const tm = plan ? plan.mediaPerMonth : W.MEDIA_MAX;
        const posts = W.checks(d, 'posts', ym);
        const media = W.checks(d, 'media', ym);
        const dp = posts.filter(Boolean).length, dm = media.filter(Boolean).length;
        const expected = (t) => Math.floor(t * ratio + 1e-9);
        const sp = Math.max(0, expected(tp) - dp), sm = Math.max(0, expected(tm) - dm);
        const lv = (short, t) => (!t || !short) ? 0 : (short / t >= 0.2 ? 2 : 1);
        const worst = Math.max(lv(sp, tp), lv(sm, tm));
        const level = (dp >= tp && dm >= tm) ? 'done' : worst === 2 ? 'late' : worst === 1 ? 'slight' : 'ok';
        const score = (tp ? sp / tp : 0) + (tm ? sm / tm : 0);
        return { d, plan, tp, tm, posts, media, dp, dm, sp, sm, level, score, restP: Math.max(0, tp - dp), restM: Math.max(0, tm - dm) };
    }
    const sortRows = (rows) => rows.sort((a, b) =>
        LEVELS[a.level].rank - LEVELS[b.level].rank || b.score - a.score || (b.restP + b.restM) - (a.restP + a.restM) || String(a.d.client).localeCompare(String(b.d.client), 'ja'));
    let rows = sortRows(targets.map(calc));

    const bar = (done, target) => {
        const pct = target ? Math.min(100, Math.round(done / target * 100)) : 100;
        return `<div class="mp-bar"><div style="width:${pct}%;"></div></div>`;
    };
    const boxes = (r, type) => {
        const list = type === 'media' ? r.media : r.posts;
        const target = type === 'media' ? r.tm : r.tp;
        const dates = type === 'media' ? W.mediaDates(r.d, ym) : [];
        return list.map((on, i) => { const lb = on && dates[i] ? W.dayLabel(dates[i]) : null; return `<input type="checkbox" class="${i >= target ? 'mp-extra' : ''}" title="${i + 1}件目${i >= target ? '(目標外)' : ''}${lb ? `(${lb.full}にチェック)` : ''}" ${on ? 'checked' : ''} onchange="mpToggle(${r.d.id}, '${type}', ${i}, this.checked)">`; }).join('');
    };
    const todo = (r) => {
        if (r.level === 'done') return '<span class="mp-todo-ok">今月分 完了</span>';
        const today = [];
        if (r.sp) today.push(`投稿 <b>${r.sp}</b>`);
        if (r.sm) today.push(`写真/動画 <b>${r.sm}</b>`);
        const rest = [];
        if (r.restP) rest.push(`投稿${r.restP}`);
        if (r.restM) rest.push(`写真/動画${r.restM}`);
        return `${today.length ? `<div class="mp-todo-now">${isCurrent ? '今日までに' : '未完了'} ${today.join('・')}</div>` : `<div class="mp-todo-ok">${isCurrent ? '予定どおり' : ''}</div>`}
                <div class="mp-todo-rest">${isCurrent ? '月末まで' : '目標まで'}残り ${rest.join('・') || 'なし'}</div>`;
    };
    const rowHtml = (r) => `
        <tr data-id="${r.d.id}" data-level="${r.level}">
            <td>
                <a href="#" class="mp-name" onclick="App.navigate('customers', 'meo'); return false;" title="顧客管理で開く">${esc(r.d.client)}</a>
                <div class="mp-plan">${esc(r.d.plan || 'プラン未設定')}${r.plan ? '' : '<span title="「契約プランの管理」にないプランのため、目標は投稿12件・写真/動画6件で判定"> *</span>'}</div>
            </td>
            <td><span class="mp-chip mp-${LEVELS[r.level].cls}"><i class="ph ${LEVELS[r.level].icon}"></i> ${LEVELS[r.level].label}</span></td>
            <td>
                <div class="mp-count"><b>${r.dp}</b> / ${r.tp}件</div>
                ${bar(r.dp, r.tp)}
                <div class="mp-boxes">${boxes(r, 'posts')}</div>
            </td>
            <td>
                <div class="mp-count"><b>${r.dm}</b> / ${r.tm}件</div>
                ${bar(r.dm, r.tm)}
                <div class="mp-boxes">${boxes(r, 'media')}</div>
            </td>
            <td class="mp-todo">${todo(r)}</td>
        </tr>`;

    let filter = window.mpFilter || 'all';
    const summaryHtml = () => {
        const cnt = (lv) => rows.filter(r => r.level === lv).length;
        return `
            <button type="button" class="mp-sum mp-sum-all ${filter === 'all' ? 'is-on' : ''}" onclick="mpSetFilter('all')"><span>すべて</span><b>${rows.length}</b></button>
            ${['late', 'slight', 'ok', 'done'].map(lv => `
            <button type="button" class="mp-sum mp-sum-${lv} ${filter === lv ? 'is-on' : ''}" onclick="mpSetFilter('${lv}')"><span><i class="ph ${LEVELS[lv].icon}"></i> ${LEVELS[lv].label}</span><b>${cnt(lv)}</b></button>`).join('')}`;
    };
    const tbodyHtml = () => {
        const list = filter === 'all' ? rows : rows.filter(r => r.level === filter);
        if (!rows.length) return '<tr><td colspan="5" class="mp-empty">この月に「契約中」の店舗はありません。</td></tr>';
        if (!list.length) return `<tr><td colspan="5" class="mp-empty">「${LEVELS[filter].label}」の店舗はありません。</td></tr>`;
        return list.map(rowHtml).join('');
    };

    const html = `
    <div class="card mp-head">
        <div class="mp-head-row">
            <div>
                <div class="mp-title">${monthOpts.find(o => o.key === ym).label.replace('(今月)', '')}の作業状況</div>
                <div class="mp-sub">${isCurrent
                    ? `今日 ${now.getMonth() + 1}/${now.getDate()} ・ 月の <b>${Math.round(ratio * 100)}%</b> が経過`
                    : 'この月は終わっているため、目標の件数まで終わっているかで判定しています'}</div>
            </div>
            <div class="mp-head-actions">
                <select id="mp-month" onchange="App.navigate('meo_progress', this.value)">
                    ${monthOpts.map(o => `<option value="${o.key}" ${o.key === ym ? 'selected' : ''}>${o.label}</option>`).join('')}
                </select>
                <button type="button" class="btn-secondary btn-sm" id="mp-resort" onclick="mpResort()"><i class="ph ph-sort-ascending"></i> 並べ直す</button>
            </div>
        </div>
        <div class="mp-sums" id="mp-sums">${summaryHtml()}</div>
        <div class="mp-rule">遅れの判定: 月の経過に合わせて「今日までに終わっているべき件数」を出し、足りない件数が目標の2割以上なら<b class="mp-t-late">遅れ</b>、1件以上なら<b class="mp-t-slight">やや遅れ</b>。目標件数はプランごとに「顧客管理 → 契約プランの管理」で変えられます。</div>
    </div>

    <div class="card" style="padding:0; overflow:hidden;">
        <div class="table-container" style="margin:0;">
            <table class="mp-table">
                <thead><tr><th>店舗</th><th>状態</th><th>投稿状況</th><th>写真/動画アップロード</th><th>やること</th></tr></thead>
                <tbody id="mp-tbody">${tbodyHtml()}</tbody>
            </table>
        </div>
    </div>

    <style>
        .mp-head-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
        .mp-title { font-size: 1.25rem; font-weight: 800; }
        .mp-sub { font-size: 0.85rem; color: var(--text-secondary); margin-top: 4px; }
        .mp-head-actions { display: flex; gap: 8px; align-items: center; }
        .mp-head-actions select { width: auto; padding: 6px 10px; }
        .mp-head-actions .is-pending { border-color: var(--info, #4285F4); color: var(--info, #4285F4); font-weight: 700; }
        .mp-sums { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 18px 0 12px; }
        .mp-sum { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 12px 14px; border-radius: 12px; border: 2px solid transparent; background: var(--bg-tertiary, #f4f5f7); cursor: pointer; text-align: left; font: inherit; }
        .mp-sum span { font-size: 0.8rem; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; }
        .mp-sum b { font-size: 1.6rem; line-height: 1.1; }
        .mp-sum.is-on { border-color: currentColor; }
        .mp-sum-all { color: #2D3748; }
        .mp-sum-late { color: #C92A2A; background: #FFF0F0; }
        .mp-sum-slight { color: #C25E00; background: #FFF4E5; }
        .mp-sum-ok { color: #1971C2; background: #EDF5FF; }
        .mp-sum-done { color: #2B8A3E; background: #EBFBEE; }
        .mp-rule { font-size: 0.75rem; color: var(--text-secondary); line-height: 1.7; }
        .mp-t-late { color: #C92A2A; } .mp-t-slight { color: #C25E00; }
        .mp-table th, .mp-table td { vertical-align: middle; }
        .mp-table tbody tr[data-level="late"] td:first-child { box-shadow: inset 4px 0 0 #E03131; }
        .mp-table tbody tr[data-level="slight"] td:first-child { box-shadow: inset 4px 0 0 #FD7E14; }
        .mp-name { font-weight: 700; color: var(--info); text-decoration: none; }
        .mp-plan { font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px; }
        .mp-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 0.78rem; font-weight: 700; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
        .mp-late { background: #FFF0F0; color: #C92A2A; }
        .mp-slight { background: #FFF4E5; color: #C25E00; }
        .mp-ok { background: #EDF5FF; color: #1971C2; }
        .mp-done { background: #EBFBEE; color: #2B8A3E; }
        .mp-count { font-size: 0.8rem; color: var(--text-secondary); }
        .mp-count b { font-size: 1rem; color: var(--text-primary, #222); }
        .mp-bar { height: 6px; border-radius: 3px; background: #E9ECEF; margin: 4px 0 6px; overflow: hidden; max-width: 210px; }
        .mp-bar div { height: 100%; background: var(--success, #2F9E44); border-radius: 3px; transition: width .2s; }
        .mp-boxes { display: flex; flex-wrap: wrap; gap: 2px; max-width: 210px; }
        .mp-boxes input { width: 14px; height: 14px; margin: 0; }
        .mp-boxes input.mp-extra { opacity: .35; }
        .mp-todo { font-size: 0.8rem; line-height: 1.6; white-space: nowrap; }
        .mp-todo-now { color: #C92A2A; font-weight: 700; }
        .mp-todo-now b { font-size: 0.95rem; }
        .mp-todo-ok { color: #2B8A3E; font-weight: 700; }
        .mp-todo-rest { color: var(--text-secondary); }
        .mp-empty { text-align: center; color: var(--text-secondary); padding: 32px !important; }
        @media (max-width: 900px) { .mp-sums { grid-template-columns: repeat(3, 1fr); } }
    </style>`;

    App.mount(html, () => {
        const redrawSummary = () => { const el = document.getElementById('mp-sums'); if (el) el.innerHTML = summaryHtml(); };
        const redrawBody = () => { const el = document.getElementById('mp-tbody'); if (el) el.innerHTML = tbodyHtml(); };

        window.mpSetFilter = (lv) => { filter = lv; window.mpFilter = lv; redrawSummary(); redrawBody(); };
        window.mpResort = () => {
            sortRows(rows);
            redrawBody();
            const b = document.getElementById('mp-resort'); if (b) b.classList.remove('is-pending');
        };
        // チェックを付けたら保存して、その行と上の件数だけ更新する(並び順は「並べ直す」を押すまで変えない=行が急に動かないように)
        window.mpToggle = async (id, type, idx, checked) => {
            const i = rows.findIndex(r => r.d.id === id);
            if (i < 0) return;
            const d = rows[i].d;
            if (!d[type] || typeof d[type] !== 'object' || Array.isArray(d[type])) d[type] = {};
            const max = type === 'media' ? W.MEDIA_MAX : W.POSTS_MAX;
            const arr = W.checks(d, type, ym).slice(0, max);
            arr[idx] = checked;
            d[type][ym] = arr;
            if (type === 'media') W.setMediaDate(d, ym, idx, checked); // 写真/動画は、チェックを付けた日も記録する(顧客管理の画面と同じ)
            rows[i] = calc(d);
            const tr = document.querySelector(`#mp-tbody tr[data-id="${id}"]`);
            if (tr) tr.outerHTML = rowHtml(rows[i]);
            redrawSummary();
            const b = document.getElementById('mp-resort'); if (b) b.classList.add('is-pending');
            try {
                await Store.updateCustomer('meo', id, type === 'media' ? { media: d.media, mediaDates: d.mediaDates } : { [type]: d[type] });
            } catch (e) {
                alert('保存できませんでした。通信状態を確認して、もう一度お試しください。');
            }
        };
    });
};
