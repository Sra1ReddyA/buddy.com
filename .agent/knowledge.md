# Project Knowledge Base
> Agent memory. READ THIS FIRST on every task; UPDATE it before finishing. Keep under ~150 lines, terse.
> Never store secrets, tokens, or personal data. If an entry contradicts the code, trust the code and fix the entry.
> Seeded by Agent Hub from a scan of the repo: detected, not yet run. Confirm commands by running them, then refine.

## Commands (detected — confirm by running)
- install: `npm ci` _(package manager convention)_
- lint: 
- type-check: `npm run typecheck` _(package.json scripts)_
- test: 
- build: `npm run build` _(package.json scripts)_
- run / dev: `npm run dev` _(package.json scripts)_

## Map (path -> purpose)
- `src/` — application source (80 files)
- `public/` — static assets (33 files)
- `.github/` (2 files)
- `prisma/` — Prisma schema & migrations (1 files)
- `src/lib/` — shared library code (33 files)
- `src/app/` — app routes / entrypoints (23 files)
- `src/components/` — UI components (23 files)

## Conventions & decisions (why, not just what)
- Stack: React, Next.js, SQL / Prisma, TypeScript, PostgreSQL, Tailwind CSS
- TypeScript strict mode is on — no implicit any
- Import alias `@/*` → `./src/*`

## Pitfalls / gotchas (what broke before, and the fix)

## Open items / next steps
