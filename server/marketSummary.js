/**
 * marketSummary.js
 * Fetches live NEPSE data and formats a daily market summary.
 * Dispatches the summary via Email (Nodemailer/SendGrid) and Telegram.
 */

const https = require('https');
const { sendTelegramMessage } = require('./telegramBot');

// ── Data fetching ─────────────────────────────────────────────────────────────

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

async function fetchMarketData() {
  const homepageData = await fetchJson('https://nepse-hub-backend.onrender.com/core/homepage-data');

  if (!homepageData) {
    return { indices: null, topGainers: [], topLosers: [] };
  }

  const indices = homepageData.indices || null;
  const topGainers = homepageData.topGainers || [];
  const topLosers = homepageData.topLosers || [];

  return { indices, topGainers, topLosers };
}

// ── Summary builder ──────────────────────────────────────────────────────────

function buildSummary(indices, topGainers, topLosers) {
  // Normalize stocks to have consistent fields (symbol, price, changePercent)
  const normalizeStock = s => ({
    symbol: s.symbol,
    price: parseFloat(s.price || s.lastTradedPrice || 0),
    changePercent: parseFloat(s.changePercent || s.percentageChange || 0)
  });

  const normalizedGainers = (topGainers || []).map(normalizeStock);
  const normalizedLosers = (topLosers || []).map(normalizeStock);

  // Normalize indices to find the NEPSE index
  let nepse = null;
  if (indices) {
    if (Array.isArray(indices)) {
      nepse = indices.find(idx => (idx.name && idx.name.toLowerCase() === 'nepse') || (idx.symbol && idx.symbol.toLowerCase() === 'nepse') || (idx.indexName && idx.indexName.toLowerCase() === 'nepse'));
    } else if (indices.result && Array.isArray(indices.result)) {
      nepse = indices.result.find(idx => (idx.name && idx.name.toLowerCase() === 'nepse') || (idx.symbol && idx.symbol.toLowerCase() === 'nepse') || (idx.indexName && idx.indexName.toLowerCase() === 'nepse'));
    } else if (typeof indices === 'object') {
      nepse = indices.NEPSE || indices.nepse || Object.values(indices)[0];
    }
  }

  // Normalize nepse index structure
  let nepseIndex = 'N/A';
  if (nepse) {
    const current = parseFloat(nepse.currentValue || nepse.current || nepse.indexValue || nepse.value || 0);
    const change = parseFloat(nepse.change || nepse.difference || nepse.pointChange || 0);
    const sign = change >= 0 ? '+' : '';
    nepseIndex = `${current.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${sign}${change.toFixed(2)})`;
  }

  const finalGainers = normalizedGainers.slice(0, 5);
  const finalLosers = normalizedLosers.slice(0, 5);

  // Circuit hits (upper & lower)
  const upperCircuit = normalizedGainers.filter((s) => s.changePercent >= 14.9);
  const lowerCircuit = normalizedLosers.filter((s) => s.changePercent <= -14.9);

  return { nepseIndex, topGainers: finalGainers, topLosers: finalLosers, upperCircuit, lowerCircuit };
}

// ── Formatters ─────────────────────────────────────────────────────────────────

function formatTelegramMessage({ nepseIndex, topGainers, topLosers, upperCircuit, lowerCircuit }, username) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Kathmandu',
  });

  const gainersText = topGainers.length
    ? topGainers
        .map(
          (s) =>
            `  • *${s.symbol}*  Rs.${parseFloat(s.price || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })}  (+${parseFloat(s.changePercent || 0).toFixed(2)}%)`
        )
        .join('\n')
    : '  No data';

  const losersText = topLosers.length
    ? topLosers
        .map(
          (s) =>
            `  • *${s.symbol}*  Rs.${parseFloat(s.price || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })}  (${parseFloat(s.changePercent || 0).toFixed(2)}%)`
        )
        .join('\n')
    : '  No data';

  const circuitText =
    upperCircuit.length || lowerCircuit.length
      ? [
          upperCircuit.length ? `  🟢 Upper: ${upperCircuit.map((s) => s.symbol).join(', ')}` : '',
          lowerCircuit.length ? `  🔴 Lower: ${lowerCircuit.map((s) => s.symbol).join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '  None today';

  return `📊 *NEPSE Daily Summary — ${today}*
${username ? `Hello, *${username}*!\n` : ''}
🏦 *NEPSE Index:* ${nepseIndex}

📈 *Top Gainers:*
${gainersText}

📉 *Top Losers:*
${losersText}

⚡ *Circuit Hits:*
${circuitText}

_Sent by NEPSE HUB · Manage notifications in your profile settings_`;
}

function formatEmailHtml({ nepseIndex, topGainers, topLosers, upperCircuit, lowerCircuit }, username) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Kathmandu',
  });

  const stockRow = (s, isGainer) => {
    const change = parseFloat(s.changePercent || 0);
    const color = isGainer ? '#10b981' : '#ef4444';
    const sign = isGainer ? '+' : '';
    return `<tr>
      <td style="padding:6px 12px;font-weight:700;color:#e2e8f0">${s.symbol}</td>
      <td style="padding:6px 12px;color:#cbd5e1">Rs. ${parseFloat(s.price || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })}</td>
      <td style="padding:6px 12px;color:${color};font-weight:700">${sign}${change.toFixed(2)}%</td>
    </tr>`;
  };

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>NEPSE Daily Summary</title></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:32px auto;background:#1e293b;border-radius:16px;overflow:hidden">
    <tr>
      <td style="background:linear-gradient(135deg,#6366f1,#3b82f6);padding:32px 40px;text-align:center">
        <h1 style="margin:0;font-size:22px;color:#fff;letter-spacing:-0.5px">📊 NEPSE Daily Summary</h1>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:14px">${today}</p>
      </td>
    </tr>
    <tr><td style="padding:32px 40px">
      ${username ? `<p style="color:#94a3b8;margin:0 0 24px">Hello, <strong style="color:#e2e8f0">${username}</strong>! Here's today's market recap.</p>` : ''}

      <div style="background:#0f172a;border-radius:12px;padding:20px 24px;margin-bottom:24px;text-align:center">
        <p style="margin:0 0 4px;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px">NEPSE Index</p>
        <p style="margin:0;font-size:28px;font-weight:800;color:#e2e8f0">${nepseIndex}</p>
      </div>

      <h3 style="color:#10b981;margin:0 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:1px">📈 Top Gainers</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:10px;margin-bottom:24px;overflow:hidden">
        ${topGainers.map((s) => stockRow(s, true)).join('')}
      </table>

      <h3 style="color:#ef4444;margin:0 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:1px">📉 Top Losers</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:10px;margin-bottom:24px;overflow:hidden">
        ${topLosers.map((s) => stockRow(s, false)).join('')}
      </table>

      ${
        upperCircuit.length || lowerCircuit.length
          ? `<div style="background:#0f172a;border-radius:10px;padding:16px 20px;margin-bottom:24px">
        <h3 style="color:#f59e0b;margin:0 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:1px">⚡ Circuit Hits</h3>
        ${upperCircuit.length ? `<p style="margin:0 0 6px;color:#10b981"><strong>Upper Circuit:</strong> ${upperCircuit.map((s) => s.symbol).join(', ')}</p>` : ''}
        ${lowerCircuit.length ? `<p style="margin:0;color:#ef4444"><strong>Lower Circuit:</strong> ${lowerCircuit.map((s) => s.symbol).join(', ')}</p>` : ''}
      </div>`
          : ''
      }

      <p style="color:#475569;font-size:12px;text-align:center;margin:0">
        Sent by <strong style="color:#6366f1">NEPSE HUB</strong> · 
        You can manage your notification preferences in your profile settings.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Email sender ─────────────────────────────────────────────────────────────

async function sendEmail(to, subject, html) {
  // Lazy-require nodemailer so the server doesn't crash if it's not installed
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    console.warn('[MarketSummary] nodemailer not installed — email skipped.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  try {
    await transporter.sendMail({
      from: `"NEPSE HUB" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`[MarketSummary] Email sent to ${to}`);
  } catch (err) {
    console.error(`[MarketSummary] Email failed to ${to}:`, err.message);
  }
}

// ── Main dispatch ────────────────────────────────────────────────────────────

async function dispatchDailySummary(supabase) {
  console.log('[MarketSummary] Fetching market data…');
  const { indices, topGainers, topLosers } = await fetchMarketData();

  if (!topGainers.length && !topLosers.length) {
    console.warn('[MarketSummary] No stock data available — skipping dispatch.');
    return;
  }

  const summary = buildSummary(indices, topGainers, topLosers);
  console.log('[MarketSummary] Summary built. Fetching eligible users…');

  // Get all users that have at least one notification channel enabled and
  // a frequency that includes 'daily'
  const { data: users, error } = await supabase
    .from('users')
    .select('id, username, email, email_enabled, telegram_enabled, telegram_chat_id, market_summary_frequency')
    .in('market_summary_frequency', ['daily', 'weekly']); // send on all trading days for 'daily'; filter 'weekly' below

  if (error) {
    console.error('[MarketSummary] Error fetching users:', error.message);
    return;
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kathmandu' });
  const isWeekly = today === 'Friday'; // Send weekly digest on Fridays

  let telegramSent = 0;

  for (const user of users) {
    if (user.market_summary_frequency === 'weekly' && !isWeekly) continue;

    const telegramText = formatTelegramMessage(summary, user.username);

    if (user.telegram_enabled && user.telegram_chat_id) {
      try {
        await sendTelegramMessage(user.telegram_chat_id, telegramText);
        telegramSent++;
      } catch (e) {
        console.error(`[MarketSummary] Telegram failed for user ${user.id}:`, e.message);
      }
    }
  }

  console.log(`[MarketSummary] Dispatch complete — Telegram: ${telegramSent}`);
}

async function dispatchTestSummary(supabase, userId) {
  console.log(`[MarketSummary] Fetching market data for test dispatch (User: ${userId})…`);
  let { indices, topGainers, topLosers } = await fetchMarketData();

  // If the market is closed and both live fetch and DB are somehow completely empty, use mock data as a last-resort fallback.
  if ((!topGainers || !topGainers.length) && (!topLosers || !topLosers.length)) {
    console.log('[MarketSummary] Market data not available. Using mock stock/index data for test summary.');
    topGainers = [
      { symbol: 'AHPC', lastTradedPrice: 280, changePercent: 10.0 },
      { symbol: 'NABIL', lastTradedPrice: 950, changePercent: 2.5 },
      { symbol: 'HDL', lastTradedPrice: 1950, changePercent: 1.8 }
    ];
    topLosers = [
      { symbol: 'NICA', lastTradedPrice: 780, changePercent: -10.0 },
      { symbol: 'GBIME', lastTradedPrice: 340, changePercent: -1.2 }
    ];
    indices = [
      { symbol: 'NEPSE', name: 'NEPSE', currentValue: 2056.45, change: 12.34, changePercent: 0.6 }
    ];
  }

  const summary = buildSummary(indices, topGainers, topLosers);

  // Fetch the target test user
  const { data: user, error } = await supabase
    .from('users')
    .select('id, username, email, email_enabled, telegram_enabled, telegram_chat_id')
    .eq('id', userId)
    .maybeSingle();

  if (error || !user) {
    throw new Error(error ? error.message : 'User not found');
  }

  const results = {
    telegram: { attempted: false, success: false, error: null }
  };

  const telegramText = formatTelegramMessage(summary, user.username);

  // Attempt to send Telegram
  if (user.telegram_chat_id) {
    results.telegram.attempted = true;
    try {
      await sendTelegramMessage(user.telegram_chat_id, `🔔 [TEST NOTIFICATION]\n\n` + telegramText);
      results.telegram.success = true;
    } catch (e) {
      console.error(`[MarketSummary] Test Telegram failed for user ${user.id}:`, e.message);
      results.telegram.error = e.message;
    }
  } else {
    results.telegram.error = 'Telegram not linked (no chat ID). Connect in Profile first.';
  }

  return results;
}

module.exports = { dispatchDailySummary, dispatchTestSummary };
