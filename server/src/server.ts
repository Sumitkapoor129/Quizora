import { setDefaultResultOrder } from 'node:dns';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { connect } from './db/connect.js';

// Render has no outbound IPv6 route; smtp.gmail.com resolves to a AAAA record
// first and SMTP connection would fail with ENETUNREACH. Prefer IPv4.
setDefaultResultOrder('ipv4first');

const app = createApp();

// Health-first boot: start listening immediately, then attempt the DB
// connection in parallel so /health stays up even while MongoDB connects
// (or fails). An empty MONGODB_URI already fails fast in env.ts.
const server = app.listen(env.PORT, () => {
  console.log(`[server] mcq-exam-server listening on http://localhost:${env.PORT} (env=${env.NODE_ENV})`);
});

void (async () => {
  try {
    await connect();
    console.log('[db] MongoDB connected');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[db] MongoDB connection failed: ${message}`);
    console.error('[db] /health stays up, but DB-dependent routes will fail. Check MONGODB_URI in server/.env.');
  }
})();

function shutdown(signal: string): void {
  console.log(`[server] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));