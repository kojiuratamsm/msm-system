async function testScraping(query) {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=CAASAhAB`;
    const response = await fetch(searchUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
            'Accept-Language': 'ja-JP,ja;q=0.9'
        }
    });
    const html = await response.text();
    const regex = /var ytInitialData\s*=\s*({.+?});<\/script>/s;
    let match = html.match(regex);
    if (!match) match = html.match(/window\["ytInitialData"\]\s*=\s*({.+?});/s);
    if (!match) return console.log("No match");
    const data = JSON.parse(match[1]);
    
    // Find the primary contents path
    console.log(Object.keys(data.contents || {}));
    if (data.contents?.twoColumnSearchResultsRenderer) {
        console.log("twoColumnSearchResultsRenderer found!");
        const contents = data.contents.twoColumnSearchResultsRenderer.primaryContents?.sectionListRenderer?.contents;
        console.log("contents length:", contents?.length);
        if (contents?.length > 0) {
            const itemSection = contents[0].itemSectionRenderer?.contents || [];
            console.log("videos count:", itemSection.filter(i => i.videoRenderer).length);
            const first = itemSection.find(i => i.videoRenderer)?.videoRenderer;
            if (first) {
                console.log("First title:", first.title?.runs?.[0]?.text);
            }
        }
    }
}
testScraping('店舗集客');
