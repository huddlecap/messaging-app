require("dotenv").config();
const app = require("./app");
const http = require("http");
const pool = require("./db/db");
const { setupWebSocket } = require("./ws/index");
const { startSessionCleanup } = require("./db/sessionCleanup");

const server = http.createServer(app);
const { wss, heartbeatInterval } = setupWebSocket(server);
const sessionCleanupInterval = startSessionCleanup();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

let isShuttingDown = false;

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} received, shutting down...`);

  const forceExit = setTimeout(() => {
    console.error("Forced exit after timeout");
    process.exit(1);
  }, 10000);
  forceExit.unref();

  let pending = 3;
  function done() {
    pending -= 1;
    if (pending === 0) {
      clearTimeout(forceExit);
      process.exit(0);
    }
  }

  server.close(() => {
    console.log("HTTP server closed");
    done();
  });

  wss.clients.forEach((ws) => ws.terminate());
  wss.close(() => {
    console.log("WebSocket server closed");
    done();
  });

  clearInterval(heartbeatInterval);
  clearInterval(sessionCleanupInterval);

  pool.end(() => {
    console.log("Database pool closed");
    done();
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
