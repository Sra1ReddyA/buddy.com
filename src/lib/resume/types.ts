import { z } from "zod";

export const TEMPLATE_IDS = ["full-time", "w2", "c2c"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

const str = (max = 300) => z.string().trim().max(max).default("");

export const ContactSchema = z.object({
  fullName: str(120),
  title: str(160),
  email: str(160),
  phone: str(60),
  location: str(120),
  linkedin: str(200),
  website: str(200),
});

export const ExperienceSchema = z.object({
  company: str(160),
  role: str(160),
  location: str(120),
  startDate: str(40),
  endDate: str(40),
  /** End client for W2 / C2C contract roles (e.g. "Client: Bank of America") */
  client: str(160),
  bullets: z.array(z.string().trim().max(600)).max(20).default([]),
});

export const EducationSchema = z.object({
  school: str(160),
  degree: str(160),
  field: str(160),
  startDate: str(40),
  endDate: str(40),
  details: str(400),
});

export const SkillGroupSchema = z.object({
  category: str(80),
  items: z.array(z.string().trim().max(80)).max(40).default([]),
});

export const ProjectSchema = z.object({
  name: str(160),
  tech: str(300),
  link: str(200),
  bullets: z.array(z.string().trim().max(600)).max(10).default([]),
});

/** Extra header details used by the W2 and C2C templates */
export const EngagementSchema = z.object({
  workAuthorization: str(120), // e.g. "US Citizen", "H-1B (transfer ready)"
  availability: str(120), // e.g. "Available immediately", "2 weeks notice"
  corpName: str(160), // C2C only: the candidate's corporation / employer of record
  relocation: str(120), // e.g. "Open to relocation", "Remote / Hybrid"
});

export const ResumeSchema = z.object({
  contact: ContactSchema,
  summary: str(1500),
  experience: z.array(ExperienceSchema).max(15).default([]),
  education: z.array(EducationSchema).max(8).default([]),
  skills: z.array(SkillGroupSchema).max(12).default([]),
  projects: z.array(ProjectSchema).max(10).default([]),
  certifications: z.array(z.string().trim().max(200)).max(15).default([]),
  engagement: EngagementSchema.default({ workAuthorization: "", availability: "", corpName: "", relocation: "" }),
});

export type Contact = z.infer<typeof ContactSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Education = z.infer<typeof EducationSchema>;
export type SkillGroup = z.infer<typeof SkillGroupSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Engagement = z.infer<typeof EngagementSchema>;
export type ResumeData = z.infer<typeof ResumeSchema>;

export const GenerateRequestSchema = z.object({
  resume: ResumeSchema,
  template: z.enum(TEMPLATE_IDS),
  customRules: z.string().trim().max(2000).default(""),
  targetRole: z.string().trim().max(200).default(""),
  jobDescription: z.string().trim().max(8000).default(""),
});
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

export const emptyExperience = (): Experience => ({
  company: "", role: "", location: "", startDate: "", endDate: "", client: "", bullets: [""],
});
export const emptyEducation = (): Education => ({
  school: "", degree: "", field: "", startDate: "", endDate: "", details: "",
});
export const emptyProject = (): Project => ({ name: "", tech: "", link: "", bullets: [""] });
export const emptySkillGroup = (): SkillGroup => ({ category: "", items: [] });

export const emptyResume = (): ResumeData => ({
  contact: { fullName: "", title: "", email: "", phone: "", location: "", linkedin: "", website: "" },
  summary: "",
  experience: [emptyExperience()],
  education: [emptyEducation()],
  skills: [{ category: "Languages", items: [] }, { category: "Frameworks & Tools", items: [] }],
  projects: [],
  certifications: [],
  engagement: { workAuthorization: "", availability: "", corpName: "", relocation: "" },
});
