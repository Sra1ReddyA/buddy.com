export type ToolId = "resume-buddy" | "law-buddy" | "gym-buddy" | "pdf-to-word" | "word-to-pdf";

export type Tool = {
  id: ToolId;
  name: string;
  tagline: string;
  description: string;
  href: string;
  active: boolean;
  keywords: string[];
  accent: string; // tailwind gradient classes
  icon: "resume" | "law" | "gym" | "pdf2word" | "word2pdf";
};

export const TOOLS: Tool[] = [
  {
    id: "resume-buddy",
    name: "Resume Buddy",
    tagline: "Optimized resume generator",
    description:
      "Build or upload your resume, pick a Full-Time, W2 or C2C template, and get an ATS-optimized resume you can download as PDF or Word.",
    href: "/resume-buddy",
    active: true,
    keywords: ["resume maker", "optimized resume generator", "ATS resume builder", "free resume builder"],
    accent: "from-indigo-500 to-violet-500",
    icon: "resume",
  },
  {
    id: "law-buddy",
    name: "Law Buddy",
    tagline: "Relevant case law finder",
    description:
      "Pick a case type and describe what happened. Law Buddy finds relevant public court opinions and explains in plain English why each one matters.",
    href: "/law-buddy",
    active: true,
    keywords: ["case law search", "find similar court cases", "legal research tool", "court opinion search", "free case law finder"],
    accent: "from-slate-700 to-slate-900",
    icon: "law",
  },
  {
    id: "gym-buddy",
    name: "Gym Buddy",
    tagline: "Workout planner & tracker",
    description: "Plan workouts, log sets and track progress over time.",
    href: "/gym-buddy",
    active: false,
    keywords: ["workout planner", "gym tracker", "workout log"],
    accent: "from-emerald-500 to-teal-500",
    icon: "gym",
  },
  {
    id: "pdf-to-word",
    name: "PDF to Word Buddy",
    tagline: "PDF to Word converter",
    description: "Turn any PDF into an editable Word document with headings, lists, tables, images and layout kept intact.",
    href: "/pdf-to-word",
    active: true,
    keywords: ["PDF to Word converter", "convert PDF to DOCX", "free PDF to Word"],
    accent: "from-rose-500 to-orange-500",
    icon: "pdf2word",
  },
  {
    id: "word-to-pdf",
    name: "Word to PDF Converter Buddy",
    tagline: "Word to PDF converter",
    description: "Turn Word (.docx) files into clean, shareable PDFs with fonts, tables, images and page numbers preserved.",
    href: "/word-to-pdf",
    active: true,
    keywords: ["Word to PDF converter", "DOCX to PDF", "free Word to PDF"],
    accent: "from-sky-500 to-cyan-500",
    icon: "word2pdf",
  },
];

export const TOOL_IDS = TOOLS.map((t) => t.id) as [ToolId, ...ToolId[]];
export const getTool = (id: ToolId) => TOOLS.find((t) => t.id === id)!;
