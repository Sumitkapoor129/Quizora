# Task D — Fix Implementer Report (Findings 1 + 2)

Status: DONE
Commit: `a08f928` — `feat(client): student portal and study resources UI (Phases 10+11)`
Branch: `feature/resources-and-student-portal`

## Summary

Both verified findings fixed, TDD-style for Finding 2. Work limited to `client/src/`. No server/, docs/, or .superpowers/ files modified (docs/ and context.md left uncommitted as instructed; only `client/src` was staged).

---

## Finding 1 — CRITICAL: Dashboard.test.tsx:298 asserts a link the spec forbids at this fixture size

**Approach chosen: (a)** append a 4th test to the `studentTests` fixture. This gives the `> 3` "View all tests" footer path its only positive coverage (option (b) had none).

### Changes — `client/src/__tests__/Dashboard.test.tsx`
- Appended `t4` ("Chemistry Lab", no attempt) to the END of the `studentTests` fixture. Required `StudentTestListItem` fields mirror t3.
- Updated the now-inconsistent stat expectation: `Tests available` value `'3'` → `'4'`.
- Verified all other assertions remain valid after appending at the END:
  - `recentTests = tests.slice(0, 3)` (Dashboard.tsx:34) → top-3 cards still t1/t2/t3 → "Resume" `/student/tests/t1/attempt/a1`, "View result" `/student/tests/t2/result/a2`, "Take test" `/student/tests/t3/instructions` all unchanged.
  - "Tests taken" still `'2'` (attempts feed unchanged: a2, a4 SUBMITTED).
  - "Average score" still `'50%'`, "In progress" still `'1'`.
  - "View all tests" assertion at line 298 now passes because `tests.length = 4 > 3` (Dashboard.tsx:152).
- `studentTests` fixture is only consumed by the single "renders the stats strip…" test; no other hard-coded counts were derived from it.

### Result
`npx vitest run src/__tests__/Dashboard.test.tsx` → 11/11 passed.

---

## Finding 2 — IMPORTANT: admin delete-resource modal lacks close-while-pending guard

**TDD flow:** wrote the failing guard test first (confirmed RED — Cancel closed the modal mid-delete, `getByRole('dialog')` threw), then fixed the component (GREEN).

### Changes — `client/src/pages/admin/resources/ResourceList.tsx`
- Added `handleDeleteClose()` mirroring the add-resource modal's existing guard (lines 110-113) exactly:
  ```tsx
  function handleDeleteClose() {
    if (remove.isPending) return;
    setPendingDelete(null);
  }
  ```
- Modal `onClose={() => setPendingDelete(null)}` → `onClose={handleDeleteClose}`. Since Modal routes Escape, backdrop, and the ✕ button through `onClose` (Modal.tsx:33,67,85), all close paths are now no-ops while the delete is pending.
- Cancel button `onClick={() => setPendingDelete(null)}` → `onClick={handleDeleteClose}`.

Notes on the "established pattern": the ResourceList add modal (`handleClose`) and `ImportTestModal.tsx:139-142` both guard close-while-pending with a plain `if (mutation.isPending) return;` function — matched that. The admin Tests list delete modal (`admin/tests/List.tsx:193,197`) is a pre-existing ungarded gap outside this task's scope; not touched.

### Test — `client/src/__tests__/Resources.test.tsx`
Added `'cannot close the delete modal while the delete is pending'`:
- Mocks `api.admin.resources.remove` to a manually-resolvable pending promise.
- After confirming the delete fired: clicks Cancel → asserts dialog still open; presses `{Escape}` → asserts dialog still open.
- Resolves the promise → asserts dialog closes (delete actually completes).
- Mirrors the codebase's existing test style in this file (userEvent + waitFor + within(dialog)).

### Result
`npx vitest run src/__tests__/Resources.test.tsx` → 7/7 passed (was 6, +1 new).

---

## Verification (run on `client`)

| Check | Command | Result |
|---|---|---|
| Full suite | `npm test` | 18 files, **102/102 passed** (was 101, +1 new guard test) |
| Build | `npm run build` | clean, 119 modules, built in 5.53s |
| Typecheck | `npm run typecheck` | clean |

## Git state

- Staged ONLY `client/src/` (22 files: 11 modified + 11 new). `context.md`, `docs/`, `.superpowers/` left uncommitted.
- Single conventional commit chosen because the fixes are entangled with the pre-existing uncommitted work inside the same files (Dashboard.test.tsx was already a fully-modified file; ResourceList.tsx and Resources.test.tsx were untracked new files): `a08f928`.
- Not merged, not pushed.

## Concerns

- **None blocking.** Two minor notes: (1) the admin Tests delete modal has the same close-while-pending gap (pre-existing, out of scope, spec-adjacent — worth a follow-up); (2) one commit carries both the feature and the fixes, unavoidable without `git add -p` surgery across entangled untracked/modified files.