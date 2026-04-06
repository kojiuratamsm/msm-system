App.Pages.youtube = async function() {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') {
        App.mount('<div class="card" style="margin-top:24px; padding: 40px; text-align:center;"><h3 class="card-title">アクセス権限がありません</h3><p style="color:var(--text-secondary); margin-top: 16px;">YouTubeは管理者のみ閲覧可能です。</p></div>');
        return;
    }

    let activeTab = window.ytActiveTab || 'video';
    let videoTypeTab = window.ytVideoTypeMode || 'long';
    let selectedChannelId = window.ytSelectedChannelId || null;

    const channels = await Store.getYTChannels();
    let lines = await Store.getYTLines();
    let videos = selectedChannelId ? await Store.getYTVideos(selectedChannelId) : [];
    
    const settingsData = await Store.getCustomers('settings');
    const apiSettingsRow = settingsData.find(d => d.type === 'youtube_api_key');
    const apiKey = apiSettingsRow ? apiSettingsRow.key : '';

    const getHtml = () => `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; flex-wrap:wrap; gap:16px;">
            <h2 style="font-size:1.5rem;">YouTube 管理</h2>
            <div style="display:flex; gap:8px;">
                <button class="btn-sm ${activeTab === 'video' ? 'btn-primary' : 'btn-secondary'}" onclick="window.ytActiveTab='video'; App.navigate('youtube')"><i class="ph ph-video-camera"></i> 動画進捗</button>
                <button class="btn-sm ${activeTab === 'line' ? 'btn-primary' : 'btn-secondary'}" onclick="window.ytActiveTab='line'; App.navigate('youtube')"><i class="ph ph-chat-circle-dots"></i> 公式LINE</button>
                <button class="btn-success btn-sm" onclick="syncAllChannels()"><i class="ph ph-arrows-clockwise"></i> 全てのChを一括更新</button>
                <button class="btn-secondary btn-sm" onclick="document.getElementById('yt-channel-modal').classList.add('active')"><i class="ph ph-plus"></i> チャンネル追加</button>
            </div>
        </div>

        ${activeTab === 'video' ? renderVideoTab() : renderLineTab()}

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
                                            <button class="btn-primary btn-sm p-1" style="font-size:0.75rem;" onclick="updateVideoData(${v.id})">数値更新</button>
                                            <button class="btn-secondary btn-sm p-1" style="font-size:0.75rem;" onclick="editVideo(${v.id})">編集</button>
                                        </div>
                                    </div>
                                    <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:0px;">
                                        投稿日: ${v.date} ${!isId ? '| KW: '+(v.kw||'-') : ''}
                                    </p>
                                </div>
                            </div>
                            
                            <div class="grid" style="grid-template-columns: repeat(3, 1fr); gap:8px; margin-bottom: 24px;">
                                <div style="background:var(--bg-tertiary); padding:8px; border-radius:4px; text-align:center;">
                                    <div style="font-size:0.7rem; color:var(--text-secondary);">最新再生数</div>
                                    <div style="font-weight:bold; font-size:1.1rem;">${latest.views.toLocaleString()}</div>
                                    <div style="font-size:0.7rem; color:${viewsDiff >= 0 ? 'var(--success)':'var(--danger)'};">${viewsDiff >= 0 ? '+' : ''}${viewsDiff.toLocaleString()}</div>
                                </div>
                                <div style="background:var(--bg-tertiary); padding:8px; border-radius:4px; text-align:center;">
                                    <div style="font-size:0.7rem; color:var(--text-secondary);">最新インプレッション</div>
                                    <div style="font-weight:bold; font-size:1.1rem;">${latest.imps.toLocaleString()}</div>
                                    <div style="font-size:0.7rem; color:${impsDiff >= 0 ? 'var(--success)':'var(--danger)'};">${impsDiff >= 0 ? '+' : ''}${impsDiff.toLocaleString()}</div>
                                </div>
                                <div style="background:var(--bg-tertiary); padding:8px; border-radius:4px; text-align:center;">
                                    <div style="font-size:0.7rem; color:var(--text-secondary);">最新CTR</div>
                                    <div style="font-weight:bold; font-size:1.1rem;">${latest.ctr}%</div>
                                    <div style="font-size:0.7rem; color:${ctrDiff >= 0 ? 'var(--success)':'var(--danger)'};">${ctrDiff >= 0 ? '+' : ''}${ctrDiff}%</div>
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
            <div style="display:flex; justify-content:flex-end; gap:8px; margin-bottom: 24px;">
                <button class="btn-success" onclick="syncLineStats()"><i class="ph ph-arrows-clockwise"></i> 登録者をAPIから自動取得</button>
                <button class="btn-primary" onclick="addLine()"><i class="ph ph-plus"></i> 公式LINE追加</button>
            </div>
            <div class="grid grid-2">
        `;

        if (lines.length === 0) {
            html += `<div style="grid-column: span 2; text-align:center; padding:40px; color:var(--text-secondary);">登録された公式LINEがありません。</div>`;
        }

        lines.forEach(line => {
            const channel = channels.find(c => c.id == line.channelId);
            const channelName = channel ? channel.name : '不明なチャンネル';
            const channelSubs = channel ? channel.subs : 0;
            
            const h = line.history || [];
            const latestInfo = h[h.length - 1] || { subs: 0 };

            html += `
                <div class="card">
                    <div style="display:flex; justify-content:space-between; margin-bottom:16px;">
                        <div>
                            <h3 style="font-size:1.2rem; margin-bottom:4px;">${line.name}</h3>
                            <p style="font-size:0.8rem; color:var(--text-secondary);">連携: ${channelName}</p>
                        </div>
                        <button class="btn-primary btn-sm p-1" style="height:fit-content;" onclick="updateLine(${line.id})">数値更新 / 編集</button>
                    </div>
                    
                    <div style="display:flex; gap:16px; margin-bottom:24px;">
                        <div style="flex:1; background:var(--bg-tertiary); padding:12px; border-radius:4px;">
                            <div style="font-size:0.8rem; color:var(--text-secondary);">Ch登録者数</div>
                            <div style="font-weight:bold; font-size:1.5rem; color:var(--danger);">${channelSubs.toLocaleString()}</div>
                        </div>
                        <div style="flex:1; background:var(--bg-tertiary); padding:12px; border-radius:4px;">
                            <div style="font-size:0.8rem; color:var(--text-secondary);">LINE登録者数</div>
                            <div style="font-weight:bold; font-size:1.5rem; color:var(--success);">${latestInfo.subs.toLocaleString()}</div>
                        </div>
                    </div>

                    ${h.length > 0 ? `
                        <div style="height: 200px; width: 100%; position:relative;">
                            <canvas id="chart-l-${line.id}"></canvas>
                        </div>
                    ` : ''}
                </div>
            `;
        });
        html += `</div>`;
        return html;
    }

    App.mount(getHtml(), () => {

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
        else if (activeTab === 'line') {
            lines.forEach(line => {
                const h = line.history || [];
                if (h.length === 0) return;
                
                const ctx = document.getElementById(`chart-l-${line.id}`);
                if (!ctx) return;
                
                const labels = h.map(x => x.date);
                const channel = channels.find(c => c.id == line.channelId);
                const cHistory = channel ? [ {date: h[0].date, subs: channel.subs}, ...h] : []; // simplified tracking since channel subs don't have separate historical timeline requested perfectly, just current. We will just plot a flat line for channel subs for reference if needed, or better, just plot LINE subs growth.
                
                const dataSubs = h.map(x => x.subs);

                new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels,
                        datasets: [
                            {
                                label: 'LINE登録者数',
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
            });
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

        // LINE
        window.syncLineStats = async () => {
            try {
                const res = await fetch('/api/line'); 
                if(!res.ok) throw new Error('API通信エラー');
                const insight = await res.json();
                
                const followers = insight.followers;
                if(!followers) throw new Error('フォロワー数が取得できませんでした');

                // Update all LINE accounts just to be safe, or just append snapshot
                const todayStr = new Date().toISOString().slice(0,10);
                for(const l of lines) {
                    let h = l.history || [];
                    h = h.filter(x => x.date !== todayStr);
                    h.push({ date: todayStr, subs: followers });
                    h.sort((a,b) => new Date(a.date) - new Date(b.date));
                    await Store.updateYTLine(l.id, { ...l, history: h });
                }
                alert('公式LINEインサイト（フォロワー数: ' + followers + '）を自動取得しました！');
                App.navigate('youtube');
            } catch(e) {
                alert('自動取得エラー: ' + e.message);
                console.error(e);
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
