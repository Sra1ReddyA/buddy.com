"use client";

export type InputMethod = "form" | "upload";

const OPTIONS: { id: InputMethod; title: string; body: string; icon: React.ReactNode }[] = [
  {
    id: "form",
    title: "Fill out a form",
    body: "Enter your experience, education, skills and projects step by step.",
    icon: <path d="M4 5h16M4 12h16M4 19h10" />,
  },
  {
    id: "upload",
    title: "Upload my resume",
    body: "Drop a PDF or Word file — we'll parse it and pre-fill everything for you.",
    icon: <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  },
];

/** Segmented, keyboard-accessible choice between manual entry and upload. */
export function InputMethodToggle({ value, onChange }: { value: InputMethod; onChange: (m: InputMethod) => void }) {
  return (
    <div role="radiogroup" aria-label="How do you want to add your resume?" className="grid gap-3 sm:grid-cols-2">
      {OPTIONS.map((o) => {
        const selected = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => {
              if (["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key)) {
                e.preventDefault();
                onChange(o.id === "form" ? "upload" : "form");
              }
            }}
            tabIndex={selected ? 0 : -1}
            className={`flex items-start gap-3 rounded-2xl border-2 p-4 text-left transition ${
              selected ? "border-brand-500 bg-brand-50/60 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"
            }`}
          >
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${selected ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500"}`}>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {o.icon}
              </svg>
            </span>
            <span>
              <span className="block font-semibold">{o.title}</span>
              <span className="mt-0.5 block text-sm text-slate-600">{o.body}</span>
            </span>
            <span className={`ml-auto mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${selected ? "border-brand-600 bg-brand-600 shadow-[inset_0_0_0_2px_white]" : "border-slate-300"}`} />
          </button>
        );
      })}
    </div>
  );
}
