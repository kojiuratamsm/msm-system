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
                新しく入社した方や、アカウントを発行したい方へ、下記のURLと合言葉（パスワードのようなもの）をお伝えください。<br>
                メンバー自身でアカウント登録を行うと、指定した部署の権限が自動的に付与されます。
            </p>

            <div style="background: var(--bg-tertiary); padding: 16px; border-radius: var(--radius-md); margin-bottom: 32px;">
                <h4 style="margin-bottom: 12px; color: var(--text-primary); font-size: 1rem;">1. 登録用URL (全社共通)</h4>
                <div style="display: flex; gap: 8px;">
                    <input type="text" id="invite-url" class="input-field" readonly value="https://admin.msm-fund.com/" style="flex: 1; font-weight: bold; color: var(--primary-dark); background: #fff;">
                    <button class="btn-primary" onclick="navigator.clipboard.writeText('https://admin.msm-fund.com/'); alert('URLをコピーしました！');" style="display:flex; align-items:center; gap:4px;">
                        <i class="ph ph-copy"></i> コピー
                    </button>
                    <a href="https://admin.msm-fund.com/" target="_blank" class="btn-secondary" style="display:flex; align-items:center; gap:4px;">
                        開く <i class="ph ph-arrow-square-out"></i>
                    </a>
                </div>
                <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 8px;">※このURLを開き、ログイン画面の下部にある「メンバー登録はこちら」から進んでいただきます。</p>
            </div>

            <h4 style="margin-bottom: 16px; color: var(--text-primary); font-size: 1rem;">2. 各部署の合言葉（招待コード）</h4>
            <div class="grid grid-3" style="gap: 16px;">
                
                <!-- Plus One -->
                <div style="border: 1px solid var(--border-light); padding: 16px; border-radius: var(--radius-md); text-align: center; background: #fff;">
                    <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">Plus One</div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px;">(映像制作 / PMなど)</div>
                    <div style="font-size: 1.1rem; font-weight: bold; background: var(--bg-hover); padding: 8px; border-radius: 4px; margin-bottom: 12px; letter-spacing: 1px;">
                        Plus One
                    </div>
                    <button class="btn-secondary btn-sm w-100" onclick="navigator.clipboard.writeText('Plus One'); alert('Plus One の合言葉をコピーしました');">
                        <i class="ph ph-copy"></i> 合言葉をコピー
                    </button>
                </div>

                <!-- MEO -->
                <div style="border: 1px solid var(--border-light); padding: 16px; border-radius: var(--radius-md); text-align: center; background: #fff;">
                    <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">MEO対策チャンネル</div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px;">(MEO運用 / ブログ投稿など)</div>
                    <div style="font-size: 1.1rem; font-weight: bold; background: var(--bg-hover); padding: 8px; border-radius: 4px; margin-bottom: 12px; letter-spacing: 1px;">
                        MEO Taisaku
                    </div>
                    <button class="btn-secondary btn-sm w-100" onclick="navigator.clipboard.writeText('MEO Taisaku'); alert('MEO対策チャンネル の合言葉をコピーしました');">
                        <i class="ph ph-copy"></i> 合言葉をコピー
                    </button>
                </div>

                <!-- 通信 -->
                <div style="border: 1px solid var(--border-light); padding: 16px; border-radius: var(--radius-md); text-align: center; background: #fff;">
                    <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">通信事業</div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px;">(通信キャリア / 人材手配など)</div>
                    <div style="font-size: 1.1rem; font-weight: bold; background: var(--bg-hover); padding: 8px; border-radius: 4px; margin-bottom: 12px; letter-spacing: 1px;">
                        MSM Tsushin
                    </div>
                    <button class="btn-secondary btn-sm w-100" onclick="navigator.clipboard.writeText('MSM Tsushin'); alert('通信事業 の合言葉をコピーしました');">
                        <i class="ph ph-copy"></i> 合言葉をコピー
                    </button>
                </div>

            </div>
        </div>
    `;

    App.mount(html);
};
