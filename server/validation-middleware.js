/**
 * Input Validation & Sanitization Middleware
 */

function sanitizeString(str) {
    if (typeof str !== 'string') return '';
    return str.trim();
}

function isValidSymbol(symbol) {
    if (!symbol || typeof symbol !== 'string') return false;
    const clean = symbol.trim();
    // 1 to 20 alphanumeric characters or dot/ampersand/hyphen/space (e.g. MANU.& PRO., NABIL)
    return /^[A-Za-z0-9.&_\-\s]{1,20}$/.test(clean);
}

function isPositiveNumber(val) {
    if (val === null || val === undefined || val === '') return true; // Optional fields
    const num = Number(val);
    return !isNaN(num) && num >= 0;
}

// ── Watchlist Validation ──
function validateWatchlistInput(req, res, next) {
    const { symbol, target_buy, target_sell, notes } = req.body;

    if (!symbol || !isValidSymbol(symbol)) {
        return res.status(400).json({ error: 'Valid stock symbol is required (1-20 alphanumeric characters)' });
    }

    if (target_buy !== undefined && target_buy !== null && target_buy !== '' && !isPositiveNumber(target_buy)) {
        return res.status(400).json({ error: 'target_buy must be a non-negative number' });
    }

    if (target_sell !== undefined && target_sell !== null && target_sell !== '' && !isPositiveNumber(target_sell)) {
        return res.status(400).json({ error: 'target_sell must be a non-negative number' });
    }

    if (notes && typeof notes === 'string' && notes.length > 500) {
        return res.status(400).json({ error: 'Notes cannot exceed 500 characters' });
    }

    // Sanitize symbol
    req.body.symbol = sanitizeString(symbol).toUpperCase();
    next();
}

// ── Transaction Validation ──
function validateTransactionInput(req, res, next) {
    const payload = req.body;
    const items = Array.isArray(payload) ? payload : [payload];

    if (items.length === 0) {
        return res.status(400).json({ error: 'Transaction data payload required' });
    }

    for (let i = 0; i < items.length; i++) {
        const tx = items[i];

        if (!tx.symbol || !isValidSymbol(tx.symbol)) {
            return res.status(400).json({ error: `Item ${i + 1}: Valid stock symbol is required` });
        }

        const validTypes = ['BUY', 'SELL', 'BONUS', 'RIGHT'];
        if (tx.transaction_type && !validTypes.includes(String(tx.transaction_type).toUpperCase())) {
            return res.status(400).json({ error: `Item ${i + 1}: Invalid transaction type. Must be BUY, SELL, BONUS, or RIGHT` });
        }

        if (tx.units !== undefined && (isNaN(Number(tx.units)) || Number(tx.units) <= 0)) {
            return res.status(400).json({ error: `Item ${i + 1}: Units must be a positive number` });
        }

        if (tx.price !== undefined && (isNaN(Number(tx.price)) || Number(tx.price) < 0)) {
            return res.status(400).json({ error: `Item ${i + 1}: Price must be a non-negative number` });
        }

        // Sanitize symbol
        tx.symbol = sanitizeString(tx.symbol).toUpperCase();
    }

    next();
}

// ── Trade Plan Validation ──
function validateTradePlanInput(req, res, next) {
    const { symbol, entry, sl, target } = req.body;

    if (!symbol || !isValidSymbol(symbol)) {
        return res.status(400).json({ error: 'Valid stock symbol is required' });
    }

    if (entry !== undefined && entry !== null && entry !== '' && (isNaN(Number(entry)) || Number(entry) <= 0)) {
        return res.status(400).json({ error: 'Entry price must be a positive number' });
    }

    if (sl !== undefined && sl !== null && sl !== '' && (isNaN(Number(sl)) || Number(sl) <= 0)) {
        return res.status(400).json({ error: 'Stop loss price must be a positive number' });
    }

    if (target !== undefined && target !== null && target !== '' && (isNaN(Number(target)) || Number(target) <= 0)) {
        return res.status(400).json({ error: 'Target price must be a positive number' });
    }

    req.body.symbol = sanitizeString(symbol).toUpperCase();
    next();
}

// ── Notification Validation ──
function validateNotificationInput(req, res, next) {
    const { title, message, type, symbol } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: 'Notification title is required' });
    }

    if (title.length > 150) {
        return res.status(400).json({ error: 'Notification title cannot exceed 150 characters' });
    }

    if (message && typeof message === 'string' && message.length > 1000) {
        return res.status(400).json({ error: 'Notification message cannot exceed 1000 characters' });
    }

    if (symbol && !isValidSymbol(symbol)) {
        return res.status(400).json({ error: 'Invalid stock symbol attached to notification' });
    }

    const validTypes = ['info', 'buy', 'sell', 'stoploss', 'target', 'alert'];
    if (type && !validTypes.includes(String(type).toLowerCase())) {
        return res.status(400).json({ error: 'Invalid notification type' });
    }

    req.body.title = sanitizeString(title);
    if (symbol) req.body.symbol = sanitizeString(symbol).toUpperCase();
    next();
}

module.exports = {
    validateWatchlistInput,
    validateTransactionInput,
    validateTradePlanInput,
    validateNotificationInput
};
