/**
 * Rate Limiting for WebSocket Connections
 * Prevents abuse and ensures fair resource usage
 */

const rateLimits = new Map(); // clientId -> { count, resetTime }
const RATE_LIMIT_WINDOW = 1000; // 1 second window
const RATE_LIMIT_MAX = 100; // Max 100 messages per second per client

/**
 * Check if a client is rate limited
 * @param {string|number} clientId - Unique client identifier
 * @returns {boolean} - true if request allowed, false if rate limited
 */
function checkRateLimit(clientId) {
  const now = Date.now();
  let clientLimit = rateLimits.get(clientId);

  if (!clientLimit || now > clientLimit.resetTime) {
    clientLimit = { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
    rateLimits.set(clientId, clientLimit);
  }

  clientLimit.count++;

  if (clientLimit.count > RATE_LIMIT_MAX) {
    return false; // Rate limited
  }

  return true;
}

/**
 * Clean up old rate limit entries
 * Should be called periodically (e.g., every minute)
 */
function cleanupRateLimits() {
  const now = Date.now();
  for (const [clientId, limit] of rateLimits.entries()) {
    if (now > limit.resetTime + 60000) {
      rateLimits.delete(clientId);
    }
  }
}

/**
 * Start automatic cleanup of rate limits
 * @param {number} intervalMs - Cleanup interval in milliseconds (default: 60000)
 */
function startCleanupInterval(intervalMs = 60000) {
  setInterval(cleanupRateLimits, intervalMs);
}

/**
 * Get current rate limit status for a client
 * @param {string|number} clientId - Unique client identifier
 * @returns {object|null} - Rate limit info or null if not tracked
 */
function getRateLimitStatus(clientId) {
  return rateLimits.get(clientId) || null;
}

module.exports = {
  checkRateLimit,
  cleanupRateLimits,
  startCleanupInterval,
  getRateLimitStatus,
  RATE_LIMIT_WINDOW,
  RATE_LIMIT_MAX
};
