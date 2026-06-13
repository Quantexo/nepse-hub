#!/usr/bin/env node
// fetchSymbol.js
// CLI utility to fetch and display symbol data directly from Google Apps Script

const https = require('https');

const symbol = process.argv[2];
if (!symbol) {
    console.error('Error: Please provide a stock symbol. Example: node fetchSymbol.js UPPER');
    process.exit(1);
}

const targetUrl = `https://script.google.com/macros/s/AKfycbxteVvHon6igrKGV7KCyUO4m09tz9Q1FEG5nDv924zUPP2LARxmkQaX30yTPJrrFwItlg/exec?symbol=${encodeURIComponent(symbol.trim().toUpperCase())}`;
console.log(`Fetching data for symbol: ${symbol.toUpperCase()}...`);

function fetchJsonWithRedirect(url) {
    return new Promise((resolve, reject) => {
        const getUrl = (targetUrl) => {
            https.get(targetUrl, { timeout: 15000 }, (res) => {
                const { statusCode } = res;
                if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
                    return getUrl(res.headers.location);
                }
                if (statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`HTTP status code: ${statusCode}`));
                }

                let raw = '';
                res.on('data', (chunk) => raw += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(raw));
                    } catch (e) {
                        reject(e);
                    }
                });
            }).on('error', reject);
        };
        getUrl(url);
    });
}

async function run() {
    try {
        const result = await fetchJsonWithRedirect(targetUrl);
        if (result && result.success) {
            console.log('\n--- Fetch Success ---');
            console.log(`Symbol: ${result.symbol}`);
            console.log(`Count: ${result.count}`);
            if (result.data && result.data.length > 0) {
                console.log('\nLatest Record:');
                console.log(JSON.stringify(result.data[0], null, 2));
                
                console.log('\nOldest Record:');
                console.log(JSON.stringify(result.data[result.data.length - 1], null, 2));
            } else {
                console.log('No data records found.');
            }
        } else {
            console.error('API Error:', result);
        }
    } catch (e) {
        console.error('Failed to fetch symbol data:', e.message);
    }
}

run();
