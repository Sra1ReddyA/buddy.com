"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { emptyResume, type ResumeData, type TemplateId } from "@/lib/resume/types";
import { findGenericBullets } from "@/lib/resume/optimize";
import { DENSITIES, PAGE_TARGET } from "@/lib/resume/layout";
import type { FitResult } from "@/lib/resume/export-pdf";
import { InputMethodToggle, type InputMethod } from "./InputMethodToggle";
import { UploadDropzone } from "./UploadDropzone";
import { ManualForm } from "./ManualForm";
import { TemplateSelector } from "./TemplateSelector";
import { RulesInput } from "./RulesInput";
import { ResumePreview } from "./ResumePreview";
import { ExportBar } from "./ExportBar";
import { FeedbackModal } from "../FeedbackModal";

const STEPS = ["Your details", "Template", "Rules", "Preview & download"] as const;
const DRAFT_KEY = "buddy.resume.draft.v1";

type GenerateResponse = { resume: ResumeData; source: "llm" | "rules"; repairedBullets: number; notice?: string; error?: string };

/** Trim strings and drop empty list items before sending to the API. */
function normalize(r: ResumeData): ResumeData {
  const clean = (a: string[]) => a.map((s) => s.trim()).filter(Boolean);
  return {
    ...r,
    experience: r.experience.map((e) => ({ ...e, bullets: clean(e.bullets) })),
    projects: r.projects.map((p) => ({ ...p, bullets: clean(p.bullets) })),
    skills: r.skills.map((s) => ({ ...s, items: clean(s.items) })).filter((s) => s.items.length),
    certifications: clean(r.certifications),
  };
}

export function ResumeBuilder() {
  const [step, setStep] = useState(0);
  const [method, setMethod] = useState<InputMethod>("form");
  const [resume, setResume] = useState<ResumeData>(emptyResume);
  const [uploadedFrom, setUploadedFrom] = useState<string | null>(null);
  const [template, setTemplate] = useState<TemplateId | null>(null);
  const [templateError, setTemplateError] = useState(false);
  const [rules, setRules] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [jd, setJd] = useState("");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [fit, setFit] = useState<FitResult>({ density: DENSITIES[1], pages: 1, overLimit: false });
  const [feedback, setFeedback] = useState<{ open: boolean; format: "pdf" | "docx" }>({ open: false, format: "pdf" });
  const askedFeedback = useRef(false);
  const top = useRef<HTMLDivElement>(null);

  // Restore / persist a local draft (per-browser convenience only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) setResume({ ...emptyResume(), ...JSON.parse(raw) });
    } catch {}
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(resume)); } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [resume]);

  const go = (s: number) => {
    setStep(s);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const canLeaveDetails = !!resume.contact.fullName.trim() && resume.experience.some((e) => e.role.trim() || e.company.trim());

  async function generate() {
    if (!template) {
      setTemplateError(true);
      return go(1);
    }
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/resume/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: normalize(resume), template, customRules: rules, targetRole, jobDescription: jd }),
      });
      const json: GenerateResponse = await res.json();
      if (!res.ok) throw new Error(json.error || "Generation failed");
      // Measure with the real font + PDF engine and pick the spacing preset that meets the page target
      try {
        const { fitLayout } = await import("@/lib/resume/export-pdf");
        setFit(await fitLayout(json.resume, template));
      } catch (e) {
        console.error("layout fit failed", e);
      }
      setResult(json);
      askedFeedback.current = false;
      go(3);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  const onDownloaded = useCallback((format: "pdf" | "docx") => {
    // Ask once per generated resume, immediately after the first successful download.
    if (askedFeedback.current) return;
    askedFeedback.current = true;
    setFeedback({ open: true, format });
  }, []);
  const closeFeedback = useCallback(() => setFeedback((f) => ({ ...f, open: false })), []);

  const generic = result ? findGenericBullets(result.resume).length : 0;

  return (
    <div ref={top} className="scroll-mt-20">
      {/* Stepper */}
      <ol className="mb-8 grid grid-cols-4 gap-2" aria-label="Progress">
        {STEPS.map((s, i) => {
          const done = i < step;
          const current = i === step;
          const reachable = i <= step || (i === 3 && !!result);
          return (
            <li key={s}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => reachable && go(i)}
                aria-current={current ? "step" : undefined}
                className="group w-full text-left disabled:cursor-default"
              >
                <span className={`block h-1.5 rounded-full transition ${done || current ? "bg-brand-600" : "bg-slate-200"}`} />
                <span className={`mt-2 hidden text-xs font-medium sm:block ${current ? "text-brand-700" : done ? "text-slate-700" : "text-slate-400"}`}>
                  {i + 1}. {s}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {step === 0 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">How would you like to start?</h2>
            <p className="mt-1 text-sm text-slate-600">Choose one — you can switch any time.</p>
          </div>
          <InputMethodToggle value={method} onChange={setMethod} />

          {method === "upload" && !uploadedFrom && (
            <UploadDropzone
              onParsed={(r, name) => {
                setResume({ ...emptyResume(), ...r, experience: r.experience.length ? r.experience : emptyResume().experience });
                setUploadedFrom(name);
              }}
            />
          )}
          {method === "upload" && uploadedFrom && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
              <span className="text-emerald-800">
                Imported <strong>{uploadedFrom}</strong>. Review the details below — anything we missed can be edited.
              </span>
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setUploadedFrom(null)}>Upload another</button>
            </div>
          )}

          {(method === "form" || uploadedFrom) && <ManualForm value={resume} onChange={setResume} />}

          <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-lg backdrop-blur">
            <button className="btn-ghost text-xs" onClick={() => { setResume(emptyResume()); setUploadedFrom(null); }}>Clear form</button>
            <div className="flex items-center gap-3">
              {!canLeaveDetails && <span className="hidden text-xs text-slate-500 sm:inline">Add your name and at least one role</span>}
              <button className="btn-primary" disabled={!canLeaveDetails} onClick={() => go(1)}>Continue to templates →</button>
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Pick a template</h2>
            <p className="mt-1 text-sm text-slate-600">Required. Each template changes section order, header details and how the AI frames your experience.</p>
          </div>
          <TemplateSelector
            value={template}
            onChange={(t) => { setTemplate(t); setTemplateError(false); }}
            engagement={resume.engagement}
            onEngagementChange={(e) => setResume({ ...resume, engagement: e })}
            showError={templateError}
          />
          <div className="flex justify-between">
            <button className="btn-secondary" onClick={() => go(0)}>← Back</button>
            <button className="btn-primary" onClick={() => (template ? go(2) : setTemplateError(true))}>Continue →</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Set your optimization rules</h2>
            <p className="mt-1 text-sm text-slate-600">Tell Resume Buddy exactly how you want it written.</p>
          </div>
          <RulesInput rules={rules} onRules={setRules} targetRole={targetRole} onTargetRole={setTargetRole} jobDescription={jd} onJobDescription={setJd} />
          {genError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{genError}</p>}
          <div className="flex justify-between">
            <button className="btn-secondary" onClick={() => go(1)}>← Back</button>
            <button className="btn-primary px-6" onClick={generate} disabled={generating}>
              {generating ? (
                <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Optimizing…</>
              ) : (
                <>✨ Generate optimized resume</>
              )}
            </button>
          </div>
        </div>
      )}

      {step === 3 && result && template && (
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <div className="order-2 overflow-x-auto rounded-2xl bg-slate-100 p-3 sm:p-6 lg:order-1">
            <ResumePreview resume={result.resume} template={template} density={fit.density} pages={fit.pages} />
          </div>
          <aside className="order-1 space-y-4 lg:order-2 lg:sticky lg:top-20 lg:self-start">
            <div className="card p-5">
              <h2 className="font-semibold">Your resume is ready</h2>
              <p className="mt-1 text-sm text-slate-600">Download it, or go back to tweak details and regenerate.</p>
              <div className="mt-4"><ExportBar resume={result.resume} template={template} density={fit.density} onDownloaded={onDownloaded} /></div>
            </div>
            <div className="card space-y-2 p-5 text-sm">
              <p className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${generic === 0 ? "bg-emerald-500" : "bg-amber-500"}`} />
                Specificity: <strong>{generic === 0 ? "0 generic bullets" : `${generic} to review`}</strong>
              </p>
              <p className="text-slate-500">
                {result.source === "llm"
                  ? `Every bullet rewritten by AI${result.repairedBullets ? ` (${result.repairedBullets} sent back for a second pass)` : ""}.`
                  : `${result.repairedBullets} bullet${result.repairedBullets === 1 ? "" : "s"} optimized.`}
              </p>
              <p className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${fit.pages <= PAGE_TARGET[template].target ? "bg-emerald-500" : fit.overLimit ? "bg-rose-500" : "bg-amber-500"}`} />
                Length: <strong>{fit.pages} page{fit.pages > 1 ? "s" : ""}</strong>
                <span className="text-slate-500">· body {fit.density.body}pt</span>
              </p>
              {fit.overLimit && (
                <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800">
                  This runs past {PAGE_TARGET[template].max} pages even at the tightest spacing. Remove older roles or bullets, then regenerate.
                </p>
              )}
              <p className="text-slate-500">Engine: {result.source === "llm" ? "AI optimizer" : "Rule-based optimizer"}</p>
              {result.notice && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{result.notice}</p>}
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1 text-xs" onClick={() => go(0)}>Edit details</button>
              <button className="btn-secondary flex-1 text-xs" onClick={() => go(2)}>Change rules</button>
            </div>
          </aside>
        </div>
      )}

      {template && <FeedbackModal open={feedback.open} onClose={closeFeedback} template={template} format={feedback.format} />}
    </div>
  );
}
