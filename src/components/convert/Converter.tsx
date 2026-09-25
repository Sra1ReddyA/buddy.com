"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { trackConversion, trackUsage } from "@/lib/track-client";
import { FeedbackModal } from "../FeedbackModal";
import type { LayoutMode } from "@/lib/convert/pdf-to-docx";

type Mode = "pdf-to-word" | "word-to-pdf";
type State =
  | { step: "idle" }
  | { step: "ready"; file: File }
  | { step: "converting"; file: File; done: number; total: number; label: string }
  | { step: "done"; file: File; blob: Blob; name: string; pages: number; warnings: string[]; ms: number; exactPages?: number; layout?: LayoutMode }
  | { step: "error"; file?: File; message: string };

const MAX_BYTES = 50 * 1024 * 1024;

const CONFIG = {
  "pdf-to-word": {
    accept: ".pdf,application/pdf",
    from: "PDF",
    to: "Word",
    outExt: "docx",
    cta: "Convert to Word",
    check: (f: File) => /\.pdf$/i.test(f.name) || f.type === "application/pdf",
    wrongType: "Please choose a PDF file (.pdf).",
    download: "download_docx" as const,
  },
  "word-to-pdf": {
    accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    from: "Word",
    to: "PDF",
    outExt: "pdf",
    cta: "Convert to PDF",
    check: (f: File) => /\.docx$/i.test(f.name),
    wrongType: "Please choose a Word document (.docx). Older .doc files: open in Word and “Save as” .docx first.",
    download: "download_pdf" as const,
  },
};

const LAYOUTS: { id: LayoutMode; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Forms keep their exact layout; letters and reports become flowing, editable text." },
  { id: "exact", label: "Exact layout", hint: "Every page matches the PDF: boxes, tables and fields stay in place. One Word page per PDF page." },
  { id: "flow", label: "Flowing text", hint: "Paragraphs that reflow as you edit. Best for long text; form layouts won't be kept." },
];

const fmtSize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

function errorCode(msg: string) {
  if (/password/i.test(msg)) return "password";
  if (/no extractable text/i.test(msg)) return "no_text";
  if (/couldn't be read as a PDF/i.test(msg)) return "not_pdf";
  if (/valid Word/i.test(msg)) return "not_docx";
  return "engine_error";
}

/** Upload → Convert → Download. Conversion runs entirely in the browser. */
export function Converter({ mode }: { mode: Mode }) {
  const cfg = CONFIG[mode];
  const [state, setState] = useState<State>({ step: "idle" });
  const [drag, setDrag] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const [layout, setLayout] = useState<LayoutMode>("auto");
  const asked = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    trackUsage(mode, "open");
    // warm up the conversion engine while the user picks a file
    const t = setTimeout(() => {
      if (mode === "pdf-to-word") import("@/lib/convert/pdf-to-docx").catch(() => {});
      else import("@/lib/convert/docx-to-pdf").catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [mode]);

  const choose = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!cfg.check(file)) return setState({ step: "error", message: cfg.wrongType });
      if (file.size > MAX_BYTES) return setState({ step: "error", file, message: `That file is ${fmtSize(file.size)}. The limit is 50 MB.` });
      if (file.size === 0) return setState({ step: "error", file, message: "That file is empty." });
      trackUsage(mode, "upload");
      setState({ step: "ready", file });
    },
    [cfg, mode],
  );

  async function convert(file: File, layoutMode: LayoutMode = layout) {
    const started = performance.now();
    setState({ step: "converting", file, done: 0, total: 0, label: "Preparing…" });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let blob: Blob;
      let pages: number;
      let warnings: string[];
      let exactPages: number | undefined;
      if (mode === "pdf-to-word") {
        const { pdfToDocx } = await import("@/lib/convert/pdf-to-docx");
        ({ blob, pages, warnings, exactPages } = await pdfToDocx(bytes, {
          layout: layoutMode,
          onProgress: (done, total) => setState({ step: "converting", file, done, total, label: `Reading page ${done} of ${total}…` }),
        }));
      } else {
        setState({ step: "converting", file, done: 0, total: 0, label: "Laying out pages…" });
        const { docxToPdf } = await import("@/lib/convert/docx-to-pdf");
        ({ blob, pages, warnings } = await docxToPdf(bytes, { title: file.name.replace(/\.docx$/i, "") }));
      }
      const ms = Math.round(performance.now() - started);
      const name = file.name.replace(/\.[^.]+$/, "") + "." + cfg.outExt;
      trackConversion({ tool: mode, status: "success", inputBytes: file.size, outputBytes: blob.size, pages, durationMs: ms });
      setState({ step: "done", file, blob, name, pages, warnings, ms, exactPages, layout: mode === "pdf-to-word" ? layoutMode : undefined });
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : "Conversion failed.";
      console.error(e);
      trackConversion({ tool: mode, status: "failed", inputBytes: file.size, durationMs: Math.round(performance.now() - started), errorCode: errorCode(message) });
      setState({ step: "error", file, message: /password|no extractable|couldn't be read|valid Word|no body/i.test(message) ? message : "Something went wrong converting this file. Please try another file." });
    }
  }

  function download(s: Extract<State, { step: "done" }>) {
    const url = URL.createObjectURL(s.blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: s.name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    trackUsage(mode, cfg.download);
    if (!asked.current) {
      asked.current = true;
      setTimeout(() => setFeedback(true), 600);
    }
  }

  const reset = () => {
    setState({ step: "idle" });
    asked.current = false;
    if (input.current) input.current.value = "";
  };

  const steps = ["Upload", "Convert", "Download"];
  const active = state.step === "idle" || state.step === "error" ? 0 : state.step === "ready" || state.step === "converting" ? 1 : 2;

  return (
    <div className="card mx-auto w-full max-w-2xl overflow-hidden">
      {/* 3-step indicator */}
      <ol className="flex border-b border-slate-100 text-xs font-medium" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s} className={`flex flex-1 items-center justify-center gap-2 py-3 ${i === active ? "text-brand-700" : i < active ? "text-slate-600" : "text-slate-400"}`} aria-current={i === active ? "step" : undefined}>
            <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${i < active ? "bg-emerald-500 text-white" : i === active ? "bg-brand-600 text-white" : "bg-slate-100"}`}>{i < active ? "✓" : i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      <div className="p-6 sm:p-8">
        {(state.step === "idle" || state.step === "error") && (
          <>
            <div
              role="button"
              tabIndex={0}
              aria-label={`Choose a ${cfg.from} file`}
              onClick={() => input.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), input.current?.click())}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                choose(e.dataTransfer.files[0]);
              }}
              className={`grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition ${
                drag ? "border-brand-500 bg-brand-50" : "border-slate-300 hover:border-brand-400 hover:bg-slate-50"
              }`}
            >
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-white shadow-md">
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
              </span>
              <p className="mt-4 text-lg font-semibold">Drop your {cfg.from} file here</p>
              <p className="mt-1 text-sm text-slate-500">or <span className="font-medium text-brand-600">browse</span> · {cfg.from === "PDF" ? ".pdf" : ".docx"} up to 50 MB</p>
              <input ref={input} type="file" accept={cfg.accept} className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
            </div>
            {state.step === "error" && (
              <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.message}</p>
            )}
          </>
        )}

        {(state.step === "ready" || state.step === "converting") && (
          <div className="space-y-5">
            <FileCard file={state.file} kind={cfg.from} onChange={state.step === "ready" ? reset : undefined} />
            {state.step === "ready" && mode === "pdf-to-word" && (
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-slate-700">Layout</legend>
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Layout">
                  {LAYOUTS.map((l) => (
                    <label
                      key={l.id}
                      className={`cursor-pointer rounded-lg px-2 py-2 text-center text-sm font-medium transition focus-within:ring-2 focus-within:ring-brand-500 ${
                        layout === l.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      <input type="radio" name="layout" value={l.id} checked={layout === l.id} onChange={() => setLayout(l.id)} className="sr-only" />
                      {l.label}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">{LAYOUTS.find((l) => l.id === layout)!.hint}</p>
              </fieldset>
            )}
            {state.step === "ready" ? (
              <button className="btn-primary w-full py-3.5 text-base" onClick={() => convert(state.file)} autoFocus>
                {cfg.cta}
              </button>
            ) : (
              <div aria-live="polite">
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full bg-brand-600 transition-all ${state.total ? "" : "w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite]"}`}
                    style={state.total ? { width: `${Math.max(6, (state.done / state.total) * 100)}%` } : undefined}
                  />
                </div>
                <p className="mt-2 text-center text-sm text-slate-600">{state.label}</p>
              </div>
            )}
          </div>
        )}

        {state.step === "done" && (
          <div className="space-y-5 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-600">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="m5 12 5 5L20 7" /></svg>
            </div>
            <div>
              <p className="text-lg font-semibold">Your {cfg.to} file is ready</p>
              <p className="mt-1 text-sm text-slate-500">
                {state.name} · {fmtSize(state.blob.size)} · {state.pages} page{state.pages === 1 ? "" : "s"} · {(state.ms / 1000).toFixed(1)}s
              </p>
            </div>
            <button className="btn-primary w-full py-3.5 text-base" onClick={() => download(state)} autoFocus>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 4v12m0 0-4-4m4 4 4-4M4 20h16" /></svg>
              Download {cfg.to === "Word" ? ".docx" : ".pdf"}
            </button>
            {state.layout && (
              <p className="text-xs text-slate-500">
                {state.exactPages === state.pages
                  ? "Every page keeps its exact PDF layout."
                  : state.exactPages
                    ? `${state.exactPages} of ${state.pages} pages keep their exact layout (forms); the rest is flowing text.`
                    : "Converted as flowing, editable text."}{" "}
                {state.exactPages !== state.pages && (
                  <button className="font-medium text-brand-600 hover:underline" onClick={() => (setLayout("exact"), convert(state.file, "exact"))}>
                    Convert again with exact layout
                  </button>
                )}
                {state.exactPages === state.pages && (
                  <button className="font-medium text-brand-600 hover:underline" onClick={() => (setLayout("flow"), convert(state.file, "flow"))}>
                    Convert again as flowing text
                  </button>
                )}
              </p>
            )}
            {state.warnings.length > 0 && (
              <ul className="rounded-lg bg-amber-50 p-3 text-left text-xs text-amber-800">
                {state.warnings.map((w) => (
                  <li key={w}>• {w}</li>
                ))}
              </ul>
            )}
            <button className="btn-ghost text-sm" onClick={reset}>Convert another file</button>
          </div>
        )}

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          Converted in your browser — your file is never uploaded.
        </p>
      </div>
      <FeedbackModal open={feedback} onClose={() => setFeedback(false)} tool={mode} format={cfg.outExt as "pdf" | "docx"} />
    </div>
  );
}

function FileCard({ file, kind, onChange }: { file: File; kind: string; onChange?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg text-xs font-bold text-white ${kind === "PDF" ? "bg-rose-600" : "bg-sky-600"}`}>{kind === "PDF" ? "PDF" : "DOCX"}</span>
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate font-medium" title={file.name}>{file.name}</p>
        <p className="text-xs text-slate-500">{fmtSize(file.size)}</p>
      </div>
      {onChange && (
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={onChange}>Change</button>
      )}
    </div>
  );
}
