const request = require("supertest");
const app = require("../app");
const pool = require("../db/db");

const username = `test_auth_${Date.now()}`;
const password = "testpass123";
let sessionCookie;

describe("Auth routes", () => {
  afterAll(async () => {
    await pool.query(
      "DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = $1)",
      [username]
    );
    await pool.query("DELETE FROM users WHERE username = $1", [username]);
    await pool.end();
  });

  describe("POST /api/auth/register", () => {
    test("valid registration returns 201 with id, username, created_at", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ username, password });
      expect(res.status).toBe(201);
      expect(res.body.username).toBe(username);
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("created_at");
    });

    test("duplicate username returns 409", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ username, password });
      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty("error");
    });

    test("username too short returns 400", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ username: "ab", password });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    test("password too short returns 400", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ username: `${username}_x`, password: "short" });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("POST /api/auth/login", () => {
    test("valid credentials return 200, id, username, and set session_id cookie", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username, password });
      expect(res.status).toBe(200);
      expect(res.body.username).toBe(username);
      expect(res.body).toHaveProperty("id");
      const setCookie = res.headers["set-cookie"];
      expect(setCookie).toBeDefined();
      expect(setCookie.some((c) => c.startsWith("session_id="))).toBe(true);
      sessionCookie = setCookie.find((c) => c.startsWith("session_id="));
    });

    test("wrong password returns 401", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username, password: "wrongpassword" });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    test("nonexistent username returns 401", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "no_such_user_xyz", password });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("GET /api/auth/me", () => {
    test("with valid session returns 200 and user", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Cookie", sessionCookie);
      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe(username);
    });

    test("without cookie returns 401 'Not authenticated'", async () => {
      const res = await request(app).get("/api/auth/me");
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Not authenticated");
    });

    test("with garbage cookie returns 401 'Session invalid or expired'", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Cookie", "session_id=not-a-real-session-id");
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Session invalid or expired");
    });
  });

  describe("POST /api/auth/logout", () => {
    test("with valid session returns 200 and deletes the session row", async () => {
      const res = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", sessionCookie);
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Logged out");

      const check = await pool.query(
        "SELECT id FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = $1)",
        [username]
      );
      expect(check.rows.length).toBe(0);
    });

    test("without cookie still returns 200", async () => {
      const res = await request(app).post("/api/auth/logout");
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Logged out");
    });
  });
});
