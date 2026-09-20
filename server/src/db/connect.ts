import mongoose from 'mongoose';
import { env } from '../config/env.js';

/** Connect to MongoDB. Pass an explicit URI to override env (tests). */
export async function connect(uri: string = env.MONGODB_URI): Promise<typeof mongoose> {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
    return mongoose;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to connect to MongoDB at "${uri}": ${message}`);
  }
}

export async function disconnect(): Promise<void> {
  await mongoose.disconnect();
}