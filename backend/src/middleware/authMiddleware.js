const pool = require("../db/db");

async function requireAuth(req, res, next) {
  const sessionId = req.cookies.session_id;

  if (!sessionId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const result = await pool.query(
      "SELECT sessions.user_id, users.username FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.id = $1 AND sessions.expires_at > NOW()",
      [sessionId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Session invalid or expired" });
    }

    req.user = {
      id: result.rows[0].user_id,
      username: result.rows[0].username,
    };

    next();
  } catch (err) {
    res.status(500).json({ error: "Something went wrong" });
  }
}

module.exports = requireAuth;
