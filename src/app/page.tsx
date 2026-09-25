import Link from "next/link";
import { ToolGrid } from "@/components/ToolGrid";
import { JsonLd } from "@/components/JsonLd";
import { faqLd, pageMetadata, toolsItemListLd, softwareAppLd } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Buddy — Free Resume Maker, Optimized Resume Generator & PDF to Word Converter",
  description:
    "Free resume maker and optimized resume generator with Full-Time, W2 and C2C templates, plus a free PDF to Word converter and Word to PDF converter that run in your browser.",
  path: "/",
  keywords: ["productivity tools", "online tools"],
});

const FAQS = [
  { q: "Is Buddy's resume maker free?", a: "Yes. Resume Buddy is free to use: fill out a form or upload your resume, pick a template and download a PDF or Word file." },
  { q: "What makes it an optimized resume generator?", a: "Resume Buddy rewrites your bullets into active, project-focused statements, mirrors keywords from the job description, and never starts bullets with weak past-tense '-ed' verbs." },
  { q: "What is the difference between the Full-Time, W2 and C2C templates?", a: "Full-Time focuses on career growth and ownership. W2 highlights work authorization, availability and client projects for contract roles. C2C leads with a skills matrix and your corporation for corp-to-corp consulting." },
  { q: "Can I edit the Word file after downloading?", a: "Yes. The .docx is built with real Word styles, bullets and tab stops — no tables or text boxes — so it stays easy to edit." },
  { q: "Do you have a free PDF to Word converter?", a: "Yes. Buddy's PDF to Word converter turns PDFs into editable Word documents with headings, lists, tables and images kept — and it runs in your browser, so files are never uploaded." },
  { q: "Can I convert Word to PDF?", a: "Yes. The Word to PDF converter turns .docx files into PDFs with fonts, tables, images and page numbers preserved." },
  { q: "What does Law Buddy do?", a: "Law Buddy lets you pick a case type and describe your situation, then finds relevant public court opinions on CourtListener with a plain-English summary of why each one matters. It is an AI research tool, not legal advice." },
];

export default function Home() {
  return (
    <>
      <JsonLd
        data={[
          toolsItemListLd(),
          faqLd(FAQS),
          softwareAppLd({
            name: "Resume Buddy — Optimized Resume Generator",
            description: "Free resume maker that turns your experience into an ATS-optimized resume in Full-Time, W2 or C2C format.",
            path: "/resume-buddy",
            keywords: ["resume maker", "optimized resume generator", "ATS resume builder"],
          }),
        ]}
      />
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,#e0e7ff_0%,transparent_70%)]" />
        <div className="mx-auto max-w-6xl px-4 pb-12 pt-16 text-center sm:pt-24">
          <p className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-white px-3 py-1 text-xs font-medium text-brand-700 shadow-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> New: free PDF ⇄ Word converters
          </p>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Your everyday productivity buddy — starting with a <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">resume maker</span> that gets you hired
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">
            An optimized resume generator for Full-Time, W2 and C2C roles. Upload your resume or fill a quick form, set your own rules, and download a polished PDF or fully editable Word document.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/resume-buddy" className="btn-primary px-6 py-3 text-base">Build my resume — free</Link>
            <a href="#tools" className="btn-secondary px-6 py-3 text-base">Explore tools</a>
          </div>
        </div>
      </section>

      <section id="tools" className="mx-auto max-w-6xl scroll-mt-20 px-4">
        <h2 className="text-2xl font-semibold tracking-tight">Tools</h2>
        <p className="mt-1 text-slate-600">Resume Buddy, Law Buddy and the PDF ⇄ Word converters are live. Gym Buddy is next.</p>
        <div className="mt-6"><ToolGrid /></div>
      </section>

      <section className="mx-auto mt-20 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">Frequently asked questions</h2>
        <div className="mt-6 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {FAQS.map((f) => (
            <details key={f.q} className="group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
                {f.q}
                <span className="text-slate-400 transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm text-slate-600">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
