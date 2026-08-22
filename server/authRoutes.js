const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const {
  generateUniqueCode,
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require('./auth-utils');
const authMiddleware = require('./auth-middleware');
const { sendTelegramMessage } = require('./telegramBot');

// POST /api/auth/register - Create new user with auto-generated code
router.post('/register', async (req, res) => {
  const { email, username, password } = req.body;
  const supabase = req.app.locals.supabase;

  if (!email || !username || !password) {
    return res.status(400).json({ error: 'Email, username, and password required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (checkError) throw checkError;

    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const code = await generateUniqueCode(supabase);
    const passwordHash = await hashPassword(password);

    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([{ code, email, username, password_hash: passwordHash }])
      .select('id')
      .single();

    if (insertError) throw insertError;

    const userId = newUser.id;
    const accessToken = generateAccessToken(userId, code);
    const refreshToken = generateRefreshToken(userId, code);

    // Set refresh token in HttpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: true, // Must be true for SameSite=None
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/api/auth'
    });

    res.status(201).json({
      success: true,
      id: userId,
      code,
      email,
      username,
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login - Authenticate with code and password
router.post('/login', async (req, res) => {
  const { code, password } = req.body;
  const supabase = req.app.locals.supabase;

  if (!code || !password) {
    return res.status(400).json({ error: 'Code and password required' });
  }

  try {
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('id, code, password_hash, email, username')
      .eq('code', code)
      .maybeSingle();

    if (findError) throw findError;

    if (!user) {
      return res.status(401).json({ error: 'Invalid code or password' });
    }

    const isPasswordValid = await verifyPassword(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid code or password' });
    }

    const accessToken = generateAccessToken(user.id, user.code);
    const refreshToken = generateRefreshToken(user.id, user.code);

    // Set refresh token in HttpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: true, // Must be true for SameSite=None
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/api/auth'
    });

    res.json({
      success: true,
      id: user.id,
      code: user.code,
      email: user.email,
      username: user.username,
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/refresh - Refresh access token using refresh token from cookie or body
router.post('/refresh', async (req, res) => {
  // Helper to extract cookie value
  let refreshToken = null;
  if (req.headers.cookie) {
    const cookies = req.headers.cookie.split(';').reduce((acc, cookie) => {
      const parts = cookie.split('=');
      acc[parts[0].trim()] = (parts[1] || '').trim();
      return acc;
    }, {});
    refreshToken = cookies.refreshToken;
  }

  // Fallback to body for cross-site requests where third-party cookies are blocked
  if (!refreshToken) {
    refreshToken = req.body.refreshToken;
  }

  const supabase = req.app.locals.supabase;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  try {
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('id, code')
      .eq('id', decoded.userId)
      .maybeSingle();

    if (findError) throw findError;

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const newAccessToken = generateAccessToken(user.id, user.code);
    const newRefreshToken = generateRefreshToken(user.id, user.code);

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/auth'
    });

    res.json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// POST /api/auth/logout - Invalidate session by clearing httpOnly cookie
router.post('/logout', authMiddleware, (req, res) => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/api/auth'
  });
  res.json({ success: true, message: 'Logged out successfully' });
});

// GET /api/auth/me - Get current authenticated user info
router.get('/me', authMiddleware, async (req, res) => {
  const supabase = req.app.locals.supabase;

  try {
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('id, code, email, username, created_at')
      .eq('id', req.userId)
      .maybeSingle();

    if (findError) throw findError;

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      id: user.id,
      code: user.code,
      email: user.email,
      username: user.username,
      createdAt: user.created_at,
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// GET /api/auth/notification-settings - Get notification preferences for logged-in user
router.get('/notification-settings', authMiddleware, async (req, res) => {
  const supabase = req.app.locals.supabase;
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('market_summary_frequency, email_enabled, telegram_enabled, telegram_chat_id')
      .eq('id', req.userId)
      .maybeSingle();

    if (error) throw error;
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      settings: {
        marketSummaryFrequency: user.market_summary_frequency || 'never',
        emailEnabled: !!user.email_enabled,
        telegramEnabled: !!user.telegram_enabled,
        telegramConnected: !!user.telegram_chat_id,
      }
    });
  } catch (err) {
    console.error('Fetch notification settings error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve notification settings' });
  }
});

// PUT /api/auth/notification-settings - Update notification preferences
router.put('/notification-settings', authMiddleware, async (req, res) => {
  const { marketSummaryFrequency, emailEnabled, telegramEnabled } = req.body;
  const supabase = req.app.locals.supabase;

  try {
    const { error } = await supabase
      .from('users')
      .update({
        market_summary_frequency: marketSummaryFrequency,
        email_enabled: emailEnabled,
        telegram_enabled: telegramEnabled
      })
      .eq('id', req.userId);

    if (error) throw error;
    res.json({ success: true, message: 'Notification settings updated successfully' });
  } catch (err) {
    console.error('Update notification settings error:', err.message);
    res.status(500).json({ error: 'Failed to update notification settings' });
  }
});

// GET /api/auth/telegram-status - Check if Telegram is linked for this user
router.get('/telegram-status', authMiddleware, async (req, res) => {
  const supabase = req.app.locals.supabase;
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('telegram_chat_id')
      .eq('id', req.userId)
      .maybeSingle();

    if (error) throw error;
    res.json({
      success: true,
      connected: !!(user && user.telegram_chat_id)
    });
  } catch (err) {
    console.error('Fetch telegram status error:', err.message);
    res.status(500).json({ error: 'Failed to fetch connection status' });
  }
});

// ── Email Reset Sender Helper (Brevo HTTPS API — no SMTP port needed) ──
async function sendResetCodeEmail(email, code) {
  if (!process.env.BREVO_API_KEY) {
    // Fallback: print to console for local development
    console.log('\n==================================================');
    console.log('📬 [SIMULATED EMAIL — BREVO_API_KEY not set]');
    console.log(`To: ${email}`);
    console.log(`Verification Code: ${code}`);
    console.log('==================================================\n');
    return;
  }

  const senderName = process.env.BREVO_SENDER_NAME || 'NEPSTRAT';
  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'nepstrat@gmail.com';

  console.log(`[Brevo] Sending password reset code email to: ${email}`);

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email }],
      subject: 'NEPSTRAT - Password Reset Verification Code',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #10b981; text-align: center;">NEPSTRAT</h2>
          <p>Hello,</p>
          <p>We received a request to reset the password for your NEPSTRAT account. Your password reset verification code is:</p>
          <div style="text-align: center; margin: 30px 0;">
            <span style="background-color: #f1f5f9; color: #0f172a; padding: 12px 28px; font-size: 28px; font-weight: bold; letter-spacing: 4px; border-radius: 8px; border: 1px solid #cbd5e1; display: inline-block;">${code}</span>
          </div>
          <p style="color: #64748b; font-size: 13px;">This code will expire in 15 minutes. If you did not request a password reset, please ignore this email.</p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="color: #94a3b8; font-size: 11px; text-align: center;">NEPSTRAT &copy; 2026. All rights reserved.</p>
        </div>
      `,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('[Brevo] Email send failed:', JSON.stringify(result));
    throw new Error(`Brevo API error: ${result.message || JSON.stringify(result)}`);
  }

  console.log(`[Brevo] Email sent successfully. messageId: ${result.messageId}`);
}

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const supabase = req.app.locals.supabase;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('id, email, telegram_chat_id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (findError) throw findError;

    // Standard security: don't leak account existence
    if (!user) {
      return res.json({
        success: true,
        message: 'If the email exists, a password reset code has been sent.',
      });
    }

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    const { error: updateError } = await supabase
      .from('users')
      .update({
        reset_token: resetCode,
        reset_token_expiry: resetTokenExpiry.toISOString(),
      })
      .eq('id', user.id);

    if (updateError) throw updateError;

    const isTelegramLinked = !!(user.telegram_chat_id && String(user.telegram_chat_id).trim());

    if (isTelegramLinked) {
      const messageText = `🔑 *NEPSTRAT Password Reset*\n\nYour 6-digit verification code is: *${resetCode}*\n\nThis code will expire in 15 minutes. Do not share this code with anyone.`;
      await sendTelegramMessage(user.telegram_chat_id, messageText);
      return res.json({
        success: true,
        channel: 'telegram',
        message: 'Verification code sent to your linked Telegram account.',
      });
    } else {
      await sendResetCodeEmail(user.email, resetCode);
      return res.json({
        success: true,
        channel: 'email',
        message: 'Verification code sent to your email address.',
      });
    }
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { code, password, email } = req.body;
  const supabase = req.app.locals.supabase;

  if (!code || !password) {
    return res.status(400).json({ error: 'Verification code and new password are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    let query = supabase
      .from('users')
      .select('id, reset_token_expiry')
      .eq('reset_token', String(code).trim());

    if (email && typeof email === 'string' && email.trim()) {
      query = query.eq('email', email.trim().toLowerCase());
    }

    const { data: user, error: findError } = await query.maybeSingle();

    if (findError) throw findError;

    if (!user) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    const now = new Date();
    const expiry = new Date(user.reset_token_expiry);
    if (now > expiry) {
      return res.status(400).json({ error: 'Verification code has expired. Please request a new code.' });
    }

    const passwordHash = await hashPassword(password);
    const { error: updateError } = await supabase
      .from('users')
      .update({
        password_hash: passwordHash,
        reset_token: null,
        reset_token_expiry: null,
      })
      .eq('id', user.id);

    if (updateError) throw updateError;

    res.json({ success: true, message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
