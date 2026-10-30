// ============================================================================
// 分析フォームエディタ用の共通ヘルパー(プレビュー表示用)
// ・人数計算ロジックは analyticsform/form.js の getMonthlyDiagnosisCount と同一。
//   (FIXED_MONTHLY_SEQUENCES を含む。どちらかを変更したら必ず両方そろえること)
// ・色の形式チェック・HTMLエスケープも回答者側(form.js)と同じ考え方。
// ============================================================================
(function () {
    if (window.MEOFormPreview) return;
const FIXED_MONTHLY_SEQUENCES = {
    // "YYYY-M": [1日目の値, 2日目の値, ... 月末までの値]
    "2026-9": [13, 14, 15, 17, 22, 25, 28, 30, 33, 35, 38, 40, 43, 45, 48, 50, 53, 55, 58, 60, 63, 65, 68, 70, 73, 75, 78, 80, 83, 86],
};

function getMonthlyDiagnosisCount(targetDate) {
    const date = targetDate || new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // 1-12
    const dayOfMonth = date.getDate();
    const daysInMonth = new Date(year, month, 0).getDate();

    // 固定シーケンスが設定されている月は、その日の確定値をそのまま返す。
    const fixedSeq = FIXED_MONTHLY_SEQUENCES[`${year}-${month}`];
    if (fixedSeq) {
        const idx = Math.min(dayOfMonth, fixedSeq.length) - 1;
        return fixedSeq[idx];
    }

    // ---- ここから通常月の自動ランダム計算式(2026-08-20仕様) ----
    // 絶対ルール:
    //   ・1ヶ月のMAXは32〜45名の範囲におさまる(月末までにその範囲内であればOK)
    //   ・日付が変わっているのに人数が変わらないのはNG(必ず毎日変化する)
    //   ・翌日が前日より低い数値になるのはNG(必ず増える。減らない)
    //   ・1日あたりの振り幅は1〜2名(いきなり大きく増えるのはNG)
    //   ・それ以外は自動ランダムでよい
    const startMin = 2;
    const startMax = 4;
    const endMin = 32;
    const endMax = 45;

    // 年月ごとに固定されるseed → 同じ月なら常に同じ数列(一貫性のため)。
    // 月が変われば別のseedになるので、結果として毎月自動的にリセット・再生成される。
    const seed = year * 100 + month;

    // シンプルな決定論的擬似乱数生成器(mulberry32)
    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const rand = mulberry32(seed);

    // 1日目の人数(2〜4名からランダムに決定。例:1日は2名〜)
    const startRange = startMax - startMin + 1;
    const startVal = startMin + Math.floor(rand() * startRange);

    // 2日目以降、前日より1〜2名ずつ積み上げていく。
    // 「残り日数ぶんを最速(+2/日)で増やしても45名を超えない」
    // 「残り日数ぶんを最遅(+1/日)で増やしても32名を下回らない」
    // という条件を毎日チェックしながら増加数を選ぶことで、月末に必ず
    // 32〜45名の範囲へ着地するようにしている。
    const counts = [null, startVal];
    for (let day = 2; day <= daysInMonth; day++) {
        const remainingAfter = daysInMonth - day;
        const prev = counts[day - 1];
        const candidates = [1, 2].filter(inc => {
            const v = prev + inc;
            return (v + remainingAfter * 1 <= endMax) && (v + remainingAfter * 2 >= endMin);
        });
        let inc;
        if (candidates.length === 2) {
            inc = rand() < 0.6 ? 1 : 2; // なだらかに増えるよう+1をやや優先
        } else if (candidates.length === 1) {
            inc = candidates[0];
        } else {
            // 通常はここに来ないはずの保険(範囲内に収まる側を優先)
            inc = (prev + 1 + remainingAfter * 2 >= endMin) ? 1 : 2;
        }
        counts[day] = prev + inc;
    }

    return counts[Math.min(dayOfMonth, daysInMonth)];
}

    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const color = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim())) ? v.trim() : '';
    const DEFAULT_COUNT_TEXT = '【今月{n}名が診断を申込しています】';
    const DEFAULT_CLOSE_POPUP = {
        enabled: true,
        icon: '!',
        title: '回答を中断しますか？',
        body: 'ここまで入力した回答内容は保存されず\n**すべて削除されます。**\n本当に終了しますか？',
        continueText: '続ける',
        exitText: '終了する'
    };
    // OP画面の人数表示: 回答者側(renderDiagnosisCountHtml)と同じ規則で文字列を作る
    const resolveCount = (op) => {
        op = op || {};
        if (op.countMode === 'manual') {
            const n = Math.floor(Number(op.countManual));
            if (String(op.countManual).trim() !== '' && Number.isFinite(n) && n >= 0) return n;
        }
        return getMonthlyDiagnosisCount();
    };
    const countLine = (op) => {
        op = op || {};
        const tpl = (typeof op.countText === 'string' && op.countText.trim() !== '') ? op.countText : DEFAULT_COUNT_TEXT;
        return { show: op.countShow !== false, text: tpl.replace(/\{n\}/g, String(resolveCount(op))), color: color(op.countColor) };
    };
    // POP本文: 改行はそのまま、**太字** だけ使える簡易記法(それ以外のHTMLは無効)
    const popupBodyHtml = (text) => esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\r?\n/g, '<br>');
    window.MEOFormPreview = { getMonthlyDiagnosisCount, esc, color, countLine, resolveCount, popupBodyHtml, DEFAULT_COUNT_TEXT, DEFAULT_CLOSE_POPUP };
})();

App.Pages.form_editor = async function() {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') {
        App.mount('<div class="card" style="margin-top:24px; padding: 40px; text-align:center;"><h3 class="card-title">アクセス権限がありません</h3></div>');
        return;
    }

    // デフォルトのフォームデータ構造 (配置デフォルトはすべて left)
    const defaultFormData = {
        title: "MEOキーワード分析フォーム",
        theme: {
            titleColor: "#1a1a1a",
            descColor: "#666666",
            titleSize: "1.5rem",
            descSize: "1rem"
        },
        op: {
            title: "Googleマップ売上分析診断",
            description: "あなたの店舗のMEOキーワードを分析します",
            imageUrl: "",
            buttonText: "診断をスタート",
            align: "left",
            descAlign: "left"
        },
        ed: {
            title: "ご提出ありがとうございました！",
            description: "結果は担当者よりご連絡いたします。",
            imageUrl: "",
            buttonText: "終了する",
            align: "left",
            descAlign: "left"
        },
        review: {
            title: "回答内容の確認",
            description: "以下の内容でよろしいですか？",
            buttonText: "この内容で提出する",
            align: "left",
            descAlign: "left"
        },
        questions: [
            {
                id: "q" + Date.now(),
                type: "short_text",
                title: "店舗名or企業名を教えてください",
                description: "",
                required: true,
                choices: [],
                imageUrl: "",
                allowMultiple: false,
                placeholder: "こちらに回答を入力...",
                align: "left",
                descAlign: "left"
            }
        ]
    };

    let formData = await Store.getMEOForm();
    if (!formData || !formData.op) {
        formData = JSON.parse(JSON.stringify(defaultFormData));
    }
    if (!formData.theme) formData.theme = defaultFormData.theme;
    if (!formData.review) formData.review = defaultFormData.review;
    
    let secretsData = await Store.getMEOFormSecrets();
    
    // 古いデータでalign未設定の場合はすべて左寄せにする
    if (formData.op && !formData.op.align) formData.op.align = "left";
    if (formData.op && !formData.op.descAlign) formData.op.descAlign = "left";
    if (formData.ed && !formData.ed.align) formData.ed.align = "left";
    if (formData.ed && !formData.ed.descAlign) formData.ed.descAlign = "left";
    if (formData.review && !formData.review.align) formData.review.align = "left";
    if (formData.review && !formData.review.descAlign) formData.review.descAlign = "left";
    formData.questions.forEach(q => {
        if (!q.align) q.align = "left";
        if (!q.descAlign) q.descAlign = "left";
    });

    // ---- 追加機能の初期値(旧データは「従来と同じ挙動」になる値で補完する) ----
    const PV = window.MEOFormPreview;
    // ×ボタン離脱確認POP
    const cp = (formData.closePopup && typeof formData.closePopup === 'object') ? formData.closePopup : {};
    formData.closePopup = {
        enabled: cp.enabled !== false,
        icon: typeof cp.icon === 'string' ? cp.icon : PV.DEFAULT_CLOSE_POPUP.icon,
        title: typeof cp.title === 'string' ? cp.title : PV.DEFAULT_CLOSE_POPUP.title,
        body: typeof cp.body === 'string' ? cp.body : PV.DEFAULT_CLOSE_POPUP.body,
        continueText: typeof cp.continueText === 'string' ? cp.continueText : PV.DEFAULT_CLOSE_POPUP.continueText,
        exitText: typeof cp.exitText === 'string' ? cp.exitText : PV.DEFAULT_CLOSE_POPUP.exitText
    };
    // OP画面の申込人数表示(既定は従来どおり: 表示する・自動計算)
    formData.op.countShow = formData.op.countShow !== false;
    if (typeof formData.op.countText !== 'string' || !formData.op.countText.trim()) formData.op.countText = PV.DEFAULT_COUNT_TEXT;
    formData.op.countMode = formData.op.countMode === 'manual' ? 'manual' : 'auto';
    if (formData.op.countManual === undefined || formData.op.countManual === null) formData.op.countManual = '';
    if (typeof formData.op.countColor !== 'string') formData.op.countColor = '';

    let activePageId = 'op';

    const render = () => {
        let leftNavHtml = `
            <div class="editor-section-title" style="margin-bottom:16px; font-weight:600; color:var(--text-secondary);">Pages</div>
            <div class="editor-nav-item ${activePageId === 'op' ? 'active' : ''}" data-id="op">
                <i class="ph ph-door-open" style="margin-right:8px; font-size:1.2rem;"></i> <span class="nav-text" id="nav-text-op">OP: ${formData.op.title || 'タイトルなし'}</span>
            </div>
            <div id="questions-list">
        `;

        formData.questions.forEach((q, index) => {
            leftNavHtml += `
                <div class="editor-nav-item ${activePageId === q.id ? 'active' : ''}" data-id="${q.id}">
                    <span class="q-badge">${index + 1}</span> <span class="nav-text" id="nav-text-${q.id}">${q.title || '無題の質問'}</span>
                    <div style="display:flex; gap:4px; align-items:center;">
                        ${index > 0 ? `<i class="ph ph-caret-up move-q-btn" data-dir="up" data-index="${index}" style="cursor:pointer; color:#888;"></i>` : ''}
                        ${index < formData.questions.length - 1 ? `<i class="ph ph-caret-down move-q-btn" data-dir="down" data-index="${index}" style="cursor:pointer; color:#888;"></i>` : ''}
                        <i class="ph ph-trash delete-q-btn" data-id="${q.id}" style="margin-left:4px;"></i>
                    </div>
                </div>
            `;
        });

        leftNavHtml += `
            </div>
            <button class="btn btn-secondary" id="add-q-btn" style="width:100%; margin-top:16px; justify-content:center;">
                <i class="ph ph-plus"></i> 質問を追加
            </button>

            <div class="editor-section-title" style="margin-top:32px; margin-bottom:16px; font-weight:600; color:var(--text-secondary);">Endings</div>
            <div class="editor-nav-item ${activePageId === 'review' ? 'active' : ''}" data-id="review" style="margin-bottom:8px;">
                <i class="ph ph-clipboard-text" style="margin-right:8px; font-size:1.2rem;"></i> <span class="nav-text">確認画面 (Review)</span>
            </div>
            <div class="editor-nav-item ${activePageId === 'ed' ? 'active' : ''}" data-id="ed">
                <i class="ph ph-flag-checkered" style="margin-right:8px; font-size:1.2rem;"></i> <span class="nav-text" id="nav-text-ed">ED: ${formData.ed.title || 'タイトルなし'}</span>
            </div>

            <div class="editor-section-title" style="margin-top:32px; margin-bottom:16px; font-weight:600; color:var(--text-secondary);">Popups</div>
            <div class="editor-nav-item ${activePageId === 'closepopup' ? 'active' : ''}" data-id="closepopup">
                <i class="ph ph-x-circle" style="margin-right:8px; font-size:1.2rem;"></i> <span class="nav-text">×ボタン離脱確認POP</span>
            </div>
        `;

        let mockupHtml = '';
        let settingsHtml = '';
        let activeObj = null;
        let isQuestion = false;

        if (activePageId === 'op') {
            activeObj = formData.op;
            mockupHtml = generateMockupHtml(activeObj, 'op');
            settingsHtml = generateSettingsHtml(activeObj, 'op');
        } else if (activePageId === 'ed') {
            activeObj = formData.ed;
            mockupHtml = generateMockupHtml(activeObj, 'ed');
            settingsHtml = generateSettingsHtml(activeObj, 'ed');
        } else if (activePageId === 'closepopup') {
            activeObj = formData.closePopup;
            mockupHtml = generateClosePopupMockup();
            settingsHtml = generateClosePopupSettings();
        } else if (activePageId === 'review') {
            activeObj = formData.review;
            mockupHtml = generateMockupHtml(activeObj, 'review');
            settingsHtml = generateSettingsHtml(activeObj, 'review');
        } else {
            activeObj = formData.questions.find(q => q.id === activePageId);
            isQuestion = true;
            if (activeObj) {
                mockupHtml = generateMockupHtml(activeObj, 'question');
                settingsHtml = generateSettingsHtml(activeObj, 'question');
            }
        }

        const html = `
            <style>
                .editor-layout { display: flex; height: calc(100vh - 80px); gap: 24px; }
                .editor-left { width: 280px; background: white; border-radius: 12px; padding: 24px; overflow-y: auto; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
                .editor-middle { flex: 1; display: flex; justify-content: center; align-items: center; background: #f8f9fc; border-radius: 12px; overflow: hidden; position: relative; padding: 24px;}
                .editor-right { width: 320px; background: white; border-radius: 12px; padding: 24px; overflow-y: auto; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
                
                /* Left Nav UI */
                .editor-nav-item { padding: 12px 16px; border-radius: 8px; margin-bottom: 8px; cursor: pointer; display: flex; align-items: center; background: #f8f9fc; transition: 0.2s; font-size: 0.9rem; font-weight: 500;}
                .editor-nav-item:hover { background: #eef2f7; }
                .editor-nav-item.active { background: #0d6efd; color: white; box-shadow: 0 4px 12px rgba(13,110,253,0.3); }
                .editor-nav-item.active i { color: white !important; }
                .editor-nav-item .nav-text { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .q-badge { background: #0d6efd; color: white; border-radius: 4px; padding: 2px 6px; font-size: 0.75rem; margin-right: 8px; }
                .editor-nav-item.active .q-badge { background: white; color: #0d6efd; }
                .delete-q-btn { color: #dc3545; margin-left: auto; cursor: pointer; opacity: 0.6; }
                .delete-q-btn:hover { opacity: 1; }
                .editor-nav-item.active .delete-q-btn { color: #ffcccc; }
                
                /* Smartphone Mockup CSS (Glassmorphism & Gradient Background) */
                .phone-mockup { 
                    width: 360px; height: 720px; 
                    background: #fdfbfb;
                    border-radius: 40px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); border: 12px solid #2c3e50; position: relative; overflow: hidden; display: flex; flex-direction: column; font-family: 'Inter', sans-serif;
                }
                .phone-mockup::before {
                    content: ''; position: absolute; bottom: -20%; right: -20%; width: 400px; height: 400px;
                    background: radial-gradient(circle, rgba(235,93,149,0.8) 0%, rgba(246,149,94,0.6) 50%, transparent 80%);
                    filter: blur(40px); z-index: 0; pointer-events: none;
                }
                .phone-mockup::after {
                    content: ''; position: absolute; top: -10%; left: -10%; width: 300px; height: 300px;
                    background: radial-gradient(circle, rgba(255,255,255,0.6) 0%, transparent 70%);
                    filter: blur(20px); z-index: 0; pointer-events: none;
                }
                
                .phone-mockup-inner { 
                    flex: 1; padding: 32px 24px; display: flex; flex-direction: column; justify-content: center; overflow-y: auto; z-index: 1;
                }
                .phone-mockup-inner { flex: 1; padding: 32px 24px; display: flex; flex-direction: column; justify-content: center; overflow-y: auto; z-index: 1; }
                
                .align-left { text-align: left; align-items: flex-start; }
                .align-center { text-align: center; align-items: center; }
                .align-right { text-align: right; align-items: flex-end; }
                
                .mockup-btn { background: rgba(0,0,0,0.8); color: white; padding: 16px 24px; border-radius: 8px; font-weight: 600; text-align: center; font-size: 1.1rem; box-shadow: 0 8px 24px rgba(0,0,0,0.2); backdrop-filter: blur(4px); margin-top: 24px; cursor: pointer; width: 100%; box-sizing: border-box; }
                .mockup-input { width: 100%; border: none; border-bottom: 2px solid rgba(0,0,0,0.2); font-size: 1.2rem; padding: 8px 0; outline: none; margin-bottom: 24px; background: transparent; color: #333;}
                .mockup-choice { padding: 16px; border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; margin-bottom: 12px; font-weight: 500; color: #333; background: rgba(255,255,255,0.7); backdrop-filter: blur(8px); display: flex; align-items: center;}
                .mockup-img { max-width: 100%; border-radius: 8px; margin-bottom: 24px; max-height: 200px; object-fit: cover;}
                .required-mark { color: #dc3545; margin-left: 4px; font-size: 1.2em; font-weight: bold; }
                .mockup-count { color: #dc3545; font-weight: 700; font-size: 0.95rem; margin-top: 14px; text-align: center; width: 100%; }
                .mockup-count.off { color: #999; font-weight: 500; font-size: 0.8rem; border: 1px dashed #bbb; border-radius: 6px; padding: 6px; }
                .fmt-hint { font-size: 0.78rem; color: #666; line-height: 1.5; margin-top: 4px; }
                .fmt-section { margin-top: 24px; padding: 14px; background: #f8f9fc; border-radius: 10px; }
                .fmt-section h4 { margin: 0 0 12px; font-size: 0.95rem; }
            </style>
            
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                <h2 style="margin:0; font-size:1.5rem; font-weight:700;"><i class="ph ph-pencil-simple" style="margin-right:8px; color:var(--primary-color);"></i>分析フォーム エディタ</h2>
                <div>
                    <input type="text" id="form-main-title" class="input-field" style="width:300px; display:inline-block; margin-right:16px; margin-bottom:0;" value="${formData.title}" placeholder="フォームの全体タイトル">
                    <button class="btn btn-secondary" style="margin-right:8px;" onclick="App.navigate('form_analytics')"><i class="ph ph-chart-bar"></i> 分析へ戻る</button>
                    <button class="btn btn-primary" id="save-form-btn"><i class="ph ph-floppy-disk"></i> フォームを保存</button>
                </div>
            </div>

            <div class="editor-layout">
                <div class="editor-left">${leftNavHtml}</div>
                <div class="editor-middle"><div class="phone-mockup">${mockupHtml}</div></div>
                <div class="editor-right">${settingsHtml}</div>
            </div>
        `;

        App.mount(html, () => {
            document.querySelectorAll('.editor-nav-item').forEach(el => {
                el.addEventListener('click', (e) => {
                    if (e.target.classList.contains('delete-q-btn') || e.target.classList.contains('move-q-btn')) return;
                    activePageId = el.getAttribute('data-id');
                    render();
                });
            });

            document.querySelectorAll('.delete-q-btn').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = el.getAttribute('data-id');
                    if (confirm('この質問を削除してもよろしいですか？')) {
                        formData.questions = formData.questions.filter(q => q.id !== id);
                        if (activePageId === id) activePageId = 'op';
                        render();
                    }
                });
            });

            document.querySelectorAll('.move-q-btn').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const index = parseInt(el.getAttribute('data-index'));
                    const dir = el.getAttribute('data-dir');
                    if (dir === 'up' && index > 0) {
                        const temp = formData.questions[index];
                        formData.questions[index] = formData.questions[index - 1];
                        formData.questions[index - 1] = temp;
                    } else if (dir === 'down' && index < formData.questions.length - 1) {
                        const temp = formData.questions[index];
                        formData.questions[index] = formData.questions[index + 1];
                        formData.questions[index + 1] = temp;
                    }
                    render();
                });
            });

            const addQBtn = document.getElementById('add-q-btn');
            if (addQBtn) {
                addQBtn.addEventListener('click', () => {
                    const newId = "q" + Date.now();
                    formData.questions.push({
                        id: newId, type: "short_text", title: "新しい質問", description: "",
                        required: true, choices: [], imageUrl: "", allowMultiple: false,
                        placeholder: "こちらに回答を入力...", align: "left", descAlign: "left"
                    });
                    activePageId = newId;
                    render();
                });
            }

            const saveBtn = document.getElementById('save-form-btn');
            if (saveBtn) {
                saveBtn.addEventListener('click', async () => {
                    formData.title = document.getElementById('form-main-title').value;
                    // 申込人数を「手動」にしている場合は、0以上の整数かを保存前に確認する
                    if (formData.op.countMode === 'manual') {
                        const raw = String(formData.op.countManual).trim();
                        const num = Number(raw);
                        if (raw === '' || !Number.isInteger(num) || num < 0) {
                            alert('OP画面の申込人数(手動)は、0以上の整数で入力してください。');
                            return;
                        }
                        formData.op.countManual = num;
                    }
                    saveBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 保存中...';
                    await Store.saveMEOForm(formData);
                    saveBtn.innerHTML = '<i class="ph ph-check"></i> 保存完了';
                    setTimeout(() => { saveBtn.innerHTML = '<i class="ph ph-floppy-disk"></i> フォームを保存'; }, 2000);
                });
            }

            const imgUploadBtn = document.getElementById('img-upload-btn');
            const fileInput = document.getElementById('img-file-input');
            if (imgUploadBtn && fileInput) {
                imgUploadBtn.addEventListener('click', () => fileInput.click());
                fileInput.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        activeObj.imageUrl = event.target.result;
                        render();
                    };
                    reader.readAsDataURL(file);
                });
            }

            if (activePageId === 'closepopup') {
                bindClosePopupEvents();
            } else {
                bindMockupEditableEvents(activeObj, isQuestion ? 'question' : activePageId);
                bindSettingsEvents(activeObj, isQuestion ? 'question' : activePageId);
                bindDescStyleAndCountEvents(activeObj, isQuestion ? 'question' : activePageId);
            }
        });
    };

    const generateMockupHtml = (obj, type) => {
        const alignClass = `align-${obj.align || 'left'}`;
        let html = `<div class="phone-mockup-inner ${alignClass} ${type === 'review' ? 'scrollable' : ''}">`;
        if (obj.imageUrl) html += `<img src="${obj.imageUrl}" class="mockup-img">`;
        
        const titleSize = obj.titleSize || formData.theme.titleSize || '1.5rem';
        const descSize = obj.descSize || formData.theme.descSize || '1rem';

        html += `
            <div style="display:flex; align-items:center; width:100%; justify-content: inherit; margin-bottom: 12px; color: ${formData.theme.titleColor}; font-size: ${titleSize};">
                <div class="mockup-editable" id="mock-title-node" data-prop="title" data-placeholder="タイトル..." contenteditable="true" style="flex:1; margin-bottom:0; font-size: inherit; color: inherit;">${obj.title || ''}</div>
                ${(type === 'question' && obj.required) ? '<span class="required-mark">*</span>' : ''}
            </div>
            <div class="mockup-editable" id="mock-desc-node" data-prop="description" data-placeholder="説明文..." contenteditable="true" style="width: 100%; margin-bottom: 32px; line-height: 1.6; color: ${PV.color(obj.descColor) || formData.theme.descColor}; font-size: ${descSize}; ${obj.descBold ? 'font-weight: 700;' : ''} white-space: pre-wrap;">${obj.description || ''}</div>
        `;

        if ((type === 'op' || type === 'ed') && type !== 'review') {
            html += `<div class="mockup-btn" id="mock-btn-node">${obj.buttonText || 'スタート'}</div>`;
            if (type === 'op') {
                const cl = PV.countLine(obj);
                html += cl.show
                    ? `<div class="mockup-count" id="mock-count-node" style="${cl.color ? 'color:' + cl.color + ';' : ''}">${PV.esc(cl.text)}</div>`
                    : `<div class="mockup-count off" id="mock-count-node">（申込人数の表示はOFFです）</div>`;
            }
        } else if (type === 'question') {
            if (obj.type === 'short_text') {
                const placeholderVal = obj.placeholder !== undefined ? obj.placeholder : "こちらに回答を入力...";
                html += `<div class="mockup-editable" id="mock-placeholder-node" data-prop="placeholder" data-placeholder="プレースホルダーを入力..." contenteditable="true" style="border: none; border-bottom: 2px solid rgba(0,0,0,0.15); background: transparent; padding: 12px 0; height: auto; width: 100%; text-align: left; color: #888; font-size: 1.2rem; line-height: 1.4; display: flex; align-items: center;">${placeholderVal}</div>`;
            } else if (obj.type === 'long_text') {
                const placeholderVal = obj.placeholder !== undefined ? obj.placeholder : "こちらに回答を入力...";
                html += `<div class="mockup-editable" id="mock-placeholder-node" data-prop="placeholder" data-placeholder="プレースホルダーを入力..." contenteditable="true" style="border: none; border-bottom: 2px solid rgba(0,0,0,0.15); background: transparent; padding: 12px 0; height: auto; width: 100%; text-align: left; color: #888; font-size: 1.2rem; line-height: 1.4; display: flex; align-items: center;">${placeholderVal}</div>`;
            } else if (obj.type === 'dropdown') {
                html += `
                    <select class="mockup-input" style="border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; padding: 12px; background: rgba(255,255,255,0.7); backdrop-filter: blur(8px); width: 100%; cursor: pointer;">
                        <option value="">選択してください...</option>
                        ${(obj.choices || []).map(c => `<option>${c}</option>`).join('')}
                    </select>
                `;
            } else if (obj.type === 'multiple_choice') {
                if (!obj.choices || obj.choices.length === 0) {
                    html += '<div class="mockup-choice" style="opacity:0.5; width: 100%;">選択肢がありません</div>';
                } else {
                    obj.choices.forEach((c, idx) => {
                        const alpha = String.fromCharCode(65 + idx);
                        html += `<div class="mockup-choice" style="width: 100%;"><div class="choice-alpha" style="background:#e0e0e0; width:24px; height:24px; border-radius:4px; display:flex; align-items:center; justify-content:center; margin-right:12px; font-size:0.8rem; font-weight:700;">${alpha}</div> ${c}</div>`;
                    });
                }
            } else if (obj.type === 'calendar_booking') {
                html += `
                    <div style="width:100%; border:1px solid rgba(0,0,0,0.1); border-radius:12px; padding:16px; background:rgba(255,255,255,0.8); backdrop-filter:blur(8px); text-align:center;">
                        <div style="font-weight:600; margin-bottom:12px; color:#333;"><i class="ph ph-calendar-blank" style="margin-right:4px; color:#0d6efd;"></i>日程調整カレンダー</div>
                        <div style="display:grid; grid-template-columns: repeat(7, 1fr); gap:6px; margin-bottom:12px;">
                            ${['日','月','火','水','木','金','土'].map(d => `<div style="font-size:0.75rem; color:#666; font-weight:600;">${d}</div>`).join('')}
                            ${Array.from({length: 14}).map((_, i) => `<div style="font-size:0.8rem; padding:6px; border-radius:4px; background:#f0f0f0; color:#aaa; font-weight:500;">${i+1}</div>`).join('')}
                        </div>
                        <div style="font-size:0.75rem; color:#888;">※ 本番環境では空き枠時間がリアルタイムに選択可能になります。</div>
                    </div>
                `;
            }
        }
        
        // 確認画面 (Review) のプレビュー
        if (type === 'review') {
            html += '<div style="width:100%; margin-top:16px; margin-bottom:24px; text-align:left;">';
            formData.questions.forEach((q, idx) => {
                html += `
                    <div style="background:rgba(255,255,255,0.7); padding:12px; border-radius:8px; margin-bottom:12px; border:1px solid rgba(0,0,0,0.05);">
                        <div style="font-size:0.75rem; color:#666; font-weight:600;">${idx + 1}. ${q.title}</div>
                        <div style="font-size:0.9rem; font-weight:500; margin-top:4px; color:#1a1a1a;">サンプル回答テキスト</div>
                    </div>
                `;
            });
            html += '</div>';
            html += `<div class="mockup-btn" id="mock-review-btn-node" style="width:100%; margin-top: auto;">${obj.buttonText || 'この内容で提出する'}</div>`;
        }

        return html + '</div>';
    };

    const bindMockupEditableEvents = (obj, type) => {
        document.querySelectorAll('.mockup-editable').forEach(el => {
            el.addEventListener('paste', (e) => {
                e.preventDefault();
                const text = (e.originalEvent || e).clipboardData.getData('text/plain');
                document.execCommand('insertText', false, text);
            });
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') e.stopPropagation();
            });
            el.addEventListener('input', (e) => {
                const prop = el.getAttribute('data-prop');
                obj[prop] = el.innerText;
                const rightInput = document.getElementById('set-' + prop);
                if (rightInput) rightInput.value = obj[prop];
                if (prop === 'title') {
                    const navEl = document.getElementById(`nav-text-${activePageId}`);
                    if (navEl) {
                        const prefix = activePageId === 'op' ? 'OP: ' : activePageId === 'ed' ? 'ED: ' : '';
                        navEl.innerText = prefix + (obj.title || 'タイトルなし');
                    }
                }
            });
        });
    };

    const generateSettingsHtml = (obj, type) => {
        let titleLabel = 'タイトル';
        if (type === 'op') titleLabel = 'OP画面のタイトル';
        else if (type === 'ed') titleLabel = 'ED画面のタイトル';
        else if (type === 'review') titleLabel = '確認画面のタイトル';
        
        let html = `<h3 style="margin-top:0; margin-bottom:24px; font-size:1.2rem;">${type === 'op' ? 'OP画面の設定' : type === 'ed' ? 'ED画面の設定' : type === 'review' ? '確認画面の設定' : '質問の設定'}</h3>`;
        
        if (type !== 'review') {
            html += `<div class="form-group"><label>画像 (任意)</label>`;
            if (obj.imageUrl) {
                html += `<div style="margin-bottom:8px;"><img src="${obj.imageUrl}" style="max-width:100px; max-height:100px; border-radius:4px; object-fit:cover;"></div>
                    <button class="btn btn-secondary btn-sm" onclick="document.getElementById('img-file-input').click()"><i class="ph ph-image"></i> 変更する</button>
                    <button class="btn btn-danger btn-sm" id="remove-img-btn" style="margin-left:8px;"><i class="ph ph-trash"></i></button>`;
            } else {
                html += '<button class="btn btn-secondary btn-sm" id="img-upload-btn"><i class="ph ph-image"></i> 画像をアップロード</button>';
            }
            html += '<input type="file" id="img-file-input" accept="image/*" style="display:none;"></div>';
        }

        if (type === 'question') {
            html += `
                <div class="form-group">
                    <label>質問タイプ</label>
                    <select id="set-type" class="input-field">
                        <option value="short_text" ${obj.type === 'short_text' ? 'selected' : ''}>記述式 (短文)</option>
                        <option value="long_text" ${obj.type === 'long_text' ? 'selected' : ''}>記述式 (長文)</option>
                        <option value="multiple_choice" ${obj.type === 'multiple_choice' ? 'selected' : ''}>選択肢 (複数/単一)</option>
                        <option value="dropdown" ${obj.type === 'dropdown' ? 'selected' : ''}>プルダウン</option>
                        <option value="calendar_booking" ${obj.type === 'calendar_booking' ? 'selected' : ''}>カレンダー日程調整</option>
                    </select>
                </div>
            `;
        }

        html += `
            <div class="form-group"><label>${titleLabel} (プレビュー直接編集可)</label><textarea id="set-title" class="input-field" style="height:60px;">${obj.title || ''}</textarea></div>
            <div class="form-group"><label>補足説明 (プレビュー直接編集可)</label><textarea id="set-desc" class="input-field" style="height:80px;">${obj.description || ''}</textarea></div>
        `;

        if (type === 'question' && (obj.type === 'short_text' || obj.type === 'long_text')) {
            const placeholderVal = obj.placeholder !== undefined ? obj.placeholder : "こちらに回答を入力...";
            html += `<div class="form-group"><label>案内文字 (プレースホルダー)</label><input type="text" id="set-placeholder" class="input-field" value="${placeholderVal}"></div>`;
        }

        if (type === 'question' && obj.type === 'calendar_booking') {
            const duration = obj.duration || 30;
            const startHour = obj.startHour || '09:00';
            const endHour = obj.endHour || '18:00';
            html += `
                <div class="form-group">
                    <label>面談の所要時間 (分)</label>
                    <select id="set-booking-duration" class="input-field">
                        <option value="30" ${duration == 30 ? 'selected' : ''}>30分</option>
                        <option value="45" ${duration == 45 ? 'selected' : ''}>45分</option>
                        <option value="60" ${duration == 60 ? 'selected' : ''}>60分</option>
                    </select>
                </div>
                <div style="display:flex; gap:16px;">
                    <div class="form-group" style="flex:1;">
                        <label>開始時間</label>
                        <input type="time" id="set-booking-start" class="input-field" value="${startHour}">
                    </div>
                    <div class="form-group" style="flex:1;">
                        <label>終了時間</label>
                        <input type="time" id="set-booking-end" class="input-field" value="${endHour}">
                    </div>
                </div>
            `;
        }

        if (type === 'op' || type === 'ed' || type === 'review') {
            html += `<div class="form-group"><label>ボタンテキスト</label><input type="text" id="set-btn-text" class="input-field" value="${obj.buttonText || ''}"></div>`;
            if (type === 'ed') {
                html += `<div class="form-group"><label>リダイレクトURL (空欄の場合は画面を閉じます)</label><input type="url" id="set-redirect-url" class="input-field" value="${obj.redirectUrl || ''}" placeholder="https://example.com/thankyou"></div>`;
            }
        }

        html += `
            <div style="display:flex; gap:16px;">
                <div class="form-group" style="flex:1;">
                    <label>タイトルの配置</label>
                    <select id="set-align" class="input-field">
                        <option value="left" ${obj.align === 'left' ? 'selected' : ''}>左寄せ</option>
                        <option value="center" ${obj.align === 'center' ? 'selected' : ''}>中央</option>
                        <option value="right" ${obj.align === 'right' ? 'selected' : ''}>右寄せ</option>
                    </select>
                </div>
                <div class="form-group" style="flex:1;">
                    <label>タイトルサイズ</label>
                    <select id="set-title-size" class="input-field">
                        <option value="">デフォルト</option>
                        <option value="1.2rem" ${obj.titleSize === '1.2rem' ? 'selected' : ''}>小</option>
                        <option value="1.5rem" ${obj.titleSize === '1.5rem' ? 'selected' : ''}>中</option>
                        <option value="1.8rem" ${obj.titleSize === '1.8rem' ? 'selected' : ''}>大</option>
                        <option value="2.2rem" ${obj.titleSize === '2.2rem' ? 'selected' : ''}>特大</option>
                    </select>
                </div>
            </div>
            <div style="display:flex; gap:16px;">
                <div class="form-group" style="flex:1;">
                    <label>説明の配置</label>
                    <select id="set-desc-align" class="input-field">
                        <option value="left" ${obj.descAlign === 'left' ? 'selected' : ''}>左寄せ</option>
                        <option value="center" ${obj.descAlign === 'center' ? 'selected' : ''}>中央</option>
                        <option value="right" ${obj.descAlign === 'right' ? 'selected' : ''}>右寄せ</option>
                    </select>
                </div>
                <div class="form-group" style="flex:1;">
                    <label>説明サイズ</label>
                    <select id="set-desc-size" class="input-field">
                        <option value="">デフォルト</option>
                        <option value="0.8rem" ${obj.descSize === '0.8rem' ? 'selected' : ''}>極小</option>
                        <option value="0.9rem" ${obj.descSize === '0.9rem' ? 'selected' : ''}>小</option>
                        <option value="1.05rem" ${obj.descSize === '1.05rem' ? 'selected' : ''}>中</option>
                        <option value="1.2rem" ${obj.descSize === '1.2rem' ? 'selected' : ''}>大</option>
                        <option value="1.4rem" ${obj.descSize === '1.4rem' ? 'selected' : ''}>特大</option>
                        <option value="1.7rem" ${obj.descSize === '1.7rem' ? 'selected' : ''}>最大</option>
                    </select>
                </div>
            </div>
        `;
        
        // 補足説明の書式(色・太字。サイズは上の「説明サイズ」)
        const descColorVal = PV.color(obj.descColor) || PV.color(formData.theme.descColor) || '#666666';
        html += `
            <div class="fmt-section" id="desc-style-section">
                <h4>🖊 補足説明の文字(色・太さ)</h4>
                <div style="display:flex; gap:12px; align-items:flex-end;">
                    <div class="form-group" style="flex:1; margin-bottom:0;">
                        <label>文字色</label>
                        <input type="color" id="set-desc-color" class="input-field" value="${descColorVal}" style="padding:0; height:40px;">
                    </div>
                    <button class="btn btn-secondary btn-sm" id="reset-desc-color" style="white-space:nowrap; height:40px;">全体設定に戻す</button>
                </div>
                <div class="fmt-hint">${PV.color(obj.descColor) ? 'このページだけの色を使用中です。' : '現在は「デザイン設定(全体)」の色を使用中です。'}</div>
                <label style="margin:14px 0 0; display:flex; align-items:center; gap:8px; font-weight:600;">
                    <input type="checkbox" id="set-desc-bold" style="width:18px; height:18px;" ${obj.descBold ? 'checked' : ''}> 太字にする
                </label>
                <button class="btn btn-secondary btn-sm" id="apply-desc-style-all" style="width:100%; margin-top:14px;">この文字設定(サイズ・色・太字)を全ページに適用</button>
                <div class="fmt-hint">※ 補足説明の文字全体に適用されます。変更後は右上の「フォームを保存」を押してください。</div>
            </div>
        `;

        if (type === 'op') {
            const cl = PV.countLine(obj);
            const autoNow = PV.getMonthlyDiagnosisCount();
            html += `
                <div class="fmt-section" id="count-section">
                    <h4>👥 申込人数の表示(スタートボタンの下)</h4>
                    <label style="margin:0 0 12px; display:flex; align-items:center; gap:8px; font-weight:600;">
                        <input type="checkbox" id="set-count-show" style="width:18px; height:18px;" ${obj.countShow !== false ? 'checked' : ''}> 人数を表示する
                    </label>
                    <div class="form-group">
                        <label>表示する文言（<code>{n}</code> の部分に人数が入ります）</label>
                        <input type="text" id="set-count-text" class="input-field" value="${PV.esc(obj.countText)}">
                    </div>
                    <div class="form-group">
                        <label>人数の決め方</label>
                        <select id="set-count-mode" class="input-field">
                            <option value="auto" ${obj.countMode !== 'manual' ? 'selected' : ''}>自動（毎日増える・従来どおり）</option>
                            <option value="manual" ${obj.countMode === 'manual' ? 'selected' : ''}>手動（入力した人数で固定）</option>
                        </select>
                        <div class="fmt-hint" id="count-mode-hint">${obj.countMode === 'manual'
                            ? '手動の間は日付が変わっても人数は変わりません。'
                            : '本日の自動人数: <b>' + autoNow + '名</b>（月初は少なく、日ごとに増え、月が変わるとリセットされます）'}</div>
                    </div>
                    ${obj.countMode === 'manual' ? `
                    <div class="form-group">
                        <label>手動の人数（0以上の整数）</label>
                        <input type="number" id="set-count-manual" class="input-field" min="0" step="1" value="${PV.esc(obj.countManual)}" placeholder="例: 25">
                    </div>` : ''}
                    <div style="display:flex; gap:12px; align-items:flex-end;">
                        <div class="form-group" style="flex:1; margin-bottom:0;">
                            <label>文字色</label>
                            <input type="color" id="set-count-color" class="input-field" value="${PV.color(obj.countColor) || '#dc3545'}" style="padding:0; height:40px;">
                        </div>
                        <button class="btn btn-secondary btn-sm" id="reset-count-color" style="white-space:nowrap; height:40px;">赤に戻す</button>
                    </div>
                </div>
            `;
        }

        if (type === 'question') {
            html += `<div class="form-group" style="display:flex; align-items:center; margin-top:24px; margin-bottom:24px; padding:12px; background:#f8f9fc; border-radius:8px;">
                        <label style="margin:0; flex:1; font-weight:600;">回答を必須にする</label>
                        <input type="checkbox" id="set-required" style="width:20px; height:20px;" ${obj.required ? 'checked' : ''}>
                    </div>`;
            if (obj.type === 'multiple_choice') {
                html += `<div class="form-group" style="padding:12px; background:#f8f9fc; border-radius:8px; margin-bottom:24px;">
                            <label style="font-weight:600; margin-bottom:8px; display:block;">回答方式</label>
                            <div style="display:flex; gap:16px;">
                                <label style="margin:0; font-weight:normal; display:flex; align-items:center; gap:6px;">
                                    <input type="radio" name="allow-multiple" value="false" ${!obj.allowMultiple ? 'checked' : ''}> 単一回答
                                </label>
                                <label style="margin:0; font-weight:normal; display:flex; align-items:center; gap:6px;">
                                    <input type="radio" name="allow-multiple" value="true" ${obj.allowMultiple ? 'checked' : ''}> 複数回答可能
                                </label>
                            </div>
                        </div>`;
            }
            if (obj.type === 'multiple_choice' || obj.type === 'dropdown') {
                html += '<div class="form-group"><label>選択肢設定</label><div id="choices-container">';
                (obj.choices || []).forEach((c, idx) => {
                    html += `<div style="display:flex; gap:8px; margin-bottom:8px;">
                                <input type="text" class="input-field set-choice-input" data-index="${idx}" value="${c}" style="margin-bottom:0;">
                                <button class="btn btn-danger delete-choice-btn" data-index="${idx}" style="padding:0 12px;"><i class="ph ph-trash"></i></button>
                             </div>`;
                });
                html += '</div><button class="btn btn-secondary btn-sm" id="add-choice-btn" style="margin-top:8px; width:100%;"><i class="ph ph-plus"></i> 選択肢を追加</button></div>';
            }
        }
        
        html += `<hr style="margin:32px 0; border:none; border-top:1px solid #e0e0e0;">
            <h4 style="margin-bottom:16px;">🎨 デザイン設定 (全体)</h4>
            <div style="display:flex; gap:16px;">
                <div class="form-group" style="flex:1;">
                    <label>タイトルの色</label><input type="color" id="set-theme-tcolor" class="input-field" value="${formData.theme.titleColor}" style="padding:0; height:40px;">
                </div>
                <div class="form-group" style="flex:1;">
                    <label>文字サイズ</label>
                    <select id="set-theme-tsize" class="input-field">
                        <option value="1.2rem" ${formData.theme.titleSize==='1.2rem'?'selected':''}>小</option>
                        <option value="1.5rem" ${formData.theme.titleSize==='1.5rem'?'selected':''}>中</option>
                        <option value="1.8rem" ${formData.theme.titleSize==='1.8rem'?'selected':''}>大</option>
                    </select>
                </div>
            </div>
            <div style="display:flex; gap:16px;">
                <div class="form-group" style="flex:1;">
                    <label>補足説明の色</label><input type="color" id="set-theme-dcolor" class="input-field" value="${formData.theme.descColor}" style="padding:0; height:40px;">
                </div>
                <div class="form-group" style="flex:1;">
                    <label>文字サイズ</label>
                    <select id="set-theme-dsize" class="input-field">
                        <option value="0.9rem" ${formData.theme.descSize==='0.9rem'?'selected':''}>小</option>
                        <option value="1rem" ${formData.theme.descSize==='1rem'?'selected':''}>中</option>
                        <option value="1.1rem" ${formData.theme.descSize==='1.1rem'?'selected':''}>大</option>
                    </select>
                </div>
            </div>
            <hr style="margin:32px 0; border:none; border-top:1px solid #e0e0e0;">
            <h4 style="margin-bottom:16px;">🔌 外部連携設定 (UTAGE/カレンダー/Chatwork)</h4>
            <div class="form-group">
                <label>UTAGE APIキー</label>
                <input type="password" id="set-secret-utage-key" class="input-field" value="${secretsData.utageApiKey || ''}" placeholder="APIキーを入力..." style="font-family:monospace;">
            </div>
            <div class="form-group">
                <label>UTAGE シナリオID</label>
                <input type="text" id="set-secret-utage-scenario" class="input-field" value="${secretsData.utageScenarioId || ''}" placeholder="シナリオIDを入力...">
            </div>
            <div class="form-group">
                <label>GoogleカレンダーID</label>
                <input type="text" id="set-secret-gcal-id" class="input-field" value="${secretsData.googleCalendarId || ''}" placeholder="example@gmail.com">
            </div>
            
            <hr style="margin:32px 0; border:none; border-top:1px solid #e0e0e0;">
            <h4 style="margin-bottom:16px;">📈 流入経路（パラメータ）URL発行</h4>
            <div class="form-group">
                <label>流入経路名（例: facebook, line_step1）</label>
                <div style="display:flex; gap:8px;">
                    <input type="text" id="tracking-source-name" class="input-field" placeholder="経路名を入力..." style="flex:1;">
                    <button class="btn btn-secondary btn-sm" id="generate-tracking-url-btn" style="white-space:nowrap;">URL発行</button>
                </div>
            </div>
            <div class="form-group" id="generated-url-container" style="display:none;">
                <label>発行されたURL</label>
                <input type="text" id="generated-tracking-url" class="input-field" readonly style="background:#f5f5f5; color:#666;">
                <div style="font-size:0.8rem; color:#666; margin-top:4px;">※このURLをコピーして広告やリンク先に使用してください</div>
            </div>

            <hr style="margin:32px 0; border:none; border-top:1px solid #e0e0e0;">
            <h4 style="margin-bottom:16px;">💬 Chatwork通知設定</h4>
            <div class="form-group">
                <label>Chatwork APIトークン</label>
                <input type="password" id="set-secret-chatwork-key" class="input-field" value="${secretsData.chatworkApiKey || ''}" placeholder="トークンを入力..." style="font-family:monospace;">
            </div>
            <div class="form-group">
                <label>Chatwork ルームID (rid)</label>
                <input type="text" id="set-secret-chatwork-room" class="input-field" value="${secretsData.chatworkRoomId || ''}" placeholder="ルームIDを入力...">
            </div>
            <button class="btn btn-secondary btn-sm" id="save-secrets-btn" style="width:100%; margin-bottom:24px;"><i class="ph ph-plug"></i> 連携設定を保存</button>
        `;
        return html;
    };

    const bindSettingsEvents = (obj, type) => {
        const bindInputNoRender = (inputId, mockNodeId, prop) => {
            const el = document.getElementById(inputId);
            if (el) {
                el.addEventListener('input', (e) => {
                    obj[prop] = e.target.value;
                    const mockNode = document.getElementById(mockNodeId);
                    if (mockNode) mockNode.innerText = e.target.value;
                    if (prop === 'title') {
                        const navEl = document.getElementById(`nav-text-${activePageId}`);
                        if (navEl) {
                            const prefix = activePageId === 'op' ? 'OP: ' : activePageId === 'ed' ? 'ED: ' : '';
                            navEl.innerText = prefix + (obj.title || 'タイトルなし');
                        }
                    }
                });
            }
        };

        bindInputNoRender('set-title', 'mock-title-node', 'title');
        bindInputNoRender('set-desc', 'mock-desc-node', 'description');
        if (type === 'op' || type === 'ed' || type === 'review') {
            bindInputNoRender('set-btn-text', activePageId === 'review' ? 'mock-review-btn-node' : 'mock-btn-node', 'buttonText');
            if (type === 'ed') {
                bindInputNoRender('set-redirect-url', null, 'redirectUrl');
            }
        }
        if (type === 'question') {
            bindInputNoRender('set-placeholder', 'mock-placeholder-node', 'placeholder');
        }
        
        const setVal = (id, prop, callback) => {
            const el = document.getElementById(id);
            if(el) el.addEventListener('change', (e) => {
                obj[prop] = e.target.value;
                if(callback) callback(e.target.value);
            });
        };

        setVal('set-align', 'align', val => {
            const mockNode = document.getElementById('mock-title-node');
            if (mockNode) mockNode.style.textAlign = val;
        });
        setVal('set-desc-align', 'descAlign', val => {
            const mockNode = document.getElementById('mock-desc-node');
            if (mockNode) mockNode.style.textAlign = val;
        });
        setVal('set-title-size', 'titleSize', val => {
            const mockNode = document.getElementById('mock-title-node');
            if (mockNode) mockNode.style.fontSize = val || formData.theme.titleSize || 'inherit';
        });
        setVal('set-desc-size', 'descSize', val => {
            const mockNode = document.getElementById('mock-desc-node');
            if (mockNode) mockNode.style.fontSize = val || formData.theme.descSize || 'inherit';
        });

        const tColor = document.getElementById('set-theme-tcolor');
        if(tColor) tColor.addEventListener('input', e => { 
            formData.theme.titleColor = e.target.value; 
            const mockTitle = document.getElementById('mock-title-node');
            if(mockTitle) mockTitle.style.color = e.target.value;
        });
        const dColor = document.getElementById('set-theme-dcolor');
        if(dColor) dColor.addEventListener('input', e => { 
            formData.theme.descColor = e.target.value; 
            const mockDesc = document.getElementById('mock-desc-node');
            if(mockDesc) mockDesc.style.color = PV.color(obj.descColor) || e.target.value;
        });
        const tSize = document.getElementById('set-theme-tsize');
        if(tSize) tSize.addEventListener('change', e => { 
            formData.theme.titleSize = e.target.value; 
            const mockTitle = document.getElementById('mock-title-node');
            if(mockTitle) mockTitle.style.fontSize = e.target.value;
        });
        const dSize = document.getElementById('set-theme-dsize');
        if(dSize) dSize.addEventListener('change', e => { 
            formData.theme.descSize = e.target.value; 
            const mockDesc = document.getElementById('mock-desc-node');
            if(mockDesc) mockDesc.style.fontSize = e.target.value;
        });

        const rmImgBtn = document.getElementById('remove-img-btn');
        if (rmImgBtn) {
            rmImgBtn.addEventListener('click', () => {
                obj.imageUrl = '';
                render();
            });
        }

        const typeSelect = document.getElementById('set-type');
        if (typeSelect) {
            typeSelect.addEventListener('change', (e) => {
                obj.type = e.target.value;
                if (!obj.choices) obj.choices = [];
                render(); 
            });
        }

        const reqCheck = document.getElementById('set-required');
        if (reqCheck) {
            reqCheck.addEventListener('change', (e) => {
                obj.required = e.target.checked;
                render();
            });
        }

        const allowMultipleRadio = document.getElementsByName('allow-multiple');
        if (allowMultipleRadio) {
            allowMultipleRadio.forEach(radio => {
                radio.addEventListener('change', (e) => {
                    obj.allowMultiple = e.target.value === 'true';
                });
            });
        }

        const addChoiceBtn = document.getElementById('add-choice-btn');
        if (addChoiceBtn) {
            addChoiceBtn.addEventListener('click', () => {
                if (!obj.choices) obj.choices = [];
                obj.choices.push('新しい選択肢');
                render();
            });
        }

        document.querySelectorAll('.set-choice-input').forEach(el => {
            el.addEventListener('input', (e) => {
                const idx = parseInt(el.getAttribute('data-index'));
                obj.choices[idx] = e.target.value;
            });
            el.addEventListener('blur', render);
        });

        document.querySelectorAll('.delete-choice-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                const idx = parseInt(el.getAttribute('data-index'));
                obj.choices.splice(idx, 1);
                render();
            });
        });

        // カレンダー調整の設定変更ハンドラ
        setVal('set-booking-duration', 'duration', () => render());
        const startBookingInput = document.getElementById('set-booking-start');
        if (startBookingInput) {
            startBookingInput.addEventListener('change', (e) => {
                obj.startHour = e.target.value;
            });
        }
        const endBookingInput = document.getElementById('set-booking-end');
        if (endBookingInput) {
            endBookingInput.addEventListener('change', (e) => {
                obj.endHour = e.target.value;
            });
        }

        // API連携設定の保存ハンドラ
        const saveSecretsBtn = document.getElementById('save-secrets-btn');
        if (saveSecretsBtn) {
            saveSecretsBtn.addEventListener('click', async () => {
                saveSecretsBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 保存中...';
                secretsData.utageApiKey = document.getElementById('set-secret-utage-key').value;
                secretsData.utageScenarioId = document.getElementById('set-secret-utage-scenario').value;
                secretsData.googleCalendarId = document.getElementById('set-secret-gcal-id').value;
                secretsData.chatworkApiKey = document.getElementById('set-secret-chatwork-key').value;
                secretsData.chatworkRoomId = document.getElementById('set-secret-chatwork-room').value;
                await Store.saveMEOFormSecrets(secretsData);
                saveSecretsBtn.innerHTML = '<i class="ph ph-check"></i> 保存完了';
                setTimeout(() => {
                    saveSecretsBtn.innerHTML = '<i class="ph ph-plug"></i> 連携設定を保存';
                }, 2000);
            });
        }

        // トラッキングURL生成ハンドラ
        const generateUrlBtn = document.getElementById('generate-tracking-url-btn');
        if (generateUrlBtn) {
            generateUrlBtn.addEventListener('click', () => {
                const sourceName = document.getElementById('tracking-source-name').value.trim();
                if (!sourceName) {
                    alert('流入経路名を入力してください。');
                    return;
                }
                const baseUrl = window.location.href.replace('/index.html', '/analyticsform/index.html');
                const url = new URL(baseUrl);
                url.searchParams.set('ref', sourceName);
                
                const urlInput = document.getElementById('generated-tracking-url');
                urlInput.value = url.toString();
                document.getElementById('generated-url-container').style.display = 'block';
                
                // クリップボードにコピー
                urlInput.select();
                document.execCommand('copy');
                
                const originalText = generateUrlBtn.innerText;
                generateUrlBtn.innerText = 'コピーしました！';
                setTimeout(() => { generateUrlBtn.innerText = originalText; }, 2000);
            });
        }
    };

    // ===== 補足説明の書式(色・太字・全ページ適用)と、OP画面の人数表示の設定イベント =====
    const bindDescStyleAndCountEvents = (obj, type) => {
        const mockDesc = () => document.getElementById('mock-desc-node');

        const colorEl = document.getElementById('set-desc-color');
        if (colorEl) colorEl.addEventListener('input', (e) => {
            obj.descColor = e.target.value;
            const m = mockDesc(); if (m) m.style.color = e.target.value;
        });
        const resetColor = document.getElementById('reset-desc-color');
        if (resetColor) resetColor.addEventListener('click', () => {
            delete obj.descColor;
            render();
        });
        const boldEl = document.getElementById('set-desc-bold');
        if (boldEl) boldEl.addEventListener('change', (e) => {
            obj.descBold = e.target.checked;
            const m = mockDesc(); if (m) m.style.fontWeight = e.target.checked ? '700' : '';
        });
        const applyAll = document.getElementById('apply-desc-style-all');
        if (applyAll) applyAll.addEventListener('click', () => {
            if (!confirm('このページの補足説明の「サイズ・色・太字」を、OP・全質問・確認画面・ED の全ページにコピーします。よろしいですか？')) return;
            const targets = [formData.op, formData.ed, formData.review, ...formData.questions];
            targets.forEach(t => {
                t.descSize = obj.descSize || '';
                if (PV.color(obj.descColor)) t.descColor = obj.descColor; else delete t.descColor;
                t.descBold = !!obj.descBold;
            });
            render();
        });

        // ---- OP: 申込人数表示 ----
        if (type !== 'op') return;
        const refreshCount = () => {
            const node = document.getElementById('mock-count-node');
            if (!node) return;
            const cl = PV.countLine(obj);
            if (!cl.show) {
                node.className = 'mockup-count off';
                node.style.color = '';
                node.textContent = '（申込人数の表示はOFFです）';
            } else {
                node.className = 'mockup-count';
                node.style.color = cl.color || '';
                node.textContent = cl.text;
            }
        };
        const showEl = document.getElementById('set-count-show');
        if (showEl) showEl.addEventListener('change', (e) => { obj.countShow = e.target.checked; refreshCount(); });
        const textEl = document.getElementById('set-count-text');
        if (textEl) textEl.addEventListener('input', (e) => { obj.countText = e.target.value; refreshCount(); });
        const modeEl = document.getElementById('set-count-mode');
        if (modeEl) modeEl.addEventListener('change', (e) => { obj.countMode = e.target.value; render(); });
        const manualEl = document.getElementById('set-count-manual');
        if (manualEl) manualEl.addEventListener('input', (e) => { obj.countManual = e.target.value; refreshCount(); });
        const ccolorEl = document.getElementById('set-count-color');
        if (ccolorEl) ccolorEl.addEventListener('input', (e) => { obj.countColor = e.target.value; refreshCount(); });
        const resetCC = document.getElementById('reset-count-color');
        if (resetCC) resetCC.addEventListener('click', () => { obj.countColor = ''; render(); });
    };

    // ===== ×ボタン離脱確認POP: プレビューと設定 =====
    const popupView = () => {
        const c = formData.closePopup;
        const D = PV.DEFAULT_CLOSE_POPUP;
        return {
            enabled: c.enabled !== false,
            icon: c.icon,
            title: c.title || D.title,
            body: c.body,
            continueText: c.continueText || D.continueText,
            exitText: c.exitText || D.exitText
        };
    };

    const generateClosePopupMockup = () => {
        const v = popupView();
        return `
            <div class="phone-mockup-inner" style="padding:0; position:relative; align-items:center; justify-content:center;">
                <div style="position:absolute; inset:0; background:rgba(0,0,0,0.55); z-index:1;"></div>
                <div id="pp-card" style="position:relative; z-index:2; background:#fff; border-radius:16px; padding:28px 20px; width:calc(100% - 40px); text-align:center; box-shadow:0 20px 50px rgba(0,0,0,0.3); ${v.enabled ? '' : 'opacity:0.4;'}">
                    <div id="pp-icon" style="width:48px; height:48px; border-radius:50%; background:#fce8e6; color:#dc3545; font-size:1.5rem; font-weight:700; display:${v.icon ? 'flex' : 'none'}; align-items:center; justify-content:center; margin:0 auto 16px;">${PV.esc(v.icon)}</div>
                    <div id="pp-title" style="font-size:1.1rem; font-weight:700; margin-bottom:12px; color:#1a1a1a;">${PV.esc(v.title)}</div>
                    <div id="pp-body" style="font-size:0.9rem; color:#666; line-height:1.6; margin-bottom:24px;">${PV.popupBodyHtml(v.body)}</div>
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        <div id="pp-continue" style="padding:14px; border-radius:8px; background:#0d6efd; color:#fff; font-weight:600;">${PV.esc(v.continueText)}</div>
                        <div id="pp-exit" style="padding:14px; color:#666; font-weight:600;">${PV.esc(v.exitText)}</div>
                    </div>
                </div>
                ${v.enabled ? '' : '<div id="pp-off-note" style="position:absolute; z-index:3; left:20px; right:20px; top:24px; background:#fff3cd; color:#664d03; border-radius:8px; padding:10px; font-size:0.8rem; text-align:center;">POPはOFFです。×ボタンを押すと、確認なしですぐ終了します。</div>'}
            </div>
        `;
    };

    const generateClosePopupSettings = () => {
        const c = formData.closePopup;
        return `
            <h3 style="margin-top:0; margin-bottom:8px; font-size:1.2rem;">×ボタン離脱確認POPの設定</h3>
            <div class="fmt-hint" style="margin-bottom:16px;">回答の途中(質問・確認画面)で右上の×を押した人に表示されるポップアップです。OP画面とED画面では、従来どおりPOPなしでそのまま閉じます。</div>
            <label style="margin:0 0 16px; display:flex; align-items:center; gap:8px; font-weight:600;">
                <input type="checkbox" id="pp-set-enabled" style="width:18px; height:18px;" ${c.enabled !== false ? 'checked' : ''}> このPOPを表示する
            </label>
            <div class="form-group"><label>アイコン（1〜2文字。空欄で非表示）</label>
                <input type="text" id="pp-set-icon" class="input-field" maxlength="4" value="${PV.esc(c.icon)}"></div>
            <div class="form-group"><label>タイトル</label>
                <input type="text" id="pp-set-title" class="input-field" value="${PV.esc(c.title)}"></div>
            <div class="form-group"><label>本文</label>
                <textarea id="pp-set-body" class="input-field" style="height:120px;">${PV.esc(c.body)}</textarea>
                <div class="fmt-hint">改行はそのまま反映されます。<code>**文字**</code> のように「**」で囲むと太字になります。</div></div>
            <div class="form-group"><label>「続ける」側のボタン（回答に戻る）</label>
                <input type="text" id="pp-set-continue" class="input-field" value="${PV.esc(c.continueText)}"></div>
            <div class="form-group"><label>「終了する」側のボタン（フォームを閉じる）</label>
                <input type="text" id="pp-set-exit" class="input-field" value="${PV.esc(c.exitText)}"></div>
            <button class="btn btn-secondary btn-sm" id="pp-reset" style="width:100%; margin-top:8px;">初期の文言に戻す</button>
            <div class="fmt-hint" style="margin-top:12px;">※ 変更後は右上の「フォームを保存」を押すと、回答者側のフォームに反映されます。</div>
        `;
    };

    const bindClosePopupEvents = () => {
        const c = formData.closePopup;
        const D = PV.DEFAULT_CLOSE_POPUP;
        const $ = (id) => document.getElementById(id);
        const en = $('pp-set-enabled');
        if (en) en.addEventListener('change', (e) => { c.enabled = e.target.checked; render(); });
        const bindText = (inputId, key, apply) => {
            const el = $(inputId);
            if (!el) return;
            el.addEventListener('input', (e) => { c[key] = e.target.value; apply(); });
        };
        bindText('pp-set-icon', 'icon', () => {
            const n = $('pp-icon'); if (!n) return;
            n.textContent = c.icon; n.style.display = c.icon ? 'flex' : 'none';
        });
        bindText('pp-set-title', 'title', () => { const n = $('pp-title'); if (n) n.textContent = c.title || D.title; });
        bindText('pp-set-body', 'body', () => { const n = $('pp-body'); if (n) n.innerHTML = PV.popupBodyHtml(c.body); });
        bindText('pp-set-continue', 'continueText', () => { const n = $('pp-continue'); if (n) n.textContent = c.continueText || D.continueText; });
        bindText('pp-set-exit', 'exitText', () => { const n = $('pp-exit'); if (n) n.textContent = c.exitText || D.exitText; });
        const reset = $('pp-reset');
        if (reset) reset.addEventListener('click', () => {
            if (!confirm('POPの文言を初期状態に戻します。よろしいですか？')) return;
            formData.closePopup = Object.assign({}, D);
            render();
        });
    };

    render();
};
