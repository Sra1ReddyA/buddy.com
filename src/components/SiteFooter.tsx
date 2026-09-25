import Link from "next/link";
import { TOOLS } from "@/lib/tools";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm text-slate-500 sm:grid-cols-3">
        <div>
          <p className="font-semibold text-slate-800">Buddy</p>
          <p className="mt-2">Free productivity tools: resume maker, optimized resume generator, PDF to Word converter and Word to PDF converter.</p>
        </div>
        <div>
          <p className="font-semibold text-slate-800">Tools</p>
          <ul className="mt-2 space-y-1">
            {TOOLS.map((t) => (
              <li key={t.id}><Link href={t.href} className="hover:text-slate-800">{t.name}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-semibold text-slate-800">Privacy</p>
          <p className="mt-2">We count anonymous visits and tool usage. Your resume content is processed to generate your document and is not stored.</p>
        </div>
      </div>
      <p className="pb-8 text-center text-xs text-slate-400">© {new Date().getFullYear()} Buddy</p>
    </footer>
  );
}
