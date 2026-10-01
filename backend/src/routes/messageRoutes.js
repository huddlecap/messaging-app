const express = require("express");
const pool = require("../db/db");
const { validateHistoryQuery } = require("../validation");

const router = express.Router();

router.get("/:otherUserId", async (req, res) => {
  const currentUserId = req.user.id;
  const result = validateHistoryQuery(req.params, req.query);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  const { otherUserId, before, limit } = result.value;

  try {
    const userCheck = await pool.query("SELECT id FROM users WHERE id = $1", [
      otherUserId,
    ]);

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: "User does not exist" });
    }

    const queryResult = await pool.query(
      `SELECT id, sender_id, receiver_id, content, created_at
       FROM messages
       WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))
       AND ($3::int IS NULL OR id < $3)
       ORDER BY id DESC
       LIMIT $4`,
      [currentUserId, otherUserId, before, limit]
    );

    const messages = queryResult.rows;
    const nextCursor =
      messages.length > 0 ? messages[messages.length - 1].id : null;

    res.json({ messages, nextCursor });
  } catch (err) {
    console.error("History error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

module.exports = router;
