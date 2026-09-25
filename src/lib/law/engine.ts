import "server-only";
import { z } from "zod";
import { getLLMClient, type LLMClient, type LLMTool, type LLMTurn } from "../llm/client";
import { KEYWORD_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT, keywordUserPrompt, planRepairPrompt, summaryRepairPrompt, summaryUserPrompt, type SummaryInput } from "./prompts";
import { cleanSnippet, fetchOpinionText, opinionUrl, queryFromKeywords, sanitizeQuery, searchWindow, type RawResult } from "./courtlistener";
import { coreCourtsFor, courtsFor, jurisdictionLabel } from "./jurisdictions";
import { MAX_PAGE, PAGE_SIZE, SearchPlan, SUMMARY_MAX_WORDS, SUMMARY_MIN_WORDS, type CaseResult, type CaseType, type LawMoreRequest, type LawSearchRequest, type LawSearchResponse } from "./types";

const TOP_N = PAGE_SIZE;

const client = () => getLLMClient();

type Turn = LLMTurn;

/** Forced tool call. Returns the parsed input plus the transcript so a follow-up (repair) turn can continue it. */
async function callTool<T>(
  llm: LLMClient,
  system: string,
  messages: Turn[],
  tool: LLMTool,
  schema: z.ZodType<T>,
  maxTokens: number,
): Promise<{ data: T; transcript: Turn[]; toolUseId: string }> {
  return llm.callTool(system, messages, tool, schema, maxTokens);
}

// ---------------------------------------------------------------------------
// Step 1 — keywords + Boolean query (fact-first, disambiguated)
// ---------------------------------------------------------------------------
const SEARCH_TOOL: LLMTool = {
  name: "emit_search_plan",
  description:
    "Analyze the factual domain and any ambiguous words first, then return 3–5 fact-based legal keywords plus a targeted and a broad CourtListener Boolean query.",
  schema: SearchPlan,
};

/** What the rest of the pipeline needs from a plan (LLM or rules). */
export type Plan = { keywords: string[]; booleanQuery: string; broadQuery: string; interpretation?: string };

// ----- context detectors shared by the rule engine and the boilerplate guard -----
/** Police / government agents acting on a person or property — the only context where search-and-seizure terms fit. */
const POLICE =
  /\b(police|officers?|cops?|deputy|deputies|sheriff|trooper|detective|federal agents?|ice agents?|warrant|pulled (me |us |him |her )?over|traffic stop|arrested|frisk\w*|pat(ted)? (me )?down|k-?9|drug dog|searched (my|our|his|her|the) (car|house|home|apartment|phone|bag|room|vehicle|backpack|person))\b/i;
/** Medical / health context (excluding the word "seizure" itself, which is the ambiguous one). */
const MEDICAL =
  /\b(convuls\w*|epilep\w*|unresponsive|ambulance|911|paramedics?|emergency room|hospital\w*|\ber\b|pediatric\w*|fever|symptoms?|shaking|foaming|not breathing|stopped breathing|choking|overdose|diagnos\w*|medication|doctor|nurse|icu)\b/i;
const CHILD = /\b(child|children|kid|kids|toddler|infant|baby|newborn|son|daughter|minor|preschool\w*|\d{1,2}[- ]?(year|month)[- ]?old)\b/i;
const SEIZURE_WORD = /\bseizures?\b|\bfits?\b(?= (at|in|while|after|during))/i;
/** "seizure" is medical unless police are clearly taking property/people and nothing medical is mentioned. */
const isMedicalSeizure = (t: string) => SEIZURE_WORD.test(t) && (MEDICAL.test(t) || CHILD.test(t) || !POLICE.test(t) || /\b(had|has|having) (a )?seizures?\b/i.test(t));

type Term = { re: RegExp; kw: string; syn?: string[]; when?: (text: string) => boolean };
const q = (k: string) => (/\s/.test(k) && !/^".*"$/.test(k) ? `"${k}"` : k);
const group = (t: Term) => {
  const list = [...new Set((t.syn?.length ? t.syn : [t.kw]).map(q))];
  return list.length > 1 ? `(${list.join(" OR ")})` : list[0];
};

/** Fact patterns that apply whatever case type was picked — the factual core comes first. */
const FACTS: Term[] = [
  {
    re: /\b(neglect\w*|left (alone|unattended)|unattended|unsupervised|endanger\w*|didn'?t (call|check|notice|get help)|did not (call|check|notice|get help)|failed to (call|seek|get|notice|supervise)|ignored)\b/i,
    kw: "child neglect",
    syn: ["child neglect", "child endangerment", "negligent supervision"],
    when: (t) => CHILD.test(t),
  },
  {
    re: SEIZURE_WORD,
    kw: "seizure",
    syn: ["seizure", "convulsion", "medical emergency"],
    when: isMedicalSeizure,
  },
  {
    re: /\b(unresponsive|ambulance|911|emergency room|not breathing|stopped breathing|choking|overdose|medical emergency|allergic reaction)\b/i,
    kw: "medical emergency",
    syn: ["medical emergency", "medical attention", "emergency care"],
  },
  {
    re: /\b(babysit\w*|sitter|nann(y|ies)|day ?care|child ?care|caregivers?|preschool|drop(ped)?[- ]?off|picked (him|her|them) up)\b/i,
    kw: "caregiver",
    syn: ["caregiver", "babysitter", "daycare", "child care"],
  },
  { re: /\b(nursing home|assisted living|elder\w*)\b/i, kw: "nursing home neglect", syn: ["nursing home", "elder abuse", "resident neglect"] },
  { re: /\b(misdiagnos\w*|surgery|surgeon|wrong medication|medical malpractice)\b/i, kw: "medical malpractice", syn: ["medical malpractice", "standard of care"] },
  { re: /\b(car accident|crash|collision|rear-?ended|t-?boned)\b/i, kw: "motor vehicle accident", syn: ["motor vehicle accident", "collision"] },
  { re: /\bdog (bit|bite|attack)\w*/i, kw: "dog bite", syn: ["dog bite", "dangerous dog"] },
];

const police = (t: string) => POLICE.test(t);
const notMedicalSeizure = (t: string) => POLICE.test(t) && !isMedicalSeizure(t);

/** Case-type vocabulary for the rule engine. Procedural terms only fire when the facts describe that procedure. */
const VOCAB: Record<CaseType, Term[]> = {
  Civil: [
    { re: /fired|terminat|let go|dismissed from/i, kw: "wrongful termination", syn: ["wrongful termination", "wrongful discharge"] },
    { re: /retaliat|whistle|report(ed|ing)?\b|complain/i, kw: "retaliation", syn: ["retaliat*", "whistleblower"], when: (t) => /job|work|employ|manager|boss|hr\b|fired|terminat/i.test(t) },
    { re: /\b(discriminat\w*|race|racial|gender|sex|age|disab\w*|religio\w*|pregnan\w*)\b/i, kw: "discrimination" },
    { re: /harass/i, kw: "harassment" },
    { re: /contract|agreement|breach/i, kw: "breach of contract" },
    { re: /injur|accident|slip|fell|negligen/i, kw: "negligence" },
    { re: /defam|slander|libel|false statement/i, kw: "defamation" },
    { re: /fraud|misrepresent|lied|deceiv/i, kw: "fraudulent misrepresentation" },
    { re: /wage|overtime|unpaid/i, kw: "unpaid wages" },
  ],
  Criminal: [
    { re: /search|searched|warrant/i, kw: "Fourth Amendment", syn: ["Fourth Amendment", "unreasonable search"], when: police },
    { re: /\bseiz\w*/i, kw: "search and seizure", syn: ["search and seizure", "unlawful seizure"], when: notMedicalSeizure },
    { re: /pulled over|traffic stop|detain\w*|stopped (me|us|him|her)\b/i, kw: "probable cause", syn: ["probable cause", "reasonable suspicion"], when: police },
    { re: /miranda|interrogat|confess|questioned/i, kw: "Miranda", when: police },
    { re: /self.?defen/i, kw: "self-defense" },
    { re: /\b(my|the|public) (lawyer|attorney|defender)|counsel/i, kw: "ineffective assistance of counsel" },
    { re: /theft|stole|steal|larceny/i, kw: "theft" },
    { re: /assault|punch|battery|attacked/i, kw: "assault" },
    { re: /drug|possession|narcotic/i, kw: "possession of controlled substance" },
    { re: /sentenc/i, kw: "sentencing" },
  ],
  Family: [
    { re: /custody|visitation|parenting time/i, kw: "child custody" },
    { re: /child support/i, kw: "child support" },
    { re: /alimony|spousal/i, kw: "spousal support" },
    { re: /divorce|separat|dissolution/i, kw: "dissolution of marriage" },
    { re: /abuse|violence|protective order|restraining/i, kw: "protective order" },
    { re: /relocat|move (away|out of state|to another)/i, kw: "relocation" },
    { re: /paternity/i, kw: "paternity" },
    { re: /adopt/i, kw: "adoption" },
    { re: /marital (property|home)|assets|equitable/i, kw: "equitable distribution" },
  ],
  Corporate: [
    { re: /fiduciary|director|officer of the company/i, kw: "breach of fiduciary duty" },
    { re: /shareholder|stockholder/i, kw: "shareholder" },
    { re: /derivative/i, kw: "derivative suit" },
    { re: /veil|personal(ly)? liab/i, kw: "piercing the corporate veil" },
    { re: /non.?compete|noncompet/i, kw: "non-compete agreement" },
    { re: /securit|stock|investor/i, kw: "securities fraud" },
    { re: /merger|acquisition/i, kw: "merger" },
    { re: /partner/i, kw: "partnership dispute" },
    { re: /contract|agreement/i, kw: "breach of contract" },
  ],
  "Real Estate": [
    { re: /evict/i, kw: "eviction" },
    { re: /landlord|tenant|lease|rent/i, kw: "landlord tenant" },
    { re: /deposit/i, kw: "security deposit" },
    { re: /repair|mold|habitab|heat/i, kw: "warranty of habitability" },
    { re: /boundar|fence|encroach/i, kw: "encroachment" },
    { re: /easement|driveway/i, kw: "easement" },
    { re: /adverse possession|squat/i, kw: "adverse possession" },
    { re: /foreclos|mortgage/i, kw: "foreclosure" },
    { re: /title|deed/i, kw: "quiet title" },
    { re: /disclos|defect/i, kw: "failure to disclose defects" },
  ],
  "Intellectual Property": [
    { re: /copy|copyright|photo|music|video|content/i, kw: "copyright infringement" },
    { re: /fair use|parody|review|education/i, kw: "fair use" },
    { re: /trademark|brand|logo/i, kw: "trademark infringement" },
    { re: /confus/i, kw: "likelihood of confusion" },
    { re: /patent|invent/i, kw: "patent infringement" },
    { re: /trade secret|confidential|customer list/i, kw: "trade secret misappropriation" },
    { re: /dmca|takedown/i, kw: "DMCA" },
    { re: /domain name/i, kw: "cybersquatting" },
  ],
  Traffic: [
    { re: /speed|radar|mph/i, kw: "speeding" },
    { re: /\b(dui|dwi|drunk|alcohol|breathalyzer)\b/i, kw: "driving under the influence" },
    { re: /reckless/i, kw: "reckless driving" },
    { re: /license (was )?(suspend|revok)|suspended license/i, kw: "license suspension" },
    { re: /pulled over|traffic stop/i, kw: "traffic stop", when: police },
    { re: /breathalyzer|blood (alcohol|test|draw)|refus\w* (a |the )?(breath|blood|chemical) test|implied consent/i, kw: "implied consent" },
    { re: /red light|stop sign|traffic signal/i, kw: "traffic signal violation" },
    { re: /accident|crash|collision/i, kw: "motor vehicle accident" },
  ],
  Administrative: [
    { re: /denied|denial|revok|terminat/i, kw: "arbitrary and capricious" },
    { re: /hearing|notice/i, kw: "due process", syn: ["due process", "notice and hearing"] },
    { re: /appeal/i, kw: "administrative appeal" },
    { re: /disabil|ssi|ssdi|social security/i, kw: "disability benefits" },
    { re: /unemploy/i, kw: "unemployment benefits" },
    { re: /zoning|permit|variance/i, kw: "zoning variance" },
    { re: /license/i, kw: "license revocation" },
    { re: /immigra|visa|asylum/i, kw: "immigration" },
    { re: /exhaust/i, kw: "exhaustion of administrative remedies" },
  ],
};
/** Only used to widen a search when the facts matched fewer than 3 terms — never procedural boilerplate. */
const DEFAULTS: Record<CaseType, string[]> = {
  Civil: ["negligence", "damages", "liability"],
  Criminal: ["criminal liability", "intent", "conviction"],
  Family: ["best interests of the child", "custody", "support"],
  Corporate: ["fiduciary duty", "breach of contract", "shareholder"],
  "Real Estate": ["landlord tenant", "breach of lease", "property"],
  "Intellectual Property": ["infringement", "fair use", "damages"],
  Traffic: ["traffic violation", "license suspension", "citation"],
  Administrative: ["arbitrary and capricious", "agency decision", "administrative appeal"],
};

export function rulePlan(req: Pick<LawSearchRequest, "caseType" | "details">): Plan {
  const t = req.details;
  const matched: Term[] = [];
  for (const term of [...FACTS, ...VOCAB[req.caseType]]) {
    if (term.re.test(t) && (!term.when || term.when(t)) && !matched.some((m) => m.kw === term.kw)) matched.push(term);
  }
  const keywords = matched.map((m) => m.kw);
  for (const d of DEFAULTS[req.caseType]) if (keywords.length < 3 && !keywords.includes(d)) keywords.push(d);
  const top = keywords.slice(0, 5);
  // AND the fact groups (first 3, skipping terms whose synonyms overlap an earlier group); defaults only widen
  const distinct: Term[] = [];
  for (const m of matched) {
    const syn = new Set((m.syn ?? [m.kw]).map((x) => x.toLowerCase()));
    if (!distinct.some((d) => (d.syn ?? [d.kw]).some((x) => syn.has(x.toLowerCase())))) distinct.push(m);
  }
  const groups = distinct.slice(0, 3).map(group);
  const booleanQuery =
    groups.length >= 2
      ? groups.join(" AND ")
      : groups.length === 1
        ? `${groups[0]} AND (${top.slice(1).map(q).join(" OR ")})`
        : queryFromKeywords(top);
  const broadQuery = groups.length >= 3 ? groups.slice(0, 2).join(" AND ") : queryFromKeywords(top, true);
  return { keywords: top, booleanQuery: sanitizeQuery(booleanQuery), broadQuery: sanitizeQuery(broadQuery) };
}

// ----- boilerplate guard: procedural terms must be justified by the facts -----
const BOILERPLATE: { term: RegExp; justified: (t: string) => boolean; reason: string }[] = [
  {
    term: /fourth amendment|search and seizure|unreasonable search|unlawful seizure|illegal seizure|\bseiz\w* of\b|probable cause|reasonable suspicion|exclusionary|suppress\w*|\bwarrant\w*/i,
    justified: (t) => POLICE.test(t) && !(isMedicalSeizure(t) && !/search|searched|warrant|pulled over|stopped|detain|arrest/i.test(t)),
    reason: "the description does not describe police or government agents searching, stopping or seizing anyone or anything (a medical seizure is not a Fourth Amendment seizure)",
  },
  {
    term: /miranda|self-incrimination|custodial interrogation/i,
    justified: (t) => POLICE.test(t) && /question|interrogat|confess|statement|miranda|rights/i.test(t),
    reason: "the description does not describe a police interrogation",
  },
  {
    term: /due process|equal protection/i,
    justified: (t) => /hearing|notice|agency|government|state (took|removed|revoked)|revok|suspend|benefit|license|school|expel|parental rights|cps|child protective|department of/i.test(t),
    reason: "the description does not describe a government decision made without notice or a hearing",
  },
];

export function boilerplateProblems(plan: Plan, details: string): { term: string; reason: string }[] {
  const text = [...plan.keywords, plan.booleanQuery, plan.broadQuery].join(" | ");
  const out: { term: string; reason: string }[] = [];
  for (const b of BOILERPLATE) {
    const m = text.match(b.term);
    if (m && !b.justified(details)) out.push({ term: m[0], reason: b.reason });
  }
  return out;
}

/** Last resort: remove unjustified terms from keywords and queries. */
function stripBoilerplate(plan: Plan, details: string): Plan {
  const bad = BOILERPLATE.filter((b) => !b.justified(details)).map((b) => b.term);
  if (!bad.length) return plan;
  const hit = (s: string) => bad.some((re) => new RegExp(re.source, "i").test(s));
  const cleanQuery = (query: string) =>
    sanitizeQuery(
      query
        .replace(/"[^"]*"/g, (m) => (hit(m) ? "" : m))
        .replace(/\b[\w*-]+\b/g, (m) => (/^(AND|OR|NOT)$/.test(m) || !hit(m) ? m : "")),
    );
  return {
    ...plan,
    keywords: plan.keywords.filter((k) => !hit(k)),
    booleanQuery: cleanQuery(plan.booleanQuery),
    broadQuery: cleanQuery(plan.broadQuery),
  };
}

const tidyKeywords = (ks: string[]) => [...new Set(ks.map((k) => k.replace(/["()]/g, "").replace(/[?!.,;:]+$/, "").trim()).filter(Boolean))].slice(0, 5);

async function planSearch(req: LawSearchRequest, llm: LLMClient | null): Promise<{ plan: Plan; engine: "llm" | "rules" }> {
  if (llm) {
    try {
      const toPlan = (raw: SearchPlan): Plan => {
        const keywords = tidyKeywords(raw.keywords);
        return {
          keywords,
          booleanQuery: sanitizeQuery(raw.booleanQuery) || queryFromKeywords(keywords),
          broadQuery: sanitizeQuery(raw.broadQuery) || queryFromKeywords(keywords, true),
          interpretation: raw.factualCore || undefined,
        };
      };
      const first = await callTool(
        llm,
        KEYWORD_SYSTEM_PROMPT,
        [llm.userTurn(keywordUserPrompt(req.caseType, req.jurisdiction, req.details))],
        SEARCH_TOOL,
        SearchPlan,
        3000,
      );
      let plan = toPlan(first.data);

      // Guard: procedural boilerplate the facts don't support (e.g. medical seizure → "search and seizure")
      const problems = boilerplateProblems(plan, req.details);
      if (problems.length) {
        console.warn("[law-buddy] plan used unsupported terms, asking for a fix:", problems.map((p) => p.term));
        try {
          const fix = await callTool(
            llm,
            KEYWORD_SYSTEM_PROMPT,
            llm.repairTurn(first.transcript, first.toolUseId, "Rejected — see below.", planRepairPrompt(problems)),
            SEARCH_TOOL,
            SearchPlan,
            3000,
          );
          plan = toPlan(fix.data);
        } catch (e) {
          console.error("[law-buddy] plan repair failed", e);
        }
        plan = stripBoilerplate(plan, req.details);
        if (plan.keywords.length < 2 || !plan.booleanQuery) {
          const rules = rulePlan(req);
          plan = { ...rules, interpretation: plan.interpretation };
        }
      }
      return { plan, engine: "llm" };
    } catch (e) {
      console.error("[law-buddy] keyword extraction failed, using rules", e);
    }
  }
  return { plan: rulePlan(req), engine: "rules" };
}

// ---------------------------------------------------------------------------
// Step 3 — full opinion text for each of the top cases
// ---------------------------------------------------------------------------
const HEAD_CHARS = 9000;
const TAIL_CHARS = 5000;
/**
 * A much smaller excerpt used only for the LLM prompt (see `llmText` below) — free-tier providers cap
 * a single request far below what HEAD_CHARS/TAIL_CHARS would need for 5 cases at once (e.g. Groq's
 * on-demand tier enforces an ~8000-token *per-request* ceiling, prompt + max_tokens combined). The
 * no-AI fallback (`ruleAnalysis`) still gets the full HEAD_CHARS/TAIL_CHARS excerpt via `text` — only
 * what's sent to the model is trimmed further.
 */
const LLM_HEAD_CHARS = 1600;
const LLM_TAIL_CHARS = 700;

/**
 * User-supplied `details` can be up to DETAILS_MAX (5000) chars; combined with 5 cases' worth of
 * `llmText` that alone can approach Groq's ~8000-token per-request cap. Only the case-analysis LLM
 * prompt trims it — the search-keyword prompt and the rule-based fallback still see the full text.
 */
const DETAILS_LLM_MAX = 1200;

function forLlmPrompt(details: string): string {
  return details.length > DETAILS_LLM_MAX
    ? `${details.slice(0, DETAILS_LLM_MAX).replace(/\s+\S*$/, "")} […]`
    : details;
}

/** Keep the beginning (facts) and the end (decision) of long opinions so the prompt stays small. */
export function condense(text: string, headChars = HEAD_CHARS, tailChars = TAIL_CHARS): string {
  if (text.length <= headChars + tailChars + 500) return text;
  const head = text.slice(0, headChars).replace(/\s+\S*$/, "");
  const tail = text.slice(-tailChars).replace(/^\S*\s+/, "");
  return `${head}\n\n[… middle of the opinion omitted …]\n\n${tail}`;
}

type Candidate = SummaryInput & { raw: RawResult; hay: string; llmText: string };

function pickOpinionId(r: RawResult): number | undefined {
  const ops = r.opinions ?? [];
  return (ops.find((o) => o.id && /combined|lead|majority/i.test(o.type ?? "")) ?? ops.find((o) => o.id))?.id;
}

async function buildCandidates(results: RawResult[]): Promise<Candidate[]> {
  const top = results.filter((r) => r.caseName || r.caseNameFull).slice(0, TOP_N);
  const texts = await Promise.allSettled(top.map((r) => {
    const id = pickOpinionId(r);
    return id ? fetchOpinionText(id) : Promise.resolve("");
  }));
  return top.map((r, i) => {
    const full = texts[i].status === "fulfilled" ? texts[i].value : "";
    if (texts[i].status === "rejected") console.warn("[law-buddy] opinion text unavailable", r.cluster_id, (texts[i] as PromiseRejectedResult).reason?.message);
    const snippet = cleanSnippet(r.opinions?.find((o) => o.snippet?.trim())?.snippet ?? r.snippet, 1500);
    const text = full ? condense(full) : snippet;
    const llmText = full ? condense(full, LLM_HEAD_CHARS, LLM_TAIL_CHARS) : text;
    return {
      id: r.cluster_id ?? i + 1,
      caseName: (r.caseName || r.caseNameFull || "Untitled case").trim(),
      court: (r.court || r.court_citation_string || "Unknown court").trim(),
      year: r.dateFiled ? String(new Date(r.dateFiled).getUTCFullYear()) : "",
      docketNumber: r.docketNumber ?? null,
      text,
      llmText,
      fullText: Boolean(full),
      hay: normalize(full || snippet),
      raw: r,
    };
  });
}

// ---------------------------------------------------------------------------
// Step 4 — 100–150 word analyses + per-case keywords
// ---------------------------------------------------------------------------
const Analyses = z.object({
  analyses: z
    .array(
      z.object({
        id: z.number().int(),
        summary: z.string().trim().min(20).max(2000),
        keywords: z.array(z.string().trim().min(2).max(80)).max(8),
      }),
    )
    .min(1)
    .max(TOP_N),
});
const ANALYSIS_TOOL: LLMTool = {
  name: "emit_case_analyses",
  description: "Return, for each opinion id, a 100–150 word summary (facts, ruling, relevance) and 3–5 keywords that appear in that opinion's text.",
  schema: Analyses,
};

export const countWords = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
const offBy = (n: number) => (n < SUMMARY_MIN_WORDS ? SUMMARY_MIN_WORDS - n : n > SUMMARY_MAX_WORDS ? n - SUMMARY_MAX_WORDS : 0);

/** Legal abbreviations that end with a period but don't end a sentence ("Smith v. Jones", "Acme Co.", "Cal. App."). */
const ABBREV = /(?:^|[\s(])(?:v|vs|Inc|Co|Corp|Ltd|LLC|No|Nos|St|Mr|Mrs|Ms|Dr|Jr|Sr|Cal|App|Cir|Ct|Supp|Dist|Div|Dept|Ass'n|Bros|Gen|Stat|Ann|Rev|Sec|Art|et al|al|e\.g|i\.e|U\.S|N\.Y|[A-Z])\.$/;

/** Abbreviation-aware sentence splitter. */
export function splitSentences(text: string): string[] {
  const pieces = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?]["')\]”]?)\s+(?=["'(“]?[A-Z0-9])/);
  const out: string[] = [];
  for (const p of pieces) {
    const prev = out.at(-1);
    if (prev && ABBREV.test(prev)) out[out.length - 1] = `${prev} ${p}`;
    else if (p) out.push(p);
  }
  return out;
}

/** Hard ceiling of 150 words: drop whole trailing sentences first; cut mid-sentence only as a last resort. */
export function clampWords(summary: string): string {
  const s = summary.replace(/\s+/g, " ").trim();
  if (countWords(s) <= SUMMARY_MAX_WORDS) return s;
  const kept: string[] = [];
  for (const sent of splitSentences(s)) {
    if (countWords([...kept, sent].join(" ")) > SUMMARY_MAX_WORDS) break;
    kept.push(sent);
  }
  const bySentence = kept.join(" ");
  if (countWords(bySentence) >= SUMMARY_MIN_WORDS) return bySentence;
  const words = s.split(" ");
  let n = 0;
  const cut: string[] = [];
  for (const w of words) {
    if (/[A-Za-z0-9]/.test(w) && ++n > SUMMARY_MAX_WORDS) break;
    cut.push(w);
  }
  return cut.join(" ").replace(/[,;:\-–—]+$/, "") + "…";
}

// ----- keyword validation: every badge must appear in that case's text -----
const normalize = (s: string) => ` ${s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9§'\s-]/g, " ").replace(/\s+/g, " ")} `;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stem = (w: string) => (w.length <= 5 ? w : w.slice(0, Math.max(5, w.length - 3)));
const GENERIC = new Set(["court", "courts", "case", "cases", "plaintiff", "plaintiffs", "defendant", "defendants", "appeal", "appellant", "appellee", "petitioner", "respondent", "trial", "judge", "opinion", "order", "state", "party", "parties", "law", "claim"]);

/** A keyword "appears" if the exact phrase does, or all its words' stems occur close together (termination ≈ terminated). */
export function appearsIn(hay: string, keyword: string): boolean {
  const k = normalize(keyword).trim();
  if (!k) return false;
  if (hay.includes(` ${k} `) || hay.includes(` ${k}`)) return true;
  const words = k.split(" ").filter((w) => w.length >= 2);
  if (!words.length) return false;
  const first = new RegExp(`\\s${esc(stem(words[0]))}`, "g");
  const rest = words.slice(1).map((w) => new RegExp(`\\s${esc(stem(w))}`));
  const span = k.length * 2 + 40;
  for (let m = first.exec(hay); m; m = first.exec(hay)) {
    const win = hay.slice(Math.max(0, m.index - span), m.index + span);
    if (rest.every((re) => re.test(win))) return true;
  }
  return false;
}

const LEGAL_TERMS = [
  "summary judgment", "motion to dismiss", "negligence", "breach of contract", "damages", "due process", "probable cause", "reasonable suspicion",
  "Fourth Amendment", "Fifth Amendment", "Sixth Amendment", "Miranda", "motion to suppress", "ineffective assistance", "sentencing", "custody",
  "best interests", "child support", "spousal support", "alimony", "visitation", "protective order", "fiduciary duty", "shareholder", "derivative",
  "securities", "fraud", "misrepresentation", "retaliation", "discrimination", "wrongful termination", "wrongful discharge", "harassment",
  "hostile work environment", "Title VII", "at-will", "whistleblower", "eviction", "lease", "security deposit", "habitability", "easement",
  "adverse possession", "quiet title", "foreclosure", "copyright", "trademark", "patent", "fair use", "infringement", "trade secret",
  "likelihood of confusion", "license suspension", "implied consent", "blood alcohol", "reckless driving", "arbitrary and capricious",
  "substantial evidence", "exhaustion", "statute of limitations", "injunction", "defamation", "qualified immunity", "hearsay", "unjust enrichment",
];

const cleanKeyword = (k: string) => k.replace(/["“”()]/g, "").replace(/\*$/, "").replace(/[?!.,;:]+$/, "").replace(/\s+/g, " ").trim();

export function finalKeywords(proposed: string[], hay: string, searchKeywords: string[], caseType: CaseType): string[] {
  const out: string[] = [];
  const add = (k: string) => {
    const c = cleanKeyword(k);
    const words = c.split(" ").length;
    if (!c || words > 4 || (words === 1 && GENERIC.has(c.toLowerCase()))) return;
    if (out.some((o) => o.toLowerCase() === c.toLowerCase())) return;
    if (appearsIn(hay, c)) out.push(c);
  };
  proposed.forEach(add);
  if (out.length < 3) searchKeywords.forEach(add);
  if (out.length < 3) {
    const pool = [...new Set([...VOCAB[caseType].map((t) => t.kw), ...DEFAULTS[caseType], ...LEGAL_TERMS])];
    const freq = (t: string) => hay.split(normalize(t).trim()).length - 1;
    pool.sort((a, b) => freq(b) - freq(a)).forEach((k) => out.length < 3 && add(k));
  }
  return out.slice(0, 5);
}

const joinList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * No-AI fallback: an honest 100–150 word summary assembled from the case metadata and the opinion's own
 * sentences (quoted), so nothing is invented.
 */
function ruleAnalysis(c: Candidate, searchKeywords: string[], req: LawSearchRequest) {
  const keywords = finalKeywords([], c.hay, searchKeywords, req.caseType);
  const all = splitSentences(c.text.replace(/\[… middle of the opinion omitted …\]/, " "))
    .map((x) => x.replace(/^[\d*\s.]+/, "").trim())
    .filter((x) => countWords(x) <= 45 && /[a-z]/.test(x));
  const sentences = all.filter((x) => countWords(x) >= 8);
  const hits = (x: string) => keywords.some((k) => appearsIn(normalize(x), k));
  const fact = sentences.slice(0, Math.max(3, Math.ceil(sentences.length * 0.4))).find(hits) ?? sentences[0];
  const ruling = all.filter((x) => countWords(x) >= 4).reverse().find((x) => x !== fact && /\b(affirm|revers|remand|vacat|dismiss|grant|denied|deny|overrul|sustain)\w*/i.test(x));
  const q = (x: string) => `“${x.replace(/[“”"]/g, "'").replace(/[.;:,]*$/, "")}.”`;

  const parts: string[] = [
    `${c.caseName} was decided by the ${c.court}${c.year ? ` in ${c.year}` : ""}${c.docketNumber ? ` (docket ${c.docketNumber})` : ""}.`,
  ];
  if (fact) parts.push(`Describing the dispute, the opinion states: ${q(fact)}`);
  if (ruling) parts.push(`On the outcome, it states: ${q(ruling)}`);
  else parts.push(c.fullText ? "The available text does not clearly state the final outcome." : "The search excerpt does not show how the court ruled.");
  parts.push(
    keywords.length
      ? `It may be relevant to your ${req.caseType.toLowerCase()} matter because the opinion discusses ${joinList(keywords.slice(0, 3))}, issues that also come up in the situation you described.`
      : `It was returned for your search on ${joinList(searchKeywords.slice(0, 3))} in ${jurisdictionLabel(req.jurisdiction)}.`,
  );
  const closing = "This summary was assembled automatically from the opinion's own sentences without AI, so read the full opinion to confirm the facts, the reasoning and how closely they match your situation.";
  let summary = [...parts, closing].join(" ");
  if (countWords(summary) > SUMMARY_MAX_WORDS) summary = parts.join(" ");
  for (const extra of sentences.filter((x) => x !== fact && x !== ruling && hits(x))) {
    if (countWords(summary) >= SUMMARY_MIN_WORDS) break;
    const next = `${summary} It also notes: ${q(extra)}`;
    if (countWords(next) <= SUMMARY_MAX_WORDS) summary = next;
  }
  return { summary: clampWords(summary), keywords };
}

type Analysis = { summary: string; keywords: string[] };

async function analyze(req: LawSearchRequest, searchKeywords: string[], cases: Candidate[], llm: LLMClient | null): Promise<{ list: Analysis[]; aiCount: number }> {
  const got = new Map<number, Analysis>();
  if (llm && cases.length) {
    const inputs: SummaryInput[] = cases.map(({ id, caseName, court, year, docketNumber, llmText, fullText }) => ({ id, caseName, court, year, docketNumber, text: llmText, fullText }));
    const ids = new Set(cases.map((c) => c.id));
    try {
      const first = await callTool(
        llm,
        SUMMARY_SYSTEM_PROMPT,
        [llm.userTurn(summaryUserPrompt(req.caseType, req.jurisdiction, forLlmPrompt(req.details), searchKeywords, inputs))],
        ANALYSIS_TOOL,
        Analyses,
        2000,
      );
      for (const a of first.data.analyses) if (ids.has(a.id)) got.set(a.id, { summary: a.summary.replace(/\s+/g, " ").trim(), keywords: a.keywords });

      // one repair turn for summaries outside 100–150 words
      const bad = [...got].map(([id, a]) => ({ id, words: countWords(a.summary), summary: a.summary })).filter((p) => offBy(p.words) > 0);
      if (bad.length) {
        try {
          const fix = await callTool(
            llm,
            SUMMARY_SYSTEM_PROMPT,
            llm.repairTurn(first.transcript, first.toolUseId, "Received.", summaryRepairPrompt(bad)),
            ANALYSIS_TOOL,
            Analyses,
            1200,
          );
          for (const a of fix.data.analyses) {
            const prev = got.get(a.id);
            const summary = a.summary.replace(/\s+/g, " ").trim();
            if (prev && offBy(countWords(summary)) < offBy(countWords(prev.summary))) got.set(a.id, { summary, keywords: a.keywords.length ? a.keywords : prev.keywords });
          }
        } catch (e) {
          console.error("[law-buddy] summary length repair failed", e);
        }
      }
    } catch (e) {
      console.error("[law-buddy] case analysis failed, using rules", e);
    }
  }
  const list = cases.map((c) => {
    const a = got.get(c.id);
    if (!a) return ruleAnalysis(c, searchKeywords, req);
    return { summary: clampWords(a.summary), keywords: finalKeywords(a.keywords, c.hay, searchKeywords, req.caseType) };
  });
  return { list, aiCount: cases.filter((c) => got.has(c.id)).length };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
/**
 * Page 1: extract keywords → search (targeted, then broader) → analyze the top 5.
 * Page N ≥ 2 ("See More Cases"): re-run the SAME query the client got on page 1 and analyze results
 * (N-1)*5 … N*5-1. No new keyword extraction, so the list stays consistent as it grows.
 */
export async function runLawSearch(req: LawSearchRequest | LawMoreRequest, page = 1): Promise<LawSearchResponse> {
  const llm = client();
  const courts = courtsFor(req.jurisdiction);
  const fallbackCourts = coreCourtsFor(req.jurisdiction);
  const offset = (page - 1) * PAGE_SIZE;

  let plan: Plan;
  let engine: "llm" | "rules";
  let query: string;
  let window: Awaited<ReturnType<typeof searchWindow>>;

  if (page > 1 && "query" in req) {
    plan = { keywords: tidyKeywords(req.keywords), booleanQuery: sanitizeQuery(req.query), broadQuery: "" };
    engine = llm ? "llm" : "rules";
    query = plan.booleanQuery;
    if (!query) throw new Error("empty query");
    window = await searchWindow(query, courts, { fallbackCourts, offset, limit: PAGE_SIZE });
  } else {
    ({ plan, engine } = await planSearch(req, llm));
    // targeted query first; widen only if nothing comes back — always inside the chosen jurisdiction
    const attempts = [plan.booleanQuery, plan.broadQuery, queryFromKeywords(plan.keywords, true)].filter((x, i, a) => x && a.indexOf(x) === i);
    query = attempts[0];
    window = { count: 0, results: [], hasMore: false };
    for (const a of attempts) {
      query = a;
      window = await searchWindow(a, courts, { fallbackCourts, offset: 0, limit: PAGE_SIZE });
      if (window.results.length) break;
    }
  }

  const candidates = await buildCandidates(window.results);
  const { list, aiCount } = await analyze(req, plan.keywords, candidates, llm);
  const results: CaseResult[] = candidates.map((c, i) => ({
    id: c.id,
    caseName: c.caseName,
    court: c.court,
    year: c.year,
    dateFiled: c.raw.dateFiled ?? null,
    citations: c.raw.citation ?? [],
    docketNumber: c.docketNumber,
    citeCount: c.raw.citeCount ?? null,
    url: opinionUrl(c.raw),
    summary: list[i].summary,
    keywords: list[i].keywords,
    fullText: c.fullText,
  }));

  const usedRules = engine === "rules" || aiCount < candidates.length;
  return {
    jurisdiction: req.jurisdiction,
    courts,
    keywords: plan.keywords,
    query,
    interpretation: plan.interpretation,
    usedBroadQuery: page === 1 && query !== plan.booleanQuery,
    totalFound: window.count,
    results,
    page,
    pageSize: PAGE_SIZE,
    hasMore: window.hasMore && page < MAX_PAGE,
    engine: usedRules ? "rules" : "llm",
    notice: !llm
      ? "AI analysis isn't configured (no GEMINI_API_KEY / OPENROUTER_API_KEY / GROQ_API_KEY), so keywords and summaries were assembled with simple rules from each opinion's own text."
      : usedRules
        ? "Some summaries were assembled with simple rules because the AI step didn't finish."
        : undefined,
  };
}
