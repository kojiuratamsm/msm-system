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
                    <i class="ph ph-trash delete-q-btn" data-id="${q.id}"></i>
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
                
                .mockup-btn { background: rgba(0,0,0,0.8); color: white; padding: 16px 24px; border-radius: 8px; font-weight: 600; text-align: center; font-size: 1.1rem; box-shadow: 0 8px 24px rgba(0,0,0,0.2); backdrop-filter: blur(4px); margin-top: 24px; cursor: pointer; width: auto; }
                .mockup-input { width: 100%; border: none; border-bottom: 2px solid rgba(0,0,0,0.2); font-size: 1.2rem; padding: 8px 0; outline: none; margin-bottom: 24px; background: transparent; color: #333;}
                .mockup-choice { padding: 16px; border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; margin-bottom: 12px; font-weight: 500; color: #333; background: rgba(255,255,255,0.7); backdrop-filter: blur(8px); display: flex; align-items: center;}
                .mockup-img { max-width: 100%; border-radius: 8px; margin-bottom: 24px; max-height: 200px; object-fit: cover;}
                .required-mark { color: #dc3545; margin-left: 4px; font-size: 1.2em; font-weight: bold; }
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
                    if (e.target.classList.contains('delete-q-btn')) return;
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

            bindMockupEditableEvents(activeObj, isQuestion ? 'question' : activePageId);
            bindSettingsEvents(activeObj, isQuestion ? 'question' : activePageId);
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
            <div class="mockup-editable" id="mock-desc-node" data-prop="description" data-placeholder="説明文..." contenteditable="true" style="width: 100%; margin-bottom: 32px; line-height: 1.6; color: ${formData.theme.descColor}; font-size: ${descSize};">${obj.description || ''}</div>
        `;

        if ((type === 'op' || type === 'ed') && type !== 'review') {
            html += `<div class="mockup-btn" id="mock-btn-node">${obj.buttonText || 'スタート'}</div>`;
        } else if (type === 'question') {
            if (obj.type === 'short_text') {
                const placeholderVal = obj.placeholder !== undefined ? obj.placeholder : "こちらに回答を入力...";
                html += `<div class="mockup-editable" id="mock-placeholder-node" data-prop="placeholder" data-placeholder="プレースホルダーを入力..." contenteditable="true" style="border: none; border-bottom: 2px solid rgba(0,0,0,0.15); background: transparent; padding: 12px 0; height: auto; width: 100%; text-align: left; color: #888; font-size: 1.2rem; line-height: 1.4; display: flex; align-items: center;">${placeholderVal}</div>`;
            } else if (obj.type === 'long_text') {
                const placeholderVal = obj.placeholder !== undefined ? obj.placeholder : "こちらに回答を入力...";
                html += `<div class="mockup-editable" id="mock-placeholder-node" data-prop="placeholder" data-placeholder="プレースホルダーを入力..." contenteditable="true" style="border: none; border-bottom: 2px solid rgba(0,0,0,0.15); background: transparent; padding: 12px 0; height: auto; min-height: 44px; width: 100%; text-align: left; color: #888; font-size: 1.2rem; line-height: 1.5;">${placeholderVal}</div>`;
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
                        <option value="0.9rem" ${obj.descSize === '0.9rem' ? 'selected' : ''}>小</option>
                        <option value="1.05rem" ${obj.descSize === '1.05rem' ? 'selected' : ''}>中</option>
                        <option value="1.2rem" ${obj.descSize === '1.2rem' ? 'selected' : ''}>大</option>
                    </select>
                </div>
            </div>
        `;
        
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
            <h4 style="margin-bottom:16px;">🔌 UTAGE & カレンダー連携設定</h4>
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
            if(mockDesc) mockDesc.style.color = e.target.value;
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
                await Store.saveMEOFormSecrets(secretsData);
                saveSecretsBtn.innerHTML = '<i class="ph ph-check"></i> 保存完了';
                setTimeout(() => {
                    saveSecretsBtn.innerHTML = '<i class="ph ph-plug"></i> 連携設定を保存';
                }, 2000);
            });
        }
    };

    render();
};
