const pool = require("./db");

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function cleanupExpiredSessions() {
  try {
    const result = await pool.query(
      "DELETE FROM sessions WHERE expires_at < NOW()"
    );
    if (result.rowCount > 0) {
      console.log(`Cleaned up ${result.rowCount} expired sessions`);
    }
  } catch (err) {
    console.error("Session cleanup failed:", err);
  }
}

function startSessionCleanup() {
  cleanupExpiredSessions();
  return setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL_MS);
}

module.exports = { startSessionCleanup };
