const { verifyAccessToken, extractToken } = require('./auth-utils');

// Middleware to verify JWT and attach user to request
function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = extractToken(authHeader);

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = verifyAccessToken(token);
    
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    // Validate that we have a userId
    if (!decoded.userId) {
      return res.status(401).json({ error: 'Invalid token structure' });
    }

    // Attach user info to request
    req.userId = decoded.userId;
    req.userCode = decoded.code || null; // Handle missing code gracefully

    next();
  } catch (err) {
    // Catch any unexpected errors
    console.error('Auth middleware unexpected error:', {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    return res.status(500).json({ 
      error: 'Authentication failed due to server error',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
}

module.exports = authMiddleware;