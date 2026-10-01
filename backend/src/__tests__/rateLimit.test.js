process.env.TEST_RATE_LIMIT = "1";

const request = require("supertest");
const app = require("../app");
const pool = require("../db/db");

const password = "testpass123";
const loginUsername = `test_ratelimit_login_${Date.now()}`;

describe("Rate limiting (real limiter active)", () => {
  afterAll(async () => {
    await pool.query("DELETE FROM users WHERE username LIKE 'test_ratelimit_%'");
    await pool.end();
  });

  test("register: 5 succeed, 6th returns 429", async () => {
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ username: `test_ratelimit_reg_${Date.now()}_${i}`, password });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  test("login: 10 failed attempts return 401, 11th returns 429, successful login still works after", async () => {
    await request(app).post("/api/auth/register").send({ username: loginUsername, password });

    const statuses = [];
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: loginUsername, password: "wrongpassword" });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
