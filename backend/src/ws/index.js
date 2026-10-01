const { WebSocketServer } = require("ws");
const { parseCookie } = require("cookie");
const pool = require("../db/db");
const { validateReadReceipt, validateMessagePayload } = require("../validation");

const userSockets = new Map();

function setupWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  server.on("upgrade", async (req, socket, head) => {
    const cookies = parseCookie(req.headers.cookie || "");
    const sessionId = cookies.session_id;

    if (!sessionId) {
      socket.destroy();
      return;
    }

    try {
      const result = await pool.query(
        "SELECT user_id FROM sessions WHERE id = $1 AND expires_at > NOW()",
        [sessionId]
      );

      if (result.rows.length === 0) {
        socket.destroy();
        return;
      }

      const userId = result.rows[0].user_id;

      wss.handleUpgrade(req, socket, head, (ws) => {
        const existingSocket = userSockets.get(userId);
        if (existingSocket) {
          existingSocket.terminate();
        }

        userSockets.set(userId, ws);
        ws.isAlive = true;
        console.log(`User ${userId} connected via WebSocket`);

        ws.on("pong", () => {
          ws.isAlive = true;
        });

        ws.on("message", async (data) => {
          try {
            let parsed;
            try {
              parsed = JSON.parse(data);
            } catch {
              ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
              return;
            }

            if (parsed.type === "read_receipt") {
              const receiptResult = validateReadReceipt(parsed);
              if (!receiptResult.ok) {
                ws.send(
                  JSON.stringify({ type: "error", message: receiptResult.error })
                );
                return;
              }
              const { message_id } = receiptResult.value;

              const dbResult = await pool.query(
                "UPDATE messages SET read_at = NOW() WHERE id = $1 AND receiver_id = $2 AND read_at IS NULL RETURNING id, sender_id, read_at",
                [message_id, userId]
              );

              if (dbResult.rowCount === 0) return;

              const { sender_id, read_at } = dbResult.rows[0];
              const senderSocket = userSockets.get(sender_id);
              if (senderSocket) {
                senderSocket.send(
                  JSON.stringify({ type: "read_receipt", message_id, read_at })
                );
              }
              return;
            }

            const payloadResult = validateMessagePayload(parsed);
            if (!payloadResult.ok) {
              ws.send(
                JSON.stringify({ type: "error", message: payloadResult.error })
              );
              return;
            }
            const { receiver_id, content, client_message_id } = payloadResult.value;

            if (receiver_id === userId) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Cannot send a message to yourself",
                })
              );
              return;
            }

            const receiverCheck = await pool.query(
              "SELECT id FROM users WHERE id = $1",
              [receiver_id]
            );

            if (receiverCheck.rowCount === 0) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Receiver does not exist",
                })
              );
              return;
            }

            let savedMessage;

            try {
              const result = await pool.query(
                "INSERT INTO messages (sender_id, receiver_id, content, client_message_id) VALUES ($1, $2, $3, $4) RETURNING id, sender_id, receiver_id, content, created_at",
                [userId, receiver_id, content, client_message_id]
              );
              savedMessage = result.rows[0];
            } catch (err) {
              if (err.code === "23505") {
                const existing = await pool.query(
                  "SELECT id, sender_id, receiver_id, content, created_at FROM messages WHERE client_message_id = $1",
                  [client_message_id]
                );
                savedMessage = existing.rows[0];
              } else {
                throw err;
              }
            }

            const receiverSocket = userSockets.get(receiver_id);
            if (receiverSocket) {
              receiverSocket.send(JSON.stringify(savedMessage));
            }

            ws.send(JSON.stringify(savedMessage));
          } catch (err) {
            console.error("Error handling message:", err);
          }
        });
        ws.on("close", () => {
          if (userSockets.get(userId) === ws) {
            userSockets.delete(userId);
          }
          console.log(`User ${userId} disconnected`);
        });
      });
    } catch (err) {
      socket.destroy();
    }
  });
  return { wss, heartbeatInterval };
}

module.exports = { setupWebSocket, userSockets };
