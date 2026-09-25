"use client";
import { TEMPLATE_LIST, sectionHeading } from "@/lib/resume/templates";
import type { Engagement, TemplateId } from "@/lib/resume/types";

type Props = {
  value: TemplateId | null;
  onChange: (t: TemplateId) => void;
  engagement: Engagement;
  onEngagementChange: (e: Engagement) => void;
  showError?: boolean;
};

/** Miniature page showing each template's section order and header treatment. */
function Thumbnail({ id }: { id: TemplateId }) {
  const t = TEMPLATE_LIST.find((x) => x.id === id)!;
  const color = "#111";
  return (
    <div className="aspect-[8.5/11] w-full rounded-md border border-slate-200 bg-white p-2.5 shadow-inner" aria-hidden>
      <div className="mx-auto h-1.5 w-1/2 rounded bg-slate-800" />
      <div className="mx-auto mt-1 h-1 w-1/3 rounded bg-slate-400" />
      <div className="mx-auto mt-1 h-0.5 w-2/3 rounded bg-slate-300" />
      {id !== "full-time" && <div className="mx-auto mt-1 h-0.5 w-3/4 rounded bg-slate-400" />}
      {t.sections.slice(0, 4).map((s) => (
        <div key={s} className="mt-2">
          <div className="font-sans text-[5px] font-bold uppercase leading-none tracking-wide" style={{ color }}>{sectionHeading(t, s)}</div>
          <div className="mt-0.5 h-px w-full" style={{ background: color }} />
          <div className="mt-1 space-y-0.5">
            <div className="h-0.5 w-11/12 rounded bg-slate-200" />
            <div className="h-0.5 w-10/12 rounded bg-slate-200" />
            {s === "experience" && <div className="h-0.5 w-9/12 rounded bg-slate-200" />}
          </div>
        </div>
      ))}
    </div>
  );
}

export function TemplateSelector({ value, onChange, engagement, onEngagementChange, showError }: Props) {
  const setE = (k: keyof Engagement) => (e: React.ChangeEvent<HTMLInputElement>) => onEngagementChange({ ...engagement, [k]: e.target.value });

  return (
    <div>
      <div role="radiogroup" aria-label="Resume template" aria-required="true" className="grid gap-4 md:grid-cols-3">
        {TEMPLATE_LIST.map((t, idx) => {
          const selected = value === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected || (!value && idx === 0) ? 0 : -1}
              onClick={() => onChange(t.id)}
              onKeyDown={(e) => {
                const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                if (!dir) return;
                e.preventDefault();
                const next = TEMPLATE_LIST[(idx + dir + TEMPLATE_LIST.length) % TEMPLATE_LIST.length];
                onChange(next.id);
                (e.currentTarget.parentElement?.children[TEMPLATE_LIST.indexOf(next)] as HTMLElement)?.focus();
              }}
              className={`group relative flex flex-col rounded-2xl border-2 p-4 text-left transition ${
                selected ? "border-brand-500 bg-brand-50/50 shadow-md" : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm"
              }`}
            >
              {selected && (
                <span className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-white">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={3}><path d="m5 12 5 5L20 7" /></svg>
                </span>
              )}
              <div className="mx-auto w-28"><Thumbnail id={t.id} /></div>
              <div className="mt-4 flex items-center gap-2">
                <span className="rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white">{t.badge}</span>
                <span className="font-semibold">{t.name}</span>
              </div>
              <p className="mt-1.5 text-sm text-slate-600">{t.description}</p>
              <p className="mt-auto pt-3 text-xs text-slate-500"><span className="font-medium text-slate-700">Best for:</span> {t.bestFor}</p>
            </button>
          );
        })}
      </div>
      {showError && !value && (
        <p role="alert" className="mt-3 text-sm font-medium text-rose-600">Please choose a template to continue.</p>
      )}

      {(value === "w2" || value === "c2c") && (
        <div className="card mt-5 animate-pop p-5">
          <h3 className="font-semibold">{value === "c2c" ? "Consultant details" : "Contract details"}</h3>
          <p className="text-sm text-slate-500">Shown in the resume header. Leave blank to hide.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {value === "c2c" && (
              <label className="sm:col-span-2">
                <span className="label">Your corporation (employer of record)</span>
                <input className="input" value={engagement.corpName} onChange={setE("corpName")} placeholder="Lee Consulting LLC" />
              </label>
            )}
            <label>
              <span className="label">Work authorization</span>
              <input className="input" value={engagement.workAuthorization} onChange={setE("workAuthorization")} placeholder="US Citizen / GC / H-1B" />
            </label>
            <label>
              <span className="label">Availability</span>
              <input className="input" value={engagement.availability} onChange={setE("availability")} placeholder="Immediately / 2 weeks" />
            </label>
            <label className="sm:col-span-2">
              <span className="label">Location preference</span>
              <input className="input" value={engagement.relocation} onChange={setE("relocation")} placeholder="Remote or hybrid · Open to relocation" />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
