const express = require("express");
const morgan = require("morgan");
const app = express();
const pool = require("./db/db");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const cookieParser = require("cookie-parser");
const requireAuth = require("./middleware/authMiddleware");
const messageRoutes = require("./routes/messageRoutes");

app.use(morgan("dev"));
app.use(cookieParser());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/messages", requireAuth, messageRoutes);
app.use("/api/users", requireAuth, userRoutes);

app.get("/", (req, res) => {
  res.send("Server is running");
});

app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ success: true, time: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  console.error(err);

  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const status = err.status || 500;
  const message = status === 500 ? "Something went wrong" : err.message;
  res.status(status).json({ error: message });
});

module.exports = app;
