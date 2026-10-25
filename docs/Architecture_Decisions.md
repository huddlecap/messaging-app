# ARCHITECTURE_DECISIONS.md

A running log of the "why" behind key technical choices — independent of
timeline. For what happened and when, see BuildLog.md. For the plan, see
SCOPE.md. Entries are added only once a decision is finalized and
implemented, not while still under discussion.

## Raw SQL over an ORM (e.g. Prisma)

Chosen to actually learn the relational model directly — foreign keys,
constraints, joins — rather than abstracting them away behind generated
queries. Worth it for a small, two/three-table schema like this. Would
reconsider for a much larger schema, where hand-writing every query becomes
its own maintenance burden.

## Sessions over JWT

This app isn't horizontally scaled, so JWT's main advantage (statelessness
across multiple services) isn't a problem this app actually has. Sessions
are simpler to reason about while learning fundamentals, and revocation is a
single DELETE from the sessions table instead of needing a JWT blocklist.
Revisit if/when Phase 5 (scaling) requires multiple server instances.

## Manual cookie parsing for WebSocket auth

Express's cookie-parser middleware only runs inside the normal HTTP request
cycle — it doesn't run on raw WebSocket upgrade events. So WS auth re-reads
the session_id cookie manually (via the cookie package's parseCookie) and
re-validates it against the sessions table directly in the upgrade handler,
independent of the REST requireAuth middleware, even though the underlying
check (session exists, not expired) is conceptually the same logic.

## Cursor-based pagination for message history

Offset/limit pagination re-counts row position from the top on every query,
so a page boundary can shift and cause skipped or duplicated rows if new
messages get inserted while paging through history. Cursor-based pagination
anchors to a specific message id already seen (id < last-seen-id), which
stays correct regardless of what gets inserted elsewhere, since new messages
always get higher ids.

## Standard error-frame shape for WebSocket errors

Introduced { type: "error", message: "..." } as the response shape when the
WS message handler rejects something (e.g. receiver_id validation). Chosen
now, on the first WS error case, so future WS features (read receipts, etc.)
reuse the same shape instead of each inventing its own.

## Hand-written input validation, zod later

All validation lives in one file (src/validation.js): each function takes
raw input and returns { ok, value } or { ok: false, error }. Routes and the
WS handler only call it. Hand-written for now to avoid a dependency at this
size; the single-file boundary means swapping in zod later only touches
validation.js. express-validator was considered (The Odin Project teaches
it) but it's req/res middleware and doesn't fit WebSocket payloads.

## Reconnect socket cleanup

Old socket's close handler deleted the userSockets entry unconditionally.
If the old socket closes after the new one is already registered, that
handler removes the new one instead of the old one, since both share the
same key. Fixed by checking the map still points at _this_ socket before
deleting, so a stale close can never remove a newer connection.

## Graceful shutdown waits for all three closes

HTTP server, WS server, and DB pool close at different speeds. Exiting on
the first callback (DB pool, in testing) cut the other two short. Now uses
a pending counter — exit only once all three report done — with a 10s
force-exit fallback in case one hangs.

## Test database: Neon branch, not Testcontainers

Current best practice for Postgres integration tests is Testcontainers
(a real, disposable Postgres per run). Chose a schema-only Neon branch
instead: no new tool (Docker) to install this late in the MVP phase, same
engine as prod, and reuses the Neon workflow already in use. Revisit for
Testcontainers once past MVP, when hardening for scale.

## Rate limit bypass, not removal, in tests

Limiters are skipped when NODE_ENV=test so auth/message/WS tests aren't
blocked by counters. A separate TEST_RATE_LIMIT flag re-enables the real
limiter for one dedicated test file, so the actual 429 behavior still gets
verified without every other test tripping it.

## Close code 4001 for a replaced socket

Terminating the old socket gave the browser nothing to work with: an unclean
TCP drop arrives as 1006, which is indistinguishable from the backend going
away or the network dropping. The frontend needs those to mean different
things — one should reconnect, the other must not. So the server now sends
`close(4001, "replaced")` instead, from the application range 4000-4999, which
is what the browser hands to the client's onclose. The client must treat 4001
as terminal for that tab and show the "account open in another tab" screen
rather than reconnecting, because reconnecting would immediately replace the
*other* tab and ping-pong forever.

`close()` is a handshake, so a 2s fallback `terminate()` covers a peer that
never echoes the close frame and would otherwise sit in CLOSING forever. The
timer is `unref`'d and cleared on close so it can't hold the process open. A
consequence of closing gracefully instead of terminating: the heartbeat now
skips sockets that aren't OPEN, because `ping()` throws on a CLOSING socket
and an exception inside `setInterval` would take the process down.

## One API module and one 401 hook

Every HTTP call from the frontend goes through a single wrapper in `api.js`,
which attaches credentials, parses JSON leniently, and throws `ApiError` using
the backend's own error message so the UI can display it verbatim. A module-level
slot (`setUnauthorizedHandler`) fires on any 401, so an expired session has one
reaction instead of one per component. Sending is deliberately WebSocket-only;
there is no HTTP send endpoint to keep in sync.

## App-generated `client_message_id` as the idempotency key

The client generates a UUID once at enqueue time and reuses it across retries,
and the backend treats the unique index on that column as the dedup point: a
`23505` returns the original row instead of an error. This makes a send safe to
repeat, which the offline queue and any reconnect replay depend on. Generating
the id server-side would not help, because the client needs a stable key before
the first attempt ever reaches the server.

## Offline queue flushes on a timer, not on events

Two event-driven triggers were tried and failed: an effect keyed on the socket
status (a silently dead network never changes it, so `send()` still returns
`true`) and a browser `online` listener (Chrome skips it on wifi toggles). A 5 s
interval keyed on `pending.length` is the only trigger that survives a silent
drop, and it starts and stops with the queue rather than running forever.

## Vitest config lives in `vite.config.js`

A `test` block in the existing Vite config keeps one source of truth instead of
adding a second config file, and keeps the frontend on Vitest rather than
running Jest alongside Vite. The `jsdom` environment is required, not a
preference: `wsClient.js` reads `location.protocol` and throws under the default
`node` environment.

## E2E specs run serially against one shared test DB

All Playwright specs point at the same remote test database, so they cannot run
in parallel: `workers: 1` and `fullyParallel: false`, with the Jest suite and
root `npm test` chaining the three suites so two can never overlap. The
`webServer` block forces `NODE_ENV=test` so `db.js` loads `.env.test`, and
`reuseExistingServer: false` makes a run fail rather than attach to a dev server
holding the production database.

## Phase 4 deployment decisions

**Host:** Render free web service in Singapore; one service serves everything same-origin. Build installs backend and frontend deps, then builds the frontend. Start: `node backend/src/index.js`. Health check path `/api/health`. Auto-Deploy set to "After CI Checks Pass". Free tier spins down after 15 minutes idle (~30s cold start) and can restart at any time, which drops WebSockets; the client has reconnect logic and an offline queue.

**Neon branches:** project `messaging-app`, region AWS Singapore. `production` (actually the DEV database despite the name), `test` (schema-only copy used by tests and CI), `live` (the real production database, schema-only copy). The old `test` DB host `ep-polished-leaf` no longer exists; refer to the `test` branch instead.

**Serving:** backend serves `frontend/dist` as static files when it exists, with an `index.html` fallback for any path not starting with `/api` or `/ws`. `GET /` and `GET /test-db` no longer exist.

**Cookie and proxy:** session cookie is httpOnly, sameSite strict; `Secure` flag on only when env `COOKIE_SECURE` is `true` (unset means off). Express `trust proxy` set only when env `TRUST_PROXY` is a positive integer; production uses `1`. Production env vars on Render: `DATABASE_URL` (live branch), `COOKIE_SECURE=true`, `TRUST_PROXY=1`; `PORT` supplied by Render.

**Rate limiting:** limiters key on client IP; verified per-client by testing from two different networks.

**Logging:** no request logging configured (`morgan` imported but not used), so client IPs cannot be audited from logs.
