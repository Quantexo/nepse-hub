const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config();

const { startCronJobs } = require('./cronJobs');
const { startBot } = require('./telegramBot');

const app = express();
const port = process.env.PORT || 3001;

// Trust the first proxy hop (required on Render / any reverse-proxy host)
// Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
app.set('trust proxy', 1);

// --- Security Headers (Helmet) ---
app.use(helmet({
    contentSecurityPolicy: false, // Disable default CSP so API response embedding isn't blocked
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// --- CORS Configuration ---
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [
        'http://localhost:5500',
        'http://localhost:5600',
        'https://nepse-hub-backend.vercel.app',
        'https://nepsehub.vercel.app/'
    ];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps, curl, server-to-server)
        if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
            return callback(null, true);
        }
        return callback(null, true); // Fallback: allow all origins while supporting credentialed headers
    },
    credentials: true
}));

// --- Request Body Payload Limit ---
app.use(express.json({ limit: '100kb' }));

// --- Rate Limiting ---
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 15, // Limit each IP to 15 login/register requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts from this IP. Please try again after 15 minutes.' }
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 200, // Limit each IP to 200 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many API requests. Please slow down.' }
});

// Apply rate limiters
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/', apiLimiter);

// Supabase Connection Setup - Use SUPABASE_SERVICE_ROLE_KEY to work with RLS enabled
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUB_KEY || process.env.SUPABASE_KEY;

let supabase = null;
if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) must be set in environment variables');
} else {
    supabase = createClient(supabaseUrl, supabaseKey);
    app.locals.supabase = supabase;
    console.log('Supabase connection successful');
}

// --- Authentication Routes ---
const authRoutes = require('./authRoutes');
app.use('/api/auth', authRoutes);

// --- Settings Routes ---
const settingsRoutes = require('./settingsRoutes');
app.use('/api/settings', settingsRoutes);

// --- Import Middleware ---
const authMiddleware = require('./auth-middleware');
const {
    validateWatchlistInput,
    validateTransactionInput,
    validateTradePlanInput,
    validateNotificationInput
} = require('./validation-middleware');

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

app.post('/api/watchlist', authMiddleware, validateWatchlistInput, async (req, res) => {
    const { symbol, target_buy, target_sell, notes } = req.body;
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

app.post('/api/transactions', authMiddleware, validateTransactionInput, async (req, res) => {
    try {
        const payload = req.body;
        const txList = Array.isArray(payload) ? payload : [payload];
        const rowsToInsert = txList.map(tx => ({ ...tx, user_id: req.userId }));

        const { data, error } = await req.app.locals.supabase
            .from('transactions')
            .insert(rowsToInsert)
            .select();

        if (error) throw error;
        res.status(201).json({ success: true, data: Array.isArray(payload) ? data : data[0] });
    } catch (err) {
        console.error('Transaction add error:', err.message);
        res.status(500).json({ success: false, error: err.message || 'Failed to add transaction' });
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

app.post('/api/trade-plans', authMiddleware, validateTradePlanInput, async (req, res) => {
    const { symbol, entry, sl, target } = req.body;
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

app.post('/api/notifications', authMiddleware, validateNotificationInput, async (req, res) => {
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

const aliveRoute = require('./aliveRoute');
app.use('/api/alive', aliveRoute);

const symbolDataRoute = require('./symbolDataRoute');
app.use('/api/symbol-data', symbolDataRoute);

// --- Suggestion Box Routes ---
// POST /api/suggestions — authenticated users submit an idea/feedback
app.post('/api/suggestions', authMiddleware, async (req, res) => {
    const { category, header, body, email } = req.body;

    if (!header || typeof header !== 'string' || header.trim().length === 0) {
        return res.status(400).json({ error: 'Suggestion title is required.' });
    }
    if (!body || typeof body !== 'string' || body.trim().length === 0) {
        return res.status(400).json({ error: 'Suggestion description is required.' });
    }
    if (header.trim().length > 120) {
        return res.status(400).json({ error: 'Title must be 120 characters or fewer.' });
    }
    if (body.trim().length > 2000) {
        return res.status(400).json({ error: 'Description must be 2000 characters or fewer.' });
    }

    const allowedCategories = ['Feature Request', 'Bug Report', 'UI / UX', 'Data / Accuracy', 'Performance', 'Other'];
    const safeCategory = allowedCategories.includes(category) ? category : 'Other';

    try {
        const { error } = await req.app.locals.supabase
            .from('suggestions')
            .insert({
                user_id:  req.userId,
                usercode: req.userCode || null,
                email:    email || null,
                category: safeCategory,
                header:   header.trim(),
                body:     body.trim(),
            });

        if (error) throw error;
        res.status(201).json({ success: true, message: 'Suggestion submitted successfully.' });
    } catch (err) {
        console.error('Suggestion insert error:', err.message);
        res.status(500).json({ error: 'Failed to save suggestion. Please try again.' });
    }
});

// --- Global Error Handler Middleware ---
app.use((err, req, res, next) => {
    console.error(`[Global Error] ${req.method} ${req.url}:`, err);
    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message || 'An unexpected error occurred'
    });
});

process.on('unhandledRejection', (reason) => {
    console.error('[Unhandled Promise Rejection]:', reason);
});

if (require.main === module) {
    app.listen(port, () => {
        console.log(`NEPSE Hub Backend running at http://localhost:${port}`);
        if (supabase) {
            startCronJobs(supabase);
            startBot(supabase);
        }
    });
}

module.exports = app;

