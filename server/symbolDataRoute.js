// symbolDataRoute.js
// Endpoint to fetch stock symbol historical data from Supabase and serve it to the frontend

const express = require('express');
const router = express.Router();

/**
 * GET /api/symbol-data
 * Query params: 
 *   - symbol: Stock ticker symbol (e.g. UPPER)
 */
router.get('/', async (req, res) => {
    let { symbol } = req.query;

    if (!symbol) {
        return res.status(400).json({
            success: false,
            error: 'Symbol query parameter is required. Example: /api/symbol-data?symbol=UPPER'
        });
    }

    // Clean and normalize the symbol parameter
    symbol = symbol.trim().toUpperCase();
    const supabase = req.app.locals.supabase;

    try {
        console.log(`[SymbolData] Fetching data from Supabase for symbol: ${symbol}`);
        
        const { data, error } = await supabase
            .from('symbol_data')
            .select('date, symbol, open, high, low, close, volume')
            .eq('symbol', symbol)
            .order('date', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.json({
                success: true,
                symbol,
                count: 0,
                data: []
            });
        }

        // Map database lowercase columns to capitalized keys for frontend compatibility
        const formattedData = data.map(item => ({
            Date: item.date,
            Symbol: item.symbol,
            Open: parseFloat(item.open),
            High: parseFloat(item.high),
            Low: parseFloat(item.low),
            Close: parseFloat(item.close),
            Volume: parseInt(item.volume, 10)
        }));

        return res.json({
            success: true,
            symbol,
            count: formattedData.length,
            data: formattedData
        });

    } catch (error) {
        console.error(`[SymbolData] Supabase fetch error for ${symbol}:`, error.message);
        return res.status(500).json({
            success: false,
            error: `Failed to fetch symbol data from database: ${error.message}`
        });
    }
});

module.exports = router;
