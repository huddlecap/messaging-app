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
- [x] Backend: replaced WebSocket closed with code 4001 and reason "replaced"
      + test
- [x] Frontend scaffold (Vite + React) with dev proxy for /api and /ws;
      session cookie and WebSocket verified through the proxy
- [x] API client (fetch wrapper, error handling, central 401 handling)
- [ ] Auth screen and app shell (register/login, client validation, errors
      shown, session check on load)
- [ ] WebSocket client (reconnect with backoff, replaced-tab handling,
      session check, no reconnect on intentional close)
- [ ] User picker
- [ ] Conversation view (first 50 messages, live append, no duplicates)
- [ ] Message composer (client_message_id per send, disabled while socket is
      down)
- [ ] Logout
- [ ] Manual end-to-end verification; backend tests green

Done when: register, login, send/receive live, view history, and logout all
work through the UI.

### Phase 3 — Automated Testing

Formal test coverage beyond the integration tests in Phase 1 — likely
expanding to the frontend, and any end-to-end flows across both.
Done when: core flows are covered by a test suite that runs without manual
steps.

### Phase 4 — Git Workflow + CI/CD

Proper feature-branch workflow, PRs, and a CI/CD pipeline that runs tests
automatically and deploys on merge.
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
