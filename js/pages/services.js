App.Pages.services = async function() {
    const html = `
        <div class="grid grid-3">
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Plus One</h3>
                    <div class="badge badge-info">映像制作</div>
                </div>
                <p style="color: var(--text-secondary); margin-bottom: 24px; line-height: 1.6;">
                    ショート動画からYouTubeの長尺まで、質の高い動画制作サービスを提供します。
                </p>
                <div class="grid grid-2">
                    <button class="btn-secondary" onclick="App.navigate('customers', 'plusOne')">顧客管理へ</button>
                    <button class="btn-primary btn-sm" onclick="App.navigate('sales', 'plusOne')">売上計算へ</button>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">MEO対策チャンネル</h3>
                    <div class="badge badge-success">MEO</div>
                </div>
                <p style="color: var(--text-secondary); margin-bottom: 24px; line-height: 1.6;">
                    Googleビジネスプロフィールを活用した集客支援、ブログ投稿、定期運用を代行。
                </p>
                <div class="grid grid-2">
                    <button class="btn-secondary" onclick="App.navigate('customers', 'meo')">顧客管理へ</button>
                    <button class="btn-primary btn-sm" onclick="App.navigate('sales', 'meo')">売上計算へ</button>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">通信</h3>
                    <div class="badge badge-warning">人材派遣</div>
                </div>
                <p style="color: var(--text-secondary); margin-bottom: 24px; line-height: 1.6;">
                    現場ごとの通信インフラ整備、保守作業。単価ベースでの収益管理に対応。
                </p>
                <div class="grid grid-2">
                    <button class="btn-secondary" onclick="App.navigate('customers', 'telecom')">顧客管理へ</button>
                    <button class="btn-primary btn-sm" onclick="App.navigate('sales', 'telecom')">売上計算へ</button>
                </div>
            </div>
        </div>
    `;

    App.mount(html);
};
