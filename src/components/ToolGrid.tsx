"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { TOOLS, type Tool } from "@/lib/tools";
import { trackUsage } from "@/lib/track-client";
import { ToolIcon } from "./ToolIcon";
import { ComingSoonModal } from "./ComingSoonModal";

export function ToolGrid() {
  const [pending, setPending] = useState<Tool | null>(null);
  const close = useCallback(() => setPending(null), []);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {TOOLS.map((tool) => {
          const inner = (
            <>
              <div className="flex items-start justify-between">
                <div className={`grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br ${tool.accent} text-white shadow-md transition group-hover:scale-105`}>
                  <ToolIcon icon={tool.icon} />
                </div>
                {tool.active ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">Live</span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">Coming soon</span>
                )}
              </div>
              <h3 className="mt-4 text-lg font-semibold tracking-tight">{tool.name}</h3>
              <p className="text-sm font-medium text-slate-500">{tool.tagline}</p>
              <p className="mt-2 text-sm text-slate-600">{tool.description}</p>
              <span className={`mt-4 inline-flex items-center gap-1 text-sm font-semibold ${tool.active ? "text-brand-600" : "text-slate-400"}`}>
                {tool.active ? "Open tool" : "Preview"}
                <svg viewBox="0 0 24 24" className="h-4 w-4 transition group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </span>
            </>
          );
          const cls = `group card p-6 text-left transition hover:-translate-y-0.5 hover:shadow-md ${tool.active ? "sm:col-span-2" : ""}`;
          return tool.active ? (
            <Link key={tool.id} href={tool.href} className={cls} onClick={() => trackUsage(tool.id, "open")}>
              {inner}
            </Link>
          ) : (
            <button
              key={tool.id}
              type="button"
              className={`${cls} opacity-95`}
              onClick={() => {
                trackUsage(tool.id, "coming_soon_click");
                setPending(tool);
              }}
              aria-haspopup="dialog"
            >
              {inner}
            </button>
          );
        })}
      </div>
      <ComingSoonModal tool={pending} onClose={close} />
    </>
  );
}
