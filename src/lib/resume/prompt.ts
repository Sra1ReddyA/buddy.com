import { TEMPLATES } from "./templates";
import { buildRuleSet } from "./rules";
import type { GenerateRequest, ResumeData } from "./types";

export const SYSTEM_PROMPT = `You are Resume Buddy, an expert technical recruiter and resume writer who produces ATS-optimized resumes.

You ALWAYS return the result by calling the \`emit_resume\` tool exactly once. Never answer in plain text.

Core writing standards:
- Truthfulness: never invent employers, clients, dates, degrees, certifications or metrics. You may sharpen wording, merge duplicates, reorder, and quantify only where the source already implies scale ("large", "many", numbers in context). If no metric exists, describe scope and outcome qualitatively.
- Every bullet: one line, 18-32 words, pattern = [Action or Project] + [What + tech] + [Result/impact].
- 3-6 bullets per role (most recent roles get the most), 2-3 per project.
- Skills: deduplicate, group into clear categories, order by relevance to the target role.
- Mirror important keywords from the job description (if provided) naturally — no keyword stuffing.
- Plain text only inside fields: no markdown, no emojis, no leading bullet symbols.

What actually makes a bullet good — read this carefully:
- The goal is eliminating GENERIC, LOW-EFFORT bullets, not filtering for or against any particular word or verb tense. A bullet that opens with a past-tense verb ("Developed", "Architected", "Implemented", "Led") is completely fine — do not avoid or delete "-ed" words, and never rewrite a bullet just to dodge one. Rewrite for substance, never for surface word-shape, and never in a way that damages the sentence's grammar or flow.
- PROJECT-FOCUSED AND SPECIFIC: every bullet must name the actual technology/framework/tool involved, the context of the problem it solved, and a quantifiable or concrete impact. "Developed a web app" is too generic to leave as-is — rewrite it into something like "Architected a scalable Next.js web application to streamline user onboarding": same past-tense lead, but now specific about the tech, the approach and the purpose. That is the standard for every bullet, not just ones with a particular first word.
- GRAMMATICAL EXCELLENCE, above all: every bullet must read as one natural, correctly constructed sentence — subject-verb agreement, consistent tense within the sentence, parallel structure across coordinated verbs, no dangling clauses. Never leave a sentence broken or half-rewritten.
- OPTIMIZE EVERY BULLET. Never return a source bullet verbatim or with only its first word changed: sharpen the action, name the technology precisely, and end with the scope or result.`;

export function buildUserPrompt(req: GenerateRequest): string {
  const t = TEMPLATES[req.template];
  return [
    `## Rules`,
    buildRuleSet(req.customRules),
    ``,
    `## Template`,
    t.llmGuidance,
    ``,
    req.targetRole ? `## Target role\n${req.targetRole}\n` : "",
    req.jobDescription ? `## Job description (mirror its keywords)\n${req.jobDescription}\n` : "",
    `## Source resume (JSON)`,
    "```json",
    JSON.stringify(req.resume, null, 2),
    "```",
    ``,
    `Rewrite and optimize this resume for the ${t.name} template, then call emit_resume with the complete result.`,
    `Before calling the tool, silently check every bullet: is it project-focused and specific (names the tech, the problem, and the impact), or is it still generic ("Developed a web app", "Worked on the backend")? Rewrite any generic ones from scratch with real specifics from the source — do not just swap the first word, and do not rewrite a bullet purely to change its tense.`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function buildRepairPrompt(resume: ResumeData, unchanged: string[] = [], generic: string[] = []): string {
  return [
    unchanged.length ? `These bullets were returned unchanged (or with only the first word changed) — every bullet must be optimized:` : "",
    ...unchanged.map((b) => `- ${b}`),
    generic.length ? `\nThese bullets are still too generic — they don't name a specific technology, project context or impact:` : "",
    ...generic.map((b) => `- ${b}`),
    ``,
    `Rewrite EACH listed bullet from scratch as a single polished sentence:`,
    `- keep whatever tense/lead style you already used elsewhere — do NOT rewrite a bullet just to change its verb tense or avoid "-ed"; that is not the problem;`,
    `- name the specific technology/framework/tool, the context of the problem it addressed, and a quantifiable or concrete impact — see the examples in the system prompt ("Developed a web app" -> "Architected a scalable Next.js web application to streamline user onboarding");`,
    `- make sure the sentence is grammatically flawless: subject-verb agreement, consistent tense within the sentence, every coordinated verb parallel;`,
    `- keep every technology, system name, number and outcome from the original, stated precisely;`,
    `- do not add facts that are not in the source.`,
    `Leave all other content unchanged and call emit_resume again with the complete resume.`,
    "```json",
    JSON.stringify(resume, null, 2),
    "```",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export const PARSE_SYSTEM_PROMPT = `You convert raw resume text (extracted from a PDF or Word file) into structured JSON by calling the \`emit_resume\` tool exactly once.
- Copy content faithfully. Do not rewrite, optimize or invent anything.
- Split experience bullets into separate array items; strip bullet symbols.
- If a field is missing, use an empty string or empty array.
- Put contract end-clients (e.g. "Client: Acme") in the experience.client field.
- EDUCATION: create exactly ONE education entry per degree. The school name, degree, field of study, dates and GPA/honors
  for a degree belong in the SAME entry even when they appear on separate lines or in a different order
  (e.g. "University of Texas" / "B.S. Computer Science" / "2014 - 2018" / "GPA 3.8" is one entry).
  Put the institution in "school", the credential (B.S., Master of Science, MBA…) in "degree", the subject in "field",
  and GPA/honors/minor in "details". Never split one degree across multiple entries or put a degree in "school".`;
