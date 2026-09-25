"use client";
import { useEffect, useRef, useState } from "react";
import { PAGE, TYPE, breakLines, buildDocModel, lineGap, tokenize, type Block, type Density, type Run, type Tok } from "@/lib/resume/layout";
import type { ResumeData, TemplateId } from "@/lib/resume/types";

let canvasCtx: CanvasRenderingContext2D | null = null;
function getCtx() {
  if (!canvasCtx && typeof document !== "undefined") canvasCtx = document.createElement("canvas").getContext("2d");
  return canvasCtx;
}

/**
 * True-scale replica of the exported document: same blocks, font, sizes (in pt),
 * margins and spacing as the PDF/DOCX. Scaled down with CSS to fit narrow screens.
 * Dashed lines mark where each page ends.
 */
export function ResumePreview({
  resume,
  template,
  density,
  pages,
}: {
  resume: ResumeData;
  template: TemplateId;
  density: Density;
  pages: number;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [fontsReady, setFontsReady] = useState(false);

  // Measure with the same Arial-metric font the PDF uses so the preview breaks lines identically.
  useEffect(() => {
    let alive = true;
    Promise.all(["400", "700", "italic 400"].map((w) => document.fonts.load(`${w} 12pt Arimo`)))
      .catch(() => {})
      .finally(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);
  const pagePx = (PAGE.width * 96) / 72; // 816px

  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e.contentRect.width / pagePx)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [pagePx]);

  const d = density;
  const blocks = buildDocModel(resume, template);
  const contentW = PAGE.width - d.margin * 2;

  /** Lines laid out by the shared breaker (canvas text metrics, px -> pt), each drawn with exact gaps. */
  const measured = (runs: Run[], width: number, size: number) => {
    const ctx = fontsReady ? getCtx() : null;
    if (!ctx) return null;
    const widthOf = (t: Tok) => {
      ctx.font = `${t.style === "italic" ? "italic " : ""}${t.style === "bold" ? 700 : 400} ${size}pt Arimo`;
      return ctx.measureText(t.w).width * 0.75;
    };
    ctx.font = `400 ${size}pt Arimo`;
    const space = ctx.measureText(" ").width * 0.75;
    const lines = breakLines(tokenize(runs), width, widthOf, space);
    return lines.map((line, i) => {
      const gap = lineGap(line, width, widthOf, space, i === lines.length - 1);
      return (
        <span key={i} style={{ display: "block", whiteSpace: "nowrap", wordSpacing: `${gap - space}pt` }}>
          {line.map((t, j) => (
            <span key={j} style={{ fontWeight: t.style === "bold" ? 700 : 400, fontStyle: t.style === "italic" ? "italic" : "normal" }}>
              {t.w}
              {j < line.length - 1 ? " " : ""}
            </span>
          ))}
        </span>
      );
    });
  };
  const lh = (size: number, mult = d.lineHeight) => `${size * mult}pt`;
  const heightPt = PAGE.height * Math.max(1, pages);

  let prev: Block["kind"] | null = null;
  const nodes = blocks.map((b, i) => {
    const before = prev;
    prev = b.kind;
    switch (b.kind) {
      case "name":
        return <h1 key={i} style={{ fontSize: `${TYPE.name}pt`, lineHeight: lh(TYPE.name, 1.15), fontWeight: 700, textAlign: "center", margin: 0 }}>{b.text}</h1>;
      case "headline":
        return <p key={i} style={{ fontSize: `${TYPE.headline}pt`, lineHeight: lh(TYPE.headline, 1.15), textAlign: "center", margin: 0 }}>{b.text}</p>;
      case "contact":
        return <p key={i} style={{ fontSize: `${d.meta}pt`, lineHeight: lh(d.meta), textAlign: "center", margin: 0, whiteSpace: "pre-wrap" }}>{b.parts.join("  |  ")}</p>;
      case "extras":
        return <p key={i} style={{ fontSize: `${d.meta}pt`, lineHeight: lh(d.meta), textAlign: "center", fontStyle: "italic", margin: 0, whiteSpace: "pre-wrap" }}>{b.text}</p>;
      case "section":
        return (
          <h2
            key={i}
            style={{
              fontSize: `${TYPE.section}pt`, lineHeight: lh(TYPE.section, 1.15), fontWeight: 700, letterSpacing: `${TYPE.sectionTracking}pt`,
              margin: `${d.sectionBefore}pt 0 ${d.sectionAfter + 1}pt`, borderBottom: `${TYPE.rule}pt solid #000`, paddingBottom: "0.5pt",
            }}
          >
            {b.title}
          </h2>
        );
      case "row": {
        const primary = b.level === "primary";
        const size = primary ? d.body : d.meta;
        return (
          <div
            key={i}
            style={{
              display: "flex", justifyContent: "space-between", gap: "12pt", fontSize: `${size}pt`, lineHeight: lh(size),
              marginTop: primary && before !== "section" ? `${d.entryBefore}pt` : 0, fontStyle: primary ? "normal" : "italic",
            }}
          >
            <span style={{ fontWeight: primary ? 700 : 400 }}>{b.left}</span>
            {b.right && <span style={{ flexShrink: 0 }}>{b.right}</span>}
          </div>
        );
      }
      case "para":
        return (
          <p key={i} style={{ fontSize: `${d.body}pt`, lineHeight: lh(d.body), textAlign: "justify", margin: `0 0 ${d.paraAfter}pt` }}>
            {measured(b.runs, contentW, d.body) ??
              b.runs.map((r, j) => (
                <span key={j} style={{ fontWeight: r.bold ? 700 : 400, fontStyle: r.italic ? "italic" : "normal" }}>{r.text}</span>
              ))}
          </p>
        );
      case "bullet":
        return (
          <p key={i} style={{ position: "relative", fontSize: `${d.body}pt`, lineHeight: lh(d.body), textAlign: "justify", margin: `0 0 ${d.paraAfter}pt`, paddingLeft: `${d.bulletIndent}pt` }}>
            <span aria-hidden style={{ position: "absolute", left: "2pt" }}>•</span>
            {measured([{ text: b.text }], contentW - d.bulletIndent, d.body) ?? b.text}
          </p>
        );
    }
  });

  return (
    <div ref={outer} className="w-full">
      <div style={{ height: `${(heightPt * 96) / 72 * scale}px` }}>
        <article
          aria-label="Resume preview"
          className="resume-paper origin-top-left bg-white text-black shadow-[0_10px_40px_-12px_rgba(15,23,42,0.25)] ring-1 ring-slate-200"
          style={{
            width: `${PAGE.width}pt`,
            minHeight: `${heightPt}pt`,
            padding: `${d.margin}pt`,
            transform: `scale(${scale})`,
            position: "relative",
          }}
        >
          {Array.from({ length: pages - 1 }, (_, p) => (
            <div
              key={p}
              aria-hidden
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-300"
              style={{ top: `${PAGE.height * (p + 1)}pt` }}
            >
              <span className="absolute right-2 -top-2.5 bg-white px-1 font-sans text-[10px] text-slate-400">Page {p + 2}</span>
            </div>
          ))}
          {nodes}
        </article>
      </div>
    </div>
  );
}
