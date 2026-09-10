// ============================================================================
// マインドマップ編集ページ (js/pages/mindmap_editor.js)
// MindMeisterのような直感的な操作を目指したツリー型マインドマップエディタ。
//
// 操作方法(コージさんへの案内はページ内のヒント表示にも記載):
//   ・ノードをクリック → そのままテキストを編集できます
//   ・Tabキー / Shift+Enter → 選択中ノードの「子ノード」を追加(横方向にツリーを伸ばす)
//   ・Enterキー → 選択中ノードの「兄弟ノード」を追加(縦方向に増やす。中心テーマの場合は子ノード)
//   ・Shift+Tab → 選択中ノードを1階層上へ移動(アウトデント)
//   ・テキストが空の状態でBackspace → そのノードを削除
//   ・ノード左端の「⠿」をつかんで別のノードの上でマウスを離す → 親ノードを変更(ドラッグで移動)
//   ・ノード横の丸ボタン → 子ノードの折りたたみ/展開
//   ・マウスホイール/ズームボタン → 拡大縮小、背景ドラッグ → 画面移動
//
// データはservice_type='mindmap'としてcustomersテーブルに複数保存され、
// 入力停止から約1秒後に自動保存される(Store.saveMindmap、詳細はjs/state.js参照)。
// ============================================================================

App.Pages.mindmap_editor = async function(mindmapId) {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') {
        App.mount('<div class="card" style="margin-top:24px; padding: 40px; text-align:center;"><h3 class="card-title">アクセス権限がありません</h3></div>');
        return;
    }

    if (!mindmapId) {
        App.navigate('mindmaps');
        return;
    }

    const mapData = await Store.getMindmap(mindmapId);
    if (!mapData) {
        App.mount(`
            <div class="card" style="margin-top:24px; padding: 40px; text-align:center;">
                <h3 class="card-title">マインドマップが見つかりません</h3>
                <button class="btn btn-primary" style="margin-top:16px;" id="back-to-mindmaps-btn">一覧へ戻る</button>
            </div>
        `, () => {
            const btn = document.getElementById('back-to-mindmaps-btn');
            if (btn) btn.addEventListener('click', () => App.navigate('mindmaps'));
        });
        return;
    }
    if (!mapData.root) {
        mapData.root = { id: 'n' + Date.now(), text: '中心テーマ', color: '#0d6efd', collapsed: false, children: [] };
    }
    if (!mapData.creatorEmail) mapData.creatorEmail = user.email;

    // ==== 定数 ====
    const BRANCH_PALETTE = ['#0d6efd', '#dc3545', '#198754', '#fd7e14', '#6f42c1', '#20c997', '#e83e8c', '#0dcaf0'];
    const NODE_H_SPACING = 240;
    const NODE_V_SPACING = 64;
    const PADDING = 80;

    // ==== 状態 ====
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let panStartX = 0, panStartY = 0, panOriginX = 0, panOriginY = 0;
    let draggingNodeId = null;
    let dropTargetId = null;
    let saveTimer = null;
    let lastLayoutBounds = null;

    // ==== ヘルパー ====
    function findNode(id, node = mapData.root) {
        if (node.id === id) return node;
        for (const c of (node.children || [])) {
            const found = findNode(id, c);
            if (found) return found;
        }
        return null;
    }
    function findParent(id, node = mapData.root) {
        for (const c of (node.children || [])) {
            if (c.id === id) return node;
            const found = findParent(id, c);
            if (found) return found;
        }
        return null;
    }
    function isDescendant(ancestorNode, targetId) {
        for (const c of (ancestorNode.children || [])) {
            if (c.id === targetId) return true;
            if (isDescendant(c, targetId)) return true;
        }
        return false;
    }
    function countAllNodes(node) {
        let count = 1;
        (node.children || []).forEach(c => { count += countAllNodes(c); });
        return count;
    }
    function nextBranchColor() {
        const idx = (mapData.root.children || []).length % BRANCH_PALETTE.length;
        return BRANCH_PALETTE[idx];
    }
    function applyColorRecursive(node, color) {
        node.color = color;
        (node.children || []).forEach(c => applyColorRecursive(c, color));
    }
    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function newNodeSkeleton(color) {
        return { id: 'n' + Date.now() + Math.floor(Math.random() * 1000), text: '', color: color, collapsed: false, children: [] };
    }

    // ==== 自動保存 ====
    function setSaveStatus(status) {
        const el = document.getElementById('mm-save-status');
        if (!el) return;
        if (status === 'saved') el.innerHTML = '<i class="ph ph-check-circle"></i> 保存済み';
        else if (status === 'saving') el.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 保存中...';
        else el.innerHTML = '<i class="ph ph-circle-dashed"></i> 未保存の変更';
    }
    function scheduleSave() {
        mapData.updatedAt = new Date().toISOString();
        setSaveStatus('unsaved');
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(flushSave, 1000);
    }
    async function flushSave() {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        setSaveStatus('saving');
        try {
            await Store.saveMindmap(mindmapId, mapData);
            setSaveStatus('saved');
        } catch (e) {
            console.error('マインドマップの保存に失敗しました', e);
        }
    }

    // ==== レイアウト計算(左→右へ伸びるツリー型) ====
    function computeLayout() {
        let yCursor = 0;
        function visit(node, depth) {
            node._x = depth * NODE_H_SPACING;
            const visibleChildren = node.collapsed ? [] : (node.children || []);
            if (visibleChildren.length === 0) {
                node._y = yCursor;
                yCursor += NODE_V_SPACING;
            } else {
                const childYs = visibleChildren.map(c => visit(c, depth + 1));
                node._y = (Math.min(...childYs) + Math.max(...childYs)) / 2;
            }
            return node._y;
        }
        visit(mapData.root, 0);

        // バウンディングボックスを計算(オフセット計算・SVGサイズ決定用)
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        function collectBounds(node) {
            minX = Math.min(minX, node._x); maxX = Math.max(maxX, node._x);
            minY = Math.min(minY, node._y); maxY = Math.max(maxY, node._y);
            if (!node.collapsed) (node.children || []).forEach(collectBounds);
        }
        collectBounds(mapData.root);
        lastLayoutBounds = { minX, maxX, minY, maxY };
    }

    // ==== キャンバス描画 ====
    const canvasWrapper = () => document.getElementById('mm-canvas-wrapper');
    const canvasEl = () => document.getElementById('mm-canvas');

    function applyTransform() {
        const el = canvasEl();
        if (el) el.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    }

    function renderCanvas(focusNodeIdAfter) {
        computeLayout();
        const b = lastLayoutBounds;
        const offsetX = -b.minX + PADDING;
        const offsetY = -b.minY + PADDING;
        const svgW = (b.maxX - b.minX) + PADDING * 2 + 200;
        const svgH = (b.maxY - b.minY) + PADDING * 2 + 40;

        let nodesHtml = '';

        // ノード本体(枠)のみを先に組み立てる。エッジ(線)と折りたたみボタンの位置は
        // 実際にDOMへ描画されたあとの「本当の幅」を計測してから決める(下記2パス目)。
        // テキストの長さでノード幅が可変(min-width:120px〜max-width:200px)なため、
        // 幅を固定値と仮定して線を引くと、短いテキストのノードで線がノードの右端まで
        // 届かず「枝が離れて見える」問題が起きる。
        function visitRenderNodes(node, isRoot) {
            const x = node._x + offsetX;
            const y = node._y + offsetY;
            const rootClass = isRoot ? 'mm-root' : '';

            if (isRoot) {
                nodesHtml += `
                    <div class="mm-node ${rootClass}" data-id="${node.id}" style="left:${x}px; top:${y - 24}px; background:${node.color}; border-color:${node.color};">
                        <div class="mm-node-text" contenteditable="true" spellcheck="false" data-id="${node.id}">${escapeHtml(node.text)}</div>
                    </div>
                `;
            } else {
                nodesHtml += `
                    <div class="mm-node" data-id="${node.id}" style="left:${x}px; top:${y - 20}px; border-color:${node.color}; box-shadow: inset 0 0 0 9999px ${node.color}14;">
                        <span class="mm-grip" data-id="${node.id}" title="ドラッグして移動">⠿</span>
                        <div class="mm-node-text" contenteditable="true" spellcheck="false" data-id="${node.id}" style="color:${node.color};">${escapeHtml(node.text)}</div>
                        <button class="mm-del-btn" data-id="${node.id}" title="削除"><i class="ph ph-x"></i></button>
                    </div>
                `;
            }

            if (!node.collapsed) {
                (node.children || []).forEach(child => visitRenderNodes(child, false));
            }
        }
        visitRenderNodes(mapData.root, true);

        const el = canvasEl();
        if (!el) return;
        el.style.width = svgW + 'px';
        el.style.height = svgH + 'px';
        el.innerHTML = `
            <svg class="mm-edges" width="${svgW}" height="${svgH}"></svg>
            ${nodesHtml}
            <div class="mm-extras"></div>
        `;

        // 2パス目: 実測した各ノードの幅をもとに、線と折りたたみボタンの接続位置を確定する
        function measuredWidth(nodeId, fallback) {
            const elNode = el.querySelector(`.mm-node[data-id="${nodeId}"]`);
            return elNode ? elNode.offsetWidth : fallback;
        }

        let edgesHtml = '';
        let extrasHtml = '';
        function buildExtras(node, x, y, isRoot) {
            const w = measuredWidth(node.id, isRoot ? 160 : 200);
            const hasChildren = (node.children || []).length > 0;
            if (hasChildren) {
                extrasHtml += `<button class="mm-collapse-btn" data-id="${node.id}" style="left:${x + w}px; top:${y - 9}px; border-color:${node.color}; color:${node.color};">${node.collapsed ? '+' : '−'}</button>`;
            }
            if (!node.collapsed) {
                (node.children || []).forEach(child => {
                    const cx = child._x + offsetX;
                    const cy = child._y + offsetY;
                    const px = x + w;
                    const py = y;
                    const midX = (px + cx) / 2;
                    edgesHtml += `<path d="M ${px} ${py} C ${midX} ${py}, ${midX} ${cy}, ${cx} ${cy}" stroke="${child.color}" stroke-width="2.5" fill="none" opacity="0.6"/>`;
                    buildExtras(child, cx, cy, false);
                });
            }
        }
        buildExtras(mapData.root, mapData.root._x + offsetX, mapData.root._y + offsetY, true);

        const svgEl = el.querySelector('.mm-edges');
        if (svgEl) svgEl.innerHTML = edgesHtml;
        const extrasEl = el.querySelector('.mm-extras');
        if (extrasEl) extrasEl.innerHTML = extrasHtml;

        bindCanvasEvents();
        if (focusNodeIdAfter) focusNodeText(focusNodeIdAfter);
    }

    function focusNodeText(nodeId) {
        setTimeout(() => {
            const el = document.querySelector(`.mm-node-text[data-id="${nodeId}"]`);
            if (el) {
                el.focus();
                const range = document.createRange();
                range.selectNodeContents(el);
                range.collapse(false);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }, 0);
    }

    // ==== ツリー操作 ====
    function addChildNode(node) {
        const color = node.id === mapData.root.id ? nextBranchColor() : node.color;
        const child = newNodeSkeleton(color);
        if (!node.children) node.children = [];
        node.children.push(child);
        node.collapsed = false;
        scheduleSave();
        renderCanvas(child.id);
    }
    function addSiblingNode(node) {
        const parent = findParent(node.id);
        if (!parent) { addChildNode(node); return; }
        const sibling = newNodeSkeleton(node.color);
        const idx = parent.children.findIndex(c => c.id === node.id);
        parent.children.splice(idx + 1, 0, sibling);
        scheduleSave();
        renderCanvas(sibling.id);
    }
    function outdentNode(node) {
        const parent = findParent(node.id);
        if (!parent) return; // ルート自体は対象外
        const grandParent = findParent(parent.id);
        if (!grandParent) return; // 親がルート直下 = これ以上上げられない
        const idx = parent.children.findIndex(c => c.id === node.id);
        parent.children.splice(idx, 1);
        const parentIdx = grandParent.children.findIndex(c => c.id === parent.id);
        grandParent.children.splice(parentIdx + 1, 0, node);
        scheduleSave();
        renderCanvas(node.id);
    }
    function deleteNodeById(nodeId) {
        if (nodeId === mapData.root.id) return;
        const node = findNode(nodeId);
        if (!node) return;
        const hasChildren = (node.children || []).length > 0;
        if (hasChildren && !confirm('このノードには子ノードがあります。子ノードごと削除してもよろしいですか？')) return;
        const parent = findParent(nodeId);
        if (!parent) return;
        const idx = parent.children.findIndex(c => c.id === nodeId);
        parent.children.splice(idx, 1);
        scheduleSave();
        renderCanvas(parent.id);
    }
    function reparentNode(nodeId, newParentId) {
        if (nodeId === newParentId || nodeId === mapData.root.id) return;
        const node = findNode(nodeId);
        const newParent = findNode(newParentId);
        if (!node || !newParent) return;
        if (isDescendant(node, newParentId)) return; // 循環防止
        const oldParent = findParent(nodeId);
        if (!oldParent) return;
        const idx = oldParent.children.findIndex(c => c.id === nodeId);
        oldParent.children.splice(idx, 1);
        if (!newParent.children) newParent.children = [];
        newParent.children.push(node);
        newParent.collapsed = false;
        if (newParentId !== mapData.root.id) applyColorRecursive(node, newParent.color);
        scheduleSave();
        renderCanvas();
    }
    function toggleCollapse(nodeId) {
        const node = findNode(nodeId);
        if (!node) return;
        node.collapsed = !node.collapsed;
        scheduleSave();
        renderCanvas();
    }
    function setNodeColor(nodeId, color) {
        const node = findNode(nodeId);
        if (!node) return;
        applyColorRecursive(node, color);
        scheduleSave();
        renderCanvas();
    }

    // ==== キャンバス内イベント(ノード操作・ドラッグ・折りたたみ) ====
    function bindCanvasEvents() {
        document.querySelectorAll('.mm-node-text').forEach(textEl => {
            const nodeId = textEl.getAttribute('data-id');
            textEl.addEventListener('focus', () => {
                textEl.closest('.mm-node').classList.add('active');
                showColorPanel(nodeId);
            });
            textEl.addEventListener('blur', () => {
                const node = findNode(nodeId);
                if (node) {
                    const trimmed = textEl.innerText.trim();
                    node.text = trimmed || (nodeId === mapData.root.id ? '中心テーマ' : '無題');
                    scheduleSave();
                }
                const cardEl = textEl.closest('.mm-node');
                if (cardEl) cardEl.classList.remove('active');
                hideColorPanel();
            });
            textEl.addEventListener('input', () => {
                const node = findNode(nodeId);
                if (node) { node.text = textEl.innerText; scheduleSave(); }
            });
            textEl.addEventListener('keydown', (e) => {
                const node = findNode(nodeId);
                if (!node) return;
                if (e.key === 'Tab') {
                    e.preventDefault();
                    node.text = textEl.innerText;
                    if (e.shiftKey) outdentNode(node); else addChildNode(node);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    node.text = textEl.innerText;
                    if (e.shiftKey) {
                        // Shift+Enter: 横方向(子ノード)へツリーを伸ばす
                        addChildNode(node);
                    } else if (nodeId === mapData.root.id) {
                        addChildNode(node);
                    } else {
                        addSiblingNode(node);
                    }
                } else if (e.key === 'Backspace') {
                    if (textEl.innerText.trim() === '' && nodeId !== mapData.root.id) {
                        e.preventDefault();
                        deleteNodeById(nodeId);
                    }
                } else if (e.key === 'Escape') {
                    textEl.blur();
                }
            });
        });

        document.querySelectorAll('.mm-collapse-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleCollapse(btn.getAttribute('data-id'));
            });
        });

        document.querySelectorAll('.mm-del-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteNodeById(btn.getAttribute('data-id'));
            });
        });

        document.querySelectorAll('.mm-grip').forEach(grip => {
            grip.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                draggingNodeId = grip.getAttribute('data-id');
                document.body.style.cursor = 'grabbing';
                const hint = document.getElementById('mm-drag-hint');
                if (hint) hint.style.display = 'block';
            });
        });

        document.querySelectorAll('.mm-node').forEach(nodeEl => {
            const id = nodeEl.getAttribute('data-id');
            nodeEl.addEventListener('mouseenter', () => {
                if (draggingNodeId && draggingNodeId !== id) {
                    const draggedNode = findNode(draggingNodeId);
                    if (draggedNode && !isDescendant(draggedNode, id)) {
                        dropTargetId = id;
                        nodeEl.classList.add('mm-drop-target');
                    }
                }
            });
            nodeEl.addEventListener('mouseleave', () => {
                nodeEl.classList.remove('mm-drop-target');
                if (dropTargetId === id) dropTargetId = null;
            });
        });
    }

    // ==== ドラッグ終了(ドロップ)の検知 ====
    window.addEventListener('mouseup', () => {
        if (draggingNodeId) {
            if (dropTargetId && dropTargetId !== draggingNodeId) {
                reparentNode(draggingNodeId, dropTargetId);
            }
            draggingNodeId = null;
            dropTargetId = null;
            document.body.style.cursor = '';
            document.querySelectorAll('.mm-drop-target').forEach(el => el.classList.remove('mm-drop-target'));
            const hint = document.getElementById('mm-drag-hint');
            if (hint) hint.style.display = 'none';
        }
    });

    // ==== 選択中ノードの色パネル ====
    function showColorPanel(nodeId) {
        const panel = document.getElementById('mm-color-panel');
        if (!panel) return;
        if (nodeId === mapData.root.id) { panel.style.display = 'none'; return; }
        panel.style.display = 'flex';
        panel.querySelectorAll('.mm-color-swatch').forEach(sw => {
            sw.onclick = (e) => {
                e.preventDefault();
                setNodeColor(nodeId, sw.getAttribute('data-color'));
                focusNodeText(nodeId);
            };
        });
    }
    function hideColorPanel() {
        setTimeout(() => {
            if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('mm-node-text')) return;
            const panel = document.getElementById('mm-color-panel');
            if (panel) panel.style.display = 'none';
        }, 150);
    }

    // ==== ズーム・パン ====
    function zoomAt(clientX, clientY, factor) {
        const wrapper = canvasWrapper();
        const rect = wrapper.getBoundingClientRect();
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;
        const worldX = (mouseX - panX) / zoom;
        const worldY = (mouseY - panY) / zoom;
        zoom = Math.min(2, Math.max(0.25, zoom * factor));
        panX = mouseX - worldX * zoom;
        panY = mouseY - worldY * zoom;
        applyTransform();
    }
    function fitToScreen() {
        const wrapper = canvasWrapper();
        if (!wrapper || !lastLayoutBounds) return;
        const rect = wrapper.getBoundingClientRect();
        const b = lastLayoutBounds;
        const treeW = (b.maxX - b.minX) + 240;
        const treeH = (b.maxY - b.minY) + 100;
        const scaleX = rect.width / treeW;
        const scaleY = rect.height / treeH;
        zoom = Math.min(1, Math.min(scaleX, scaleY));
        zoom = Math.max(0.25, zoom);
        panX = (rect.width - treeW * zoom) / 2 - (b.minX - PADDING) * zoom;
        panY = (rect.height - treeH * zoom) / 2 - (b.minY - PADDING) * zoom;
        applyTransform();
    }

    // ==== ページシェル(ツールバー+キャンバス枠)を最初に1回だけ描画 ====
    function mountShell() {
        const html = `
            <style>
                .mm-page { display:flex; flex-direction:column; height: calc(100vh - 80px); }
                .mm-toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
                .mm-toolbar-left { display:flex; align-items:center; gap:12px; flex:1; min-width:240px; }
                .mm-toolbar-right { display:flex; align-items:center; gap:8px; }
                #mm-save-status { font-size:0.8rem; color:var(--text-secondary); white-space:nowrap; }
                .mm-canvas-shell { flex:1; position:relative; background:#f8f9fc; border-radius:12px; overflow:hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
                #mm-canvas-wrapper { position:absolute; inset:0; overflow:hidden; cursor:grab; }
                #mm-canvas-wrapper.panning { cursor:grabbing; }
                #mm-canvas { position:absolute; top:0; left:0; transform-origin: 0 0; }
                .mm-edges { position:absolute; top:0; left:0; pointer-events:none; }
                .mm-node { position:absolute; min-width:120px; max-width:200px; padding:10px 14px; border-radius:10px; border:2px solid #0d6efd; background:white; box-shadow:0 2px 8px rgba(0,0,0,0.08); display:flex; align-items:center; gap:6px; transition: box-shadow 0.15s; }
                .mm-node.active { box-shadow:0 4px 16px rgba(13,110,253,0.35); }
                .mm-node.mm-drop-target { box-shadow:0 0 0 3px #ffc107, 0 4px 16px rgba(0,0,0,0.2); }
                .mm-node.mm-root { min-width:160px; padding:14px 20px; border-radius:14px; justify-content:center; box-shadow:0 6px 18px rgba(0,0,0,0.15); }
                .mm-node.mm-root .mm-node-text { color:white; font-weight:700; font-size:1.05rem; text-align:center; }
                .mm-node-text { outline:none; font-size:0.9rem; font-weight:600; word-break:break-word; white-space:pre-wrap; flex:1; min-width:40px; color:#1a1a1a; }
                .mm-node-text:empty::before { content: '入力してください'; color:#aaa; font-weight:400; }
                .mm-grip { cursor:grab; color:#bbb; font-size:0.85rem; user-select:none; flex-shrink:0; }
                .mm-grip:hover { color:#666; }
                .mm-del-btn { border:none; background:transparent; color:#ccc; cursor:pointer; padding:2px; flex-shrink:0; display:flex; align-items:center; opacity:0; transition:opacity 0.15s; }
                .mm-node:hover .mm-del-btn { opacity:1; }
                .mm-del-btn:hover { color:#dc3545; }
                .mm-collapse-btn { position:absolute; width:20px; height:20px; border-radius:50%; border:1.5px solid #0d6efd; background:white; color:#0d6efd; font-size:0.85rem; font-weight:700; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0; z-index:2; }
                .mm-color-panel { position:absolute; bottom:16px; left:50%; transform:translateX(-50%); background:white; border-radius:10px; box-shadow:0 4px 16px rgba(0,0,0,0.15); padding:8px; display:none; gap:6px; z-index:20; }
                .mm-color-swatch { width:22px; height:22px; border-radius:50%; cursor:pointer; border:2px solid white; box-shadow:0 0 0 1px rgba(0,0,0,0.1); }
                #mm-drag-hint { display:none; position:absolute; top:12px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.75); color:white; font-size:0.8rem; padding:6px 14px; border-radius:20px; z-index:20; }
                .mm-hint-panel { font-size:0.78rem; color:var(--text-secondary); background:#f8f9fc; border-radius:8px; padding:6px 12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            </style>
            <div class="mm-page">
                <div class="mm-toolbar">
                    <div class="mm-toolbar-left">
                        <button class="btn btn-secondary btn-sm" id="mm-back-btn"><i class="ph ph-list"></i> 一覧へ戻る</button>
                        <input type="text" id="mm-title-input" class="input-field" style="max-width:280px; margin-bottom:0;" value="${escapeHtml(mapData.title || '')}" placeholder="マインドマップのタイトル">
                        <span id="mm-save-status"><i class="ph ph-check-circle"></i> 保存済み</span>
                    </div>
                    <div class="mm-toolbar-right">
                        <span class="mm-hint-panel">Tab/Shift+Enter:子ノード(横) / Enter:兄弟ノード(縦) / ⠿ドラッグ:移動</span>
                        <button class="btn btn-secondary btn-sm" id="mm-zoom-out-btn"><i class="ph ph-minus"></i></button>
                        <button class="btn btn-secondary btn-sm" id="mm-zoom-fit-btn"><i class="ph ph-arrows-out"></i> 全体表示</button>
                        <button class="btn btn-secondary btn-sm" id="mm-zoom-in-btn"><i class="ph ph-plus"></i></button>
                    </div>
                </div>
                <div class="mm-canvas-shell">
                    <div id="mm-canvas-wrapper">
                        <div id="mm-canvas"></div>
                    </div>
                    <div id="mm-drag-hint">別のノードの上でマウスを離すと、そこに移動します</div>
                    <div class="mm-color-panel" id="mm-color-panel">
                        ${BRANCH_PALETTE.map(c => `<span class="mm-color-swatch" data-color="${c}" style="background:${c};"></span>`).join('')}
                    </div>
                </div>
            </div>
        `;

        App.mount(html, () => {
            document.getElementById('mm-back-btn').addEventListener('click', async () => {
                await flushSave();
                App.navigate('mindmaps');
            });

            const titleInput = document.getElementById('mm-title-input');
            titleInput.addEventListener('input', () => {
                mapData.title = titleInput.value;
                scheduleSave();
            });
            titleInput.addEventListener('blur', () => {
                if (!mapData.title || !mapData.title.trim()) {
                    mapData.title = '無題のマインドマップ';
                    titleInput.value = mapData.title;
                    scheduleSave();
                }
            });

            document.getElementById('mm-zoom-in-btn').addEventListener('click', () => {
                const rect = canvasWrapper().getBoundingClientRect();
                zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.2);
            });
            document.getElementById('mm-zoom-out-btn').addEventListener('click', () => {
                const rect = canvasWrapper().getBoundingClientRect();
                zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.2);
            });
            document.getElementById('mm-zoom-fit-btn').addEventListener('click', fitToScreen);

            const wrapper = canvasWrapper();
            wrapper.addEventListener('mousedown', (e) => {
                if (e.target.closest('.mm-node') || e.target.closest('.mm-collapse-btn')) return;
                isPanning = true;
                wrapper.classList.add('panning');
                panStartX = e.clientX; panStartY = e.clientY;
                panOriginX = panX; panOriginY = panY;
            });
            window.addEventListener('mousemove', (e) => {
                if (isPanning) {
                    panX = panOriginX + (e.clientX - panStartX);
                    panY = panOriginY + (e.clientY - panStartY);
                    applyTransform();
                }
            });
            window.addEventListener('mouseup', () => {
                isPanning = false;
                wrapper.classList.remove('panning');
            });

            // タッチ操作(1本指)での画面移動にも簡易対応
            wrapper.addEventListener('touchstart', (e) => {
                if (e.target.closest('.mm-node') || e.target.closest('.mm-collapse-btn')) return;
                if (e.touches.length !== 1) return;
                isPanning = true;
                panStartX = e.touches[0].clientX; panStartY = e.touches[0].clientY;
                panOriginX = panX; panOriginY = panY;
            }, { passive: true });
            wrapper.addEventListener('touchmove', (e) => {
                if (isPanning && e.touches.length === 1) {
                    panX = panOriginX + (e.touches[0].clientX - panStartX);
                    panY = panOriginY + (e.touches[0].clientY - panStartY);
                    applyTransform();
                }
            }, { passive: true });
            wrapper.addEventListener('touchend', () => { isPanning = false; });

            wrapper.addEventListener('wheel', (e) => {
                e.preventDefault();
                const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
                zoomAt(e.clientX, e.clientY, factor);
            }, { passive: false });

            renderCanvas();
            setTimeout(fitToScreen, 50);
        });
    }

    mountShell();
};
