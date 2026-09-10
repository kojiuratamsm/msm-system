// ============================================================================
// マインドマップ一覧ページ (js/pages/mindmaps.js)
// コージさんのご要望:MindMeisterのように直感的に操作できるマインドマップ機能。
// ・管理者(コージさん)のみが使える
// ・何個でも新規作成できる
// ・自動保存され、選んだものはいつでも途中から編集を再開できる
// このページは一覧(カード表示・新規作成・複製・削除・開く)を担当し、
// 実際の編集キャンバスは js/pages/mindmap_editor.js が担当する。
// ============================================================================

App.Pages.mindmaps = async function() {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') {
        App.mount('<div class="card" style="margin-top:24px; padding: 40px; text-align:center;"><h3 class="card-title">アクセス権限がありません</h3></div>');
        return;
    }

    App.mount(`
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
            <h2 style="margin:0; font-size:1.5rem; font-weight:700;"><i class="ph ph-tree-structure" style="margin-right:8px; color:var(--primary-color);"></i>マインドマップ</h2>
            <button class="btn btn-primary" id="new-mindmap-btn"><i class="ph ph-plus"></i> 新しいマインドマップを作成</button>
        </div>
        <div id="mindmaps-content" style="text-align:center; padding: 40px;">
            <i class="ph ph-spinner ph-spin" style="font-size:2rem; color:var(--primary-color);"></i>
            <p>読み込み中...</p>
        </div>
    `);

    const newBtn = document.getElementById('new-mindmap-btn');
    if (newBtn) {
        newBtn.addEventListener('click', async () => {
            newBtn.disabled = true;
            const mapData = createDefaultMindmapData(user.email);
            const newId = await Store.saveMindmap(null, mapData);
            App.navigate('mindmap_editor', newId);
        });
    }

    const maps = await Store.getMindmaps();
    renderMindmapList(maps);
};

function createDefaultMindmapData(creatorEmail) {
    return {
        title: "新しいマインドマップ",
        creatorEmail: creatorEmail,
        updatedAt: new Date().toISOString(),
        root: {
            id: "n" + Date.now(),
            text: "中心テーマ",
            color: "#0d6efd",
            collapsed: false,
            children: []
        }
    };
}

function countNodes(node) {
    if (!node) return 0;
    let count = 1;
    (node.children || []).forEach(c => { count += countNodes(c); });
    return count;
}

function renderMindmapList(maps) {
    const container = document.getElementById('mindmaps-content');
    if (!container) return;

    if (!maps || maps.length === 0) {
        container.innerHTML = `
            <div class="card" style="padding:40px;">
                <h3 style="margin-bottom:16px;">まだマインドマップが作成されていません</h3>
                <p style="color:var(--text-secondary);">右上の「新しいマインドマップを作成」から作成してください。</p>
            </div>
        `;
        return;
    }

    // 更新日時が新しい順に並べる
    const sorted = maps.slice().sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

    let html = `
        <div style="text-align:left;">
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap:20px;">
    `;

    sorted.forEach(m => {
        const title = m.title || '無題のマインドマップ';
        const nodeCount = countNodes(m.root);
        const updatedLabel = m.updatedAt
            ? new Date(m.updatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            : '不明';
        html += `
            <div class="card mindmap-card" data-id="${m.id}" style="padding:20px; display:flex; flex-direction:column; gap:12px; cursor:pointer;">
                <div class="mindmap-open-area" data-id="${m.id}">
                    <div style="font-weight:700; font-size:1.05rem; margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${title}"><i class="ph ph-tree-structure" style="margin-right:6px; color:var(--primary-color);"></i>${title}</div>
                    <div style="color:var(--text-secondary); font-size:0.85rem;">ノード数: ${nodeCount}件 / 最終更新: ${updatedLabel}</div>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:auto;">
                    <button class="btn btn-primary btn-sm mindmap-open-btn" data-id="${m.id}"><i class="ph ph-pencil-simple"></i> 開く</button>
                    <button class="btn btn-secondary btn-sm mindmap-duplicate-btn" data-id="${m.id}"><i class="ph ph-copy"></i> 複製</button>
                    <button class="btn btn-danger btn-sm mindmap-delete-btn" data-id="${m.id}"><i class="ph ph-trash"></i></button>
                </div>
            </div>
        `;
    });

    html += `</div></div>`;
    container.innerHTML = html;

    container.querySelectorAll('.mindmap-open-btn, .mindmap-open-area').forEach(el => {
        el.addEventListener('click', () => App.navigate('mindmap_editor', el.getAttribute('data-id')));
    });
    container.querySelectorAll('.mindmap-duplicate-btn').forEach(el => {
        el.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = el.getAttribute('data-id');
            el.disabled = true;
            await Store.duplicateMindmap(id);
            const maps = await Store.getMindmaps();
            renderMindmapList(maps);
        });
    });
    container.querySelectorAll('.mindmap-delete-btn').forEach(el => {
        el.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = el.getAttribute('data-id');
            if (!confirm('このマインドマップを削除してもよろしいですか？元に戻せません。')) return;
            el.disabled = true;
            await Store.deleteMindmap(id);
            const maps = await Store.getMindmaps();
            renderMindmapList(maps);
        });
    });
}
