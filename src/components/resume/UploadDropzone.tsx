"use client";
import { useRef, useState } from "react";
import type { ResumeData } from "@/lib/resume/types";

const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX = 5 * 1024 * 1024;

export function UploadDropzone({ onParsed }: { onParsed: (r: ResumeData, fileName: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!/\.(pdf|docx)$/i.test(file.name)) return setError("Please upload a PDF or Word (.docx) file. Older .doc files: save as .docx first.");
    if (file.size > MAX) return setError("That file is larger than 5 MB.");
    setBusy(file.name);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/resume/parse", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not read that file");
      onParsed(json.resume, file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload resume file"
        onClick={() => !busy && input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handle(e.dataTransfer.files[0]);
        }}
        className={`grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition ${
          drag ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-white hover:border-brand-400 hover:bg-slate-50"
        }`}
      >
        {busy ? (
          <div className="flex flex-col items-center gap-3">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
            <p className="font-medium">Reading {busy}…</p>
            <p className="text-sm text-slate-500">Extracting experience, skills and education</p>
          </div>
        ) : (
          <>
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-100 text-brand-700">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
            </span>
            <p className="mt-3 font-semibold">Drag & drop your resume, or <span className="text-brand-600">browse</span></p>
            <p className="mt-1 text-sm text-slate-500">PDF or Word (.docx), up to 5 MB</p>
          </>
        )}
        <input ref={input} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => handle(e.target.files?.[0])} />
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <p className="mt-3 text-xs text-slate-500">Your file is only used to extract text for this session and is not stored.</p>
    </div>
  );
}
