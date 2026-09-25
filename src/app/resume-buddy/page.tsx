import { ResumeBuilder } from "@/components/resume/ResumeBuilder";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbLd, howToLd, pageMetadata, softwareAppLd } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Resume Buddy — Free Resume Maker & Optimized Resume Generator (Full-Time, W2, C2C)",
  description:
    "Free AI resume maker: fill a form or upload your PDF/Word resume, pick a Full-Time, W2 or C2C template, add your own rules and download an ATS-optimized resume as PDF or editable Word.",
  path: "/resume-buddy",
  keywords: ["resume maker", "optimized resume generator", "AI resume builder", "W2 resume", "C2C resume", "resume to Word", "ATS friendly resume"],
});

export default function ResumeBuddyPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <JsonLd
        data={[
          softwareAppLd({
            name: "Resume Buddy",
            description: "Free optimized resume generator with Full-Time, W2 and C2C templates, PDF and Word export.",
            path: "/resume-buddy",
            keywords: ["resume maker", "optimized resume generator", "ATS resume builder"],
          }),
          breadcrumbLd([{ name: "Home", path: "/" }, { name: "Resume Buddy", path: "/resume-buddy" }]),
          howToLd("How to create an optimized resume with Resume Buddy", [
            "Fill out the form or upload your existing PDF or Word resume.",
            "Choose the Full-Time, W2 or C2C template.",
            "Add your own rules such as tone and keywords.",
            "Generate, preview and download as PDF or Word.",
          ]),
        ]}
      />
      <header className="mb-8">
        <p className="text-sm font-semibold text-brand-600">Resume Buddy</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Free resume maker &amp; optimized resume generator</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Four quick steps: add your details, choose a template, set your rules, and download a recruiter-ready resume as PDF or editable Word.
        </p>
      </header>
      <ResumeBuilder />
    </div>
  );
}
