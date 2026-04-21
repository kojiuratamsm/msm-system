
module.exports = async (req, res) => {
    const { videoUrl } = req.query;

    if (!videoUrl) {
        return res.status(400).json({ error: 'videoUrl is required' });
    }

    try {
        let videoId = '';
        if (videoUrl.includes('v=')) {
            videoId = videoUrl.split('v=')[1].split('&')[0];
        } else if (videoUrl.includes('youtu.be/')) {
            videoId = videoUrl.split('youtu.be/')[1].split('?')[0];
        } else if (videoUrl.includes('shorts/')) {
            videoId = videoUrl.split('shorts/')[1].split('?')[0];
        } else {
            return res.status(400).json({ error: 'YouTubeのURL形式が正しくありません。' });
        }

        // Fetch video page with standard User-Agent to avoid simplified responses
        const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });
        const html = await response.text();

        // extract ytInitialPlayerResponse
        const regex = /ytInitialPlayerResponse\s*=\s*({.+?});/;
        const match = html.match(regex);

        if (!match) {
            return res.status(404).json({ error: '動画データが見つかりませんでした。非公開動画や削除された動画の可能性があります。' });
        }

        const playerResponse = JSON.parse(match[1]);
        const captions = playerResponse.captions;

        if (!captions) {
            return res.status(404).json({ error: 'この動画には字幕（文字起こし）データが設定されていません。YouTuberが字幕を許可していないか、自動字幕がまだ生成されていません。' });
        }

        const captionTracks = captions.playerCaptionsTracklistRenderer?.captionTracks;
        if (!captionTracks || captionTracks.length === 0) {
            return res.status(404).json({ error: 'この動画には取得可能な字幕トラックがありません。' });
        }

        // Prefer Japanese, then English, then fallback
        let track = captionTracks.find(t => t.languageCode === 'ja') 
                 || captionTracks.find(t => t.languageCode === 'en')
                 || captionTracks[0];

        const captionRes = await fetch(track.baseUrl + '&fmt=json3', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
            }
        });
        
        if (!captionRes.ok) {
            return res.status(500).json({ error: '字幕データの取得中にエラーが発生しました。' });
        }

        const captionData = await captionRes.json();

        // Concatenate text segments
        const fullText = captionData.events
            .map(event => event.segs?.map(s => s.utf8).join('') || '')
            .join(' ')
            .replace(/\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!fullText) {
            return res.status(404).json({ error: '字幕テキストが空でした。' });
        }

        res.status(200).json({ 
            title: playerResponse.videoDetails.title,
            text: fullText 
        });

    } catch (error) {
        console.error('Transcript error:', error);
        res.status(500).json({ error: 'サーバー処理中にエラーが発生しました。' });
    }
};
