# AGENTS.md

# Project Instructions

<!-- ## Codebase Context

This project has a Graphify-generated codebase context/graph.

Before making substantial changes:
- Consult the Graphify-generated context.
- Use it to understand relationships between modules, dependencies, APIs, and relevant files.
- Do not assume an isolated file represents the complete architecture.
- When modifying a module, check its related dependencies and consumers. -->

## Project Structure

- `client/` — frontend
- `server/` — backend
<!-- 
## Important

The Graphify files are supporting context, not source code. Do not modify or delete them unless explicitly required. -->

## Mission

Build production-ready software using a **subagent-driven workflow**.

The main agent is the **orchestrator**. Delegate implementation, testing, review, security, database, and other specialized work to subagents when appropriate.

Never skip required workflow steps to save time.

---

## 1. Git Rules

### Main Branch

`main` is always the stable branch.

**Never:**
- Implement features directly on `main`
- Commit unfinished work to `main`
- Merge untested code
- Merge code with known Critical issues
- Mix unrelated features

### Branch Per Feature

Every feature MUST have its own branch.

```text
feature/<feature-name>


Follow this flow -
1. Update main
2. Create feature branch
3. Analyze requirements
4. Plan implementation
5. Delegate to appropriate subagent
6. Implement
7. Test #1
8. Fix failures
9. Test #1 again until PASS
10. Test #2
11. Fix failures
12. Repeat BOTH tests after meaningful fixes
13. Code review
14. Resolve Critical/Important issues
15. Final verification
16. Merge into main


<!-- FRONT END FILE FROM HERE -->

<!-- # AGENT.md

## Frontend Development Guidelines

This project prioritizes:

1. **Performance**
2. **Professional and classy UI/UX**
3. **Maintainability**
4. **Accessibility**
5. **Clean architecture**
6. **Consistency**

The website must feel like a **high-quality professional product**, not a flashy demo website.

---

# 1. Core Principles

Every implementation MUST follow these principles:

### Performance First

Performance is one of the highest priorities of this project.

Do not introduce components, libraries, animations, images, effects, or dependencies that unnecessarily increase:

* Initial page load time
* JavaScript bundle size
* Rendering time
* Network requests
* Memory usage
* CPU usage
* Time to Interactive
* Largest Contentful Paint
* Cumulative Layout Shift

A visually impressive feature is NOT worth adding if it significantly harms performance.

When choosing between two implementations:

> Prefer the simpler and faster implementation unless the visual difference is significant.

---

# 2. Design Philosophy

The UI must be:

* Professional
* Minimal
* Elegant
* Clean
* Modern
* Consistent
* Easy to understand
* Appropriate for a serious production application

The UI must NOT feel:

* Flashy
* Over-designed
* Gamified
* Excessively animated
* Neon
* Gradient-heavy
* Cluttered
* Like a template/demo website

Think:

> "Premium professional software"

NOT:

> "Marketing landing page with excessive effects"

---

# 3. Visual Design Rules

## Colors

Use a restrained color palette.

Prefer:

* Neutral backgrounds
* White / off-white surfaces
* Dark text
* Muted secondary text
* One primary accent color
* Subtle borders
* Subtle status colors

Avoid excessive:

* Gradients
* Neon colors
* Multiple accent colors
* Glowing effects
* Strong shadows
* Saturated backgrounds

Every color should have a purpose.

---

## Typography

Typography should be:

* Clear
* Consistent
* Readable
* Professional

Use a limited number of font sizes and weights.

Do not randomly use:

* Huge headings
* Excessive bold text
* Too many font sizes
* Decorative fonts

Maintain a clear hierarchy:

```text
Page Title
    ↓
Section Heading
    ↓
Subheading
    ↓
Body
    ↓
Supporting / Metadata text
```

---

# 4. Spacing

Use a consistent spacing system.

Do not randomly assign margins and padding.

Prefer a small set of spacing values such as:

```text
4
8
12
16
24
32
48
64
```

Maintain consistent spacing between:

* Sections
* Cards
* Form fields
* Buttons
* Headings
* Navigation elements

Whitespace should be intentional.

---

# 5. Components

Components should be:

* Reusable
* Small
* Focused
* Predictable
* Easy to maintain

Avoid creating giant components.

If a component becomes difficult to understand, consider splitting it.

However:

> Do NOT split components unnecessarily just for the sake of abstraction.

Abstraction should solve a real problem.

---

# 6. Component Performance

Every component should be evaluated for performance.

Avoid:

* Unnecessary re-renders
* Expensive calculations during rendering
* Large lists rendered unnecessarily
* Unnecessary state
* Unnecessary effects
* Excessive context usage
* Large third-party libraries for simple functionality
* Unoptimized images
* Blocking operations

Use techniques such as:

* Lazy loading
* Code splitting
* Memoization when justified
* Virtualization for large lists
* Debouncing/throttling when appropriate
* Optimized image loading
* Server-side rendering when appropriate
* Dynamic imports when appropriate

Do NOT blindly add optimization techniques.

Optimization should solve an actual performance problem.

---

# 7. Animations

Animations must be subtle and purposeful.

Use animation only when it improves:

* Feedback
* Navigation
* Understanding
* Perceived responsiveness

Prefer:

* Short transitions
* Opacity changes
* Small transforms
* Subtle hover states

Avoid:

* Excessive motion
* Large page transitions
* Constant movement
* Parallax everywhere
* Spinning elements
* Bouncing elements
* Excessive scroll animations
* Decorative animations

The default should be:

> Minimal motion.

---

# 8. Shadows, Borders and Effects

Use visual effects sparingly.

Cards should generally use:

* Subtle borders
* Very light shadows
* Clear spacing

Avoid:

```text
Heavy shadows
Glow effects
Glassmorphism everywhere
Multiple nested shadows
Extreme blur
```

The interface should remain visually clean.

---

# 9. Responsive Design

Every page must work properly on:

* Desktop
* Laptop
* Tablet
* Mobile

Do not design desktop first and simply shrink everything.

Consider:

* Navigation
* Tables
* Forms
* Cards
* Modals
* Sidebars
* Buttons
* Typography
* Spacing

on smaller screens.

---

# 10. Accessibility

Accessibility is mandatory.

Use:

* Semantic HTML
* Proper labels
* Keyboard navigation
* Accessible buttons
* Accessible forms
* Proper focus states
* Sufficient contrast
* Meaningful alt text
* ARIA only when necessary

Do not sacrifice accessibility for aesthetics.

---

# 11. UX Principles

The user should always understand:

* Where they are
* What they can do
* What happened
* What is currently loading
* What went wrong
* What they should do next

Use:

* Clear labels
* Predictable navigation
* Helpful empty states
* Useful error messages
* Loading states
* Confirmation where necessary

Avoid unnecessary popups and interruptions.

---

# 12. Dependencies

Before adding a dependency, ask:

1. Do we actually need it?
2. Can this functionality be implemented simply without it?
3. How large is the dependency?
4. Does it negatively affect bundle size?
5. Is it actively maintained?
6. Does it introduce unnecessary complexity?

Do not install a library for functionality that can be implemented in a few clean lines.

---

# 13. Images and Assets

Images must be optimized.

Prefer:

* WebP
* AVIF
* Responsive images
* Lazy loading
* Appropriate dimensions

Never load a huge image when a smaller image is sufficient.

Avoid unnecessary background images.

---

# 14. Data Fetching

Avoid unnecessary API calls.

Prefer:

* Request deduplication
* Caching
* Pagination
* Lazy loading
* Fetching only required data

Do not repeatedly fetch the same data without a reason.

For large datasets:

> Never load everything if only a small portion is required.

---

# 15. Loading States

Every asynchronous operation that can noticeably take time should have an appropriate loading state.

Prefer simple:

* Skeletons
* Spinners where appropriate
* Disabled states
* Progressive loading

Do not create elaborate loading animations.

---

# 16. Error Handling

Errors should be:

* Clear
* Useful
* Human-readable
* Actionable

Avoid exposing technical errors directly to users.

Bad:

```text
TypeError: Cannot read properties of undefined
```

Better:

```text
Unable to load your profile.
Please try again.
```

---

# 17. Agent Architecture

## IMPORTANT

Every significant frontend task MUST be divided among multiple specialized sub-agents.

Do NOT solve large frontend tasks using a single agent.

The main agent is responsible for:

1. Understanding the requirement
2. Breaking the task into subtasks
3. Assigning subtasks to specialized agents
4. Reviewing their results
5. Integrating the implementation
6. Running final checks

---

# 18. Required Sub-Agents

For significant UI/frontend work, ALWAYS use the following specialized agents.

## Agent 1 — UI Implementation Agent

Responsible for:

* Building components
* Implementing layouts
* Writing frontend code
* Connecting existing design system components
* Implementing responsive behavior

Focus:

> Correct implementation.

---

## Agent 2 — Aesthetic / UX Reviewer

This agent is MANDATORY.

It reviews the implementation specifically from a visual and UX perspective.

Check:

* Is the UI professional?
* Is it classy?
* Is the spacing consistent?
* Is the typography appropriate?
* Is the visual hierarchy clear?
* Is the interface cluttered?
* Are colors restrained?
* Are there unnecessary gradients?
* Are there unnecessary animations?
* Are cards/components over-designed?
* Does the UI look like a production application?
* Is the design consistent with the rest of the application?
* Does anything feel flashy or amateur?

The aesthetic reviewer MUST NOT judge only whether the code works.

It must judge:

> How the product feels visually.

If the reviewer finds unnecessary visual complexity, simplify it.

---

## Agent 3 — Performance / Latency Reviewer

This agent is MANDATORY.

It reviews the implementation specifically for performance.

Check:

* Bundle size
* Component rendering
* Re-renders
* API requests
* Network requests
* Image sizes
* Lazy loading
* Code splitting
* JavaScript execution
* Memory usage
* Large lists
* Expensive calculations
* Unnecessary dependencies
* Blocking operations
* Loading performance
* Layout shifts
* Animation performance

The performance reviewer must ask:

> "Can this be made faster without reducing functionality?"

Performance issues should be fixed before considering the task complete.

---

## Agent 4 — Code Quality Reviewer

For significant tasks, use a code-quality reviewer.

Review:

* Architecture
* Maintainability
* Duplication
* Naming
* Component structure
* Type safety
* Error handling
* Reusability
* Separation of concerns

Avoid unnecessary abstraction.

---

## Agent 5 — Accessibility Reviewer

For pages containing forms, navigation, interactive components, or important user flows, use an accessibility reviewer.

Check:

* Keyboard navigation
* Focus management
* Semantic HTML
* Labels
* Contrast
* Screen reader usability
* ARIA usage
* Interactive element accessibility

---

# 19. Required Agent Workflow

For significant frontend tasks, follow this workflow:

```text
                    MAIN AGENT
                        |
             Understand Requirement
                        |
                Break Into Tasks
                        |
        +---------------+---------------+
        |               |               |
        ↓               ↓               ↓
   UI Agent       Aesthetic Agent   Performance Agent
        |               |               |
        +---------------+---------------+
                        |
                 Code Review Agent
                        |
                Accessibility Agent
                        |
                        ↓
                 MAIN AGENT REVIEW
                        |
                        ↓
                  Final Testing
                        |
                        ↓
                     DONE
```

---

# 20. Parallelization

Independent tasks SHOULD be performed in parallel.

For example:

```text
UI Agent
    +
Aesthetic Reviewer
    +
Performance Reviewer
```

can work independently where possible.

Do not unnecessarily make agents wait for each other.

---

# 21. Review Loop

The task is NOT complete simply because the UI works.

After implementation:

### Step 1

UI agent implements the feature.

### Step 2

Aesthetic reviewer evaluates the UI.

### Step 3

Performance reviewer evaluates performance.

### Step 4

Code-quality reviewer evaluates implementation.

### Step 5

Fix identified issues.

### Step 6

Run the reviewers again if significant changes were made.

### Step 7

Main agent performs final verification.

---

# 22. Aesthetic Review Rules

The aesthetic reviewer should actively look for things that make the UI feel cheap or overly designed.

Examples:

### Remove unnecessary:

* Gradients
* Glows
* Huge rounded corners
* Excessive shadows
* Excessive animations
* Decorative icons
* Floating elements
* Excessive badges
* Too many colors
* Unnecessary illustrations

### Prefer:

* Strong typography
* Good spacing
* Clear hierarchy
* Consistent alignment
* Restrained colors
* Subtle borders
* Consistent components
* Useful whitespace

Remember:

> Good design does not mean adding more visual effects.

---

# 23. Performance Review Rules

The performance reviewer has authority to reject an implementation if it unnecessarily harms performance.

Pay particular attention to:

### React / Frontend

* Unnecessary state
* Unnecessary useEffect
* Unnecessary context updates
* Large component trees
* Expensive renders
* Unnecessary re-renders
* Poor list rendering

### Network

* Excessive API requests
* Duplicate requests
* Large payloads
* Missing pagination
* Missing caching

### Assets

* Large images
* Unoptimized fonts
* Unnecessary icons
* Large JavaScript bundles

### UI

* Expensive animations
* Layout thrashing
* Rendering thousands of elements
* Excessive DOM nodes

---

# 24. Performance Budget Mindset

Before adding a feature, consider:

```text
Feature value
     vs
Performance cost
```

If the performance cost is significant and the feature provides little user value:

> Do not add it.

---

# 25. No Premature Complexity

Do not introduce:

* Complex state management
* Heavy animation frameworks
* Large UI libraries
* Complex abstractions
* Unnecessary design systems
* Multiple dependencies

unless there is a real requirement.

Simple solutions are preferred.

---

# 26. Existing Project Consistency

Before creating a new component:

1. Inspect existing components.
2. Reuse existing components where appropriate.
3. Follow existing naming conventions.
4. Follow existing spacing.
5. Follow existing typography.
6. Follow existing colors.
7. Follow existing architecture.

Do not create a second version of something that already exists.

---

# 27. Before Coding

The main agent should first inspect:

* Existing project structure
* Existing components
* Existing styles
* Existing design system
* Existing dependencies
* Existing routing
* Existing state management
* Existing API/data-fetching patterns

Do not blindly introduce a new architecture.

---

# 28. Definition of Done

A frontend feature is complete only when:

### Functionality

* [ ] Feature works correctly
* [ ] Edge cases handled
* [ ] Errors handled
* [ ] Loading states implemented

### Design

* [ ] Professional
* [ ] Classy
* [ ] Minimal
* [ ] Consistent
* [ ] Not flashy
* [ ] Responsive
* [ ] Good visual hierarchy

### Performance

* [ ] No unnecessary dependencies
* [ ] No unnecessary API requests
* [ ] No obvious rendering problems
* [ ] Images optimized
* [ ] Large lists handled properly
* [ ] No unnecessary expensive operations
* [ ] Loading performance considered

### Code Quality

* [ ] Components are maintainable
* [ ] Naming is clear
* [ ] No unnecessary duplication
* [ ] Type safety maintained
* [ ] Existing architecture respected

### Accessibility

* [ ] Keyboard accessible
* [ ] Semantic HTML
* [ ] Labels provided
* [ ] Focus states work
* [ ] Contrast is sufficient

### Review

* [ ] Aesthetic reviewer approved
* [ ] Performance reviewer approved
* [ ] Code-quality reviewer approved
* [ ] Accessibility reviewer approved where applicable

---

# 29. Golden Rule

When making frontend decisions, follow this priority:

```text
Performance
     ↓
Usability
     ↓
Clarity
     ↓
Accessibility
     ↓
Maintainability
     ↓
Aesthetics
     ↓
Visual Effects
```

Never sacrifice performance for unnecessary visual effects.

Never sacrifice usability for aesthetics.

Never add something merely because it looks impressive.

The final product should feel:

> **Fast. Clean. Professional. Classy. Reliable.**

Not:

> **Flashy. Heavy. Over-animated. Over-designed.** -->
