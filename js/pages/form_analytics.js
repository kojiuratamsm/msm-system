App.Pages.form_analytics = async function() {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') {
        App.mount('<div class="card" style="margin-top:24px; padding: 40px; text-align:center;"><h3 class="card-title">アクセス権限がありません</h3></div>');
        return;
    }

    App.mount(`
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
            <h2 style="margin:0; font-size:1.5rem; font-weight:700;"><i class="ph ph-chart-bar" style="margin-right:8px; color:var(--primary-color);"></i>分析フォーム</h2>
            <div>
                <button class="btn btn-danger" id="reset-stats-btn" style="margin-right:8px;"><i class="ph ph-trash"></i> データをリセット</button>
                <button class="btn btn-secondary" onclick="window.open('/analyticsform/', '_blank')" style="margin-right:8px;"><i class="ph ph-arrow-square-out"></i> フォームを開く</button>
                <button class="btn btn-primary" onclick="App.navigate('form_editor')"><i class="ph ph-pencil-simple"></i> フォームを編集</button>
            </div>
        </div>
        <div id="analytics-content" style="text-align:center; padding: 40px;">
            <i class="ph ph-spinner ph-spin" style="font-size:2rem; color:var(--primary-color);"></i>
            <p>データを読み込み中...</p>
        </div>
    `);

    // リセットボタンの処理バインド
    setTimeout(() => {
        const resetBtn = document.getElementById('reset-stats-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', async () => {
                if (confirm('【警告】これまでのテスト回答データやアクセス統計ログ（Views, Starts等）がすべて削除されます。よろしいですか？')) {
                    resetBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> リセット中...';
                    resetBtn.disabled = true;
                    try {
                        await Store.clearMEOFormStatsAndResponses();
                        alert('データをすべてリセットしました。');
                        App.Pages.form_analytics(); // 画面再描画
                    } catch (e) {
                        console.error(e);
                        alert('リセット中にエラーが発生しました。');
                        resetBtn.innerHTML = '<i class="ph ph-trash"></i> データをリセット';
                        resetBtn.disabled = false;
                    }
                }
            });
        }
    }, 100);

    // データの取得
    const [formData, statsData] = await Promise.all([
        Store.getMEOForm(),
        Store.getMEOFormStats()
    ]);

    if (!formData) {
        document.getElementById('analytics-content').innerHTML = `
            <div class="card" style="padding:40px;">
                <h3 style="margin-bottom:16px;">フォームがまだ作成されていません</h3>
                <p style="color:var(--text-secondary); margin-bottom:24px;">まずはフォームエディタを開いて、診断フォームを作成してください。</p>
                <button class="btn btn-primary" onclick="App.navigate('form_editor')"><i class="ph ph-pencil-simple"></i> フォームを作成する</button>
            </div>
        `;
        return;
    }

    // 統計の計算
    let views = 0;
    let starts = 0;
    let submissions = 0;
    const reaches = {}; // questionId -> count

    statsData.forEach(stat => {
        if (stat.type === 'view') views++;
        else if (stat.type === 'start') starts++;
        else if (stat.type === 'submission') submissions++;
        else if (stat.type === 'reach' && stat.detail) {
            reaches[stat.detail] = (reaches[stat.detail] || 0) + 1;
        }
    });

    const completionRate = starts > 0 ? Math.round((submissions / starts) * 100) : 0;

    let kpiHtml = `
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 24px; margin-bottom:32px;">
            <div class="card" style="text-align:center; padding:24px;">
                <div style="color:var(--text-secondary); font-size:0.9rem; font-weight:600; margin-bottom:8px;">Views (アクセス数)</div>
                <div style="font-size:2rem; font-weight:700; color:#1a1a1a;">${views.toLocaleString()}</div>
            </div>
            <div class="card" style="text-align:center; padding:24px;">
                <div style="color:var(--text-secondary); font-size:0.9rem; font-weight:600; margin-bottom:8px;">Starts (開始数)</div>
                <div style="font-size:2rem; font-weight:700; color:var(--primary-color);">${starts.toLocaleString()}</div>
            </div>
            <div class="card" style="text-align:center; padding:24px;">
                <div style="color:var(--text-secondary); font-size:0.9rem; font-weight:600; margin-bottom:8px;">Submissions (完了数)</div>
                <div style="font-size:2rem; font-weight:700; color:#198754;">${submissions.toLocaleString()}</div>
            </div>
            <div class="card" style="text-align:center; padding:24px;">
                <div style="color:var(--text-secondary); font-size:0.9rem; font-weight:600; margin-bottom:8px;">Completion Rate (完了率)</div>
                <div style="font-size:2rem; font-weight:700; color:#0dcaf0;">${completionRate}%</div>
            </div>
        </div>
    `;

    // 離脱率の計算とファネル表示
    let funnelHtml = `<div class="card" style="padding:24px;">
        <h3 style="margin-top:0; margin-bottom:24px;">設問ごとの到達・離脱状況 (ファネル分析)</h3>
        <div style="display:flex; flex-direction:column; gap:12px;">
    `;

    // ファネルの各ステップ (OP -> Q1 -> Q2 ... -> ED)
    const steps = [];
    steps.push({ title: 'OP (開始)', count: starts, max: starts });
    
    formData.questions.forEach((q, idx) => {
        const count = reaches[q.id] || 0;
        steps.push({ title: `Q${idx+1}: ${q.title}`, count: count, max: starts });
    });

    steps.push({ title: 'ED (提出完了)', count: submissions, max: starts });

    steps.forEach((step, idx) => {
        const percentage = starts > 0 ? Math.round((step.count / starts) * 100) : 0;
        const drop = idx > 0 ? (steps[idx-1].count - step.count) : 0;
        const dropText = drop > 0 ? `<span style="color:#dc3545; font-size:0.8rem; margin-left:12px;"><i class="ph ph-trend-down"></i> ${drop}人 離脱</span>` : '';

        funnelHtml += `
            <div style="display:flex; align-items:center; background:#f8f9fc; border-radius:8px; padding:12px 16px;">
                <div style="width:250px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-right:16px;" title="${step.title}">
                    ${step.title}
                </div>
                <div style="flex:1; background:#e0e0e0; height:12px; border-radius:6px; overflow:hidden; position:relative;">
                    <div style="background:var(--primary-color); width:${percentage}%; height:100%; border-radius:6px;"></div>
                </div>
                <div style="width:120px; text-align:right; font-weight:700; margin-left:16px;">
                    ${step.count.toLocaleString()} <span style="color:var(--text-secondary); font-size:0.8rem; font-weight:normal;">(${percentage}%)</span>
                </div>
                <div style="width:100px; text-align:right;">
                    ${dropText}
                </div>
            </div>
        `;
    });

    funnelHtml += `</div></div>`;

    document.getElementById('analytics-content').innerHTML = kpiHtml + funnelHtml;
};
