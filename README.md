# Messaging App

Messaging API (Express + WebSocket) with a minimal React frontend for 1:1 real-time chat: user registration/login with session cookies, message history over REST, and live delivery over WebSocket with idempotent sends.

## Tech Stack

- **Backend:** Node.js (CommonJS), Express 5, `ws` WebSocket server, PostgreSQL (Neon) via `pg`
- **Frontend:** React 19 + Vite dev server (`frontend/`), plain CSS
- **Auth:** session cookie (`httpOnly`, `sameSite=strict`), passwords hashed with `bcrypt`
- **Tests:** Jest + Supertest (41 tests, 7 suites) — backend only
- **Dev:** nodemon (backend), Vite (frontend)

## Setup

```bash
cd backend
npm install
```

Create `backend/.env` with:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string (dev/production branch) |
| `PORT` | HTTP server port |

`.env.test` (test-branch `DATABASE_URL`) is loaded automatically when `NODE_ENV=test`. Both files are gitignored — never commit them.

Run the dev server:

```bash
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **`http://localhost:5173`** (use localhost, never a LAN IP — `crypto.randomUUID` requires a secure context). The Vite dev server proxies `/api` and `/ws` to the backend on `:3000`, so no CORS is involved and the session cookie works same-origin.

Both servers must be running (backend on `:3000`, frontend on `:5173`).

## Testing

```bash
npm test
```

Runs all 7 suites (41 tests) against the test database and must exit 0. Testing rules and quirks (shared DB, `--runInBand`, rate-limiter opt-in, etc.) are documented in [AGENTS.md](AGENTS.md).

## Architecture

- `src/app.js` — Express app (middleware, routes, error handling); `src/index.js` — startup, WebSocket wiring, graceful shutdown
- `src/ws/index.js` — session-cookie auth on upgrade, one socket per user (old one closed with 4001 `"replaced"`), heartbeats, read receipts, `client_message_id` dedup
- `src/validation.js` — single source of input rules for HTTP + WS
- `src/db/` — pool, schema (`schema.sql` mirrors the live DB), hourly session cleanup
- `frontend/src/api.js` — single HTTP entry point: `fetch` wrapper, `ApiError`, one central 401 handler

File-by-file map: [Project_Structure.md](docs/Project_Structure.md) · Full technical log: [Progress.md](docs/Progress.md)

## API

**Auth** (`/api/auth`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Create account (rate-limited: 5/hour) |
| `POST` | `/api/auth/login` | Start session, sets `session_id` cookie (rate-limited: 10 per 15 min) |
| `POST` | `/api/auth/logout` | Delete session, clear cookie |
| `GET`  | `/api/auth/me` | Current user (requires session) |

**Messages** (`/api/messages`, requires session)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/messages/:otherUserId` | Conversation history, cursor pagination (`?limit=`, `?before=`) |

**Users** (`/api/users`, requires session)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/users` | All users except the caller — `{ users: [{ id, username }] }`. MVP limitation: every username is visible to any logged-in user |

**WebSocket** — connect with the `session_id` cookie, then exchange JSON:

| Type | Direction | Purpose |
|------|-----------|---------|
| `{ type: "message", receiver_id, content, client_message_id }` | client → server | Send message (persisted before delivery; duplicate `client_message_id` returns the original) |
| `{ type: "read_receipt", message_id }` | client → server | Mark received; sender is notified |
| `{ type: "message", … }` / `{ type: "read_receipt", … }` | server → client | Delivery and receipt notifications |
| `{ type: "error", message }` | server → client | Validation / send failure |

## Not Yet Implemented

No presence/typing indicators, group chats, attachments, CORS, or HTTPS (`secure: false` cookie). Full list: [Progress.md](docs/Progress.md) §7.

### Offline Message Queue

A message that can't be delivered isn't lost. It stays in a client-side
pending queue and retries automatically — no retry button, no retyping.

- Each send gets a `client_message_id` generated once, at enqueue time
- Pending messages resend every 5s while any remain unresolved
- A send also triggers immediately on the browser's `online` event
- The echo from the server resolves the entry; the queue and its timer clear
- Retries reuse the same `client_message_id`, so the `23505` path in
  `ws/index.js` returns the original row — retries cannot duplicate

Known gaps: pending messages are held in React state, so a page reload during
an outage loses them. There is no attempt cap, and no `failed` state — a
message that can never send retries indefinitely showing `sending…`.
