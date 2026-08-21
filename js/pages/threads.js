// ============================================================================
// Threads運用代行 ページ
// - インサイト / 分析結果 / リサーチ結果 / 投稿予約・下書き の4タブ構成
// - ログインしていれば誰でも閲覧・編集できる(部署別の権限分けはしていません)
// - Threads公式APIキーを登録すると、フォロワー数・プロフィール閲覧数を
//   毎朝9:00(JST)に自動取得します(/api/threads-sync + vercel.json のcron)。
//   加えて、インサイトタブの「今すぐ更新」ボタンで手動更新もできます
//   (1日2回まで、毎朝9:00にリセット。回数制限はサーバー側 /api/threads-sync で判定)。
// - APIキー未登録の間は、これまで通りKPIを手動入力できます。
// - 【セキュリティに関する注意】APIキーは、他の連携キー(Chatwork等)と同じ
//   Supabase customers テーブル(anonキー経由)に保存しています。これは
//   ログイン中のメンバーであれば技術的には閲覧しうる状態で、真の意味で
//   「誰にも見えない」保管ではありません(サーバー専用のservice_roleキー+
//   環境変数化が必要ですが、今回はコージさんの判断で見送り、既存方式を採用)。
//   入力欄はパスワード形式でマスクし、保存後は値を画面に再表示しない実装に
//   することで、画面越しの誤流出リスクだけは下げています。
// ============================================================================
App.Pages.threads = async function() {
    const user = Auth.getCurrentUser();
    if (!user) {
        App.mount('<div class="card" style="margin-top:24px; padding:40px; text-align:center;"><h3 class="card-title">ログインが必要です</h3></div>');
        return;
    }

    let activeTab = 'insight';
    let postPerfExpanded = false;
    let currentDetailPostId = null;

    let posts = [];
    let analysisList = [];
    let researchList = [];
    let insight = { followers: '', totalViews: '', profileViews: '', accessToken: '', threadsUserId: '', lastSyncedAt: '', manualRefreshCount: 0, manualRefreshDate: '' };

    async function loadAll() {
        posts = (await Store.getCustomers('threads_post')).sort((a, b) => b.id - a.id);
        analysisList = (await Store.getCustomers('threads_analysis')).sort((a, b) => b.id - a.id);
        researchList = (await Store.getCustomers('threads_research')).sort((a, b) => b.id - a.id);
        const insightRows = await Store.getCustomers('threads_insight_settings');
        insight = insightRows[0] || { followers: '', totalViews: '', profileViews: '', accessToken: '', threadsUserId: '', lastSyncedAt: '', manualRefreshCount: 0, manualRefreshDate: '' };
    }
    await loadAll();

    const totalOf = (trees, key) => (trees || []).reduce((s, t) => s + (Number(t[key]) || 0), 0);
    const postedPosts = () => posts.filter(p => p.status === 'posted').sort((a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0));
    const fmt = (n) => (Number(n) || 0).toLocaleString();
    const esc = (s) => (s === undefined || s === null) ? '' : String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // 手動更新の残り回数を計算する。
    // サーバー側(/api/threads-sync)の判定と同じロジック: UTC日付をそのまま「サイクル日」として使う。
    // これは UTC 0:00 = JST 9:00 のため、「毎朝9時にリセット」と自動的に一致する。
    const manualRefreshRemaining = () => {
        const cycleDate = new Date().toISOString().slice(0, 10);
        const count = insight.manualRefreshDate === cycleDate ? (Number(insight.manualRefreshCount) || 0) : 0;
        return Math.max(0, 2 - count);
    };

    const STYLE = `
        <style>
            .th-kpi-card { background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-md); padding:20px; }
            .th-kpi-label { font-size:0.8rem; color:var(--text-tertiary); font-weight:600; margin-bottom:8px; display:flex; align-items:center; gap:6px; }
            .th-kpi-value { font-size:1.8rem; font-weight:700; }
            .th-thread-chain { border-left:2px dashed var(--border-strong); padding-left:20px; margin-left:8px; }
            .th-thread-item { position:relative; margin-bottom:20px; }
            .th-thread-item::before { content:''; position:absolute; left:-25px; top:14px; width:10px; height:10px; border-radius:50%; background:#0d6efd; }
            .th-thread-num { font-size:0.75rem; font-weight:700; color:#0d6efd; margin-bottom:6px; }
            .th-textarea { width:100%; box-sizing:border-box; border:1px solid var(--border-strong); border-radius:var(--radius-md); padding:14px 16px; font-size:0.9rem; line-height:1.6; font-family:inherit; background:var(--bg-primary); resize:none; overflow:hidden; min-height:150px; }
            .th-reason-textarea { min-height:110px; }
            .th-metric-input { width:110px; border:1px solid var(--border-strong); border-radius:6px; padding:6px 8px; font-size:0.8rem; }
            .th-metrics-row { display:flex; gap:16px; align-items:center; margin-top:10px; font-size:0.8rem; color:var(--text-secondary); flex-wrap:wrap; }
            .th-metrics-row label { display:flex; align-items:center; gap:6px; }
            .th-section-divider { display:flex; align-items:center; gap:10px; font-weight:700; font-size:0.95rem; margin:28px 0 14px; padding-bottom:8px; border-bottom:1px solid var(--border-light); }
            .th-section-divider:first-of-type { margin-top:8px; }
            .th-section-num { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; background:#0d6efd; color:white; font-size:0.75rem; flex-shrink:0; }
            .th-post-card { background:var(--bg-tertiary); border:1px solid var(--border-light); border-radius:var(--radius-md); padding:18px; margin-bottom:14px; position:relative; }
            .th-post-card .th-remove-btn { position:absolute; top:14px; right:14px; background:none; border:none; color:var(--danger); cursor:pointer; font-size:1.1rem; }
            .th-field-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-bottom:12px; }
            .th-field-grid.th-cols-2 { grid-template-columns:repeat(2, 1fr); }
            .th-field-grid .form-group { margin-bottom:0; }
            .th-field-grid label { font-size:0.72rem; }
            .th-rank-badge { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:50%; font-size:0.8rem; font-weight:700; background:var(--bg-tertiary); color:var(--text-secondary); }
            .th-rank-1 { background:#FFF3CD; color:#B8860B; }
            .th-rank-2 { background:#F1F3F5; color:#6c757d; }
            .th-rank-3 { background:#FCE8D5; color:#B5651D; }
            .th-modal-content .modal-content { max-width:720px; }
            /* ×ボタンが中身のスクロールで画面外に流れないよう、ヘッダーを常に上部に固定する */
            .th-modal-content .modal-header { position:sticky; top:-32px; margin:-32px -32px 24px -32px; padding:24px 32px 16px; background:var(--bg-secondary); border-bottom:1px solid var(--border-light); z-index:5; border-radius:var(--radius-lg) var(--radius-lg) 0 0; }
            .th-row-click { cursor:pointer; }
            .th-note-box { background:rgba(13,110,253,0.08); border:1px solid rgba(13,110,253,0.2); border-radius:var(--radius-md); padding:14px 18px; font-size:0.82rem; color:var(--text-secondary); margin-bottom:20px; display:flex; gap:10px; align-items:flex-start; }
            .th-note-box i { color:#0d6efd; font-size:1.1rem; flex-shrink:0; margin-top:1px; }
            .th-kpi-tag { font-size:0.68rem; font-weight:600; color:var(--text-tertiary); margin-left:4px; }
            .ph-spin { display:inline-block; animation: th-spin 1s linear infinite; }
            @keyframes th-spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
            @media (max-width:768px) { .th-field-grid { grid-template-columns:1fr; } }
        </style>
    `;

    // ------------------------------------------------------------------
    // 各タブのHTML
    // ------------------------------------------------------------------

    function insightTabHtml() {
        const posted = postedPosts();
        const visible = posted.slice(0, 3);
        const extra = posted.slice(3);

        const perfRow = (p) => `
            <tr class="th-row-click" onclick="openPostDetail(${p.id})">
                <td>${esc(p.postedAt || '-')}</td>
                <td style="white-space:normal; word-break:break-word; min-width:220px;">${esc((p.trees && p.trees[0] && p.trees[0].text) || '')}</td>
                <td>${(p.trees || []).length}</td>
                <td>${fmt(totalOf(p.trees, 'views'))}</td>
                <td>${fmt(totalOf(p.trees, 'likes'))}</td>
                <td><i class="ph ph-caret-right"></i></td>
            </tr>
        `;

        const oneMonthAgo = new Date();
        oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
        const ranked = posted
            .filter(p => !p.postedAt || new Date(p.postedAt) >= oneMonthAgo)
            .slice()
            .sort((a, b) => totalOf(b.trees, 'views') - totalOf(a.trees, 'views'))
            .slice(0, 10);

        const rankRow = (p, i) => {
            const hasReason = !!(p.reason && p.reason.trim());
            return `
                <tr class="th-row-click" onclick="openPostDetail(${p.id})">
                    <td><span class="th-rank-badge ${i < 3 ? 'th-rank-' + (i + 1) : ''}">${i + 1}</span></td>
                    <td>${esc(p.postedAt || '-')}</td>
                    <td style="white-space:normal; word-break:break-word; min-width:220px;">${esc((p.trees && p.trees[0] && p.trees[0].text) || '')}</td>
                    <td>${fmt(totalOf(p.trees, 'views'))}</td>
                    <td><span class="badge ${hasReason ? 'badge-success' : 'badge-warning'}">${hasReason ? '入力済み' : '未入力'}</span></td>
                    <td><i class="ph ph-caret-right"></i></td>
                </tr>
            `;
        };

        const connected = !!(insight.accessToken && insight.threadsUserId);
        const remaining = manualRefreshRemaining();
        const lastSynced = insight.lastSyncedAt ? new Date(insight.lastSyncedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '未実行';

        return `
            <div class="card" style="margin-bottom:24px;">
                <div class="card-header">
                    <div class="card-title"><i class="ph ph-plugs-connected"></i> Threads API連携設定</div>
                    <span class="badge ${connected ? 'badge-success' : 'badge-neutral'}">${connected ? '連携済み' : '未連携'}</span>
                </div>
                ${connected ? `
                    <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:12px;">最終更新:${esc(lastSynced)}(JST) / 毎朝9:00(JST)に自動取得されます(Vercel Hobbyプランのため実行時刻は前後±1時間ほどずれる場合があります)</p>
                    <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
                        <button class="btn-primary" id="th-refresh-btn" style="margin-top:0;" onclick="refreshThreadsInsight()" ${remaining <= 0 ? 'disabled' : ''}>
                            <i class="ph ph-arrows-clockwise"></i> 今すぐ更新
                        </button>
                        <span style="font-size:0.85rem; color:var(--text-tertiary);">本日あと${remaining}回更新できます(毎朝9:00にリセット)</span>
                        <button class="btn-secondary" style="margin-top:0;" onclick="openApiSettings()"><i class="ph ph-gear"></i> 設定を変更</button>
                    </div>
                ` : `
                    <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:12px;">Threads APIキーを登録すると、フォロワー数・プロフィール閲覧数を毎朝9:00に自動取得できます。未登録の間は、下のKPIをこれまで通り手動入力できます。</p>
                    <button class="btn-primary" style="margin-top:0;" onclick="openApiSettings()"><i class="ph ph-key"></i> APIキーを登録する</button>
                `}
            </div>

            <div class="th-note-box"><i class="ph ph-info"></i> ${connected ? 'フォロワー数・プロフィール閲覧数はAPIから自動取得されますが、手動で上書きすることもできます。' : 'Threads公式APIとの自動連携は未接続のため、フォロワー数・閲覧数・いいね数は手動入力です。'} 投稿予約・下書きタブで「投稿済みにする」を押した投稿がここに表示されます。</div>

            <div class="grid grid-3" style="margin-bottom:24px;">
                <div class="th-kpi-card">
                    <div class="th-kpi-label"><i class="ph ph-users-three"></i> フォロワー数 <span class="th-kpi-tag">${connected ? '(API自動取得)' : '(手動入力)'}</span></div>
                    <div class="th-kpi-value">${insight.followers !== '' ? fmt(insight.followers) : '未入力'}</div>
                </div>
                <div class="th-kpi-card">
                    <div class="th-kpi-label"><i class="ph ph-eye"></i> 表示閲覧数 <span class="th-kpi-tag">(手動入力)</span></div>
                    <div class="th-kpi-value">${insight.totalViews !== '' ? fmt(insight.totalViews) : '未入力'}</div>
                </div>
                <div class="th-kpi-card">
                    <div class="th-kpi-label"><i class="ph ph-cursor-click"></i> プロフィール閲覧数 <span class="th-kpi-tag">${connected ? '(API自動取得)' : '(手動入力)'}</span></div>
                    <div class="th-kpi-value">${insight.profileViews !== '' ? fmt(insight.profileViews) : '未入力'}</div>
                </div>
            </div>
            <div style="text-align:right; margin-bottom:24px;">
                <button class="btn-secondary" onclick="openKpiEdit()"><i class="ph ph-pencil-simple"></i> KPIを編集(手動で上書き)</button>
            </div>

            <div class="card">
                <div class="card-header">
                    <div class="card-title"><i class="ph ph-list-bullets"></i> 投稿別パフォーマンス</div>
                    <span class="badge badge-neutral">最新3件を表示中</span>
                </div>
                ${posted.length === 0 ? `<p style="color:var(--text-tertiary); font-size:0.9rem;">まだ「投稿済み」の投稿がありません。投稿予約・下書きタブから投稿を「投稿済みにする」と、ここに表示されます。</p>` : `
                <div class="table-container">
                    <table>
                        <thead><tr><th>投稿日</th><th>本文(1ツリー目)</th><th>ツリー数</th><th>閲覧数</th><th>いいね数</th><th></th></tr></thead>
                        <tbody>
                            ${visible.map(perfRow).join('')}
                            ${postPerfExpanded ? extra.map(perfRow).join('') : ''}
                        </tbody>
                    </table>
                </div>
                ${extra.length > 0 ? `
                <button class="btn-secondary" style="margin-top:16px;" onclick="togglePostPerf()">
                    <i class="ph ph-caret-${postPerfExpanded ? 'up' : 'down'}"></i> ${postPerfExpanded ? '閉じる' : 'すべての投稿を見る'}
                </button>` : ''}
                `}
            </div>

            <div class="card">
                <div class="card-header">
                    <div class="card-title"><i class="ph ph-trophy"></i> 直近1ヶ月のデータ</div>
                    <span class="badge badge-neutral">閲覧数が伸びた投稿 TOP10</span>
                </div>
                <div class="th-note-box"><i class="ph ph-info"></i> 投稿をクリックすると、詳細POPで「なぜこの投稿が伸びているのか(要因・理由)」を入力・保存できます。マーケティング事業部からも入力してもらう想定です。</div>
                ${ranked.length === 0 ? `<p style="color:var(--text-tertiary); font-size:0.9rem;">直近1ヶ月で「投稿済み」の投稿がまだありません。</p>` : `
                <div class="table-container">
                    <table>
                        <thead><tr><th>順位</th><th>投稿日</th><th>本文(1ツリー目)</th><th>閲覧数</th><th>要因の入力</th><th></th></tr></thead>
                        <tbody>${ranked.map(rankRow).join('')}</tbody>
                    </table>
                </div>
                `}
            </div>
        `;
    }

    function analysisTabHtml() {
        return `
            <div class="card">
                <div class="card-header">
                    <div class="card-title"><i class="ph ph-chart-pie-slice"></i> 分析結果一覧</div>
                    <button class="btn-secondary" onclick="openAnalysisAdd()"><i class="ph ph-plus"></i> 分析結果を追加</button>
                </div>
                <div class="table-container">
                    <table>
                        <thead><tr><th>日付</th><th>タイトル</th><th>要約</th><th>担当</th><th></th></tr></thead>
                        <tbody>
                            ${analysisList.length === 0 ? `<tr><td colspan="5" style="text-align:center; color:var(--text-tertiary);">まだ分析結果がありません</td></tr>` : analysisList.map(a => `
                                <tr>
                                    <td>${esc(a.date)}</td>
                                    <td style="white-space:normal; word-break:break-word; min-width:200px;">${esc(a.title)}</td>
                                    <td style="white-space:normal; word-break:break-word; min-width:220px;">${esc(a.summary)}</td>
                                    <td>${esc(a.author)}</td>
                                    <td><button class="btn-icon" onclick="deleteAnalysis(${a.id})"><i class="ph ph-trash"></i></button></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function researchTabHtml() {
        return `
            <div class="th-note-box"><i class="ph ph-info"></i> マーケティング事業部のリサーチ提出フォーマットに合わせています。「調査対象の投稿」を複数件追加したうえで、分析項目を記入する形式です。</div>
            <div class="card">
                <div class="card-header">
                    <div class="card-title"><i class="ph ph-magnifying-glass"></i> リサーチ結果一覧</div>
                    <button class="btn-primary" style="margin-top:0;" onclick="openResearchForm()"><i class="ph ph-plus"></i> 新規リサーチを追加</button>
                </div>
                <div class="table-container">
                    <table>
                        <thead><tr><th>日付</th><th>テーマ</th><th>調査対象投稿数</th><th>優先度</th><th>入力者</th><th></th></tr></thead>
                        <tbody>
                            ${researchList.length === 0 ? `<tr><td colspan="6" style="text-align:center; color:var(--text-tertiary);">まだリサーチ結果がありません</td></tr>` : researchList.map(r => `
                                <tr class="th-row-click" onclick="openResearchView(${r.id})">
                                    <td>${esc(r.date)}</td>
                                    <td style="white-space:normal; word-break:break-word; min-width:220px;">${esc(r.theme)}</td>
                                    <td>${(r.posts || []).length}件</td>
                                    <td><span class="badge ${r.priority === '高' ? 'badge-danger' : r.priority === '中' ? 'badge-warning' : 'badge-neutral'}">${esc(r.priority)}</span></td>
                                    <td>${esc(r.author)}</td>
                                    <td><i class="ph ph-caret-right"></i></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function postTabHtml() {
        const statusBadge = (s) => s === 'posted' ? '<span class="badge badge-success">投稿済み</span>'
            : s === 'scheduled' ? '<span class="badge badge-info">予約済み</span>'
            : '<span class="badge badge-warning">下書き</span>';

        return `
            <div class="card">
                <div class="card-header"><div class="card-title"><i class="ph ph-note-pencil"></i> 新規投稿を作成</div></div>
                <div class="form-group" style="max-width:240px;">
                    <label>ツリー数(1〜5)</label>
                    <select id="th-tree-count" onchange="renderThreadInputs(this.value)">
                        <option value="1">1ツリー</option>
                        <option value="2">2ツリー</option>
                        <option value="3" selected>3ツリー</option>
                        <option value="4">4ツリー</option>
                        <option value="5">5ツリー</option>
                    </select>
                </div>
                <div class="th-thread-chain" id="th-thread-inputs"></div>
                <div style="display:flex; gap:16px; flex-wrap:wrap;">
                    <div class="form-group" style="max-width:220px;">
                        <label>予約日(予約する場合のみ)</label>
                        <input type="date" id="th-schedule-date">
                    </div>
                    <div class="form-group" style="max-width:200px;">
                        <label>投稿時間(予約する場合のみ)</label>
                        <select id="th-schedule-time">
                            <option value="">選択してください</option>
                            <option value="07:00">7:00</option>
                            <option value="09:00">9:00</option>
                            <option value="12:00">12:00</option>
                            <option value="15:00">15:00</option>
                            <option value="19:00">19:00(連投)</option>
                            <option value="21:00">21:00(連投)</option>
                        </select>
                    </div>
                </div>
                <p style="font-size:0.75rem; color:var(--text-tertiary); margin-top:-8px; margin-bottom:16px;">※マーケティング事業部の投稿スケジュール(7/9/12/15/19/21時の6枠)に合わせています</p>
                <div style="display:flex; gap:12px;">
                    <button class="btn-secondary" onclick="savePost('draft')"><i class="ph ph-floppy-disk"></i> 下書き保存</button>
                    <button class="btn-primary" style="margin-top:0;" onclick="savePost('scheduled')"><i class="ph ph-calendar-check"></i> この日時で予約する</button>
                </div>
            </div>

            <div class="card">
                <div class="card-header"><div class="card-title"><i class="ph ph-list-checks"></i> 予約・下書き一覧</div></div>
                <div class="table-container">
                    <table>
                        <thead><tr><th>状態</th><th>本文(1件目)</th><th>ツリー数</th><th>予約日時</th><th></th></tr></thead>
                        <tbody>
                            ${posts.length === 0 ? `<tr><td colspan="5" style="text-align:center; color:var(--text-tertiary);">まだ投稿がありません</td></tr>` : posts.map(p => `
                                <tr>
                                    <td>${statusBadge(p.status)}</td>
                                    <td style="white-space:normal; word-break:break-word; min-width:220px;">${esc((p.trees && p.trees[0] && p.trees[0].text) || '')}</td>
                                    <td>${(p.trees || []).length}</td>
                                    <td>${esc(p.scheduledAt || '-')}</td>
                                    <td style="display:flex; gap:6px;">
                                        ${p.status !== 'posted' ? `<button class="btn-icon" title="投稿済みにする" onclick="markPosted(${p.id})"><i class="ph ph-check-circle"></i></button>` : ''}
                                        <button class="btn-icon" title="削除" onclick="deletePost(${p.id})"><i class="ph ph-trash"></i></button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // ------------------------------------------------------------------
    // モーダル(投稿詳細 / リサーチ閲覧 / リサーチ新規入力 / KPI編集 / 分析結果追加)
    // ------------------------------------------------------------------

    function modalsHtml() {
        return `
            <div class="modal-overlay th-modal-content" id="th-post-detail-modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 class="modal-title" id="th-post-detail-title">投稿の詳細</h3>
                        <button class="modal-close" onclick="closeModal('th-post-detail-modal')"><i class="ph ph-x"></i></button>
                    </div>
                    <div class="th-thread-chain" id="th-post-detail-body"></div>
                    <div class="th-section-divider"><span class="th-section-num"><i class="ph ph-lightbulb" style="font-size:0.85rem;"></i></span> なぜこの投稿が伸びているのか(要因・理由)</div>
                    <div class="form-group">
                        <textarea class="th-textarea th-reason-textarea" id="th-post-detail-reason" placeholder="表面的事象→中間要因→根本要因、の3階層で考えてみましょう(MSM共通の分析ルール)"></textarea>
                    </div>
                    <div style="display:flex; justify-content:flex-end;">
                        <button class="btn-primary" style="margin-top:0;" onclick="savePostDetail()"><i class="ph ph-floppy-disk"></i> 保存</button>
                    </div>
                </div>
            </div>

            <div class="modal-overlay th-modal-content" id="th-research-view-modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 class="modal-title" id="th-research-view-title">リサーチ結果</h3>
                        <button class="modal-close" onclick="closeModal('th-research-view-modal')"><i class="ph ph-x"></i></button>
                    </div>
                    <div id="th-research-view-body"></div>
                </div>
            </div>

            <div class="modal-overlay th-modal-content" id="th-research-form-modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 class="modal-title">新規リサーチ結果を入力</h3>
                        <button class="modal-close" onclick="closeModal('th-research-form-modal')"><i class="ph ph-x"></i></button>
                    </div>
                    <div class="grid grid-2" style="gap:16px;">
                        <div class="form-group"><label>リサーチテーマ</label><input type="text" id="th-r-theme" placeholder="例:競合Threadsアカウント調査"></div>
                        <div class="form-group"><label>入力者</label><input type="text" id="th-r-author" value="${esc(user.name || '')}" placeholder="担当者名"></div>
                        <div class="form-group"><label>調査対象期間(From)</label><input type="text" id="th-r-from" placeholder="2026-02-20"></div>
                        <div class="form-group"><label>調査対象期間(To)</label><input type="text" id="th-r-to" placeholder="2026-08-20"></div>
                    </div>
                    <div class="th-section-divider"><span class="th-section-num">1</span> 調査対象一覧(投稿ごとの基本データ)</div>
                    <div id="th-research-posts"></div>
                    <button class="btn-secondary" style="margin-bottom:24px;" onclick="addResearchPostCard()"><i class="ph ph-plus"></i> 調査対象の投稿を追加</button>

                    <div class="th-section-divider"><span class="th-section-num">2</span> 投稿が伸びた要因</div>
                    <div class="form-group"><textarea id="th-r-factors" style="min-height:90px;" placeholder="なぜこの投稿が伸びたのか(3階層で:表面的事象→中間要因→根本要因)"></textarea></div>

                    <div class="th-section-divider"><span class="th-section-num">3</span> 投稿構成の分析</div>
                    <div class="form-group"><textarea id="th-r-structure" style="min-height:90px;" placeholder="冒頭の掴み・展開・CTAなど、構成面の分析"></textarea></div>

                    <div class="th-section-divider"><span class="th-section-num">4</span> 読者ニーズ</div>
                    <div class="form-group"><textarea id="th-r-needs" style="min-height:70px;" placeholder="投稿の反応から読み取れる読者のニーズ"></textarea></div>

                    <div class="th-section-divider"><span class="th-section-num">5</span> コメントから分かる悩み</div>
                    <div class="form-group"><textarea id="th-r-comments" style="min-height:70px;" placeholder="コメント欄から読み取れる店舗経営者の悩み"></textarea></div>

                    <div class="th-section-divider"><span class="th-section-num">6</span> MSMへの応用</div>
                    <div class="form-group"><textarea id="th-r-application" style="min-height:70px;" placeholder="株式会社MSMのThreads運用でどう再現するか"></textarea></div>

                    <div class="th-section-divider"><span class="th-section-num">7</span> Threads投稿案</div>
                    <div class="form-group"><textarea id="th-r-proposal" style="min-height:90px;" placeholder="このリサーチをもとにした投稿文案"></textarea></div>

                    <div class="th-section-divider"><span class="th-section-num">8</span> 優先順位</div>
                    <div class="grid grid-2" style="gap:16px;">
                        <div class="form-group">
                            <label>優先度</label>
                            <select id="th-r-priority"><option>高</option><option>中</option><option>低</option></select>
                        </div>
                        <div class="form-group"><label>理由</label><input type="text" id="th-r-priority-reason" placeholder="効果・実現可能性・コスト・実行速度の観点で"></div>
                    </div>

                    <div class="th-section-divider"><span class="th-section-num">9</span> 出典</div>
                    <div class="form-group"><textarea id="th-r-source" style="min-height:70px;" placeholder="調査対象の投稿URLなど(1行に1件)"></textarea></div>

                    <div style="display:flex; justify-content:flex-end; margin-top:8px;">
                        <button class="btn-primary" style="margin-top:0;" onclick="saveResearch()"><i class="ph ph-check"></i> このリサーチ結果を保存</button>
                    </div>
                </div>
            </div>

            <div class="modal-overlay" id="th-api-modal">
                <div class="modal-content" style="max-width:480px;">
                    <div class="modal-header">
                        <h3 class="modal-title">Threads API連携設定</h3>
                        <button class="modal-close" onclick="closeModal('th-api-modal')"><i class="ph ph-x"></i></button>
                    </div>
                    <div class="th-note-box"><i class="ph ph-shield-warning"></i> ここで入力したアクセストークンは、他の連携キー(Chatwork等)と同じ方式でデータベースに保存されます。ログイン中のメンバーであれば技術的には閲覧できてしまう状態のため、第三者と共有したり、外部に貼り付けたりしないようご注意ください。入力欄は保存後に空欄へ戻り、値は画面に再表示されません。</div>
                    <div class="form-group">
                        <label>Threads User ID</label>
                        <input type="text" id="th-api-userid" placeholder="例:1784xxxxxxxxxxx">
                    </div>
                    <div class="form-group">
                        <label>アクセストークン(APIキー)</label>
                        <div style="position:relative;">
                            <input type="password" id="th-api-token" style="padding-right:44px;">
                            <button type="button" onclick="toggleApiTokenVisibility()" style="position:absolute; right:8px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; color:var(--text-tertiary);"><i class="ph ph-eye" id="th-api-token-eye"></i></button>
                        </div>
                        <p id="th-api-token-hint" style="font-size:0.75rem; color:var(--text-tertiary); margin-top:6px;"></p>
                    </div>
                    <button class="btn-primary w-100" style="width:100%;" onclick="saveApiSettings()">保存</button>
                </div>
            </div>

            <div class="modal-overlay" id="th-kpi-modal">
                <div class="modal-content" style="max-width:420px;">
                    <div class="modal-header">
                        <h3 class="modal-title">KPIを編集</h3>
                        <button class="modal-close" onclick="closeModal('th-kpi-modal')"><i class="ph ph-x"></i></button>
                    </div>
                    <div class="form-group"><label>フォロワー数</label><input type="number" id="th-kpi-followers" value="${esc(insight.followers)}"></div>
                    <div class="form-group"><label>表示閲覧数</label><input type="number" id="th-kpi-views" value="${esc(insight.totalViews)}"></div>
                    <div class="form-group"><label>プロフィール閲覧数</label><input type="number" id="th-kpi-profile" value="${esc(insight.profileViews)}"></div>
                    <button class="btn-primary w-100" style="width:100%;" onclick="saveKpi()">保存</button>
                </div>
            </div>

            <div class="modal-overlay" id="th-analysis-modal">
                <div class="modal-content" style="max-width:480px;">
                    <div class="modal-header">
                        <h3 class="modal-title">分析結果を追加</h3>
                        <button class="modal-close" onclick="closeModal('th-analysis-modal')"><i class="ph ph-x"></i></button>
                    </div>
                    <div class="form-group"><label>日付</label><input type="text" id="th-a-date" placeholder="2026-08-20"></div>
                    <div class="form-group"><label>タイトル</label><input type="text" id="th-a-title" placeholder="例:投稿別エンゲージメント比較"></div>
                    <div class="form-group"><label>要約</label><textarea id="th-a-summary" style="min-height:80px;" placeholder="分析内容の要約"></textarea></div>
                    <button class="btn-primary w-100" style="width:100%;" onclick="saveAnalysis()">保存</button>
                </div>
            </div>
        `;
    }

    // ------------------------------------------------------------------
    // 全体render
    // ------------------------------------------------------------------

    function render() {
        const html = `
            ${STYLE}
            <div class="tabs">
                <div class="tab ${activeTab === 'insight' ? 'active' : ''}" onclick="switchTab('insight')"><i class="ph ph-gauge"></i> インサイト</div>
                <div class="tab ${activeTab === 'analysis' ? 'active' : ''}" onclick="switchTab('analysis')"><i class="ph ph-chart-pie-slice"></i> 分析結果</div>
                <div class="tab ${activeTab === 'research' ? 'active' : ''}" onclick="switchTab('research')"><i class="ph ph-magnifying-glass"></i> リサーチ結果</div>
                <div class="tab ${activeTab === 'post' ? 'active' : ''}" onclick="switchTab('post')"><i class="ph ph-calendar-plus"></i> 投稿予約・下書き</div>
            </div>

            <div id="th-tab-insight" style="display:${activeTab === 'insight' ? 'block' : 'none'};">${insightTabHtml()}</div>
            <div id="th-tab-analysis" style="display:${activeTab === 'analysis' ? 'block' : 'none'};">${analysisTabHtml()}</div>
            <div id="th-tab-research" style="display:${activeTab === 'research' ? 'block' : 'none'};">${researchTabHtml()}</div>
            <div id="th-tab-post" style="display:${activeTab === 'post' ? 'block' : 'none'};">${postTabHtml()}</div>

            ${modalsHtml()}
        `;

        App.mount(html, () => {
            bindHandlers();
            if (activeTab === 'post') renderThreadInputs(document.getElementById('th-tree-count').value);
        });
    }

    // ------------------------------------------------------------------
    // イベントハンドラ(window スコープ。テンプレート内の onclick から呼ばれる)
    // ------------------------------------------------------------------

    function bindHandlers() {
        window.switchTab = (tab) => { activeTab = tab; render(); };
        window.togglePostPerf = () => { postPerfExpanded = !postPerfExpanded; render(); };
        window.closeModal = (id) => { document.getElementById(id).classList.remove('active'); };

        // --- 投稿予約・下書き ---
        window.renderThreadInputs = (count) => {
            const container = document.getElementById('th-thread-inputs');
            if (!container) return;
            let html = '';
            for (let i = 0; i < count; i++) {
                html += `<div class="th-thread-item"><div class="th-thread-num">${i + 1}/${count}</div><textarea class="th-textarea" data-tree-index="${i}" placeholder="${i + 1}つ目の投稿本文..."></textarea></div>`;
            }
            container.innerHTML = html;
            container.querySelectorAll('textarea').forEach(el => {
                autoResize(el);
                el.addEventListener('input', () => autoResize(el));
            });
        };

        window.savePost = async (status) => {
            const textareas = Array.from(document.querySelectorAll('#th-thread-inputs textarea'));
            const trees = textareas.map(el => ({ text: el.value.trim(), views: 0, likes: 0 })).filter(t => t.text);
            if (trees.length === 0) { alert('投稿本文を入力してください。'); return; }
            const scheduleDate = document.getElementById('th-schedule-date').value;
            const scheduleTime = document.getElementById('th-schedule-time').value;
            if (status === 'scheduled' && (!scheduleDate || !scheduleTime)) { alert('予約日と投稿時間の両方を選択してください。'); return; }
            const scheduledAt = (scheduleDate && scheduleTime) ? `${scheduleDate} ${scheduleTime}` : null;
            await Store.addCustomer('threads_post', {
                trees, status, scheduledAt,
                createdBy: user.name || user.email, createdAt: new Date().toISOString()
            });
            await loadAll();
            render();
        };

        window.markPosted = async (id) => {
            const today = new Date().toISOString().slice(0, 10);
            await Store.updateCustomer('threads_post', id, { status: 'posted', postedAt: today });
            await loadAll();
            render();
        };

        window.deletePost = async (id) => {
            if (!confirm('この投稿を削除しますか?')) return;
            await Store.deleteCustomer('threads_post', id);
            await loadAll();
            render();
        };

        // --- インサイト:投稿詳細(閲覧数/いいね数/要因・理由) ---
        window.openPostDetail = (id) => {
            currentDetailPostId = id;
            const post = posts.find(p => p.id === id);
            if (!post) return;
            document.getElementById('th-post-detail-title').textContent = (post.postedAt || '') + ' の投稿(全' + (post.trees || []).length + 'ツリー)';
            document.getElementById('th-post-detail-body').innerHTML = (post.trees || []).map((t, i) => `
                <div class="th-thread-item">
                    <div class="th-thread-num">${i + 1}/${post.trees.length}</div>
                    <div style="background:var(--bg-tertiary); border-radius:var(--radius-md); padding:12px 14px; font-size:0.85rem; line-height:1.6; white-space:pre-wrap;">${esc(t.text)}</div>
                    <div class="th-metrics-row">
                        <label><i class="ph ph-eye"></i> 閲覧数 <input type="number" class="th-metric-input" data-tree="${i}" data-field="views" value="${Number(t.views) || 0}"></label>
                        <label><i class="ph ph-heart"></i> いいね数 <input type="number" class="th-metric-input" data-tree="${i}" data-field="likes" value="${Number(t.likes) || 0}"></label>
                    </div>
                </div>
            `).join('');
            document.getElementById('th-post-detail-reason').value = post.reason || '';
            document.getElementById('th-post-detail-modal').classList.add('active');
            setTimeout(() => autoResize(document.getElementById('th-post-detail-reason')), 0);
        };

        window.savePostDetail = async () => {
            const post = posts.find(p => p.id === currentDetailPostId);
            if (!post) return;
            const trees = (post.trees || []).map((t, i) => {
                const viewsInput = document.querySelector(`.th-metric-input[data-tree="${i}"][data-field="views"]`);
                const likesInput = document.querySelector(`.th-metric-input[data-tree="${i}"][data-field="likes"]`);
                return { text: t.text, views: viewsInput ? Number(viewsInput.value) || 0 : t.views, likes: likesInput ? Number(likesInput.value) || 0 : t.likes };
            });
            const reason = document.getElementById('th-post-detail-reason').value;
            await Store.updateCustomer('threads_post', post.id, { trees, reason });
            await loadAll();
            document.getElementById('th-post-detail-modal').classList.remove('active');
            render();
        };

        // --- Threads API連携設定 ---
        window.openApiSettings = () => {
            document.getElementById('th-api-userid').value = insight.threadsUserId || '';
            document.getElementById('th-api-token').value = '';
            document.getElementById('th-api-token').type = 'password';
            document.getElementById('th-api-token-eye').className = 'ph ph-eye';
            document.getElementById('th-api-token-hint').textContent = insight.accessToken
                ? '既に登録済みです。変更する場合のみ新しいキーを入力してください(空欄のまま保存すると既存のキーを維持します)。'
                : 'Threads Graph APIのアクセストークンを入力してください。';
            document.getElementById('th-api-modal').classList.add('active');
        };
        window.toggleApiTokenVisibility = () => {
            const input = document.getElementById('th-api-token');
            const eye = document.getElementById('th-api-token-eye');
            if (input.type === 'password') { input.type = 'text'; eye.className = 'ph ph-eye-slash'; }
            else { input.type = 'password'; eye.className = 'ph ph-eye'; }
        };
        window.saveApiSettings = async () => {
            const userId = document.getElementById('th-api-userid').value.trim();
            const tokenInput = document.getElementById('th-api-token').value.trim();
            if (!userId) { alert('Threads User IDを入力してください。'); return; }
            if (!insight.accessToken && !tokenInput) { alert('アクセストークン(APIキー)を入力してください。'); return; }
            const data = { threadsUserId: userId };
            if (tokenInput) data.accessToken = tokenInput; // 空欄のまま保存した場合は既存のキーを上書きしない
            const rows = await Store.getCustomers('threads_insight_settings');
            if (rows[0]) await Store.updateCustomer('threads_insight_settings', rows[0].id, data);
            else await Store.addCustomer('threads_insight_settings', data);
            await loadAll();
            document.getElementById('th-api-modal').classList.remove('active');
            render();
        };

        // --- インサイト:今すぐ更新(手動、1日2回まで。サーバー側 /api/threads-sync で回数を判定) ---
        window.refreshThreadsInsight = async () => {
            const btn = document.getElementById('th-refresh-btn');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i> 更新中...'; }
            try {
                const res = await fetch('/api/threads-sync', { method: 'POST' });
                const json = await res.json();
                if (!res.ok) {
                    alert(json.error || '更新に失敗しました。');
                    await loadAll();
                    render();
                    return;
                }
                await loadAll();
                render();
            } catch (e) {
                alert('通信エラーが発生しました: ' + e.message);
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ph ph-arrows-clockwise"></i> 今すぐ更新'; }
            }
        };

        // --- インサイト:KPI編集 ---
        window.openKpiEdit = () => { document.getElementById('th-kpi-modal').classList.add('active'); };
        window.saveKpi = async () => {
            const data = {
                followers: Number(document.getElementById('th-kpi-followers').value) || 0,
                totalViews: Number(document.getElementById('th-kpi-views').value) || 0,
                profileViews: Number(document.getElementById('th-kpi-profile').value) || 0
            };
            const rows = await Store.getCustomers('threads_insight_settings');
            if (rows[0]) await Store.updateCustomer('threads_insight_settings', rows[0].id, data);
            else await Store.addCustomer('threads_insight_settings', data);
            await loadAll();
            document.getElementById('th-kpi-modal').classList.remove('active');
            render();
        };

        // --- 分析結果 ---
        window.openAnalysisAdd = () => { document.getElementById('th-analysis-modal').classList.add('active'); };
        window.saveAnalysis = async () => {
            const title = document.getElementById('th-a-title').value.trim();
            if (!title) { alert('タイトルを入力してください。'); return; }
            await Store.addCustomer('threads_analysis', {
                date: document.getElementById('th-a-date').value.trim() || new Date().toISOString().slice(0, 10),
                title, summary: document.getElementById('th-a-summary').value.trim(),
                author: user.name || user.email
            });
            await loadAll();
            document.getElementById('th-analysis-modal').classList.remove('active');
            render();
        };
        window.deleteAnalysis = async (id) => {
            if (!confirm('削除しますか?')) return;
            await Store.deleteCustomer('threads_analysis', id);
            await loadAll();
            render();
        };

        // --- リサーチ結果:閲覧 ---
        window.openResearchView = (id) => {
            const r = researchList.find(x => x.id === id);
            if (!r) return;
            document.getElementById('th-research-view-title').textContent = r.theme;
            const postHtml = (p, i, total) => `
                <div class="th-post-card">
                    <div class="th-thread-num" style="margin-bottom:10px;">調査対象 ${i + 1}/${total}</div>
                    <p style="font-size:0.8rem; color:var(--text-tertiary); word-break:break-all; margin-bottom:12px;">${esc(p.url)}</p>
                    <div class="th-field-grid" style="grid-template-columns:repeat(4,1fr); font-size:0.8rem;">
                        <div><strong>投稿日時</strong><br>${esc(p.datetime)}</div>
                        <div><strong>投稿者</strong><br>${esc(p.account)}</div>
                        <div><strong>フォロワー数</strong><br>${esc(p.followers)}</div>
                        <div><strong>投稿形式</strong><br>${esc(p.format)}</div>
                        <div><strong>いいね数</strong><br>${esc(p.likes)}</div>
                        <div><strong>リポスト数</strong><br>${esc(p.reposts)}</div>
                        <div><strong>返信数</strong><br>${esc(p.replies)}</div>
                        <div><strong>インプレッション数</strong><br>${esc(p.impressions)}</div>
                    </div>
                    <p style="font-size:0.85rem; margin:8px 0;"><strong>投稿内容:</strong> ${esc(p.content)}</p>
                    <p style="font-size:0.85rem; margin-bottom:8px;"><strong>冒頭の文章:</strong> ${esc(p.opening)}</p>
                    <p style="font-size:0.85rem; margin-bottom:8px;"><strong>主張:</strong> ${esc(p.claim)}</p>
                    <p style="font-size:0.85rem; margin-bottom:8px;"><strong>読者の悩み:</strong> ${esc(p.painPoint)}</p>
                    <p style="font-size:0.85rem; margin-bottom:8px;"><strong>CTA:</strong> ${esc(p.cta)}</p>
                    <p style="font-size:0.85rem; margin-bottom:8px;"><strong>投稿者のプロフィール:</strong> ${esc(p.profile)}</p>
                    <p style="font-size:0.85rem;"><strong>推定される投稿の目的:</strong> ${esc(p.purpose)}</p>
                </div>
            `;
            document.getElementById('th-research-view-body').innerHTML = `
                <div style="margin-bottom:20px;"><p style="font-size:0.9rem; color:var(--text-secondary);">入力者:${esc(r.author)} / 調査期間:${esc(r.period)} / 優先度:${esc(r.priority)}</p></div>
                <div class="th-section-divider"><span class="th-section-num">1</span> 調査対象一覧</div>
                ${(r.posts || []).map((p, i) => postHtml(p, i, r.posts.length)).join('')}
                <div class="th-section-divider"><span class="th-section-num">2</span> 投稿が伸びた要因</div>
                <p style="font-size:0.9rem; line-height:1.7; white-space:pre-wrap;">${esc(r.factors)}</p>
                <div class="th-section-divider"><span class="th-section-num">3</span> 投稿構成の分析</div>
                <p style="font-size:0.9rem; line-height:1.7; white-space:pre-wrap;">${esc(r.structure)}</p>
                <div class="th-section-divider"><span class="th-section-num">4</span> 読者ニーズ</div>
                <p style="font-size:0.9rem; line-height:1.7; white-space:pre-wrap;">${esc(r.readerNeeds)}</p>
                <div class="th-section-divider"><span class="th-section-num">5</span> コメントから分かる悩み</div>
                <p style="font-size:0.9rem; line-height:1.7; white-space:pre-wrap;">${esc(r.commentInsights)}</p>
                <div class="th-section-divider"><span class="th-section-num">6</span> MSMへの応用</div>
                <p style="font-size:0.9rem; line-height:1.7; white-space:pre-wrap;">${esc(r.application)}</p>
                <div class="th-section-divider"><span class="th-section-num">7</span> Threads投稿案</div>
                <p style="font-size:0.9rem; line-height:1.7; white-space:pre-wrap;">${esc(r.proposal)}</p>
                <div class="th-section-divider"><span class="th-section-num">8</span> 優先順位</div>
                <p style="font-size:0.9rem; line-height:1.7;">優先度:${esc(r.priority)} / 理由:${esc(r.priorityReason)}</p>
                <div class="th-section-divider"><span class="th-section-num">9</span> 出典</div>
                <p style="font-size:0.85rem; color:var(--text-tertiary); word-break:break-all; white-space:pre-wrap;">${esc(r.source)}</p>
            `;
            document.getElementById('th-research-view-modal').classList.add('active');
        };

        // --- リサーチ結果:新規入力 ---
        let researchPostCount = 0;
        window.addResearchPostCard = () => {
            researchPostCount++;
            const container = document.getElementById('th-research-posts');
            const div = document.createElement('div');
            div.className = 'th-post-card';
            div.innerHTML = `
                <button class="th-remove-btn" onclick="this.parentElement.remove()"><i class="ph ph-trash"></i></button>
                <div class="th-thread-num" style="margin-bottom:10px;">調査対象 ${researchPostCount}</div>
                <div class="form-group"><label>投稿URL</label><input type="url" class="th-rp-url" placeholder="https://www.threads.com/@.../post/..."></div>
                <div class="th-field-grid">
                    <div class="form-group"><label>投稿日時</label><input type="text" class="th-rp-datetime" placeholder="2026-08-19 21:00"></div>
                    <div class="form-group"><label>投稿者(アカウント)</label><input type="text" class="th-rp-account" placeholder="@example"></div>
                    <div class="form-group"><label>フォロワー数</label><input type="text" class="th-rp-followers" placeholder="3,200"></div>
                    <div class="form-group"><label>投稿形式</label><input type="text" class="th-rp-format" placeholder="単発 / 連投1/3等"></div>
                    <div class="form-group"><label>いいね数</label><input type="text" class="th-rp-likes" placeholder="890"></div>
                    <div class="form-group"><label>リポスト数</label><input type="text" class="th-rp-reposts" placeholder="64"></div>
                    <div class="form-group"><label>返信数</label><input type="text" class="th-rp-replies" placeholder="58"></div>
                    <div class="form-group"><label>インプレッション数</label><input type="text" class="th-rp-impressions" placeholder="42,000"></div>
                </div>
                <div class="form-group"><label>投稿内容(全文)</label><textarea class="th-rp-content" style="min-height:60px;" placeholder="投稿本文をそのまま入力"></textarea></div>
                <div class="th-field-grid th-cols-2">
                    <div class="form-group"><label>冒頭の文章</label><input type="text" class="th-rp-opening" placeholder="最初の一文"></div>
                    <div class="form-group"><label>主張</label><input type="text" class="th-rp-claim" placeholder="この投稿が伝えたい主張"></div>
                </div>
                <div class="th-field-grid th-cols-2">
                    <div class="form-group"><label>読者の悩み</label><input type="text" class="th-rp-pain" placeholder="読者が抱えている悩み"></div>
                    <div class="form-group"><label>CTA</label><input type="text" class="th-rp-cta" placeholder="次に取ってほしい行動"></div>
                </div>
                <div class="form-group"><label>投稿者のプロフィール</label><input type="text" class="th-rp-profile" placeholder="発信ジャンル・フォロワー規模など"></div>
                <div class="form-group" style="margin-bottom:0;"><label>推定される投稿の目的</label><input type="text" class="th-rp-purpose" placeholder="例:無料診断への送客、認知拡大 など"></div>
            `;
            container.appendChild(div);
        };

        window.saveResearch = async () => {
            const theme = document.getElementById('th-r-theme').value.trim();
            if (!theme) { alert('リサーチテーマを入力してください。'); return; }
            const postCards = Array.from(document.querySelectorAll('#th-research-posts .th-post-card'));
            const rposts = postCards.map(card => ({
                url: card.querySelector('.th-rp-url').value.trim(),
                datetime: card.querySelector('.th-rp-datetime').value.trim(),
                account: card.querySelector('.th-rp-account').value.trim(),
                followers: card.querySelector('.th-rp-followers').value.trim(),
                format: card.querySelector('.th-rp-format').value.trim(),
                likes: card.querySelector('.th-rp-likes').value.trim(),
                reposts: card.querySelector('.th-rp-reposts').value.trim(),
                replies: card.querySelector('.th-rp-replies').value.trim(),
                impressions: card.querySelector('.th-rp-impressions').value.trim(),
                content: card.querySelector('.th-rp-content').value.trim(),
                opening: card.querySelector('.th-rp-opening').value.trim(),
                claim: card.querySelector('.th-rp-claim').value.trim(),
                painPoint: card.querySelector('.th-rp-pain').value.trim(),
                cta: card.querySelector('.th-rp-cta').value.trim(),
                profile: card.querySelector('.th-rp-profile').value.trim(),
                purpose: card.querySelector('.th-rp-purpose').value.trim()
            }));

            await Store.addCustomer('threads_research', {
                date: new Date().toISOString().slice(0, 10),
                theme,
                author: document.getElementById('th-r-author').value.trim() || (user.name || user.email),
                period: (document.getElementById('th-r-from').value.trim() || '') + ' 〜 ' + (document.getElementById('th-r-to').value.trim() || ''),
                posts: rposts,
                factors: document.getElementById('th-r-factors').value.trim(),
                structure: document.getElementById('th-r-structure').value.trim(),
                readerNeeds: document.getElementById('th-r-needs').value.trim(),
                commentInsights: document.getElementById('th-r-comments').value.trim(),
                application: document.getElementById('th-r-application').value.trim(),
                proposal: document.getElementById('th-r-proposal').value.trim(),
                priority: document.getElementById('th-r-priority').value,
                priorityReason: document.getElementById('th-r-priority-reason').value.trim(),
                source: document.getElementById('th-r-source').value.trim()
            });

            await loadAll();
            document.getElementById('th-research-form-modal').classList.remove('active');
            render();
        };

        window.openResearchForm = () => {
            researchPostCount = 0;
            document.getElementById('th-research-posts').innerHTML = '';
            window.addResearchPostCard();
            document.getElementById('th-research-form-modal').classList.add('active');
        };
    }

    // 文字数に応じてテキストエリアの高さを自動調整する
    function autoResize(el) {
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
    }

    render();
};
