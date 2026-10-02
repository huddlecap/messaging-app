const express = require("express");
const pool = require("../db/db");

const router = express.Router();

router.get("/", async (req, res) => {
  const currentUserId = req.user.id;

  try {
    const result = await pool.query(
      "SELECT id, username FROM users WHERE id != $1 ORDER BY username",
      [currentUserId]
    );

    res.json({ users: result.rows });
  } catch (err) {
    console.error("Users list error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

module.exports = router;