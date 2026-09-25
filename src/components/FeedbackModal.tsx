"use client";
import { useEffect, useState } from "react";
import { StarRating } from "./StarRating";
import type { TemplateId } from "@/lib/resume/types";

type FeedbackTool = "resume-buddy" | "pdf-to-word" | "word-to-pdf";
const TOOL_NAMES: Record<FeedbackTool, string> = { "resume-buddy": "Resume Buddy", "pdf-to-word": "PDF to Word", "word-to-pdf": "Word to PDF" };
type Props = { open: boolean; onClose: () => void; template?: TemplateId; format: "pdf" | "docx"; tool?: FeedbackTool };

/** Shown right after a successful download. Saves a 1–5 rating (+ optional comment) to /api/feedback. */
export function FeedbackModal({ open, onClose, template, format, tool = "resume-buddy" }: Props) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (state !== "done") return;
    const t = setTimeout(onClose, 1800);
    return () => clearTimeout(t);
  }, [state, onClose]);

  if (!open) return null;

  async function submit() {
    if (!rating) return;
    setState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment: comment.trim() || undefined, template, format, tool }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end p-4 sm:place-items-center">
      <div className="absolute inset-0 animate-fade bg-slate-900/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="fb-title" className="card relative w-full max-w-sm animate-pop p-6 text-center shadow-xl">
        {state === "done" ? (
          <div className="py-4">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-600">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="m5 12 5 5L20 7" /></svg>
            </div>
            <p className="mt-3 font-semibold">Thanks for the feedback!</p>
            <p className="text-sm text-slate-500">{tool === "resume-buddy" ? "Good luck with the applications." : "It helps us make Buddy better."}</p>
          </div>
        ) : (
          <>
            <button onClick={onClose} className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Skip feedback">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
            <p className="text-2xl" aria-hidden>🎉</p>
            <h2 id="fb-title" className="mt-1 text-lg font-semibold">{tool === "resume-buddy" ? "Your resume is downloading" : "Your file is downloading"}</h2>
            <p className="mt-1 text-sm text-slate-600">How was your experience with {TOOL_NAMES[tool]}?</p>
            <div className="mt-4"><StarRating value={rating} onChange={setRating} /></div>
            {rating > 0 && (
              <textarea
                className="input mt-2 min-h-20 animate-pop text-left"
                placeholder={rating <= 3 ? "What could we do better? (optional)" : "Anything you loved? (optional)"}
                maxLength={1000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            )}
            {state === "error" && <p className="mt-2 text-sm text-rose-600">Couldn&apos;t send — please try again.</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={onClose} className="btn-ghost flex-1">Maybe later</button>
              <button onClick={submit} disabled={!rating || state === "sending"} className="btn-primary flex-1">
                {state === "sending" ? "Sending…" : "Submit"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
