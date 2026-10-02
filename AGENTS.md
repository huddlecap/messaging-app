# AGENTS.md

## What this is
Messaging app: Express 5 + ws + PostgreSQL (Neon) backend (CommonJS,
`"type": "commonjs"`) plus a React + Vite frontend in `frontend/`. Backend has
no lint/typecheck — **`npm test` is the only backend verification step**
(frontend tests are Phase 3).

## Commands
Backend (run from `backend/`):
- `npm test` — full suite: 7 files, 41 tests, ~30 s, must exit 0
- Focused run: `npm test -- src/__tests__/auth.test.js`
- `npm run dev` — nodemon (local devDependency; a bare `nodemon` in your
  shell is whatever global you have installed)
- `node --check <file>` — syntax check
- **CWD matters**: dotenv resolves `.env`/`.env.test` by relative path —
  commands run outside `backend/` will fail to load env

Frontend (run from `frontend/`):
- `npm run dev` — Vite dev server at `http://localhost:5173`, proxies `/api`
  and `/ws` to `:3000`. Always use `http://localhost:5173`, never a LAN IP —
  `crypto.randomUUID` needs a secure context and a LAN IP is not one
- `npm run build` / `npm run lint` — Vite build / oxlint (scaffolded, not a
  project gate yet)
- **Run Vite from WSL**, not Git Bash/Windows Node: `npm install` ran under
  WSL, so `node_modules` holds only `@rolldown/binding-linux-x64-gnu` and
  Windows Node cannot load it. The backend has no native bindings and runs
  from either shell.
- **`server.watch.usePolling` in `vite.config.js` is not optional** — `/mnt/c`
  is a 9p (drvfs) mount that delivers no inotify events. Symptom if it's ever
  removed: edits are ignored *and a hard reload still shows stale content*,
  because Vite serves its in-memory copy rather than re-reading the disk.
  Diagnose by comparing the file on disk with
  `curl -s http://localhost:5173/src/index.css`.

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
  (new connection closes the old with code 4001 `"replaced"` + 2s fallback
  terminate), 30 s heartbeat (skips non-OPEN sockets), read receipts
  (`read_at`), `client_message_id` dedup (unique violation 23505 → return
  the original row).
- `src/middleware/rateLimiters.js`: `registerLimiter` 5/hour,
  `loginLimiter` 10 per 15 min with `skipSuccessfulRequests`.
- `src/db/sessionCleanup.js`: hourly `DELETE ... expires_at < NOW()`; the
  interval is cleared by shutdown/`afterAll`.
- `frontend/src/api.js` is the **only** place the frontend calls HTTP; every
  request goes through its `fetch` wrapper, which throws `ApiError(status,
  message)` and routes **all** 401s through `setUnauthorizedHandler` (set once
  by the app shell) so components never hand-roll 401 handling.
- `frontend/src/components/AuthScreen.jsx` mirrors `backend/src/validation.js`
  client-side. The password cap is **72 bytes**, not 72 characters (bcrypt's
  limit) — use `new TextEncoder().encode(pw).length`, a `.length` check would
  wrongly accept multi-byte passwords.
- `POST /api/auth/register` returns `201` and **does not create a session**
  (only `/login` sets `session_id`, `authRoutes.js`). Never treat a successful
  register as a signed-in state.

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
