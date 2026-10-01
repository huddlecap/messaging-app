const request = require("supertest");
const http = require("http");
const WebSocket = require("ws");
const app = require("../app");
const pool = require("../db/db");
const { setupWebSocket } = require("../ws/index");

const usernameA = `test_ws_a_${Date.now()}`;
const usernameB = `test_ws_b_${Date.now()}`;
const password = "testpass123";

let userA, userB, cookieA, cookieB;
let server, wss, heartbeatInterval, port;
let wsA, wsB, wsA2;

function extractCookie(setCookieHeader) {
  const raw = setCookieHeader.find((c) => c.startsWith("session_id="));
  return raw.split(";")[0];
}

function connectWS(cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
    const onOpen = () => {
      cleanup();
      resolve(ws);
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    function cleanup() {
      ws.removeListener("open", onOpen);
      ws.removeListener("error", onError);
    }
    ws.on("open", onOpen);
    ws.on("error", onError);
  });
}

function connectWSExpectRejection(cookie, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("timeout - connection neither opened nor closed"));
    }, timeoutMs);
    ws.on("open", () => {
      clearTimeout(timer);
      ws.terminate();
      reject(new Error("connection unexpectedly opened"));
    });
    ws.on("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
    ws.on("unexpected-response", () => {
      clearTimeout(timer);
      resolve(true);
    });
    ws.on("error", () => {});
  });
}

function waitForMessage(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for message")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data));
    });
  });
}

function waitForClose(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for close")), timeoutMs);
    ws.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

beforeAll(async () => {
  const regA = await request(app).post("/api/auth/register").send({ username: usernameA, password });
  userA = regA.body.id;
  const regB = await request(app).post("/api/auth/register").send({ username: usernameB, password });
  userB = regB.body.id;

  const loginA = await request(app).post("/api/auth/login").send({ username: usernameA, password });
  cookieA = extractCookie(loginA.headers["set-cookie"]);
  const loginB = await request(app).post("/api/auth/login").send({ username: usernameB, password });
  cookieB = extractCookie(loginB.headers["set-cookie"]);

  server = http.createServer(app);
  ({ wss, heartbeatInterval } = setupWebSocket(server));
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
}, 15000);

afterAll(async () => {
  wss.clients.forEach((ws) => ws.terminate());
  clearInterval(heartbeatInterval);
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => server.close(resolve));

  await pool.query(
    "DELETE FROM messages WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)",
    [userA, userB]
  );
  await pool.query("DELETE FROM sessions WHERE user_id = ANY($1)", [[userA, userB]]);
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [[userA, userB]]);
  await pool.end();
}, 15000);

test("rejects connection without a session cookie", async () => {
  await expect(connectWSExpectRejection(null)).resolves.toBe(true);
});

test("rejects connection with an invalid session cookie", async () => {
  await expect(connectWSExpectRejection("session_id=not-a-real-session")).resolves.toBe(true);
});

test("A and B connect with valid session cookies", async () => {
  wsA = await connectWS(cookieA);
  wsB = await connectWS(cookieB);
  expect(wsA.readyState).toBe(WebSocket.OPEN);
  expect(wsB.readyState).toBe(WebSocket.OPEN);
});

test("valid message: receiver gets push, sender gets echo, saved in DB", async () => {
  const cmid = `test_ws_cmid_${Date.now()}_1`;
  wsA.send(JSON.stringify({ receiver_id: userB, content: "hello B", client_message_id: cmid }));
  const [echoA, pushB] = await Promise.all([waitForMessage(wsA), waitForMessage(wsB)]);
  expect(echoA.content).toBe("hello B");
  expect(pushB.content).toBe("hello B");
  expect(echoA.id).toBe(pushB.id);

  const dbCheck = await pool.query("SELECT id FROM messages WHERE id = $1", [echoA.id]);
  expect(dbCheck.rows.length).toBe(1);
});

test("rejects self-send", async () => {
  const cmid = `test_ws_cmid_${Date.now()}_2`;
  wsA.send(JSON.stringify({ receiver_id: userA, content: "to myself", client_message_id: cmid }));
  const err = await waitForMessage(wsA);
  expect(err.type).toBe("error");
  expect(err.message).toBe("Cannot send a message to yourself");
});

test("rejects nonexistent receiver", async () => {
  const cmid = `test_ws_cmid_${Date.now()}_3`;
  wsA.send(JSON.stringify({ receiver_id: 999999999, content: "nobody", client_message_id: cmid }));
  const err = await waitForMessage(wsA);
  expect(err.type).toBe("error");
  expect(err.message).toBe("Receiver does not exist");
});

test("rejects invalid payload (missing content)", async () => {
  const cmid = `test_ws_cmid_${Date.now()}_4`;
  wsA.send(JSON.stringify({ receiver_id: userB, client_message_id: cmid }));
  const err = await waitForMessage(wsA);
  expect(err.type).toBe("error");
  expect(err.message).toBe("content must be a non-empty string up to 2000 characters");
});

test("duplicate client_message_id returns original message, no duplicate row", async () => {
  const cmid = `test_ws_cmid_${Date.now()}_dup`;
  wsA.send(JSON.stringify({ receiver_id: userB, content: "dup test", client_message_id: cmid }));
  const [first] = await Promise.all([waitForMessage(wsA), waitForMessage(wsB)]);

  wsA.send(JSON.stringify({ receiver_id: userB, content: "dup test", client_message_id: cmid }));
  const [second] = await Promise.all([waitForMessage(wsA), waitForMessage(wsB)]);

  expect(second.id).toBe(first.id);

  const dbCheck = await pool.query("SELECT COUNT(*) FROM messages WHERE client_message_id = $1", [cmid]);
  expect(Number(dbCheck.rows[0].count)).toBe(1);
});

test("read receipt marks message read and notifies sender", async () => {
  const cmid = `test_ws_cmid_${Date.now()}_receipt`;
  wsA.send(JSON.stringify({ receiver_id: userB, content: "read me", client_message_id: cmid }));
  const [echo] = await Promise.all([waitForMessage(wsA), waitForMessage(wsB)]);
  const messageId = echo.id;

  wsB.send(JSON.stringify({ type: "read_receipt", message_id: messageId }));
  const receipt = await waitForMessage(wsA);
  expect(receipt.type).toBe("read_receipt");
  expect(receipt.message_id).toBe(messageId);

  const dbCheck = await pool.query("SELECT read_at FROM messages WHERE id = $1", [messageId]);
  expect(dbCheck.rows[0].read_at).not.toBeNull();
});

test("reconnect: new socket keeps receiving after old socket is replaced", async () => {
  wsA2 = await connectWS(cookieA);
  await waitForClose(wsA);

  const cmid = `test_ws_cmid_${Date.now()}_reconnect`;
  wsB.send(JSON.stringify({ receiver_id: userA, content: "after reconnect", client_message_id: cmid }));
  const received = await waitForMessage(wsA2);
  expect(received.content).toBe("after reconnect");

  wsA = wsA2;
});
