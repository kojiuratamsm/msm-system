module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const clientId = '2007953797';
        const clientSecret = 'e37838b88a6c7ef0c0bf3176171da27d';

        // 1. Get access token
        const tokenRes = await fetch('https://api.line.me/v2/oauth/accessToken', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`
        });
        const tokenData = await tokenRes.json();
        const token = tokenData.access_token;
        
        if (!token) throw new Error('Failed to retrieve token');

        // 2. Fetch yesterday's stats
        const offset = new Date().getTimezoneOffset() * 60000;
        const now = new Date(Date.now() - offset);
        now.setDate(now.getDate() - 1); 
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');

        const insightRes = await fetch(`https://api.line.me/v2/bot/insight/followers?date=${dateStr}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const insightData = await insightRes.json();

        res.status(200).json(insightData);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
};
