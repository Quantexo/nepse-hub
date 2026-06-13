// symbolDataRoute.js
// Endpoint to fetch symbol data from Google Apps Script and serve it to the frontend

const express = require('express');
const router = express.Router();
const https = require('https');

// In-memory cache for symbol data
// Structure: { [symbol]: { data: Array, timestamp: number } }
const symbolCache = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache TTL

/**
 * Fallback helper to fetch JSON from a URL with redirect handling (HTTP 3xx).
 * This ensures compatibility on environments where global fetch is not present or configured.
 */
function fetchJsonWithRedirect(url) {
    return new Promise((resolve, reject) => {
        const getUrl = (targetUrl) => {
            https.get(targetUrl, { timeout: 15000 }, (res) => {
                const { statusCode } = res;
                
                // Handle redirects (HTTP 301, 302, 307, 308)
                if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
                    return getUrl(res.headers.location);
                }

                if (statusCode !== 200) {
                    res.resume(); // consume response data to free up memory
                    return reject(new Error(`Request Failed. Status Code: ${statusCode}`));
                }

                let rawData = '';
                res.on('data', (chunk) => { rawData += chunk; });
                res.on('end', () => {
                    try {
                        const parsedData = JSON.parse(rawData);
                        resolve(parsedData);
                    } catch (e) {
                        reject(e);
                    }
                });
            }).on('error', (e) => {
                reject(e);
            });
        };
        getUrl(url);
    });
}

/**
 * Fetch helper that tries modern global fetch first, then falls back to redirect-following https request.
 */
async function fetchSymbolData(url) {
    if (typeof fetch === 'function') {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return await response.json();
    } else {
        return await fetchJsonWithRedirect(url);
    }
}

/**
 * GET /api/symbol-data
 * Query params: 
 *   - symbol: Stock ticker symbol (e.g. UPPER)
 *   - bypassCache: If 'true', forces a fresh fetch from source
 */
router.get('/', async (req, res) => {
    let { symbol, bypassCache } = req.query;

    if (!symbol) {
        return res.status(400).json({
            success: false,
            error: 'Symbol query parameter is required. Example: /api/symbol-data?symbol=UPPER'
        });
    }

    // Clean and normalize the symbol parameter
    symbol = symbol.trim().toUpperCase();

    const now = Date.now();
    const cachedEntry = symbolCache[symbol];

    // Serve from cache if valid and not bypassed
    if (cachedEntry && (now - cachedEntry.timestamp < CACHE_TTL_MS) && bypassCache !== 'true') {
        console.log(`[SymbolData] Serving cached data for symbol: ${symbol}`);
        return res.json({
            success: true,
            fromCache: true,
            symbol,
            count: cachedEntry.data.length,
            data: cachedEntry.data
        });
    }

    try {
        const targetUrl = `https://script.google.com/macros/s/AKfycbxteVvHon6igrKGV7KCyUO4m09tz9Q1FEG5nDv924zUPP2LARxmkQaX30yTPJrrFwItlg/exec?symbol=${encodeURIComponent(symbol)}`;
        console.log(`[SymbolData] Fetching fresh data from Google Apps Script for symbol: ${symbol}`);

        const result = await fetchSymbolData(targetUrl);

        if (result && result.success && Array.isArray(result.data)) {
            // Save valid response to cache
            symbolCache[symbol] = {
                data: result.data,
                timestamp: now
            };

            return res.json({
                success: true,
                fromCache: false,
                symbol: result.symbol || symbol,
                count: result.data.length,
                data: result.data
            });
        } else {
            console.error(`[SymbolData] Invalid data shape from source for: ${symbol}`, result);
            return res.status(502).json({
                success: false,
                error: 'Received invalid data format from Google Apps Script'
            });
        }

    } catch (error) {
        console.error(`[SymbolData] Failed to retrieve data for ${symbol}:`, error.message);

        // Fallback to cache (even if expired/stale) if we have it on hand
        if (cachedEntry) {
            console.warn(`[SymbolData] Serving stale cache fallback for symbol: ${symbol}`);
            return res.json({
                success: true,
                fromCache: true,
                isStale: true,
                symbol,
                count: cachedEntry.data.length,
                data: cachedEntry.data
            });
        }

        return res.status(500).json({
            success: false,
            error: `Failed to fetch symbol data: ${error.message}`
        });
    }
});

module.exports = router;
