const { verifyAccessToken, extractToken } = require('./auth-utils');

// Middleware to verify JWT and attach user to request
function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    console.log('Auth header present:', !!authHeader); // Debug log
    
    const token = extractToken(authHeader);

    if (!token) {
      console.log('No token extracted from header');
      return res.status(401).json({ error: 'No token provided' });
    }

    console.log('Token extracted, verifying...'); // Debug log
    const decoded = verifyAccessToken(token);
    
    if (!decoded) {
      console.log('Token verification failed - decoded is null/undefined');
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    console.log('Token verified successfully for userId:', decoded.userId); // Debug log
    
    // Validate that we have a userId
    if (!decoded.userId) {
      console.log('Token missing userId');
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