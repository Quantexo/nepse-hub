const { verifyAccessToken, extractToken } = require('./auth-utils');

// Middleware to verify JWT and attach user to request
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = extractToken(authHeader);

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const decoded = verifyAccessToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Attach user info to request
  req.userId = decoded.userId;
  req.userCode = decoded.code;

  next();
}

module.exports = authMiddleware;
