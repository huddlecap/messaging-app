const rateLimit = require("express-rate-limit");

const loginLimiter = rateLimit({
  skip: (req) => process.env.NODE_ENV === "test" && process.env.TEST_RATE_LIMIT !== "1",
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts, try again later" },
});

const registerLimiter = rateLimit({
  skip: (req) => process.env.NODE_ENV === "test" && process.env.TEST_RATE_LIMIT !== "1",
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many registration attempts, try again later" },
});

module.exports = { loginLimiter, registerLimiter };
