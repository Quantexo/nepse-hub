/**
 * telegramBot.js
 * Polls the Telegram Bot API for new messages, handles /start <code>
 * to link a user's Telegram chat_id to their NEPSE HUB account.
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

// ── Update handler ────────────────────────────────────────────────────────────

async function handleUpdate(update) {
  const message = update.message;
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();

  // /start <code>  — links Telegram to a NEPSE HUB account
  if (text.startsWith('/start')) {
    const parts = text.split(' ');
    const userCode = parts[1] ? parts[1].trim().toUpperCase() : null;

    if (!userCode) {
      await sendMessage(
        chatId,
        '👋 Welcome to *NEPSE HUB Bot*!\n\nTo link your account, go to *Profile → Notification Settings* in the app and follow the Telegram connect instructions.'
      );
      return;
    }

    // Find user by their NEPSE HUB code
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username')
      .eq('code', userCode)
      .maybeSingle();

    if (error || !user) {
      await sendMessage(chatId, '❌ Invalid code. Please check your NEPSE HUB account code and try again.');
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
      `✅ *Telegram linked successfully!*\n\nHello, *${user.username}*! You'll now receive daily NEPSE market summaries here after market close (3:05 PM NPT).\n\nYou can customise your preferences in *Profile → Notification Settings*.`
    );
    console.log(`[TelegramBot] Linked chat_id ${chatId} to user ${user.username} (${user.id})`);
  } else {
    await sendMessage(
      chatId,
      '🤖 I only support the `/start` command right now.\n\nUse `/start YOUR_CODE` to link your NEPSE HUB account.'
    );
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
