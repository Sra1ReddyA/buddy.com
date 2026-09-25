import "server-only";

/**
 * Minimal CourtListener v4 search client (public court opinions, type=o).
 * Docs: https://www.courtlistener.com/help/api/rest/v4/search/  — requires a free API token.
 */
// COURTLISTENER_API_URL lets you point at a proxy or a mock server in tests.
const ENDPOINT = process.env.COURTLISTENER_API_URL || "https://www.courtlistener.com/api/rest/v4/search/";
const SITE = "https://www.courtlistener.com";
/** …/api/rest/v4/ — derived from the search endpoint so a proxy/mock override covers every call. */
const API_ROOT = ENDPOINT.replace(/search\/?$/, "");

export class CourtListenerError extends Error {
  constructor(message: string, public status: number, public code: "auth" | "rate_limit" | "upstream" | "timeout" | "config") {
    super(message);
  }
}

type RawOpinion = { id?: number; type?: string; snippet?: string; download_url?: string | null };
export type RawResult = {
  cluster_id?: number;
  caseName?: string;
  caseNameFull?: string;
  court?: string;
  court_id?: string;
  court_citation_string?: string;
  dateFiled?: string | null;
  absolute_url?: string;
  citation?: string[];
  docketNumber?: string | null;
  citeCount?: number | null;
  snippet?: string;
  opinions?: RawOpinion[];
};

/**
 * Keep only the Boolean syntax CourtListener understands and we allow the model to produce:
 * words, "quoted phrases", AND/OR/NOT, parentheses and trailing * wildcards. Balances quotes/parens,
 * strips field operators (caseName:, court_id:) and caps length.
 */
export function sanitizeQuery(input: string): string {
  let q = input
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\b[a-zA-Z_]+:(?=\S)/g, "") // field operators
    .replace(/[^A-Za-z0-9\s"()*'\-&§.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // balance double quotes
  if ((q.match(/"/g) ?? []).length % 2 === 1) q = q.replace(/"(?=[^"]*$)/, "");
  // balance parentheses
  let depth = 0;
  let out = "";
  for (const ch of q) {
    if (ch === "(") depth++;
    if (ch === ")") {
      if (depth === 0) continue;
      depth--;
    }
    out += ch;
  }
  out += ")".repeat(depth);
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/\b(AND|OR|NOT)\s+(AND|OR)\b/g, "$1").replace(/\(\s*\)/g, "").replace(/\s+/g, " ");
  }
  out = out
    .replace(/\(\s*\)/g, "")
    .replace(/\(\s*(AND|OR|NOT)\s+/g, "(")
    .replace(/\s+(AND|OR|NOT)\s*\)/g, ")")
    .replace(/^\s*(AND|OR|NOT)\s+/, "")
    .replace(/\s+(AND|OR|NOT)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return out.slice(0, 300);
}

const quote = (k: string) => (/\s/.test(k.trim()) ? `"${k.trim().replace(/"/g, "")}"` : k.trim());

/** Fallback query from keywords: first two keywords must match, the rest broaden. */
export function queryFromKeywords(keywords: string[], broad = false): string {
  const ks = keywords.map(quote).filter(Boolean);
  if (broad || ks.length < 3) return ks.join(" OR ");
  return `(${ks[0]} OR ${ks[1]}) AND (${ks.slice(2).join(" OR ")})`;
}

type Opts = { token?: string; timeoutMs?: number };

function tokenOrThrow(opts: Opts) {
  const token = opts.token ?? process.env.COURTLISTENER_API_TOKEN;
  if (!token) throw new CourtListenerError("Case search isn't configured yet (missing COURTLISTENER_API_TOKEN).", 503, "config");
  return token;
}

async function clFetch(url: URL, token: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { Authorization: `Token ${token}`, Accept: "application/json", "User-Agent": "Buddy-LawBuddy/1.0" },
      signal: ctrl.signal,
      cache: "no-store",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new CourtListenerError("CourtListener took too long to respond.", 504, "timeout");
    throw new CourtListenerError("Couldn't reach CourtListener.", 502, "upstream");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * On a non-2xx response, reads and logs CourtListener's own error body (its 400s are normally a JSON
 * object naming exactly which field/value it rejected) so the real cause shows up in server logs
 * instead of a bare status code — the response body can only be read once, so every caller must go
 * through this rather than inspecting res.ok itself.
 */
async function checkStatus(res: Response, url: URL) {
  if (res.ok) return;
  let bodyText = "";
  try {
    bodyText = (await res.text()).slice(0, 2000);
  } catch {
    // ignore — body may already be consumed or unreadable
  }
  if (bodyText) console.error(`[courtlistener] ${res.status} from ${url.pathname}${url.search} — ${bodyText}`);
  if (res.status === 401 || res.status === 403) throw new CourtListenerError("CourtListener rejected the API token.", 502, "auth");
  if (res.status === 429) throw new CourtListenerError("CourtListener's rate limit was reached. Please try again in a minute.", 429, "rate_limit");
  throw new CourtListenerError(`CourtListener returned an error (${res.status}).`, 502, "upstream");
}

type SearchPage = { count: number; results: RawResult[]; next: string | null };

/**
 * One CourtListener results page (type=o) restricted to `courts` (sent as the space-separated `court`
 * filter). Pass `nextUrl` to follow CourtListener's cursor pagination. If CourtListener rejects the
 * court list (400), it retries once with `fallbackCourts`. Results from any other court are dropped,
 * so the jurisdiction filter is strict either way.
 */
async function searchPage(
  q: string,
  courts: string[],
  opts: Opts & { fallbackCourts?: string[]; nextUrl?: string | null },
): Promise<SearchPage & { courtsUsed: string[] }> {
  const token = tokenOrThrow(opts);
  const build = (list: string[]) => {
    const url = new URL(ENDPOINT);
    url.searchParams.set("q", q);
    url.searchParams.set("type", "o");
    url.searchParams.set("order_by", "score desc");
    url.searchParams.set("highlight", "on");
    if (list.length) url.searchParams.set("court", list.join(" "));
    return url;
  };
  let used = courts;
  let res: Response;
  let finalUrl: URL;
  if (opts.nextUrl) {
    const next = new URL(opts.nextUrl);
    // only follow cursor links that point back at the same API (never an arbitrary host)
    if (next.origin !== new URL(ENDPOINT).origin) throw new CourtListenerError("Unexpected pagination link from CourtListener.", 502, "upstream");
    finalUrl = next;
    res = await clFetch(next, token, opts.timeoutMs ?? 15000);
  } else {
    finalUrl = build(courts);
    res = await clFetch(finalUrl, token, opts.timeoutMs ?? 15000);
    if (res.status === 400 && opts.fallbackCourts?.length) {
      used = opts.fallbackCourts;
      finalUrl = build(used);
      res = await clFetch(finalUrl, token, opts.timeoutMs ?? 15000);
    }
  }
  await checkStatus(res, finalUrl);
  const json = (await res.json()) as { count?: number | { value?: number }; next?: string | null; results?: RawResult[] };
  const allowed = new Set(used);
  const results = (json.results ?? []).filter((r) => !r.court_id || allowed.size === 0 || allowed.has(r.court_id));
  const count = typeof json.count === "number" ? json.count : (json.count?.value ?? results.length);
  return { count, results, next: json.next ?? null, courtsUsed: used };
}

/** Page 1 of a search — kept for callers that only need the first page. */
export async function searchOpinions(q: string, courts: string[], opts: Opts & { fallbackCourts?: string[] } = {}) {
  const { count, results } = await searchPage(q, courts, opts);
  return { count, results };
}

// Short-lived cache of accumulated results per query+courts, so "See More Cases" doesn't re-walk
// CourtListener's cursor pages on every click. (Per server instance; a cold instance simply re-walks.)
type Walk = { count: number; results: RawResult[]; next: string | null; courtsUsed: string[]; at: number };
const WALKS = new Map<string, Walk>();
const WALK_TTL = 10 * 60_000;
const MAX_CL_PAGES = 6;

/**
 * Results [offset, offset+limit) for a query, following CourtListener's cursor pages as needed
 * (v4 search uses cursor pagination, ~20 results per page).
 */
export async function searchWindow(
  q: string,
  courts: string[],
  opts: Opts & { fallbackCourts?: string[]; offset: number; limit: number },
): Promise<{ count: number; results: RawResult[]; hasMore: boolean }> {
  const key = `${q}|${courts.join(" ")}`;
  let walk = WALKS.get(key);
  if (!walk || Date.now() - walk.at > WALK_TTL) {
    const first = await searchPage(q, courts, opts);
    walk = { ...first, at: Date.now() };
  }
  let pagesFetched = 0;
  while (walk.results.length < opts.offset + opts.limit && walk.next && pagesFetched < MAX_CL_PAGES) {
    const cur: Walk = walk;
    const more = await searchPage(q, cur.courtsUsed, { ...opts, nextUrl: cur.next });
    const seen = new Set<number | undefined>(cur.results.map((r) => r.cluster_id));
    walk = { ...cur, results: [...cur.results, ...more.results.filter((r) => !seen.has(r.cluster_id))], next: more.next };
    pagesFetched++;
  }
  WALKS.delete(key);
  WALKS.set(key, walk);
  while (WALKS.size > 200) WALKS.delete(WALKS.keys().next().value as string);

  const results = walk.results.slice(opts.offset, opts.offset + opts.limit);
  return { count: walk.count, results, hasMore: walk.results.length > opts.offset + opts.limit || Boolean(walk.next) };
}

type RawOpinionDetail = {
  plain_text?: string;
  html_with_citations?: string;
  html?: string;
  html_lawbox?: string;
  html_columbia?: string;
  xml_harvard?: string;
};

const TEXT_FIELDS = ["plain_text", "html_with_citations", "html", "html_lawbox", "html_columbia", "xml_harvard"] as const;

/** Full text of one opinion (plain text, or HTML/XML flattened to text). Returns "" if unavailable. */
export async function fetchOpinionText(opinionId: number, opts: Opts = {}): Promise<string> {
  const token = tokenOrThrow(opts);
  const url = new URL(`${API_ROOT}opinions/${opinionId}/`);
  url.searchParams.set("fields", TEXT_FIELDS.join(","));
  const res = await clFetch(url, token, opts.timeoutMs ?? 10000);
  await checkStatus(res, url);
  const o = (await res.json()) as RawOpinionDetail;
  for (const f of TEXT_FIELDS) {
    const v = o[f]?.trim();
    if (v && v.length > 200) return f === "plain_text" ? v.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : htmlToText(v);
  }
  return "";
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|h\d|li|blockquote|br)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&sect;/g, "§")
    .replace(/&[lr]squo;/g, "'")
    .replace(/&[lr]dquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");

/** Strip highlight tags/HTML and tidy whitespace from CourtListener snippets. */
export function cleanSnippet(s: string | undefined, max = 700): string {
  if (!s) return "";
  const text = decodeEntities(s.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max).replace(/\s+\S*$/, "") + "…" : text;
}

export const opinionUrl = (r: RawResult) =>
  r.absolute_url ? (r.absolute_url.startsWith("http") ? r.absolute_url : SITE + r.absolute_url) : r.cluster_id ? `${SITE}/opinion/${r.cluster_id}/` : SITE;

export const searchPageUrl = (q: string, courts: string[] = []) =>
  `${SITE}/?q=${encodeURIComponent(q)}&type=o&order_by=score%20desc${courts.length ? `&court=${encodeURIComponent(courts.join(" "))}` : ""}`;
