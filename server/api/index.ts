import { createApp } from '../src/app.js';
import { connect } from '../src/db/connect.js';

// Vercel serverless entry. The app module is cached across warm invocations,
// so mongoose connects once on cold start and is reused.
const app = createApp();

// # ponytail: retry forever every 5s. A transient cold-start failure then
// reconnects instead of permanently poisoning the warm instance (the driver
// won't auto-reconnect until a first connect succeeds).
async function connectWithRetry(): Promise<void> {
  for (;;) {
    try {
      await connect();
      console.log('[vercel] MongoDB connected');
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[vercel] MongoDB connection failed, retrying in 5s: ${message}`);
      await new Promise((resolveRetry) => setTimeout(resolveRetry, 5000));
    }
  }
}

void connectWithRetry();

export default app;