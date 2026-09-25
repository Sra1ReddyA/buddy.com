"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import type { Tool } from "@/lib/tools";
import { ToolIcon } from "./ToolIcon";

export function ComingSoonModal({ tool, onClose }: { tool: Tool | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!tool) return;
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus();
    };
  }, [tool, onClose]);

  if (!tool) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="presentation">
      <div className="absolute inset-0 animate-fade bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="coming-soon-title"
        className="card relative w-full max-w-md animate-pop p-6 text-center shadow-xl"
      >
        <button ref={closeRef} onClick={onClose} className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <div className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br ${tool.accent} text-white shadow-lg`}>
          <ToolIcon icon={tool.icon} className="h-7 w-7" />
        </div>
        <span className="mt-4 inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Coming soon</span>
        <h2 id="coming-soon-title" className="mt-3 text-xl font-semibold tracking-tight">{tool.name} is on the way</h2>
        <p className="mt-2 text-sm text-slate-600">
          We&apos;re putting the finishing touches on {tool.name}. {tool.description}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link href="/resume-buddy" className="btn-primary">Try Resume Buddy now</Link>
          <button onClick={onClose} className="btn-secondary">Got it</button>
        </div>
      </div>
    </div>
  );
}
