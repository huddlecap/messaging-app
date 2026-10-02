# Project Structure

```
messaging-app/
├── .git/
├── AGENTS.md
├── Architecture_Decisions.md
├── BuildLog.md
├── Progress.md
├── Project_Structure.md
├── README.md
├── SCOPE.md
├── backend/
    ├── .env                    # production/dev environment variables
    ├── .env.test               # test environment variables (test DB)
    ├── .gitignore
    ├── cookies.txt
    ├── cookiesA.txt
    ├── cookiesB.txt
    ├── jest.config.js          # Jest config (node env, 10s test timeout)
    ├── node_modules/           # dependencies (excluded from sharing)
    ├── package-lock.json
    ├── package.json
    └── src/
        ├── app.js              # Express app only (no server startup)
        ├── index.js            # server startup + WebSocket wiring + graceful shutdown
        ├── validation.js       # request payload validation
        ├── __tests__/
        │   ├── auth.test.js
        │   ├── errorHandling.test.js
        │   ├── messages.test.js
        │   ├── rateLimit.test.js
        │   ├── sessionCleanup.test.js
        │   ├── users.test.js
        │   └── websocket.test.js
        ├── db/
        │   ├── db.js           # pg Pool; loads .env.test when NODE_ENV=test, else .env
        │   ├── schema.sql      # database schema
        │   └── sessionCleanup.js  # periodic expired-session cleanup
        ├── middleware/
        │   ├── authMiddleware.js  # session-cookie auth (requireAuth)
        │   └── rateLimiters.js    # login/register limiters
        ├── routes/
        │   ├── authRoutes.js      # register / login / logout
        │   ├── messageRoutes.js   # message history (GET /:otherUserId)
        │   └── userRoutes.js      # user list (GET /, all except self)
        └── ws/
            └── index.js           # WebSocket auth, messaging, read receipts, heartbeat
└── frontend/                  # React + Vite app (Phase 2, minimal UI)
    ├── .gitignore              # ignores node_modules, dist, *.log
    ├── .oxlintrc.json          # oxlint config (from Vite scaffold)
    ├── index.html              # Vite entry point
    ├── node_modules/           # dependencies (excluded from sharing)
    ├── package.json            # scripts: dev, build, lint, preview
    ├── public/
    ├── src/                    # App.jsx, main.jsx, styles (placeholder screen)
    └── vite.config.js          # dev proxy: /api and /ws → localhost:3000
```

## Key Source Files

| File | Purpose |
|------|---------|
| `backend/src/app.js` | Express app only — middleware, routes, 404, error handler (no listen) |
| `backend/src/index.js` | Entry point — loads env, starts HTTP+WS server, graceful shutdown |
| `backend/src/validation.js` | Input validation (register, login, history query, message payload, read receipt) |
| `backend/src/db/db.js` | pg Pool; dotenv picks `.env.test` when `NODE_ENV=test`, else `.env` |
| `backend/src/db/schema.sql` | Database schema |
| `backend/src/db/sessionCleanup.js` | Deletes expired sessions on an hourly interval |
| `backend/src/middleware/authMiddleware.js` | `requireAuth` session-cookie middleware |
| `backend/src/middleware/rateLimiters.js` | `loginLimiter` / `registerLimiter` (bypassed when `NODE_ENV=test` unless `TEST_RATE_LIMIT=1`) |
| `backend/src/routes/authRoutes.js` | Register / login / logout routes |
| `backend/src/routes/messageRoutes.js` | Message history route with cursor pagination |
| `backend/src/routes/userRoutes.js` | User list route (caller's own account excluded) |
| `backend/src/ws/index.js` | WebSocket handler — cookie auth, send/receive, read receipts, heartbeat |
| `backend/src/__tests__/` | 7 Jest test suites (auth, messages, websocket, rateLimit, sessionCleanup, errorHandling, users) |
| `backend/jest.config.js` | `testEnvironment: node`, `testTimeout: 10000` |
| `backend/package.json` | Scripts: `test` (Jest, NODE_ENV=test, runInBand), `dev` (nodemon) |
| `frontend/vite.config.js` | Dev server config — proxies `/api` and `/ws` to `localhost:3000` |
| `frontend/package.json` | Scripts: `dev` (Vite), `build`, `lint` (oxlint), `preview` |
| `frontend/src/api.js` | HTTP client — `fetch` wrapper, `ApiError`, single 401 hook (`setUnauthorizedHandler`), auth/users/history endpoints |
| `backend/.env` | Production/dev environment variables |
| `backend/.env.test` | Test environment variables (test database) |
| `backend/.gitignore` | Git ignore rules |

## Notes
- `AGENTS.md` — agent instructions (commands, test rules, invariants)
- `node_modules/` is excluded — install with `npm install`
- Tests: `npm test` from `backend/` — 7 suites, 41 tests, sequential (`--runInBand`) against the test DB (`.env.test`)
- Test script uses `cross-env` + `NODE_OPTIONS=--experimental-vm-modules` (portable env vars; Jest require(esm) for the `cookie` package)
- `Progress.md` tracks project progress
- `BuildLog.md` contains build logs
- `Architecture_Decisions.md` / `SCOPE.md` — decisions and scope
