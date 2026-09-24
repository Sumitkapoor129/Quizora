# mcq-exam-server

Backend for the MCQ exam platform.

## Stack

Node.js v24, Express v4, Mongoose (MongoDB), TypeScript (strict, ESM), zod,
argon2id, JWT cookie auth. Tests: vitest + supertest + mongodb-memory-server.

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
| `npm test`         | Run the vitest suite (health, error shape, auth, DB)      |
| `npm run typecheck`| Type-check only (`tsc --noEmit`)                          |

`npm run dev` / `npm start` refuse to boot with a clear message when
`MONGODB_URI` is missing.

## Environment variables (`server/.env`)

| Variable              | Required | Default               | Notes                                    |
| --------------------- | -------- | --------------------- | ---------------------------------------- |
| `NODE_ENV`            | no       | `development`         | `development` / `test` / `production`    |
| `PORT`                | no       | `3001`                | HTTP port                                |
| `MONGODB_URI`         | yes*     | —                     | Atlas/real Mongo URI. *Not needed for tests |
| `JWT_ACCESS_SECRET`   | yes*     | —                     | Long random value. *Not needed for tests |
| `JWT_REFRESH_SECRET`  | yes*     | —                     | Long random value. *Not needed for tests |
| `CLIENT_ORIGIN`       | no       | `http://localhost:5173` | Comma-separated allowed CORS origins / Origin check (e.g. `...`,https://quizora-sk.vercel.app) |
| `COOKIE_SECURE`       | no       | `false`               | `true` in production (HTTPS only cookies)|

## API

- `GET /health` — liveness probe, no DB required: `{ ok, service, time }`.
- Phase 2 adds the auth / test / attempt routes under `/api/...`.

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
tests/            vitest suite
```