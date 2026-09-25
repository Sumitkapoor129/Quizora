import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: '',
      JWT_ACCESS_SECRET: 'test-access-secret',
      CLIENT_ORIGIN: 'http://localhost:5173',
      GOOGLE_OAUTH_CLIENT_ID: 'test-google-client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'test-google-client-secret',
      OAUTH_CALLBACK_URL: 'http://localhost:3001/api/auth/oauth/google/callback',
      ADMIN_EMAILS: 'admin@example.com',
      COOKIE_SECURE: 'false',
      PORT: '3001',
    },
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false
  }
});