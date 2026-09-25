import Link from "next/link";
import { getTool, type ToolId } from "@/lib/tools";
import { JsonLd } from "./JsonLd";
import { ToolIcon } from "./ToolIcon";
import { breadcrumbLd, softwareAppLd } from "@/lib/seo";

/** Indexable landing page for tools that aren't live yet (captures search intent now). */
export function ComingSoonPage({ id, points, children }: { id: ToolId; points: string[]; children?: React.ReactNode }) {
  const tool = getTool(id);
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <JsonLd
        data={[
          softwareAppLd({ name: tool.name, description: tool.description, path: tool.href, keywords: tool.keywords }),
          breadcrumbLd([{ name: "Home", path: "/" }, { name: tool.name, path: tool.href }]),
        ]}
      />
      <div className={`mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br ${tool.accent} text-white shadow-lg`}>
        <ToolIcon icon={tool.icon} className="h-8 w-8" />
      </div>
      <span className="mt-5 inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Coming soon</span>
      <h1 className="mt-4 text-4xl font-bold tracking-tight">{tool.name}: free {tool.tagline.toLowerCase()}</h1>
      <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600">{tool.description}</p>
      <ul className="mx-auto mt-8 max-w-md space-y-2 text-left text-slate-700">
        {points.map((p) => (
          <li key={p} className="flex gap-2"><span className="text-emerald-500">✓</span>{p}</li>
        ))}
      </ul>
      {children}
      <div className="mt-10 flex justify-center gap-3">
        <Link href="/resume-buddy" className="btn-primary">Try Resume Buddy</Link>
        <Link href="/" className="btn-secondary">All tools</Link>
      </div>
    </div>
  );
}
