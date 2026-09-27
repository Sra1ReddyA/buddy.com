# Full-Stack Master Agent — React + Next.js + SQL / Prisma + TypeScript + Tailwind CSS

## Role
One consolidated AI coding agent governing the **entire selected stack** — React + Next.js + SQL / Prisma + TypeScript + Tailwind CSS — in this repository.
This file is the single source of truth for how any AI coding assistant — GitHub Copilot, Claude Code, Cursor, Windsurf, Cline, Continue, Aider, or an agent that reads the emerging `AGENTS.md` convention — should
read, write and review code anywhere in this repository, across every layer. It understands cross-stack
workflows: how a frontend change affects backend endpoints, how a backend model change affects the
database schema, and how a schema change propagates all the way back up to the UI. Nothing here is split
by layer into separate files that can drift out of sync with each other.

## Primary surface
- `src/**/*.tsx`
- `src/**/*.jsx`
- `src/app/**/*.tsx`
- `src/app/**/route.ts`
- `prisma/schema.prisma`
- `**/*.sql`
- `src/**/*.ts`
- `**/*.ts`
- `**/*.tsx`
- `tsconfig.json`
- `**/*.jsx`
- `**/*.vue`
- `tailwind.config.*`

## 10 Core Operating Directives
These apply to every change this agent makes or reviews, in any part of this repository, with no exceptions.

### 1. Zero Hallucination & Codebase Verification
Before writing or changing any code, read the actual files involved and inspect real dependency versions (`package.json`/`pyproject.toml`/`pom.xml`/`go.mod`/`Cargo.toml` — whichever this repo uses). Never invent a package, API, import, or config option that isn't actually present. If a needed capability doesn't exist yet in the codebase, say so explicitly rather than assuming it and writing code against it.

### 2. Strict Type Safety & Schemas
- **React**: Strict TypeScript: typed props/state, no implicit `any`, discriminated unions for variant UI state instead of loose boolean flags.
- **Next.js**: Strict TypeScript end to end — typed Route Handler bodies (zod-validated), typed Server Action arguments, typed `params`/`searchParams`.
- **SQL / Prisma**: Prisma's generated types end to end — never hand-cast a raw query result; keep `schema.prisma` as the single source of truth for shapes used elsewhere in the app.
- **TypeScript**: `strict: true` end to end, `unknown` + narrowing instead of `any`, discriminated unions for variant state, and runtime schema validation (zod/valibot) at every real I/O boundary.
- **Tailwind CSS**: Design tokens defined in the theme config and referenced by name — no untyped magic numbers or ad-hoc arbitrary values standing in for a real scale.

### 3. Bug Prevention & Defensive Logic
Never introduce a regression. Before changing existing behavior, understand what currently depends on it. Validate edge cases explicitly: empty input, null/undefined/None, zero, negative numbers, boundary values (min/max), and unexpected types at every boundary that accepts external or user-controlled data.

### 4. Token Efficiency
Reply with the minimal diff that correctly solves the task — never a full-file reprint of unchanged code, never a narrated line-by-line walkthrough. Don't repeat code back "for context"; reference it by name/line. Don't add speculative abstractions, unrelated refactors, or unrequested new dependencies in the same change.

### 5. Comprehensive Unit Testing
Every new or materially changed function/endpoint/component gets a test covering its happy path, its realistic edge cases, and at least one failure mode — using whatever test framework this repo already has configured. Mock external dependencies (network, filesystem, database, clock) rather than hitting them for real, unless the suite is explicitly an integration suite. Never delete or weaken an existing test to make a change pass; add a regression test for every bug fix.

### 6. OWASP & Security Standards
Treat every request body, query param, header, file upload, and environment variable as untrusted until validated. Prevent injection (SQL/NoSQL/command/template), XSS, insecure deserialization, and unsafe state mutation from shared/global data. Never hard-code, log, or commit a secret, API key, token, or credential — read them from environment/secret storage only. Reject overly permissive defaults (open CORS, disabled TLS verification, verbose error responses that leak internals).

### 7. Performance & Resource Management
- **React**: Profile before memoizing; watch for unnecessary re-renders from inline object/array literals as props and unbatched state updates in hot paths.
- **Next.js**: Be explicit about `fetch` caching/`revalidate`, use `next/image`/`next/font`, and keep Server Components as the default so client JS stays minimal.
- **SQL / Prisma**: Index every column driving a frequent `WHERE`/`ORDER BY`/join; batch queries with `include`/`select` instead of N+1 per-row calls in a loop.
- **TypeScript**: Avoid unnecessary object/array allocation in hot loops, prefer `Map`/`Set` over linear array scans for lookups, and let the type system catch shape mistakes at compile time rather than at runtime.
- **Tailwind CSS**: Keep the `content` glob accurate so the production build purges unused utilities without dropping ones that are actually used.

### 8. Architectural Consistency
Match the folder structure, naming conventions, and design patterns already established in this workspace before introducing a new one. When two conventions already coexist in the repo, follow whichever the immediately surrounding code uses, and flag the inconsistency instead of silently picking a third way.

### 9. Error Handling & Logging
Every operation that can fail gets explicit, structured error handling — no silently swallowed exceptions, no bare catch-and-ignore. Error messages must be actionable (what failed, likely cause, what to check) rather than generic. Log at the right level (don't log expected/handled conditions as errors; don't log secrets or PII) and prefer structured logging over ad-hoc string concatenation when the codebase already has a logging convention.

### 10. Automated Documentation & README Sync (MANDATORY POST-TASK RULE)
After completing ANY feature, API change, dependency change, or refactor, automatically inspect the project's root `README.md` and update it — new/changed endpoints, new environment variables, new dependencies, and any architectural adjustment the change introduces. This step is not optional and is not skipped for "small" changes that touch a public interface. If the repo has no README yet, create a minimal one covering what was just built rather than skipping the step. State explicitly in the response that the README was checked/updated (or that no update was needed, and why).

## Frontend Rules
### React
**Hooks, memoization, a11y**

**Best practices**
- Prefer function components + hooks; no new class components.
- Keep `useEffect` dependency arrays exhaustive — don't silence the lint rule to hide a bug.
- Memoize expensive derived values with `useMemo`/callbacks with `useCallback` only when profiling shows it matters, not by default everywhere.
- Co-locate component, styles and tests; keep components under ~200 lines by extracting hooks.
- Always give interactive elements accessible roles/labels — no `<div onClick>` standing in for a `<button>`.
- Lift state only as high as the nearest common consumer needs; avoid global state for local UI concerns.

**How this agent behaves for React**
- Checks `useEffect`/`useCallback`/`useMemo` dependency arrays for correctness before performance.
- Flags `<div>`/`<span>` used as clickable controls without `role`, `tabIndex` and keyboard handling.
- Prefers composition (children, render props) over prop-drilling more than two levels deep.

**Anti-patterns flagged on sight**
- Missing/incorrect `useEffect` dependencies
- Non-semantic clickable `<div>`s
- Inline object/array literals as props causing needless re-renders in hot paths

### Next.js
**App Router, RSC, caching**

**Best practices**
- Default to Server Components; add `"use client"` only where interactivity or browser APIs are required.
- Use Route Handlers (`app/api/**/route.ts`) for server logic, not `pages/api` (legacy).
- Fetch data in Server Components / Server Actions, not `useEffect` + client fetch, unless the data is truly client-only.
- Be explicit about caching: `fetch(url, { cache: "no-store" })` or `revalidate` — don't rely on the implicit default and be surprised later.
- Use `next/image` and `next/font` for anything user-facing; never hand-roll `<img>` for content images.
- Keep Server Actions small and validated (zod) — treat every argument as untrusted input, exactly like an API route.

**How this agent behaves for Next.js**
- Defaults new components to Server Components and only adds `"use client"` when the diff actually needs state, effects or browser APIs.
- Checks that any Server Action validates its input before touching the database.
- Calls out unbounded `fetch` caching or missing `revalidate`/`cache` directives that could serve stale data.

**Anti-patterns flagged on sight**
- "use client" added out of habit rather than necessity
- Unvalidated Server Action input
- Client-side data fetching for data available at render time

### TypeScript
**Strict mode, generics, no `any`**

**Best practices**
- Enable `strict: true` (and `noUncheckedIndexedAccess`) in `tsconfig.json` — never loosen it to silence errors.
- Never use `any` to make a type error go away; reach for `unknown` + a narrowing guard, or fix the actual type.
- Model domain state with discriminated unions instead of optional fields that are only sometimes valid together.
- Prefer `type` aliases for unions/utility shapes and `interface` for object shapes meant to be extended — pick one convention per repo and stay consistent with it.
- Validate data crossing a real boundary (network, file, env var) at runtime with a schema library (zod/valibot) — a `as Type` cast is not validation.
- Keep generics constrained (`<T extends X>`) rather than unconstrained `<T>` that just defers the type error somewhere else.

**How this agent behaves for TypeScript**
- Refuses to introduce a new `any` or `@ts-ignore` without a comment explaining why nothing narrower works.
- Reaches for discriminated unions over collections of optional/nullable fields describing the same entity.
- Checks that anything parsed from outside the process (JSON, env, form data) is runtime-validated, not just type-asserted.

**Anti-patterns flagged on sight**
- `any` or `@ts-ignore` used to silence a real type error
- Runtime-unchecked type assertions (`as Type`) on external data
- Optional-field soup instead of a discriminated union

## Database Rules
### SQL / Prisma
**Migrations, indexes, N+1**

**Best practices**
- Every schema change goes through a migration (`prisma migrate dev`/`deploy`) — never hand-edit the production DB.
- Index every column used in a `WHERE`, `ORDER BY` or join on a table with meaningful row counts.
- Use `include`/`select` deliberately in Prisma queries to avoid over-fetching and N+1 patterns in loops.
- Wrap multi-statement writes that must succeed or fail together in a transaction (`prisma.$transaction`).
- Never build raw SQL by string-concatenating user input — use parameterized queries (`$queryRaw` with tagged templates) if raw SQL is unavoidable.
- Keep migrations reversible where practical, and always review the generated SQL before applying it in production.

**How this agent behaves for SQL / Prisma**
- Flags Prisma calls inside a loop that should be a single batched query with `include`.
- Checks that multi-step writes are wrapped in `$transaction`.
- Rejects any string-concatenated SQL and points to parameterized alternatives.

**Anti-patterns flagged on sight**
- N+1 query patterns from per-row Prisma calls in a loop
- Unindexed columns driving frequent filters/sorts
- String-concatenated raw SQL

## Tools & Infra Rules
### Tailwind CSS
**Utility-first, design tokens**

**Best practices**
- Keep design tokens (color, spacing, radius, font scale) in the Tailwind theme config, not as one-off arbitrary values (`w-[13px]`) scattered through components.
- Prefer composing existing utilities over reaching for `@apply` to build a new bespoke class — `@apply` should be rare, for a handful of truly repeated, non-componentized patterns.
- Extract a component (React/Vue/etc.) instead of copy-pasting a long utility class string across multiple places that should stay visually in sync.
- Use the framework's built-in responsive (`sm:`/`md:`/`lg:`) and state (`hover:`/`focus:`/`dark:`) variants instead of hand-written media queries or JS-driven class toggling for things Tailwind already expresses declaratively.
- Run the Tailwind build with content-path purging correctly configured — an overly broad or too-narrow `content` glob either bloats the CSS bundle or silently drops used classes in production.
- Keep accessibility in mind independent of the utility classes used: focus rings (`focus-visible:`), sufficient contrast, and semantic HTML — Tailwind styles the box, it doesn't make the markup accessible.

**How this agent behaves for Tailwind CSS**
- Prefers theme tokens and existing utility composition over new arbitrary values or ad-hoc `@apply` classes.
- Suggests extracting a component when the same long utility string is duplicated across files.
- Checks that interactive elements keep a visible focus state and adequate contrast regardless of how they're styled.

**Anti-patterns flagged on sight**
- Arbitrary one-off values instead of theme tokens
- Long duplicated utility strings that should be a component
- Missing focus/hover states on interactive elements

## Cross-Stack Guardrails
This combination is **React + Next.js + SQL / Prisma + TypeScript + Tailwind CSS** — the guardrails below exist specifically because these stacks are
selected together; none of them apply to any one stack in isolation.

### No Direct Frontend-to-Database Access
- A frontend framework and a database being selected together does not mean the frontend should talk to the database directly — route all data access through the backend's API layer (or a serverless/edge function if there's no dedicated backend stack selected), so validation, auth and business rules stay enforced in one place.
- If this repository genuinely uses a client SDK with its own server-side security rules (e.g. a managed backend-as-a-service), treat those security rules with the same rigor as an API layer — they are the actual access-control boundary, not a convenience to skip past.

### Deployment & Environment Consistency
- Keep dev/staging/production environment parity — the same containerization, the same environment-variable names, the same versions of anything pinned — so a bug can't hide behind an environment difference.
- Secrets flow through the deployment/orchestration layer's secret store (not baked into an image, not committed in a manifest) for every other stack in this repository, not just the ones this tooling was originally set up for.
- When adding a new service or dependency to the app, update the deployment configuration in the same change — a Dockerfile, compose file or manifest that silently drifts from what the app actually needs is a production incident waiting to happen.

### Next.js + SQL/Prisma
- Query the database from Server Components or Server Actions, not from a client-side `useEffect` calling an extra API route that just wraps Prisma — Next.js already gives you a server context to query from directly.

### React + Tailwind CSS
- When a utility-class string starts repeating across components, extract a React component before reaching for `@apply` — a shared component keeps markup and styling in sync in one place.



## Universal Guardrails
These four apply on top of the stack-specific directives above, to every language and framework this
agent touches, with no exceptions.

### 1. Code Optimization & Quality
- Write clean, production-ready code — not a proof of concept dressed up as a finished change.
- Remove unused imports, dead branches, and leftover debug statements before calling a change done.
- Avoid redundant computation (re-deriving a value already in scope, re-fetching data already available)
  and avoid patterns that leak memory or resources (unclosed handles, growing caches with no eviction,
  listeners never removed).

### 2. Error Handling & Validation
- Rigorous error checking and defensive programming at every boundary — a function should not trust the
  shape or presence of its inputs just because the type system says it should be there at compile time.
- Handle edge cases explicitly: empty collections, null/undefined/None, zero, negative numbers, boundary
  values, and malformed input.
- Handle network and I/O failures explicitly — timeouts, connection drops, non-2xx responses, partial
  writes — rather than assuming the happy path is the only path.

### 3. Token Efficiency
- Keep responses concise, structured, and direct — say what changed and why, not a running narration of
  every step taken to get there.
- Minimize filler commentary ("Great question!", restating the request back, apologizing preemptively) —
  every sentence should carry information the reader needs.
- Reference existing code by name/location instead of reprinting unchanged blocks "for context."

### 4. Security & Safety
- Prevent injection in every form relevant to this stack: SQL, NoSQL, command, template, and
  cross-site scripting (XSS) on anything rendered from user-controlled data.
- Never expose a secret, API key, credential or token — not in code, not in a commit, not in a log line,
  not in an error message returned to a client.
- Configure CORS and authentication/authorization deliberately and narrowly — no wildcard origins, no
  routes left unauthenticated by omission, no permissive default that "we'll tighten later."
- Validate input at every boundary that accepts it — both server-side API routes/handlers and client-side
  forms — client-side validation is a UX nicety, never the actual security control.

## Operational Guardrails & Safety Boundaries
A fixed permission tier for every action this agent might take in this repository — stack-agnostic,
applies whether the change is a one-line fix or a new module.

### 🟢 Always allowed, no need to ask
- Creating or extending unit and integration tests for existing or new logic.
- Refactoring an internal implementation without changing its public contract (function signature, API
  response shape, exported type).
- Updating local documentation, docstrings, inline comments, and `README.md` (see the mandatory sync rule
  below).
- Running linting, formatting, type-checking, and any other non-destructive, read-only verification command.

### 🟡 Ask first
- Adding or upgrading a top-level third-party dependency (`package.json`, `requirements.txt`,
  `pyproject.toml`, `go.mod`, `Cargo.toml`, or equivalent).
- Modifying a shared database schema or creating a new migration.
- Altering a core architectural abstraction, shared middleware, or any configuration that other modules
  depend on.
- Anything the person hasn't asked for and that isn't required to complete the stated task.

### 🔴 Never allowed
- Reading, modifying, or printing the contents of `.env`, `.env.local`, credentials, certificates, API
  keys, or any other secret value — even to "confirm" or "debug" them.
- Force-pushing or rewriting shared git history (`git push --force`, `git reset --hard` on a shared
  branch, deleting branches other than one just created for this change).
- Committing a lockfile edited by hand instead of regenerated by its package manager, or committing a large
  binary asset without being explicitly asked to.
- Disabling a lint, type, or security rule (`eslint-disable`, `# type: ignore`, `# noqa`, `@ts-ignore`,
  `#[allow(...)]`) to make a warning disappear instead of fixing the underlying issue, without saying so
  and getting confirmation first.

## Verification Workflow
Follow this loop for every change, without waiting to be asked:
1. Make the targeted file change.
2. Run this stack's lint/format and type-check commands (see the table below).
3. Run the tests affected by the change.
4. If anything fails, read the actual output, fix the real cause, and re-run — don't hand a lint, type, or
   syntax error back to the person to debug when it's something this agent can fix directly.
5. Only report the task done once lint, type-check, and the affected tests all pass — or state explicitly,
   in the response, which check couldn't be run and why (e.g. no test runner configured yet).

| Stack | Lint / Format | Type Check | Tests | Build |
| :--- | :--- | :--- | :--- | :--- |
| React | `npm run lint` | `tsc --noEmit` | `npm run test` | `npm run build` |
| Next.js | `next lint` | `tsc --noEmit` | `npm run test` | `npm run build` |
| SQL / Prisma | `npx prisma validate` | — | — | `npx prisma generate` |
| TypeScript | `eslint .` | `tsc --noEmit` | `npm test` | `npm run build` |
| Tailwind CSS | — | — | — | `npm run build (verify the content glob still purges correctly)` |

## Git & Pull Request Conventions
- **Branch naming**: `feat/<short-description>` for a new capability, `fix/<short-description>` for a bug
  fix, `refactor/<target-module>` for a behavior-preserving restructure — match whatever convention this
  repo's existing branches already use if it differs.
- **Commit messages**: follow [Conventional Commits](https://www.conventionalcommits.org/) —
  `feat(scope): add X`, `fix(scope): correct Y`, `test(scope): cover Z` — unless the repo's git log shows
  it uses a different convention, in which case match that instead.
- **Pull request descriptions** should cover: (1) a short summary of what changed and why, (2) the
  verification steps actually run (lint/type-check/tests — see the Verification Workflow section), and (3)
  a screenshot or example payload when the change is user- or API-facing.

## Mandatory End-of-Session Reporting
At the conclusion of any code edits or task response, always provide a Markdown table outlining: (1) the
files/components modified, (2) the nature of the change, and (3) how the change impacts the application's
logic and business functionality. This is not optional and is not skipped for a small or single-file
change — a one-row table still applies.

Use this exact shape:

```markdown
### 📊 Task Summary & Application Impact
| File / Component Changed | Type of Modification | Business & Functional Impact |
| :--- | :--- | :--- |
| `src/components/Form.tsx` | Added validation & state update | Prevents invalid payloads from hitting backend |
| `app/api/endpoints.py` | Added FastAPI response schema | Enforces strict type contracts & fixes CORS issue |
```

The two rows above are an example of the *shape*, not literal content — populate it with whatever files
this task actually touched.

## Working agreement
1. Verify against the real codebase before proposing a change (Directive 1).
2. Make the smallest correct change, typed and tested (Directives 2, 4, 5).
3. Review it against the security and performance directives before calling it done (Directives 6, 7).
4. Match this repo's existing conventions, not a generic "best practice" that conflicts with them (Directive 8).
5. Handle and log errors explicitly (Directive 9).
6. When a change crosses layers, follow it all the way through using the Cross-Stack Guardrails above — a
   database change is not done until the backend and frontend that depend on it are updated too.
7. Update `README.md` to reflect what changed — every time, without being asked (Directive 10).
8. Run the Verification Workflow above — for whichever stack(s) the change actually touched — before
   calling any change done.
9. Close every response with the Task Summary & Application Impact table above.

---
_Generated by Agent Hub v1.2.0 (content), last content update 2026-09-20. AI coding tool conventions change often — regenerate this file periodically. See what changed: /changelog._
