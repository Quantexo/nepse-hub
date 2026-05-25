const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Supabase Connection Setup
const supabaseUrl = process.env.SUPABASE_URL || 'https://yzvarygeeycsbttxzusg.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_hKShryc4e4rFs5zbfvFubw_j2jv2gFW';
const supabase = createClient(supabaseUrl, supabaseKey);
app.locals.supabase = supabase;

// --- Authentication Routes ---
const authRoutes = require('./authRoutes');
app.use('/api/auth', authRoutes);

// --- Import Authentication Middleware ---
const authMiddleware = require('./auth-middleware');

// --- Watchlist Routes (Protected) ---
app.get('/api/watchlist', authMiddleware, async (req, res) => {
    try {
        const { data: stocks, error } = await req.app.locals.supabase
            .from('watchlist')
            .select('id, symbol')
            .eq('user_id', req.userId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json((stocks || []).map(s => ({ id: s.id, symbol: s.symbol })));
    } catch (err) {
        console.error('Watchlist fetch error:', err.message);
        res.status(500).json({ error: 'Failed to fetch watchlist' });
    }
});

app.post('/api/watchlist', authMiddleware, async (req, res) => {
    const { symbol } = req.body;
    if (!symbol) {
        return res.status(400).json({ error: 'Symbol is required' });
    }
    try {
        const { data, error } = await req.app.locals.supabase
            .from('watchlist')
            .insert([{ user_id: req.userId, symbol }]);

        if (error) throw error;
        res.status(201).json({ success: true });
    } catch (err) {
        console.error('Watchlist post error:', err.message);
        res.status(400).json({ error: 'Already in watchlist or invalid request' });
    }
});

app.delete('/api/watchlist/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const { error, count } = await req.app.locals.supabase
            .from('watchlist')
            .delete({ count: 'exact' })
            .eq('id', id)
            .eq('user_id', req.userId);

        if (error) throw error;
        if (count === 0) {
            return res.status(404).json({ error: 'Watchlist item not found' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Watchlist delete error:', err.message);
        res.status(500).json({ error: 'Failed to delete watchlist item' });
    }
});

// --- Trade Plans Routes (Protected) ---
app.get('/api/trade-plans', authMiddleware, async (req, res) => {
    try {
        const { data: plans, error } = await req.app.locals.supabase
            .from('trade_plans')
            .select('*')
            .eq('user_id', req.userId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(plans || []);
    } catch (err) {
        console.error('Trade plans fetch error:', err.message);
        res.status(500).json({ error: 'Failed to fetch trade plans' });
    }
});

app.post('/api/trade-plans', authMiddleware, async (req, res) => {
    const { symbol, entry, sl, target } = req.body;
    if (!symbol) {
        return res.status(400).json({ error: 'Symbol is required' });
    }
    try {
        const { data, error } = await req.app.locals.supabase
            .from('trade_plans')
            .insert([{ user_id: req.userId, symbol, entry, sl, target }])
            .select('id')
            .single();

        if (error) throw error;
        res.status(201).json({ id: data.id, success: true });
    } catch (err) {
        console.error('Trade plan post error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/trade-plans/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const { error, count } = await req.app.locals.supabase
            .from('trade_plans')
            .delete({ count: 'exact' })
            .eq('id', id)
            .eq('user_id', req.userId);

        if (error) throw error;
        if (count === 0) {
            return res.status(404).json({ error: 'Trade plan not found' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Trade plan delete error:', err.message);
        res.status(500).json({ error: 'Failed to delete trade plan' });
    }
});

// --- CDSC IPO Proxy Routes ---
const ipoRouter = require('./ipoRouter');
app.use('/api/ipo', ipoRouter);

app.listen(port, () => {
    console.log(`NEPSE Hub Backend running at http://localhost:${port}`);
});
