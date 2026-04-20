// メンバー招待情報 (Invite links and codes)
App.Pages.invites = async function() {
    const html = `
        <div class="card" style="max-width: 800px; margin: 0 auto;">
            <div class="card-header" style="border-bottom: 1px solid var(--border-light); padding-bottom: 16px; margin-bottom: 24px;">
                <h3 class="card-title" style="font-size: 1.2rem; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                    <i class="ph ph-user-plus"></i> 新規メンバー招待・登録手順
                </h3>
            </div>
            
            <p style="color: var(--text-secondary); margin-bottom: 24px; line-height: 1.6;">
                新しく入社した方や、アカウントを発行したい方へ、下記のURLを送信してください。<br>
                指定した部署の権限が自動的に付与されます。
            </p>

            <h4 style="margin-bottom: 16px; color: var(--text-primary); font-size: 1rem;">各部署の専用登録フォームリンク</h4>
            <div class="grid grid-3" style="gap: 16px;">
                
                <!-- Plus One -->
                <div style="border: 1px solid var(--border-light); padding: 16px; border-radius: var(--radius-md); text-align: center; background: #fff;">
                    <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">Plus One</div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px;">(映像制作 / PMなど)</div>
                    <button class="btn-secondary btn-sm w-100" onclick="navigator.clipboard.writeText('https://admin.msm-fund.com/?invite=plus_one'); alert('Plus One の登録フォームURLをコピーしました！送付してください。');">
                        <i class="ph ph-link"></i> フォームURLをコピー
                    </button>
                    <a href="https://admin.msm-fund.com/?invite=plus_one" target="_blank" style="display:block; margin-top:8px; font-size:0.8rem; color:var(--primary);">フォームを開いて確認</a>
                </div>

                <!-- MEO -->
                <div style="border: 1px solid var(--border-light); padding: 16px; border-radius: var(--radius-md); text-align: center; background: #fff;">
                    <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">MEO対策チャンネル</div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px;">(MEO運用 / ブログ投稿など)</div>
                     <button class="btn-secondary btn-sm w-100" onclick="navigator.clipboard.writeText('https://admin.msm-fund.com/?invite=meo'); alert('MEO対策チャンネル の登録フォームURLをコピーしました！送付してください。');">
                        <i class="ph ph-link"></i> フォームURLをコピー
                    </button>
                    <a href="https://admin.msm-fund.com/?invite=meo" target="_blank" style="display:block; margin-top:8px; font-size:0.8rem; color:var(--primary);">フォームを開いて確認</a>
                </div>

                <!-- 通信 -->
                <div style="border: 1px solid var(--border-light); padding: 16px; border-radius: var(--radius-md); text-align: center; background: #fff;">
                    <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">通信事業</div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px;">(通信キャリア / 人材手配など)</div>
                    <button class="btn-secondary btn-sm w-100" onclick="navigator.clipboard.writeText('https://admin.msm-fund.com/?invite=tsushin'); alert('通信事業 の登録フォームURLをコピーしました！送付してください。');">
                        <i class="ph ph-link"></i> フォームURLをコピー
                    </button>
                    <a href="https://admin.msm-fund.com/?invite=tsushin" target="_blank" style="display:block; margin-top:8px; font-size:0.8rem; color:var(--primary);">フォームを開いて確認</a>
                </div>

            </div>
        </div>
    `;

    App.mount(html);
};
