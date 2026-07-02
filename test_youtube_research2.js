async function testScraping(query) {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=CAASAhAB`;
    const response = await fetch(searchUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
            'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7'
        }
    });
    const html = await response.text();
    const regex = /var ytInitialData\s*=\s*({.+?});/s;
    let match = html.match(regex);
    if (!match) {
        match = html.match(/window\["ytInitialData"\]\s*=\s*({.+?});/s);
    }
    if (!match) {
        console.log("No match found for ytInitialData. First 500 chars of HTML:");
        console.log(html.substring(0, 500));
        return;
    }
    console.log("Match found! Parsing JSON...");
    try {
        const data = JSON.parse(match[1]);
        const contents = data.contents?.twoColumnSearchResultRenderer?.primaryContents?.sectionListRenderer?.contents;
        console.log("Contents length:", contents ? contents.length : 'undefined');
        if (contents && contents.length > 0) {
            const itemSection = contents[0].itemSectionRenderer?.contents || [];
            console.log("Items in section:", itemSection.length);
            
            let count = 0;
            for (const item of itemSection) {
                if (item.videoRenderer) {
                    count++;
                    const video = item.videoRenderer;
                    const title = video.title?.runs?.[0]?.text || '';
                    const publishedTime = video.publishedTimeText?.simpleText || '';
                    if (count <= 3) {
                        console.log(`Video: ${title} (${publishedTime})`);
                    }
                }
            }
            console.log("Total videoRenderers found:", count);
        }
    } catch (e) {
        console.error("Parse error:", e);
    }
}
testScraping('店舗集客');
