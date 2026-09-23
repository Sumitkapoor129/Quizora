# Task C brief — search: Google Drive link preview + external resource security research

Repo: C:\Users\91983\Desktop\VibeCoded\forms (branch feature/resources-and-student-portal).

You are the search subagent. Research external information with the web. Write a research note file ONLY (docs/research/), no code changes, no subagents.

## Context
We are adding a "Study Resources" feature: admins paste an external **Google Drive share link** for PDF/zip/image study material; students see preview cards with title + short description and open the link. We need facts, not opinions.

## Research questions (answer each factually, with sources)
1. **Google Drive link formats:** Standard share links look like `https://drive.google.com/file/d/<FILE_ID>/view`. How do you turn a share link into a working direct-download, embed/"preview" link? (e.g. `/preview`, `uc?export=download`, `id=` + view params.) What's the current behavior in 2026 — does the plain `/view` link reliably work for unauthenticated viewers when the file is "Anyone with the link"? Any gotchas (viruses-scan warnings on downloads, view limit banners)?
2. **Preview vs download:** Best practice for showing an embedded preview for PDFs (i.e. the `https://drive.google.com/file/d/<ID>/preview` iframe form) — reliability, limitations. Should we embed iframes, or is a well-labeled external link better UX/security-wise? What about images/zips?
3. **Security for user-supplied external URLs:** opening arbitrary user-supplied URLs (`window.open` / `target=_blank`): the security baseline (rel=noopener+noreferrer), URL validation (must be http/https), and whether validating hostname to a specific domain (e.g. drive.google.com) is a reasonable, robust rule — or brittle. Any SSRF concern server-side when we only STORE the URL and never fetch it (clarify: server storing, never fetching = no SSRF surface)?
4. **Google Drive file ID extraction:** reliable regex pattern for extracting the file ID from a Google Drive link, if we want to offer preview. Is that fragile (shortlinks goo.gl/drive links etc.)?

## Deliverable
Write your findings to `docs/research/drive-links.md` (create dir). Format: concise, per-question answers, with a short "Recommendation" section at the top giving the simplest robust approach (remember the project rule: prefer simple + zero new dependencies; opening a well-labeled link in a new tab is the lazy baseline). Cite sources inline (URLs). Keep it under ~2 pages.

## Report
Write full report to: C:\Users\91983\Desktop\VibeCoded\forms\.superpowers\sdd\resources-and-student-portal\task-C-report.md
Return: DONE + research doc path + 3-line summary of the recommendation.