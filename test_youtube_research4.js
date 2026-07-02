async function testScraping(query, period) {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=CAASAhAB`;
    const response = await fetch(searchUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
            'Accept-Language': 'ja-JP,ja;q=0.9'
        }
    });
    const html = await response.text();
    const regex = /ytInitialData\s*=\s*({.+?});/;
    let match = html.match(regex);
    if (!match) match = html.match(/window\["ytInitialData"\]\s*=\s*({.+?});/s);
    if (!match) return console.log("No match");
    const data = JSON.parse(match[1]);
    
    let videoList = [];
    const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
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
                    videoList.push({ title, publishedTime });
                }
            }
        }
    }
    console.log(`Period: ${period} -> Found ${videoList.length} videos`);
    videoList.slice(0, 3).forEach((v, i) => {
        console.log(`[${i+1}] Title: ${v.title} | Published: ${v.publishedTime}`);
    });
}
(async () => {
    await testScraping('店舗集客', '1year');
    await testScraping('インフルエンサー活用', '6months');
})();
