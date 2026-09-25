# Buddy

A suite of productivity tools. **Resume Buddy**, **Law Buddy**, **PDF to Word** and **Word to PDF** are live; Gym Buddy is scaffolded as a "coming soon" tool (modal on the dashboard + indexable SEO landing page).

**Stack:** Next.js 16 (App Router, React 19, TypeScript) · Tailwind CSS 4 · Prisma 6 (SQLite locally, Postgres/MySQL in production) · a free-tier LLM (Google Gemini, OpenRouter or Groq — see below) · `docx` for Word export · `jsPDF` for PDF export · `unpdf` + `mammoth` to parse uploads · `jose` for the admin session.

## Run it locally (Windows / macOS / Linux)

```bash
npm install                 # also runs `prisma generate`
copy .env.example .env      # macOS/Linux: cp .env.example .env  — then edit the values
npx prisma db push          # creates prisma/dev.db with all tables
npm run dev                 # http://localhost:3000
```

- Admin dashboard: http://localhost:3000/admin (log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`).
- Without an LLM key set, Resume Buddy still works using the rule-based optimizer (the "-ed" rule is enforced; custom rules need the LLM). Add a key to enable full AI optimization and AI-powered upload parsing.
- `npx prisma studio` opens a GUI on the database.

### LLM provider (100% free tier, zero operating cost)

Both Resume Buddy and Law Buddy call one shared client (`src/lib/llm/client.ts`) that talks to whichever provider(s) you configure — no paid API is required. You can set just one of these in `.env`, or several:

| Provider | Env vars | Free tier | Get a key |
|---|---|---|---|
| Google Gemini *(recommended)* | `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.8-flash`) | Generous free daily quota | https://aistudio.google.com/apikey |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (default `nex-agi/nex-n2.5-mini:free`) | Free `:free`-suffixed models | https://openrouter.ai/keys |
| Groq | `GROQ_API_KEY`, `GROQ_MODEL` (default `openai/gpt-oss-20b`) | Free tier, very fast inference, usually the least congested of the three | https://console.groq.com/keys |

Leave all of them unset and both tools keep working, using their rule-based engines instead of an LLM. All three providers support forced structured "tool calling," which both engines rely on (Resume Buddy's `emit_resume`, Law Buddy's `emit_search_plan` / `emit_case_analyses`) — the same repair-turn logic (asking the model to fix a bad response) works unchanged across all three.

**Reliability on free tiers:** a free model occasionally returns a `503 "high demand"`/`429` error or a malformed response — that's the provider, not this app; it happens rarely on a paid API but is a normal, expected part of using a free one, especially at peak times. The client already retries each of those automatically (`withRetry`), and if you've set keys for **more than one** provider, a request that still fails after retrying automatically moves on to the next configured provider (`FailoverClient`) before giving up — so with two or three keys set, a request only falls back to the rule-based engine if every configured provider is down. With a single key configured there's nothing to fail over to, so a sustained outage on that one provider still falls back to rules. **We recommend setting at least two providers' keys** (Gemini + Groq is a good pair) for that reason. A `404 model_not_found`-style error fails over to the next provider immediately (no point retrying an unknown model), which is also how you'll notice a default model name below has gone stale.

**A note on the `*_MODEL` defaults:** free-tier model catalogs — especially OpenRouter's `:free`-suffixed models — are retired and renamed far more often than paid ones (this happened twice while building this feature: `gemini-2.0-flash` and `meta-llama/llama-3.3-70b-instruct:free` both stopped working within the same week). Treat the defaults in `.env.example` as a snapshot, not a guarantee. If a request logs a `model_not_found`/404 for a provider you've configured, that provider's free model has moved on — check its current list and update the matching `*_MODEL` env var:
- Gemini: https://ai.google.dev/gemini-api/docs/models
- OpenRouter (filtered to $0): https://openrouter.ai/models?max_price=0
- Groq: https://console.groq.com/docs/models

### Opening it on your phone or another computer (same Wi-Fi)

`npm run dev` prints a **Network** URL such as `http://192.168.1.23:3000`. To use it from another device:
1. Both devices must be on the same Wi-Fi (not a guest network, and no VPN on either device).
2. Windows Firewall must allow Node.js. The first time you run `npm run dev`, Windows asks — tick **Private networks** and click **Allow**. If you clicked Cancel earlier: *Windows Security → Firewall & network protection → Allow an app through firewall → Change settings →* tick **Private** for every "Node.js JavaScript Runtime" entry. Also make sure your Wi-Fi is set to **Private** (*Settings → Network & internet → Wi-Fi → your network → Private network*).
3. `next.config.ts` already allows private network addresses (`allowedDevOrigins`), which Next.js 16 needs — without it the page loads on the phone but buttons and uploads don't work.

## Deploying (e.g. Vercel + Postgres)

1. In `prisma/schema.prisma` change `provider = "sqlite"` to `provider = "postgresql"`.
2. Set env vars: `DATABASE_URL`, one LLM provider's keys (e.g. `GEMINI_API_KEY`), `COURTLISTENER_API_TOKEN`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_JWT_SECRET` (32+ random chars), `NEXT_PUBLIC_SITE_URL` (your real domain — used for canonical URLs, sitemap and JSON-LD).
3. Run `npx prisma db push` (or `prisma migrate deploy`) against the production DB.
4. Submit `https://your-domain/sitemap.xml` in Google Search Console.

The rate limiter in `src/lib/rate-limit.ts` is in-memory; swap it for Redis/Upstash if you run more than one instance.

## Project structure

```
prisma/schema.prisma            Visitor, Visit, ToolUsageEvent, Review
src/proxy.ts                    visitor-id cookie + /admin protection (Next 16 "proxy" = middleware)
src/app/
  layout.tsx                    global metadata, Organization/WebSite JSON-LD, visit tracker
  page.tsx                      dashboard: 4 tools, FAQ (FAQPage JSON-LD)
  resume-buddy/page.tsx         Resume Buddy (WebApplication + HowTo JSON-LD)
  pdf-to-word/, word-to-pdf/   converter pages (Converter UI + HowTo/FAQ JSON-LD)
  law-buddy/page.tsx            Law Buddy (form + results, FAQ JSON-LD)
  gym-buddy/                   "coming soon" SEO landing page
  admin/page.tsx, admin/login/  analytics dashboard + login
  sitemap.ts, robots.ts, opengraph-image.tsx, icon.svg
  api/track/visit               unique visitor + visit counting
  api/track/usage               client events (opens, coming-soon clicks, downloads)
  api/resume/parse              PDF/DOCX upload -> structured resume
  api/resume/generate           LLM optimization with the "-ed" rule
  api/law-buddy                 LLM keywords -> CourtListener search -> LLM summaries
  api/feedback                  1–5 star ratings
  api/admin/login|logout
src/lib/
  resume/types.ts               zod schema = single source of truth for resume data
  resume/templates.ts           Full-Time / W2 / C2C config (section order, header, LLM guidance)
  resume/rules.ts               "-ed" detection, repair, rule merging
  resume/prompt.ts              system + user prompts
  resume/engine.ts              Claude tool-use call, repair pass, fallback parser
  resume/export-docx.ts         editable Word export
  resume/export-pdf.ts          text-based PDF export
  seo.ts, tools.ts, tracking.ts, auth.ts, auth-edge.ts, prisma.ts, rate-limit.ts
src/components/
  ToolGrid, ComingSoonModal, StarRating, FeedbackModal, JsonLd, VisitTracker
  resume/ ResumeBuilder, InputMethodToggle, UploadDropzone, ManualForm,
          TemplateSelector, RulesInput, ResumePreview, ExportBar
```

## PDF ⇄ Word converters

Both converters run **entirely in the visitor's browser** — files are never uploaded (private, free to host, no 4.5 MB Vercel body limit). Only metrics are sent to `/api/track/conversion`.

**PDF → Word** (`src/lib/convert/pdf-to-docx.ts`) rebuilds real Word structure from glyph positions (pdf.js via `unpdf`), so the .docx is cleanly editable — no text boxes:
paragraphs (alignment, indents, spacing, line spacing) · Heading 1–3 from font-size tiers · real bulleted/numbered lists · tables from column-aligned rows · right tab stops and dot leaders · section rules as paragraph borders · images (inline, or behind text for letterheads) · hyperlinks · text colours (sampled from a render) · sub/superscript · repeating headers/footers with page-number fields · two-column pages as Word columns. Scanned PDFs are placed as images (no OCR yet).

**Exact layout for forms** (`src/lib/convert/pdf-fixed.ts`). Flowing paragraphs lose the geometry of forms, so pages that look like forms (text inside boxes/grids, many ruled lines, label/value fields — `formStats()`) are rebuilt by coordinates instead, and each PDF page becomes exactly one Word page:
- vector paths are parsed from pdf.js (`collectShapes`, incl. form XObject matrices);
- clean ruled grids → floating Word tables with fixed column widths, exact row heights, per-side borders at the PDF stroke width, cell shading and merged cells; cell text keeps its offset via indents, tab stops and spacing;
- all other text → absolutely positioned paragraphs (Word frames) with the original font, size, weight and colour. The exact line height is 5 × the font's descent, the one value where Word (descent at the bottom of the line) and LibreOffice (baseline at 80%) put the baseline in the same place;
- remaining lines, boxes, fills and curves → anchored DrawingML shapes (injected after packing); images → anchored pictures, all in PDF paint order; rotated text → vertical text boxes;
- fillable-form fields (AcroForm widgets): values, ticked checkboxes/radio buttons and field borders are added (they aren't part of the page text).
The converter UI offers **Auto** (default), **Exact layout** and **Flowing text**. On the sample I-20-style form every word lands within 0.4 pt horizontally and 0.9 pt vertically of the PDF after a Word→PDF render.

**Word → PDF** (`src/lib/convert/docx-to-pdf.ts` + `docx-model.ts`) parses the .docx (styles, theme fonts, numbering, sections) and lays it out with jsPDF using metric-compatible fonts (Calibri→Carlito, Cambria→Caladea, Times→Tinos, Arial→Arimo, Courier→Cousine; `public/fonts/convert/`, SIL OFL, renamed "Buddy…Compat"), so lines wrap where Word wraps them. Supports justification, tab stops, lists, tables (spans, merges, borders, shading, header rows), images, links, columns, page/section breaks, headers/footers with PAGE/NUMPAGES. Not rendered: footnotes, comments, charts/SmartArt, EMF/WMF.

## Law Buddy

Flow: case type + jurisdiction + description → the LLM extracts 3–5 legal keywords and a Boolean query (`emit_search_plan` tool) → CourtListener v4 search (`type=o`, relevance order, `court=` filter for the chosen state or Federal) → top 5 opinions → full text of each opinion (`/opinions/{id}/`) → the LLM writes a 100–150 word summary (facts, ruling, relevance) plus 3–5 keywords taken from that opinion (`emit_case_analyses` tool).

- **Jurisdiction:** `src/lib/law/jurisdictions.ts` maps each state to its CourtListener court IDs (state courts only); Federal = Supreme Court, circuits, district courts, Court of International Trade and Court of Federal Claims. Results from any other court are dropped. If CourtListener rejects a court ID, the search retries with the state's two highest courts.
- **Disambiguation:** the keyword prompt makes the model fill `factualDomain`, `factualCore` and `ambiguousTerms` *before* the keywords, with strict rules (a medical "seizure" is never a Fourth Amendment seizure; "custody", "discharge", "arrest"… are read from context). A server-side guard (`boilerplateProblems()` in `engine.ts`) rejects procedural boilerplate ("search and seizure", "probable cause", "Miranda", "due process") the facts don't support, asks the model once to fix it, then strips anything left. The no-AI rule engine uses the same context checks and builds fact-first synonym groups.
- **See More Cases:** `POST /api/law-buddy?page=N` (N ≥ 2) re-runs the page-1 query (sent back by the client with the keywords) and analyzes results (N-1)·5+1…N·5. CourtListener v4 uses cursor pagination, so the server follows `next` links (same host only) and caches the accumulated results for 10 minutes. Max 20 pages; "See more" loads have their own rate limit (40/hour) and are counted as `load_more` events, not as new searches.
- **Word count:** summaries outside 100–150 words get one repair turn; anything still over 150 is trimmed at a sentence boundary.
- **Keyword pills:** every keyword is checked against that opinion's text and dropped if it doesn't appear there; each pill links to a CourtListener search for that term in the same courts.

- **Setup:** create a free account at courtlistener.com, copy your token from https://www.courtlistener.com/profile/api/ and set `COURTLISTENER_API_TOKEN`. Without it the API returns a clear "not configured" error.
- **Prompts:** the exact system prompts are in `src/lib/law/prompts.ts` (`KEYWORD_SYSTEM_PROMPT`, `SUMMARY_SYSTEM_PROMPT`). The user's text is passed as untrusted data inside `<case_details>` tags.
- **Fallbacks:** if the strict query finds nothing, a broader query and then an OR of the keywords are tried. Without an LLM key configured (or if the LLM call fails) keywords and summaries come from a rule-based engine (`src/lib/law/engine.ts`), and the UI says so.
- **Privacy:** only counters are stored (`LawBuddyUsage`: case type, jurisdiction, status, result count, engine, duration). The description and the query are never saved.
- Rate limit: 12 searches per hour per IP.

## Resume typography & layout

- **One layout for everything.** `src/lib/resume/layout.ts` turns resume data into a flat list of blocks. The preview, PDF and Word exports all draw that same list, so Full-Time, W2 and C2C share identical margins, header, section rules and row alignment. Templates change only the section order, headings and header lines.
- **100% black & white, Arial.** The Word file uses Arial directly. PDF export and page-fit measurement embed Arimo (`public/fonts/`, SIL OFL), which has Arial's exact character widths, so line breaks match Word. The preview uses Arial, falling back to Arimo. Name 14pt bold · headline 12pt · section headers 12pt bold caps · body 10–11pt · dates/meta 10pt. Body text and bullets are justified.
- **Auto-fit.** `fitLayout()` measures the resume with the real font at four spacing presets and keeps the most comfortable one that meets the page target: Full-Time aims for 1 page (hard cap 2; the UI warns if it goes over), W2/C2C also aim for 1. The same preset is used for the PDF and the DOCX.
- **Word parity.** The DOCX uses exact line spacing, so Word breaks lines the same way as the PDF. Bullets and paragraphs never split across a page break.

## Bullet optimization

Every bullet is optimized, not only the ones that start with "-ed".
- **With an LLM key configured:** the AI rewrites each point. Bullets returned verbatim or with only the first word changed are detected (`findUnoptimized()`) and sent back for another pass.
- **Without a key:** `src/lib/resume/optimize.ts` polishes each bullet: present-tense leads ("Built" → "Build", "Manages" → "Manage"), stronger verbs for weak openers ("Responsible for writing" → "Write", "Used" → "Leverage"), filler removal, "40 percent" → "40%", official technology casing (nodejs → Node.js, k8s → Kubernetes) and duplicate removal. It can't invent metrics or restructure a sentence the way the AI does.

## Education parsing

`src/lib/resume/education.ts` keeps the school, degree, field, dates and GPA/honors for one degree in a single entry, even when they are on separate lines or in a different order. The LLM parser is told the same rule, and its output goes through the same merge step. Two complete degrees are never merged, and several degrees listed under one school inherit that school.

## How the "-ed" rule is guaranteed

1. The system prompt states it as a non-negotiable rule that overrides user rules (`rules.ts → DEFAULT_RULE_TEXT`), merged with the user's custom rules (`buildRuleSet`).
2. The model must answer through a forced `emit_resume` tool call whose JSON Schema is generated from the same zod schema, so output is always structured.
3. The prompt requires a **full rewrite** of any bullet that started with an -ed word (new lead, consistent verbs, all facts and tech kept), with right/wrong examples.
4. `validateResume()` finds bullets that still start with -ed; `findLazyRewrites()` finds bullets where the word was only deleted or its tense swapped. Both go back to the model for up to two targeted repair turns.
5. `enforceNoEdStart()` is the last safety net (and the path used without an API key): phrase rules ("Worked on migrating…" → "Migrate…", "Responsible for managing…" → "Manage…") and tense-consistent coordinated verbs ("Developed and deployed" → "Build and deploy"), so no bullet can leave the server starting with an -ed word.

## Analytics definitions

- **Unique visitors** = rows in `Visitor` (one per browser, `buddy_vid` cookie, 1 year).
- **Visits** = rows in `Visit`; a new visit is counted when there's no active 30-minute session cookie. Bots are filtered by user agent.
- **Tool usage** = `ToolUsageEvent` grouped by tool + action. `generate` and `parse_upload` are recorded server-side only, so they can't be spoofed from the browser.
- **Ratings** = `Review` rows (with `tool`), created by the feedback modal shown right after the first download in Resume Buddy and both converters.
- **Law Buddy searches** = `LawBuddyUsage` rows, shown on /admin as a total tile plus a card with results/no-results/failed, average cases shown, average time and a per-case-type breakdown.
- **Conversions** = `Conversion` rows (tool, success/failed, bytes, pages, duration, error code). The admin dashboard shows, per converter: conversions, failures, success rate, page views, uploads, downloads, pages and data converted, average time and the upload→download funnel.

After pulling this version run `npx prisma db push` once to create the `LawBuddyUsage` table / add its new `jurisdiction` column.
