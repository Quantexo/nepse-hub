const express = require('express');
const router = express.Router();
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
  const db = req.app.locals.db;

  // Validate input
  if (!email || !username || !password) {
    return res.status(400).json({ error: 'Email, username, and password required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    // Check if email or username already exists
    const existingUser = db
      .prepare('SELECT id FROM users WHERE email = ? OR username = ?')
      .get(email, username);

    if (existingUser) {
      return res.status(400).json({ error: 'Email or username already exists' });
    }

    // Generate unique code
    const code = await generateUniqueCode(db);

    // Hash password
    const passwordHash = await hashPassword(password);

    // Insert user into database
    const info = db
      .prepare(
        'INSERT INTO users (code, email, username, password_hash, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)'
      )
      .run(code, email, username, passwordHash);

    const userId = info.lastInsertRowid;

    // Generate tokens
    const accessToken = generateAccessToken(userId, code);
    const refreshToken = generateRefreshToken(userId, code);

    res.status(201).json({
      success: true,
      code, // Display code to user
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
  const db = req.app.locals.db;

  // Validate input
  if (!code || !password) {
    return res.status(400).json({ error: 'Code and password required' });
  }

  try {
    // Find user by code
    const user = db.prepare('SELECT id, code, password_hash, email, username FROM users WHERE code = ?').get(code);

    if (!user) {
      return res.status(401).json({ error: 'Invalid code or password' });
    }

    // Verify password
    const isPasswordValid = await verifyPassword(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid code or password' });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user.id, user.code);
    const refreshToken = generateRefreshToken(user.id, user.code);

    res.json({
      success: true,
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

// POST /api/auth/refresh - Refresh access token using refresh token
router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  const db = req.app.locals.db;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  try {
    // Get user to verify still exists
    const user = db.prepare('SELECT id, code FROM users WHERE id = ?').get(decoded.userId);

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(user.id, user.code);

    res.json({
      success: true,
      accessToken: newAccessToken,
    });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// POST /api/auth/logout - Invalidate session (client-side token removal)
router.post('/logout', authMiddleware, (req, res) => {
  // With JWT, logout is primarily client-side (delete token from localStorage)
  // But we can still send a confirmation
  res.json({ success: true, message: 'Logged out successfully' });
});

// GET /api/auth/me - Get current authenticated user info
router.get('/me', authMiddleware, (req, res) => {
  const db = req.app.locals.db;

  try {
    const user = db
      .prepare('SELECT id, code, email, username, created_at FROM users WHERE id = ?')
      .get(req.userId);

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

module.exports = router;
