# Repository Instructions

This repository uses **React + Next.js + SQL / Prisma + TypeScript + Tailwind CSS** (combined multi-stack agent). These instructions apply to every AI coding
assistant working in this repo, including GitHub Copilot Chat, Copilot code review and the Copilot coding
agent.

## Read first
`.github/agents/fullstack-agent.md` — the consolidated React + Next.js + SQL / Prisma + TypeScript + Tailwind CSS Master Agent. It is the single source of truth for how
this repo's React + Next.js + SQL / Prisma + TypeScript + Tailwind CSS code should be written and reviewed: token/context discipline, comprehensive
test generation, OWASP-aligned security review, and React + Next.js + SQL / Prisma + TypeScript + Tailwind CSS idioms are all enforced together by
that one file's 10 Core Operating Directives — there is no separate instructions/agents split to keep in
sync.

## House rules
- Prefer the smallest correct diff over a broad rewrite.
- Match existing conventions in the file being edited before introducing a new one.
- Never invent an API, package, or file that doesn't exist in this repo — check first.
- After any feature, API change, or refactor, update `README.md` to reflect it (see Directive 10 in
  `.github/agents/fullstack-agent.md`) — this is mandatory, not optional.
- If a request is ambiguous and there's a reasonable default, take it and say so; don't block on a
  clarifying question when the codebase already answers it.
