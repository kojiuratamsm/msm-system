// Global fetch is used directly in Node.js 18+ / Vercel environment

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { area, industry, limit, placesApiKey, gasWebAppUrl } = req.body;
    const logs = [];

    const addLog = (msg) => {
        const now = new Date().toLocaleTimeString();
        logs.push(`[${now}] ${msg}`);
        console.log(`[Leads Generator] ${msg}`);
    };

    if (!area || !industry || !placesApiKey || !gasWebAppUrl) {
        return res.status(400).json({ error: 'すべてのパラメータを入力してください。' });
    }

    try {
        addLog(`Googleマップ検索の準備中... (検索クエリ: "${area} ${industry}")`);
        
        let allPlaces = [];
        let nextPageToken = '';
        const targetCount = limit || 50;

        // 最大件数を取得するために必要に応じてページネーションを行う（Places API New の仕様）
        // 1回で最大20件返るため、上限件数に達するまで最大5回ループ
        const maxLoops = Math.min(Math.ceil(targetCount / 20), 5); 

        for (let i = 0; i < maxLoops; i++) {
            addLog(`Google Places API 検索リクエスト実行中 (ページ ${i + 1})...`);
            
            const reqBody = {
                textQuery: `${area} ${industry}`,
                languageCode: 'ja'
            };
            if (nextPageToken) {
                reqBody.pageToken = nextPageToken;
            }

            // Places API (New) の searchText へのリクエスト
            // コスト削減のために必要なフィールドのみをFieldMaskで要求します
            const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': placesApiKey,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,nextPageToken'
                },
                body: JSON.stringify(reqBody)
            });

            if (!response.ok) {
                const errText = await response.text();
                addLog(`Places API エラー: ${errText}`);
                throw new Error(`Google Places APIの呼び出しに失敗しました。キーの権限を確認してください。`);
            }

            const data = await response.json();
            const places = data.places || [];
            
            allPlaces = allPlaces.concat(places);
            addLog(`${places.length} 件の店舗情報を取得しました。`);

            nextPageToken = data.nextPageToken;
            if (!nextPageToken || allPlaces.length >= targetCount) {
                break;
            }

            // API制限・クオータ防止のためにわずかにウェイト
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        addLog(`データ取得完了。合計 ${allPlaces.length} 件の候補が見つかりました。`);

        if (allPlaces.length === 0) {
            return res.status(200).json({ success: true, count: 0, logs, message: '店舗が見つかりませんでした。' });
        }

        // MEO順位の判定（上位3件の除外）
        // Googleマップ検索結果の上位3位は「すでに上位表示されている」ため除外する
        addLog(`【MEO順位チェック】上位表示されている上位3枠（検索結果1〜3位）の店舗を除外します...`);
        const eligiblePlaces = allPlaces.slice(3); // 4位以下の店舗を抽出
        addLog(`上位除外後の営業対象店舗数: ${eligiblePlaces.length} 件`);

        if (eligiblePlaces.length === 0) {
            return res.status(200).json({ success: true, count: 0, logs, message: '上位3件を除外した結果、対象店舗がありませんでした。' });
        }

        // ホームページからのInstagramリンク抽出＆店舗データの整形
        const leads = [];
        addLog(`各店舗のInstagramアカウントの自動探索を開始します (店舗サイトの巡回)...`);

        for (let i = 0; i < eligiblePlaces.length; i++) {
            const place = eligiblePlaces[i];
            const name = place.displayName?.text || '名称不明';
            const address = place.formattedAddress || '住所情報なし';
            const phone = place.nationalPhoneNumber || '電話番号なし';
            const website = place.websiteUri || '';
            let instagram = '未検出';

            if (website) {
                addLog(`[${i + 1}/${eligiblePlaces.length}] ホームページ解析中: ${name} (${website})`);
                try {
                    // タイムアウト付きのフェッチ（3秒で打ち切り、スタックを防ぐ）
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3000);

                    const webRes = await fetch(website, {
                        signal: controller.signal,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
                        }
                    });
                    
                    clearTimeout(timeoutId);

                    if (webRes.ok) {
                        const html = await webRes.text();
                        // InstagramアカウントのURLを抽出する正規表現
                        const instaMatch = html.match(/href="https?:\/\/(www\.)?instagram\.com\/([a-zA-Z0-9_\-\.]+)\/?"/i);
                        if (instaMatch && instaMatch[2]) {
                            instagram = `https://www.instagram.com/${instaMatch[2]}`;
                            addLog(`   👉 Instagramアカウントを検出: ${instagram}`);
                        }
                    }
                } catch (webErr) {
                    // フェッチ失敗時（タイムアウト、SSLエラー等）は無視して次に進む
                    console.error(`Web Fetch Error for ${name}:`, webErr.message);
                }
            } else {
                addLog(`[${i + 1}/${eligiblePlaces.length}] ホームページなし: ${name}`);
            }

            leads.push({
                name,
                address,
                phone,
                website: website || 'なし',
                instagram,
                date: new Date().toLocaleDateString('ja-JP')
            });

            // 収集制限数に達したら終了
            if (leads.length >= targetCount) {
                break;
            }
        }

        // 4. スプレッドシート（GAS Web App）へのデータ転送
        addLog(`スプレッドシートへの追記リクエストを送信中...`);
        const gasRes = await fetch(gasWebAppUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ leads })
        });

        if (!gasRes.ok) {
            const gasErr = await gasRes.text();
            addLog(`スプレッドシート送信エラー: ${gasErr}`);
            throw new Error('GASウェブアプリへの書き込みに失敗しました。URLとデプロイのアクセス設定を確認してください。');
        }

        const gasData = await gasRes.json();
        if (gasData.status === 'success') {
            addLog(`スプレッドシートへの追記が正常に完了しました！`);
            return res.status(200).json({
                success: true,
                count: leads.length,
                logs
            });
        } else {
            throw new Error(gasData.message || 'GASアプリ側でエラーが発生しました。');
        }

    } catch (error) {
        addLog(`エラー発生: ${error.message}`);
        res.status(500).json({ error: error.message || 'サーバー処理中にエラーが発生しました。', logs });
    }
};
