
async function testScraping(query, period) {
    console.log(`\n=== Testing Query: "${query}", Period: "${period}" ===`);
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=CAASAhAB`;
    const response = await fetch(searchUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
            'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7'
        }
    });

    if (!response.ok) {
        console.error('Fetch failed');
        return;
    }

    const html = await response.text();
    const regex = /ytInitialData\s*=\s*({.+?});/;
    const match = html.match(regex);

    let videoList = [];
    if (match) {
        try {
            const data = JSON.parse(match[1]);
            const contents = data.contents?.twoColumnSearchResultRenderer?.primaryContents?.sectionListRenderer?.contents;
            
            if (contents && contents.length > 0) {
                const itemSection = contents[0].itemSectionRenderer?.contents || [];
                for (const item of itemSection) {
                    if (item.videoRenderer) {
                        const video = item.videoRenderer;
                        const title = video.title?.runs?.[0]?.text || '';
                        const publishedTime = video.publishedTimeText?.simpleText || '';
                        
                        let isWithinPeriod = true;
                        if (publishedTime.includes('年')) {
                            const yearsAgo = parseInt(publishedTime);
                            if (period === '6months') {
                                isWithinPeriod = false; 
                            } else if (period === '1year' && yearsAgo > 1) {
                                isWithinPeriod = false; 
                            }
                        }

                        if (isWithinPeriod && title) {
                            videoList.push({
                                title,
                                publishedTime
                            });
                        }
                    }
                }
            }
        } catch (jsonErr) {
            console.error('JSON parse error:', jsonErr);
        }
    }

    console.log(`Found ${videoList.length} videos matching the criteria.`);
    videoList.slice(0, 5).forEach((v, i) => {
        console.log(`[${i+1}] Title: ${v.title} | Published: ${v.publishedTime}`);
    });
}

(async () => {
    await testScraping('店舗集客', '1year');
    await testScraping('インフルエンサー活用', '6months');
})();
