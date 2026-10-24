const express = require("express");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");
const app = express();

const trustProxy = Number(process.env.TRUST_PROXY);
if (Number.isInteger(trustProxy) && trustProxy > 0) {
  app.set("trust proxy", trustProxy);
}
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

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// Serve the built frontend when it exists. Mounted after every /api route so an
// unknown /api path still returns the JSON 404, and /ws is never answered with
// HTML (the WebSocket upgrade is handled in index.js).
const distDir = path.join(__dirname, "..", "..", "frontend", "dist");
const indexFile = path.join(distDir, "index.html");

if (fs.existsSync(indexFile)) {
  app.use(express.static(distDir));

  app.get(/^\/(?!api(\/|$)|ws(\/|$))/, (req, res) => {
    res.sendFile(indexFile);
  });
}

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
