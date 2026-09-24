import { describe, expect, it } from 'vitest';
import { assetUrl } from '@/api/client';

describe('assetUrl', () => {
  it('prefixes the API origin for relative paths', () => {
    expect(assetUrl('/uploads/a.png')).toBe('http://localhost:3001/uploads/a.png');
  });

  it('passes through absolute URLs unchanged', () => {
    expect(assetUrl('https://res.cloudinary.com/x/y.png')).toBe('https://res.cloudinary.com/x/y.png');
  });

  it('returns an empty string for missing paths', () => {
    expect(assetUrl(null)).toBe('');
    expect(assetUrl(undefined)).toBe('');
    expect(assetUrl('')).toBe('');
  });
});