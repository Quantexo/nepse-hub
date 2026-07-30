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
      .or(`email.eq.${email},username.eq.${username}`)
      .maybeSingle();

    if (checkError) throw checkError;

    if (existingUser) {
      return res.status(400).json({ error: 'Email or username already exists' });
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
async function sendResetEmail(email, resetUrl) {
  if (!process.env.BREVO_API_KEY) {
    // Fallback: print to console for local development
    console.log('\n==================================================');
    console.log('📬 [SIMULATED EMAIL — BREVO_API_KEY not set]');
    console.log(`To: ${email}`);
    console.log(`Reset URL: ${resetUrl}`);
    console.log('==================================================\n');
    return;
  }

  const senderName = process.env.BREVO_SENDER_NAME || 'NEPSE HUB';
  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'nepsehub2@gmail.com';

  console.log(`[Brevo] Sending reset email to: ${email}`);

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
      subject: 'Reset Your NEPSE HUB Password',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #10b981; text-align: center;">NEPSE HUB</h2>
          <p>Hello,</p>
          <p>We received a request to reset the password for your NEPSE HUB account. Click the button below to set a new password. This link will expire in 1 hour.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Reset Password</a>
          </div>
          <p style="color: #64748b; font-size: 13px;">If you did not request a password reset, please ignore this email.</p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="color: #94a3b8; font-size: 11px; text-align: center;">NEPSE HUB &copy; 2026. All rights reserved.</p>
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
      .select('id, email')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (findError) throw findError;

    // Standard security: don't leak account existence
    if (!user) {
      return res.json({ success: true, message: 'If the email exists, a reset link has been sent.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

    const { error: updateError } = await supabase
      .from('users')
      .update({
        reset_token: resetToken,
        reset_token_expiry: resetTokenExpiry.toISOString(),
      })
      .eq('id', user.id);

    if (updateError) throw updateError;

    const origin = req.headers.origin || 'http://localhost:5500';
    const resetUrl = `${origin}/pages/reset-password.html?token=${resetToken}`;

    await sendResetEmail(user.email, resetUrl);

    res.json({ success: true, message: 'If the email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  const supabase = req.app.locals.supabase;

  if (!token || !password) {
    return res.status(400).json({ error: 'Token and new password are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('id, reset_token_expiry')
      .eq('reset_token', token)
      .maybeSingle();

    if (findError) throw findError;

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired password reset token' });
    }

    const now = new Date();
    const expiry = new Date(user.reset_token_expiry);
    if (now > expiry) {
      return res.status(400).json({ error: 'Password reset token has expired' });
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
