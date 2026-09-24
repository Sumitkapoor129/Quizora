import mongoose from 'mongoose';
import { env } from '../config/env.js';

/** Connect to MongoDB. Pass an explicit URI to override env (tests). */
export async function connect(uri: string = env.MONGODB_URI): Promise<typeof mongoose> {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
    return mongoose;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Never log credentials embedded in the connection string (Mongo Atlas
    // URIs are user:pass@host) — they surface in server/cloud logs.
    const safeUri = uri.replace(/\/\/[^@/]+@/, '//***@');
    throw new Error(`Failed to connect to MongoDB at "${safeUri}": ${message}`);
  }
}

export async function disconnect(): Promise<void> {
  await mongoose.disconnect();
}