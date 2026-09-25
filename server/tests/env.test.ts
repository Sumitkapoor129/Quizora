import { describe, expect, it } from 'vitest';
import { appOriginProblem, parseEmailList } from '../src/config/env.js';

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
    // This is exactly what server/.env.example ships.
    const problem = appOriginProblem(['http://localhost:5173', 'https://quizora-rho.vercel.app']);
    expect(problem).toContain('localhost:5173');
  });

  it('rejects every loopback spelling', () => {
    for (const first of ['http://localhost', 'https://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173']) {
      expect(appOriginProblem([first]), first).toContain(first);
    }
  });

  it('rejects an empty list, which would redirect to "undefined/"', () => {
    expect(appOriginProblem([])).toContain('CLIENT_ORIGIN is required');
  });
});
