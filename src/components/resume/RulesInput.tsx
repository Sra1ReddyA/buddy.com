"use client";

const SUGGESTIONS = [
  "Confident, concise tone",
  "Quantify impact with numbers where the source supports it",
  "Keep it to one page",
  "Emphasize leadership and mentoring",
  "Highlight cloud (AWS/Azure) experience",
  "Use US English spelling",
];

type Props = {
  rules: string;
  onRules: (v: string) => void;
  targetRole: string;
  onTargetRole: (v: string) => void;
  jobDescription: string;
  onJobDescription: (v: string) => void;
};

export function RulesInput({ rules, onRules, targetRole, onTargetRole, jobDescription, onJobDescription }: Props) {
  const add = (s: string) => onRules(rules.trim() ? `${rules.trim()}\n${s}` : s);
  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-600 text-white" aria-hidden>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
        </span>
        <div className="text-sm">
          <p className="font-semibold text-emerald-900">Always on: project-focused, specific bullets</p>
          <p className="mt-0.5 text-emerald-800">
            Generic lines like <em>“Developed a web app”</em> are rewritten with the specific tech, problem and impact — e.g. “Architected a scalable Next.js web application to streamline user onboarding.” Tense and word choice aren&apos;t restricted; every bullet just has to be specific and grammatically flawless. Your rules below are combined with this one.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="label">Target role (optional)</span>
          <input className="input" value={targetRole} onChange={(e) => onTargetRole(e.target.value)} placeholder="Senior Backend Engineer" />
        </label>
      </div>

      <label className="block">
        <span className="label">Your rules — one per line (tone, keywords, length, focus)</span>
        <textarea
          className="input min-h-32"
          value={rules}
          maxLength={2000}
          onChange={(e) => onRules(e.target.value)}
          placeholder={"Use keywords: Kubernetes, Terraform, CI/CD\nTone: confident but not salesy\nMax 4 bullets per role"}
        />
        <span className="mt-1 block text-right text-xs text-slate-400">{rules.length}/2000</span>
      </label>
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => add(s)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-brand-300 hover:text-brand-700">
            + {s}
          </button>
        ))}
      </div>

      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-medium">Paste a job description to mirror its keywords (optional)</summary>
        <textarea
          className="input mt-3 min-h-40"
          value={jobDescription}
          maxLength={8000}
          onChange={(e) => onJobDescription(e.target.value)}
          placeholder="Paste the job posting here…"
        />
      </details>
    </div>
  );
}
