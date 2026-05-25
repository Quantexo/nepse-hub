const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const app = express();
const port = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Database Setup
const db = new Database('nepse_hub.db');
app.locals.db = db;

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, symbol)
  );

  CREATE TABLE IF NOT EXISTS trade_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    entry REAL,
    sl REAL,
    target REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Create index for faster code lookups
db.prepare('CREATE INDEX IF NOT EXISTS idx_users_code ON users(code)').run();

// --- Authentication Routes ---
const authRoutes = require('./authRoutes');
app.use('/api/auth', authRoutes);

// --- Import Authentication Middleware ---
const authMiddleware = require('./auth-middleware');

// --- Watchlist Routes (Protected) ---
app.get('/api/watchlist', authMiddleware, (req, res) => {
    const stocks = db.prepare('SELECT id, symbol FROM watchlist WHERE user_id = ? ORDER BY created_at DESC').all(req.userId);
    res.json(stocks.map(s => ({ id: s.id, symbol: s.symbol })));
});

app.post('/api/watchlist', authMiddleware, (req, res) => {
    const { symbol } = req.body;
    try {
        db.prepare('INSERT INTO watchlist (user_id, symbol) VALUES (?, ?)').run(req.userId, symbol);
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'Already in watchlist or invalid request' });
    }
});

app.delete('/api/watchlist/:id', authMiddleware, (req, res) => {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM watchlist WHERE id = ? AND user_id = ?').run(id, req.userId);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'Watchlist item not found' });
    }
    res.json({ success: true });
});

// --- Trade Plans Routes (Protected) ---
app.get('/api/trade-plans', authMiddleware, (req, res) => {
    const plans = db.prepare('SELECT * FROM trade_plans WHERE user_id = ? ORDER BY created_at DESC').all(req.userId);
    res.json(plans);
});

app.post('/api/trade-plans', authMiddleware, (req, res) => {
    const { symbol, entry, sl, target } = req.body;
    try {
        const info = db.prepare('INSERT INTO trade_plans (user_id, symbol, entry, sl, target) VALUES (?, ?, ?, ?, ?)').run(req.userId, symbol, entry, sl, target);
        res.status(201).json({ id: info.lastInsertRowid, success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/trade-plans/:id', authMiddleware, (req, res) => {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM trade_plans WHERE id = ? AND user_id = ?').run(id, req.userId);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'Trade plan not found' });
    }
    res.json({ success: true });
});

// --- CDSC IPO Proxy Routes ---
const ipoRouter = require('./ipoRouter');
app.use('/api/ipo', ipoRouter);

app.listen(port, () => {
    console.log(`NEPSE Hub Backend running at http://localhost:${port}`);
});
