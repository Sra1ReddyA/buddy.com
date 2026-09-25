import type { ResumeData, TemplateId } from "./types";

export type SectionKey = "summary" | "skills" | "experience" | "projects" | "education" | "certifications";

export type TemplateConfig = {
  id: TemplateId;
  name: string;
  badge: string;
  description: string;
  bestFor: string;
  /** Order sections render in the preview, PDF and DOCX */
  sections: SectionKey[];
  /** Header lines pulled from resume.engagement */
  headerExtras: (r: ResumeData) => string[];
  summaryHeading: string;
  experienceHeading: string;
  /** Show "Client: X" under each role */
  showClient: boolean;
  /** Extra instructions appended to the LLM prompt for this template */
  llmGuidance: string;
};

const join = (...parts: string[]) => parts.map((p) => p.trim()).filter(Boolean);

export const TEMPLATES: Record<TemplateId, TemplateConfig> = {
  "full-time": {
    id: "full-time",
    name: "Full-Time",
    badge: "FTE",
    description: "Classic single-column layout focused on career growth, impact and leadership.",
    bestFor: "Permanent roles, direct-hire applications, career changers",
    sections: ["summary", "experience", "projects", "skills", "education", "certifications"],
    headerExtras: (r) => join(r.engagement.relocation),
    summaryHeading: "Professional Summary",
    experienceHeading: "Professional Experience",
    showClient: false,
    llmGuidance: [
      "TEMPLATE: FULL-TIME (direct hire).",
      "- Emphasize ownership, long-term impact, team leadership, mentoring and cross-functional collaboration.",
      "- Summary: 3-4 lines positioning the candidate for a permanent role and career growth.",
      "- Omit contract-specific language (rates, C2C, end clients) entirely.",
      "- ONE-PAGE BUDGET: the finished resume must fit on a single US Letter page at 10-11pt.",
      "  Keep ~450-550 words total: summary 2-3 lines, 4-5 bullets for the most recent role, 3 for the next, 2 for older roles, max 2 projects with 2 bullets each.",
      "  Merge overlapping bullets instead of dropping measurable results.",
    ].join("\n"),
  },
  w2: {
    id: "w2",
    name: "W2",
    badge: "W2",
    description: "Contract-friendly layout with work authorization, availability and end-client names up front.",
    bestFor: "W2 contract roles through staffing firms and vendors",
    sections: ["summary", "skills", "experience", "projects", "education", "certifications"],
    headerExtras: (r) =>
      join(
        r.engagement.workAuthorization && `Work Authorization: ${r.engagement.workAuthorization}`,
        r.engagement.availability && `Availability: ${r.engagement.availability}`,
        r.engagement.relocation,
        "Open to W2 Contract",
      ),
    summaryHeading: "Summary",
    experienceHeading: "Project Experience",
    showClient: true,
    llmGuidance: [
      "TEMPLATE: W2 CONTRACT.",
      "- Recruiters skim for tech stack match first: keep the summary to 3-5 keyword-dense lines with years of experience.",
      "- Frame each role as a client engagement: lead with the business problem, the stack, and the delivered outcome.",
      "- Keep the 'client' field populated when present; never invent client names.",
      "- Surface tools and versions explicitly (e.g. 'Java 17', 'Spring Boot 3', 'AWS Lambda').",
    ].join("\n"),
  },
  c2c: {
    id: "c2c",
    name: "C2C (Corp-to-Corp)",
    badge: "C2C",
    description: "Consultant layout: corp entity, skills matrix first, and client-by-client delivery highlights.",
    bestFor: "Independent consultants billing through their own corporation",
    sections: ["skills", "summary", "experience", "projects", "certifications", "education"],
    headerExtras: (r) =>
      join(
        r.engagement.corpName && `Corp-to-Corp via ${r.engagement.corpName}`,
        r.engagement.workAuthorization && `Work Authorization: ${r.engagement.workAuthorization}`,
        r.engagement.availability && `Availability: ${r.engagement.availability}`,
        r.engagement.relocation,
      ),
    summaryHeading: "Consultant Profile",
    experienceHeading: "Client Engagements",
    showClient: true,
    llmGuidance: [
      "TEMPLATE: C2C (CORP-TO-CORP CONSULTANT).",
      "- Position the candidate as a senior independent consultant who delivers outcomes with minimal ramp-up.",
      "- Skills come first and should read like a matrix: group tightly (Languages, Cloud, Data, DevOps, etc.).",
      "- Every engagement bullet should show scope (users, data volume, $ or % impact) and deliverables handed to the client.",
      "- Never mention pay rates. Never invent client or corporation names.",
    ].join("\n"),
  },
};

export const TEMPLATE_LIST = Object.values(TEMPLATES);

export function sectionHeading(t: TemplateConfig, key: SectionKey): string {
  switch (key) {
    case "summary":
      return t.summaryHeading;
    case "experience":
      return t.experienceHeading;
    case "skills":
      return t.id === "c2c" ? "Technical Skills Matrix" : "Technical Skills";
    case "projects":
      return "Key Projects";
    case "education":
      return "Education";
    case "certifications":
      return "Certifications";
  }
}

/** True when a section has content worth rendering */
export function hasSection(r: ResumeData, key: SectionKey): boolean {
  switch (key) {
    case "summary":
      return !!r.summary.trim();
    case "experience":
      return r.experience.some((e) => e.company || e.role);
    case "projects":
      return r.projects.some((p) => p.name);
    case "skills":
      return r.skills.some((s) => s.items.length > 0);
    case "education":
      return r.education.some((e) => e.school || e.degree);
    case "certifications":
      return r.certifications.length > 0;
  }
}

export const dateRange = (a: string, b: string) => [a, b].filter(Boolean).join(" – ");
export const contactLine = (r: ResumeData) =>
  [r.contact.email, r.contact.phone, r.contact.location, r.contact.linkedin, r.contact.website].filter(Boolean);
