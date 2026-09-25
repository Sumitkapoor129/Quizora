import { describe, expect, it } from 'vitest';
import { appOriginProblem, parseEmailList, productionProblems } from '../src/config/env.js';

/** A production config that must boot clean; override one field to break it. */
const validProd = {
  NODE_ENV: 'production',
  GOOGLE_OAUTH_CLIENT_ID: 'id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
  OAUTH_CALLBACK_URL: 'https://quizora-rho.vercel.app/api/auth/oauth/google/callback',
  ADMIN_EMAILS: 'admin@example.com',
  COOKIE_SECURE: true,
  CLIENT_ORIGIN: ['https://quizora-rho.vercel.app']
};

describe('parseEmailList', () => {
  it('trims, lower-cases and drops empty entries', () => {
    expect([...parseEmailList(' Admin@Example.com , b@x.com ,, ')]).toEqual([
      'admin@example.com',
      'b@x.com'
    ]);
  });

  it('returns an empty set for an empty string', () => {
    expect(parseEmailList('').size).toBe(0);
  });
});

describe('appOriginProblem', () => {
  it('accepts a production app listed first', () => {
    expect(appOriginProblem(['https://quizora-rho.vercel.app', 'http://localhost:5173'])).toBeNull();
  });

  it('rejects a dev-first list, which would send every sign-in to localhost', () => {
    // The shape server/.env.example ships.
    const problem = appOriginProblem(['http://localhost:5173', 'https://quizora-rho.vercel.app']);
    expect(problem).toContain('localhost:5173');
  });

  it('rejects every loopback spelling', () => {
    for (const first of [
      'http://localhost',
      'https://localhost:5173',
      'http://127.0.0.1:5173',
      'http://127.0.0.2',
      'http://0.0.0.0:5173',
      'http://[::1]:5173',
      'http://LOCALHOST:5173'
    ]) {
      expect(appOriginProblem([first]), first).toContain(first);
    }
  });

  it('does not reject a public domain that merely starts with "localhost"', () => {
    expect(appOriginProblem(['https://localhost.example.com'])).toBeNull();
    expect(appOriginProblem(['https://127.0.0.1.example.com'])).toBeNull();
  });

  it('rejects a first entry that is not an http(s) URL', () => {
    expect(appOriginProblem(['javascript:alert(1)'])).toContain('http://');
  });

  it('rejects an empty list, which would redirect to "undefined/"', () => {
    expect(appOriginProblem([])).toContain('CLIENT_ORIGIN is required');
  });
});

describe('productionProblems', () => {
  // The block that calls these exits the process at import time, so these are the
  // only thing pinning the production gate. If they ever return [] for a broken
  // config, the server boots and misroutes every sign-in instead of refusing.
  it('is silent outside production, even for a broken config', () => {
    for (const nodeEnv of ['development', 'test']) {
      expect(productionProblems({ ...validProd, NODE_ENV: nodeEnv, CLIENT_ORIGIN: [] })).toEqual([]);
    }
  });

  it('accepts a fully configured production environment', () => {
    expect(productionProblems(validProd)).toEqual([]);
  });

  it('reports every missing production setting, not just the first', () => {
    const problems = productionProblems({
      NODE_ENV: 'production',
      GOOGLE_OAUTH_CLIENT_ID: '',
      GOOGLE_OAUTH_CLIENT_SECRET: '',
      OAUTH_CALLBACK_URL: '',
      ADMIN_EMAILS: '',
      COOKIE_SECURE: false,
      CLIENT_ORIGIN: []
    });
    expect(problems).toHaveLength(6);
    for (const key of [
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'OAUTH_CALLBACK_URL',
      'ADMIN_EMAILS',
      'COOKIE_SECURE',
      'CLIENT_ORIGIN'
    ]) {
      expect(problems.some((p) => p.includes(key)), key).toBe(true);
    }
  });

  it('rejects a dev-first CLIENT_ORIGIN, which is the .env.example trap', () => {
    const problems = productionProblems({
      ...validProd,
      CLIENT_ORIGIN: ['http://localhost:5173', 'https://quizora-rho.vercel.app']
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('localhost:5173');
  });
});
