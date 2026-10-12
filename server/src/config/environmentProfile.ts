/** Select deployment settings without loading dotenv or requiring application secrets. */
export function resolveEnvironmentProfile(raw: Record<string, string | undefined>): Record<string, string | undefined> {
  const production = raw.NODE_ENV === 'production';
  const suffix = production ? 'PROD' : 'DEV';
  const localBackend = `http://localhost:${raw.PORT || '3001'}`;
  const defaults: Record<string, string | undefined> = {
    CLIENT_ORIGIN: production ? undefined : 'http://localhost:5173,http://127.0.0.1:5173',
    PUBLIC_BACKEND_ORIGIN: production ? undefined : localBackend,
    OAUTH_CALLBACK_URL: production ? undefined : `${localBackend}/api/auth/oauth/google/callback`,
    COOKIE_SECURE: production ? 'true' : 'false'
  };
  const selected = { ...raw };
  for (const key of Object.keys(defaults)) {
    selected[key] = raw[`${key}_${suffix}`] ?? raw[key] ?? defaults[key];
  }
  return selected;
}

/** Validate every allowlisted origin; error messages never echo configured values. */
export function originListProblem(origins: string[], production = false): string | null {
  if (!origins.length) return '[env] CLIENT_ORIGIN must contain at least one origin.';
  for (const [index, origin] of origins.entries()) {
    let url: URL;
    try { url = new URL(origin); }
    catch { return '[env] CLIENT_ORIGIN contains an invalid URL.'; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) {
      return '[env] CLIENT_ORIGIN entries must be clean HTTP(S) origins without paths, credentials, queries, or fragments.';
    }
    if (production && index === 0 && (url.protocol !== 'https:' ||
        ['localhost', '0.0.0.0', '[::1]'].includes(url.hostname.toLowerCase()) ||
        /^127\.\d+\.\d+\.\d+$/.test(url.hostname))) {
      return '[env] Production CLIENT_ORIGIN entries must be public HTTPS origins.';
    }
  }
  return null;
}
