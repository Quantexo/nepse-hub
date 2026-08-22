/**
 * telegramBot.js
 * Polls the Telegram Bot API for new messages, handles /start <code>
 * to link a user's Telegram chat_id to their NEPSTRAT account.
 */

const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const POLL_TIMEOUT = 30; // long-poll seconds

let lastUpdateId = 0;
let pollingActive = false;
let supabase = null;

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function telegramRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({});
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendMessage(chatId, text) {
  return telegramRequest('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  });
}

// ── Data and Business Logic Helpers ──────────────────────────────────────────

/** Fetch JSON from a URL (returns parsed object or null on failure) */
function fetchJson(url) {
  return new Promise((resolve) => {
    https
      .get(url, { timeout: 10000 }, (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(null);
          }
        });
      })
      .on('error', () => resolve(null));
  });
}

/** Compute current holdings from transaction logs using FIFO WACC */
function computeHoldings(transactions) {
  const symbolMap = {};

  // Sort oldest first for running average
  const sorted = [...transactions].sort((a, b) => {
    const dateA = new Date(a.transaction_date);
    const dateB = new Date(b.transaction_date);
    if (dateA < dateB) return -1;
    if (dateA > dateB) return 1;
    return (a.id || 0) - (b.id || 0);
  });

  sorted.forEach(t => {
    if (!t.symbol) return;
    const sym = t.symbol.toUpperCase();
    const type = t.type ? t.type.toUpperCase() : '';
    const qty = parseFloat(t.quantity) || 0;
    const amount = parseFloat(t.total_amount) || 0;

    if (!symbolMap[sym]) {
      symbolMap[sym] = { qty: 0, totalInvestment: 0, wacc: 0, stopLoss: null };
    }

    const h = symbolMap[sym];

    if (type === 'BUY') {
      h.totalInvestment = Number((h.totalInvestment + amount).toFixed(4));
      h.qty += qty;
      h.wacc = h.qty > 0 ? Number((h.totalInvestment / h.qty).toFixed(4)) : 0;
      if (t.stop_loss) h.stopLoss = parseFloat(t.stop_loss);
    } else if (type === 'SELL') {
      const costOfSoldShares = Number((h.wacc * qty).toFixed(4));
      h.totalInvestment = Number((h.totalInvestment - costOfSoldShares).toFixed(4));
      h.qty -= qty;

      if (h.qty <= 0.001) {
        h.qty = 0;
        h.totalInvestment = 0;
        h.wacc = 0;
        h.stopLoss = null;
      }
    }
  });

  return Object.entries(symbolMap)
    .filter(([_, data]) => data.qty > 0.001)
    .map(([symbol, data]) => ({
      symbol,
      ...data
    }));
}

// ── Interactive Command Handlers ─────────────────────────────────────────────

async function handlePortfolioCommand(chatId) {
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, username')
    .eq('telegram_chat_id', String(chatId))
    .maybeSingle();

  if (userError || !user) {
    await sendMessage(
      chatId,
      '👋 Welcome to *NEPSTRAT Bot*!\n\nIt looks like your Telegram account is not linked to your NEPSTRAT account yet.\n\nTo link your account, go to *Profile → Notification Settings* in the app and follow the Telegram connect instructions.'
    );
    return;
  }

  const [txRes, liveMarket] = await Promise.all([
    supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user.id),
    fetchJson('https://nepse-hub-backend.onrender.com/core/live-nepse')
  ]);

  const transactions = txRes.data || [];
  const rawStocks = liveMarket || [];

  let stocks = [];
  if (rawStocks) {
    if (Array.isArray(rawStocks)) {
      stocks = rawStocks;
    } else if (rawStocks.data && Array.isArray(rawStocks.data)) {
      stocks = rawStocks.data;
    } else if (rawStocks.result && Array.isArray(rawStocks.result)) {
      stocks = rawStocks.result;
    }
  }

  const holdings = computeHoldings(transactions);

  if (holdings.length === 0) {
    await sendMessage(
      chatId,
      '📊 *Your Portfolio Summary*\n━━━━━━━━━━━━━━━━━━\n\nℹ️ You don\'t have any active holdings in your portfolio.\nUse the NEPSTRAT web application to add buy transactions and track them here!'
    );
    return;
  }

  let totalInv = 0;
  let totalCur = 0;
  let todayChange = 0;
  const holdingLines = [];

  holdings.forEach(h => {
    const stock = stocks.find(s => (s.symbol || s.securitySymbol || '').toUpperCase() === h.symbol.toUpperCase());
    const ltp = stock ? parseFloat(stock.price || stock.lastTradedPrice || stock.lastPrice || stock.ltp || 0) : h.wacc;
    const prevClose = stock ? parseFloat(stock.previousClose || stock.prevClose || ltp) : ltp;

    totalInv += h.totalInvestment;
    const currentVal = ltp * h.qty;
    totalCur += currentVal;
    todayChange += (ltp - prevClose) * h.qty;

    const holdingPnl = currentVal - h.totalInvestment;
    const holdingPnlPct = h.totalInvestment > 0 ? (holdingPnl / h.totalInvestment) * 100 : 0;
    const sign = holdingPnlPct >= 0 ? '+' : '';

    holdingLines.push({
      symbol: h.symbol,
      qty: h.qty,
      wacc: h.wacc,
      ltp: ltp,
      pnlPct: holdingPnlPct,
      text: `• *${h.symbol}* — ${h.qty.toLocaleString('en-IN')} units @ Rs. ${h.wacc.toLocaleString('en-IN', { maximumFractionDigits: 2 })} → Rs. ${ltp.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${sign}${holdingPnlPct.toFixed(2)}%)`
    });
  });

  const pnl = totalCur - totalInv;
  const pnlPct = totalInv > 0 ? (pnl / totalInv) * 100 : 0;
  const dayPct = (totalCur - todayChange) > 0 ? (todayChange / (totalCur - todayChange)) * 100 : 0;

  // Sort by P&L % to get top gainer and top loser
  const sortedHoldings = [...holdingLines].sort((a, b) => b.pnlPct - a.pnlPct);
  const topGainer = sortedHoldings[0];
  const topLoser = sortedHoldings.length > 1 ? sortedHoldings[sortedHoldings.length - 1] : null;

  const signPnL = pnl >= 0 ? '+' : '';
  const signDay = todayChange >= 0 ? '+' : '';

  let messageText = `📊 *Your Portfolio Summary*
━━━━━━━━━━━━━━━━━━
💰 *Total Invested:* Rs. ${totalInv.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
📈 *Current Value:* Rs. ${totalCur.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
📊 *Unrealized P&L:* ${signPnL}Rs. ${pnl.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${signPnL}${pnlPct.toFixed(2)}%)
📅 *Today's Change:* ${signDay}Rs. ${todayChange.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${signDay}${dayPct.toFixed(2)}%)

`;

  if (topGainer) {
    const tgSign = topGainer.pnlPct >= 0 ? '+' : '';
    messageText += `🏆 *Top Gainer:* ${topGainer.symbol} (${tgSign}${topGainer.pnlPct.toFixed(2)}%)\n`;
  }
  if (topLoser) {
    const tlSign = topLoser.pnlPct >= 0 ? '+' : '';
    messageText += `📉 *Top Loser:* ${topLoser.symbol} (${tlSign}${topLoser.pnlPct.toFixed(2)}%)\n`;
  }

  messageText += `\n*Holdings:*\n` + holdingLines.map(line => line.text).join('\n');

  await sendMessage(chatId, messageText);
}

async function handleWatchlistCommand(chatId) {
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, username')
    .eq('telegram_chat_id', String(chatId))
    .maybeSingle();

  if (userError || !user) {
    await sendMessage(
      chatId,
      '👋 Welcome to *NEPSTRAT Bot*!\n\nIt looks like your Telegram account is not linked to your NEPSTRAT account yet.\n\nTo link your account, go to *Profile → Notification Settings* in the app and follow the Telegram connect instructions.'
    );
    return;
  }

  const [wlRes, liveMarket] = await Promise.all([
    supabase
      .from('watchlist')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    fetchJson('https://nepse-hub-backend.onrender.com/core/live-nepse')
  ]);

  const watchlistItems = wlRes.data || [];
  const rawStocks = liveMarket || [];

  let stocks = [];
  if (rawStocks) {
    if (Array.isArray(rawStocks)) {
      stocks = rawStocks;
    } else if (rawStocks.data && Array.isArray(rawStocks.data)) {
      stocks = rawStocks.data;
    } else if (rawStocks.result && Array.isArray(rawStocks.result)) {
      stocks = rawStocks.result;
    }
  }

  if (watchlistItems.length === 0) {
    await sendMessage(
      chatId,
      '👀 *Your Watchlist*\n━━━━━━━━━━━━━━━━━━\n\nℹ️ Your watchlist is currently empty.\nUse the NEPSTRAT web application to add stock symbols and targets to your watchlist!'
    );
    return;
  }

  const lines = [];
  watchlistItems.forEach(w => {
    const stock = stocks.find(s => (s.symbol || s.securitySymbol || '').toUpperCase() === w.symbol.toUpperCase());
    const ltp = stock ? parseFloat(stock.price || stock.lastTradedPrice || stock.lastPrice || stock.ltp || 0) : null;

    let stockText = `📌 *${w.symbol.toUpperCase()}*`;
    if (ltp !== null) {
      stockText += ` — LTP: Rs. ${ltp.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    } else {
      stockText += ` — LTP: N/A`;
    }

    const buyTarget = parseFloat(w.target_buy) || null;
    const sellTarget = parseFloat(w.target_sell) || null;

    if (buyTarget) {
      if (ltp !== null && ltp <= buyTarget) {
        stockText += `\n   ✅ *Buy Target:* Rs. ${buyTarget.toLocaleString('en-IN')} (HIT! 🎉)`;
      } else {
        const awayStr = ltp ? ` (${(((ltp - buyTarget) / ltp) * 100).toFixed(1)}% away)` : '';
        stockText += `\n   🎯 *Buy Target:* Rs. ${buyTarget.toLocaleString('en-IN')}${awayStr}`;
      }
    }

    if (sellTarget) {
      if (ltp !== null && ltp >= sellTarget) {
        stockText += `\n   ✅ *Sell Target:* Rs. ${sellTarget.toLocaleString('en-IN')} (HIT! 🎉)`;
      } else {
        const awayStr = ltp ? ` (${(((sellTarget - ltp) / ltp) * 100).toFixed(1)}% away)` : '';
        stockText += `\n   🎯 *Sell Target:* Rs. ${sellTarget.toLocaleString('en-IN')}${awayStr}`;
      }
    }

    if (!buyTarget && !sellTarget) {
      stockText += `\n   ℹ️ No targets configured`;
    }

    lines.push(stockText);
  });

  const messageText = `👀 *Your Watchlist*
━━━━━━━━━━━━━━━━━━
` + lines.join('\n\n');

  await sendMessage(chatId, messageText);
}

async function handleHelpCommand(chatId) {
  const helpText = `🤖 *NEPSTRAT Bot Help Menu*
━━━━━━━━━━━━━━━━━━
Here are the commands you can use:

📊 /portfolio — View your current holdings, average cost, LTP, P&L summary, and top gainers/losers.
👀 /watchlist — View your watchlist symbols, target prices, and live hit/distance statuses.
👋 /start — Show instructions to link your Telegram account to your NEPSTRAT account.

Need any help? Visit the NEPSTRAT platform to update your profile, settings, and track all your trades.`;

  await sendMessage(chatId, helpText);
}

// ── Update handler ────────────────────────────────────────────────────────────

async function handleUpdate(update) {
  const message = update.message;
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();
  const lowerText = text.toLowerCase();

  // Route commands
  if (lowerText.startsWith('/start')) {
    const parts = text.split(' ');
    const userCode = parts[1] ? parts[1].trim().toUpperCase() : null;

    if (!userCode) {
      await sendMessage(
        chatId,
        '👋 Welcome to *NEPSTRAT Bot*!\n\nTo link your account, go to *Profile → Notification Settings* in the app and follow the Telegram connect instructions.\n\nType /help to see all available commands.'
      );
      return;
    }

    // Find user by their NEPSTRAT code
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username')
      .eq('code', userCode)
      .maybeSingle();

    if (error || !user) {
      await sendMessage(chatId, '❌ Invalid code. Please check your NEPSTRAT account code and try again.');
      return;
    }

    // Save chat_id and enable telegram notifications
    const { error: updateError } = await supabase
      .from('users')
      .update({ telegram_chat_id: String(chatId), telegram_enabled: true })
      .eq('id', user.id);

    if (updateError) {
      await sendMessage(chatId, '⚠️ Something went wrong linking your account. Please try again later.');
      return;
    }

    await sendMessage(
      chatId,
      `✅ *Telegram linked successfully!*\n\nHello, *${user.username}*! You'll now receive daily NEPSE market summaries here after market close (3:05 PM NPT).\n\nYou can customise your preferences in *Profile → Notification Settings*.\n\nType /portfolio to check your portfolio, or /watchlist to see your watchlists!`
    );
    console.log(`[TelegramBot] Linked chat_id ${chatId} to user ${user.username} (${user.id})`);
  } else if (lowerText.startsWith('/portfolio')) {
    await handlePortfolioCommand(chatId);
  } else if (lowerText.startsWith('/watchlist')) {
    await handleWatchlistCommand(chatId);
  } else if (lowerText.startsWith('/help')) {
    await handleHelpCommand(chatId);
  } else {
    await handleHelpCommand(chatId);
  }
}

// ── Polling loop ─────────────────────────────────────────────────────────────

async function poll() {
  if (!pollingActive) return;

  try {
    const res = await telegramRequest('getUpdates', {
      offset: lastUpdateId + 1,
      timeout: POLL_TIMEOUT,
      allowed_updates: ['message'],
    });

    if (res.ok && Array.isArray(res.result)) {
      for (const update of res.result) {
        if (update.update_id > lastUpdateId) {
          lastUpdateId = update.update_id;
          handleUpdate(update).catch((err) =>
            console.error('[TelegramBot] handleUpdate error:', err.message)
          );
        }
      }
    }
  } catch (err) {
    console.error('[TelegramBot] Poll error:', err.message);
  }

  // Schedule next poll immediately (long-poll already waited)
  setImmediate(() => poll());
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a message directly to a Telegram chat.
 * @param {string} chatId
 * @param {string} text  Markdown text
 */
async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN) return;
  return sendMessage(chatId, text);
}

/**
 * Start the bot polling loop.
 * @param {object} supabaseClient  Supabase client for DB access
 */
function startBot(supabaseClient) {
  if (!BOT_TOKEN) {
    console.warn('[TelegramBot] TELEGRAM_BOT_TOKEN not set — bot disabled.');
    return;
  }
  supabase = supabaseClient;
  pollingActive = true;
  console.log('[TelegramBot] Starting long-poll loop…');
  poll();
}

function stopBot() {
  pollingActive = false;
}

module.exports = { startBot, stopBot, sendTelegramMessage };
