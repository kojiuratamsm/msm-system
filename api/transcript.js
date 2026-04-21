
const fetch = require('node-fetch');

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
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        // Fetch video page to find caption tracks
        const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
        const html = await response.text();

        // Regex to find ytInitialPlayerResponse which contains caption info
        const regex = /ytInitialPlayerResponse\s*=\s*({.+?});/;
        const match = html.match(regex);

        if (!match) {
            return res.status(404).json({ error: 'Could not find caption data. Is the video public?' });
        }

        const playerResponse = JSON.parse(match[1]);
        const captionTracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;

        if (!captionTracks || captionTracks.length === 0) {
            return res.status(404).json({ error: 'This video has no captions enabled.' });
        }

        // Prefer Japanese, then default to the first one
        let track = captionTracks.find(t => t.languageCode === 'ja') || captionTracks[0];
        const captionRes = await fetch(track.baseUrl + '&fmt=json3');
        const captionData = await captionRes.json();

        // Concatenate text segments
        const fullText = captionData.events
            .map(event => event.segs?.map(s => s.utf8).join('') || '')
            .join(' ')
            .replace(/\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!fullText) {
            return res.status(404).json({ error: 'Caption text is empty.' });
        }

        res.status(200).json({ 
            title: playerResponse.videoDetails.title,
            text: fullText 
        });

    } catch (error) {
        console.error('Transcript error:', error);
        res.status(500).json({ error: 'Failed to fetch transcript: ' + error.message });
    }
};
