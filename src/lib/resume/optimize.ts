/**
 * Deterministic bullet optimizer — polishes every bullet, regardless of tense or lead word.
 *
 * Used in two places:
 *  - Without an API key it is the whole optimizer (rule-based rewrite of each point).
 *  - After the LLM responds it runs as a final consistency pass (weak leads, tech casing, filler).
 *
 * What it does to each bullet (note: it no longer forces a tense change — a bullet that starts with a
 * past-tense verb like "Developed" or "Architected" is left as-is unless it matches a genuinely weak
 * phrase below):
 *  1. Weak/vague leads -> strong verbs ("Helped build" -> "Support efforts to build", "Handle" -> "Own", "Use" -> "Leverage").
 *  2. Gerund/3rd-person leads that follow a weak-lead rewrite -> present base ("Developing" -> "Develop", "Manages" -> "Manage").
 *  3. Filler removal: successfully, effectively, very, various, in order to, etc., utilize -> use.
 *  4. Numbers: "40 percent" -> "40%".
 *  5. Technology names in their official casing (javascript -> JavaScript, k8s -> Kubernetes, aws -> AWS).
 *  6. Consistent punctuation (no trailing period), capitalised first letter, duplicate bullets removed.
 */
import { ED_REPLACEMENTS, EXPLICIT_BASE, GERUNDS, IRREGULAR, gerundBase, harmonizeCoordinatedVerbs, stripBullet } from "./rules";
import type { ResumeData } from "./types";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Present-tense verbs we recognise as bullet leads (for "Manages" -> "Manage"). */
const KNOWN_VERBS = new Set(
  [
    ...Object.values(ED_REPLACEMENTS),
    ...Object.values(GERUNDS),
    ...Object.values(IRREGULAR),
    ...Object.values(EXPLICIT_BASE),
    "develop", "create", "design", "implement", "manage", "improve", "reduce", "increase", "maintain", "coordinate",
    "analyze", "configure", "document", "establish", "ensure", "execute", "facilitate", "generate", "identify",
    "integrate", "migrate", "monitor", "provide", "resolve", "review", "test", "train", "write", "handle", "use",
  ].map((v) => v.toLowerCase().split(" ")[0]),
);

/**
 * Weak or vague leads replaced with stronger, still-truthful verbs — matched in both present and
 * past tense (e.g. "worked on" as well as "work on"), since the weakness is the vague phrase itself,
 * not which tense it happens to be in. This is about substance, not word-shape: unlike the retired
 * "-ed" rule, a bullet is never touched here just because of how its first word ends.
 */
const WEAK_LEADS: [RegExp, string | ((m: RegExpMatchArray) => string)][] = [
  // "Worked on migrating…", "Was responsible for building…", "Assisted with testing…" -> the base verb of
  // the gerund ("Migrate…", "Build…", "Test…") — checked first so the more specific, still-truthful verb
  // wins over the generic fallbacks below.
  [
    /^(?:worked|working|was tasked|tasked|was involved|involved|assisted|participated|(?:was |were )?responsible|(?:was |were )?accountable) (?:on|in|with|for) (\w+ing)\b/i,
    (m) => gerundBase(m[1]),
  ],
  [/^help(?:ed|s|ing)? (?:to )?(\w+)\b/i, (m) => `Support efforts to ${m[1].toLowerCase()}`],
  [/^(?:do|does|doing|did)\b/i, "Execute"],
  [/^(?:make|makes|making|made) changes to\b/i, "Update"],
  [/^(?:handle|handles|handling|handled)\b/i, "Own"],
  [/^(?:use|uses|using|used)\b/i, "Leverage"],
  [/^(?:work|works|working|worked) (?:closely )?with\b/i, "Partner with"],
  [/^(?:work|works|working|worked) on\b/i, "Drive"],
  [/^(?:was |were )?(?:responsible|accountable) for\b/i, "Own"],
  [/^(?:was |were )?(?:involved|participate|participates|participating|participated) in\b/i, "Contribute to"],
  [/^(?:was |were )?tasked with\b/i, "Own"],
  [/^(?:assist|assists|assisting|assisted) (?:in|with)\b/i, "Support"],
];

/** Filler that adds words but no information. */
const FILLER: [RegExp, string][] = [
  [/\b(?:successfully|effectively|efficiently|actively|really|very|extremely|highly)\s+/gi, ""],
  [/\bin order to\b/gi, "to"],
  [/\butiliz(?:e|es|ing|ed)\b/gi, "use"],
  [/\butilization\b/gi, "use"],
  [/\b(?:a (?:large |wide )?(?:number|variety) of|several different|various)\b/gi, "multiple"],
  [/,?\s*\b(?:etc\.?|and so on|and more)(?=[\s,.;]|$)/gi, ""],
  [/\bon a daily basis\b/gi, "daily"],
  [/\bon a weekly basis\b/gi, "weekly"],
  [/\bwith the help of\b/gi, "with"],
  [/\bin the process of\b/gi, ""],
  [/(\d)\s*(?:percent|per cent|pct)\b/gi, "$1%"],
];

/** Official casing for common technologies (matched case-insensitively on word boundaries). */
const TECH_CASING: Record<string, string> = {
  javascript: "JavaScript", typescript: "TypeScript", "node.js": "Node.js", nodejs: "Node.js", "node js": "Node.js",
  reactjs: "React", "react.js": "React", nextjs: "Next.js", "next.js": "Next.js", vuejs: "Vue.js", angularjs: "AngularJS",
  aws: "AWS", gcp: "GCP", azure: "Azure", k8s: "Kubernetes", kubernetes: "Kubernetes", docker: "Docker",
  postgres: "PostgreSQL", postgresql: "PostgreSQL", mysql: "MySQL", mongodb: "MongoDB", mongo: "MongoDB", redis: "Redis",
  graphql: "GraphQL", "rest api": "REST API", "rest apis": "REST APIs", api: "API", apis: "APIs", sql: "SQL", nosql: "NoSQL",
  "ci/cd": "CI/CD", cicd: "CI/CD", github: "GitHub", gitlab: "GitLab", jenkins: "Jenkins", terraform: "Terraform",
  python: "Python", java: "Java", "spring boot": "Spring Boot", springboot: "Spring Boot", django: "Django", fastapi: "FastAPI",
  flask: "Flask", kafka: "Kafka", "apache kafka": "Apache Kafka", "apache spark": "Apache Spark", pyspark: "PySpark", snowflake: "Snowflake",
  react: "React", angular: "Angular", vue: "Vue", opentelemetry: "OpenTelemetry", "github actions": "GitHub Actions",
  prometheus: "Prometheus", grafana: "Grafana", elasticsearch: "Elasticsearch", ansible: "Ansible", helm: "Helm",
  rabbitmq: "RabbitMQ", dynamodb: "DynamoDB", bigquery: "BigQuery", airflow: "Airflow", numpy: "NumPy",
  tensorflow: "TensorFlow", pytorch: "PyTorch", kotlin: "Kotlin", openai: "OpenAI", langchain: "LangChain",
  jira: "Jira", confluence: "Confluence", html: "HTML", html5: "HTML5", css: "CSS", css3: "CSS3", sass: "Sass",
  tailwind: "Tailwind", "tailwind css": "Tailwind CSS", jquery: "jQuery", json: "JSON", xml: "XML", yaml: "YAML",
  linux: "Linux", git: "Git", oauth: "OAuth", jwt: "JWT", saas: "SaaS", ml: "ML", ai: "AI", llm: "LLM", llms: "LLMs",
  "c#": "C#", ".net": ".NET", dotnet: ".NET", golang: "Go", tableau: "Tableau", "power bi": "Power BI", powerbi: "Power BI",
  salesforce: "Salesforce", sap: "SAP", ios: "iOS", android: "Android", figma: "Figma", selenium: "Selenium", cypress: "Cypress",
  pytest: "pytest", junit: "JUnit", s3: "S3", ec2: "EC2", ecs: "ECS", eks: "EKS", rds: "RDS", lambda: "Lambda",
};
const TECH_RE = new RegExp(
  `(?<![\\w.#/-])(${Object.keys(TECH_CASING)
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\/#]/g, "\\$&"))
    .join("|")})(?![\\w#/-]|\\.\\w)`,
  "gi",
);

export function fixTechCasing(text: string): string {
  return text.replace(TECH_RE, (m) => TECH_CASING[m.toLowerCase()] ?? m);
}

/**
 * Swap genuinely weak/vague leads for a stronger verb (WEAK_LEADS), and normalize a gerund or
 * 3rd-person lead to its base form ("Developing" -> "Develop", "Manages" -> "Manage") — these aren't
 * past-tense forms, so normalizing them isn't the kind of tense-forcing the retired "-ed" rule did.
 * A bullet that already leads with a plain past-tense verb, regular or irregular ("Developed", "Led",
 * "Built", "Wrote"), is left exactly as written: tense is the writer's choice, not something this
 * function corrects.
 */
function normalizeLead(text: string): string {
  for (const [re, to] of WEAK_LEADS) {
    const m = text.match(re);
    if (m) return (typeof to === "string" ? to : to(m)) + text.slice(m[0].length);
  }
  const m = text.match(/^([A-Za-z]+)\b/);
  if (!m) return text;
  const w = m[1].toLowerCase();
  let base: string | null = null;
  if (w.endsWith("ing") && w.length > 5 && (GERUNDS[w] || KNOWN_VERBS.has(gerundBase(w).toLowerCase())))
    base = gerundBase(w); // Developing -> Develop
  else if (/[^s]s$/.test(w) && w.length > 3) {
    const cands = w.endsWith("ies") ? [w.slice(0, -3) + "y"] : w.endsWith("es") ? [w.slice(0, -2), w.slice(0, -1)] : [w.slice(0, -1)];
    base = cands.find((c) => KNOWN_VERBS.has(c)) ?? null; // Manages -> Manage, Builds -> Build
  }
  return base ? cap(base) + text.slice(m[1].length) : text;
}

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();

export function optimizeBullet(raw: string): string {
  let b = stripBullet(raw).replace(/\s+/g, " ").trim();
  if (!b) return b;
  const before = b;
  b = normalizeLead(b);
  if (b !== before) b = harmonizeCoordinatedVerbs(b); // "Write runbooks and trained…" -> "…and train…"
  for (const [re, to] of FILLER) b = b.replace(re, to);
  b = fixTechCasing(b)
    .replace(/\s+([,;:.%])/g, "$1")
    .replace(/(\d) %/g, "$1%")
    .replace(/\s{2,}/g, " ")
    .replace(/[.;,\s]+$/, "")
    .trim();
  // a gerund left right after "to" by the weak-lead rules ("to developing") -> base form
  b = b.replace(/\bto (\w+ing)\b/g, (full, g: string) => (GERUNDS[g.toLowerCase()] ? `to ${GERUNDS[g.toLowerCase()].toLowerCase()}` : full));
  return cap(b);
}

function optimizeSummary(s: string): string {
  let out = s.replace(/\s+/g, " ").trim();
  out = out.replace(/^(?:i am|i'm)\s+(?:an?\s+)?/i, "");
  for (const [re, to] of FILLER) out = out.replace(re, to);
  out = fixTechCasing(out).replace(/\s+([,;:.%])/g, "$1").replace(/\s{2,}/g, " ").trim();
  return out ? cap(out) : out;
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((b) => {
    const k = normKey(b);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Polish every bullet, the summary and skill names. Returns how many bullets changed. */
export function optimizeResume(r: ResumeData): { resume: ResumeData; changed: number } {
  let changed = 0;
  const run = (bullets: string[]) =>
    dedupe(
      bullets
        .filter((b) => b.trim())
        .map((b) => {
          const o = optimizeBullet(b);
          if (normKey(o) !== normKey(b)) changed++;
          return o;
        }),
    );
  const resume: ResumeData = {
    ...r,
    summary: optimizeSummary(r.summary),
    experience: r.experience.map((e) => ({ ...e, bullets: run(e.bullets) })),
    projects: r.projects.map((p) => ({ ...p, tech: fixTechCasing(p.tech), bullets: run(p.bullets) })),
    skills: r.skills.map((g) => ({
      ...g,
      items: g.items
        .map((i) => fixTechCasing(i.trim()))
        .filter((i, idx, arr) => i && arr.findIndex((x) => x.toLowerCase() === i.toLowerCase()) === idx),
    })),
  };
  return { resume, changed };
}

/**
 * Bullets the LLM returned verbatim (or with only the first word changed) from the source.
 * The user wants every point optimized, so these are sent back for a real rewrite.
 */
export function findUnoptimized(source: ResumeData, output: ResumeData): string[] {
  const src = [...source.experience.flatMap((e) => e.bullets), ...source.projects.flatMap((p) => p.bullets)]
    .map(normKey)
    .filter((k) => k.split(" ").length >= 4);
  const whole = new Set(src);
  const tails = new Set(src.map((k) => k.replace(/^\S+\s*/, "")));
  const out = [...output.experience.flatMap((e) => e.bullets), ...output.projects.flatMap((p) => p.bullets)];
  return out.filter((b) => {
    const k = normKey(b);
    return whole.has(k) || tails.has(k.replace(/^\S+\s*/, ""));
  });
}

/**
 * Generic, low-effort openers that describe an action with no project context — the actual thing the
 * writing standard targets now that the "-ed" rule is gone (see rules.ts). Matched against the whole
 * bullet, not just the first word, since the giveaway is usually the vague object ("a web app", "the
 * project") rather than the verb.
 */
const GENERIC_PATTERNS: RegExp[] = [
  /^(built|create[d]?|developed|designed|made|wrote) (a|an|the)\s+(web\s?app(lication)?|website|application|app|system|tool|project|feature|script)\b(?!.{15,})/i,
  /^worked on\b(?!.{20,})/i,
  /^help(?:ed|s|ing)? (?:with|to)\b(?!.{20,})/i,
  /^(?:was |were )?responsible for\b(?!.{20,})/i,
  /^(?:was |were )?involved in\b(?!.{20,})/i,
  /^(?:participated|assisted) in\b(?!.{20,})/i,
];

/** Does this bullet mention a specific, named technology, or at least a number/metric? */
function hasSpecificDetail(text: string): boolean {
  return TECH_RE.test(text) || /\d/.test(text);
}

/**
 * Bullets that are too generic to keep as-is: either they match a well-known low-effort pattern
 * ("Developed a web app"), or they never name a specific technology, system or metric at all. Sent
 * back for a rewrite that adds the missing project context, tech and impact — see buildRepairPrompt.
 */
export function findGenericBullets(output: ResumeData): string[] {
  const out = [...output.experience.flatMap((e) => e.bullets), ...output.projects.flatMap((p) => p.bullets)].filter((b) => b.trim());
  return out.filter((b) => GENERIC_PATTERNS.some((re) => re.test(stripBullet(b))) || (!hasSpecificDetail(b) && stripBullet(b).split(" ").length <= 14));
}
