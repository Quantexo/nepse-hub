const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config();

const { startCronJobs } = require('./cronJobs');
const { startBot } = require('./telegramBot');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Supabase Connection Setup - Use ONLY environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_PUB_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_KEY must be set in environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
app.locals.supabase = supabase;
console.log('Supabase connection successful');

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
            .select('*')
            .eq('user_id', req.userId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(stocks || []);
    } catch (err) {
        console.error('Watchlist fetch error:', err.message);
        res.status(500).json({ error: 'Failed to fetch watchlist' });
    }
});

app.post('/api/watchlist', authMiddleware, async (req, res) => {
    const { symbol, target_buy, target_sell, notes } = req.body;
    if (!symbol) {
        return res.status(400).json({ error: 'Symbol is required' });
    }
    try {
        const { data, error } = await req.app.locals.supabase
            .from('watchlist')
            .upsert(
                { user_id: req.userId, symbol, target_buy, target_sell, notes },
                { onConflict: 'user_id,symbol' }
            );

        if (error) throw error;
        res.status(201).json({ success: true });
    } catch (err) {
        console.error('Watchlist post error:', err.message);
        res.status(400).json({ error: 'Already in watchlist or invalid request' });
    }
});

app.delete('/api/watchlist/:symbol', authMiddleware, async (req, res) => {
    const { symbol } = req.params;
    try {
        const { error, count } = await req.app.locals.supabase
            .from('watchlist')
            .delete({ count: 'exact' })
            .eq('symbol', symbol)
            .eq('user_id', req.userId);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('Watchlist delete error:', err.message);
        res.status(500).json({ error: 'Failed to delete watchlist item' });
    }
});

app.put('/api/watchlist/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { target_buy, target_sell, notes } = req.body;
    try {
        const { data, error } = await req.app.locals.supabase
            .from('watchlist')
            .update({ target_buy, target_sell, notes })
            .eq('id', id)
            .eq('user_id', req.userId)
            .select();

        if (error) throw error;
        res.json({ success: true, data: data[0] });
    } catch (err) {
        console.error('Watchlist update error:', err.message);
        res.status(500).json({ error: 'Failed to update watchlist item' });
    }
});

// --- Transactions (Portfolio) Routes (Protected) ---
app.get('/api/transactions', authMiddleware, async (req, res) => {
    try {
        const { data, error } = await req.app.locals.supabase
            .from('transactions')
            .select('*')
            .eq('user_id', req.userId)
            .order('transaction_date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data: data || [] });
    } catch (err) {
        console.error('Transactions fetch error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch transactions', data: [] });
    }
});

app.post('/api/transactions', authMiddleware, async (req, res) => {
    try {
        const tx = req.body;
        const { data, error } = await req.app.locals.supabase
            .from('transactions')
            .insert([{ ...tx, user_id: req.userId }])
            .select();
        if (error) throw error;
        res.status(201).json({ success: true, data: data[0] });
    } catch (err) {
        console.error('Transaction add error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to add transaction' });
    }
});

app.delete('/api/transactions/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const { error, count } = await req.app.locals.supabase
            .from('transactions')
            .delete({ count: 'exact' })
            .eq('id', id)
            .eq('user_id', req.userId);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('Transaction delete error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to delete transaction' });
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

// --- Notifications Routes (Protected) ---
app.get('/api/notifications', authMiddleware, async (req, res) => {
    try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const { data, error } = await req.app.locals.supabase
            .from('notifications')
            .select('*')
            .eq('user_id', req.userId)
            .gte('created_at', sevenDaysAgo.toISOString())
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error('Notifications fetch error:', err.message);
        res.status(500).json([]);
    }
});

app.post('/api/notifications', authMiddleware, async (req, res) => {
    const notif = req.body;
    try {
        const { error } = await req.app.locals.supabase
            .from('notifications')
            .insert([{
                user_id: req.userId,
                title: notif.title,
                message: notif.message,
                type: notif.type || 'info',
                symbol: notif.symbol || null,
                is_read: false
            }]);
        if (error) throw error;
        res.status(201).json({ success: true });
    } catch (err) {
        console.error('Notification add error:', err.message);
        res.status(500).json({ success: false });
    }
});

app.post('/api/notifications/test-dispatch', authMiddleware, async (req, res) => {
    try {
        const { dispatchTestSummary } = require('./marketSummary');
        const results = await dispatchTestSummary(req.app.locals.supabase, req.userId);
        res.json({ success: true, results });
    } catch (err) {
        console.error('Test dispatch error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/notifications/mark-read', authMiddleware, async (req, res) => {

    try {
        const { error } = await req.app.locals.supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('user_id', req.userId)
            .eq('is_read', false);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('Notifications mark read error:', err.message);
        res.status(500).json({ success: false });
    }
});

app.put('/api/notifications/:id/mark-read', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const { error } = await req.app.locals.supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('id', id)
            .eq('user_id', req.userId);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('Notification mark read error:', err.message);
        res.status(500).json({ success: false });
    }
});

app.delete('/api/notifications/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const { error } = await req.app.locals.supabase
            .from('notifications')
            .delete()
            .eq('id', id)
            .eq('user_id', req.userId);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('Notification delete error:', err.message);
        res.status(500).json({ success: false });
    }
});

app.listen(port, () => {
    console.log(`NEPSE Hub Backend running at http://localhost:${port}`);

    // Start background services
    startCronJobs(supabase);
    startBot(supabase);
});

const aliveRoute = require('./aliveRoute');
app.use('/api/alive', aliveRoute);

const symbolDataRoute = require('./symbolDataRoute');
app.use('/api/symbol-data', symbolDataRoute);

