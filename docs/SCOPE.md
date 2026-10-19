# SCOPE.md

## Project Goal

A 1:1 real-time messaging app, built as the final Odin Project capstone.
Goal is to build it incrementally as an MVP first, then layer in testing,
CI/CD, and scaling practices until it reaches production-grade quality.
Once production-grade, AI features get integrated on top. This is a learning
project first — built by hand (raw SQL, no ORM, no shortcuts) to actually
understand the fundamentals, not just ship fast.

## Phases

### Phase 1 — Backend MVP

Core messaging logic: auth, real-time delivery, and the basic reliability
checks a messaging app can't function without.

- [x] Auth (register, login, logout, session middleware)
- [x] WebSocket real-time messaging (connect, send, receive, persist to DB)
- [x] receiver_id validation (reject self-send, reject nonexistent receiver)
- [x] Message history GET endpoint (cursor-based pagination)
- [x] Idempotency keys on message send (prevent duplicate sends on retry)
- [x] Read receipts (unread/read status column + WS event)
- [x] WebSocket heartbeat + disconnect cleanup + multi-tab decision
- [x] Centralized error handling + input validation (hand-written)
- [x] Session expiry cleanup + auth rate limiting
- [x] Logging + graceful shutdown
- [x] Integration tests covering all of the above

Done when: a user can register, log in, send/receive messages live, load
past history, and the backend handles bad input, disconnects, and retries
without manual intervention — all verified via Postman/curl and automated
tests, no frontend needed yet.

### Phase 2 — Frontend MVP

A minimal UI wired to the existing backend. No styling polish — just enough
to replace Postman for manual testing and prove the app works end-to-end
for a real user in a browser.

- [x] Backend: GET /api/users (all users except self, requireAuth) + tests
- [x] Backend: replaced WebSocket closed with code 4001 and reason "replaced" + test
- [x] Frontend scaffold (Vite + React) with dev proxy for /api and /ws;
      session cookie and WebSocket verified through the proxy
- [x] API client (fetch wrapper, error handling, central 401 handling)
- [x] Auth screen and app shell (register/login, client validation, errors
      shown, session check on load)
- [x] WebSocket client (reconnect with backoff, replaced-tab handling,
      session check, no reconnect on intentional close)
- [x] User picker
- [x] Conversation view (first 50 messages, live append, no duplicates)
- [x] Message composer (client_message_id per send, sends while socket is down)
- [x] Logout
- [x] Offline message queue — pending messages retry every 5s and on the
      browser `online` event; retries reuse `client_message_id` so they
      cannot duplicate. Known gaps: lost on page reload, no attempt cap
- [x] Manual end-to-end verification; backend tests green

Done when: register, login, send/receive live, view history, and logout all
work through the UI.

### Phase 3 — Automated Testing

Formal test coverage beyond the integration tests in Phase 1: frontend logic
tests plus one end-to-end flow across both apps.

- [x] Frontend: install Vitest + jsdom, add `test` script
- [x] Frontend: `wsClient.js` tests (exponential backoff reconnect, `4001 replaced` handling, session check before open, no reconnect on intentional close)
- [x] E2E: install Playwright; `webServer` config starts the backend (`NODE_ENV=test`, test DB) and Vite (`:5173`)
- [x] E2E: unique test users per run + global teardown that deletes them
- [x] E2E: happy path with two browser contexts (register, login, live
      send/receive, history, logout via the logout route)
- [x] Root-level single command that runs Jest, then Vitest, then Playwright
      in sequence (they share the test DB) with no manual steps
- [x] Backend suite still green (7 suites / 41 tests)
- [x] Sanity check: for each new test, temporarily break the code it
      covers and confirm the test fails

Done when: core flows are covered by a test suite that runs without manual
steps.

Deferred: API client tests, component tests, replaced-tab and reconnect E2E
flows, logout button.

### Phase 4 — Git Workflow + CI/CD

Proper feature-branch workflow, PRs, and a CI/CD pipeline that runs tests
automatically and deploys on merge.

**Prep**

- [x] Commit docs/Architecture_Decisions.md and docs/BuildLog.md
- [x] Update docs/SCOPE.md (tick Phase 3, remove duplicate heading and stray text, add deferred notes)
- [x] Add .gitattributes and renormalize line endings (own commit)

**Git workflow**

- [ ] Practice the feature branch → push → PR → merge loop on a small change
- [ ] Set branch protection on main (require CI to pass, no direct pushes)

**CI**

- [ ] Add test DB secret to GitHub and create backend/.env.test in the workflow
- [ ] Workflow: backend install + Jest
- [ ] Add frontend install + Vitest
- [ ] Add Playwright (browser install + cache)
- [ ] Resolve the e2e cleanup guard for CI
- [ ] Switch to single root `npm test`
- [ ] Add dependency caching
- [ ] Add concurrency limit (one run at a time on the test DB)
- [ ] Check imports for Linux filename-casing issues

**Deploy decisions**

- [ ] Choose backend host (long-lived WebSockets)
- [ ] Choose frontend host
- [ ] Create production Neon branch
- [ ] Set production env vars and secrets
- [ ] Review cookie settings (secure, sameSite) for HTTPS
- [ ] Decide how the frontend reaches /api and /ws in production

**CD**

- [ ] Add deploy-on-merge job (runs on main only after tests pass)

**Prove the loop**

- [ ] Push a small change through branch → PR → CI → merge → auto deploy
- [ ] Confirm the live site updated

Done when: pushing to main triggers tests and deployment automatically, no
manual deploy steps.

### Phase 5 — Scaling

Revisit anything that assumed single-instance/in-memory behavior (e.g. the
userSockets Map won't survive multiple server instances) and address it for
a scaled environment.
Done when: the app can run across more than one instance without breaking
real-time delivery.

### Phase 6 — AI Feature Integration

Once the app is stable, tested, and production-grade, integrate AI features
on top.
Done when: defined later — deliberately out of scope until Phase 5 is complete.

## Non-Goals (for now)

- No group chats/channels — 1:1 only
- No file/image uploads
- No typing indicators
- No profile editing, password reset, or email verification
- No horizontal scaling until Phase 5
- No multi-tab support (new connection replaces old)
- Offline queue does not survive a page reload; no attempt cap and no
  `failed` state for messages that can never be delivered
