import { describe, expect, it } from 'vitest';
import { parseEmailList } from '../src/config/env.js';

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
