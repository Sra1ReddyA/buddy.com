import "server-only";
import { getLLMClient, type LLMClient, type LLMTool, type LLMTurn } from "../llm/client";
import { SYSTEM_PROMPT, PARSE_SYSTEM_PROMPT, buildRepairPrompt, buildUserPrompt } from "./prompt";
import { stripBullet } from "./rules";
import { ResumeSchema, emptyResume, type Education, type GenerateRequest, type ResumeData } from "./types";
import { mergeEducation, parseEducationLine } from "./education";
import { findGenericBullets, findUnoptimized, optimizeResume } from "./optimize";

export type GenerateResult = {
  resume: ResumeData;
  source: "llm" | "rules";
  model?: string;
  /** How many bullets had to be repaired after the model responded */
  repairedBullets: number;
  notice?: string;
};

const EMIT_TOOL: LLMTool = {
  name: "emit_resume",
  description: "Return the complete resume as structured data.",
  schema: ResumeSchema,
};

function client(): LLMClient | null {
  return getLLMClient();
}

async function callEmitResume(
  llm: LLMClient,
  system: string,
  messages: LLMTurn[],
): Promise<{ resume: ResumeData; transcript: LLMTurn[]; toolUseId: string }> {
  const { data, transcript, toolUseId } = await llm.callTool(system, messages, EMIT_TOOL, ResumeSchema, 8000, 0.4);
  return { resume: data, transcript, toolUseId };
}

/**
 * Optimize a resume with the LLM.
 * Flow: generate -> check (bullets returned unchanged, bullets still too generic) -> up to two repair
 * turns -> deterministic polish. Every bullet is optimized for project-specific detail and grammar —
 * tense/word choice ("-ed" or otherwise) is never forced.
 */
export async function generateOptimizedResume(req: GenerateRequest): Promise<GenerateResult> {
  const llm = client();
  if (!llm) {
    const { resume, changed } = optimizeResume(req.resume);
    return {
      resume: { ...resume, education: mergeEducation(resume.education) },
      source: "rules",
      repairedBullets: changed,
      notice:
        "Rule-based optimizer used (no GEMINI_API_KEY / OPENROUTER_API_KEY / GROQ_API_KEY): every bullet was polished for weak phrasing, filler and tech names. Add an API key for a full AI rewrite of each point with project-specific detail, keyword matching and your custom rules.",
    };
  }

  let messages: LLMTurn[] = [llm.userTurn(buildUserPrompt(req))];
  let { resume, transcript, toolUseId } = await callEmitResume(llm, SYSTEM_PROMPT, messages);
  messages = transcript;
  let repaired = 0;

  // Up to two targeted repair turns: bullets returned unchanged from the source, and bullets that are
  // still too generic (no specific tech, project context or impact) — not tense or word-choice.
  for (let attempt = 0; attempt < 2; attempt++) {
    const unchanged = findUnoptimized(req.resume, resume);
    const generic = findGenericBullets(resume).filter((b) => !unchanged.includes(b));
    if (!unchanged.length && !generic.length) break;
    repaired += unchanged.length + generic.length;
    messages = llm.repairTurn(messages, toolUseId, "Rejected — see below.", buildRepairPrompt(resume, unchanged, generic));
    try {
      ({ resume, transcript, toolUseId } = await callEmitResume(llm, SYSTEM_PROMPT, messages));
      messages = transcript;
    } catch {
      break; // fall through to deterministic polish
    }
  }

  // Final consistency polish: weak leads, tech casing, filler — no forced tense/word rewrites.
  const final = optimizeResume(resume).resume;
  return { resume: { ...final, education: mergeEducation(final.education) }, source: "llm", model: llm.model, repairedBullets: repaired };
}

/** Turn raw text from an uploaded resume into structured data (LLM when available, heuristics otherwise). */
export async function structureResumeText(text: string): Promise<{ resume: ResumeData; source: "llm" | "heuristic" }> {
  const llm = client();
  if (llm) {
    try {
      const { resume } = await callEmitResume(llm, PARSE_SYSTEM_PROMPT, [llm.userTurn(`Resume text:\n"""\n${text.slice(0, 30000)}\n"""`)]);
      return { resume: { ...resume, education: mergeEducation(resume.education) }, source: "llm" };
    } catch {
      /* fall back to heuristics */
    }
  }
  return { resume: heuristicParse(text), source: "heuristic" };
}

// ---------------------------------------------------------------------------
// Heuristic parser — good enough to pre-fill the form without an API key.
// ---------------------------------------------------------------------------
const HEADINGS: Record<string, keyof ResumeData | "skip"> = {
  summary: "summary", "professional summary": "summary", profile: "summary", objective: "summary", about: "summary",
  experience: "experience", "work experience": "experience", "professional experience": "experience",
  employment: "experience", "project experience": "experience", "client engagements": "experience",
  education: "education", skills: "skills", "technical skills": "skills", "core competencies": "skills",
  projects: "projects", "key projects": "projects", certifications: "certifications", certificates: "certifications",
};

const DATE_RANGE = /((?:[A-Z][a-z]{2,8}\.?\s)?\d{4})\s*(?:[-–—]|to)\s*((?:[A-Z][a-z]{2,8}\.?\s)?\d{4}|Present|Current)/i;

export function heuristicParse(text: string): ResumeData {
  const r = emptyResume();
  r.experience = [];
  r.education = [];
  r.skills = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return r;

  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const phone = text.match(/(\+?\(?\d[\d\s().-]{8,}\d)/);
  const linkedin = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s|,]+/i);
  r.contact.fullName = lines[0].slice(0, 120);
  r.contact.email = email?.[0] ?? "";
  r.contact.phone = phone?.[0]?.trim() ?? "";
  r.contact.linkedin = linkedin?.[0] ?? "";
  if (lines[1] && !/@|\d{3}/.test(lines[1])) r.contact.title = lines[1].slice(0, 160);

  let section: keyof ResumeData | "skip" | null = null;
  const eduLines: Education[] = [];
  const summary: string[] = [];
  for (const line of lines.slice(1)) {
    const key = line.toLowerCase().replace(/[:\s]+$/, "");
    if (HEADINGS[key] && line.length < 40) {
      section = HEADINGS[key];
      continue;
    }
    const isBullet = /^[•\-–*·▪◦►]/.test(line);
    switch (section) {
      case "summary":
        summary.push(line);
        break;
      case "experience": {
        const cur = r.experience.at(-1);
        const dates = line.match(DATE_RANGE);
        const looksLikeHeader = !!dates || (/\s[|@]\s|\sat\s/.test(line) && line.length < 90 && !/[.;]$/.test(line));
        if (!isBullet && looksLikeHeader) {
          const head = line.replace(dates?.[0] ?? "", "").trim().replace(/[|,–—-]\s*$/, "").trim();
          const [role, company] = head.split(/\s+[|@]\s+|\s+at\s+/);
          r.experience.push({ role: (role ?? "").trim(), company: (company ?? "").trim(), location: "", startDate: dates?.[1] ?? "", endDate: dates?.[2] ?? "", client: "", bullets: [] });
        } else if (cur && /^client\s*:/i.test(line)) {
          const [client, loc] = line.replace(/^client\s*:\s*/i, "").split(/\s[·|]\s/);
          cur.client = client.trim();
          if (loc) cur.location = loc.trim();
        } else if (cur && !cur.bullets.length && !isBullet && line.length < 40 && /,\s*[A-Z]{2}\b|remote|hybrid/i.test(line)) {
          cur.location = line;
        } else if (cur) {
          const text = stripBullet(line);
          const prev = cur.bullets.at(-1);
          // wrapped line from PDF extraction: glue onto the previous bullet
          if (!isBullet && prev && !/[.!?]$/.test(prev) && /^[a-z0-9(%]/.test(text)) cur.bullets[cur.bullets.length - 1] = `${prev} ${text}`;
          else cur.bullets.push(text);
        } else {
          r.experience.push({ company: "", role: "", location: "", startDate: "", endDate: "", client: "", bullets: [stripBullet(line)] });
        }
        break;
      }
      case "education":
        eduLines.push(parseEducationLine(line));
        break;
      case "skills": {
        const [cat, items] = line.includes(":") ? line.split(/:(.*)/s) : ["Skills", line];
        r.skills.push({ category: stripBullet(cat).trim(), items: (items ?? "").split(/[,|;•]/).map((s) => s.trim()).filter(Boolean) });
        break;
      }
      case "projects": {
        const cur = r.projects.at(-1);
        if (isBullet && cur) cur.bullets.push(stripBullet(line));
        else r.projects.push({ name: stripBullet(line), tech: "", link: "", bullets: [] });
        break;
      }
      case "certifications":
        r.certifications.push(stripBullet(line));
        break;
      default:
        break;
    }
  }
  r.summary = summary.join(" ").slice(0, 1500);
  r.education = mergeEducation(eduLines);
  return ResumeSchema.parse(r);
}
