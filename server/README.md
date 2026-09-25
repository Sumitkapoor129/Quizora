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
| `npm test`         | Run the vitest suite (13 files, 170 tests)                |
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
| `CLIENT_ORIGIN`       | no       | `http://localhost:5173` | Comma-separated allowed CORS origins / Origin check. **The first entry is the post-OAuth redirect target** — put the real app first in production (e.g. `https://quizora-rho.vercel.app,http://localhost:5173`) |
| `COOKIE_SECURE`       | no       | `false`               | `true` in production (HTTPS only cookies)|
| `GOOGLE_OAUTH_CLIENT_ID`     | yes† | —                | Google Cloud OAuth client id. †Required in production |
| `GOOGLE_OAUTH_CLIENT_SECRET` | yes† | —                | Google Cloud OAuth client secret. †Required in production |
| `OAUTH_CALLBACK_URL`  | yes†     | —                     | Exact URL registered in Google Cloud. †Required in production |
| `ADMIN_EMAILS`        | yes†     | `''`                  | Comma-separated emails that resolve to `ADMIN` on every sign-in. †Required in production — an empty list would demote every admin |

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