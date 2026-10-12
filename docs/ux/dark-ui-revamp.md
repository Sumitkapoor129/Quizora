# Quizora dark interface redesign

## Design research

- [Linear: How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui): clear navigation hierarchy, cohesive application chrome, subtle surface separation, and carefully balanced density.
- [Raycast](https://www.raycast.com/): expressive dark presentation and focused product storytelling. Adapt the visual confidence to an education workspace rather than reproducing the marketing page.
- [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md): keyboard access, readable contrast, reduced motion, native dark controls, responsive layouts, and compositor-friendly animation.

## Implementation direction

Charcoal backgrounds, raised neutral panels, restrained violet accents, a consistent Quizora identity, and clear navigation icons. A custom vector orbital illustration gives sign-in and dashboard surfaces a recognizable visual identity without external media downloads or animation dependencies. Decorative entrance motion must finish promptly and respect reduced-motion preferences.

Keep existing role-based routes, Google sign-in, query keys, real data, and loading/error/empty states. Restyle shared components so forms, tables, test cards, builder, analytics, resources, and the exam interface use the same dark palette.

## Agent responsibilities

- Frontend implementation: theme, shared styles, application shell, sign-in, and reusable graphics.
- Dashboard implementation: student and administrator dashboard presentation.
- Performance review: dependency and request budget, animation behavior, bundle impact, and validation.
- Independent review: aesthetics, accessibility, and code quality after implementation.

## Workspace constraints

The redesign uses `feature/dark-ui-revamp`. The workspace started with existing changes throughout the client and server; preserve those changes and avoid including unrelated work in a commit or merge.

## Verification

- Frontend regression suite: 123 tests across 19 files passed.
- Production build: TypeScript and Vite passed; no runtime dependency added for the redesign.
- Independent aesthetic, accessibility, performance, and code-quality reviews approved after mobile drawer fixes.
- Browser checks: desktop and mobile sign-in, student and administrator dashboards, mobile navigation dismissal and keyboard focus isolation. Authenticated visual checks used browser-only fixtures; production authentication was not bypassed or modified.
- Motion is finite, ending within 4.2 seconds, and disabled for reduced-motion preferences.
- Existing unrelated workspace edits remain uncommitted; no merge into `main` was attempted.
