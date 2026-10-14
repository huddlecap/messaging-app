# Messaging App Backend — Project Progress

## 1. Stack

**Runtime:** Node.js (CommonJS module system, `"type": "commonjs"` in package.json)

**Framework:** Express 5.2.1

**Installed dependencies (from package.json, verified against package-lock.json):**

| Package | Version | Purpose |
|---------|---------|---------|
| `express` | 5.2.1 | HTTP server and routing |
| `pg` | 8.23.0 | PostgreSQL client (`Pool` from `pg`) |
| `ws` | 8.21.3 | WebSocket server (`WebSocketServer`) |
| `bcrypt` | 6.0.0 | Password hashing (`bcrypt.hash`, `bcrypt.compare`) |
| `cookie-parser` | 1.4.7 | Cookie parsing middleware (`cookieParser()`) |
| `cookie` | 2.0.1 | Cookie parsing in WebSocket upgrade handler (`parseCookie`) |
| `dotenv` | 18.0.3 | Environment variable loading — selects `.env.test` when `NODE_ENV=test`, else `.env` (see `src/db/db.js`) |
| `express-rate-limit` | 8.7.0 | Login and registration rate limiters (`src/middleware/rateLimiters.js`) |
| `morgan` | 1.12.1 | HTTP request logging (`morgan("dev")`) |

**Dev dependencies (package.json):**

| Package | Version | Purpose |
|---------|---------|---------|
| `jest` | 30.5.2 | Test runner (`npm test`) |
| `supertest` | 7.3.0 | HTTP assertions against the Express app |
| `cross-env` | 10.1.0 | Portable env vars in the `test` script (Windows-safe) |
| `nodemon` | 3.1.14 | Auto-restart dev server (`npm run dev`) |

**Scripts:**
- `"test": "cross-env NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules jest --runInBand"`
  - `NODE_OPTIONS=--experimental-vm-modules` lets Jest's CommonJS runtime `require()` the ESM-only `cookie` package (needed by `src/ws/index.js`).
  - `--runInBand` runs suites sequentially — they share one real test database.
- `"dev": "nodemon src/index.js"` — nodemon **3.1.14 is installed as a devDependency** (local `node_modules/.bin` wins inside npm scripts; a bare `nodemon` in a shell still resolves to whatever global install is on `PATH`).

**Database:** PostgreSQL on Neon, two connection strings:
- `backend/.env` → production/dev branch (`ep-noisy-voice-…`)
- `backend/.env.test` → test branch (`ep-polished-leaf-…`), selected when `NODE_ENV=test`
- SSL is set to `rejectUnauthorized: false`.

**Frontend (Phase 2):** React 19 + Vite 8 in `frontend/` — dev server on `:5173` proxying `/api` and `/ws` to the backend on `:3000` (same-origin, so no CORS and the session cookie works unchanged). No frontend tests yet (Phase 3).

---

## 2. Database Schema

Source: `src/db/schema.sql` — three tables:

### `users`
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `SERIAL` | `PRIMARY KEY` |
| `username` | `VARCHAR(50)` | `UNIQUE NOT NULL` |
| `password_hash` | `TEXT` | `NOT NULL` |
| `created_at` | `TIMESTAMP` | `DEFAULT NOW()` |

### `messages`
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `SERIAL` | `PRIMARY KEY` |
| `sender_id` | `INTEGER` | `NOT NULL REFERENCES users(id)` |
| `receiver_id` | `INTEGER` | `NOT NULL REFERENCES users(id)` |
| `content` | `TEXT` | `NOT NULL` |
| `created_at` | `TIMESTAMP` | `DEFAULT NOW()` |

### `sessions`
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `user_id` | `INTEGER` | `NOT NULL REFERENCES users(id)` |
| `expires_at` | `TIMESTAMP` | `NOT NULL` |
| `created_at` | `TIMESTAMP` | `DEFAULT NOW()` |

**Schema sync:** `schema.sql` matches the live database — `messages` includes `client_message_id TEXT UNIQUE` (idempotency key used by the WebSocket handler; unique violation `23505` triggers "return the original message") and `read_at TIMESTAMP` (set by read receipts), both nullable. Verified column-by-column against `information_schema`: all three tables `MATCH` (constraint `messages_client_message_id_key`).

**Constraints summary:**
- Two foreign key references from `messages.sender_id` and `messages.receiver_id` to `users(id)`
- One foreign key reference from `sessions.user_id` to `users(id)`
- `users.username` has a `UNIQUE` constraint
- `sessions.id` is `TEXT` (not `SERIAL`), so session IDs are generated application-side (`crypto.randomUUID()` in authRoutes.js)

---

## 3. API Endpoints Implemented

All routes are mounted in `src/app.js` (the Express app; `src/index.js` only starts the server):

### Routes in `authRoutes.js` (mounted at `/api/auth`):

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Creates a new user (bcrypt hash, salt rounds 10). `400` invalid input (username 3–50 chars, password 8–72 chars via `validation.js`), `409` duplicate username (`23505`), `201` with `{id, username, created_at}`. Behind `registerLimiter` (5/hour). |
| `POST` | `/api/auth/login` | Authenticates, creates a session (`crypto.randomUUID()`, expires in 7 days), sets `session_id` cookie (httpOnly, sameSite strict, `secure: false`). `401` invalid credentials. Behind `loginLimiter` (10/15min, `skipSuccessfulRequests`). |
| `POST` | `/api/auth/logout` | Deletes the session row, clears the cookie. Always `{ message: "Logged out" }`. |

### Routes in `messageRoutes.js` (mounted at `/api/messages`, protected by `requireAuth`):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/messages/:otherUserId` | Message history between current user and `:otherUserId`, ordered `id DESC`, optional `?limit=` (1–100, default 50) and `?before=<id>` cursor. `400` invalid params, `404` unknown user, `200` with `{ messages, nextCursor }`. |

### Routes in `userRoutes.js` (mounted at `/api/users`, protected by `requireAuth`):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/users` | All users except the caller: `SELECT id, username FROM users WHERE id != $1 ORDER BY username`. Returns `{ users: [{ id, username }] }`, `500` on error. **MVP limitation:** every username is visible to any logged-in user. |

### Routes in `app.js` (not in a router):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Returns `"Server is running"` as plain text. |
| `GET` | `/test-db` | Runs `SELECT NOW()`; `{ success: true, time }` or `500`. |
| `GET` | `/api/auth/me` | Protected by `requireAuth`. Returns `{ user: { id, username } }`. |
| `*` | (any unmatched) | `404` `{ error: "Not found" }`. |
| — | error middleware | `entity.parse.failed` → `400 { error: "Invalid JSON" }`; otherwise `err.status || 500`. |

**Middleware:**
- `authMiddleware.js` — `requireAuth`: reads `session_id`, verifies session exists and `expires_at > NOW()`, sets `req.user`, else `401` (`"Not authenticated"` / `"Session invalid or expired"`).
- `rateLimiters.js` — `loginLimiter` / `registerLimiter`. Both **skip entirely** when `NODE_ENV=test` unless `TEST_RATE_LIMIT=1` (so one dedicated test file can verify real `429` behavior).

**Rate limiting:** `express-rate-limit` with `standardHeaders: "draft-7"`, `legacyHeaders: false`.

---

## 4. WebSocket Implementation

Source: `src/ws/index.js`

1. `setupWebSocket(server)` returns `{ wss, heartbeatInterval }`; creates a `WebSocketServer` with `{ noServer: true }` and a 30s heartbeat interval (ping every client, terminate if `isAlive === false`).
2. On `server.on("upgrade")`: parses cookies (`parseCookie`), requires a valid, unexpired `session_id` (destroys the socket otherwise).
3. **Single socket per user:** if the user already has a socket, the old one is closed with code `4001` and reason `"replaced"` (forces reconnect handling onto the newest socket), with a 2s fallback `terminate()` if the peer never completes the close handshake.
4. **Incoming messages** (`ws.on("message")`):
   - Invalid JSON → `{ type: "error", message: "Invalid JSON" }`.
   - `{ type: "read_receipt", message_id }` → validated (`message_id` positive int), `UPDATE messages SET read_at = NOW() WHERE id = $1 AND receiver_id = $2 AND read_at IS NULL`; if a row was updated, the sender's socket receives `{ type: "read_receipt", message_id, read_at }`.
   - Otherwise validated by `validateMessagePayload`: `receiver_id` positive int, `content` non-empty ≤ 2000 chars, `client_message_id` 1–100 chars (all required).
   - Rejections (as `{ type: "error" }`): self-send → `"Cannot send a message to yourself"`; unknown receiver → `"Receiver does not exist"`.
   - Insert into `messages`; on unique violation (`23505` on `client_message_id`) the **original row is fetched and returned** (idempotent dedup).
   - Delivery: push JSON to the receiver's socket (if connected) and echo back to the sender.
5. On `close`: removes the user from `userSockets` only if the closing socket is still the mapped one (so a replacement socket isn't dropped).

**Key behavior notes:**
- Messages are persisted before delivery.
- No offline queue: if the receiver is offline the message is stored but not delivered later.
- No per-message auth beyond the session check at upgrade time.

---

## 5. Server Lifecycle (`src/index.js`)

- `app.js` (Express app) and `index.js` (startup) are split — `index.js` loads env, creates the HTTP server, wires `setupWebSocket(server)`, starts `startSessionCleanup()`, and listens.
- **Graceful shutdown** on `SIGINT`/`SIGTERM`: logs the signal, closes the HTTP server, terminates all WS clients and closes `wss`, clears heartbeat + session-cleanup intervals, ends the pg pool; exits `0` when all three complete, with a 10s forced-exit backstop (`unref()`'d).
- `src/db/sessionCleanup.js` — `startSessionCleanup()` immediately deletes `expires_at < NOW()` sessions, then repeats hourly; the interval handle is returned for cleanup.

---

## 6. Test Suite

**Command:** `npm test` (from `backend/`) — Jest 30, `NODE_ENV=test`, `--runInBand`, test database (`.env.test`).

**7 suites, 41 tests, all passing (verified at the 4001 close-code step, exit 0, no open-handle warnings):**

| Suite | Tests | Covers |
|-------|-------|--------|
| `auth.test.js` | 12 | register (201/409/400), login (200+cookie/401), `GET /me` (200/401 variants), logout (200, session row deleted) |
| `messages.test.js` | 10 | history auth/validation/404, DESC order, limit + nextCursor, `before` pagination without overlap, empty conversation |
| `users.test.js` | 3 | `/api/users`: 401 without cookie, 200 with exact `{id, username}` shape, caller not listed |
| `websocket.test.js` | 11 | upgrade rejection (no/invalid cookie), connect, send/echo/push/DB save, self-send & receiver & payload errors, `client_message_id` dedup, read receipt, reconnect replaces old socket, replaced socket closes with 4001 `"replaced"` (real HTTP+WS server on an ephemeral port) |
| `rateLimit.test.js` | 2 | real limiter active (`TEST_RATE_LIMIT=1`): 6th register → 429, 11th failed login → 429 |
| `sessionCleanup.test.js` | 1 | expired session deleted, valid session untouched (expired timestamp inserted as `NOW() - INTERVAL '2 hours'` in SQL to match the cleanup query's time reference) |
| `errorHandling.test.js` | 2 | unknown route → 404, malformed JSON → 400 `"Invalid JSON"` |

**Test infrastructure notes:**
- Every suite cleans up its own rows (`afterAll`) and closes its pool; verified zero leftover `test_*` users/messages/sessions after runs.
- `websocket.test.js` starts its own `http.createServer(app)` + `setupWebSocket` on port 0 (Supertest alone can't do WS upgrades).
- `rateLimit.test.js` sets `process.env.TEST_RATE_LIMIT = "1"` before requiring `app.js` — the in-memory limiter store is fresh per suite, so counters reset naturally each run.

---

## 7. What Is NOT Yet Implemented

**API / features:**
- No offline message delivery or delivery-on-reconnect queue.
- No endpoints for presence/online status. (`GET /api/users` now lists users, but returns every username to any logged-in user — fine for MVP, needs search/pagination or contacts before deployment.)
- No user profile update, password reset, or email verification.
- No message deletion or editing.
- No group chats / channels / `conversation_id` grouping.
- No file/image uploads; no attachment columns.
- No message or user search; no typing indicators.
- No pagination on anything except `GET /api/messages/:otherUserId`.

**Infrastructure:**
- No CORS middleware (no `cors` package installed).
- No HTTPS enforcement (`secure: false` on the session cookie).
- No `.env.example` or env-var documentation (`.env`/`.env.test` are in `.gitignore`).
- No structured error logging (only `console.error`/`console.log`; `morgan` for HTTP).

**Schema columns that do NOT exist:**
- No `updated_at`, `deleted_at`, `last_seen`/`online`, `attachment_url`, `subject`/`title` columns anywhere.

**Frontend:**
- No frontend tests (Phase 3); verification so far is manual via the browser plus `oxlint` and `vite build`.
- Auth screen, WebSocket client, user picker, conversation view, message composer, and logout are working. Phase 2 complete (all 11 checklist items). Backend tests: 7 suites / 41 passed.
- No logout button yet (Step 10), no read-receipt UI, no presence/typing indicators, no pagination UI — history is the first 50 messages.
