const request = require("supertest");
const app = require("../app");
const pool = require("../db/db");

const usernameA = `test_msg_a_${Date.now()}`;
const usernameB = `test_msg_b_${Date.now()}`;
const usernameC = `test_msg_c_${Date.now()}`;
const password = "testpass123";

let userA, userB, userC;
let cookieA, cookieB;
let messageIds = [];

describe("Message history route", () => {
  beforeAll(async () => {
    const regA = await request(app).post("/api/auth/register").send({ username: usernameA, password });
    userA = regA.body.id;
    const regB = await request(app).post("/api/auth/register").send({ username: usernameB, password });
    userB = regB.body.id;
    const regC = await request(app).post("/api/auth/register").send({ username: usernameC, password });
    userC = regC.body.id;

    const loginA = await request(app).post("/api/auth/login").send({ username: usernameA, password });
    cookieA = loginA.headers["set-cookie"].find((c) => c.startsWith("session_id="));
    const loginB = await request(app).post("/api/auth/login").send({ username: usernameB, password });
    cookieB = loginB.headers["set-cookie"].find((c) => c.startsWith("session_id="));

    for (let i = 0; i < 5; i++) {
      const res = await pool.query(
        `INSERT INTO messages (sender_id, receiver_id, content, client_message_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [userA, userB, `msg ${i}`, `test_msg_cmid_${Date.now()}_${i}`]
      );
      messageIds.push(res.rows[0].id);
    }
  });

  afterAll(async () => {
    await pool.query("DELETE FROM messages WHERE sender_id = $1 AND receiver_id = $2", [userA, userB]);
    await pool.query("DELETE FROM sessions WHERE user_id = ANY($1)", [[userA, userB, userC]]);
    await pool.query("DELETE FROM users WHERE id = ANY($1)", [[userA, userB, userC]]);
    await pool.end();
  });

  test("no auth cookie returns 401", async () => {
    const res = await request(app).get(`/api/messages/${userB}`);
    expect(res.status).toBe(401);
  });

  test("non-numeric otherUserId returns 400", async () => {
    const res = await request(app).get("/api/messages/abc").set("Cookie", cookieA);
    expect(res.status).toBe(400);
  });

  test("nonexistent otherUserId returns 404", async () => {
    const res = await request(app).get("/api/messages/999999999").set("Cookie", cookieA);
    expect(res.status).toBe(404);
  });

  test("valid request with default limit returns messages in id DESC order", async () => {
    const res = await request(app).get(`/api/messages/${userB}`).set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(res.body.messages.length).toBe(5);
    const ids = res.body.messages.map((m) => m.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(res.body.nextCursor).toBe(messageIds[0]);
  });

  test("limit=2 returns exactly 2 messages with correct nextCursor", async () => {
    const res = await request(app).get(`/api/messages/${userB}?limit=2`).set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(res.body.messages.length).toBe(2);
    expect(res.body.messages[0].id).toBe(messageIds[4]);
    expect(res.body.messages[1].id).toBe(messageIds[3]);
    expect(res.body.nextCursor).toBe(messageIds[3]);
  });

  test("pagination with before continues without overlap", async () => {
    const page1 = await request(app).get(`/api/messages/${userB}?limit=2`).set("Cookie", cookieA);
    const cursor = page1.body.nextCursor;
    const page2 = await request(app).get(`/api/messages/${userB}?limit=2&before=${cursor}`).set("Cookie", cookieA);
    expect(page2.status).toBe(200);
    expect(page2.body.messages.length).toBe(2);
    const page1Ids = page1.body.messages.map((m) => m.id);
    const page2Ids = page2.body.messages.map((m) => m.id);
    expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
    expect(page2.body.messages[0].id).toBe(messageIds[2]);
  });

  test("limit=0 returns 400", async () => {
    const res = await request(app).get(`/api/messages/${userB}?limit=0`).set("Cookie", cookieA);
    expect(res.status).toBe(400);
  });

  test("limit=101 returns 400", async () => {
    const res = await request(app).get(`/api/messages/${userB}?limit=101`).set("Cookie", cookieA);
    expect(res.status).toBe(400);
  });

  test("non-numeric before returns 400", async () => {
    const res = await request(app).get(`/api/messages/${userB}?before=abc`).set("Cookie", cookieA);
    expect(res.status).toBe(400);
  });

  test("conversation with no messages returns empty array and null nextCursor", async () => {
    const res = await request(app).get(`/api/messages/${userC}`).set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
    expect(res.body.nextCursor).toBeNull();
  });
});
