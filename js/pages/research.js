App.Pages.research = async function() {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') {
        App.mount('<div style="text-align:center; padding: 40px;">このページは管理者専用です。</div>');
        return;
    }

    const settingsData = await Store.getCustomers('settings');
    const apiSettingsRow = settingsData.find(d => d.type === 'youtube_api_key');
    const apiKey = apiSettingsRow ? apiSettingsRow.key : '';

    // fetch stored channels
    const channels = await Store.getCustomers('research_channels');
    
    // Sort channels by some logic, just chronologically for now
    channels.sort((a,b) => b.id - a.id);

    const html = `
        <div class="card" style="margin-bottom: 24px;">
            <div class="card-header" style="justify-content:space-between; align-items:center;">
                <h3 class="card-title"><i class="ph ph-magnifying-glass"></i> リサーチ機能 (YouTube)</h3>
                <div style="display:flex; gap:8px;">
                    <button class="btn-primary" style="background: var(--text-secondary); display: flex; align-items: center; justify-content: center;" onclick="document.getElementById('transcript-modal').classList.add('active')">
                        <i class="ph ph-article" style="margin-right: 6px;"></i> 文字起こし
                    </button>
                    <button class="btn-primary" style="display: flex; align-items: center; justify-content: center;" onclick="document.getElementById('add-channel-modal').classList.add('active')">
                        <i class="ph ph-plus" style="margin-right: 6px;"></i> チャンネル追加
                    </button>
                </div>
            </div>
            ${!apiKey ? `
                <div style="background:#fff3cd; color:#856404; padding:12px; border-radius:4px; margin-bottom:16px;">
                    <strong>注意:</strong> YouTubeデータを自動取得するには、YouTube Data API v3のAPIキーが必要です。<br>
                    <a href="#" onclick="document.getElementById('settings-modal').classList.add('active'); return false;">ここをクリックしてAPIキーを設定してください。</a>
                </div>
            ` : ''}
            
            <div class="table-container">
                <table id="research-table">
                    <thead>
                        <tr>
                            <th>チャンネル名</th>
                            <th>登録者数</th>
                            <th>平均再生数</th>
                            <th>更新頻度</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${channels.map(c => `
                            <tr>
                                <td>
                                    <div style="display:flex; align-items:center; gap:12px;">
                                        <img src="${c.thumbnail || 'https://via.placeholder.com/40'}" style="width:40px; height:40px; border-radius:50%; object-fit:cover;">
                                        <a href="#" onclick="showChannelDetails(${c.id}); return false;" style="font-weight:bold; color:var(--primary); text-decoration:none;">${c.title}</a>
                                    </div>
                                </td>
                                <td>${c.subscribers ? parseInt(c.subscribers).toLocaleString() : '-'}</td>
                                <td>${c.avgViews ? parseInt(c.avgViews).toLocaleString() : '-'}</td>
                                <td>${c.frequency || '-'}</td>
                                <td>
                                    <button class="btn-icon p-1" onclick="deleteResearchChannel(${c.id})"><i class="ph ph-trash"></i></button>
                                </td>
                            </tr>
                        `).join('')}
                        ${channels.length === 0 ? '<tr><td colspan="5" style="text-align:center;">チャンネルが追加されていません</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Add URL Modal -->
        <div class="modal-overlay" id="add-channel-modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">YouTubeチャンネル追加</h3>
                    <button class="modal-close" onclick="document.getElementById('add-channel-modal').classList.remove('active')"><i class="ph ph-x"></i></button>
                </div>
                <div class="form-group pb-2">
                    <label>YouTubeチャンネルURL（複数追加する場合は「改行」して入力してください）</label>
                    <textarea id="research-urls" class="input-field" rows="5" placeholder="https://youtube.com/@xxx&#10;https://youtube.com/@yyy"></textarea>
                </div>
                <button class="btn-primary w-100" onclick="startResearch()">一括リサーチ開始</button>
            </div>
        </div>

        <!-- Settings Modal -->
        <div class="modal-overlay" id="settings-modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">YouTube API設定</h3>
                    <button class="modal-close" onclick="document.getElementById('settings-modal').classList.remove('active')"><i class="ph ph-x"></i></button>
                </div>
                <div class="form-group pb-2">
                    <label>YouTube Data API v3 Key</label>
                    <input type="text" id="youtube-api-key" class="input-field" value="${apiKey}" placeholder="AIzaSy...">
                </div>
                <button class="btn-primary w-100" onclick="saveApiKey()">保存</button>
            </div>
        </div>

        <!-- Channel Details Modal (Placeholder for now) -->
        <div class="modal-overlay" id="channel-details-modal">
            <div class="modal-content" style="max-width: 800px; max-height: 90vh; overflow-y:auto;">
                <div class="modal-header">
                    <h3 class="modal-title" id="cd-title">チャンネル詳細</h3>
                    <button class="modal-close" onclick="document.getElementById('channel-details-modal').classList.remove('active')"><i class="ph ph-x"></i></button>
                </div>
                <div id="cd-content">
                    Loading...
                </div>
            </div>
        </div>

        <!-- Transcript Modal -->
        <div class="modal-overlay" id="transcript-modal">
            <div class="modal-content" style="max-width: 700px;">
                <div class="modal-header">
                    <h3 class="modal-title">YouTube動画の文字起こし</h3>
                    <button class="modal-close" onclick="document.getElementById('transcript-modal').classList.remove('active')"><i class="ph ph-x"></i></button>
                </div>
                <div class="form-group pb-2">
                    <label>YouTube動画URL</label>
                    <div style="display:flex; gap:8px;">
                        <input type="url" id="transcript-url" class="input-field" placeholder="https://www.youtube.com/watch?v=..." style="flex:1;">
                        <button class="btn-primary" onclick="runTranscript()" id="transcript-btn">実行</button>
                    </div>
                </div>
                <div id="transcript-result" style="display:none; margin-top:20px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <h4 id="ts-video-title" style="font-size:0.95rem; line-height:1.4; color:var(--primary); flex:1; margin-right:10px;"></h4>
                        <button class="btn-secondary btn-sm" onclick="copyTranscript()"><i class="ph ph-copy"></i> コピー</button>
                    </div>
                    <div id="ts-text-area" style="background:var(--bg-tertiary); padding:16px; border-radius:8px; font-size:0.9rem; line-height:1.6; max-height:400px; overflow-y:auto; white-space:pre-wrap; word-break:break-all;"></div>
                </div>
            </div>
        </div>
    `;

    App.mount(html, async () => {
        window.runTranscript = async () => {
            const url = document.getElementById('transcript-url').value.trim();
            if(!url) { alert('URLを入力してください'); return; }

            const btn = document.getElementById('transcript-btn');
            const resultDiv = document.getElementById('transcript-result');
            const textArea = document.getElementById('ts-text-area');
            const titleEl = document.getElementById('ts-video-title');

            btn.disabled = true;
            btn.innerHTML = '<i class="ph ph-spinner-gap spinning"></i> 取得中...';
            resultDiv.style.display = 'none';

            try {
                const res = await fetch(`/api/transcript?videoUrl=${encodeURIComponent(url)}`);
                const data = await res.json();

                if(!res.ok) throw new Error(data.error || '文字起こしの取得に失敗しました。');

                titleEl.textContent = data.title;
                textArea.textContent = data.text;
                resultDiv.style.display = 'block';
            } catch(e) {
                alert(e.message);
            } finally {
                btn.disabled = false;
                btn.textContent = '実行';
            }
        };

        window.copyTranscript = () => {
            const text = document.getElementById('ts-text-area').textContent;
            navigator.clipboard.writeText(text).then(() => {
                alert('文字起こしをクリップボードにコピーしました！');
            });
        };
        window.saveApiKey = async () => {
            const key = document.getElementById('youtube-api-key').value.trim();
            if(!key) { alert('APIキーを入力してください'); return; }
            
            // Delete existing
            if(apiSettingsRow) {
                await Store.deleteCustomer('settings', apiSettingsRow.id);
            }
            await Store.addCustomer('settings', { type: 'youtube_api_key', key });
            alert('設定を保存しました。');
            App.navigate('research');
        };

        window.deleteResearchChannel = async (id) => {
            if(confirm('削除しますか？')){
                await Store.deleteCustomer('research_channels', id);
                App.navigate('research');
            }
        };

        window.startResearch = async () => {
            if(!apiKey) {
                alert('先にYouTube APIキーを設定してください。');
                return;
            }
            const urlsInput = document.getElementById('research-urls').value.trim();
            if(!urlsInput) { alert('URLを入力してください'); return; }
            
            const urlList = urlsInput.split('\n').map(u => u.trim()).filter(u => u);

            document.getElementById('add-channel-modal').classList.remove('active');
            
            for (const urlStr of urlList) {
                let handle = '';
                if(urlStr.includes('@')) {
                    handle = '@' + urlStr.split('@')[1].split('/')[0].split('?')[0];
                } else {
                    console.log('Skip invalid url:', urlStr);
                    continue;
                }

                try {
                    // 1. Get channel ID from handle
                    const searchRes = await fetch(`https://youtube.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(handle)}&key=${apiKey}`);
                    const searchData = await searchRes.json();
                    if(!searchData.items || searchData.items.length === 0) continue;
                    
                    const channelId = searchData.items[0].id.channelId;

                    // 2. Get channel stats
                    const channelRes = await fetch(`https://youtube.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${channelId}&key=${apiKey}`);
                    const channelData = await channelRes.json();
                    if(!channelData.items) continue;
                    
                    const channelInfo = channelData.items[0];

                    const cTitle = channelInfo.snippet.title;
                    const cThumb = channelInfo.snippet.thumbnails.default.url;
                    const cSubs = channelInfo.statistics.subscriberCount;
                    const uploadsPlaylistId = channelInfo.contentDetails.relatedPlaylists.uploads;

                    // 3. Save to DB temporarily
                    await Store.addCustomer('research_channels', {
                        channelId,
                        title: cTitle,
                        thumbnail: cThumb,
                        subscribers: cSubs,
                        uploadsPlaylistId,
                        avgViews: 0,
                        frequency: '取得中...'
                    });
                } catch(e) {
                    console.error('リサーチエラー:', e);
                }
            }
            
            alert('リサーチが一括完了しました！');
            App.navigate('research');
        };

        window.showChannelDetails = async (dbId) => {
            const c = channels.find(x => x.id === dbId);
            if(!c) return;
            document.getElementById('cd-title').textContent = c.title + ' の動画一覧';
            document.getElementById('cd-content').innerHTML = '<div style="text-align:center; padding: 20px;">動画情報を取得中...<br><small>APIの通信状況により数秒かかる場合があります</small></div>';
            document.getElementById('channel-details-modal').classList.add('active');

            if(!apiKey) {
                document.getElementById('cd-content').innerHTML = 'APIキーが設定されていません。';
                return;
            }

            try {
                // Fetch up to 50 latest videos from uploads playlist
                const plRes = await fetch(`https://youtube.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${c.uploadsPlaylistId}&key=${apiKey}`);
                const plData = await plRes.json();
                
                if(!plData.items || plData.items.length === 0) {
                    document.getElementById('cd-content').innerHTML = '動画がありません。';
                    return;
                }

                // Fetch details to get views & duration (duration helps guess if it's short vs long)
                const videoIds = plData.items.map(item => item.snippet.resourceId.videoId).join(',');
                const vidRes = await fetch(`https://youtube.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${videoIds}&key=${apiKey}`);
                const vidData = await vidRes.json();

                const videosMap = {};
                vidData.items.forEach(v => { videosMap[v.id] = v; });

                window.currentChannelVideos = plData.items.map(item => {
                    const id = item.snippet.resourceId.videoId;
                    const stats = videosMap[id]?.statistics || { viewCount: 0 };
                    const details = videosMap[id]?.contentDetails || { duration: 'PT0S' };
                    // Very naive parsing of ISO 8601 duration
                    const isShort = details.duration.includes('M') ? false : (parseInt(details.duration.replace(/\D/g, '')) <= 60);

                    return {
                        id,
                        title: item.snippet.title,
                        thumb: item.snippet.thumbnails.default?.url,
                        publishedAt: item.snippet.publishedAt,
                        views: parseInt(stats.viewCount || 0),
                        isShort
                    };
                });
                
                window.renderChannelVideos('newest');

            } catch(e) {
                document.getElementById('cd-content').innerHTML = 'エラーが発生しました: ' + e.message;
            }
        };

        window.renderChannelVideos = (sortOrder) => {
            let vids = [...(window.currentChannelVideos || [])];
            if(sortOrder === 'newest') vids.sort((a,b) => new Date(b.publishedAt) - new Date(a.publishedAt));
            if(sortOrder === 'views') vids.sort((a,b) => b.views - a.views);

            const longVids = vids.filter(v => !v.isShort);
            const shortVids = vids.filter(v => v.isShort);

            document.getElementById('cd-content').innerHTML = `
                <div style="display:flex; justify-content:space-between; margin-bottom: 16px; align-items:center;">
                    <div>
                        <button class="btn-sm ${sortOrder==='newest'?'btn-primary':'btn-secondary'}" onclick="renderChannelVideos('newest')">新しい順</button>
                        <button class="btn-sm ${sortOrder==='views'?'btn-primary':'btn-secondary'}" onclick="renderChannelVideos('views')">再生数順</button>
                    </div>
                </div>

                <div class="grid grid-2">
                    <div>
                        <h4>長尺動画 (過去50件中 ${longVids.length}件)</h4>
                        ${longVids.map(v => `
                            <div style="display:flex; gap:8px; margin-bottom:8px; border-bottom:1px solid #eee; padding-bottom:8px;">
                                <img src="${v.thumb}" style="width:80px; height:45px; object-fit:cover; border-radius:4px;">
                                <div style="flex:1;">
                                    <div style="font-size:0.8rem; font-weight:bold; line-height:1.2; margin-bottom:4px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${v.title}</div>
                                    <div style="font-size:0.75rem; color:var(--text-secondary); display:flex; justify-content:space-between;">
                                        <span>👁 ${v.views.toLocaleString()}</span>
                                        <span>📅 ${new Date(v.publishedAt).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <div>
                        <h4>ショート動画 (過去50件中 ${shortVids.length}件)</h4>
                        ${shortVids.map(v => `
                            <div style="display:flex; gap:8px; margin-bottom:8px; border-bottom:1px solid #eee; padding-bottom:8px;">
                                <img src="${v.thumb}" style="width:80px; height:45px; object-fit:cover; border-radius:4px;">
                                <div style="flex:1;">
                                    <div style="font-size:0.8rem; font-weight:bold; line-height:1.2; margin-bottom:4px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${v.title}</div>
                                    <div style="font-size:0.75rem; color:var(--text-secondary); display:flex; justify-content:space-between;">
                                        <span>👁 ${v.views.toLocaleString()}</span>
                                        <span>📅 ${new Date(v.publishedAt).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

    });
};
