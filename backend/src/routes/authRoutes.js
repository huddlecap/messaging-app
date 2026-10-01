const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const pool = require("../db/db");
const { validateRegister, validateLogin } = require("../validation");
const { loginLimiter, registerLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

router.post("/register", registerLimiter, async (req, res) => {
  const result = validateRegister(req.body);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  const { username, password } = result.value;

  try {
    const hashResult = await bcrypt.hash(password, 10);

    const insertResult = await pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at",
      [username, hashResult]
    );

    res.status(201).json(insertResult.rows[0]);
  } catch (err) {
    console.error("Register error:", err);
    if (err.code === "23505") {
      return res.status(409).json({ error: "Username already taken" });
    }
    res.status(500).json({ error: "Something went wrong" });
  }
});

router.post("/login", loginLimiter, async (req, res) => {
  const result = validateLogin(req.body);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  const { username, password } = result.value;

  try {
    const result = await pool.query(
      "SELECT id, username, password_hash FROM users WHERE username = $1",
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days from now

    await pool.query(
      "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)",
      [sessionId, user.id, expiresAt]
    );

    res.cookie("session_id", sessionId, {
      httpOnly: true,
      secure: false, // set true once you're on HTTPS (production)
      sameSite: "strict",
      expires: expiresAt,
    });

    res.json({ id: user.id, username: user.username });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

router.post("/logout", async (req, res) => {
  const sessionId = req.cookies.session_id;

  if (sessionId) {
    await pool.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
  }

  res.clearCookie("session_id");
  res.json({ message: "Logged out" });
});

module.exports = router;
