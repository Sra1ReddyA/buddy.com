"use client";
import type { ToolId } from "./tools";
import type { TemplateId } from "./resume/types";

type ClientAction = "open" | "coming_soon_click" | "upload" | "download_pdf" | "download_docx";

/** Fire-and-forget usage event. Uses sendBeacon so it survives navigation. */
export function trackUsage(tool: ToolId, action: ClientAction, template?: TemplateId) {
  const body = JSON.stringify({ tool, action, template });
  try {
    if (navigator.sendBeacon?.("/api/track/usage", new Blob([body], { type: "application/json" }))) return;
  } catch {}
  fetch("/api/track/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}

export type ConversionReport = {
  tool: "pdf-to-word" | "word-to-pdf";
  status: "success" | "failed";
  inputBytes: number;
  outputBytes?: number;
  pages?: number;
  durationMs?: number;
  errorCode?: string;
};

/** Report a finished conversion (metrics only — the file never leaves the browser). */
export function trackConversion(r: ConversionReport) {
  fetch("/api/track/conversion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(r), keepalive: true }).catch(() => {});
}
