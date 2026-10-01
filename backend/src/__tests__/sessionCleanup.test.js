const pool = require("../db/db");
const { startSessionCleanup } = require("../db/sessionCleanup");

const username = `test_cleanup_${Date.now()}`;
const password = "testpass123";
const expiredSessionId = `test_cleanup_expired_${Date.now()}`;
const validSessionId = `test_cleanup_valid_${Date.now()}`;

let userId;
let cleanupInterval;

async function pollUntil(conditionFn, timeoutMs = 5000, intervalMs = 200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await conditionFn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("pollUntil timed out");
}

describe("Session cleanup", () => {
  beforeAll(async () => {
    const bcrypt = require("bcrypt");
    const hash = await bcrypt.hash(password, 10);
    const userRes = await pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
      [username, hash]
    );
    userId = userRes.rows[0].id;

    await pool.query(
      "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, NOW() - INTERVAL '2 hours')",
      [expiredSessionId, userId]
    );
    await pool.query(
      "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')",
      [validSessionId, userId]
    );
  });

  afterAll(async () => {
    if (cleanupInterval) clearInterval(cleanupInterval);
    await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    await pool.end();
  });

  test("expired session is deleted, valid session is untouched", async () => {
    cleanupInterval = startSessionCleanup();

    await pollUntil(async () => {
      const check = await pool.query("SELECT id FROM sessions WHERE id = $1", [expiredSessionId]);
      return check.rows.length === 0;
    });

    const expiredCheck = await pool.query("SELECT id FROM sessions WHERE id = $1", [expiredSessionId]);
    expect(expiredCheck.rows.length).toBe(0);

    const validCheck = await pool.query("SELECT id FROM sessions WHERE id = $1", [validSessionId]);
    expect(validCheck.rows.length).toBe(1);
  }, 10000);
});
