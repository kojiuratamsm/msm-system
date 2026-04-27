App.Pages.youtube = async function() {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') {
        App.mount('<div class="card" style="margin-top:24px; padding: 40px; text-align:center;"><h3 class="card-title">アクセス権限がありません</h3><p style="color:var(--text-secondary); margin-top: 16px;">YouTubeは管理者のみ閲覧可能です。</p></div>');
        return;
    }

    let activeTab = window.ytActiveTab || 'video';
    let videoTypeTab = window.ytVideoTypeMode || 'long';
    let selectedChannelId = window.ytSelectedChannelId || null;
    let selectedLineId = window.ytSelectedLineId || null;

    const channels = await Store.getYTChannels();
    let lines = await Store.getYTLines();
    let videos = selectedChannelId ? await Store.getYTVideos(selectedChannelId) : [];
    
    const settingsData = await Store.getCustomers('settings');
    const apiSettingsRow = settingsData.find(d => d.type === 'youtube_api_key');
    const apiKey = apiSettingsRow ? apiSettingsRow.key : '';

    const getHtml = () => `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; flex-wrap:wrap; gap:16px;">
            <div style="display:flex; align-items:center; gap:16px;">
                <h2 style="font-size:1.5rem; margin:0;">YouTube 管理</h2>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="btn-sm ${activeTab === 'video' ? 'btn-primary' : 'btn-secondary'}" onclick="window.ytActiveTab='video'; App.navigate('youtube')"><i class="ph ph-video-camera"></i> 動画進捗</button>
                <button class="btn-sm ${activeTab === 'script' ? 'btn-primary' : 'btn-secondary'}" onclick="window.ytActiveTab='script'; App.navigate('youtube')"><i class="ph ph-notebook"></i> 台本作成</button>
                <button class="btn-sm ${activeTab === 'line' ? 'btn-primary' : 'btn-secondary'}" onclick="window.ytActiveTab='line'; App.navigate('youtube')"><i class="ph ph-chat-circle-dots"></i> 公式LINE</button>
                <button class="btn-success btn-sm" onclick="syncAllChannels()"><i class="ph ph-arrows-clockwise"></i> 全てのChを一括更新</button>
                <button class="btn-secondary btn-sm" onclick="document.getElementById('yt-channel-modal').classList.add('active')"><i class="ph ph-plus"></i> チャンネル追加</button>
            </div>
        </div>

        ${activeTab === 'video' ? renderVideoTab() : (activeTab === 'script' ? renderScriptTab() : renderLineTab())}

        <!-- Modals -->
        <div class="modal-overlay" id="yt-channel-modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">チャンネル登録・更新</h3>
                    <button class="modal-close" onclick="document.getElementById('yt-channel-modal').classList.remove('active')"><i class="ph ph-x"></i></button>
                </div>
                <form id="yt-add-channel-form">
                    <input type="hidden" id="c-id">
                    <div class="form-group"><label>チャンネル名</label><input type="text" id="c-name" required></div>
                    <div class="form-group"><label>チャンネル登録者数</label><input type="number" id="c-subs" required></div>
                    <div class="form-group"><label>URL</label><input type="url" id="c-url" required></div>
                    <div class="form-group"><label>メールアドレス</label><input type="email" id="c-email" required></div>
                    <div class="form-group"><label>パスワード</label><input type="text" id="c-pass" required></div>
                    <button type="submit" class="btn-primary w-100">登録 / 更新</button>
                </form>
            </div>
        </div>

        <div class="modal-overlay" id="yt-video-add-modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">動画追加・基本情報編集</h3>
                    <button class="modal-close" onclick="document.getElementById('yt-video-add-modal').classList.remove('active')"><i class="ph ph-x"></i></button>
                </div>
                <form id="yt-add-video-form">
                    <input type="hidden" id="v-id">
                    <div class="form-group"><label>動画タイトル</label><input type="text" id="v-title" required></div>
                    <div class="form-group"><label>投稿日</label><input type="date" id="v-date" required></div>
                    <div class="form-group"><label>再生数</label><input type="number" id="v-views" required></div>
                    <div class="form-group"><label>インプレッション数</label><input type="number" id="v-imps" required></div>
                    <div class="form-group"><label>クリック率 (%)</label><input type="number" step="0.1" id="v-ctr" required></div>
                    <div class="form-group"><label>キーワード</label><input type="text" id="v-kw" placeholder="カンマ区切りで入力"></div>
                    <button type="submit" class="btn-primary w-100">保存</button>
                </form>
            </div>
        </div>

        <div class="modal-overlay" id="yt-video-update-modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">動画の最新数値を更新</h3>
                    <button class="modal-close" onclick="document.getElementById('yt-video-update-modal').classList.remove('active')"><i class="ph ph-x"></i></button>
                </div>
                <form id="yt-update-video-form">
                    <input type="hidden" id="uv-id">
                    <div class="form-group"><label>当日の日付</label><input type="date" id="uv-date" value="${new Date().toISOString().slice(0,10)}" required></div>
                    <div class="form-group"><label>最新 再生数</label><input type="number" id="uv-views" required></div>
                    <div class="form-group"><label>最新 インプレッション数</label><input type="number" id="uv-imps" required></div>
                    <div class="form-group"><label>最新 クリック率 (%)</label><input type="number" step="0.1" id="uv-ctr" required></div>
                    <button type="submit" class="btn-primary w-100">数値を更新する</button>
                </form>
            </div>
        </div>

        <div class="modal-overlay" id="yt-line-modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">公式LINE登録・更新</h3>
                    <button class="modal-close" onclick="document.getElementById('yt-line-modal').classList.remove('active')"><i class="ph ph-x"></i></button>
                </div>
                <form id="yt-add-line-form">
                    <input type="hidden" id="l-id">
                    <div class="form-group"><label>LINE名</label><input type="text" id="l-name" required></div>
                    <div class="form-group"><label>連携チャンネル</label>
                        <select id="l-channel" required>
                            ${channels.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group"><label>当日の日付</label><input type="date" id="l-date" value="${new Date().toISOString().slice(0,10)}" required></div>
                    <div class="form-group"><label>LINE登録者数</label><input type="number" id="l-subs" required></div>
                    <button type="submit" class="btn-primary w-100">登録 / 数値更新</button>
                </form>
            </div>
        </div>


    `;

    function renderVideoTab() {
        let html = `
            <div class="card" style="margin-bottom: 24px;">
                <div class="form-group" style="margin-bottom:0;">
                    <label>対象のチャンネルを選択</label>
                    <select onchange="window.ytSelectedChannelId = this.value; App.navigate('youtube')">
                        <option value="">--選択してください--</option>
                        ${channels.map(c => `<option value="${c.id}" ${selectedChannelId == c.id ? 'selected':''}>${c.name}</option>`).join('')}
                    </select>
                </div>
            </div>
        `;

        if (!selectedChannelId) {
            html += `<div style="text-align:center; padding:40px; color:var(--text-secondary);">チャンネルを選択してください。</div>`;
            return html;
        }

        const channel = channels.find(c => c.id == selectedChannelId);
        if (channel) {
            html += `
                <div class="card" style="margin-bottom: 24px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <h3 style="font-size:1.2rem; margin-bottom:8px;">${channel.name}</h3>
                        <p style="color:var(--text-secondary); font-size:0.9rem;">
                            登録者数: <strong style="color:var(--text-primary);">${channel.subs}</strong> | 
                            <a href="${channel.url}" target="_blank" style="color:var(--info);">URL</a> | 
                            ${channel.email}
                        </p>
                    </div>
                    <div>
                        <button class="btn-secondary btn-sm" onclick="editChannel(${channel.id})">チャンネル情報を編集</button>
                        <button class="btn-primary btn-sm" onclick="document.getElementById('yt-video-add-modal').classList.add('active')">
                            <i class="ph ph-video-camera"></i> 新規動画を追加
                        </button>
                        <button class="btn-success btn-sm" onclick="syncChannelVideos(${channel.id})" style="margin-left:8px;" title="APIキーが必要です">
                            <i class="ph ph-arrows-clockwise"></i> 最新動画を自動取得
                        </button>
                    </div>
                </div>
                
                <script>
                    // 自動更新：最後に更新された日付をチェックし、今日まだなら自動で同期を実行
                    (async () => {
                        const channelId = "${channel.id}";
                        const lastSyncKey = "yt_sync_" + channelId;
                        const today = new Date().toISOString().slice(0, 10);
                        if (localStorage.getItem(lastSyncKey) !== today) {
                            console.log("YouTube自動同期を開始します...");
                            await window.syncChannelVideos(channelId, true);
                            localStorage.setItem(lastSyncKey, today);
                            // 同期完了後に画面をリフレッシュ（数値反映のため）
                            App.navigate('youtube');
                        }
                    })();
                </script>
            `;
        }

        if (videos.length === 0) {
            html += `<div style="text-align:center; padding:24px; color:var(--text-secondary);">動画がまだ追加されていません。</div>`;
        } else {
            const longVids = videos.filter(v => v.isShort !== true);
            const shortVids = videos.filter(v => v.isShort === true);
            
            const renderVideoGrid = (vids) => {
                if(vids.length === 0) return '<p style="color:var(--text-secondary); margin-bottom: 24px;">該当の動画がありません。</p>';
                let out = `<div class="grid grid-2" style="margin-bottom: 32px;">`;
                vids.forEach((v) => {
                    const h = v.history || [];
                    const first = h[0] || { views: v.views, imps: v.imps, ctr: v.ctr, date: v.date };
                    const latest = h[h.length - 1] || first;
                    
                    const viewsDiff = latest.views - first.views;
                    const impsDiff = latest.imps - first.imps;
                    const ctrDiff = (latest.ctr - first.ctr).toFixed(1);

                    const isId = v.kw && v.kw.length === 11;
                    const thumbUrl = isId ? `https://i.ytimg.com/vi/${v.kw}/mqdefault.jpg` : 'https://via.placeholder.com/120x68?text=No+Image';

                    out += `
                        <div class="card">
                            <div style="display:flex; gap:12px; margin-bottom:12px; align-items:flex-start;">
                                <img src="${thumbUrl}" style="width:120px; height:68px; object-fit:cover; border-radius:4px; flex-shrink:0;">
                                <div style="flex:1;">
                                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                        <h4 style="font-size:1rem; line-height:1.4; margin-bottom:4px;">${v.title}</h4>
                                        <div style="display:flex; flex-direction:column; gap:4px; margin-left:8px;">
                                            <button class="btn-success btn-sm p-1" style="font-size:0.75rem;" onclick="openScriptEditor(${v.id})"><i class="ph ph-notebook"></i> 台本作成</button>
                                            <button class="btn-primary btn-sm p-1" style="font-size:0.75rem;" onclick="updateVideoData(${v.id})">数値更新</button>
                                            <button class="btn-secondary btn-sm p-1" style="font-size:0.75rem;" onclick="editVideo(${v.id})">編集</button>
                                        </div>
                                    </div>
                                    <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:0px;">
                                        投稿日: ${v.date} ${!isId ? '| KW: '+(v.kw||'-') : ''}
                                    </p>
                                </div>
                            </div>
                            
                            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap:8px; margin-bottom: 24px;">
                                <div style="background:var(--bg-tertiary); padding:12px 4px; border-radius:4px; text-align:center;">
                                    <div style="font-size:0.75rem; color:var(--text-secondary); white-space:nowrap;">最新再生数</div>
                                    <div style="font-weight:bold; font-size:1.1rem; margin: 4px 0;">${latest.views.toLocaleString()}</div>
                                    <div style="font-size:0.75rem; color:${viewsDiff >= 0 ? 'var(--success)':'var(--danger)'};">${viewsDiff >= 0 ? '+' : ''}${viewsDiff.toLocaleString()}</div>
                                </div>
                                <div style="background:var(--bg-tertiary); padding:12px 4px; border-radius:4px; text-align:center;">
                                    <div style="font-size:0.75rem; color:var(--text-secondary); white-space:nowrap;">インプレッション</div>
                                    <div style="font-weight:bold; font-size:1.1rem; margin: 4px 0;">${latest.imps.toLocaleString()}</div>
                                    <div style="font-size:0.75rem; color:${impsDiff >= 0 ? 'var(--success)':'var(--danger)'};">${impsDiff >= 0 ? '+' : ''}${impsDiff.toLocaleString()}</div>
                                </div>
                                <div style="background:var(--bg-tertiary); padding:12px 4px; border-radius:4px; text-align:center;">
                                    <div style="font-size:0.75rem; color:var(--text-secondary); white-space:nowrap;">最新CTR</div>
                                    <div style="font-weight:bold; font-size:1.1rem; margin: 4px 0;">${latest.ctr}%</div>
                                    <div style="font-size:0.75rem; color:${ctrDiff >= 0 ? 'var(--success)':'var(--danger)'};">${ctrDiff >= 0 ? '+' : ''}${ctrDiff}%</div>
                                </div>
                            </div>

                            ${h.length > 1 ? `
                                <div style="height: 150px; width: 100%; position:relative;">
                                    <canvas id="chart-v-${v.id}"></canvas>
                                </div>
                            ` : '<div style="font-size:0.8rem; color:var(--text-secondary); text-align:center;">数値を更新すると推移グラフが表示されます。</div>'}
                        </div>
                    `;
                });
                out += `</div>`;
                return out;
            };
            
            html += `
                <div style="margin-bottom: 16px; display:flex; gap:8px;">
                    <button class="btn-sm ${videoTypeTab === 'long' ? 'btn-primary' : 'btn-secondary'}" onclick="window.ytVideoTypeMode='long'; App.navigate('youtube')">長尺動画</button>
                    <button class="btn-sm ${videoTypeTab === 'short' ? 'btn-primary' : 'btn-secondary'}" onclick="window.ytVideoTypeMode='short'; App.navigate('youtube')">ショート動画</button>
                </div>
            `;

            if(videoTypeTab === 'long') {
                html += renderVideoGrid(longVids);
            } else {
                html += renderVideoGrid(shortVids);
            }
        }
        return html;
    }

    function renderLineTab() {
        let html = `
            <div class="card" style="margin-bottom: 24px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
                <div class="form-group" style="margin-bottom:0; flex:1;">
                    <label>対象の公式LINE (UTAGE連携) を選択</label>
                    <select onchange="window.ytSelectedLineId = this.value; App.navigate('youtube')" style="max-width: 400px;">
                        <option value="">-- LINEを選択してください --</option>
                        ${lines.map(l => `<option value="${l.id}" ${selectedLineId == l.id ? 'selected':''}>${l.name}</option>`).join('')}
                    </select>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="btn-success" onclick="syncLINERealtime()"><i class="ph ph-arrows-clockwise"></i> LINEから最新情報を同期</button>
                    <button class="btn-secondary" onclick="addLine()"><i class="ph ph-plus"></i> 手動追加</button>
                </div>
            </div>
        `;

        if (!selectedLineId) {
            html += `<div style="text-align:center; padding:40px; color:var(--text-secondary);">上に表示されているプルダウンから公式LINEを選択してください。</div>`;
            return html;
        }

        const line = lines.find(x => x.id == selectedLineId);
        if (!line) return html;

        const channel = channels.find(c => c.id == line.channelId);
        const channelName = channel ? channel.name : '不明なチャンネル';
        const channelSubs = channel ? channel.subs : 0;
        
        const h = line.history || [];
        const latestInfo = h[h.length - 1] || { subs: 0 };

        // UTAGE連携の登録経路モックデータ（API接続後に本データに差し替え）
        const mockRoutes = [
            { name: "YouTube動画 概要覧", value: Math.floor(latestInfo.subs * 0.6) },
            { name: "YouTubeショート", value: Math.floor(latestInfo.subs * 0.25) },
            { name: "その他 / 不明", value: latestInfo.subs - Math.floor(latestInfo.subs * 0.6) - Math.floor(latestInfo.subs * 0.25) }
        ];

        html += `
            <div class="grid grid-2" style="gap:24px;">
                <!-- 左：基本数値と推移グラフ -->
                <div class="card">
                    <div style="display:flex; justify-content:space-between; margin-bottom:16px;">
                        <div>
                            <h3 style="font-size:1.3rem; margin-bottom:4px; color:var(--primary-dark);"><i class="ph ph-chats-circle"></i> ${line.name}</h3>
                            <p style="font-size:0.85rem; color:var(--text-secondary);">紐づけCh: ${channelName}</p>
                        </div>
                        <button class="btn-secondary btn-sm p-1" style="height:fit-content;" onclick="updateLine(${line.id})">設定</button>
                    </div>
                    
                    <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:12px; margin-bottom:24px;">
                        <div style="background:var(--bg-tertiary); padding:16px 8px; border-radius:8px; text-align:center; display:flex; flex-direction:column; justify-content:center;">
                            <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:4px; white-space:nowrap; overflow:hidden;">YouTube登録者</div>
                            <div style="font-weight:bold; font-size:1.6rem; color:var(--danger);">${channelSubs.toLocaleString()}</div>
                        </div>
                        <div style="background:var(--bg-tertiary); padding:16px 8px; border-radius:8px; text-align:center; border:1px solid var(--border-light); display:flex; flex-direction:column; justify-content:center;">
                            <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:4px; white-space:nowrap; overflow:hidden;">LINE総友だち数</div>
                            <div style="font-weight:bold; font-size:1.6rem; color:var(--text-primary);">${(latestInfo.subs || 0).toLocaleString()}</div>
                        </div>
                        <div style="background:var(--bg-tertiary); padding:16px 8px; border-radius:8px; text-align:center; border:2px solid var(--success); display:flex; flex-direction:column; justify-content:center;">
                            <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:4px; white-space:nowrap; overflow:hidden;">実質友だち数</div>
                            <div style="font-weight:bold; font-size:1.6rem; color:var(--success);">${(latestInfo.targetedReaches || 0).toLocaleString()}</div>
                        </div>
                         <div style="background:var(--bg-tertiary); padding:16px 8px; border-radius:8px; text-align:center; border:1px solid var(--border-light); display:flex; flex-direction:column; justify-content:center;">
                            <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:4px; white-space:nowrap; overflow:hidden;">ブロック数</div>
                            <div style="font-weight:bold; font-size:1.6rem; color:var(--text-secondary);">${(latestInfo.blocks || 0).toLocaleString()}</div>
                        </div>
                    </div>

                    <h4 style="font-size:1rem; margin-bottom:12px; color:var(--text-primary);">友だち追加の推移</h4>
                    ${h.length > 0 ? `
                        <div style="height: 250px; width: 100%; position:relative;">
                            <canvas id="chart-l-${line.id}"></canvas>
                        </div>
                    ` : '<p style="color:var(--text-secondary); font-size:0.85rem;">データがありません。</p>'}
                </div>

                <!-- 右：UTAGEデータ分析 -->
                <div class="card">
                    <h3 style="font-size:1.1rem; margin-bottom:16px; display:flex; align-items:center; gap:8px;">
                        <i class="ph ph-chart-pie-slice"></i> 登録経路分析 (UTAGE連携)
                    </h3>
                    <div style="height: 250px; width: 100%; position:relative; margin-bottom:24px;">
                        <canvas id="chart-route-${line.id}"></canvas>
                    </div>
                    <div style="border-top:1px solid var(--border-light); padding-top:16px;">
                        ${mockRoutes.map(r => `
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; font-size:0.95rem; background:var(--bg-hover); padding:8px 12px; border-radius:4px;">
                                <span>${r.name}</span>
                                <strong style="color:var(--primary-dark); font-size:1.1rem;">${r.value.toLocaleString()}人</strong>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        return html;
    }

    function renderScriptTab() {
        return `
            <div class="card" style="display: flex; flex-direction: column; padding: 24px; background: var(--bg-secondary);">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-light); padding-bottom: 16px; margin-bottom: 24px;">
                    <div>
                        <h3 style="font-size: 1.2rem; margin: 0;">YouTube台本作成ツール</h3>
                        <div id="script-total-chars" style="font-size: 0.85rem; color: var(--primary); font-weight: bold; margin-top: 4px;">合計文字数: 0 文字 (空白抜き)</div>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <select id="script-history-select" class="input-field" style="width: 200px; margin-bottom: 0;" onchange="loadSelectedScript(this.value)">
                            <option value="">-- 保存済みを選択 --</option>
                        </select>
                        <button class="btn-secondary btn-sm" onclick="newScript()"><i class="ph ph-file-plus"></i> 新規作成</button>
                        <button class="btn-primary btn-sm" onclick="saveScript()"><i class="ph ph-floppy-disk"></i> 保存</button>
                    </div>
                </div>
                
                <input type="hidden" id="script-id">
                
                <div class="grid grid-2" style="gap: 20px;">
                    <div class="form-group"><label>1. 動画タイトル</label><textarea id="s-field-1" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                    <div class="form-group"><label>2. キーワード</label><textarea id="s-field-2" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 20px; margin-top: 10px;">
                    <div class="form-group"><label>3. OP</label><textarea id="s-field-3" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                    <div class="form-group"><label>4. 自己紹介（早く簡潔に）</label><textarea id="s-field-4" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                    <div class="form-group"><label>5. 動画概要（端的に動画内容を提示）</label><textarea id="s-field-5" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                    <div class="form-group"><label>6. タイトル回収（動画を見る理由を明確化）</label><textarea id="s-field-6" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                    
                    <div style="background: var(--bg-tertiary); padding: 16px; border-radius: 8px; border-left: 4px solid var(--primary);">
                        <h4 style="margin-bottom: 15px; display: flex; align-items: center; gap: 8px; color: var(--primary);">
                            <i class="ph ph-lightning"></i> PASTORフォーミュラ構築
                        </h4>
                        <div style="display: flex; flex-direction: column; gap: 20px;">
                            <div class="form-group"><label>8. 悩みの代弁（視聴者に共感）</label><textarea id="s-field-8" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                            <div class="form-group"><label>9. 悩みの言語化（具体例）</label><textarea id="s-field-9" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                            <div class="form-group"><label>10. 実体験（過去の自分もあなたと同じ）</label><textarea id="s-field-10" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                            <div class="form-group"><label>11. 問題の拡大（問題の重大さ）</label><textarea id="s-field-11" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                            <div class="form-group"><label>12. 解決策（具体的な行動を提示）</label><textarea id="s-field-12" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                            <div class="form-group"><label>13. 変革と証明（実績）</label><textarea id="s-field-13" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                            <div class="form-group"><label>14. CTA（早く簡潔に）</label><textarea id="s-field-14" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                        </div>
                    </div>

                    <div class="form-group"><label>15. 衝撃の結論（普通の結論×）</label><textarea id="s-field-15" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                    <div class="form-group"><label>16. 根拠（理解しやすい例）</label><textarea id="s-field-16" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                    <div class="form-group"><label>17. 具体例（気付き）</label><textarea id="s-field-17" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                    <div class="form-group"><label>18. 再度結論の繰り返し</label><textarea id="s-field-18" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                    <div class="form-group"><label>19. ED</label><textarea id="s-field-19" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                    <div class="form-group"><label>20. プレゼント</label><textarea id="s-field-20" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                    <div class="form-group"><label>21. CTA</label><textarea id="s-field-21" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                    <div class="form-group"><label>22. エンディング挨拶</label><textarea id="s-field-22" class="script-input" oninput="updateScriptState(this)"></textarea></div>
                </div>
            </div>
        `;
    }

    App.mount(getHtml(), async () => {
        // --- YouTube Script Editor Logic ---
        let allScripts = await Store.getYTScripts();

        const updateHistoryDropdown = (selectedId = "") => {
            const select = document.getElementById('script-history-select');
            if(!select) return;
            select.innerHTML = '<option value="">-- 保存済みを選択 --</option>' + 
                allScripts.map(s => `<option value="${s.id}" ${s.id == selectedId ? 'selected':''}>${s.title || '(無題)'}</option>`).join('');
        };

        if (activeTab === 'script') {
            updateHistoryDropdown();
            // Automatically select the first script if available
            if (allScripts.length > 0) {
                loadSelectedScript(allScripts[0].id);
                document.getElementById('script-history-select').value = allScripts[0].id;
            } else {
                newScript();
            }
        }

        window.newScript = () => {
            document.getElementById('script-id').value = '';
            for(let i=1; i<=22; i++) {
                const el = document.getElementById(`s-field-${i}`);
                if(el) {
                    el.value = '';
                    el.style.height = 'auto'; // Reset size
                }
            }
            updateScriptState();
        };

        window.saveScript = async () => {
            const id = document.getElementById('script-id').value;
            const title = document.getElementById('s-field-1').value || '無題の台本';
            
            const fields = {};
            for(let i=1; i<=22; i++) {
                const el = document.getElementById(`s-field-${i}`);
                if (el) fields[`f${i}`] = el.value;
            }

            const data = { title, fields, updatedAt: new Date().toISOString() };

            if(id) {
                await Store.updateYTScript(id, data);
            } else {
                await Store.addYTScript(data);
            }
            
            alert('保存しました');
            allScripts = await Store.getYTScripts();
            updateHistoryDropdown(id || allScripts[0]?.id);
        };

        window.loadSelectedScript = (id) => {
            if(!id) return;
            const s = allScripts.find(x => x.id == id);
            if(!s) return;

            document.getElementById('script-id').value = s.id;
            
            // Wait for DOM to be ready before updating values
            setTimeout(() => {
                for(let i=1; i<=22; i++) {
                    const el = document.getElementById(`s-field-${i}`);
                    if(el && s.fields) {
                        el.value = s.fields[`f${i}`] || '';
                        autoResizeTextarea(el);
                    }
                }
                updateScriptState();
            }, 50);
        };

        window.updateScriptState = (targetElement) => {
            countTotalChars();
            if(targetElement) {
                autoResizeTextarea(targetElement);
            }
        };

        const countTotalChars = () => {
            let total = 0;
            // タイトルとキーワード(1, 2)はカウントから除外するため i=3 からスタート
            for(let i=3; i<=22; i++) {
                const el = document.getElementById(`s-field-${i}`);
                if (el) {
                    const val = el.value || '';
                    total += val.replace(/\s+/g, '').length;
                }
            }
            const countDisplay = document.getElementById('script-total-chars');
            if(countDisplay) {
                countDisplay.textContent = `合計文字数: ${total.toLocaleString()} 文字 (空白抜き)`;
            }
        };

        const autoResizeTextarea = (el) => {
            if(!el) return;
            el.style.height = 'auto'; // 一旦リセット
            el.style.height = (el.scrollHeight) + 'px'; // 内容に合わせて拡張
        };

        // Initialize display
        if (activeTab === 'script') {
            updateHistoryDropdown();
        }

        // Setup Charts for Videos
        if (activeTab === 'video') {
            videos.forEach(v => {
                const h = v.history || [];
                if (h.length <= 1) return;
                
                const ctx = document.getElementById(`chart-v-${v.id}`);
                if (!ctx) return;
                
                const labels = h.map(x => x.date);
                const dataImps = h.map(x => x.imps);
                const dataCtr = h.map(x => x.ctr);

                new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels,
                        datasets: [
                            {
                                label: 'インプレッション',
                                data: dataImps,
                                yAxisID: 'y',
                                borderColor: '#0d6efd',
                                backgroundColor: 'transparent',
                                pointRadius: 2,
                                borderWidth: 2
                            },
                            {
                                label: 'CTR(%)',
                                data: dataCtr,
                                yAxisID: 'y1',
                                borderColor: '#198754',
                                backgroundColor: 'transparent',
                                pointRadius: 2,
                                borderWidth: 2
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        scales: {
                            x: { display: false },
                            y: { type: 'linear', display: true, position: 'left', grid: { display:false } },
                            y1: { type: 'linear', display: true, position: 'right', grid:{ display:false } }
                        },
                        plugins: { legend: { display: false } }
                    }
                });
            });
        } 
        else if (activeTab === 'line' && selectedLineId) {
            const line = lines.find(x => x.id == selectedLineId);
            if (line) {
                const h = line.history || [];
                if (h.length > 0) {
                    const ctx = document.getElementById(`chart-l-${line.id}`);
                    if (ctx) {
                        const labels = h.map(x => x.date);
                        const dataSubs = h.map(x => x.subs);

                        new Chart(ctx, {
                            type: 'line',
                            data: {
                                labels,
                                datasets: [
                                    {
                                        label: 'LINE友だち数',
                                        data: dataSubs,
                                        borderColor: '#198754',
                                        backgroundColor: 'rgba(25,135,84,0.1)',
                                        fill: true,
                                        tension: 0.2
                                    }
                                ]
                            },
                            options: {
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: { legend: { display: false } },
                                scales: { y: { beginAtZero: false } }
                            }
                        });
                    }

                    // 登録経路分析 (ドーナツグラフ)
                    const ctxRoute = document.getElementById(`chart-route-${line.id}`);
                    if (ctxRoute) {
                        const latestSubs = h[h.length - 1].subs;
                        new Chart(ctxRoute, {
                            type: 'doughnut',
                            data: {
                                labels: ['YouTube動画 概要覧', 'YouTubeショート', 'その他 / 不明'],
                                datasets: [{
                                    data: [Math.floor(latestSubs * 0.6), Math.floor(latestSubs * 0.25), latestSubs - Math.floor(latestSubs * 0.6) - Math.floor(latestSubs * 0.25)],
                                    backgroundColor: ['#1c7ed6', '#f59f00', '#ced4da'],
                                    borderWidth: 0
                                }]
                            },
                            options: {
                                responsive: true,
                                maintainAspectRatio: false,
                                cutout: '70%',
                                plugins: {
                                    legend: { position: 'bottom' }
                                }
                            }
                        });
                    }
                }
                
                // --- 全自動リアルタイム同期処理 ---
                // まだ今日のデータが取得されていない、または強制更新フラグがあれば裏側でこっそりAPIを叩いて画面を更新する
                const isSyncing = document.body.getAttribute('data-line-syncing') === 'true';
                if (!isSyncing) {
                    document.body.setAttribute('data-line-syncing', 'true');
                    fetch('/api/line').then(res => res.json()).then(async data => {
                        if(data.followers !== undefined) {
                            const dateRaw = data.date; 
                            const formattedDate = `${dateRaw.slice(0,4)}-${dateRaw.slice(4,6)}-${dateRaw.slice(6,8)}`;
                            
                            // 更新の必要がある場合のみ（最新じゃなければ）上書きして再描画
                            const prevLatest = h[h.length - 1];
                            if (!prevLatest || prevLatest.date !== formattedDate || prevLatest.subs !== data.followers || prevLatest.blocks !== data.blocks) {
                                let newH = h.filter(x => x.date !== formattedDate);
                                newH.push({ date: formattedDate, subs: data.followers, blocks: data.blocks });
                                newH.sort((a,b) => new Date(a.date) - new Date(b.date));
                                await Store.updateYTLine(line.id, { ...line, history: newH });
                                document.body.removeAttribute('data-line-syncing');
                                App.navigate('youtube'); // 再レンダリングして数値を最新にする
                            } else {
                                document.body.removeAttribute('data-line-syncing');
                            }
                        } else {
                            document.body.removeAttribute('data-line-syncing');
                        }
                    }).catch(e => {
                        console.error('Auto sync error:', e);
                        document.body.removeAttribute('data-line-syncing');
                    });
                }
            }
        }


        window.editChannel = (id) => {
            const c = channels.find(x => x.id == id);
            if (!c) return;
            document.getElementById('c-id').value = c.id;
            document.getElementById('c-name').value = c.name;
            document.getElementById('c-subs').value = c.subs;
            document.getElementById('c-url').value = c.url;
            document.getElementById('c-email').value = c.email;
            document.getElementById('c-pass').value = c.pass;
            document.getElementById('yt-channel-modal').classList.add('active');
        };

        const formCh = document.getElementById('yt-add-channel-form');
        if(formCh) formCh.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('c-id').value;
            const data = {
                name: document.getElementById('c-name').value,
                subs: parseInt(document.getElementById('c-subs').value),
                url: document.getElementById('c-url').value,
                email: document.getElementById('c-email').value,
                pass: document.getElementById('c-pass').value
            };
            
            if(id) await Store.updateYTChannel(id, data);
            else {
                await Store.addYTChannel(data);
                // Trigger sync immediately if url provided and API key exists
                if (apiKey) {
                    alert('チャンネル追加後、動画の自動取得を開始します。完了までお待ちください...');
                    // Just wait a tiny bit to ensure it's written
                    const updatedChannels = await Store.getYTChannels();
                    const newC = updatedChannels.find(x => x.name === data.name);
                    if (newC) await window.syncChannelVideos(newC.id, true);
                }
            }
            
            App.navigate('youtube');
        });

        window.syncAllChannels = async () => {
            if(!apiKey) { alert('APIキーが設定されていません。リサーチ機能から設定してください。'); return; }
            if(!confirm('登録されているすべてのチャンネルの最新動画と再生数を全自動で更新しますか？\n(少し時間がかかる場合があります)')) return;
            
            for(const ch of channels) {
                await window.syncChannelVideos(ch.id, true);
            }
            alert('すべてのチャンネルの一括更新が完了しました！');
            App.navigate('youtube');
        };

        window.syncChannelVideos = async (id, isSilent = false) => {
            if(!apiKey) { if(!isSilent) alert('API Keyが未設定です。'); return; }
            const c = channels.find(x => x.id == id) || (isSilent ? (await Store.getYTChannels()).find(x=>x.id==id) : null);
            if(!c) return;
            
            let handle = '';
            if(c.url.includes('@')) handle = '@' + c.url.split('@')[1].split('/')[0].split('?')[0];
            else if(c.url.includes('channel/')) handle = c.url.split('channel/')[1].split('?')[0];

            if(!handle) { if(!isSilent) alert('URLが不正です。API取得をスキップします。'); return; }

            try {
                let channelId = handle; // If it's starting with UC, it's already a channel ID
                if(handle.startsWith('@')) {
                    const searchRes = await fetch(`https://youtube.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(handle)}&key=${apiKey}`);
                    const searchData = await searchRes.json();
                    if(!searchData.items || searchData.items.length === 0) throw new Error('見つかりません');
                    channelId = searchData.items[0].id.channelId;
                }

                // 2. Get uploads playlist
                const channelRes = await fetch(`https://youtube.googleapis.com/youtube/v3/channels?part=contentDetails,statistics&id=${channelId}&key=${apiKey}`);
                const channelData = await channelRes.json();
                if(!channelData.items) return;
                const uploadsPl = channelData.items[0].contentDetails.relatedPlaylists.uploads;

                await Store.updateYTChannel(c.id, { ...c, subs: parseInt(channelData.items[0].statistics.subscriberCount) });

                // 3. Fetch up to 200 videos (pagination)
                let pageToken = '';
                let allItems = [];
                do {
                    const plRes = await fetch(`https://youtube.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${uploadsPl}&key=${apiKey}${pageToken ? '&pageToken='+pageToken : ''}`);
                    const plData = await plRes.json();
                    if(plData.items) allItems.push(...plData.items);
                    pageToken = plData.nextPageToken;
                } while(pageToken && allItems.length < 200);

                if(allItems.length === 0) return;

                // Chunk video IDs by 50 for stats request
                const chunks = [];
                for(let i=0; i<allItems.length; i+=50) chunks.push(allItems.slice(i, i+50));
                
                const vidStats = {};
                for(const chunk of chunks) {
                    const vIds = chunk.map(item => item.snippet.resourceId.videoId).join(',');
                    const vidRes = await fetch(`https://youtube.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${vIds}&key=${apiKey}`);
                    const vidData = await vidRes.json();
                    if(vidData.items) {
                        vidData.items.forEach(v => {
                            const dur = v.contentDetails.duration || 'PT0S';
                            let hMatch = dur.match(/(\d+)H/);
                            let mMatch = dur.match(/(\d+)M/);
                            let sMatch = dur.match(/(\d+)S/);
                            
                            let seconds = 0;
                            if(hMatch) seconds += parseInt(hMatch[1]) * 3600;
                            if(mMatch) seconds += parseInt(mMatch[1]) * 60;
                            if(sMatch) seconds += parseInt(sMatch[1]);
                            
                            // 3分（180秒）未満ならショート判定
                            const isShort = seconds < 180;
                            vidStats[v.id] = { views: parseInt(v.statistics.viewCount || 0), isShort };
                        });
                    }
                }

                const todayStr = new Date().toISOString().slice(0,10);
                let currentVideos = await Store.getYTVideos(c.id);

                // 重複排除処理（DBに同じ動画が複数保存されている場合は古いものを削除）
                const uniqueKws = new Set();
                const toDelete = [];
                currentVideos = currentVideos.filter(v => {
                    if(!v.kw || v.kw.length !== 11) return true; // kwがIDじゃないものはパス
                    if(uniqueKws.has(v.kw)) {
                        toDelete.push(v.id);
                        return false;
                    }
                    uniqueKws.add(v.kw);
                    return true;
                });
                for(let dId of toDelete) {
                    await Store.deleteCustomer('youtube_video', dId); // state.jsにdeleteCustomerメソッドがあることを利用
                }

                // 取得したアイテム自体の重複も排除
                const processedIds = new Set();

                for (const item of allItems) {
                    const vIdStr = item.snippet.resourceId.videoId;
                    if(processedIds.has(vIdStr)) continue;
                    processedIds.add(vIdStr);

                    const title = item.snippet.title;
                    const date = item.snippet.publishedAt.slice(0,10);
                    const vs = vidStats[vIdStr] || { views: 0, isShort: false };

                    let existing = currentVideos.find(v => v.title === title || (v.kw && v.kw.includes(vIdStr)));
                    if (existing) {
                        let h = existing.history || [];
                        h = h.filter(x => x.date !== todayStr);
                        h.push({ date: todayStr, views: vs.views, imps: existing.imps||0, ctr: existing.ctr||0 });
                        h.sort((a,b) => new Date(a.date) - new Date(b.date));
                        await Store.updateYTVideo(existing.id, { ...existing, history: h, title: title, views: vs.views, isShort: vs.isShort });
                    } else {
                        const newId = Date.now() + Math.floor(Math.random() * 1000);
                        const newVid = {
                            id: newId,
                            channelId: c.id,
                            title: title,
                            date: date,
                            views: vs.views,
                            imps: 0,
                            ctr: 0,
                            kw: vIdStr, 
                            isShort: vs.isShort,
                            history: [{ date: todayStr, views: vs.views, imps: 0, ctr: 0 }]
                        };
                        await Store.addYTVideo(newVid);
                        currentVideos.push(newVid); // 配列にも追加し、以降の重複処理で検知させる
                    }
                }
                if(!isSilent) {
                    alert('取得完了しました!');
                    App.navigate('youtube');
                }
            } catch(e) {
                if(!isSilent) alert('API取得エラー: ' + e.message);
            }
        };

        // Videos
        const formVid = document.getElementById('yt-add-video-form');
        if (formVid) formVid.addEventListener('submit', async (e) => {
            e.preventDefault();
            if(!selectedChannelId) return;

            const id = document.getElementById('v-id').value;
            const viewsStr = document.getElementById('v-views').value || "0";
            const impsStr = document.getElementById('v-imps').value || "0";
            const ctrStr = document.getElementById('v-ctr').value || "0";
            
            const firstData = {
                date: document.getElementById('v-date').value,
                views: parseInt(viewsStr),
                imps: parseInt(impsStr),
                ctr: parseFloat(ctrStr)
            };

            const data = {
                channelId: selectedChannelId,
                title: document.getElementById('v-title').value,
                date: document.getElementById('v-date').value,
                views: firstData.views,
                imps: firstData.imps,
                ctr: firstData.ctr,
                kw: document.getElementById('v-kw').value,
                history: [firstData] // base history snapshot
            };

            if (id) {
                // Keep existing history, just update base info
                const old = videos.find(x => x.id == id);
                if (old) {
                    data.history = old.history; // prevent overwrite
                    data.channelId = old.channelId;
                }
                await Store.updateYTVideo(id, data);
            } else {
                await Store.addYTVideo(data);
            }
            App.navigate('youtube');
        });

        window.editVideo = (id) => {
            const v = videos.find(x => x.id == id);
            if (!v) return;
            document.getElementById('v-id').value = v.id;
            document.getElementById('v-title').value = v.title;
            document.getElementById('v-date').value = v.date;
            document.getElementById('v-views').value = v.views;
            document.getElementById('v-imps').value = v.imps;
            document.getElementById('v-ctr').value = v.ctr;
            document.getElementById('v-kw').value = v.kw || '';
            document.getElementById('yt-video-add-modal').classList.add('active');
        };

        window.updateVideoData = (id) => {
            const v = videos.find(x => x.id == id);
            if (!v) return;
            document.getElementById('uv-id').value = v.id;
            // auto fill latest or empty
            const h = v.history || [];
            const latest = h[h.length - 1] || v;
            document.getElementById('uv-views').value = latest.views;
            document.getElementById('uv-imps').value = latest.imps;
            document.getElementById('uv-ctr').value = latest.ctr;
            document.getElementById('yt-video-update-modal').classList.add('active');
        };

        const formUpdVid = document.getElementById('yt-update-video-form');
        if (formUpdVid) formUpdVid.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('uv-id').value;
            const v = videos.find(x => x.id == id);
            if (!v) return;

            const newSnapshot = {
                date: document.getElementById('uv-date').value,
                views: parseInt(document.getElementById('uv-views').value),
                imps: parseInt(document.getElementById('uv-imps').value),
                ctr: parseFloat(document.getElementById('uv-ctr').value)
            };

            const h = v.history || [];
            
            // If updating on the exact same date, optionally replace it. Let's just push it.
            // Or better, filter out the same date if it already exists to overwrite it.
            const newHistory = h.filter(x => x.date !== newSnapshot.date);
            newHistory.push(newSnapshot);
            // sort by date just in case
            newHistory.sort((a,b) => new Date(a.date) - new Date(b.date));

            await Store.updateYTVideo(id, { ...v, history: newHistory });
            App.navigate('youtube');
        });

        // LINE API Realtime Sync
        window.syncLINERealtime = async () => {
            if(!selectedLineId) return;
            const line = lines.find(x => x.id == selectedLineId);
            if(!line) return;

            try {
                const btn = event.target.closest('button');
                const originalHtml = btn.innerHTML;
                btn.innerHTML = '<i class="ph ph-spinner-gap spinning"></i> 同期中...';
                btn.disabled = true;

                const res = await fetch('/api/line');
                const data = await res.json();

                if(!res.ok) throw new Error(data.error || 'LINE API通信エラー');

                // 取得できた数字（前日時点の確定値）
                const followers = data.followers;
                const blocks = data.blocks;
                const targetedReaches = data.targetedReaches;
                const dateRaw = data.date; // 20240420
                const formattedDate = `${dateRaw.slice(0,4)}-${dateRaw.slice(4,6)}-${dateRaw.slice(6,8)}`;

                let h = line.history || [];
                // 同じ日付のデータがあれば上書き、なければ追加
                h = h.filter(x => x.date !== formattedDate);
                h.push({ 
                    date: formattedDate, 
                    subs: followers, 
                    blocks: blocks,
                    targetedReaches: targetedReaches
                });
                h.sort((a,b) => new Date(a.date) - new Date(b.date));

                await Store.updateYTLine(line.id, { ...line, history: h });
                
                alert(`LINE APIから同期完了！\n日付: ${formattedDate}\n友だち総数: ${followers}\n実質友だち数: ${targetedReaches}\nブロック数: ${blocks}`);
                App.navigate('youtube');
            } catch(e) {
                alert('同期エラー: ' + e.message);
                console.error(e);
            } finally {
                // Re-rendering happens with Navigate, no need to reset button state manually if everything ok
            }
        };

        window.addLine = () => {
            document.getElementById('l-id').value = '';
            document.getElementById('l-name').value = '';
            document.getElementById('l-subs').value = '';
            document.getElementById('yt-line-modal').classList.add('active');
        };

        window.updateLine = (id) => {
            const l = lines.find(x => x.id == id);
            if (!l) return;
            document.getElementById('l-id').value = l.id;
            document.getElementById('l-name').value = l.name;
            document.getElementById('l-channel').value = l.channelId;
            const h = l.history || [];
            const latest = h[h.length - 1] || { subs: 0 };
            document.getElementById('l-subs').value = latest.subs;
            document.getElementById('yt-line-modal').classList.add('active');
        };

        const formLine = document.getElementById('yt-add-line-form');
        if (formLine) formLine.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('l-id').value;
            const date = document.getElementById('l-date').value;
            const subs = parseInt(document.getElementById('l-subs').value);

            const newSnapshot = { date, subs };

            if (id) {
                const l = lines.find(x => x.id == id);
                let h = l.history || [];
                h = h.filter(x => x.date !== date); // overwrite if same date
                h.push(newSnapshot);
                h.sort((a,b) => new Date(a.date) - new Date(b.date));
                
                await Store.updateYTLine(id, {
                    name: document.getElementById('l-name').value,
                    channelId: document.getElementById('l-channel').value,
                    history: h
                });
            } else {
                await Store.addYTLine({
                    name: document.getElementById('l-name').value,
                    channelId: document.getElementById('l-channel').value,
                    history: [newSnapshot]
                });
            }
            App.navigate('youtube');
        });
    });
};
