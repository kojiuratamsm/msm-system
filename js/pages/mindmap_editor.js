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
//   ・Ctrl+Enter(Macは⌘+Enter) → ノードのテキスト内で改行(通常は自分で改行しない限り
//       折り返さず1行のまま表示される。長い文章はノードの横幅が伸びて対応する)
//   ・文字をドラッグして選択 → 太字・文字色・マーカー(蛍光ペン)を付けられるツールバーが出る
//   ・ノード左端の「⠿」をつかんでドラッグ →
//       他のノードの上でマウスを離す:親ノードを変更
//       何もない場所でマウスを離す:そのノード(と配下の枝)を自由な位置へ移動
//   ・ノード横の丸ボタン → 子ノードの折りたたみ/展開
//   ・トラックパッドを二本指で動かす(スワイプ) → 画面移動(パン)
//   ・トラックパッドを二本指でつまむ/開く(ピンチ)、マウスホイール、ズームボタン → 拡大縮小
//   ・背景をドラッグ → 画面移動
//
// データはservice_type='mindmap'としてcustomersテーブルに複数保存され、
// 入力停止から約1秒後に自動保存される(Store.saveMindmap、詳細はjs/state.js参照)。
// ノードの手動配置のズレはnode.offsetX/offsetYとして保存され、親が変わると自動でリセットされる。
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
    const TEXT_COLOR_PALETTE = ['#1a1a1a', '#dc3545', '#0d6efd', '#198754', '#fd7e14'];
    const MARKER_COLOR_PALETTE = ['#fff59d', '#a5d6ff', '#b2f2bb', '#ffc9de'];
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
    let dragStartClientX = 0, dragStartClientY = 0;
    let dragNodeEl = null;
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
    // ノードのテキストには「太字・文字色・マーカー(背景色)・改行」だけを許可した
    // ごく限定的なHTMLを保存できるようにする。contenteditableのinnerHTMLをそのまま
    // 保存/表示すると余計なタグや属性が混ざる(あるいは安全性の問題が起きる)ため、
    // 許可したタグ(b/strong/i/em/mark/span[style=color/background-colorのみ]/br)以外は
    // タグだけ剥がしてテキストは残す、という方針でサニタイズする。
    // 許可していないタグの中身も含めてテキストとして扱うので、既存のプレーンテキストの
    // データ(絵文字や記号など)をそのまま渡しても壊れない。
    const MM_ALLOWED_INLINE_TAGS = { B: 1, STRONG: 1, I: 1, EM: 1, MARK: 1, SPAN: 1 };
    function sanitizeNodeHtml(rawHtml) {
        const container = document.createElement('div');
        container.innerHTML = String(rawHtml || '');
        function walk(node) {
            let out = '';
            node.childNodes.forEach(child => {
                if (child.nodeType === Node.TEXT_NODE) {
                    out += escapeHtml(child.nodeValue);
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    const tag = child.tagName;
                    if (tag === 'BR') {
                        out += '<br>';
                    } else if (tag === 'DIV' || tag === 'P') {
                        // contenteditableがEnterで<div>/<p>を生成する場合があるため改行として扱う
                        out += (out ? '<br>' : '') + walk(child);
                    } else if (MM_ALLOWED_INLINE_TAGS[tag]) {
                        let styleAttr = '';
                        if (tag === 'SPAN' && child.style) {
                            const parts = [];
                            if (child.style.color) parts.push(`color:${child.style.color}`);
                            if (child.style.backgroundColor) parts.push(`background-color:${child.style.backgroundColor}`);
                            if (parts.length) styleAttr = ` style="${parts.join(';')}"`;
                        }
                        const inner = walk(child);
                        if (tag === 'SPAN' && !styleAttr) {
                            out += inner; // スタイルの無いspanは意味が無いので剥がす
                        } else {
                            const lower = tag.toLowerCase();
                            out += `<${lower}${styleAttr}>${inner}</${lower}>`;
                        }
                    } else {
                        out += walk(child); // 許可されていないタグは中身だけ残す
                    }
                }
            });
            return out;
        }
        return walk(container);
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

        // バウンディングボックスを計算(オフセット計算・SVGサイズ決定用)。
        // 手動で動かしたノード(offsetX/offsetY、子孫にも累積)がキャンバス外へ
        // はみ出さないよう、ここでも同じ累積オフセットを考慮する。
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        function collectBounds(node, ancestorOffsetX, ancestorOffsetY) {
            const cumOffsetX = ancestorOffsetX + (node.offsetX || 0);
            const cumOffsetY = ancestorOffsetY + (node.offsetY || 0);
            const x = node._x + cumOffsetX;
            const y = node._y + cumOffsetY;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            if (!node.collapsed) (node.children || []).forEach(c => collectBounds(c, cumOffsetX, cumOffsetY));
        }
        collectBounds(mapData.root, 0, 0);
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
        //
        // ノードは自動レイアウト(depth×間隔)の位置を基本としつつ、node.offsetX/offsetY に
        // 手動で動かした分のズレを保持できる。祖先ノードのズレは子孫にも累積して伝わるため、
        // 枝(サブツリー)をまとめてドラッグで動かすと、その配下のノードごと一緒に動く。
        function visitRenderNodes(node, isRoot, ancestorOffsetX, ancestorOffsetY) {
            const cumOffsetX = ancestorOffsetX + (node.offsetX || 0);
            const cumOffsetY = ancestorOffsetY + (node.offsetY || 0);
            const x = node._x + offsetX + cumOffsetX;
            const y = node._y + offsetY + cumOffsetY;
            // buildExtras(線・折りたたみボタン)で再利用するため、最終的な画面座標を保存しておく
            node._finalX = x;
            node._finalY = y;
            const rootClass = isRoot ? 'mm-root' : '';

            if (isRoot) {
                nodesHtml += `
                    <div class="mm-node ${rootClass}" data-id="${node.id}" style="left:${x}px; top:${y - 24}px; background:${node.color}; border-color:${node.color};">
                        <div class="mm-node-text" contenteditable="true" spellcheck="false" data-id="${node.id}">${sanitizeNodeHtml(node.text)}</div>
                    </div>
                `;
            } else {
                nodesHtml += `
                    <div class="mm-node" data-id="${node.id}" style="left:${x}px; top:${y - 20}px; border-color:${node.color}; box-shadow: inset 0 0 0 9999px ${node.color}14;">
                        <span class="mm-grip" data-id="${node.id}" title="ドラッグして移動(ノードの上でドロップ:親を変更 / 何もない場所でドロップ:自由配置)">⠿</span>
                        <div class="mm-node-text" contenteditable="true" spellcheck="false" data-id="${node.id}" style="color:${node.color};">${sanitizeNodeHtml(node.text)}</div>
                        <button class="mm-del-btn" data-id="${node.id}" title="削除"><i class="ph ph-x"></i></button>
                    </div>
                `;
            }

            if (!node.collapsed) {
                (node.children || []).forEach(child => visitRenderNodes(child, false, cumOffsetX, cumOffsetY));
            }
        }
        visitRenderNodes(mapData.root, true, 0, 0);

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
        function buildExtras(node, isRoot) {
            const x = node._finalX;
            const y = node._finalY;
            const w = measuredWidth(node.id, isRoot ? 160 : 200);
            const hasChildren = (node.children || []).length > 0;
            if (hasChildren) {
                extrasHtml += `<button class="mm-collapse-btn" data-id="${node.id}" style="left:${x + w}px; top:${y - 9}px; border-color:${node.color}; color:${node.color};">${node.collapsed ? '+' : '−'}</button>`;
            }
            if (!node.collapsed) {
                (node.children || []).forEach(child => {
                    const cx = child._finalX;
                    const cy = child._finalY;
                    const px = x + w;
                    const py = y;
                    const midX = (px + cx) / 2;
                    edgesHtml += `<path d="M ${px} ${py} C ${midX} ${py}, ${midX} ${cy}, ${cx} ${cy}" stroke="${child.color}" stroke-width="2.5" fill="none" opacity="0.6"/>`;
                    buildExtras(child, false);
                });
            }
        }
        buildExtras(mapData.root, true);

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
        // 親が変わったら、以前の手動配置のズレは持ち越さず新しい親の下の基本位置に戻す
        node.offsetX = 0;
        node.offsetY = 0;
        scheduleSave();
        renderCanvas();
    }
    function repositionNode(nodeId, dx, dy) {
        // ノードをドラッグして何もない場所でドロップしたときの「自由配置」。
        // 既存のズレに加算するので、同じノードを何度もドラッグして微調整できる。
        const node = findNode(nodeId);
        if (!node) return;
        node.offsetX = (node.offsetX || 0) + dx;
        node.offsetY = (node.offsetY || 0) + dy;
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
                    node.text = trimmed ? sanitizeNodeHtml(textEl.innerHTML) : (nodeId === mapData.root.id ? '中心テーマ' : '無題');
                    scheduleSave();
                }
                const cardEl = textEl.closest('.mm-node');
                if (cardEl) cardEl.classList.remove('active');
                hideColorPanel();
            });
            textEl.addEventListener('input', () => {
                const node = findNode(nodeId);
                if (node) { node.text = sanitizeNodeHtml(textEl.innerHTML); scheduleSave(); }
            });
            // 日本語入力(IME)で変換候補を確定するときのEnterキーを、
            // 「兄弟ノードを追加する」Enterと誤判定しないためのフラグ管理。
            // compositionstart〜compositionendの間はIME変換中とみなし、
            // その間のEnter/Tabキーはノード追加処理に渡さない。
            textEl.addEventListener('compositionstart', () => {
                textEl.dataset.imeComposing = '1';
            });
            textEl.addEventListener('compositionend', () => {
                // compositionendの直後に発火するkeydown(確定用Enter)と競合しないよう、
                // 1ティック遅らせてフラグを解除する。
                setTimeout(() => { textEl.dataset.imeComposing = ''; }, 0);
            });
            textEl.addEventListener('keydown', (e) => {
                if (e.isComposing || e.keyCode === 229 || textEl.dataset.imeComposing === '1') {
                    // IME変換中の確定キー操作(Enter等)はスルーする
                    return;
                }
                const node = findNode(nodeId);
                if (!node) return;
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    // Ctrl(Mac:Cmd)+Enter: ノードを増やすのではなく、テキスト内に改行を挿入する。
                    // (Enter/Shift+Enterは既にノード追加の操作として使っているため、
                    //  文章の途中で改行したいときはこちらを使う)
                    e.preventDefault();
                    // insertHTMLで<br>要素を挿入すると、末尾では次に入力した文字が
                    // <br>より前に入ってしまうことがある(contenteditableのカーソル位置の仕様上の癖)。
                    // 改行文字\nをテキストとして挿入する方が、通常の文字入力と同じ扱いになり確実。
                    // (.mm-node-textはwhite-space:preのため、\nはそのまま改行として表示される)
                    document.execCommand('insertText', false, '\n');
                    node.text = sanitizeNodeHtml(textEl.innerHTML);
                    scheduleSave();
                    return;
                }
                if (e.key === 'Tab') {
                    e.preventDefault();
                    node.text = sanitizeNodeHtml(textEl.innerHTML);
                    if (e.shiftKey) outdentNode(node); else addChildNode(node);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    node.text = sanitizeNodeHtml(textEl.innerHTML);
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
                dragStartClientX = e.clientX;
                dragStartClientY = e.clientY;
                dragNodeEl = grip.closest('.mm-node');
                if (dragNodeEl) {
                    dragNodeEl.style.zIndex = '10';
                    // ドラッグ中のノード自身がカーソル直下に重なってしまうと、その下にある
                    // ドロップ先ノードのmouseenterを奪ってしまい「親の変更」が反応しなくなるため、
                    // ドラッグ中だけこのノードへのポインターイベントを無効にする。
                    dragNodeEl.style.pointerEvents = 'none';
                }
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

    // ==== ドラッグ中の見た目の追従(掴んだノードだけをカーソルに合わせて動かす) ====
    window.addEventListener('mousemove', (e) => {
        if (draggingNodeId && dragNodeEl) {
            const dx = (e.clientX - dragStartClientX) / zoom;
            const dy = (e.clientY - dragStartClientY) / zoom;
            dragNodeEl.style.transform = `translate(${dx}px, ${dy}px)`;
        }
    });

    // ==== ドラッグ終了(ドロップ)の検知 ====
    // ・他のノードの上でドロップ → 親ノードを変更(既存の挙動)
    // ・何もない場所でドロップ → そのノード(と配下の枝)を自由な位置へ移動
    window.addEventListener('mouseup', (e) => {
        if (draggingNodeId) {
            const id = draggingNodeId;
            const dx = (e.clientX - dragStartClientX) / zoom;
            const dy = (e.clientY - dragStartClientY) / zoom;
            const moved = Math.abs(dx) > 3 || Math.abs(dy) > 3;

            if (dragNodeEl) {
                dragNodeEl.style.transform = '';
                dragNodeEl.style.zIndex = '';
                dragNodeEl.style.pointerEvents = '';
            }

            if (dropTargetId && dropTargetId !== id) {
                reparentNode(id, dropTargetId);
            } else if (moved) {
                repositionNode(id, dx, dy);
            }

            draggingNodeId = null;
            dropTargetId = null;
            dragNodeEl = null;
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

    // ==== 文字を選択したときの書式ツールバー(太字・文字色・マーカー) ====
    // ノードのテキストの一部だけを選択して、その部分だけ太字/色/マーカーを付けられる。
    function closestNodeTextEl(node) {
        const el = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
        return el ? el.closest('.mm-node-text') : null;
    }
    function updateFormatToolbar() {
        const toolbar = document.getElementById('mm-format-toolbar');
        if (!toolbar) return;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
            toolbar.style.display = 'none';
            return;
        }
        const textEl = closestNodeTextEl(sel.anchorNode);
        if (!textEl) {
            toolbar.style.display = 'none';
            return;
        }
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) {
            toolbar.style.display = 'none';
            return;
        }
        toolbar.style.display = 'flex';
        toolbar.style.left = (rect.left + rect.width / 2) + 'px';
        toolbar.style.top = Math.max(46, rect.top) + 'px';
    }
    function saveTextElContent(textEl) {
        const nodeId = textEl.getAttribute('data-id');
        const node = findNode(nodeId);
        if (node) { node.text = sanitizeNodeHtml(textEl.innerHTML); scheduleSave(); }
    }
    // 太字は document.execCommand('bold') に任せない。
    // ノードのテキストはデフォルトで font-weight:600 (少し太め)のスタイルを当てているため、
    // ブラウザの「すでに太字かどうか」の判定がこの既定の太さに引っ張られてしまい、
    // ボタンを押すと逆に細く(normal)なってしまう不具合があった。
    // そのため、<b>タグで囲む/剥がすことを自前で行い、タグの有無だけで太字状態を判定する。
    function toggleBoldOnSelection() {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
        const range = sel.getRangeAt(0);
        let ancestor = range.commonAncestorContainer;
        if (ancestor.nodeType !== 1) ancestor = ancestor.parentElement;
        const boldTag = ancestor ? ancestor.closest('b, strong') : null;
        if (boldTag) {
            const parent = boldTag.parentNode;
            while (boldTag.firstChild) parent.insertBefore(boldTag.firstChild, boldTag);
            parent.removeChild(boldTag);
            return;
        }
        try {
            const wrapper = document.createElement('b');
            wrapper.appendChild(range.extractContents());
            range.insertNode(wrapper);
            const newRange = document.createRange();
            newRange.selectNodeContents(wrapper);
            sel.removeAllRanges();
            sel.addRange(newRange);
        } catch (err) {
            // 選択範囲の構造上むずかしい場合の保険
            document.execCommand('bold');
        }
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
                .mm-node { position:absolute; min-width:120px; max-width:640px; padding:10px 14px; border-radius:10px; border:2px solid #0d6efd; background:white; box-shadow:0 2px 8px rgba(0,0,0,0.08); display:flex; align-items:center; gap:6px; transition: box-shadow 0.15s; }
                .mm-node.active { box-shadow:0 4px 16px rgba(13,110,253,0.35); }
                .mm-node.mm-drop-target { box-shadow:0 0 0 3px #ffc107, 0 4px 16px rgba(0,0,0,0.2); }
                .mm-node.mm-root { min-width:160px; padding:14px 20px; border-radius:14px; justify-content:center; box-shadow:0 6px 18px rgba(0,0,0,0.15); }
                .mm-node.mm-root .mm-node-text { color:white; font-weight:700; font-size:1.05rem; text-align:center; }
                /* 自分で改行(Ctrl/Cmd+Enter)しない限り折り返さない。長い文章はノードの幅が伸びて1行のまま表示される */
                .mm-node-text { outline:none; font-size:0.9rem; font-weight:600; white-space:pre; flex:1; min-width:40px; color:#1a1a1a; }
                .mm-node-text:empty::before { content: '入力してください'; color:#aaa; font-weight:400; }
                .mm-node-text b, .mm-node-text strong { font-weight:800; }
                .mm-node-text mark { border-radius:2px; padding:0 1px; }
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
                /* テキストを選択したときに出る書式ツールバー(太字・文字色・マーカー) */
                #mm-format-toolbar { display:none; position:fixed; transform:translate(-50%,-100%); background:#2b2b2f; border-radius:10px; box-shadow:0 6px 20px rgba(0,0,0,0.3); padding:6px 8px; align-items:center; gap:5px; z-index:100; }
                #mm-format-toolbar button { border:none; background:transparent; cursor:pointer; padding:0; display:flex; align-items:center; justify-content:center; }
                #mm-format-toolbar .mm-fmt-bold { width:26px; height:26px; border-radius:6px; color:white; font-size:0.85rem; }
                #mm-format-toolbar .mm-fmt-bold:hover { background:rgba(255,255,255,0.15); }
                #mm-format-toolbar .mm-fmt-sep { width:1px; height:18px; background:rgba(255,255,255,0.2); margin:0 2px; }
                #mm-format-toolbar .mm-fmt-swatch { width:18px; height:18px; border-radius:50%; border:1.5px solid rgba(255,255,255,0.5); }
                #mm-format-toolbar .mm-fmt-swatch:hover { transform:scale(1.15); }
                #mm-format-toolbar .mm-fmt-mark { width:18px; height:18px; border-radius:4px; border:1.5px solid rgba(255,255,255,0.5); }
                #mm-format-toolbar .mm-fmt-clear { width:22px; height:22px; border-radius:6px; color:white; font-size:0.75rem; }
                #mm-format-toolbar .mm-fmt-clear:hover { background:rgba(255,255,255,0.15); }
            </style>
            <div class="mm-page">
                <div class="mm-toolbar">
                    <div class="mm-toolbar-left">
                        <button class="btn btn-secondary btn-sm" id="mm-back-btn"><i class="ph ph-list"></i> 一覧へ戻る</button>
                        <input type="text" id="mm-title-input" class="input-field" style="max-width:280px; margin-bottom:0;" value="${escapeHtml(mapData.title || '')}" placeholder="マインドマップのタイトル">
                        <span id="mm-save-status"><i class="ph ph-check-circle"></i> 保存済み</span>
                    </div>
                    <div class="mm-toolbar-right">
                        <span class="mm-hint-panel">Tab/Shift+Enter:子ノード(横) / Enter:兄弟ノード(縦) / Ctrl(⌘)+Enter:改行 / ⠿ドラッグ:移動・配置</span>
                        <button class="btn btn-secondary btn-sm" id="mm-zoom-out-btn"><i class="ph ph-minus"></i></button>
                        <button class="btn btn-secondary btn-sm" id="mm-zoom-fit-btn"><i class="ph ph-arrows-out"></i> 全体表示</button>
                        <button class="btn btn-secondary btn-sm" id="mm-zoom-in-btn"><i class="ph ph-plus"></i></button>
                    </div>
                </div>
                <div class="mm-canvas-shell">
                    <div id="mm-canvas-wrapper">
                        <div id="mm-canvas"></div>
                    </div>
                    <div id="mm-drag-hint">ノードの上で離す:親を変更 / 何もない場所で離す:自由に配置</div>
                    <div class="mm-color-panel" id="mm-color-panel">
                        ${BRANCH_PALETTE.map(c => `<span class="mm-color-swatch" data-color="${c}" style="background:${c};"></span>`).join('')}
                    </div>
                </div>
            </div>
            <!-- 文字を選択すると表示される書式ツールバー(太字/文字色/マーカー) -->
            <div id="mm-format-toolbar">
                <button type="button" class="mm-fmt-bold" data-cmd="bold" title="太字"><b>B</b></button>
                <span class="mm-fmt-sep"></span>
                ${TEXT_COLOR_PALETTE.map(c => `<button type="button" class="mm-fmt-swatch" data-cmd="foreColor" data-color="${c}" style="background:${c};" title="文字色"></button>`).join('')}
                <span class="mm-fmt-sep"></span>
                ${MARKER_COLOR_PALETTE.map(c => `<button type="button" class="mm-fmt-mark" data-cmd="hiliteColor" data-color="${c}" style="background:${c};" title="マーカー"></button>`).join('')}
                <button type="button" class="mm-fmt-clear" data-cmd="hiliteColor" data-color="transparent" title="マーカーを消す"><i class="ph ph-eraser"></i></button>
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

            // トラックパッドの「二本指で動かす(スワイプ)」は画面移動(パン)、
            // 「二本指で開く/閉じる(ピンチ)」は拡大縮小として扱う。
            // ブラウザ仕様上、トラックパッドのピンチ操作はwheelイベントに
            // ctrlKey:true が自動的に付与されて送られてくる(実際にCtrlキーを
            // 押していなくても、ブラウザがピンチジェスチャーをそう伝える)ため、
            // これを判定材料にする。マウスホイールやCtrl+スクロールも同様に
            // 拡大縮小として扱われる。
            wrapper.addEventListener('wheel', (e) => {
                e.preventDefault();
                if (e.ctrlKey) {
                    // ピンチズーム(またはCtrl+ホイール)
                    const factor = e.deltaY < 0 ? 1.04 : 1 / 1.04;
                    zoomAt(e.clientX, e.clientY, factor);
                } else {
                    // 二本指スワイプ = 画面移動(パン)
                    panX -= e.deltaX;
                    panY -= e.deltaY;
                    applyTransform();
                }
            }, { passive: false });

            // 文字色/マーカーのコマンドが<font>タグ等の古い書き方にならないよう、
            // CSS(style属性)で反映させる設定にしておく(1回でよい)。
            try { document.execCommand('styleWithCSS', false, true); } catch (err) { /* 非対応ブラウザは無視 */ }

            // テキストの一部を選択すると書式ツールバーを表示する
            document.addEventListener('selectionchange', updateFormatToolbar);

            document.querySelectorAll('#mm-format-toolbar button').forEach(btn => {
                // mousedownでpreventDefaultしないと、ボタンをクリックした時点で
                // contenteditableからフォーカスが外れ、選択範囲が失われてしまう
                btn.addEventListener('mousedown', (e) => e.preventDefault());
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const sel = window.getSelection();
                    const textEl = sel && sel.rangeCount ? closestNodeTextEl(sel.anchorNode) : null;
                    const cmd = btn.getAttribute('data-cmd');
                    const color = btn.getAttribute('data-color');
                    if (cmd === 'bold') {
                        toggleBoldOnSelection();
                    } else if (cmd && color) {
                        document.execCommand(cmd, false, color);
                    }
                    if (textEl) saveTextElContent(textEl);
                });
            });

            renderCanvas();
            setTimeout(fitToScreen, 50);
        });
    }

    mountShell();
};
