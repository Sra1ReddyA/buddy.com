/**
 * PDF export (jsPDF) in Arial metrics (embedded Arimo), black & white, justified body text.
 *
 * The same renderer doubles as the layout measurer: fitLayout() renders the resume
 * at each density preset and keeps the most comfortable one that meets the template's
 * page target (Full-Time: 1 page, never more than 2). The DOCX exporter and the
 * on-screen preview reuse the chosen preset, so all three paginate the same way.
 */
import { jsPDF } from "jspdf";
import { DENSITIES, PAGE, PAGE_TARGET, TYPE, breakLines, buildDocModel, lineGap, tokenize, type Block, type Density, type Run, type Tok, type TokStyle } from "./layout";
import { TEMPLATES } from "./templates";
import type { ResumeData, TemplateId } from "./types";
import { loadResumeFonts, toBase64, type FontBytes } from "./fonts";

const FAMILY = "Arimo";
type Style = TokStyle;

function newDoc(fonts: { normal: string; italic: string; bold: string }) {
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true, putOnlyUsedFonts: true });
  (["normal", "italic", "bold"] as Style[]).forEach((s) => {
    doc.addFileToVFS(`Arimo-${s}.ttf`, fonts[s]);
    // one family name per face so PDF readers (and PDF→Word) can tell bold/italic apart
    doc.addFont(`Arimo-${s}.ttf`, `${FAMILY}-${s}`, "normal");
  });
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  return doc;
}

/** Draw one resume into `doc` at the given density. Returns the page count. */
function render(doc: jsPDF, blocks: Block[], d: Density): number {
  const M = d.margin;
  const W = PAGE.width - M * 2;
  const bodyLH = d.body * d.lineHeight;
  let y = M;

  const font = (style: Style, size: number) => {
    doc.setFont(`${FAMILY}-${style}`, "normal");
    doc.setFontSize(size);
  };
  const ensure = (h: number) => {
    if (y + h > PAGE.height - M + 0.01) {
      doc.addPage();
      y = M;
    }
  };
  const baseline = (size: number, lh: number) => y + (lh - size) / 2 + size * 0.86; // Arial ascent ≈ 0.905em

  /** Justified paragraph made of styled runs (e.g. "Languages: " bold + list). Breaks lines via the shared breaker. */
  const paragraph = (runs: Run[], x: number, width: number, size: number, firstLinePrefix?: () => void) => {
    const widthOf = (t: Tok) => {
      font(t.style, size);
      return doc.getTextWidth(t.w);
    };
    font("normal", size);
    const space = doc.getTextWidth(" ");
    const lines = breakLines(tokenize(runs), width, widthOf, space);
    const lh = size * d.lineHeight;
    ensure(lh * lines.length); // never split a bullet/paragraph across pages (matches keepLines in Word)
    lines.forEach((line, i) => {
      if (i === 0) firstLinePrefix?.();
      const gap = lineGap(line, width, widthOf, space, i === lines.length - 1);
      let cx = x;
      line.forEach((t) => {
        font(t.style, size);
        doc.text(t.w, cx, baseline(size, lh));
        cx += doc.getTextWidth(t.w) + gap;
      });
      y += lh;
    });
    y += d.paraAfter;
  };

  let prev: Block["kind"] | null = null;
  for (const b of blocks) {
    switch (b.kind) {
      case "name": {
        font("bold", TYPE.name);
        const lh = TYPE.name * 1.15;
        doc.text(b.text, PAGE.width / 2, baseline(TYPE.name, lh), { align: "center" });
        y += lh;
        break;
      }
      case "headline": {
        font("normal", TYPE.headline);
        const lh = TYPE.headline * 1.15;
        doc.text(b.text, PAGE.width / 2, baseline(TYPE.headline, lh), { align: "center" });
        y += lh;
        break;
      }
      case "contact":
      case "extras": {
        font(b.kind === "extras" ? "italic" : "normal", d.meta);
        const lh = d.meta * d.lineHeight;
        const text = b.kind === "contact" ? b.parts.join("  |  ") : b.text;
        (doc.splitTextToSize(text, W) as string[]).forEach((l) => {
          doc.text(l, PAGE.width / 2, baseline(d.meta, lh), { align: "center" });
          y += lh;
        });
        break;
      }
      case "section": {
        const lh = TYPE.section * 1.15;
        ensure(d.sectionBefore + lh + d.sectionAfter + bodyLH * 2); // keep header with its first lines
        y += d.sectionBefore;
        font("bold", TYPE.section);
        doc.setCharSpace(TYPE.sectionTracking);
        doc.text(b.title, M, baseline(TYPE.section, lh));
        doc.setCharSpace(0);
        y += lh;
        doc.setLineWidth(TYPE.rule);
        doc.line(M, y + 0.5, PAGE.width - M, y + 0.5);
        y += d.sectionAfter + 1;
        break;
      }
      case "row": {
        const primary = b.level === "primary";
        const size = primary ? d.body : d.meta;
        const lh = size * d.lineHeight;
        if (primary && prev !== "section") y += d.entryBefore;
        ensure(lh + (primary ? bodyLH : 0));
        font(primary ? "bold" : "italic", size);
        const rightStyle: Style = primary ? "normal" : "italic";
        const rightW = b.right ? (font(rightStyle, size), doc.getTextWidth(b.right)) : 0;
        font(primary ? "bold" : "italic", size);
        const leftLines = doc.splitTextToSize(b.left, Math.max(60, W - rightW - 12)) as string[];
        leftLines.forEach((l, i) => {
          if (i) ensure(lh);
          doc.text(l, M, baseline(size, lh));
          if (i === 0 && b.right) {
            font(rightStyle, size);
            doc.text(b.right, PAGE.width - M, baseline(size, lh), { align: "right" });
            font(primary ? "bold" : "italic", size);
          }
          y += lh;
        });
        break;
      }
      case "para":
        paragraph(b.runs, M, W, d.body);
        break;
      case "bullet":
        paragraph([{ text: b.text }], M + d.bulletIndent, W - d.bulletIndent, d.body, () => {
          font("normal", d.body);
          doc.text("•", M + 2, baseline(d.body, bodyLH));
        });
        break;
    }
    prev = b.kind;
  }
  return doc.getNumberOfPages();
}

let b64Cache: { normal: string; italic: string; bold: string } | null = null;
async function fontsB64() {
  if (!b64Cache) {
    const f: FontBytes = await loadResumeFonts();
    b64Cache = { normal: toBase64(f.normal), italic: toBase64(f.italic), bold: toBase64(f.bold) };
  }
  return b64Cache;
}

export type FitResult = { density: Density; pages: number; overLimit: boolean };

/**
 * Pick the most comfortable density that meets the template's page target.
 * If the target can't be met, pick the most comfortable density that stays within the
 * hard maximum; if even the tightest preset exceeds it, report overLimit.
 */
export async function fitLayout(r: ResumeData, template: TemplateId): Promise<FitResult> {
  const fonts = await fontsB64();
  const blocks = buildDocModel(r, template);
  const { target, max } = PAGE_TARGET[template];
  const counts = DENSITIES.map((d) => render(newDoc(fonts), blocks, d));
  const pick = (limit: number) => DENSITIES.findIndex((_, i) => counts[i] <= limit);
  let i = pick(target);
  if (i < 0) {
    // fewest pages possible, then the most comfortable density at that page count
    const fewest = Math.min(...counts);
    i = counts.indexOf(fewest);
  }
  return { density: DENSITIES[i], pages: counts[i], overLimit: counts[i] > max };
}

export async function resumeToPdfBlob(r: ResumeData, template: TemplateId, density?: Density): Promise<Blob> {
  const fonts = await fontsB64();
  const d = density ?? (await fitLayout(r, template)).density;
  const doc = newDoc(fonts);
  doc.setProperties({ title: `${r.contact.fullName || "Resume"} — ${TEMPLATES[template].name}`, creator: "Buddy — Resume Buddy" });
  render(doc, buildDocModel(r, template), d);
  return doc.output("blob");
}
