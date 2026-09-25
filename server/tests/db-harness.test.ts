import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, disconnect } from '../src/db/connect.js';
import { User } from '../src/models/User.js';

let mongo: MongoMemoryServer | undefined;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connect(mongo.getUri());
  await User.init(); // guarantee the unique index exists before we test duplication
}, 120_000);

afterAll(async () => {
  await disconnect();
  await mongo?.stop();
});

describe('mongodb via mongodb-memory-server', () => {
  it('creates a user without a password and rejects a duplicate googleId', async () => {
    const user = await User.create({ email: 'nopass@example.com', name: 'No Pass', googleId: 'sub-1' });
    expect(user.role).toBe('STUDENT');
    expect(user.googleId).toBe('sub-1');
    await expect(
      User.create({ email: 'other@example.com', name: 'Other', googleId: 'sub-1' })
    ).rejects.toMatchObject({ code: 11000 });
  });
});