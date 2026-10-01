const request = require("supertest");
const app = require("../app");

// Note: no dedicated 500 test here. The error middleware's generic-500
// branch (status = err.status || 500) has no live path in current routes
// that can be triggered externally without faking an internal failure,
// so it's intentionally not tested here rather than fabricated.

describe("Error handling", () => {
  test("unknown route returns 404 with error message", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  test("malformed JSON body returns 400 with 'Invalid JSON'", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send('{"username": "broken", "password": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid JSON" });
  });
});
