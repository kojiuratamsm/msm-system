App.Pages.sales_leads = async function() {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') {
        App.mount('<div class="card" style="margin-top:24px; padding: 40px; text-align:center;"><h3 class="card-title">アクセス権限がありません</h3><p style="color:var(--text-secondary); margin-top: 16px;">MEO営業リスト作成は管理者のみ閲覧可能です。</p></div>');
        return;
    }

    const html = `
        <!-- API設定カード -->
        <div class="card" style="margin-bottom: 24px; padding: 24px; background: var(--bg-secondary);">
            <div style="border-bottom: 1px solid var(--border-light); padding-bottom: 16px; margin-bottom: 24px;">
                <h3 style="font-size: 1.2rem; margin: 0; color: var(--primary-dark);"><i class="ph ph-gear"></i> API・スプレッドシート連携設定</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 8px;">
                    Google Places APIキーと、スプレッドシート書き込み用GAS (Google Apps Script) のWebアプリURLを保存してください。<br>
                    ※キー情報はブラウザのローカルストレージに安全に保管されます。
                </p>
            </div>
            <div class="grid grid-2" style="gap: 16px; max-width: 800px; margin-bottom: 16px;">
                <div class="form-group">
                    <label>Google Places API キー (AIza...)</label>
                    <input type="password" id="places-api-key" class="input-field" placeholder="AIzaSy..." value="">
                </div>
                <div class="form-group">
                    <label>GAS ウェブアプリ URL</label>
                    <input type="text" id="gas-web-app-url" class="input-field" placeholder="https://script.google.com/macros/s/.../exec" value="">
                </div>
            </div>
            <div>
                <button class="btn-primary" onclick="saveSalesApiKeys()"><i class="ph ph-floppy-disk"></i> 設定を保存する</button>
            </div>
        </div>

        <!-- 営業リスト生成フォーム -->
        <div class="card" style="padding: 24px; margin-bottom: 24px;">
            <div style="border-bottom: 1px solid var(--border-light); padding-bottom: 16px; margin-bottom: 24px;">
                <h3 style="font-size: 1.2rem; margin: 0; color: var(--primary-dark);"><i class="ph ph-address-book"></i> MEO営業リスト自動生成</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 8px;">
                    対象の都道府県やエリア名と、抽出したい業種を指定して「営業リストを作成する」を実行します。<br>
                    Googleマップで「上位3件（ローカルパック）」に入っていない、MEO対策が必要な店舗のみを自動抽出し、指定のスプレッドシートへ追記します。
                </p>
            </div>

            <div class="grid grid-3" style="gap: 20px; max-width: 900px; margin-bottom: 24px;">
                <div class="form-group">
                    <label>対象エリア（都道府県・市区町村）</label>
                    <input type="text" id="sales-area" class="input-field" placeholder="例: 東京都新宿区" value="">
                </div>
                <div class="form-group">
                    <label>ターゲット業種</label>
                    <select id="sales-industry" class="input-field">
                        <option value="美容室">美容室・ヘアサロン</option>
                        <option value="ネイル">ネイルサロン</option>
                        <option value="カフェ">カフェ</option>
                        <option value="イタリアン">イタリアン</option>
                        <option value="整体">整体・マッサージ</option>
                        <option value="アミューズメントカジノ">アミューズメントカジノ</option>
                        <option value="美容クリニック">美容クリニック</option>
                        <option value="歯医者">歯医者・歯科</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>最大抽出件数</label>
                    <select id="sales-limit" class="input-field">
                        <option value="10">10件</option>
                        <option value="30">30件</option>
                        <option value="50">50件</option>
                        <option value="100" selected>100件 (おすすめ)</option>
                    </select>
                </div>
            </div>

            <div style="margin-top: 24px;">
                <button id="btn-generate-leads" class="btn-primary" style="font-size: 1.1rem; padding: 12px 32px; display: inline-flex; justify-content: center; align-items: center; gap: 8px; width: 100%; max-width: 350px;" onclick="runGenerateLeads()">
                    <i class="ph ph-address-book"></i> 営業リストを生成してスプレッドシートへ追記
                </button>
            </div>

            <!-- 進捗ログ表示 -->
            <div id="sales-progress" style="display: none; margin-top: 32px; padding: 20px; background: #1a1a1a; border-radius: 8px; border: 1px solid #333; text-align: left;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; color:#4dabf7; font-weight:bold;">
                    <i class="ph ph-spinner ph-spin" style="font-size: 1.2rem;"></i>
                    <span id="sales-progress-status">営業リストを自動生成しています...</span>
                </div>
                <div id="sales-log-area" style="font-family: monospace; font-size: 0.85rem; color: #a9e34b; height: 250px; overflow-y: auto; white-space: pre-wrap; line-height: 1.5; padding: 10px; background: #000; border-radius: 4px;">
                </div>
            </div>
        </div>

        <!-- GAS導入手順書カード -->
        <div class="card" style="padding: 24px; background: rgba(73, 80, 87, 0.05); border: 1px dashed var(--border-light);">
            <h4 style="margin: 0 0 12px 0; color: var(--text-primary); font-size: 1.05rem;"><i class="ph ph-info"></i> スプレッドシートへの自動書き込み（GAS）初期設定手順</h4>
            <div style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6;">
                <ol style="margin-left: 20px; padding-left: 0;">
                    <li style="margin-bottom: 8px;">書き込みたい <b>Googleスプレッドシート</b> を開きます。</li>
                    <li style="margin-bottom: 8px;">上部メニューの <b>「拡張機能」 ＞ 「Apps Script」</b> をクリックします。</li>
                    <li style="margin-bottom: 8px;">開いたエディタ内の既存コードをすべて消去し、以下のスクリプトを貼り付けます。</li>
                </ol>
                <pre style="background: #2b2b2b; color: #fff; padding: 12px; border-radius: 6px; overflow-x: auto; font-family: monospace; font-size: 0.8rem; margin: 12px 0;">
function doPost(e) {
  var json = JSON.parse(e.postData.contents);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  // シートが空の場合、ヘッダー行を追加します
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["店舗名", "住所", "電話番号", "Instagram URL", "ホームページ", "取得日"]);
  }
  
  // データを追記します
  for (var i = 0; i < json.leads.length; i++) {
    var lead = json.leads[i];
    sheet.appendRow([
      lead.name,
      lead.address,
      "'" + lead.phone, // 電話番号の先頭ゼロ落ち防止
      lead.instagram,
      lead.website,
      lead.date
    ]);
  }
  
  return ContentService.createTextOutput(JSON.stringify({status: "success"}))
    .setMimeType(ContentService.MimeType.JSON);
}</pre>
                <ol start="4" style="margin-left: 20px; padding-left: 0;">
                    <li style="margin-bottom: 8px;">右上にある <b>「デプロイ」ボタン ＞ 「新しいデプロイ」</b> をクリックします。</li>
                    <li style="margin-bottom: 8px;">種類の選択で「ウェブアプリ」を選び、<b>【アクセスできるユーザー】を「全員」</b>に設定してデプロイを実行します。</li>
                    <li style="margin-bottom: 8px;">発行された <b>「ウェブアプリのURL」</b> をコピーし、上の「GASウェブアプリURL」欄に貼り付けて保存してください。</li>
                </ol>
            </div>
        </div>
    `;

    App.mount(html, () => {
        // API設定の読み込み
        const savedPlacesKey = localStorage.getItem('places_api_key');
        const savedGasUrl = localStorage.getItem('gas_web_app_url');
        if (savedPlacesKey) document.getElementById('places-api-key').value = savedPlacesKey;
        if (savedGasUrl) document.getElementById('gas-web-app-url').value = savedGasUrl;

        window.saveSalesApiKeys = () => {
            const pKey = document.getElementById('places-api-key').value.trim();
            const gUrl = document.getElementById('gas-web-app-url').value.trim();
            if (!pKey || !gUrl) {
                alert('Places APIキーとGASウェブアプリURLの両方を入力してください。');
                return;
            }
            localStorage.setItem('places_api_key', pKey);
            localStorage.setItem('gas_web_app_url', gUrl);
            alert('APIおよびスプレッドシート連携設定を保存しました！');
        };

        window.runGenerateLeads = async () => {
            const placesKey = localStorage.getItem('places_api_key');
            const gasUrl = localStorage.getItem('gas_web_app_url');
            if (!placesKey || !gasUrl) {
                alert('先にAPI・スプレッドシート連携設定でキーとURLを保存してください。');
                return;
            }

            const area = document.getElementById('sales-area').value.trim();
            const industry = document.getElementById('sales-industry').value;
            const limit = document.getElementById('sales-limit').value;

            if (!area) {
                alert('対象エリア（例: 東京都新宿区）を入力してください。');
                return;
            }

            const btn = document.getElementById('btn-generate-leads');
            const progress = document.getElementById('sales-progress');
            const progressStatus = document.getElementById('sales-progress-status');
            const logArea = document.getElementById('sales-log-area');

            btn.disabled = true;
            btn.style.opacity = '0.5';
            progress.style.display = 'block';
            logArea.textContent = '';
            
            const addLog = (msg) => {
                const now = new Date().toLocaleTimeString();
                logArea.textContent += `[${now}] ${msg}\n`;
                logArea.scrollTop = logArea.scrollHeight;
            };

            addLog(`処理を開始しました。 (ターゲットエリア: ${area} / 業種: ${industry} / 最大件数: ${limit}件)`);
            progressStatus.textContent = 'Googleマップからデータを収集中...';

            try {
                // サーバーサイドAPIへリクエスト送信
                const response = await fetch('/api/generate_leads', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        area,
                        industry,
                        limit: parseInt(limit),
                        placesApiKey: placesKey,
                        gasWebAppUrl: gasUrl
                    })
                });

                const responseText = await response.text();
                let data;
                try {
                    data = JSON.parse(responseText);
                } catch (jsonErr) {
                    console.error("Non-JSON response:", responseText);
                    // HTMLエラーページからタイトルなどを抽出してわかりやすくする
                    const titleMatch = responseText.match(/<title>(.*?)<\/title>/i);
                    const errorTitle = titleMatch ? titleMatch[1] : '不明なエラー';
                    throw new Error(`サーバーから不正な応答がありました (ステータス: ${response.status} ${response.statusText} / 内容: ${errorTitle})。ファイルが正しくアップロードされているか、サーバーが再起動されているか確認してください。`);
                }

                if (!response.ok) {
                    throw new Error(data.error || 'リストの作成に失敗しました。');
                }
                
                // ログを一括出力
                if (data.logs && data.logs.length > 0) {
                    data.logs.forEach(logMsg => {
                        logArea.textContent += `${logMsg}\n`;
                    });
                }
                
                logArea.scrollTop = logArea.scrollHeight;

                if (data.success) {
                    progressStatus.textContent = '完了しました！';
                    addLog(`🎉 営業リストの作成が完了しました！ ${data.count} 件の店舗をスプレッドシートへ追記しました。`);
                    alert(`営業リストの作成が完了しました！\n${data.count} 件の店舗をスプレッドシートに追記しました。`);
                } else {
                    throw new Error(data.message || '想定外のエラーが発生しました。');
                }

            } catch (error) {
                console.error(error);
                progressStatus.textContent = 'エラーが発生しました';
                addLog(`❌ エラー: ${error.message}`);
                alert('エラーが発生しました: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        };
    });
};
