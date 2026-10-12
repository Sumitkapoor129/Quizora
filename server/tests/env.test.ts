import { describe, expect, it } from 'vitest';
import { appOriginProblem, parseEmailList, productionProblems } from '../src/config/env.js';
import { originListProblem, resolveEnvironmentProfile } from '../src/config/environmentProfile.js';

/** A production config that must boot clean; override one field to break it. */
const validProd = {
  NODE_ENV: 'production',
  GOOGLE_OAUTH_CLIENT_ID: 'id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
  OAUTH_CALLBACK_URL: 'https://quizora-rho.vercel.app/api/auth/oauth/google/callback',
  PUBLIC_BACKEND_ORIGIN: 'https://quizora-ppfp.onrender.com',
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
    expect(problem).toContain('localhost');
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
      expect(appOriginProblem([first]), first).not.toBeNull();
    }
  });

  it('does not reject a public domain that merely starts with "localhost"', () => {
    expect(appOriginProblem(['https://localhost.example.com'])).toBeNull();
    expect(appOriginProblem(['https://127.0.0.1.example.com'])).toBeNull();
  });

  it('rejects a first entry that is not an http(s) URL', () => {
    expect(appOriginProblem(['javascript:alert(1)'])).toContain('HTTP');
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
    expect(problems).toHaveLength(7);
    for (const key of [
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'OAUTH_CALLBACK_URL',
      'PUBLIC_BACKEND_ORIGIN',
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
    expect(problems[0]).toContain('localhost');
  });

  it('rejects a callback on the backend instead of the allowlisted frontend', () => {
    const problems = productionProblems({
      ...validProd,
      OAUTH_CALLBACK_URL: 'https://quizora-ppfp.onrender.com/api/auth/oauth/google/callback'
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('OAUTH_CALLBACK_URL');
  });

  it.each([
    'https://quizora-ppfp.onrender.com/wrong-path',
    'https://quizora-ppfp.onrender.com/api/auth/oauth/google/callback?redirect=evil',
    'http://quizora-ppfp.onrender.com/api/auth/oauth/google/callback'
  ])('rejects unsafe callback %s', (OAUTH_CALLBACK_URL) => {
    expect(productionProblems({ ...validProd, OAUTH_CALLBACK_URL })).not.toEqual([]);
  });
});

describe('deployment profiles', () => {
  const profiles = {
    CLIENT_ORIGIN_DEV: 'http://localhost:5173,http://127.0.0.1:5173',
    CLIENT_ORIGIN_PROD: 'https://app.example.com',
    PUBLIC_BACKEND_ORIGIN_DEV: 'http://localhost:3001',
    PUBLIC_BACKEND_ORIGIN_PROD: 'https://api.example.com',
    OAUTH_CALLBACK_URL_DEV: 'http://localhost:3001/api/auth/oauth/google/callback',
    OAUTH_CALLBACK_URL_PROD: 'https://api.example.com/api/auth/oauth/google/callback',
    COOKIE_SECURE_DEV: 'false', COOKIE_SECURE_PROD: 'true'
  };
  it.each(['development', 'test', 'production'])('selects settings for %s', (NODE_ENV) => {
    const suffix = NODE_ENV === 'production' ? 'PROD' : 'DEV';
    const resolved = resolveEnvironmentProfile({ ...profiles, NODE_ENV, CLIENT_ORIGIN: 'https://legacy.example.com' });
    for (const key of ['CLIENT_ORIGIN', 'PUBLIC_BACKEND_ORIGIN', 'OAUTH_CALLBACK_URL', 'COOKIE_SECURE']) {
      expect(resolved[key]).toBe(profiles[`${key}_${suffix}` as keyof typeof profiles]);
    }
  });
  it('preserves legacy explicit settings', () => {
    const legacy = { CLIENT_ORIGIN: 'http://localhost:4200', PUBLIC_BACKEND_ORIGIN: 'http://localhost:4000', OAUTH_CALLBACK_URL: 'http://localhost:4000/api/auth/oauth/google/callback', COOKIE_SECURE: 'false' };
    expect(resolveEnvironmentProfile(legacy)).toMatchObject(legacy);
  });
  it('provides local defaults and uses the configured backend port', () => {
    expect(resolveEnvironmentProfile({ PORT: '4000' })).toMatchObject({
      CLIENT_ORIGIN: 'http://localhost:5173,http://127.0.0.1:5173',
      PUBLIC_BACKEND_ORIGIN: 'http://localhost:4000',
      OAUTH_CALLBACK_URL: 'http://localhost:4000/api/auth/oauth/google/callback',
      COOKIE_SECURE: 'false'
    });
  });
  it('never silently defaults production to localhost', () => {
    const selected = resolveEnvironmentProfile({ NODE_ENV: 'production', ...profiles, CLIENT_ORIGIN_PROD: undefined, PUBLIC_BACKEND_ORIGIN_PROD: undefined, OAUTH_CALLBACK_URL_PROD: undefined });
    expect(selected.CLIENT_ORIGIN).toBeUndefined();
    expect(selected.PUBLIC_BACKEND_ORIGIN).toBeUndefined();
    expect(selected.OAUTH_CALLBACK_URL).toBeUndefined();
    expect(selected.COOKIE_SECURE).toBe('true');
  });
  it.each(['https://good.example/path', 'https://user:secret@good.example', 'https://good.example?x=1', 'javascript:alert(1)', 'not-a-url'])(
    'validates every origin, including secondary entry %s', (bad) => {
      expect(originListProblem(['https://good.example', bad])).not.toBeNull();
    }
  );
});
