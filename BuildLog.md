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

- Installed the ws package for the WebSocket server, and cookie separately for
  manually parsing cookies off the raw upgrade request (Express's cookie-parser
  only works inside the normal HTTP request cycle, not the upgrade event)
- Built src/ws/index.js: same auth logic as the REST middleware, but written
  independently since WebSocket upgrades happen outside Express's request
  pipeline entirely — reads the cookie manually, validates the session against
  the DB, only completes the WebSocket handshake (wss.handleUpgrade) if valid
- Kept a userSockets Map (in-memory, RAM only, wiped on server restart) —
  user_id -> live socket, so the server knows who's currently connected
- Bug hit: cookie package v2 renamed its export from parse to parseCookie —
  caused a TypeError until traced with node -e "console.log(require('cookie'))"
  to see the actual exports
- Message-send logic: on receiving a message over a socket, always insert it
  into the messages table first (unconditional — this is the durability
  guarantee), then check userSockets for the receiver's socket — if present,
  push it live; if absent, do nothing further (no queue, no pending state —
  the DB row already guarantees it isn't lost). Also echoes the saved message
  back to the sender as confirmation

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

- Broke Phase 2 into 11 one-commit steps, each mapped to one checklist item in
  SCOPE.md: backend user list, WebSocket 4001 replaced-socket code, Vite +
  React scaffold behind a dev proxy, API client, auth shell, WebSocket client,
  user picker, conversation view, composer, logout, manual end-to-end
- Two backend gaps surfaced while planning the frontend and became their own
  steps rather than silent workarounds: there was no way for the UI to pick a
  receiver (no GET /api/users), and a replaced socket died as an unclean 1006
  (terminate() with no code), which the browser cannot tell apart from a
  network drop — hence 4001 "replaced" so the client knows not to reconnect
- Chose a Vite dev proxy for /api and /ws over adding CORS to the backend, so
  the session cookie works same-origin and Phase 1's verified HTTP surface
  stays untouched
- Excluded by design (already non-goals or later phases): read receipt UI,
  presence/online, typing indicators, multi-tab support, styling polish,
  frontend tests (Phase 3), pagination UI (first 50 messages only)

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

- Swapped existingSocket.terminate() for close(4001, "replaced") so the
  browser can tell "another tab took over" apart from "the network dropped" —
  both used to arrive as an unclean 1006, and the frontend has to react
  differently to each (show the replaced screen vs. reconnect)
- 4001 is inside the 4000-4999 application range reserved for app-specific
  codes; 1001/1000 (going away / normal) are taken by the protocol itself and
  1006 can never be sent deliberately
- close() is a handshake, so a 2s fallback terminate() covers a peer that never
  echoes the close frame and would otherwise hang in CLOSING forever; timer is
  unref'd and cleared on close so it can't keep the process alive
- Hit and fixed: switching from terminate() to close() opened a window where a
  socket sits in CLOSING, and the 30s heartbeat would call ping() on it — ws
  throws on a non-OPEN socket and an exception inside setInterval is uncaught,
  which would kill the server. The heartbeat now skips non-OPEN sockets
- waitForClose in websocket.test.js now resolves { code, reason } instead of
  just the code; the existing reconnect test ignores the return value so it
  passed unchanged, and the new test asserts 4001 / "replaced"
- Gate: 7 suites / 41 tests passing, exit 0

## 36. Frontend scaffold — Vite + React behind a dev proxy

- Ran create-vite (react template) into frontend/, no interactive prompts;
  24 packages installed, 0 vulnerabilities. Scaffolding includes its own
  .gitignore covering node_modules, dist and *.log, so neither can be staged
- vite.config.js proxies /api to http://localhost:3000 and /ws to
  ws://localhost:3000 (ws: true), which keeps the browser same-origin on
  :5173 — the session cookie needs no CORS work and Phase 1's verified HTTP
  surface stays untouched
- Frontend uses relative URLs only (/api/..., ws://${location.host}/ws): no
  env files, nothing to configure per machine. Served at
  http://localhost:5173 — never a LAN IP, because crypto.randomUUID (used for
  client_message_id) is only available in a secure context and localhost
  qualifies while a LAN IP does not
- Scaffold ships oxlint; frontend lint exists but is not a project gate (the
  backend still has none — gate remains npm test in backend/)
- Hot reload was dead on arrival and it was worth chasing down: /mnt/c is a 9p
  (drvfs) mount, which delivers no inotify events, so Vite never learned that
  files had changed. Proved it rather than guessing — appended
  `body { background: red !important; }` to index.css and found the rule
  present on disk (tail) yet absent from what the dev server handed the browser
  (curl http://localhost:5173/src/index.css | grep -c "background: red" → 0).
  A hard reload didn't help either, because the staleness was server-side:
  Vite answered from its in-memory cache instead of re-reading the disk. Fixed
  with server.watch.usePolling; after restarting, the same edit repainted the
  page live with no F5. Would have silently broken every later UI step
- Gate: proxy verified end-to-end from the browser at :5173 — logged-out
  /api/auth/me → 401, register → 201, login → 200 with session_id cookie,
  WebSocket ws://localhost.host/ws → onopen; hot reload confirmed live
- Vite must run in WSL, not Git Bash: npm install ran under WSL so node_modules
  holds only the Linux native binding (@rolldown/binding-linux-x64-gnu), and
  Windows Node would fail to load it. The backend has no native bindings and
  runs fine from either shell

## 37. API client — one fetch wrapper, one 401 hook

- frontend/src/api.js is now the only place the frontend performs HTTP. Every
  call goes through a private request() wrapper: credentials 'include' (the
  session cookie is the whole auth story), JSON body/content-type set only when
  a body exists, and the response parsed leniently — a non-JSON body becomes
  null instead of throwing a parse error that would mask the real failure
- Non-2xx throws ApiError(status, message) rather than returning a bag of
  fields for every caller to check, and the message is taken from the backend's
  own { error } body so the UI shows "Username must be 3-50 characters"
  verbatim instead of a reworded near-miss. Falls back to
  `Request failed (status)` when there's no error field
- Central 401: one module-level handler slot set via setUnauthorizedHandler.
  Any 401 fires it before throwing, so a session expiring mid-conversation
  needs exactly one reaction (show the auth screen) instead of every component
  catching its own — this is what the logout/expired-session handling in later
  steps will hook into
- history(otherUserId, { limit, before }) builds the query string with
  URLSearchParams and omits empty params, matching the backend's rules
  (limit 1-100, default 50; before = id < cursor)
- Endpoint surface kept deliberately small: me, login, register, logout,
  listUsers, history. Sending messages is WebSocket-only, so there is
  deliberately no HTTP send endpoint here
- Gate: oxlint clean; in the browser at :5173 — module exports as expected,
  me() → {user:{id:5,username:'devuser1'}} with the session cookie intact,
  a 400 surfaced as ['ApiError', 400, 'Username must be 3-50 characters'], and
  a bad password produced both the handler log and
  ['ApiError', 401, 'Invalid username or password']
- Backend untouched this step — 7 suites / 41 tests still stand from step 35

## 38. Auth screen and app shell

- App.jsx is now a three-state shell: `undefined` (probing), `null` (no
  session), object (signed in). On mount it calls api.me() once and a 401
  lands on the auth screen silently — "not logged in yet" isn't an error, so
  no error banner on first load. The cancelled flag guards the async result
  against StrictMode's double-mount in dev
- One useEffect registers the 401 hook (setUnauthorizedHandler → clear the
  user) and unregisters it on unmount. From here on any 401 anywhere in the
  app drops back to the auth screen, which is what the session-expiry and
  logout steps will ride on
- components/AuthScreen.jsx: login/register toggle, labelled inputs, submit
  disabled while pending, inline field errors and the server message shown
  verbatim. Client validation mirrors backend/src/validation.js — username
  trimmed 3-50, password >=8 chars and <=72 **bytes** via TextEncoder (the
  backend uses Buffer.byteLength, so .length would accept multi-byte
  passwords the server then rejects). Login mode only checks non-empty,
  matching validateLogin
- Deleted the dead scaffold: App.css (184 lines of Vite demo styling), the
  three src/assets images, and public/icons.svg. public/favicon.svg stays,
  index.html references it. index.css keeps the :root colour variables (plus
  a new --error for both schemes) and loses the demo rules — the template had
  pinned #root to 1126px with a 56px h1, which fought the form layout
- **Trap found by the gate, worth remembering: register does not create a
  session.** authRoutes.js sets session_id only in the login handler (line
  67), so the first version of AuthScreen — which called onAuthenticated()
  after register — dropped the user into a "Signed in as …" shell with no
  cookie behind it. It looked correct and was a lie: any API call would 401
  and a reload would bounce back to the form. Fixed to option A — after
  register the form flips to login with the username prefilled, password
  cleared, and an "Account created — log in" notice. Chosen over auto-login
  (option B) to keep one code path and to not spend a login from the 10 per
  15 min budget while testing
- **Second trap, purely a browser one: Chrome's password manager silently
  overwrote the typed password with a saved one during register**, so the
  account was created with a different password and the correct one was then
  rejected with a 401. Cost us a confusing round of manual testing. Use an
  incognito window for manual auth testing, and when a 401 looks wrong, read
  the request Payload tab before suspecting the code
- Also worth knowing: a failed fetch does appear in the Network tab, but only
  while the record button is active — a paused or cleared log makes a real
  401 look like the request never happened
- Gate (manual, in an incognito window): existing session on load shows
  "Signed in as devuser1" with no auth flash; deleting the cookie shows the
  form; register with a fresh account flips to the login screen with the
  prefilled username and clears the password; a rejected password shows the
  backend's own "Invalid username or password"; the same password then logs
  in; bad input is caught client-side with two inline errors and **no
  request in the Network tab**. oxlint clean, `vite build` 18 modules
- Backend untouched this step — 7 suites / 41 tests still stand from step 35

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

- components/Conversation.jsx is presentational: it receives messages,
  currentUser and otherUser, and renders the list. Sent vs received is
  decided by comparing sender_id with currentUser.id, which keeps the
  component free of any fetching or socket logic
- App.jsx owns the messages state and a messageIdsRef Set for dedup. The
  history effect fires on selectedUser change: it resets the dedup set,
  fetches api.history(otherUserId), and reverses the result because the
  backend returns newest-first (id DESC) while the UI shows oldest-first
- Live messages arrive through the WS onMessage callback. A payload counts
  as a message when it has both id and content — read receipts carry a type
  field instead and are ignored here, since receipt UI is out of scope.
  The dedup check is a Set lookup, so a message that arrives both via
  history and via the live broadcast is appended once
- The history effect's cleanup sets cancelled, and the dedup set is reset
  on every selectedUser change, so switching conversations can't leak
  ids from the previous one
- Gate: selecting a user shows the "Chat with <name>" section with either
  the message list or "No messages yet."; switching users fires
  GET /api/messages/<id> with status 200. oxlint clean, vite build passes
- Backend untouched this step — 7 suites / 41 tests still stand from step 35

## 41. Message composer

- components/Composer.jsx is a controlled form: text input plus a Send
  button. On submit it builds { receiver_id, content, client_message_id }
  and hands the payload to App.jsx via onSend, which calls
  clientRef.current.send(payload). The input clears only when send()
  returns true, so a failed send keeps the text for a retry
- client_message_id is crypto.randomUUID() per send — a fresh id every
  time, which is what lets the backend deduplicate retries (unique
  violation 23505 returns the original row instead of inserting a copy)
- The button is disabled unless a user is selected, the socket reports
  status 'open', and the trimmed text is non-empty. That covers the
  "disabled while socket is down" requirement without any extra state:
  socketState already tracks connecting/reconnecting/closed
- The composer is only rendered when selectedUser is set, and the input
  is disabled with a "Select a user first" placeholder when it isn't
- Gate: composer appears below the conversation with a disabled Send
  button; typing enables it; sending appends the message to the list,
  clears the input, and disables the button again. oxlint clean,
  vite build passes
- Backend untouched this step — 7 suites / 41 tests still stand from step 35

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
