# Task A Fix1 Report — resource `driveUrl` scheme validation

**Branch:** `feature/resources-and-student-portal`
**Commit:** `cfbb0bc` — `fix(server): restrict resource driveUrl to http(s) schemes`

## Problem

In `server/src/routes/admin.ts`, `resourceCreateSchema` validated `driveUrl` with only zod's `.url()`. zod's `.url()` accepts **any** URL scheme (`ftp://`, `mailto:`, `file://`, etc.), not just http(s). The task brief and model spec both require a **valid http(s) URL**, and the client opens this value in `target="_blank" rel="noopener noreferrer"` — so a non-http scheme is untrusted input landing directly in an `href`.

Confirmed the bug with a red test before fixing: `POST /api/admin/resources` with `driveUrl: 'ftp://example.com/file'` returned **201** instead of 400.

## Fix (TDD)

1. **Red:** Added two tests to `server/tests/resources.test.ts`:
   - `rejects a non-http(s) driveUrl scheme with 400` — sends `ftp://example.com/file`, expects 400 / `VALIDATION_ERROR` / flat detail `{ field: 'driveUrl', message: 'Enter a valid http(s) URL.' }`. Failed as expected (got 201).
   - `accepts an http:// driveUrl with 201` — guards against over-restricting the fix to https-only.
2. **Green:** In `server/src/routes/admin.ts`:
   - Added constant `RESOURCE_URL_HTTPS = 'Enter a valid http(s) URL.'` alongside the existing resource message constants (same `SCREAMING_SNAKE` + sentence-with-period convention).
   - Chained `.refine((v) => /^https?:\/\//i.test(v), RESOURCE_URL_HTTPS)` onto `driveUrl`, with a short comment explaining why (`.url()` accepts any scheme; client opens in `_blank`).
   - The existing `RESOURCE_URL_INVALID = 'Enter a valid URL.'` check (`.url()`) is untouched, so the pre-existing `not-a-url` test assertion still passes unchanged.
   - The error handler's `flatZodIssues` maps the refine issue (path `['driveUrl']`) to the required `{ field, message }` flat-details shape automatically.

No existing test assertions were modified.

## Decisions

- **Message wording:** Reused the file's exact convention (`'Enter a valid http(s) URL.'`), a sibling constant next to `'Enter a valid URL.'`. The existing generic message is kept for the `.url()` (malformed) case so the already-committed test/assertion is not changed; the scheme-specific message applies only to the new refine.
- **`description` whitespace-only:** **Left as-is** (`.max(500)` only, no trim/refine). Judgment call: a whitespace-only description is cosmetic, not a trust-boundary issue — it renders as an empty description in the UI and cannot be exploited via `href` or similar. Title's `.trim().min(1)` exists because a whitespace-only title would break the list UI's primary label; description has no such consumer requirement, and the task brief/spec don't require it. Adding a trim would change stored values for no functional gain (ponytail: skip it). Flagging it here as a known, deliberate non-issue if the product later wants consistency.

## Test evidence

- `cd server && npm test` → **129 passed** (10 files) — 127 pre-existing + 2 new, 0 failures.
- Red run before the fix: 1 failed / 9 passed in `resources.test.ts` (ftp URL accepted with 201), confirming the bug and that the test detects it.

## Build evidence

- `cd server && npm run build` (`tsc`, strict) → **exit 0, clean.**

## Scope

- Files changed: `server/src/routes/admin.ts` (+4), `server/tests/resources.test.ts` (+21).
- `client/`, `docs/`, `.superpowers/` source untouched (this report is the only `.superpowers/` write).
- Pre-existing uncommitted client-side changes in the worktree were left untouched; only the two server files were staged.

## Remaining risks

- None identified for this fix. `javascript:` was already rejected by zod's `.url()`; `ftp:`/`mailto:`/`file:` now rejected by the refine. If a future consumer ever accepts non-http schemes for resources, the refine must be revisited.
