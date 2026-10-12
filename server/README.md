# mcq-exam-server

Backend for the MCQ exam platform.

## Stack

Node.js v24, Express v4, Mongoose (MongoDB), TypeScript (strict, ESM), zod,
Google OAuth, JWT cookie auth. Tests: vitest + supertest + mongodb-memory-server.

## Prerequisites

- Node.js >= 24
- A MongoDB connection string for local dev (e.g. a free MongoDB Atlas cluster).
  Tests do NOT need one — they use an in-memory MongoDB.

## Setup

```sh
cd server
npm install
cp .env.example .env   # then fill in MONGODB_URI and secrets
```

## Running

| Command            | What it does                                              |
| ------------------ | --------------------------------------------------------- |
| `npm run dev`      | Start dev server with hot reload (tsx watch)              |
| `npm run build`    | Type-check and compile to `dist/` (tsc)                   |
| `npm start`        | Run the compiled server (`node dist/server.js`)           |
| `npm test`         | Run the vitest suite (13 files, 173 tests)                |
| `npm run typecheck`| Type-check only (`tsc --noEmit`) — excludes `tests/`      |

`npm run dev` / `npm start` refuse to boot with a clear message when
`MONGODB_URI` is missing.

## Environment variables (`server/.env`)

| Variable              | Required | Default               | Notes                                    |
| --------------------- | -------- | --------------------- | ---------------------------------------- |
| `NODE_ENV`            | no       | `development`         | `development` / `test` / `production`    |
| `PORT`                | no       | `3001`                | HTTP port                                |
| `MONGODB_URI`         | yes*     | —                     | Atlas/real Mongo URI. *Not needed for tests |
| `JWT_ACCESS_SECRET`   | yes*     | —                     | Long random value. *Not needed for tests |
| `CLIENT_ORIGIN_DEV` / `CLIENT_ORIGIN_PROD` | no / yes† | Localhost and 127.0.0.1 on port 5173 / — | Comma-separated frontend origins; first is the fallback post-login destination |
| `PUBLIC_BACKEND_ORIGIN_DEV` / `PUBLIC_BACKEND_ORIGIN_PROD` | no / yes† | `http://localhost:3001` / — | Backend HTTP origin locally, clean HTTPS origin in production |
| `OAUTH_CALLBACK_URL_DEV` / `OAUTH_CALLBACK_URL_PROD` | no / yes† | Local backend callback / — | Exact Google redirect URI; production uses the frontend origin and `/api/auth/oauth/google/callback` |
| `COOKIE_SECURE_DEV` / `COOKIE_SECURE_PROD` | no | `false` / `true` | Production requires secure cookies |
| `GOOGLE_OAUTH_CLIENT_ID`     | yes† | —                | Google Cloud OAuth client id. †Required in production |
| `GOOGLE_OAUTH_CLIENT_SECRET` | yes† | —                | Google Cloud OAuth client secret. †Required in production |
| `ADMIN_EMAILS`        | yes†     | `''`                  | Comma-separated emails that resolve to `ADMIN` on every sign-in. †Required in production — an empty list would demote every admin |

### Local and production profiles

Keep both sets of settings in `server/.env` as shown in `.env.example`. Select
local settings with `NODE_ENV=development`, or production with `NODE_ENV=production`.
Explicit `_DEV` or `_PROD` values override the legacy `CLIENT_ORIGIN`,
`PUBLIC_BACKEND_ORIGIN`, `OAUTH_CALLBACK_URL`, and `COOKIE_SECURE` variables.
Legacy deployment variables continue to work when a profile value is absent.
Restart the server after changing environment variables. Never commit `.env`.

For the frontend, copy `client/.env.example` to `client/.env`. Keep
`VITE_API_URL_DEV=` blank to use the current loopback hostname on port 3001,
and leave `VITE_API_URL_PROD` blank in production. The production app uses the
Vercel same-origin `/api` and `/uploads` rewrites to the backend; this keeps
session cookies first-party in browsers that block third-party cookies.
The browser hostname selects the profile, so a production build previewed on
localhost still calls the local backend. Explicit profile URLs take precedence
over the legacy `VITE_API_URL` fallback. Vite embeds these public settings at
build time: restart the dev server or rebuild after changing them.

Locally run the client at `http://localhost:5173` and the backend at
`http://localhost:3001`. The local allowlist also supports `127.0.0.1:5173`.
The browser must use the same local hostname for frontend and backend so session
cookies remain available. The client selects its local API hostname accordingly.
OAuth remembers an allowlisted frontend Origin/Referer and returns there after
login; without one it uses the first configured frontend origin.

Register all callback URLs you use in Google Cloud's **Authorized redirect URIs**:

- `http://localhost:3001/api/auth/oauth/google/callback`
- `http://127.0.0.1:3001/api/auth/oauth/google/callback` (if using this alias)
- `http://[::1]:3001/api/auth/oauth/google/callback` (if using IPv6 loopback)
- `https://quizora-techteam.vercel.app/api/auth/oauth/google/callback`

Set production `OAUTH_CALLBACK_URL` to that Vercel URL and register it in Google
Cloud. Vercel forwards the OAuth callback to Render, while the browser sees the
Vercel origin for both OAuth and API requests. Production retains HTTPS validation
and an explicit frontend allowlist; arbitrary request hostnames never become callbacks.

## API

- `GET /health` — liveness probe, no DB required: `{ ok, service, time }`.
- `GET /api/auth/oauth/google` — sign-in start. 302 to Google; optional `?next=` is
  validated as a same-origin path and stored in an httpOnly cookie.
- `GET /api/auth/oauth/google/callback` — the redirect URI registered in Google
  Cloud. Verifies state, exchanges the code, requires a verified email, upserts the
  user and issues the session. The only route exempt from `originCheck`.
- `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me` — session lifecycle.
- `PATCH /api/student/profile` — name only; there is no local password to change.
- Test / attempt / admin / student routes under `/api/...`.

> Google is the only sign-in path. The password, OTP and password-reset endpoints are
> gone from both server and client, so server and client deploy as one unit.

## Structure

```
src/
  app.ts          createApp(): middleware chain + routes
  server.ts       boot/shutdown
  config/env.ts   zod-validated environment
  db/connect.ts   mongoose connect/disconnect
  errors.ts       AppError
  middleware/     errorHandler, notFound, originCheck, auth (authenticate, requireRole)
  models/         User, RefreshSession, Test, TestAttempt (embedded design)
  routes/         auth, student, admin, analytics, import, resources
  services/       session (tokens + cookies), googleOAuth (protocol)
tests/            vitest suite
```
