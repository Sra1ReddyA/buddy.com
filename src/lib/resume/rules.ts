/**
 * Resume Buddy's default writing rule.
 *
 * Earlier versions of this rule banned bullets from starting with a past-tense "-ed" word
 * ("developed", "implemented", …). That was only ever meant as an example of generic, low-effort
 * phrasing — not a literal grammar restriction — and enforcing it as a hard, mechanical rule caused
 * arbitrary rewrites that sometimes damaged perfectly good sentences. It has been retired.
 *
 * The actual goal is: every bullet is project-focused, names the specific technologies involved, gives
 * the context of the problem being solved, and states a quantifiable (or at least concrete) impact —
 * and every bullet is grammatically flawless. Tense (past or present) is a style choice, not a rule.
 *
 * It's enforced in layers:
 *   1. The system prompt states the standard directly — see DEFAULT_RULE_TEXT.
 *   2. findUnoptimized() (in optimize.ts) catches bullets the LLM returned verbatim (or with only the
 *      first word changed) from the source; those get sent back for a real rewrite.
 *   3. optimizeResume() (in optimize.ts) is a deterministic polish pass — weak-lead phrasing, filler,
 *      technology casing, coordinated-verb tense agreement — applied both as the no-API-key fallback and
 *      as a final consistency pass after the LLM responds. It no longer touches tense on its own.
 */
export const DEFAULT_RULE_ID = "project-focused-specificity";

export const DEFAULT_RULE_TEXT = `DEFAULT WRITING STANDARD — "Project-focused and specific, not generic":
- The goal is eliminating generic, low-effort bullet points — NOT filtering for or against any particular word or tense. A bullet that starts with a past-tense verb ("Developed", "Architected", "Implemented", "Led") is completely fine when the sentence itself is specific and well-constructed. Never delete or swap a word purely because of how it ends; rewrite for substance, not surface pattern-matching.
- Every bullet must be PROJECT-FOCUSED and SPECIFIC:
  - Name the actual technologies, frameworks, tools and versions involved, not vague categories ("a web app" -> "a Next.js web application"; "a database" -> "a PostgreSQL database").
  - Give the context: what problem or need the project addressed.
  - State the outcome or impact, quantified whenever the source implies scale — a percentage, a count, a time saved, a team size. If no metric exists, describe the concrete outcome qualitatively; never invent a number.
  - Example: "Developed a web app" is too generic to keep as-is. Rewrite it to something like "Architected a scalable Next.js web application to streamline user onboarding" — same past-tense lead is fine, but now it names the tech, the approach and the purpose.
- GRAMMATICAL EXCELLENCE, above all: every bullet must read as one natural, correctly constructed sentence — subject-verb agreement, consistent tense within the sentence, parallel structure across coordinated verbs ("Architect, build and deploy…", not "Architect, built and deploying…"), and no dangling clauses. A sentence must never be left broken or half-rewritten for the sake of changing a word.
- Preserve every fact from the source: technologies and versions, system names, numbers, percentages, team sizes, scope. Do not invent anything.
- Cut filler ("successfully", "various", "responsible for", "helped to") in favor of a direct, active statement of what was done and why it mattered.`;

const BULLET_PREFIX = /^[\s•\-–—*·▪◦►]+/;

export function stripBullet(text: string) {
  return text.replace(BULLET_PREFIX, "").trim();
}

/** Regular -ed verbs whose base form the suffix rules below would get wrong. */
export const EXPLICIT_BASE: Record<string, string> = {
  mentored: "mentor", monitored: "monitor", authored: "author", tailored: "tailor", sponsored: "sponsor",
  anchored: "anchor", partnered: "partner", delivered: "deliver", engineered: "engineer", pioneered: "pioneer",
  volunteered: "volunteer", powered: "power", answered: "answer", covered: "cover", discovered: "discover",
  ordered: "order", centered: "center", filtered: "filter", rendered: "render", clustered: "cluster",
  registered: "register", triggered: "trigger", offered: "offer", entered: "enter", cleared: "clear",
  paired: "pair", repaired: "repair", geared: "gear", steered: "steer", explored: "explore", restored: "restore",
  stored: "store", scored: "score", ignored: "ignore", compared: "compare", prepared: "prepare", declared: "declare",
  hosted: "host", focused: "focus", piloted: "pilot", pivoted: "pivot", tuned: "tune", quoted: "quote", voted: "vote",
  noted: "note", promoted: "promote", devoted: "devote", profiled: "profile", compiled: "compile", reconciled: "reconcile",
  detailed: "detail", emailed: "email", tooled: "tool", pooled: "pool", processed: "process", accessed: "access", addressed: "address",
};

/** Strong present-tense forms for the most common resume verbs (used for coordination and casing, not forced rewrites). */
export const ED_REPLACEMENTS: Record<string, string> = {
  developed: "Build", implemented: "Deliver", created: "Build", managed: "Lead", designed: "Architect",
  led: "Lead", fed: "Feed", improved: "Boost", reduced: "Cut", increased: "Grow", decreased: "Cut",
  automated: "Automate", collaborated: "Partner", worked: "Drive", utilized: "Leverage", used: "Leverage",
  handled: "Own", supported: "Support", maintained: "Maintain", established: "Establish", launched: "Launch",
  migrated: "Migrate", optimized: "Optimize", optimised: "Optimize", streamlined: "Streamline",
  coordinated: "Orchestrate", orchestrated: "Orchestrate", engineered: "Engineer", architected: "Architect",
  delivered: "Deliver", deployed: "Deploy", integrated: "Integrate", configured: "Configure",
  analyzed: "Analyze", analysed: "Analyze", tested: "Test", resolved: "Resolve", troubleshooted: "Troubleshoot",
  mentored: "Mentor", trained: "Train", spearheaded: "Spearhead", partnered: "Partner", owned: "Own",
  directed: "Direct", supervised: "Lead", oversaw: "Oversee", produced: "Produce", generated: "Generate",
  modernized: "Modernize", refactored: "Refactor", enhanced: "Enhance", accelerated: "Accelerate",
  secured: "Secure", documented: "Document", researched: "Research", presented: "Present",
  negotiated: "Negotiate", facilitated: "Facilitate", achieved: "Achieve", ensured: "Ensure",
  assisted: "Support", participated: "Contribute to", contributed: "Contribute", involved: "Drive",
  performed: "Execute", executed: "Execute", monitored: "Monitor", scaled: "Scale", shipped: "Ship",
  planned: "Plan", conducted: "Run", initiated: "Initiate", introduced: "Introduce", transformed: "Transform",
  consolidated: "Consolidate", standardized: "Standardize", revamped: "Revamp", redesigned: "Redesign",
  converted: "Convert", published: "Publish", authored: "Author", reviewed: "Review",
  prepared: "Prepare", provided: "Provide", served: "Serve", saved: "Save", identified: "Identify",
  evaluated: "Evaluate", defined: "Define", drove: "Drive", championed: "Champion", pioneered: "Pioneer",
  customized: "Customize", hired: "Hire", recruited: "Recruit", coached: "Coach", guided: "Guide", interviewed: "Interview", onboarded: "Onboard", coded: "Code", scoped: "Scope", hosted: "Host", wrote: "Write", upgraded: "Upgrade", validated: "Validate", processed: "Process",
};

export function lemmatize(word: string): string {
  const w = word.toLowerCase();
  if (EXPLICIT_BASE[w]) return EXPLICIT_BASE[w];
  if (w.endsWith("ied")) return w.slice(0, -3) + "y"; // applied -> apply
  const stem = w.slice(0, -2);
  const last = stem.at(-1) ?? "";
  const prev = stem.at(-2) ?? "";
  // doubled consonant: planned -> plan, committed -> commit (but keep install, process, staff)
  if (last === prev && /[bcdgkmnprtv]/.test(last)) return stem.slice(0, -1);
  // -ain / -oin / -ein stems never take a silent e: trained -> train, joined -> join
  if (/(ain|oin|ein|ean|een)$/.test(stem)) return stem;
  // silent-e stems: created -> create, managed -> manage, improved -> improve
  if (/(at|iz|is|ur|uc|ag|ov|iv|lv|rv|rg|ng|bl|pl|tl|ul|ir|ar|or|as|os|ns|rs|ps|od|um|in|ut)$/.test(stem)) {
    return stem + "e";
  }
  return stem;
}

/** Irregular past forms that may appear in a coordinated verb list ("Designed, built and shipped"). */
export const IRREGULAR: Record<string, string> = {
  built: "build", led: "lead", wrote: "write", drove: "drive", ran: "run", grew: "grow", made: "make", took: "take",
  won: "win", began: "begin", brought: "bring", taught: "teach", sold: "sell", oversaw: "oversee", undertook: "undertake",
};

/** Gerund -> base form for phrases like "Worked on building X" -> "Build X". */
export const GERUNDS: Record<string, string> = {
  building: "Build", developing: "Build", creating: "Build", designing: "Design", implementing: "Implement",
  migrating: "Migrate", improving: "Improve", automating: "Automate", maintaining: "Maintain", integrating: "Integrate",
  testing: "Test", deploying: "Deploy", optimizing: "Optimize", supporting: "Support", writing: "Write",
  managing: "Manage", leading: "Lead", refactoring: "Refactor", modernizing: "Modernize", configuring: "Configure",
  analyzing: "Analyze", troubleshooting: "Troubleshoot", monitoring: "Monitor", scaling: "Scale", securing: "Secure",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "migrating" -> "Migrate", "planning" -> "Plan", "creating" -> "Create" */
export function gerundBase(g: string): string {
  const w = g.toLowerCase();
  return GERUNDS[w] ?? cap(lemmatize(w.slice(0, -3) + "ed"));
}

/** Base form of an -ed/irregular verb, only when we're confident it is a verb we know. */
function knownBase(word: string): string | null {
  const w = word.toLowerCase();
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (ED_REPLACEMENTS[w] && w.endsWith("ed")) return lemmatize(w);
  return null;
}

/**
 * Keep verbs coordinated with the lead verb in the same tense — pure grammatical agreement, independent
 * of which tense the bullet happens to use:
 *   "Architect, tested and deployed X"      -> "Architect, test and deploy X"
 *   "Developed X and deploys it to EKS"     -> "Developed X and deployed it to EKS"
 * but leave subordinate clauses alone:
 *   "Build X that reduced latency and improved uptime"  (unchanged after "that")
 */
export function harmonizeCoordinatedVerbs(text: string): string {
  const words = text.split(" ");
  const SUBORDINATE = /^(that|which|who|whose|by|while|after|when|where|because|resulting|leading|so)$/i;
  let inLeadClause = true;
  for (let i = 1; i < words.length && inLeadClause; i++) {
    const raw = words[i];
    const w = raw.replace(/[^A-Za-z]/g, "");
    if (SUBORDINATE.test(w)) {
      inLeadClause = false;
      break;
    }
    const prev = words[i - 1];
    const coordinated = /^(and|&|or)$/i.test(prev) || /,$/.test(prev) || (i === 1 && false);
    if (!coordinated) continue;
    const base = knownBase(w);
    if (base) words[i] = raw.replace(w, base);
  }
  return words.join(" ");
}

/**
 * Combine the default writing standard with the user's custom rules.
 * User rules are treated as preferences and can never disable the default standard.
 */
export function buildRuleSet(customRules: string): string {
  const user = customRules
    .split(/\r?\n/)
    .map((l) => stripBullet(l))
    .filter(Boolean)
    .slice(0, 25)
    .map((l, i) => `${i + 1}. ${l}`)
    .join("\n");

  return [
    DEFAULT_RULE_TEXT,
    "",
    "USER RULES (apply all of these unless they conflict with the default standard above):",
    user || "(none provided — use a confident, concise, professional tone)",
  ].join("\n");
}
