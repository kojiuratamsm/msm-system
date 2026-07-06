// Global fetch is used directly in Node.js 18+ / Vercel environment

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { query, period } = req.body;
    const authHeader = req.headers.authorization;

    if (!query) {
        return res.status(400).json({ error: '検索キーワードを入力してください。' });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'OpenAIのAPIキーが設定されていません。' });
    }

    const apiKey = authHeader.split(' ')[1];

    // ytInitialData から動画リストを抽出するヘルパー関数
    const extractVideos = (html, isChannelPage = false) => {
        const regex = /ytInitialData\s*=\s*({.+?});/;
        const match = html.match(regex);
        const videos = [];

        if (match) {
            try {
                const data = JSON.parse(match[1]);
                let items = [];

                if (isChannelPage) {
                    // チャンネルページ (動画タブ) の構造
                    const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
                    const videosTab = tabs.find(t => t.tabRenderer?.title === '動画' || t.tabRenderer?.title === 'Videos');
                    if (videosTab) {
                        items = videosTab.tabRenderer.content?.richGridRenderer?.contents?.map(c => c.richItemRenderer?.content) || [];
                    }
                } else {
                    // 検索結果ページの構造
                    const contents = data.contents?.twoColumnSearchResultRenderer?.primaryContents?.sectionListRenderer?.contents || [];
                    if (contents.length > 0) {
                        items = contents[0].itemSectionRenderer?.contents || [];
                    }
                }

                for (const item of items) {
                    if (!item) continue;
                    const video = item.videoRenderer;
                    if (video) {
                        const title = video.title?.runs?.[0]?.text || '';
                        const videoId = video.videoId || '';
                        const viewCount = video.viewCountText?.simpleText || video.shortViewCountText?.simpleText || '';
                        const publishedTime = video.publishedTimeText?.simpleText || '';
                        const description = video.detailedMetadataSnippets?.[0]?.snippetText?.runs?.map(r => r.text).join('') || '';

                        // 厳格な期間フィルタリング
                        let isWithinPeriod = true;
                        
                        // "1 年前" などの場合
                        if (publishedTime.includes('年')) {
                            const yearsAgo = parseInt(publishedTime) || 0;
                            if (period === '6months') {
                                isWithinPeriod = false; // 半年指定なら年単位は除外
                            } else if (period === '1year' && yearsAgo > 1) {
                                isWithinPeriod = false; // 1年指定なら2年以上は除外
                            }
                        }
                        
                        // "ヶ月前" の場合（半年指定時の厳格チェック）
                        if (period === '6months' && publishedTime.includes('ヶ月')) {
                            const monthsAgo = parseInt(publishedTime) || 0;
                            if (monthsAgo > 6) {
                                isWithinPeriod = false;
                            }
                        }

                        // ライブ配信予定などは除外（publishedTimeがない場合など）
                        if (!publishedTime || publishedTime.includes('予定')) {
                            isWithinPeriod = false;
                        }

                        if (isWithinPeriod && title) {
                            videos.push({
                                title,
                                videoId,
                                viewCount,
                                publishedTime,
                                description: description.substring(0, 100)
                            });
                        }
                    }
                }
            } catch (err) {
                console.error('Data extraction error:', err);
            }
        }
        return videos;
    };

    try {
        // 1. YouTubeデータの並列取得 (市場検索結果 ＋ 自社チャンネル最新動画)
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=CAASAhAB`;
        const companyUrl = `https://www.youtube.com/@meo_taisaku/videos`;

        const reqHeaders = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
            'Accept-Language': 'ja-JP,ja;q=0.9'
        };

        const [searchRes, companyRes] = await Promise.all([
            fetch(searchUrl, { headers: reqHeaders }),
            fetch(companyUrl, { headers: reqHeaders })
        ]);

        if (!searchRes.ok || !companyRes.ok) {
            throw new Error('YouTubeデータの取得に一部失敗しました。');
        }

        const [searchHtml, companyHtml] = await Promise.all([
            searchRes.text(),
            companyRes.text()
        ]);

        const marketVideos = extractVideos(searchHtml, false);
        const companyVideos = extractVideos(companyHtml, true);

        // データ整形 (GPTへのインプット用)
        const formatVideos = (list, limit) => {
            if (list.length === 0) return '（データなし）';
            return list.slice(0, limit).map((v, i) => `[${i+1}] タイトル: ${v.title}\n   公開時期: ${v.publishedTime} / 再生数: ${v.viewCount}\n   概要: ${v.description}`).join('\n\n');
        };

        const marketDataText = formatVideos(marketVideos, 15);
        const companyDataText = formatVideos(companyVideos, 10);

        // 2. GPT-4o にトレンド分析と企画提案を依頼
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

## ■ 伸びている動画の共通点と理由
（なぜこれらの動画が伸びているのか、視聴者心理を含めて詳しく解説）

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

【1. 市場のYouTube最新トレンド動画リスト】
${marketDataText}

【2. 自社(MEO対策チャンネル)の直近の投稿リスト】
${companyDataText}
`;

        const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
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
