App.Pages.ai_planner = async function() {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') {
        App.mount('<div class="card" style="margin-top:24px; padding: 40px; text-align:center;"><h3 class="card-title">アクセス権限がありません</h3><p style="color:var(--text-secondary); margin-top: 16px;">AI企画室は管理者のみ閲覧可能です。</p></div>');
        return;
    }

    const html = `
        <div class="card" style="margin-bottom: 24px; padding: 24px; background: var(--bg-secondary);">
            <div style="border-bottom: 1px solid var(--border-light); padding-bottom: 16px; margin-bottom: 24px;">
                <h3 style="font-size: 1.2rem; margin: 0; color: var(--primary-dark);"><i class="ph ph-gear"></i> API設定</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 8px;">
                    自動リサーチと企画生成を行うためにOpenAIのAPIキーを保存してください。<br>
                    ※キーはブラウザのローカルストレージに安全に保管されます。
                </p>
            </div>
            <div class="form-group" style="max-width: 600px;">
                <label>OpenAI APIキー (sk-proj-...)</label>
                <div style="display: flex; gap: 8px;">
                    <input type="password" id="openai-api-key" class="input-field" placeholder="sk-..." value="">
                    <button class="btn-primary" onclick="saveApiKey()">保存</button>
                </div>
            </div>
        </div>

        <div class="card" style="padding: 24px; margin-bottom: 24px;">
            <div style="border-bottom: 1px solid var(--border-light); padding-bottom: 16px; margin-bottom: 24px;">
                <h3 style="font-size: 1.2rem; margin: 0; color: var(--primary-dark);"><i class="ph ph-brain"></i> AI企画室 (YouTube企画リサーチAI)</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 8px;">
                    調べたいキーワードやジャンルを入力してください。<br>
                    AI社員がYouTube上のリアルタイムな最新トレンド（直近半年〜1年）をリサーチし、伸びている動画の傾向分析と、そこからヒットが期待できる企画案を3つ自動で提案します。
                </p>
            </div>

            <div class="grid grid-2" style="gap: 24px; max-width: 900px;">
                <div class="form-group">
                    <label>リサーチしたいキーワード・ジャンル</label>
                    <input type="text" id="research-query" class="input-field" placeholder="例: MEO店舗集客、インフルエンサー活用 やめろ など">
                </div>
                <div class="form-group">
                    <label>リサーチ対象期間</label>
                    <select id="research-period" class="input-field">
                        <option value="1year" selected>直近 1 年間（おすすめ）</option>
                        <option value="6months">直近 半年間</option>
                    </select>
                </div>
            </div>

            <div style="margin-top: 24px;">
                <button id="btn-run-planner" class="btn-primary" style="font-size: 1.1rem; padding: 12px 32px; display: inline-flex; justify-content: center; align-items: center; gap: 8px; width: 100%; max-width: 300px;" onclick="runResearchAndPlanning()">
                    <i class="ph ph-lightning"></i> AI社員に企画を依頼する
                </button>
            </div>

            <!-- 進捗表示 -->
            <div id="planner-progress" style="display: none; margin-top: 32px; padding: 24px; background: var(--bg-tertiary); border-radius: 8px; text-align: center;">
                <i class="ph ph-spinner ph-spin" style="font-size: 2.5rem; color: var(--primary); margin-bottom: 16px;"></i>
                <div id="planner-progress-text" style="font-size: 1.1rem; font-weight: bold; color: var(--text-primary);">YouTube上の最新動画データを収集中...</div>
                <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 8px;">※YouTube上の検索データ収集とGPT-4oによる分析には約1〜2分かかります。画面を閉じずにお待ちください。</p>
            </div>
        </div>

        <!-- 結果表示エリア -->
        <div id="planner-result-card" class="card" style="display: none; padding: 32px;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-light); padding-bottom: 16px; margin-bottom: 24px;">
                <h3 style="font-size: 1.3rem; margin: 0; color: var(--success-dark); display: flex; align-items: center; gap: 8px;">
                    <i class="ph ph-sparkles" style="color: var(--warning);"></i> AI企画提案書
                </h3>
                <button class="btn-secondary" onclick="window.print()"><i class="ph ph-printer"></i> 印刷 / PDF保存</button>
            </div>

            <div id="planner-report-content" class="markdown-body" style="line-height: 1.8; color: var(--text-primary);">
                <!-- ここに生成されたマークダウンテキストがパースされて入る -->
            </div>
        </div>
    `;

    App.mount(html, () => {
        // APIキーの読み込み
        const savedKey = localStorage.getItem('openai_api_key');
        if (savedKey) {
            document.getElementById('openai-api-key').value = savedKey;
        }

        window.saveApiKey = () => {
            const key = document.getElementById('openai-api-key').value.trim();
            if (!key) {
                alert('APIキーを入力してください。');
                return;
            }
            localStorage.setItem('openai_api_key', key);
            alert('APIキーをブラウザに保存しました！');
        };

        window.runResearchAndPlanning = async () => {
            const apiKey = localStorage.getItem('openai_api_key');
            if (!apiKey) {
                alert('まずは画面上部の「API設定」でOpenAIのAPIキーを保存してください。');
                return;
            }

            const query = document.getElementById('research-query').value.trim();
            const period = document.getElementById('research-period').value;

            if (!query) {
                alert('キーワードまたはジャンルを入力してください。');
                return;
            }

            const btn = document.getElementById('btn-run-planner');
            const progress = document.getElementById('planner-progress');
            const progressText = document.getElementById('planner-progress-text');
            const resultCard = document.getElementById('planner-result-card');
            const reportContent = document.getElementById('planner-report-content');

            btn.disabled = true;
            btn.style.opacity = '0.5';
            progress.style.display = 'block';
            resultCard.style.display = 'none';
            progressText.textContent = 'YouTube上の最新動画データを収集中...';

            try {
                // 30秒後ぐらいにローテーションでメッセージを変えて退屈を防ぐ
                const msgTimer = setTimeout(() => {
                    progressText.textContent = 'データをGPT-4oに転送し、直近のヒット傾向を分析中...';
                }, 15000);
                const msgTimer2 = setTimeout(() => {
                    progressText.textContent = '競合の伸びている理由を特定し、新規企画案を構築中...';
                }, 35000);

                const response = await fetch('/api/youtube_research', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({ query, period })
                });

                clearTimeout(msgTimer);
                clearTimeout(msgTimer2);

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || '企画の生成に失敗しました。');
                }

                const data = await response.json();

                // マークダウンのパースと台本作成ボタンの埋め込み処理
                reportContent.innerHTML = parseMarkdownAndInjectButtons(data.report, query);
                
                progress.style.display = 'none';
                resultCard.style.display = 'block';

            } catch (error) {
                console.error(error);
                alert('エラーが発生しました: ' + error.message);
                progress.style.display = 'none';
            } finally {
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        };

        // マークダウンを簡易的なHTMLに変換し、企画ごとに「台本作成」用のボタンを動的に配置する関数
        function parseMarkdownAndInjectButtons(markdownText, originalQuery) {
            // 基本的なマークダウンルールをHTMLに変換
            let html = markdownText
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                // 見出し
                .replace(/^# (.*?)$/gm, '<h2 style="font-size:1.6rem; color:var(--primary-dark); margin-top:32px; border-bottom:2px solid var(--primary-light); padding-bottom:8px;">$1</h2>')
                .replace(/^## (.*?)$/gm, '<h3 style="font-size:1.25rem; color:var(--success-dark); margin-top:24px;">$1</h3>')
                .replace(/^### (.*?)$/gm, '<h4 style="font-size:1.15rem; color:var(--text-primary); margin-top:20px; display:flex; align-items:center; gap:8px;">$1</h4>')
                // リスト項目
                .replace(/^\*\s+(.*?)$/gm, '<li style="margin-left:20px; margin-bottom:6px;">$1</li>')
                .replace(/^\-\s+(.*?)$/gm, '<li style="margin-left:20px; margin-bottom:6px;">$1</li>')
                // 太字
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                // 段落と改行
                .replace(/\n/g, '<br>');

            // 強制的に箇条書きを <ul> で囲む
            html = html.replace(/(<li.*?>.*?<\/li>)/gs, '<ul>$1</ul>');
            
            // 区切り線
            html = html.replace(/<br>---<br>/g, '<hr style="border:0; border-top:1px solid var(--border-light); margin:32px 0;">');

            // 企画案ブロックを探し、台本連携ボタンを動的にインジェクションする
            // 💡 企画案1: [タイトル]
            // のようなヘッダーをパースして、データとして抜き出す
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;

            const headers = tempDiv.querySelectorAll('h4');
            headers.forEach((h, index) => {
                if (h.textContent.includes('企画案')) {
                    // 次の h4 か hr が現れるまでのテキストをパースして企画データを抽出
                    let title = h.textContent.replace(/💡\s*企画案\d+\s*:\s*/, '').trim();
                    
                    // 検索用のユニークなデータ属性を設定
                    const planId = `plan-data-${index}`;
                    h.setAttribute('id', planId);

                    // ボタンの作成
                    const btnContainer = document.createElement('div');
                    btnContainer.style.marginTop = '16px';
                    btnContainer.style.marginBottom = '24px';
                    btnContainer.style.background = 'rgba(28, 126, 214, 0.05)';
                    btnContainer.style.padding = '16px';
                    btnContainer.style.borderRadius = '8px';
                    btnContainer.style.border = '1px dashed var(--primary)';
                    btnContainer.style.textAlign = 'left';

                    btnContainer.innerHTML = `
                        <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px; font-weight: normal;">
                            ✨ この企画をもとに、自動で項目をセットしてYouTube台本作成を開始できます。
                        </p>
                        <button class="btn-primary" style="font-size: 0.9rem; padding: 8px 16px; display: inline-flex; align-items: center; gap: 6px;" 
                                onclick="createScriptFromPlan('${encodeURIComponent(title)}', '${planId}', '${encodeURIComponent(originalQuery)}')">
                            <i class="ph ph-notebook"></i> この企画で台本を作成する
                        </button>
                    `;
                    
                    // タイトル見出しの直後にボタンを挿入
                    h.parentNode.insertBefore(btnContainer, h.nextSibling);
                }
            });

            return tempDiv.innerHTML;
        }

        // 企画案から台本を自動作成し、台本画面に遷移する処理
        window.createScriptFromPlan = async (encodedTitle, planId, encodedQuery) => {
            const title = decodeURIComponent(encodedTitle);
            const query = decodeURIComponent(encodedQuery);
            const headerEl = document.getElementById(planId);
            
            if (!headerEl) return;

            // 企画内容テキストの収集 (次の見出しまたは区切り線までの内容)
            let sibling = headerEl.nextSibling;
            let planText = '';
            let targetGroup = '';
            let opText = '';
            let bodyText = '';
            let edText = '';
            let reasonText = '';

            // 兄弟要素を走査して各セクションのテキストを抽出
            while (sibling) {
                if (sibling.nodeName === 'H4' || sibling.nodeName === 'HR' || sibling.nodeName === 'H2') {
                    break; // 次の企画案または区切り線が来たら終了
                }

                const text = sibling.textContent || '';
                
                // セクションごとにテキストを分類
                if (text.includes('ターゲット層')) {
                    targetGroup = text.replace(/ターゲット層\s*:\s*/, '').trim();
                } else if (text.includes('サムネイルイメージ')) {
                    targetGroup += '\n【サムネイル案】\n' + text.replace(/サムネイルイメージ\s*:\s*/, '').trim();
                } else if (text.includes('この企画にした理由')) {
                    reasonText = text.replace(/この企画にした理由（背景）\s*:\s*/, '').trim();
                } else if (text.includes('導入(OP)')) {
                    opText = text.replace(/導入\(OP\)\s*:\s*/, '').trim();
                } else if (text.includes('本編(Body)')) {
                    bodyText = text.replace(/本編\(Body\)\s*:\s*/, '').trim();
                } else if (text.includes('結び(ED)')) {
                    edText = text.replace(/結び\(ED\)\s*:\s*/, '').trim();
                }

                sibling = sibling.nextSibling;
            }

            if (!confirm(`「${title}」の企画で新しく台本を作成し、編集画面に移動しますか？`)) {
                return;
            }

            try {
                // 台本の初期データを構成
                const fields = {
                    f1: title, // 1. 動画タイトル
                    f2: `キーワード: ${query}\nターゲット層: ${targetGroup}`, // 2. キーワード
                    f3: `【AI提案の導入案】\n${opText}`, // 3. OP
                    f6: `【AI提案の本編案】\n${bodyText}`, // 6. 具体例 (本編として使用)
                    f22: `【AI提案の結び案】\n${edText}`, // 22. ED
                    memo: `【この企画を選定した理由】\n${reasonText}` // メモ欄に背景を保存
                };

                const data = {
                    title: title,
                    fields: fields,
                    updatedAt: new Date().toISOString()
                };

                // DB (Supabase) に追加
                const newId = await Store.addYTScript(data);

                alert('台本を作成しました！編集画面に移動します。');
                
                // YouTube管理画面の「台本作成」タブかつ、新規追加したIDの台本をロードして遷移
                App.navigate('youtube', newId);

            } catch (err) {
                console.error(err);
                alert('台本の自動作成に失敗しました: ' + err.message);
            }
        };
    });
};
