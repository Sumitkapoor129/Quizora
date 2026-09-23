# Task C report — Google Drive link preview + external resource security research

Status: DONE (research-only; no code changes)
Research doc: `docs/research/drive-links.md`

## Recommendation (3-line summary)

Store the pasted Google Drive share URL as an opaque string (validate with `new URL()`: http/https only, no credentials) and render each card's action as a plain `<a href target="_blank" rel="noopener noreferrer">` — no iframes, no `/uc` download rewriting, no file-ID extraction, zero new dependencies. Server stores but never fetches the URL, so there is no SSRF surface; if a future feature fetches it server-side, SSRF hardening must be added then. This "labeled external link opened in a new tab" baseline is the simplest and also the most robust: it survives Google's churn on `/uc` and `/preview` and works uniformly for PDFs, images, and zips.

## Findings per question (details + sources in the research doc)

1. **Link formats**: `/view` share links work for "Anyone with the link" without login (stable, supported). `/preview` is the official embed form. The `/uc?export=download|view` direct-download endpoint is undocumented and was deprecated for embeddable content over 2023–2024 (403s, virus-scan interstitials >~100MB, anonymous quota banners) — do not build on it.
2. **Preview vs download**: the `/preview` iframe works for public PDFs but is Google-controlled and intermittently broken (X-Frame-Options issues, workaround formats, timeouts), poor for images, and nonexistent for zips. A well-labeled external link in a new tab is the better UX and security choice for card-based resources.
3. **Security**: `target="_blank"` implies `rel=noopener` in modern browsers, but include `rel="noopener noreferrer"` explicitly for older ones. Validate scheme (http/https) + no credentials via `new URL()`. Hard hostname allowlisting to drive.google.com is brittle (docs.google.com, drive.usercontent.google.com, non-Drive admin links); treat as UX guardrail, not security boundary. Server-stores-never-fetches = zero SSRF surface; SSRF only arises when the server makes requests to user-influenced URLs.
4. **ID extraction**: robust pattern is `/[?&\/](?:id=|d\/)([a-zA-Z0-9_-]{25,})/` (IDs are base64url, ~33 chars). Brittle against dead goo.gl shortlinks, corporate redirects, resourcekey params, /folders/ URLs. Not needed for the recommended approach — we never extract IDs.