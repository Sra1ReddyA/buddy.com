import { JsonLd } from "@/components/JsonLd";
import { LawBuddy } from "@/components/law/LawBuddy";
import { breadcrumbLd, faqLd, pageMetadata, softwareAppLd } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Law Buddy — Find Relevant Court Cases for Your Situation (Free)",
  description:
    "Describe your situation, pick a case type and your state (or Federal) and Law Buddy finds relevant public court opinions from CourtListener, with a detailed plain-English summary of the facts, the ruling and why each case matters. Free legal research tool — not legal advice.",
  path: "/law-buddy",
  keywords: ["case law search", "find similar court cases", "legal research tool", "court opinion search", "free case law finder"],
});

const FAQS = [
  { q: "Where do the cases come from?", a: "From CourtListener, a free public database of U.S. court opinions run by the non-profit Free Law Project. Every result links to the full public opinion." },
  { q: "Can I search only my state's courts?", a: "Yes. Pick any of the 50 states to search that state's courts only, or Federal for the U.S. Supreme Court, the federal courts of appeals and the federal district courts." },
  { q: "Is Law Buddy legal advice?", a: "No. Law Buddy is an AI research tool that surfaces public court opinions related to your description. It does not provide formal legal advice — please consult a licensed attorney." },
  { q: "Is my description stored?", a: "No. Your description is used only to run the search and write the summaries. Buddy stores only anonymous usage counts (such as the case type and jurisdiction selected)." },
];

export default function LawBuddyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <JsonLd
        data={[
          softwareAppLd({
            name: "Law Buddy",
            description: "Free legal research tool that finds public court opinions relevant to your situation.",
            path: "/law-buddy",
            keywords: ["case law search", "legal research tool"],
          }),
          faqLd(FAQS),
          breadcrumbLd([{ name: "Home", path: "/" }, { name: "Law Buddy", path: "/law-buddy" }]),
        ]}
      />
      <header className="mb-8 text-center">
        <p className="text-sm font-semibold text-brand-600">Law Buddy</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Find court cases like yours</h1>
        <p className="mx-auto mt-3 max-w-xl text-slate-600">
          Choose a case type and your state, then describe what happened. Law Buddy picks the legal keywords, searches that jurisdiction&apos;s court opinions and explains each case&apos;s facts, ruling and relevance.
        </p>
      </header>
      <LawBuddy />
      <section className="mt-14">
        <h2 className="text-lg font-semibold tracking-tight">Questions</h2>
        <div className="mt-3 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
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
    </div>
  );
}
