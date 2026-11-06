// ============================================================================
// タスク表(2026-11-06 全面作り直し / コージさん指示)
//   ・「新規タスク」→ タスク内容・期日・メモ だけで追加できる(以前は顧客名が必須で追加できないことがあった)
//   ・登録したタスクは、日付を切り替えなくても、いつでもこの表で全部見られる
//     (期限切れ・今日・今後・完了済み。以前は「選んだ日」のものしか表示されず、過ぎた未完了が見えなかった)
//   ・見やすい1本のリスト: 期限の近い順/期限切れは赤で先頭/完了はチェックで下げる/検索/編集/削除
// データ: tasks テーブル(既存)。data: { text, date(YYYY-MM-DD), memo, done, doneAt, createdAt, service, customer, ... }
//   ※service/customer は以前の画面・ダッシュボードとの互換のため残す(新規は 'その他' / '指定なし')。
//   ※営業成績の自動タスク(data.auto==='sales')は内容を自動で管理するので、編集はできない(完了・削除は可)。
// ============================================================================
App.Pages.tasks = async function() {
    const user = Auth.getCurrentUser();
    const isAdmin = user && user.role === 'admin';
    const dept = Auth.getDepartment();
    const deptService = { 'plusOne': 'Plus One', 'meo': 'MEO対策チャンネル', 'telecom': '通信' };

    let all = await Store.getTasks();
    // 営業成績の自動タスクは管理者にだけ表示する
    if (!isAdmin) all = all.filter(t => !t.adminOnly);
    if (!isAdmin && dept !== 'all') all = all.filter(t => t.service === deptService[dept]);

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const linkify = (escaped) => escaped.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
    // 「今日」は日本時間で判定する
    const todayStr = new Date(Date.now() + 9 * 3600 * 1000).toISOString().split('T')[0];
    const WD = ['日', '月', '火', '水', '木', '金', '土'];
    const parts = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? [+m[1], +m[2], +m[3]] : null; };
    const dayDiff = (s) => { const a = parts(s), b = parts(todayStr); if (!a) return null; return Math.round((Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000); };
    const mdw = (s) => { const a = parts(s); if (!a) return '日付なし'; return `${a[1]}/${a[2]}(${WD[new Date(a[0], a[1] - 1, a[2]).getDay()]})`; };
    const addDays = (s, n) => { const a = parts(s); const d = new Date(Date.UTC(a[0], a[1] - 1, a[2] + n)); return d.toISOString().split('T')[0]; };

    // ---- 画面の状態(見ていたタブは次回も覚えておく) ----
    const FILTERS = ['open', 'today', 'overdue', 'done', 'all'];
    let filter = 'open';
    try { const s = localStorage.getItem('msm_tk_filter'); if (FILTERS.includes(s)) filter = s; } catch (e) { /* 保存できなくても動く */ }
    let query = '';
    let editingId = null; // null=新規, それ以外=編集中のタスクID

    const serviceOptions = () => [
        (isAdmin || dept === 'all') ? '<option value="その他">指定なし</option>' : '',
        (isAdmin || dept === 'plusOne' || dept === 'all') ? '<option value="Plus One">Plus One</option>' : '',
        (isAdmin || dept === 'meo' || dept === 'all') ? '<option value="MEO対策チャンネル">MEO対策チャンネル</option>' : '',
        (isAdmin || dept === 'telecom' || dept === 'all') ? '<option value="通信">通信</option>' : ''
    ].join('');
    const defaultService = (isAdmin || dept === 'all') ? 'その他' : (deptService[dept] || 'その他');

    const isOverdue = (t) => !t.done && t.date && t.date < todayStr;
    const counts = () => ({
        open: all.filter(t => !t.done).length,
        today: all.filter(t => !t.done && t.date === todayStr).length,
        overdue: all.filter(isOverdue).length,
        done: all.filter(t => t.done).length,
        all: all.length
    });
    const idNum = (t) => Number(t.id) || 0;
    const byOrder = (a, b) => ((a.auto ? 1 : 0) - (b.auto ? 1 : 0)) || (idNum(a) - idNum(b));

    // ---- 1件の表示 ----
    const dateChip = (t) => {
        if (!t.date) return '<span class="tk-chip tk-chip-none">日付なし</span>';
        const d = dayDiff(t.date);
        if (t.done) return `<span class="tk-chip tk-chip-done">${esc(mdw(t.date))}</span>`;
        if (d < 0) return `<span class="tk-chip tk-chip-over"><i class="ph ph-warning"></i> ${-d}日超過 ・ ${esc(mdw(t.date))}</span>`;
        if (d === 0) return '<span class="tk-chip tk-chip-today"><i class="ph ph-sun"></i> 今日</span>';
        if (d === 1) return `<span class="tk-chip tk-chip-soon">明日 ・ ${esc(mdw(t.date))}</span>`;
        return `<span class="tk-chip tk-chip-later">${esc(mdw(t.date))}</span>`;
    };
    const renderItem = (t) => {
        const auto = t.auto === 'sales';
        const state = t.done ? 'done' : isOverdue(t) ? 'over' : t.date === todayStr ? 'today' : 'later';
        const tags = [];
        if (auto) tags.push('<span class="tk-tag tk-tag-auto"><i class="ph ph-robot"></i> 営業(自動)</span>');
        if (t.service && t.service !== 'その他') tags.push(`<span class="tk-tag">${esc(t.service)}</span>`);
        if (t.customer && t.customer !== '指定なし') tags.push(`<span class="tk-tag"><i class="ph ph-buildings"></i> ${esc(t.customer)}</span>`);
        return `
        <div class="tk-item tk-${state}${auto ? ' tk-auto' : ''}" data-id="${esc(t.id)}">
            <button type="button" class="tk-check" data-act="toggle" role="checkbox" aria-checked="${t.done ? 'true' : 'false'}" aria-label="${t.done ? '未完了に戻す' : '完了にする'}">${t.done ? '<i class="ph-bold ph-check"></i>' : ''}</button>
            <div class="tk-main">
                <div class="tk-text">${esc(t.text)}</div>
                ${t.memo ? `<div class="tk-memo">${linkify(esc(t.memo))}</div>` : ''}
                <div class="tk-meta">${dateChip(t)}${tags.join('')}</div>
            </div>
            <div class="tk-actions">
                ${auto ? '<button type="button" class="tk-iconbtn" data-act="sales" title="営業成績へ"><i class="ph ph-arrow-square-out"></i></button>' : '<button type="button" class="tk-iconbtn" data-act="edit" title="編集"><i class="ph ph-pencil-simple"></i></button>'}
                <button type="button" class="tk-iconbtn tk-del" data-act="del" title="削除"><i class="ph ph-trash"></i></button>
            </div>
        </div>`;
    };
    const group = (label, cls, items) => `
        <section class="tk-group">
            <h3 class="tk-group-h ${cls || ''}"><span>${label}</span><span class="tk-group-n">${items.length}</span></h3>
            ${items.map(renderItem).join('')}
        </section>`;

    // ---- リスト全体(タブ・検索に合わせて並べる) ----
    const matches = (t) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return [t.text, t.memo, t.customer, t.service].some(v => String(v || '').toLowerCase().includes(q));
    };
    const openGroups = (list) => {
        // 期限切れ → 今日 → 明日 → 以降は日付ごと(近い順)
        const open = list.filter(t => !t.done);
        const out = [];
        const over = open.filter(isOverdue).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || byOrder(a, b));
        if (over.length) out.push(group('期限切れ', 'tk-gh-over', over));
        const rest = open.filter(t => !isOverdue(t));
        const dates = [...new Set(rest.map(t => t.date || ''))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a < b ? -1 : 1));
        dates.forEach(d => {
            const items = rest.filter(t => (t.date || '') === d).sort(byOrder);
            const diff = d ? dayDiff(d) : null;
            const label = !d ? '日付なし' : diff === 0 ? `今日 <small>${mdw(d)}</small>` : diff === 1 ? `明日 <small>${mdw(d)}</small>` : mdw(d);
            out.push(group(label, diff === 0 ? 'tk-gh-today' : '', items));
        });
        return out;
    };
    const doneGroups = (list) => {
        const done = list.filter(t => t.done).sort((a, b) => String(b.doneAt || b.date || '').localeCompare(String(a.doneAt || a.date || '')) || idNum(b) - idNum(a));
        return done.length ? [group('完了済み', 'tk-gh-done', done)] : [];
    };
    const emptyHtml = (msg, sub) => `
        <div class="tk-empty">
            <div class="tk-empty-ico"><i class="ph ph-check-circle"></i></div>
            <div class="tk-empty-t">${msg}</div>
            <div class="tk-empty-s">${sub || ''}</div>
            <button type="button" class="btn-primary tk-empty-btn" data-act="new"><i class="ph ph-plus"></i> 新規タスク</button>
        </div>`;
    const listHtml = () => {
        let list = all.filter(matches);
        if (filter === 'today') list = list.filter(t => !t.done && t.date === todayStr);
        else if (filter === 'overdue') list = list.filter(isOverdue);
        else if (filter === 'done') list = list.filter(t => t.done);
        else if (filter === 'open') list = list.filter(t => !t.done);
        let groups;
        if (filter === 'done') groups = doneGroups(list);
        else if (filter === 'all') groups = [...openGroups(list), ...doneGroups(list)];
        else groups = openGroups(list);
        if (!groups.length) {
            if (query.trim()) return `<div class="tk-empty"><div class="tk-empty-ico"><i class="ph ph-magnifying-glass"></i></div><div class="tk-empty-t">「${esc(query.trim())}」に合うタスクはありません</div></div>`;
            if (filter === 'overdue') return emptyHtml('期限切れのタスクはありません', 'この調子です。');
            if (filter === 'today') return emptyHtml('今日のタスクはありません', '期日が今日のタスクがここに出ます。');
            if (filter === 'done') return emptyHtml('完了したタスクはまだありません', '');
            return emptyHtml('タスクはありません', '「新規タスク」から追加できます。');
        }
        return groups.join('');
    };
    const tabsHtml = () => {
        const c = counts();
        const tab = (key, label, cls) => `<button type="button" class="tk-tab${filter === key ? ' active' : ''} ${cls || ''}" data-filter="${key}">${label}<span class="tk-tab-n">${c[key]}</span></button>`;
        return tab('open', '未完了') + tab('today', '今日') + tab('overdue', '期限切れ', c.overdue ? 'tk-tab-warn' : '') + tab('done', '完了') + tab('all', 'すべて');
    };

    const css = `
    <style>
        .tk-wrap { max-width: 860px; margin: 0 auto; }
        .tk-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap; margin-bottom:20px; }
        .tk-sub { color: var(--text-tertiary); font-size:1.05rem; }
        .tk-sub b { color: var(--text-primary); font-weight:700; font-size:1.35rem; margin:0 2px; }
        .tk-sub .tk-over-n { color: var(--danger); }
        .tk-new { display:inline-flex; align-items:center; gap:8px; padding:12px 20px; border-radius:12px; font-weight:600; white-space:nowrap; margin-top:0; }
        .tk-bar { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:20px; position:sticky; top:0; z-index:5; background:var(--bg-primary); padding:8px 0; }
        .tk-tabs { display:flex; gap:4px; background:var(--bg-tertiary); padding:4px; border-radius:12px; overflow-x:auto; max-width:100%; }
        .tk-tab { border:0; background:transparent; padding:8px 14px; border-radius:9px; font-size:.875rem; font-weight:500; color:var(--text-secondary); cursor:pointer; display:flex; align-items:center; gap:6px; white-space:nowrap; }
        .tk-tab:hover { background:rgba(0,0,0,.04); }
        .tk-tab.active { background:var(--bg-secondary); color:var(--text-primary); box-shadow:var(--shadow-sm); font-weight:600; }
        .tk-tab-n { font-size:.75rem; background:rgba(0,0,0,.06); border-radius:999px; padding:1px 8px; min-width:22px; text-align:center; }
        .tk-tab.active .tk-tab-n { background:var(--accent); color:#fff; }
        .tk-tab-warn .tk-tab-n { background:var(--danger-light); color:var(--danger); font-weight:700; }
        .tk-tab-warn.active .tk-tab-n { background:var(--danger); color:#fff; }
        .tk-search { flex:1; min-width:180px; position:relative; }
        .tk-search i { position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--text-tertiary); }
        .tk-search input { width:100%; border:1px solid var(--border-strong); border-radius:12px; padding:10px 14px 10px 40px; background:var(--bg-secondary); font-size:.9rem; }
        .tk-search input:focus { outline:none; border-color:var(--text-primary); box-shadow:0 0 0 2px var(--accent-light); }
        .tk-group { margin-bottom:22px; }
        .tk-group-h { display:flex; align-items:center; gap:8px; font-size:.82rem; font-weight:700; letter-spacing:.04em; color:var(--text-secondary); margin:0 2px 10px; }
        .tk-group-h small { font-weight:500; color:var(--text-tertiary); letter-spacing:0; }
        .tk-group-n { background:rgba(0,0,0,.06); border-radius:999px; padding:0 8px; font-size:.72rem; font-weight:600; }
        .tk-gh-over { color:var(--danger); } .tk-gh-over .tk-group-n { background:var(--danger-light); }
        .tk-gh-today { color:#b87400; } .tk-gh-today .tk-group-n { background:var(--warning-light); }
        .tk-gh-done { color:var(--text-tertiary); }
        .tk-item { position:relative; display:flex; gap:14px; align-items:flex-start; background:var(--bg-secondary); border:1px solid var(--border-strong); border-left:4px solid #cfd4da; border-radius:12px; padding:14px 14px 14px 16px; margin-bottom:8px; box-shadow:var(--shadow-sm); transition:box-shadow .15s, transform .15s; cursor:pointer; }
        .tk-item:hover { box-shadow:var(--shadow-md); }
        .tk-item.tk-auto { cursor:default; }
        .tk-over { border-left-color:var(--danger); }
        .tk-today { border-left-color:var(--warning); }
        .tk-later { border-left-color:var(--info); }
        .tk-done { border-left-color:#dee2e6; background:var(--bg-primary); box-shadow:none; }
        .tk-done .tk-text { text-decoration:line-through; color:var(--text-tertiary); }
        .tk-done .tk-memo { color:var(--text-tertiary); }
        .tk-check { flex:0 0 auto; width:24px; height:24px; border-radius:50%; border:2px solid #adb5bd; background:var(--bg-secondary); display:flex; align-items:center; justify-content:center; cursor:pointer; margin-top:1px; padding:0; color:#fff; font-size:.8rem; transition:all .15s; }
        .tk-check:hover { border-color:var(--success); background:var(--success-light); }
        .tk-done .tk-check { background:var(--success); border-color:var(--success); }
        .tk-main { flex:1; min-width:0; }
        .tk-text { font-weight:600; font-size:1rem; line-height:1.5; word-break:break-word; }
        .tk-memo { margin-top:4px; font-size:.875rem; color:var(--text-secondary); line-height:1.6; white-space:pre-wrap; word-break:break-word; }
        .tk-memo a { color:var(--info); text-decoration:underline; }
        .tk-meta { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; align-items:center; }
        .tk-chip { display:inline-flex; align-items:center; gap:4px; font-size:.75rem; font-weight:600; padding:3px 10px; border-radius:999px; background:var(--accent-light); color:var(--text-secondary); }
        .tk-chip-over { background:var(--danger-light); color:var(--danger); }
        .tk-chip-today { background:var(--warning-light); color:#b87400; }
        .tk-chip-soon { background:var(--info-light); color:var(--info); }
        .tk-chip-later { background:var(--accent-light); color:var(--text-secondary); }
        .tk-chip-done, .tk-chip-none { background:transparent; color:var(--text-tertiary); padding-left:0; }
        .tk-tag { display:inline-flex; align-items:center; gap:4px; font-size:.75rem; color:var(--text-tertiary); border:1px solid var(--border-strong); border-radius:999px; padding:2px 9px; }
        .tk-tag-auto { color:var(--info); border-color:rgba(28,126,214,.3); background:var(--info-light); }
        .tk-actions { display:flex; gap:2px; opacity:0; transition:opacity .15s; flex:0 0 auto; }
        .tk-item:hover .tk-actions, .tk-item:focus-within .tk-actions { opacity:1; }
        @media (hover:none) { .tk-actions { opacity:1; } }
        .tk-iconbtn { border:0; background:transparent; width:34px; height:34px; border-radius:8px; cursor:pointer; color:var(--text-tertiary); font-size:1.05rem; display:flex; align-items:center; justify-content:center; }
        .tk-iconbtn:hover { background:var(--bg-tertiary); color:var(--text-primary); }
        .tk-del:hover { background:var(--danger-light); color:var(--danger); }
        .tk-empty { text-align:center; padding:56px 16px; background:var(--bg-secondary); border:1px dashed var(--border-strong); border-radius:16px; }
        .tk-empty-ico { font-size:2.4rem; color:#adb5bd; }
        .tk-empty-t { font-weight:600; margin-top:8px; }
        .tk-empty-s { color:var(--text-tertiary); font-size:.875rem; margin-top:4px; }
        .tk-empty-btn { margin-top:16px; display:inline-flex; gap:8px; align-items:center; }
        .tk-modal-actions { display:flex; gap:10px; justify-content:space-between; align-items:center; margin-top:8px; }
        .tk-modal-actions .tk-right { display:flex; gap:10px; margin-left:auto; }
        .tk-opt { color:var(--text-tertiary); font-weight:400; }
        .tk-row2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        @media (max-width: 640px) { .tk-row2 { grid-template-columns:1fr; gap:0; } }
        .tk-presets { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
        .tk-preset { border:1px solid var(--border-strong); background:var(--bg-secondary); border-radius:999px; padding:4px 12px; font-size:.8rem; cursor:pointer; color:var(--text-secondary); }
        .tk-preset:hover { background:var(--bg-tertiary); }
        .tk-err { display:none; background:var(--danger-light); color:var(--danger); border-radius:10px; padding:10px 14px; font-size:.85rem; margin-bottom:14px; }
        .tk-err.show { display:block; }
        .tk-danger-btn { border:0; background:transparent; color:var(--danger); font-size:.875rem; cursor:pointer; padding:8px 4px; display:inline-flex; gap:6px; align-items:center; }
        @media (max-width: 640px) {
            .tk-new { width:100%; justify-content:center; }
            .tk-head { margin-bottom:14px; }
            .tk-tabs { width:100%; gap:2px; }
            .tk-tab { flex:1 1 auto; justify-content:center; padding:8px 4px; font-size:.74rem; gap:3px; }
            .tk-tab-n { padding:0 5px; min-width:16px; font-size:.68rem; }
            .tk-item { padding:12px 10px 12px 12px; gap:10px; }
            .tk-search { min-width:100%; order:3; }
        }
    </style>`;

    const html = `${css}
    <div class="tk-wrap">
        <div class="tk-head">
            <div>
                <div class="tk-sub" id="tk-sub"></div>
            </div>
            <button type="button" class="btn-primary tk-new" id="tk-new-btn"><i class="ph ph-plus"></i> 新規タスク</button>
        </div>
        <div class="tk-bar">
            <div class="tk-tabs" id="tk-tabs"></div>
            <div class="tk-search"><i class="ph ph-magnifying-glass"></i><input type="search" id="tk-q" placeholder="タスクを検索(内容・メモ)" autocomplete="off"></div>
        </div>
        <div id="tk-list"></div>
    </div>

    <div class="modal-overlay" id="tk-modal">
        <div class="modal-content" style="max-width:520px;">
            <div class="modal-header">
                <h3 class="modal-title" id="tk-modal-title">新規タスク</h3>
                <button type="button" class="modal-close" id="tk-modal-x" aria-label="閉じる"><i class="ph ph-x"></i></button>
            </div>
            <form id="tk-form" novalidate>
                <div class="tk-err" id="tk-err"></div>
                <div class="form-group">
                    <label for="tk-f-text">タスク内容</label>
                    <input type="text" id="tk-f-text" maxlength="200" placeholder="例: サムネイル作成" autocomplete="off">
                </div>
                <div class="form-group">
                    <label for="tk-f-date">期日</label>
                    <input type="date" id="tk-f-date">
                    <div class="tk-presets">
                        <button type="button" class="tk-preset" data-add="0">今日</button>
                        <button type="button" class="tk-preset" data-add="1">明日</button>
                        <button type="button" class="tk-preset" data-add="7">1週間後</button>
                    </div>
                </div>
                <div class="tk-row2">
                    <div class="form-group">
                        <label for="tk-f-service">対象サービス <span class="tk-opt">(任意)</span></label>
                        <select id="tk-f-service">${serviceOptions()}</select>
                    </div>
                    <div class="form-group">
                        <label for="tk-f-customer">顧客名 <span class="tk-opt">(任意)</span></label>
                        <input type="text" id="tk-f-customer" maxlength="100" placeholder="入力しなくてもOK" autocomplete="off" list="tk-meo-clients">
                        <datalist id="tk-meo-clients"></datalist>
                    </div>
                </div>
                <div class="form-group">
                    <label for="tk-f-memo">メモ <span class="tk-opt">(任意)</span></label>
                    <textarea id="tk-f-memo" rows="4" placeholder="詳しい内容、URL、補足など" style="resize:vertical;"></textarea>
                </div>
                <div class="tk-modal-actions">
                    <button type="button" class="tk-danger-btn" id="tk-f-del" style="display:none;"><i class="ph ph-trash"></i> 削除</button>
                    <div class="tk-right">
                        <button type="button" class="btn-secondary" id="tk-f-cancel">キャンセル</button>
                        <button type="submit" class="btn-primary" id="tk-f-save" style="margin-top:0;">登録する</button>
                    </div>
                </div>
            </form>
        </div>
    </div>`;

    App.mount(html, () => {
        const $ = (id) => document.getElementById(id);
        const listEl = $('tk-list');
        if (!listEl) return; // 別のページへ移った後
        const find = (id) => all.find(t => String(t.id) === String(id));

        const refresh = () => {
            const c = counts();
            $('tk-tabs').innerHTML = tabsHtml();
            $('tk-sub').innerHTML = `未完了 <b>${c.open}</b>件` + (c.today ? ` ・ 今日 <b>${c.today}</b>件` : '') + (c.overdue ? ` ・ <span class="tk-over-n">期限切れ <b class="tk-over-n">${c.overdue}</b>件</span>` : '') + (c.open === 0 ? ' ・ すべて完了しています' : '');
            listEl.innerHTML = listHtml();
        };
        refresh();

        // ---- タブ・検索 ----
        $('tk-tabs').addEventListener('click', (e) => {
            const b = e.target.closest('[data-filter]');
            if (!b) return;
            filter = b.dataset.filter;
            try { localStorage.setItem('msm_tk_filter', filter); } catch (err) { /* 無視 */ }
            refresh();
        });
        $('tk-q').addEventListener('input', (e) => { query = e.target.value; listEl.innerHTML = listHtml(); });

        // ---- 追加・編集の入力画面 ----
        const modal = $('tk-modal');
        const showErr = (msg) => { const el = $('tk-err'); el.textContent = msg || ''; el.classList.toggle('show', !!msg); };
        const openModal = (task) => {
            editingId = task ? task.id : null;
            $('tk-modal-title').textContent = task ? 'タスクを編集' : '新規タスク';
            $('tk-f-save').textContent = task ? '保存する' : '登録する';
            $('tk-f-del').style.display = task ? 'inline-flex' : 'none';
            $('tk-f-text').value = task ? (task.text || '') : '';
            $('tk-f-date').value = task ? (task.date || '') : todayStr;
            $('tk-f-memo').value = task ? (task.memo || '') : '';
            const svcSel = $('tk-f-service');
            const svc = task ? (task.service || 'その他') : defaultService;
            if (![...svcSel.options].some(o => o.value === svc)) { const o = document.createElement('option'); o.value = svc; o.textContent = svc === 'その他' ? '指定なし' : svc; svcSel.appendChild(o); } // 以前のタスクのサービス名が選択肢に無くても、消さずに残す
            svcSel.value = svc;
            $('tk-f-customer').value = task && task.customer && task.customer !== '指定なし' ? task.customer : '';
            showErr('');
            $('tk-f-save').disabled = false;
            modal.classList.add('active');
            setTimeout(() => { const el = $('tk-f-text'); if (el) { el.focus(); el.select(); } }, 30);
        };
        const closeModal = () => { modal.classList.remove('active'); editingId = null; };
        window.__tkOpenNew = () => openModal(null);
        $('tk-new-btn').addEventListener('click', () => openModal(null));
        $('tk-modal-x').addEventListener('click', closeModal);
        $('tk-f-cancel').addEventListener('click', closeModal);
        modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeModal(); });
        modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
        $('tk-f-memo').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('tk-form').requestSubmit(); } });
        modal.querySelectorAll('.tk-preset').forEach(b => b.addEventListener('click', () => { $('tk-f-date').value = addDays(todayStr, Number(b.dataset.add)); }));

        $('tk-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const text = $('tk-f-text').value.trim();
            const date = $('tk-f-date').value;
            const memo = $('tk-f-memo').value.trim();
            if (!text) { showErr('タスク内容を入力してください。'); $('tk-f-text').focus(); return; }
            if (!parts(date)) { showErr('期日を選んでください。'); $('tk-f-date').focus(); return; }
            const saveBtn = $('tk-f-save');
            saveBtn.disabled = true;
            const label = saveBtn.textContent;
            saveBtn.textContent = '保存中...';
            try {
                const service = $('tk-f-service').value || defaultService;
                const customer = $('tk-f-customer').value.trim() || '指定なし';   // 顧客名は入力しなくても追加できる
                if (editingId == null) {
                    const data = { text, date, memo, service, customer, createdAt: new Date().toISOString() };
                    const id = await Store.addTask(data);
                    all.push({ id, ...data, done: false });
                    try { await Store.logAction(user.email, 'タスク表に新しいタスクを追加しました'); } catch (err) { /* 操作記録に失敗しても、タスクは追加済み */ }
                } else {
                    const patch = { text, date, memo, service, customer };
                    await Store.updateTask(editingId, patch);
                    const t = find(editingId); if (t) Object.assign(t, patch);
                }
                closeModal();
                refresh();
            } catch (err) {
                console.error('タスクの保存に失敗', err);
                showErr('保存できませんでした。通信状況を確認して、もう一度お試しください。');
                saveBtn.disabled = false; saveBtn.textContent = label;
            }
        });
        $('tk-f-del').addEventListener('click', async () => {
            if (editingId == null) return;
            const t = find(editingId);
            if (!confirm(`「${t ? t.text : 'このタスク'}」を削除しますか？`)) return;
            await removeTask(editingId, true);
        });

        // MEO対策チャンネルの顧客名は入力候補として出す(候補にない名前を自由に入力してもよい)
        const refreshClientHints = () => {
            const dl = $('tk-meo-clients'); if (!dl) return;
            dl.innerHTML = $('tk-f-service').value === 'MEO対策チャンネル' ? meoClients.map(c => `<option value="${esc(c)}"></option>`).join('') : '';
        };
        let meoClients = [];
        $('tk-f-service').addEventListener('change', refreshClientHints);
        modal.addEventListener('transitionend', refreshClientHints);
        new MutationObserver(refreshClientHints).observe(modal, { attributes: true, attributeFilter: ['class'] });
        Promise.resolve().then(() => Store.getCustomers('meo')).then(rows => { meoClients = [...new Set((rows || []).map(c => c.client).filter(Boolean))]; refreshClientHints(); }).catch(() => { /* 候補が出せなくても、入力はできる */ });

        // ---- 1件ごとの操作(完了・編集・削除・営業成績へ) ----
        const removeTask = async (id, fromModal) => {
            try {
                await Store.deleteTask(id);
                all = all.filter(t => String(t.id) !== String(id));
                if (fromModal) closeModal();
                refresh();
            } catch (err) { console.error(err); alert('削除できませんでした。もう一度お試しください。'); }
        };
        listEl.addEventListener('click', async (e) => {
            const row = e.target.closest('.tk-item');
            if (!row) { if (e.target.closest('[data-act="new"]')) openModal(null); return; }
            if (e.target.closest('a')) return; // メモ内のリンクは、そのまま開く
            const id = row.dataset.id;
            const t = find(id);
            if (!t) return;
            const actEl = e.target.closest('[data-act]');
            const act = actEl ? actEl.dataset.act : '';
            if (act === 'toggle') {
                const prev = { done: t.done, doneAt: t.doneAt };
                t.done = !t.done; t.doneAt = t.done ? new Date().toISOString() : null;
                refresh();
                try { await Store.toggleTask(id); }
                catch (err) { console.error(err); t.done = prev.done; t.doneAt = prev.doneAt; refresh(); alert('更新できませんでした。もう一度お試しください。'); }
            } else if (act === 'del') {
                if (confirm(`「${t.text}」を削除しますか？`)) await removeTask(id, false);
            } else if (act === 'sales') {
                App.navigate('sales_performance', { focus: t.salesKey || null });
            } else if (act === 'edit' || !act) {
                if (t.auto !== 'sales') openModal(t);
            }
        });
    });
};
