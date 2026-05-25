const express = require('express');
const router = express.Router();

// --- CDSC IPO Proxy Routes ---
router.get('/companies', async (req, res) => {
    try {
        const response = await fetch('https://iporesult.cdsc.com.np/result/company/list', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Origin': 'https://iporesult.cdsc.com.np',
                'Referer': 'https://iporesult.cdsc.com.np/'
            }
        });
        if (!response.ok) {
            throw new Error(`CDSC returned status ${response.status}`);
        }
        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('CDSC Company List Error:', err);
        res.status(500).json({ error: 'Failed to fetch companies from CDSC: ' + err.message });
    }
});

router.post('/check', async (req, res) => {
    const { companyShareId, boid } = req.body;
    if (!companyShareId || !boid) {
        return res.status(400).json({ error: 'companyShareId and boid are required' });
    }
    try {
        const response = await fetch('https://iporesult.cdsc.com.np/result/company/check-result', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Origin': 'https://iporesult.cdsc.com.np',
                'Referer': 'https://iporesult.cdsc.com.np/'
            },
            body: JSON.stringify({ companyShareId, boid })
        });
        if (!response.ok) {
            throw new Error(`CDSC returned status ${response.status}`);
        }
        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('CDSC Result Check Error:', err);
        res.status(500).json({ error: 'Failed to check IPO result: ' + err.message });
    }
});

module.exports = router;
