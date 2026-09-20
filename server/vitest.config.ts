import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: '',
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      CLIENT_ORIGIN: 'http://localhost:5173',
      COOKIE_SECURE: 'false',
      PORT: '3001',
    },
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false
  }
});