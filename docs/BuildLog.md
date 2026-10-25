# Build Log — Messaging App

## Setup

- Created project at C:\Dev\messaging-app outside OneDrive to avoid Git file-lock
  conflicts from real-time sync fighting with .git
- Installed core packages: express, pg, dotenv
- Created backend/.env with DATABASE_URL, confirmed .gitignore catches .env and
  node_modules

## 1. Neon database setup

- Created a Neon project, got the connection string, added it to .env

## 2. Server skeleton + DB connection

- Created src/index.js, ran a bare Express server on port 3000, confirmed it
  responds
- Created src/db/db.js — pg connection pool using DATABASE_URL
- Added a temporary /test-db route (SELECT NOW()) to confirm the server could
  actually reach Neon — confirmed working before writing any schema

## 3. Data model design — raw SQL vs Prisma

- Decided to write schema by hand in raw SQL instead of using Prisma, to
  actually understand the relational model (foreign keys, constraints) rather
  than abstracting it away — worth it for a two-table v1, would reconsider for
  a much larger schema
- Wrote src/db/schema.sql: users (id, username, password_hash, created_at) and
  messages (id, sender_id, receiver_id, content, created_at), messages'
  sender_id/receiver_id as foreign keys referencing users(id)
- Ran the schema in Neon's SQL editor to actually create the tables (raw SQL
  means the local .sql file and the live database aren't auto-synced — has to
  be run manually each time the schema changes)

## 4. Attempted WebSocket, redirected to auth first

- Tried to jump straight to WebSocket implementation, but realized there was
  no way to identify who's connecting without auth existing first — WebSocket
  work paused here until auth was built

## 5. Auth routes — register, login, logout

- Installed bcrypt for password hashing
- Built POST /api/auth/register — hashes password with bcrypt, inserts into
  users, catches Postgres's unique-constraint error (code 23505) for duplicate
  usernames and returns a clean 409 instead of a raw crash
- Tested via curl: successful registration, and duplicate-username rejection

## 6. Sessions vs JWT decision

- Chose sessions over JWT: this app isn't horizontally scaled, sessions are
  simpler to reason about while learning fundamentals, and revocation is a
  single DELETE instead of needing a JWT blocklist. JWT's main advantage
  (statelessness across multiple services) isn't a problem this app actually has
- Created a sessions table (id, user_id, expires_at, created_at)

## 7. Login + session cookie

- Built POST /api/auth/login — verifies password with bcrypt.compare, creates
  a session row (crypto.randomUUID() for the session id), sets it as an
  httpOnly, sameSite=strict cookie
- Tested via curl with -c cookies.txt (a curl-only file, not part of the app —
  saves the returned cookie locally so it can be reused on later requests with
  -b cookies.txt, standing in for what a browser's cookie jar does automatically)

## 8. Auth middleware

- Built requireAuth middleware — reads the session cookie, joins sessions to
  users to validate it's not expired, attaches req.user, calls next() only if
  valid
- Tested on a protected /api/auth/me route: confirmed rejection with no cookie,
  success with a valid one

## 9. Logout

- Built POST /api/auth/logout — deletes the session row from the DB and clears
  the cookie client-side, so the session id can't be reused even if leaked

## 10. WebSocket implementation

- Added `ws` and `cookie`. Auth on upgrade is written independently of
  `requireAuth` — the upgrade event never passes through Express, so
  `cookie-parser` never runs and the cookie header is parsed manually
- `userSockets` Map (user_id → live socket), RAM only, cleared on restart
- Send: INSERT first (durability), then push to the receiver if connected,
  then echo to the sender. No queue — the row guarantees nothing is lost
- Bug hit: `cookie` v2 renamed `parse` to `parseCookie`, causing a TypeError

## 11. Postman WebSocket testing

- Registered a second test user to simulate both sides of a conversation
- Opened two WebSocket connections in Postman, each with a different user's
  session cookie manually attached via the Cookie header (standing in for what
  a browser attaches automatically)
- Sent messages in both directions, confirmed: message saved to DB, pushed
  live to the other user's open connection, and echoed back to the sender —
  full real-time loop confirmed working

## 12. receiver_id validation

- Added self-send and receiver-existence checks in ws.on("message"), before
  the INSERT. Introduced a {type, message} error-frame convention for WS
  errors, to reuse going forward
- Tested: valid receiver unchanged, nonexistent receiver and self-send both
  rejected with no DB row inserted

## 13. Message history endpoint

- Added GET /api/messages/:otherUserId (before/limit query params),
  cursor-based on message id, requireAuth-protected
- Tested: pagination correct across multiple pages with no overlap, 404 on
  nonexistent user, 401 without a session

## 14. Idempotency keys on message send

- Added client_message_id (TEXT UNIQUE) to messages; WS payload now requires
  receiver_id, content, and client_message_id
- On INSERT, a duplicate client_message_id (23505) is caught and the
  original row is returned instead of erroring or duplicating
- Tested: same client_message_id sent twice returns the same row both
  times, no duplicate created; different client_message_id inserts a new
  row as expected

## 15. Read/delivery receipts

- Added read_at (TIMESTAMP, default NULL) to messages; WS handler branches
  on type === "read_receipt", updates read_at only when the sender is the
  actual receiver and it's not already read, then pushes a live
  {type, message_id, read_at} notification to the original sender
- Tested: read_at set correctly on first call, sender's tab receives the
  live push, resending for an already-read message is a correct no-op

## 16. WebSocket heartbeat + disconnect cleanup + multi-tab

- Added ping/pong (isAlive flag, 30s interval); unresponsive sockets are
  terminated, triggering existing close cleanup
- New connection for an already-connected user now terminates the old
  socket first, then registers the new one (one connection per user)
- Happy-path tested via Postman (stable, messages unaffected); failure
  path deferred — impractical to simulate without a real frontend

## 17. Centralized error handling

- Added a JSON 404 catch-all and a 4-param Express error middleware in
  index.js, after all routes: malformed JSON returns 400, unexpected errors
  return a generic 500 and are logged server-side
- Tested: unknown route returns JSON 404, history endpoint unaffected,
  malformed JSON body returns 400 "Invalid JSON"

## 18. Input validation (hand-written)

- Added src/validation.js (register, login, history query, WS message
  payload, read receipt), wired into authRoutes, messageRoutes and ws/index.js
- Agent edit dropped a try in the WS handler (syntax error); fixed by
  restoring the try around the handler body
- Tested: rejection paths (bad register, bad limit, string receiver_id, bad
  message_id, invalid JSON) and valid paths (login, history, send, read receipt)
- Known gaps (deferred): no upper bound on integer ids (Postgres int max
  2147483647), and a JSON `null` WS payload throws before validation runs
  (use parsed?.type). Fix alongside integration tests.

## 19. Auth rate limiting

- Added express-rate-limit (src/middleware/rateLimiters.js): login allows 10
  failed attempts per 15 min per IP, register 5 per hour per IP, both
  returning a 429 in the { error } shape. Counters are in memory (resets on
  restart; revisit in Phase 5)
- Tested: 11th failed login and 6th register return 429, valid login unaffected

## 20. Session expiry cleanup

- Added src/db/sessionCleanup.js: deletes expired sessions at startup and
  hourly, failures only log; started from index.js
- Tested: inserted a fake expired session, restarted, confirmed the cleanup
  log and that the row was removed

## 21. Request logging

- Added morgan ("dev" format) as the first middleware in index.js, so every
  request is logged, including malformed-JSON 400s, 404s and 401s; WebSocket
  upgrades aren't covered and keep their console.logs
- Tested: bad JSON, unknown route, unauthenticated /me, register 201 and
  login 200 each produced the expected line

## 22. Fix: register 500 after validation refactor

- Valid registration returned a silent 500: the INSERT still referenced the
  undefined password_hash after the rename to hashResult (ReferenceError
  swallowed by a catch that logged nothing)
- Fixed the identifier, added console.error to the register, login and
  history catch blocks; a scan found no other stale names. Tested: valid
  register returns 201. Lesson: retest valid paths after refactors

## 23. Fix: reconnect removed the new socket

- Old socket's close handler deleted userSockets unconditionally, wiping
  out the new connection after a reconnect
- Fixed: delete only if the entry still points at this socket. Verified
  with a scripted test — new socket now receives pushes; normal
  disconnect unaffected

## 24. Graceful shutdown

- setupWebSocket now returns { wss, heartbeatInterval } for index.js to use
- On SIGINT/SIGTERM: close HTTP server, WS sockets + server, clear both
  intervals, close DB pool, exit once all three report done (10s
  force-exit fallback)
- First version exited on the fastest close alone, cutting the other two
  short. Fixed with a pending counter. Verified via scripted SIGINT test,
  with/without an open WebSocket: clean exit, code 0, no leftovers

## 25. Split index.js into app.js + index.js

- Pulled the Express app (routes, middleware, error handlers) into app.js,
  exporting it alone; index.js now just wires up the server, WebSocket,
  cleanup, and shutdown
- Pure structural change, no behavior difference. Verified: dev server
  still starts and responds normally, and the SIGINT shutdown test still
  passes after the split

## 26. Integration test infrastructure

- Added Jest + Supertest + cross-env; npm test runs with NODE_ENV=test
- Created a second Neon branch (schema-only copy) as a dedicated test
  database; db.js loads .env.test instead of .env when NODE_ENV=test
- Bypassed rate limiting in test mode via a skip option, with an opt-back-in
  flag for the rate-limit test itself. Verified with a sanity test, then
  confirmed real vs. test DB connection strings differ as expected

## 27. auth.test.js — 12 tests

- Covers register (valid, duplicate, bad username, bad password), login
  (valid, wrong password, unknown user), /me (valid/no/bad session), logout
  (with/without session)
- All 12 passing, repeatable across multiple runs; cleans up its own test
  user and session rows

## 28. messages.test.js — 10 tests

- Covers the history endpoint: auth gate, bad input validation, unknown
  user, correct id-DESC ordering, cursor pagination with no overlap between
  pages, empty-conversation case
- All 10 passing, repeatable; cleans up its own users/messages

## 29. websocket.test.js — 10 tests

- Covers connect auth (reject no/bad cookie, accept valid), messaging
  (send/echo/push/DB save, self-send rejection, bad receiver, invalid
  payload), idempotent duplicate client_message_id, read receipts, and the
  reconnect fix (new socket keeps receiving after replacing the old one)
- Hit and fixed: Jest couldn't require() the ESM-only cookie package;
  fixed by enabling Node's require(esm) via --experimental-vm-modules in
  the test script (Node 24.9+), no app code changed
- Hit and fixed: two tests raced ahead of the receiver's message listener,
  causing false timeouts; fixed by waiting on both sockets with
  Promise.all instead of sequential awaits. All 10 passing, repeatable

## 30. rateLimit.test.js — 2 tests

- Verifies real 429 behavior: register caps at 5 then 429, login caps at
  10 failed attempts then 429, and a successful login still works after
- Added a TEST_RATE_LIMIT env flag so only this file re-enables the real
  limiter; every other test file keeps the bypass. Passing, repeatable
  across fresh process runs

## 31. sessionCleanup.test.js — 1 test

- Verifies startSessionCleanup deletes an expired session and leaves a
  valid one untouched
- Hit and fixed: inserting the expired timestamp from JS caused a
  timezone mismatch against the DB's NOW(), so the row never registered
  as expired; fixed by computing both timestamps in SQL
  (NOW() - INTERVAL / NOW() + INTERVAL). Passing, repeatable

## 32. errorHandling.test.js — 2 tests

- Covers unknown route (404) and malformed JSON body (400, "Invalid JSON")
- No dedicated 500 test: no live route currently has an externally
  triggerable path to the generic error branch, so it's left untested
  rather than faked. Passing, repeatable

## Integration testing complete: 37/37 tests across 6 files, repeatable

## across independent runs, no leftover test data, no open handles.

## Phase 1 backend MVP done.

## 33. Phase 2 checklist added (docs only)

- Broke Phase 2 into one-commit steps, each mapped to an SCOPE.md item
- Chose a Vite dev proxy for `/api` and `/ws` over adding CORS, so the session
  cookie stays same-origin and Phase 1's HTTP surface is untouched

## 34. GET /api/users — 3 tests

- Added src/routes/userRoutes.js so the frontend has something to populate a
  user picker with; without it the UI could only address users by typing raw
  ids, which is not a real MVP
- Query is SELECT id, username FROM users WHERE id != $1 ORDER BY username —
  self is excluded server-side so the client never has to filter it out
- Mounted as app.use("/api/users", requireAuth, userRoutes) next to
  /api/messages, so it inherits the same auth gate rather than adding its own
  check; ordering by username makes the picker stable instead of
  insertion-ordered
- Known MVP limitation, recorded for later: this lists every username in the
  database to any logged-in user. Fine for manual testing, wrong for a real
  deployment — it needs either a search/pagination endpoint or contacts
- users.test.js covers the 401 without a cookie, the 200 shape (exact
  {id, username} keys), and self not appearing in the list
- Gate: 7 suites / 40 tests passing, exit 0

## 35. Replaced WebSocket closes with 4001 "replaced"

- `terminate()` → `close(4001, "replaced")` so the client can tell "another tab
  took over" from "network dropped" — both previously arrived as an unclean
  1006. 4001 sits in the 4000-4999 app range; 1006 can never be sent deliberately
- `close()` is a handshake, so a 2s `terminate()` fallback covers a peer that
  never echoes the frame; timer is `unref`'d and cleared on close
- Hit and fixed: `close()` opens a CLOSING window, and the 30s heartbeat would
  `ping()` it — `ws` throws on non-OPEN sockets and an uncaught throw inside
  `setInterval` kills the server. Heartbeat now skips non-OPEN sockets

## 36. Frontend scaffold — Vite + React behind a dev proxy

- create-vite react template into `frontend/`. Config proxies `/api` and `/ws`
  to `:3000`, keeping the browser same-origin on `:5173` — session cookie needs
  no CORS work and Phase 1's HTTP surface stays untouched
- Relative URLs only, no env files. Never open a LAN IP:
  `crypto.randomUUID` needs a secure context, and only localhost qualifies
- `server.watch.usePolling` is required, not optional: `/mnt/c` is a 9p mount
  and delivers no inotify events, so Vite serves stale code from memory even
  after a hard reload. Diagnose by diffing the file on disk against
  `curl localhost:5173/src/index.css`
- Vite must run in WSL, not Git Bash — `node_modules` holds only the Linux
  native binding. Backend has no native bindings and runs from either shell

## 37. API client — one fetch wrapper, one 401 hook

- `frontend/src/api.js` is the only place the frontend does HTTP. One private
  `request()` wrapper: `credentials: 'include'`, body/headers set only when a
  body exists, and lenient JSON parsing so a non-JSON body yields `null` rather
  than masking the real failure
- Non-2xx throws `ApiError(status, message)`, taking the message from the
  backend's own `{ error }` body so the UI shows it verbatim
- Central 401: one module-level slot via `setUnauthorizedHandler`. Any 401 fires
  it before throwing, so an expiring session needs one reaction, not one per
  component
- Surface kept small: me, login, register, logout, listUsers, history. Sending
  is WebSocket-only, so there is deliberately no HTTP send endpoint

## 38. Auth screen and app shell

- `App.jsx` is a three-state shell: `undefined` (probing), `null` (no
  session), object (signed in). One `api.me()` on mount; a 401 lands on the
  auth screen silently — "not logged in yet" isn't an error
- One effect registers the 401 hook and unregisters on unmount, so any 401
  anywhere drops back to the auth screen
- `AuthScreen.jsx`: login/register toggle, inline field errors, server message
  shown verbatim. Client validation mirrors `validation.js` — username trimmed
  3-50, password ≤72 **bytes** via `TextEncoder`, not `.length` (that would
  accept multi-byte passwords the server rejects)
- **Register does not create a session.** `authRoutes.js` sets `session_id` only
  on login, so an `onAuthenticated()` after register produced a signed-in shell
  with no cookie behind it. After register the form flips to login with the
  username prefilled and "Account created — log in"
- Chrome's password manager silently overwrote typed passwords during register,
  producing confusing 401s. Use incognito for manual auth testing, and read the
  Network tab's Payload before suspecting code

## 39. User picker

- components/UserPicker.jsx fetches api.listUsers() on mount and renders the
  result as a vertical list of buttons. Loading, error and empty states are
  handled explicitly — "Loading users…", the backend's error message, and
  "No other users yet." — so the component never renders a blank list
- Selection is local state: the clicked button gets a .selected class and
  App.jsx receives the user via onSelect, which renders a "Chatting with
  …" line. Kept deliberately small — the conversation view (step 8) will
  replace that line with the actual message list
- The cancelled flag on the fetch guards against setState after unmount,
  matching the pattern already used in App.jsx
- Gate: picker loads with the expected usernames after login; clicking one
  highlights it and shows "Chatting with <username>". oxlint clean,
  vite build passes
- Backend untouched this step — 7 suites / 41 tests still stand from step 35

## 40. Conversation view

- `Conversation.jsx` is presentational — it renders `messages` and decides
  sent vs received by comparing `sender_id` with `currentUser.id`
- `App.jsx` owns the messages state plus a `messageIdsRef` Set for dedup. The
  history effect fires on `selectedUser` change, resets the set, fetches, and
  reverses the result (backend returns newest-first, UI shows oldest-first)
- Live payloads count as messages only when they carry both `id` and
  `content`; read receipts have a `type` field and are ignored here
- `cancelled` guards the async result and the dedup set resets on every
  conversation change, so ids can't leak between threads

## 41. Message composer

- Controlled input plus Send. On submit it builds `{ receiver_id, content }`
  and hands it to `App.jsx`, which generates the `client_message_id` and queues
  the send. Send is allowed while offline; the message queues (revised in 44)
- Button disabled unless a user is selected and trimmed text is non-empty.
  Rendered only when `selectedUser` is set, else "Select a user first"
- `client_message_id` is a fresh UUID per send, which is what lets the backend
  dedupe retries via the `23505` unique violation

## 42. Logout

- A "Log out" link sits under the status line in the shell. handleLogout
  calls api.logout() and then setUser(null) unconditionally — if the
  request fails (backend down, network error) the local session is still
  cleared, which is the right call for an MVP: the user asked to leave
- setUser(null) does three things at once: the auth screen renders, the
  socket effect's cleanup runs client.close() (intentional close, so no
  reconnect is scheduled), and the 401 hook is unregistered. No separate
  teardown code was needed
- The backend deletes the session row and clears the cookie; verified in
  DevTools that session_id is gone after logout
- Gate: clicking Log out shows the auth screen and clears the cookie;
  logging back in restores the shell with "Connected" and the user picker.
  oxlint clean, vite build passes
- Backend untouched this step — 7 suites / 41 tests still stand from step 35

## 43. End-to-end verification + backend tests

- Backend tests re-run from backend/: npm test → 7 passed suites, 41 passed
  tests, exit 0 (~35 s). No backend changes in steps 8–10, so the green
  state from step 35 held
- Manual E2E walkthrough covered by the step 8–10 gates: login → shell with
  "Connected"; conversation loads history oldest-first or "No messages yet."
  and fires GET /api/messages/<id> on switch; live messages append without
  duplicates (dedup Set); composer generates a fresh crypto.randomUUID()
  client_message_id per send and disables Send while the socket is down or
  the input is empty; logout clears session_id and returns to the auth
  screen; re-login restores the shell
- Frontend untouched this step — oxlint and vite build were clean at the
  end of step 10. All Phase 2 checklist items (0–11) are ticked
- Backend untouched this step — 7 suites / 41 tests still green

## 44. Offline message queue — pending sends retry automatically

- Problem: a send into a silently dead network was lost outright — `readyState`
  stays `OPEN`, so `send()` returned `true`, the input cleared, and the frame
  vanished with no failure reported
- Backend: added `client_message_id` to the INSERT's `RETURNING` and to the
  `23505` fallback `SELECT`, so the echo carries the key the client matches on
- Frontend: `sendMessage()` generates the UUID once at enqueue time and
  `onMessage` resolves the entry by it before the dedup Set runs. Pending rows
  have no `id`, so they never enter `messageIdsRef`
- Two flush triggers failed in-browser first: an effect keyed on
  `socketState.status === 'open'` (a silent drop never changes the status) and a
  `window 'online'` listener (Chrome skips it on wifi toggles). Final answer is a
  5s `setInterval` keyed on `pending.length`, so it starts and stops with the
  queue
- Verified manually: two messages queued offline both delivered within 5s of
  the network returning, no duplicates, no user action
- Gaps (README + SCOPE): pending lives in React state so a reload loses it; no
  attempt cap; no `failed` state

## 45. Message ordering bug found (not fixed)

- Two queued messages arrived reversed (hi2 before hi1)
- Cause is the backend, not the poller: `ws.on("message")` is async and
  unserialized, so two frames in one tick can INSERT in either order and `hi2`
  can get the lower `id`, which `App.jsx`'s `.reverse()` then amplifies
- Fix is a promise chain serializing the handler in `ws/index.js`

## 46. Phase 3 step 1 — Vitest + jsdom setup

- Installed Vitest 5.0.5 + jsdom 30.1.3, added `"test": "vitest run"`. Config
  goes in `vite.config.js` under a `test` block so there is one source of truth
- `environment: 'jsdom'` is required — `wsClient.js` reads `location.protocol`
  and would throw under the default `node` environment
- Vite stayed at 8.3.2, deduped across all three consumers, no version shift
- Placeholder test proves the setup runs; `npm test`, `npm run build` and
  `npm run lint` all pass

## 47. Phase 3 step 2 — wsClient.js tests

- 16 tests over a fake WebSocket. `close()` records the call but does not emit,
  so tests call `emitClose()` and control exactly when the event lands
- Verified by sabotage: breaking the backoff cap, the 4001 branch, the backoff
  reset, the session-check guard, `clearRetry`, and `closedIntentionally` each
  fail at least one test
- Found while sabotage-testing: `closedIntentionally` is effectively dead code
  at `wsClient.js:47`. `close()` nulls `socket` and removes the `online`
  listener first, so the `socket !== ws` guard at `:44` short-circuits before
  the flag is read. Left as is — defence in depth

## 48. Phase 3 step 3 — Playwright setup

- `e2e/` with its own package.json, Playwright 1.64.1, Chromium only
- `webServer` starts the backend with `NODE_ENV=test` so `db.js` loads
  `.env.test`, plus Vite on `:5173`. Both use `reuseExistingServer: false` so a
  run can never attach to a dev server holding the dev database
- `workers: 1`, `fullyParallel: false` — all specs share one test DB
- Verified the test DB is really used: loaded the pool under `NODE_ENV=test`
  and printed only the hostname. dotenv reported `.env.test` and the host was
  `ep-polished-leaf-…`, distinct from the dev DB's `ep-noisy-voice-…`
- Blocker: Chromium cannot launch on WSL, missing `libnspr4.so`. The browser
  binary is installed, the system libraries are not. Run
  `sudo npx playwright install-deps chromium` before the smoke test can pass
- Note: an e2e run needs `:3000` and `:5173` free, since
  `reuseExistingServer: false` fails on purpose rather than attaching

## 49. Phase 4 step 1 — CI pipeline on GitHub Actions

CONFIRMED = shown by a merge, a green run or command output. UNCONFIRMED = inferred or not verified.
- #1-#2: practice branch/PR loop and .gitattributes (LF line endings). Exact split not recorded.
- #3: backend Jest workflow using the TEST_DATABASE_URL secret.
- #4: frontend Vitest job (16 tests). #10: `npm run build` in that job as the Linux filename-casing check.
- #5: e2e cleanup guard. With CI=true the "differs from the dev .env host" checks are skipped (CI has no dev .env). "Pool host equals .env.test host" always applies.
- #6: auth-flow spec registers its own second user (empty test DB shows "No other users yet"). Found when 4 of 5 e2e tests passed locally; confirmed by stashing the guard change.
- #7: Playwright e2e job: needs backend, Chromium with --with-deps, artifacts on failure.
- #8: workflow-level concurrency group, cancel-in-progress false: one run at a time on the shared test DB.
- #9: npm cache on all setup-node steps (restore confirmed). The Chromium download is not cached (reason: recollection that Playwright's docs advise against it, UNCONFIRMED).
- Branch protection on main: no direct pushes, required checks backend, frontend, e2e.
- Decided against a single root `npm test` job: separate jobs are faster and clearer. The root command stays for local use.

## 50. Phase 4 step 2 — Lost test database and 28P01 failures

- CI's backend job failed with Postgres 28P01 (password authentication failed). First suspected cause: a mangled secret paste (UNCONFIRMED). Re-adding the secret did not fix it.
- After the Neon password reset on `production`, local backend tests failed with 28P01 too. "They passed before the reset" is from memory. The idea that one reset changes a project-wide role password is not supported: Neon passwords seem to be per branch.
- The old test database (the endpoint in backend/.env.test) was not in any Neon project (one project, one branch). Cause UNCONFIRMED.
- Fix: new schema-only Neon branch `test`; backend/.env.test and the CI secret pointed at it. Local 41 tests and CI green (CONFIRMED).
- Bad edit of .env.test: extra text before the URL gave an empty host and a misleading DEPTH_ZERO_SELF_SIGNED_CERT error. Fixed with a script that kept only the last postgresql:// part of the line.
- A diagnostic command then printed the password into chat (the malformed URL put it in a printed field), and it was pasted once by hand. Rotation is planned for the end of the phase.
- PRs #5 and #10 were pushed but not merged when assumed so (git pull left main unchanged). Local branch ci/e2e-guard was deleted before #5 merged; nothing was lost. The yellow compare banner is unreliable, and a purple Merged badge seen belonged to another PR. 

## 51. Phase 4 step 3 — One origin: serve the frontend from the backend, cookies, hardening

Recorded from a later session's summary (#11-#13).
- #11: backend serves frontend/dist with an index.html fallback for paths not starting with /api or /ws. Removed GET /; added GET /api/health (no auth, no DB). Why: one same-origin service, so no CORS, sameSite strict keeps working, no proxy for /api and /ws.
- #11 e2e failed: Playwright timed out waiting 60000 ms for the backend webServer. It waited on `/`, which 404s in CI once GET / is gone and no dist is built. Local runs passed only because a stale dist existed. Fix: webServer url is now /api/health.
- #12: removed the unauthenticated GET /test-db, which returned raw error text on failure.
- #13: cookie Secure flag from env COOKIE_SECURE (not NODE_ENV=production, which would skip the dev dependencies the Vite build needs); logout clears the cookie with the same options; trust proxy only when env TRUST_PROXY is a positive integer. Backend tests: 43.
- Rate limits verified per client from two networks (reported). The exact proxy hop count is not proven.

## 52. Phase 4 step 4 — Render deploy and the `live` database

Recorded from a later session's summary (#14-#16).
- Neon branch `live`: schema-only copy of `production` (users, messages, sessions; 0 users), checked with SQL.
- Render free web service. Build: install backend and frontend dependencies, build the frontend. Start: `node backend/src/index.js`. Health check: /api/health. Env: DATABASE_URL (live), COOKIE_SECURE=true, TRUST_PROXY=1. First deploy succeeded; the smoke test (register, login, cookie flags, live messaging, reload) was reported working, no logs seen.
- Deploy through Render Auto-Deploy "After CI Checks Pass" instead of a GitHub Actions deploy job. UNCONFIRMED that the setting is on and that the deploy waits for green CI.
- Free-tier trade-offs: idle spin-down after 15 minutes (about 30 s cold start), restarts that drop sockets. The client reconnects and has an offline queue.
- #14: page title "Messaging App", used to try the deploy loop. #15 and #16: docs updates.
- #15's backend job failed once with ETIMEDOUT/ENETUNREACH to Postgres. The raw log was never seen; likely transient. Re-run, then merged with green required checks.

## 53. Phase 4 step 5 — Open items and lessons

- Password rotation is still pending: three independent resets (`production` -> backend/.env; `test` -> backend/.env.test and the secret TEST_DATABASE_URL; `live` -> Render DATABASE_URL). Do it before sharing the live URL or storing real user data. `live` and `test` were copied from branches that may share the leaked password (UNCONFIRMED).
- Docs: SCOPE rotation line should say three resets; two missing spaces in Architecture_Decisions.md.
- Optional: unused morgan import; skip CI on docs-only PRs (they run the full CI because required checks must report); ssl rejectUnauthorized hardening.
- Carried over: 21 orphan e2e_ users in the dev DB; UserPicker never refetches /api/users; no logout button; deferred tests; new SSH key in WSL.
- Lessons: ask for raw diffs and logs, not summaries. Before removing an endpoint, grep config and CI for readiness checks that use it. Local green is not proof, so test CI-only conditions (no dist, no .env, empty DB). Do not tick a docs box or claim a setting until you have seen it. 
