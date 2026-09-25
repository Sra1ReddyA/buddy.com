"use client";
import { useState } from "react";
import type { ResumeData, TemplateId } from "@/lib/resume/types";
import type { Density } from "@/lib/resume/layout";
import { trackUsage } from "@/lib/track-client";

type Format = "pdf" | "docx";

function fileName(r: ResumeData, template: TemplateId, ext: string) {
  const name = (r.contact.fullName || "Resume").trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "_");
  return `${name}_Resume_${template.toUpperCase()}.${ext}`;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download buttons. Export libraries are code-split and only load on click. */
export function ExportBar({
  resume,
  template,
  density,
  onDownloaded,
}: {
  resume: ResumeData;
  template: TemplateId;
  /** Spacing preset chosen by fitLayout(), shared by PDF and DOCX so both paginate identically */
  density: Density;
  onDownloaded: (format: Format) => void;
}) {
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: Format) {
    setBusy(format);
    setError(null);
    try {
      if (format === "pdf") {
        const { resumeToPdfBlob } = await import("@/lib/resume/export-pdf");
        saveBlob(await resumeToPdfBlob(resume, template, density), fileName(resume, template, "pdf"));
      } else {
        const { resumeToDocxBlob } = await import("@/lib/resume/export-docx");
        saveBlob(await resumeToDocxBlob(resume, template, density), fileName(resume, template, "docx"));
      }
      trackUsage("resume-buddy", format === "pdf" ? "download_pdf" : "download_docx", template);
      onDownloaded(format);
    } catch (e) {
      console.error(e);
      setError("Export failed — please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={!!busy} onClick={() => download("pdf")}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 4v12m0 0-4-4m4 4 4-4M4 20h16" /></svg>
          {busy === "pdf" ? "Preparing PDF…" : "Download PDF"}
        </button>
        <button className="btn-secondary" disabled={!!busy} onClick={() => download("docx")}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 4v12m0 0-4-4m4 4 4-4M4 20h16" /></svg>
          {busy === "docx" ? "Preparing Word…" : "Download Word (.docx)"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}
