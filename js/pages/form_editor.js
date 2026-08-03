App.Pages.form_editor = async function() {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') {
        App.mount('<div class="card" style="margin-top:24px; padding: 40px; text-align:center;"><h3 class="card-title">アクセス権限がありません</h3></div>');
        return;
    }

    // デフォルトのフォームデータ構造
    const defaultFormData = {
        title: "MEOキーワード分析フォーム",
        op: {
            title: "Googleマップ売上分析診断",
            description: "あなたの店舗のMEOキーワードを分析します",
            imageUrl: "",
            buttonText: "診断をスタート",
            buttonSize: "medium"
        },
        ed: {
            title: "ご提出ありがとうございました！",
            description: "結果は担当者よりご連絡いたします。",
            imageUrl: "",
            buttonText: "終了する",
            buttonSize: "medium"
        },
        questions: [
            {
                id: "q" + Date.now(),
                type: "short_text",
                title: "店舗名or企業名を教えてください",
                description: "",
                required: true,
                choices: [],
                imageUrl: ""
            }
        ]
    };

    let formData = await Store.getMEOForm();
    if (!formData || !formData.op) {
        formData = JSON.parse(JSON.stringify(defaultFormData));
    }

    // 現在選択されているページ ( 'op', 'ed', または questionのid )
    let activePageId = 'op';

    const render = () => {
        let leftNavHtml = `
            <div class="editor-section-title" style="margin-bottom:16px; font-weight:600; color:var(--text-secondary);">Pages</div>
            <div class="editor-nav-item ${activePageId === 'op' ? 'active' : ''}" data-id="op">
                <i class="ph ph-door-open" style="margin-right:8px; font-size:1.2rem;"></i> OP: ${formData.op.title || 'タイトルなし'}
            </div>
            <div id="questions-list">
        `;

        formData.questions.forEach((q, index) => {
            leftNavHtml += `
                <div class="editor-nav-item ${activePageId === q.id ? 'active' : ''}" data-id="${q.id}">
                    <span style="background:var(--primary-color); color:white; border-radius:4px; padding:2px 6px; font-size:0.75rem; margin-right:8px;">${index + 1}</span> ${q.title || '無題の質問'}
                    <i class="ph ph-trash text-danger delete-q-btn" data-id="${q.id}" style="margin-left:auto; cursor:pointer;"></i>
                </div>
            `;
        });

        leftNavHtml += `
            </div>
            <button class="btn btn-secondary" id="add-q-btn" style="width:100%; margin-top:16px; justify-content:center;">
                <i class="ph ph-plus"></i> 質問を追加
            </button>

            <div class="editor-section-title" style="margin-top:32px; margin-bottom:16px; font-weight:600; color:var(--text-secondary);">Endings</div>
            <div class="editor-nav-item ${activePageId === 'ed' ? 'active' : ''}" data-id="ed">
                <i class="ph ph-flag-checkered" style="margin-right:8px; font-size:1.2rem;"></i> ED: ${formData.ed.title || 'タイトルなし'}
            </div>
        `;

        // プレビューと設定パネルの生成
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
                .editor-nav-item { padding: 12px 16px; border-radius: 8px; margin-bottom: 8px; cursor: pointer; display: flex; align-items: center; background: #f8f9fc; transition: 0.2s; font-size: 0.9rem; font-weight: 500;}
                .editor-nav-item:hover { background: #eef2f7; }
                .editor-nav-item.active { background: var(--primary-color); color: white; }
                .editor-nav-item.active i { color: white !important; }
                .editor-nav-item.active .text-danger { color: #ffcccc !important; }
                
                /* Smartphone Mockup CSS */
                .phone-mockup { width: 340px; height: 680px; background: white; border-radius: 40px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); border: 12px solid #2c3e50; position: relative; overflow: hidden; display: flex; flex-direction: column; font-family: 'Inter', sans-serif;}
                .phone-mockup-inner { flex: 1; padding: 32px 24px; display: flex; flex-direction: column; justify-content: center; overflow-y: auto;}
                .mockup-title { font-size: 1.5rem; font-weight: 700; color: #1a1a1a; margin-bottom: 12px; line-height: 1.4; }
                .mockup-desc { font-size: 1rem; color: #666; margin-bottom: 32px; line-height: 1.6; }
                .mockup-btn { background: var(--primary-color); color: white; padding: 16px 24px; border-radius: 8px; font-weight: 600; text-align: center; font-size: 1.1rem; box-shadow: 0 4px 12px rgba(13, 110, 253, 0.3); }
                .mockup-input { width: 100%; border: none; border-bottom: 2px solid #e0e0e0; font-size: 1.2rem; padding: 8px 0; outline: none; margin-bottom: 24px; background: transparent; color: #333;}
                .mockup-choice { padding: 16px; border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 12px; font-weight: 500; color: #333; background: #fafafa; display: flex; align-items: center;}
                .mockup-img { max-width: 100%; border-radius: 8px; margin-bottom: 24px; max-height: 200px; object-fit: cover;}
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
                <div class="editor-left">
                    ${leftNavHtml}
                </div>
                
                <div class="editor-middle">
                    <div class="phone-mockup">
                        ${mockupHtml}
                    </div>
                </div>

                <div class="editor-right">
                    ${settingsHtml}
                </div>
            </div>
        `;

        App.mount(html, () => {
            // イベントリスナーの登録
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
                    if (formData.questions.length >= 50) {
                        alert('質問は最大50個までです。');
                        return;
                    }
                    const newId = "q" + Date.now();
                    formData.questions.push({
                        id: newId,
                        type: "short_text",
                        title: "新しい質問",
                        description: "",
                        required: true,
                        choices: [],
                        imageUrl: ""
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

            // リアルタイム反映のためのイベント登録
            bindSettingsEvents(activeObj, isQuestion ? 'question' : activePageId);
        });
    };

    const generateMockupHtml = (obj, type) => {
        let html = `<div class="phone-mockup-inner">`;
        if (obj.imageUrl) {
            html += `<img src="${obj.imageUrl}" class="mockup-img">`;
        }
        html += `<div class="mockup-title">${obj.title || 'テキストを入力...'}</div>`;
        if (obj.description) {
            html += `<div class="mockup-desc">${obj.description.replace(/\\n/g, '<br>')}</div>`;
        }

        if (type === 'op' || type === 'ed') {
            html += `<div style="margin-top:auto;"><div class="mockup-btn">${obj.buttonText || 'ボタン'}</div></div>`;
        } else if (type === 'question') {
            if (obj.type === 'short_text') {
                html += `<input type="text" class="mockup-input" placeholder="回答を入力...">`;
            } else if (obj.type === 'long_text') {
                html += `<input type="text" class="mockup-input" placeholder="回答を入力..." style="height:60px;">`;
            } else if (obj.type === 'multiple_choice' || obj.type === 'dropdown') {
                if (!obj.choices || obj.choices.length === 0) {
                    html += `<div class="mockup-choice" style="opacity:0.5;">選択肢がありません</div>`;
                } else {
                    obj.choices.forEach((c, idx) => {
                        const alpha = String.fromCharCode(65 + idx); // A, B, C...
                        html += `<div class="mockup-choice"><div style="background:#e0e0e0; width:24px; height:24px; border-radius:4px; display:flex; align-items:center; justify-content:center; margin-right:12px; font-size:0.8rem; font-weight:700;">${alpha}</div> ${c}</div>`;
                    });
                }
            }
            if (obj.required) {
                 html = `<div style="position:absolute; top:24px; left:24px; background:rgba(0,0,0,0.05); padding:4px 8px; border-radius:4px; font-size:0.75rem; font-weight:600; color:#666;">必須</div>` + html;
            }
        }
        html += `</div>`;
        return html;
    };

    const generateSettingsHtml = (obj, type) => {
        let html = `<h3 style="margin-top:0; margin-bottom:24px; font-size:1.2rem;">${type === 'op' ? 'OP設定' : type === 'ed' ? 'ED設定' : '質問設定'}</h3>`;
        
        if (type === 'question') {
            html += `
                <div class="form-group">
                    <label>質問タイプ</label>
                    <select id="set-type" class="input-field">
                        <option value="short_text" ${obj.type === 'short_text' ? 'selected' : ''}>記述式 (短文)</option>
                        <option value="long_text" ${obj.type === 'long_text' ? 'selected' : ''}>記述式 (長文)</option>
                        <option value="multiple_choice" ${obj.type === 'multiple_choice' ? 'selected' : ''}>選択肢 (複数/単一)</option>
                        <option value="dropdown" ${obj.type === 'dropdown' ? 'selected' : ''}>プルダウン</option>
                    </select>
                </div>
            `;
        }

        html += `
            <div class="form-group">
                <label>タイトル (質問文)</label>
                <input type="text" id="set-title" class="input-field" value="${obj.title}">
            </div>
            <div class="form-group">
                <label>補足説明</label>
                <textarea id="set-desc" class="input-field" style="height:80px;">${obj.description || ''}</textarea>
            </div>
            <div class="form-group">
                <label>画像URL (任意)</label>
                <input type="text" id="set-img" class="input-field" value="${obj.imageUrl || ''}" placeholder="https://...">
            </div>
        `;

        if (type === 'op' || type === 'ed') {
            html += `
                <div class="form-group">
                    <label>ボタンテキスト</label>
                    <input type="text" id="set-btn-text" class="input-field" value="${obj.buttonText}">
                </div>
            `;
        }

        if (type === 'question') {
            html += `
                <div class="form-group" style="display:flex; align-items:center; margin-top:24px; margin-bottom:24px;">
                    <label style="margin:0; flex:1;">回答を必須にする</label>
                    <input type="checkbox" id="set-required" style="width:20px; height:20px;" ${obj.required ? 'checked' : ''}>
                </div>
            `;

            if (obj.type === 'multiple_choice' || obj.type === 'dropdown') {
                html += `<div class="form-group"><label>選択肢設定</label><div id="choices-container">`;
                const choices = obj.choices || [];
                choices.forEach((c, idx) => {
                    html += `<div style="display:flex; gap:8px; margin-bottom:8px;">
                                <input type="text" class="input-field set-choice-input" data-index="${idx}" value="${c}" style="margin-bottom:0;">
                                <button class="btn btn-danger delete-choice-btn" data-index="${idx}" style="padding:0 12px;"><i class="ph ph-trash"></i></button>
                             </div>`;
                });
                html += `</div><button class="btn btn-secondary btn-sm" id="add-choice-btn" style="margin-top:8px; width:100%;"><i class="ph ph-plus"></i> 選択肢を追加</button></div>`;
            }
        }

        return html;
    };

    const bindSettingsEvents = (obj, type) => {
        const bindInput = (id, prop) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', (e) => {
                    obj[prop] = e.target.value;
                    updateMockup(obj, type);
                });
            }
        };

        bindInput('set-title', 'title');
        bindInput('set-desc', 'description');
        bindInput('set-img', 'imageUrl');
        if (type === 'op' || type === 'ed') bindInput('set-btn-text', 'buttonText');

        const typeSelect = document.getElementById('set-type');
        if (typeSelect) {
            typeSelect.addEventListener('change', (e) => {
                obj.type = e.target.value;
                if (!obj.choices) obj.choices = [];
                render(); // UI全体を再描画して選択肢エディタを表示/非表示
            });
        }

        const reqCheck = document.getElementById('set-required');
        if (reqCheck) {
            reqCheck.addEventListener('change', (e) => {
                obj.required = e.target.checked;
                updateMockup(obj, type);
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
                updateMockup(obj, type);
            });
        });

        document.querySelectorAll('.delete-choice-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                const idx = parseInt(el.getAttribute('data-index'));
                obj.choices.splice(idx, 1);
                render();
            });
        });
    };

    const updateMockup = (obj, type) => {
        const mockupContainer = document.querySelector('.phone-mockup');
        if (mockupContainer) {
            mockupContainer.innerHTML = generateMockupHtml(obj, type);
        }
        // サイドバーのタイトルも更新
        if (type === 'op' || type === 'ed' || type === 'question') {
            const navItem = document.querySelector(`.editor-nav-item[data-id="${activePageId}"]`);
            if (navItem) {
                if (type === 'op') navItem.innerHTML = `<i class="ph ph-door-open" style="margin-right:8px; font-size:1.2rem;"></i> OP: ${obj.title || 'タイトルなし'}`;
                if (type === 'ed') navItem.innerHTML = `<i class="ph ph-flag-checkered" style="margin-right:8px; font-size:1.2rem;"></i> ED: ${obj.title || 'タイトルなし'}`;
                if (type === 'question') {
                    const idx = formData.questions.findIndex(q => q.id === obj.id);
                    navItem.innerHTML = `<span style="background:var(--primary-color); color:white; border-radius:4px; padding:2px 6px; font-size:0.75rem; margin-right:8px;">${idx + 1}</span> ${obj.title || '無題の質問'} <i class="ph ph-trash text-danger delete-q-btn" data-id="${obj.id}" style="margin-left:auto; cursor:pointer;"></i>`;
                    // 再バインド
                    navItem.querySelector('.delete-q-btn').addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (confirm('この質問を削除してもよろしいですか？')) {
                            formData.questions = formData.questions.filter(q => q.id !== obj.id);
                            activePageId = 'op';
                            render();
                        }
                    });
                }
            }
        }
    };

    render();
};
