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
  const [liveData, indicesData] = await Promise.allSettled([
    fetchJson('https://nepse-hub-backend.onrender.com/core/live-nepse'),
    fetchJson('https://nepse-hub-backend.onrender.com/core/index-live'),
  ]);

  const stocks = liveData.status === 'fulfilled' && Array.isArray(liveData.value) ? liveData.value : [];
  const indices = indicesData.status === 'fulfilled' ? indicesData.value : null;

  return { stocks, indices };
}

// ── Summary builder ──────────────────────────────────────────────────────────

function buildSummary(stocks, indices) {
  const nepse = indices && (indices.NEPSE || indices.nepse || Object.values(indices)[0]);

  const nepseIndex = nepse
    ? `${parseFloat(nepse.current || nepse.value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${nepse.change >= 0 ? '+' : ''}${parseFloat(nepse.change || nepse.pointChange || 0).toFixed(2)})`
    : 'N/A';

  // Sort by change % for gainers / losers
  const sorted = [...stocks].sort((a, b) => parseFloat(b.changePercent || 0) - parseFloat(a.changePercent || 0));

  const topGainers = sorted.slice(0, 5);
  const topLosers = sorted.slice(-5).reverse();

  // Circuit hits (upper & lower)
  const upperCircuit = stocks.filter((s) => parseFloat(s.changePercent || 0) >= 10);
  const lowerCircuit = stocks.filter((s) => parseFloat(s.changePercent || 0) <= -10);

  return { nepseIndex, topGainers, topLosers, upperCircuit, lowerCircuit };
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
  const { stocks, indices } = await fetchMarketData();

  if (!stocks.length) {
    console.warn('[MarketSummary] No stock data available — skipping dispatch.');
    return;
  }

  const summary = buildSummary(stocks, indices);
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

  let emailsSent = 0;
  let telegramSent = 0;

  for (const user of users) {
    if (user.market_summary_frequency === 'weekly' && !isWeekly) continue;

    const telegramText = formatTelegramMessage(summary, user.username);
    const emailHtml = formatEmailHtml(summary, user.username);
    const emailSubject = `📊 NEPSE Daily Summary — ${new Date().toLocaleDateString('en-NP', { timeZone: 'Asia/Kathmandu' })}`;

    if (user.telegram_enabled && user.telegram_chat_id) {
      try {
        await sendTelegramMessage(user.telegram_chat_id, telegramText);
        telegramSent++;
      } catch (e) {
        console.error(`[MarketSummary] Telegram failed for user ${user.id}:`, e.message);
      }
    }

    if (user.email_enabled && user.email) {
      await sendEmail(user.email, emailSubject, emailHtml);
      emailsSent++;
    }
  }

  console.log(`[MarketSummary] Dispatch complete — Telegram: ${telegramSent}, Email: ${emailsSent}`);
}

module.exports = { dispatchDailySummary };
