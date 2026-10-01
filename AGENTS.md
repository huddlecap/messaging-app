# AGENTS.md

## What this is
Backend-only messaging API: Node.js + Express 5 + ws + PostgreSQL (Neon),
CommonJS (`"type": "commonjs"`). No frontend. No lint/typecheck —
**`npm test` is the only verification step.**

## Commands (always run from `backend/`)
- `npm test` — full suite: 6 files, 37 tests, ~30 s, must exit 0
- Focused run: `npm test -- src/__tests__/auth.test.js`
- `npm run dev` — nodemon (local devDependency; a bare `nodemon` in your
  shell is whatever global you have installed)
- `node --check <file>` — syntax check
- **CWD matters**: dotenv resolves `.env`/`.env.test` by relative path —
  commands run outside `backend/` will fail to load env

## Testing rules (deviations from Jest defaults — break these and tests fail or pollute the shared DB)
- `NODE_ENV=test` is set by the `test` script (cross-env) → `src/db/db.js`
  loads `.env.test` (test branch), never production `.env`
- `NODE_OPTIONS=--experimental-vm-modules` is required: Jest's CJS runtime
  must `require()` the ESM-only `cookie` package (used by `src/ws/index.js`).
  Do not remove it.
- `--runInBand`: all suites share one real remote test database — never run
  them in parallel.
- Every suite cleans up its own rows in `afterAll` (unique `test_*`
  username/cmid prefixes) and closes its pool. Keep this pattern; leftovers
  break other suites.
- Rate limiters skip when `NODE_ENV=test` **unless** `TEST_RATE_LIMIT=1`.
  Only `rateLimit.test.js` opts in (sets the var before requiring `app.js`);
  every other suite must leave it unset.
- `websocket.test.js` starts a real HTTP+WS server on port 0 — Supertest
  alone cannot do WS upgrades.
- Throwaway scripts go in `/tmp` only and get deleted; never add scratch
  files under `src/`.

## Architecture (not obvious from filenames)
- `src/app.js` = Express app only (middleware, routes, 404, error handler).
  `src/index.js` = startup + WS wiring + graceful SIGINT/SIGTERM shutdown
  (HTTP close → wss close → pool end, 10 s force-exit backstop). Tests
  import `app.js` directly — never require `index.js` in a test.
- `src/validation.js` = single source of input rules for both HTTP routes
  and WS messages.
- `src/ws/index.js`: session-cookie auth on upgrade, **one socket per user**
  (new connection terminates the old), 30 s heartbeat, read receipts
  (`read_at`), `client_message_id` dedup (unique violation 23505 → return
  the original row).
- `src/middleware/rateLimiters.js`: `registerLimiter` 5/hour,
  `loginLimiter` 10 per 15 min with `skipSuccessfulRequests`.
- `src/db/sessionCleanup.js`: hourly `DELETE ... expires_at < NOW()`; the
  interval is cleared by shutdown/`afterAll`.

## Invariants
- **`src/db/schema.sql` must mirror the live DB** (verified against
  `information_schema`): `messages` includes nullable
  `client_message_id TEXT UNIQUE` and `read_at TIMESTAMP`. Schema change in
  DB → update schema.sql, or vice versa.
- Session IDs are app-generated (`crypto.randomUUID()`, `sessions.id TEXT`),
  not SERIAL.
- Never touch the production DB from tests/scripts — `NODE_ENV=test` or
  explicit `.env.test` only.
- Session cookie is `secure: false` (no HTTPS yet) — intentional, documented
  in `Progress.md`.

## Repo docs (keep in sync on structural/behavioral changes)
- `Project_Structure.md` — file tree + key files · `Progress.md` — stack,
  schema, API, test suite details
