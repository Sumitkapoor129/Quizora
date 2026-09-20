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
  it('creates a user', async () => {
    const user = await User.create({
      email: 'alice@example.com',
      name: 'Alice',
      passwordHash: 'not-a-real-hash'
    });
    expect(user.email).toBe('alice@example.com');
    expect(user.name).toBe('Alice');
    expect(user.role).toBe('STUDENT');
    expect(user.passwordHash).toBe('not-a-real-hash');
  });

  it('rejects a duplicate unique email with the duplicate-key error', async () => {
    const email = 'dup@example.com';
    await User.create({ email, name: 'One', passwordHash: 'x' });
    await expect(User.create({ email, name: 'Two', passwordHash: 'y' })).rejects.toMatchObject({
      code: 11000
    });
  });
});