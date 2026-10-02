const request = require("supertest");
const app = require("../app");
const pool = require("../db/db");

const usernameA = `test_users_a_${Date.now()}`;
const usernameB = `test_users_b_${Date.now()}`;
const password = "testpass123";

let userA, userB;
let cookieA;

describe("Users list route", () => {
  beforeAll(async () => {
    const regA = await request(app).post("/api/auth/register").send({ username: usernameA, password });
    userA = regA.body.id;
    const regB = await request(app).post("/api/auth/register").send({ username: usernameB, password });
    userB = regB.body.id;

    const loginA = await request(app).post("/api/auth/login").send({ username: usernameA, password });
    cookieA = loginA.headers["set-cookie"].find((c) => c.startsWith("session_id="));
  });

  afterAll(async () => {
    await pool.query("DELETE FROM sessions WHERE user_id = ANY($1)", [[userA, userB]]);
    await pool.query("DELETE FROM users WHERE id = ANY($1)", [[userA, userB]]);
    await pool.end();
  });

  test("no auth cookie returns 401", async () => {
    const res = await request(app).get("/api/users");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Not authenticated");
  });

  test("valid session returns other users with id and username", async () => {
    const res = await request(app).get("/api/users").set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);

    const other = res.body.users.find((u) => u.id === userB);
    expect(other).toBeDefined();
    expect(other.username).toBe(usernameB);
    expect(Object.keys(other).sort()).toEqual(["id", "username"]);
  });

  test("current user is not listed", async () => {
    const res = await request(app).get("/api/users").set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(res.body.users.find((u) => u.id === userA)).toBeUndefined();
    expect(res.body.users.map((u) => u.username)).not.toContain(usernameA);
  });
});