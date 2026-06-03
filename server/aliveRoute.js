// aliveRoute.js
// Public health check endpoint - no authentication required

const express = require('express');
const router = express.Router();

/**
 * GET /api/alive
 * Returns server status and current timestamp.
 * Useful for monitoring, load balancers, and uptime checks.
 * No authentication token required.
 */
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'NEPSE Hub backend is running'
  });
});

module.exports = router;