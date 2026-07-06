// Global fetch is used directly in Node.js 18+ / Vercel environment

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-YouTube-API-Key');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { query, period } = req.body;
    const authHeader = req.headers.authorization;
    const ytApiKey = req.headers['x-youtube-api-key'];

    if (!query) {
        return res.status(400).json({ error: '検索キーワードを入力してください。' });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'OpenAIのAPIキーが設定されていません。' });
    }

    if (!ytApiKey) {
        return res.status(401).json({ error: 'YouTube Data APIキーが設定されていません。' });
    }

    const openaiKey = authHeader.split(' ')[1];

    try {
        // 対象期間の計算 (RFC 3339 formatted date-time value)
        const date = new Date();
        if (period === '6months') {
            date.setMonth(date.getMonth() - 6);
        } else {
            date.setFullYear(date.getFullYear() - 1);
        }
        const publishedAfter = date.toISOString();

        // 1. YouTube Data API で市場検索 (50件取得して、そこから異なる15チャンネルを抽出)
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=50&q=${encodeURIComponent(query)}&type=video&publishedAfter=${publishedAfter}&order=viewCount&key=${ytApiKey}`;
        const searchRes = await fetch(searchUrl);

        if (!searchRes.ok) {
            const errBody = await searchRes.text();
            console.error('YouTube API Error (Market):', errBody);
            throw new Error('YouTube Data APIでの検索に失敗しました。APIキーやクオータ(制限)を確認してください。');
        }

        const searchData = await searchRes.json();
        
        // チャンネルごとの動画を1つずつ集め、最低15チャンネルの多様なデータを確保する
        const uniqueChannels = new Set();
        const marketVideos = [];

        for (const item of searchData.items || []) {
            const snippet = item.snippet;
            if (!snippet) continue;
            
            const channelId = snippet.channelId;
            // 同じチャンネルからの動画は最大2つまでに制限して多様性を持たせる等の工夫も可能だが、
            // 今回は「15チャンネル以上の情報を集める」ため、まずはユニークチャンネルを優先
            if (!uniqueChannels.has(channelId)) {
                uniqueChannels.add(channelId);
                marketVideos.push({
                    title: snippet.title,
                    videoId: item.id.videoId,
                    channelName: snippet.channelTitle,
                    publishedAt: snippet.publishedAt,
                    description: snippet.description.substring(0, 150)
                });
            } else if (marketVideos.length < 15) {
                // 15チャンネルに満たない場合は、同一チャンネルの別動画も許容して件数を稼ぐ
                 marketVideos.push({
                    title: snippet.title,
                    videoId: item.id.videoId,
                    channelName: snippet.channelTitle,
                    publishedAt: snippet.publishedAt,
                    description: snippet.description.substring(0, 150)
                });
            }
            if (marketVideos.length >= 25) break; // GPTのトークン節約のため最大25件
        }

        if (marketVideos.length === 0) {
            throw new Error('指定された期間・キーワードでYouTube動画が見つかりませんでした。');
        }

        // 2. 自社チャンネル(MEO対策チャンネル)の最新動画を取得
        // まず自社チャンネルを検索して特定する (MEO対策チャンネル)
        const companySearchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=10&q=${encodeURIComponent('MEO対策チャンネル')}&type=video&order=date&key=${ytApiKey}`;
        const companyRes = await fetch(companySearchUrl);
        let companyVideos = [];

        if (companyRes.ok) {
            const companyData = await companyRes.json();
            for (const item of companyData.items || []) {
                const snippet = item.snippet;
                if (!snippet) continue;
                companyVideos.push({
                    title: snippet.title,
                    videoId: item.id.videoId,
                    channelName: snippet.channelTitle, // MEO対策チャンネルのはず
                    publishedAt: snippet.publishedAt,
                    description: snippet.description.substring(0, 150)
                });
            }
        }

        // 3. データ整形 (GPTへのインプット用)
        const formatVideos = (list) => {
            if (list.length === 0) return '（データなし）';
            return list.map((v, i) => `[${i+1}] チャンネル: ${v.channelName}\n    タイトル: ${v.title}\n    URL: https://youtu.be/${v.videoId}\n    公開日: ${v.publishedAt}\n    概要: ${v.description}`).join('\n\n');
        };

        const marketDataText = formatVideos(marketVideos);
        const companyDataText = formatVideos(companyVideos);

        // 4. GPT-4o にトレンド分析と企画提案を依頼
        const systemPrompt = `
あなたは「MEO対策チャンネル (https://www.youtube.com/@meo_taisaku)」の専属YouTubeプランナーであり、超優秀なAI社員です。
ユーザーから提供されたYouTubeの「市場の検索結果（最新の投稿トレンド）」と、「自社(MEO対策チャンネル)の直近の投稿データ」を基に、以下のタスクを処理してください。

【タスク】
1. **直近半年〜1年のトレンド分析**: 市場の検索結果から、どのようなテーマやキーワード、動画スタイルが伸びているか分析してください。
2. **伸びている理由の考察**: 市場の視聴者心理や背景を論理的に分析してください。
3. **新規企画案の提案（3つ）**: 
   - 分析したヒット傾向を踏まえつつ、**「自社の既存動画(MEO対策チャンネル)と内容が被らず、かつ自社のターゲット層（店舗経営者など）に刺さる独自性のある新規企画案」**を3つ作成してください。
   - 競合がやっていることをそのままパクるのではなく、MEO対策チャンネルの専門性や強みを活かした切り口（コンサルタントとしての視点、実践的な手法など）に昇華してください。

【出力フォーマット】
以下の構成で、見やすくマークダウン形式で出力してください。

---

# 【市場リサーチ＆分析結果】
（直近のYouTube検索結果に基づくトレンドの解説、および全体的な動画スタイルの傾向）

## ■ リサーチで参考にした主なチャンネルと動画
（リサーチデータの中から、特に傾向を裏付ける重要な参考動画を3〜5つピックアップし、チャンネル名と動画URLをリストアップしてください）
*   チャンネル名: 動画タイトル (URL)
*   チャンネル名: 動画タイトル (URL)

## ■ 伸びている動画の共通点と根拠
（なぜこれらの動画が伸びているのか、具体的な根拠や視聴者心理を含めて詳しく解説）

---

# 【自社チャンネル(MEO対策)向け 提案企画案3選】
（※自社の過去動画との重複を避け、自社の強みを活かした企画であること）

### 💡 企画案1: [企画タイトルを入力]
*   **ターゲット層**: [この動画が刺さる具体的な対象読者や視聴者層]
*   **サムネイルイメージ**: [クリック率を高めるための構図やキャッチコピー案]
*   **この企画にした理由（背景と独自性）**: [なぜ市場トレンドからこの企画を導き出したのか、および自社チャンネルでやるべき独自性の理由]
*   **動画の構成案**:
    *   **導入(OP)**: [動画の始まり30秒で視聴者を惹きつける切り口]
    *   **本編(Body)**: [伝える主なポイントや解説ステップ]
    *   **結び(ED)**: [チャンネル登録や無料相談・LINE登録などを促す終わり方]

---

### 💡 企画案2: [企画タイトルを入力]
...（企画案1と同様のフォーマット）

---

### 💡 企画案3: [企画タイトルを入力]
...（企画案1と同様のフォーマット）
`;

        const userPrompt = `
【リサーチキーワード】: ${query}
【対象期間】: 直近${period === '6months' ? '半年' : '1年'}

【1. 市場のYouTube最新トレンド動画リスト（${marketVideos.length}件のデータ）】
${marketDataText}

【2. 自社(MEO対策チャンネル)の直近の投稿リスト】
${companyDataText}
`;

        let gptRes;
        try {
            gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${openaiKey}`
                },
                body: JSON.stringify({
                    model: "gpt-4o",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userPrompt }
                    ],
                    temperature: 0.7
                })
            });
        } catch (openaiError) {
            console.error('OpenAI Fetch Error:', openaiError);
            throw new Error('OpenAI APIへの接続に失敗しました。時間をおいて再試行してください。');
        }

        if (!gptRes.ok) {
            const err = await gptRes.json();
            throw new Error(err.error?.message || 'GPT-4 APIの呼び出しに失敗しました。');
        }

        const gptData = await gptRes.json();
        const report = gptData.choices[0].message.content;

        res.status(200).json({
            success: true,
            report,
            videoCount: marketVideos.length
        });

    } catch (error) {
        console.error('AI Planner Error:', error);
        res.status(500).json({ error: error.message || 'サーバー処理中にエラーが発生しました。' });
    }
};
