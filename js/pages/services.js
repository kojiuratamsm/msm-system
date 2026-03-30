App.Pages.services = async function() {
    const user = Auth.getCurrentUser();
    const isAdmin = user && user.role === 'admin';
    const settings = await Store.getSettings();
    const customServices = settings.services || [];

    const defaultServices = [
        {
            title: 'Plus One',
            badge: '<div class="badge badge-info">映像制作</div>',
            desc: 'ショート動画からYouTubeの長尺まで、質の高い動画制作サービスを提供します。',
            buttons: `
                <button class="btn-secondary" onclick="App.navigate('customers', 'plusOne')">顧客管理へ</button>
                <button class="btn-primary btn-sm" onclick="App.navigate('sales', 'plusOne')">売上計算へ</button>
            `
        },
        {
            title: 'MEO対策チャンネル',
            badge: '<div class="badge badge-success">MEO</div>',
            desc: 'Googleビジネスプロフィールを活用した集客支援、ブログ投稿、定期運用を代行。',
            buttons: `
                <button class="btn-secondary" onclick="App.navigate('customers', 'meo')">顧客管理へ</button>
                <button class="btn-primary btn-sm" onclick="App.navigate('sales', 'meo')">売上計算へ</button>
            `
        },
        {
            title: '通信',
            badge: '<div class="badge badge-warning">人材派遣</div>',
            desc: '現場ごとの通信インフラ整備、保守作業。単価ベースでの収益管理に対応。',
            buttons: `
                <button class="btn-secondary" onclick="App.navigate('customers', 'telecom')">顧客管理へ</button>
                <button class="btn-primary btn-sm" onclick="App.navigate('sales', 'telecom')">売上計算へ</button>
            `
        }
    ];

    const allServicesHtml = defaultServices.map(s => `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">${s.title}</h3>
                ${s.badge}
            </div>
            <p style="color: var(--text-secondary); margin-bottom: 24px; line-height: 1.6; flex: 1;">${s.desc}</p>
            <div class="grid grid-2" style="margin-top:auto;">${s.buttons}</div>
        </div>
    `).join('') + customServices.map(s => `
        <div class="card" style="position:relative; display: flex; flex-direction: column;">
            ${s.thumb ? `<div style="height: 140px; border-radius: 4px; overflow: hidden; margin-bottom: 16px;"><img src="${s.thumb}" style="width: 100%; height: 100%; object-fit: cover;"></div>` : ''}
            <div class="card-header" style="${s.thumb ? 'margin-bottom:8px;' : ''}">
                <h3 class="card-title" style="font-size: 1.1rem;">${s.title}</h3>
            </div>
            ${s.desc ? `<p style="color: var(--text-secondary); margin-bottom: 24px; line-height: 1.6; flex: 1; font-size: 0.9rem; white-space: pre-wrap;">${s.desc}</p>` : `<div style="flex:1;"></div>`}
            <div class="grid grid-1" style="margin-top:auto;">
                <a href="${s.url}" target="_blank" class="btn-primary btn-sm p-1" style="text-align:center; text-decoration:none;">サイトを開く <i class="ph ph-arrow-square-out"></i></a>
            </div>
        </div>
    `).join('');

    let html = `
        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom: 24px;">
            <h2 style="font-size: 1.5rem;">サービス一覧</h2>
            ${isAdmin ? `
                <div style="display: flex; gap: 8px;">
                    <button class="btn-primary btn-sm" onclick="document.getElementById('service-add-modal').classList.add('active')" style="height: fit-content;">
                        <i class="ph ph-plus"></i> サービス追加
                    </button>
                    <button class="btn-secondary btn-sm" onclick="document.getElementById('service-edit-modal').classList.add('active')" style="height: fit-content;">
                        <i class="ph ph-pencil-simple"></i> サービス編集
                    </button>
                </div>
            ` : ''}
        </div>
        
        <div class="grid grid-3" style="align-items: stretch;">
            ${allServicesHtml}
        </div>
    `;

    if (isAdmin) {
        html += `
            <!-- Service Add Modal -->
            <div class="modal-overlay" id="service-add-modal">
                <div class="modal-content" style="max-width: 600px; max-height: 90vh; overflow-y: auto;">
                    <div class="modal-header">
                        <h3 class="modal-title">新規サービス追加</h3>
                        <button class="modal-close" onclick="document.getElementById('service-add-modal').classList.remove('active')"><i class="ph ph-x"></i></button>
                    </div>
                    
                    <form id="add-custom-service-form" style="padding-bottom: 16px;">
                        <div class="grid grid-1">
                            <div class="form-group"><label>事業名 (サービス名)</label><input type="text" id="cs-title" required></div>
                            <div class="form-group"><label>サービス概要</label><textarea id="cs-desc" rows="3" placeholder="サービスの説明などを入力"></textarea></div>
                            <div class="form-group"><label>サムネイル(画像URL)</label><input type="url" id="cs-thumb"></div>
                            <div class="form-group"><label>リンクURL</label><input type="url" id="cs-url" required></div>
                            <button type="submit" class="btn-primary w-100">サービスを追加する</button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- Service Edit Modal -->
            <div class="modal-overlay" id="service-edit-modal">
                <div class="modal-content" style="max-width: 700px; max-height: 90vh; overflow-y: auto; background: #f8f9fa;">
                    <div class="modal-header">
                        <h3 class="modal-title">サービス編集・システム設定</h3>
                        <button class="modal-close" onclick="document.getElementById('service-edit-modal').classList.remove('active')"><i class="ph ph-x"></i></button>
                    </div>

                    ${customServices.length > 0 ? `
                        <h4 style="margin-bottom: 12px; font-size:1rem; color: var(--primary);">追加済みサービスの編集</h4>
                        <div style="margin-bottom: 32px;">
                            ${customServices.map(s => `
                                <div style="background: #fff; padding: 16px; border: 1px solid var(--border-light); border-radius: 8px; margin-bottom: 16px; position:relative;">
                                    <div class="grid grid-2" style="margin-bottom:12px;">
                                        <div class="form-group"><label>事業名</label><input type="text" id="edit-title-${s.id}" value="${s.title}"></div>
                                        <div class="form-group"><label>リンクURL</label><input type="url" id="edit-url-${s.id}" value="${s.url}"></div>
                                        <div class="form-group" style="grid-column: span 2;"><label>サービス概要</label><textarea id="edit-desc-${s.id}" rows="2">${s.desc || ''}</textarea></div>
                                        <div class="form-group" style="grid-column: span 2;"><label>サムネイルURL</label><input type="url" id="edit-thumb-${s.id}" value="${s.thumb || ''}"></div>
                                    </div>
                                    <div style="display:flex; justify-content: space-between;">
                                        <button class="btn-secondary btn-sm p-1" style="color:var(--danger); border-color:var(--danger);" onclick="deleteCustomService('${s.id}')"><i class="ph ph-trash"></i> 削除</button>
                                        <button class="btn-primary btn-sm p-1" onclick="saveCustomService('${s.id}')">変更を保存</button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : '<div style="margin-bottom:32px; color:var(--text-secondary);">追加されたカスタムサービスはありません。</div>'}

                    <h4 style="margin-bottom: 12px; font-size:1rem; color: var(--primary); padding-top: 24px; border-top: 1px solid var(--border-light);">システム外観設定</h4>
                    <form id="system-settings-form">
                        <div class="grid grid-1" style="background:#fff; padding:16px; border:1px solid var(--border-light); border-radius:8px;">
                            <div class="form-group"><label>ログイン画面 背景画像URL</label><input type="url" id="sys-bg" value="${settings.bgUrl || ''}" placeholder="未設定の場合はデフォルト"></div>
                            <div class="form-group"><label>メインロゴ 画像URL</label><input type="url" id="sys-logo" value="${settings.logoUrl || ''}" placeholder="未設定の場合は「MSM」テキスト"></div>
                            <button type="submit" class="btn-primary w-100">外観設定を保存する</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    }

    App.mount(html, () => {
        if (!isAdmin) return;

        window.deleteCustomService = async (idStr) => {
            if(!confirm('本当に削除してもよろしいですか？')) return;
            const settingsData = await Store.getSettings();
            if(!settingsData.services) settingsData.services = [];
            settingsData.services = settingsData.services.filter(s => String(s.id) !== idStr);
            await Store.updateSettings(settingsData);
            App.navigate('services');
        };

        window.saveCustomService = async (idStr) => {
            const title = document.getElementById(`edit-title-${idStr}`).value;
            const desc = document.getElementById(`edit-desc-${idStr}`).value;
            const thumb = document.getElementById(`edit-thumb-${idStr}`).value;
            const url = document.getElementById(`edit-url-${idStr}`).value;

            if(!title || !url) { alert('事業名とリンクURLは必須です'); return; }

            const settingsData = await Store.getSettings();
            const idx = settingsData.services.findIndex(s => String(s.id) === idStr);
            if(idx !== -1) {
                settingsData.services[idx] = { ...settingsData.services[idx], title, desc, thumb, url };
                await Store.updateSettings(settingsData);
                App.navigate('services');
            }
        };

        const addSvcForm = document.getElementById('add-custom-service-form');
        if(addSvcForm) {
            addSvcForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const settingsData = await Store.getSettings();
                if(!settingsData.services) settingsData.services = [];
                settingsData.services.push({
                    id: Date.now(),
                    title: document.getElementById('cs-title').value,
                    desc: document.getElementById('cs-desc').value,
                    thumb: document.getElementById('cs-thumb').value,
                    url: document.getElementById('cs-url').value
                });
                await Store.updateSettings(settingsData);
                App.navigate('services');
            });
        }

        const sysForm = document.getElementById('system-settings-form');
        if(sysForm) {
            sysForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const settingsData = await Store.getSettings();
                settingsData.bgUrl = document.getElementById('sys-bg').value;
                settingsData.logoUrl = document.getElementById('sys-logo').value;
                await Store.updateSettings(settingsData);
                alert('設定を保存しました。リロードすると全体に反映されます。');
                App.navigate('services');
            });
        }
    });
};
