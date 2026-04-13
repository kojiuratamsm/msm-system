App.Pages.meo_users = function() {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') {
        App.mount('<div class="card" style="margin-top:24px; padding: 40px; text-align:center;"><h3 class="card-title" style="color:var(--danger)">これは管理者以外操作できません</h3></div>');
        return;
    }

    const html = `
        <div class="card" style="max-width: 600px; margin: 24px auto;">
            <div class="card-header">
                <h3 class="card-title"><i class="ph ph-users-three"></i> MEOユーザー管理連携</h3>
            </div>
            
            <div style="padding: 24px 0;">
                <p style="margin-bottom: 24px; color: var(--text-secondary);">以下のボタンから外部のMEOダッシュボードシステムにアクセスできます。記載のログイン情報を使用してアクセスしてください。</p>

                <div style="background: var(--bg-tertiary); padding: 16px; border-radius: 8px; margin-bottom: 24px; border: 1px solid var(--border-light);">
                    <h4 style="margin-bottom: 12px; color: var(--text-primary);"><i class="ph ph-shield-check"></i> マスターログイン</h4>
                    <pre style="background: var(--bg-color); padding: 12px; border-radius: 4px; font-family: monospace; font-size: 1rem;">ID: urata@msm-jap.com\nPW: Koji2819</pre>
                </div>

                <div style="background: var(--bg-tertiary); padding: 16px; border-radius: 8px; margin-bottom: 32px; border: 1px solid var(--border-light);">
                    <h4 style="margin-bottom: 12px; color: var(--text-primary);"><i class="ph ph-user"></i> テストログイン</h4>
                    <pre style="background: var(--bg-color); padding: 12px; border-radius: 4px; font-family: monospace; font-size: 1rem;">ID: test@gmail.com\nPW: test12345</pre>
                </div>

                <a href="https://meo-dashboard-system.vercel.app/" target="_blank" class="btn-primary" style="display: block; text-align: center; font-size: 1.1rem; padding: 16px; text-decoration: none;">
                    ログイン画面を開く <i class="ph ph-arrow-square-out"></i>
                </a>
            </div>
        </div>
    `;

    App.mount(html);
};
