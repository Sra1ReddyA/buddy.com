/**
 * One layout spec for every template and every renderer.
 *
 * buildDocModel() turns resume data + template into a flat list of blocks.
 * The HTML preview, the PDF export and the DOCX export all draw that same list
 * with the same font metrics (Arial), sizes, margins and spacing, so Full-Time,
 * W2 and C2C line up exactly and the preview matches the downloaded files.
 *
 * Typography is 100% black & white:
 *   Name 14pt bold · headline 12pt · section headers 12pt bold caps
 *   Body 10–11pt (auto-fit) · meta lines 10pt
 */
import { TEMPLATES, contactLine, dateRange, hasSection, sectionHeading, type SectionKey } from "./templates";
import type { ResumeData, TemplateId } from "./types";

/**
 * Arial everywhere:
 * - DOCX names "Arial" directly (installed on every Windows/macOS machine; Arial itself can't be redistributed).
 * - PDF export and page-fit measurement embed Arimo (Apache/OFL), which has Arial's exact glyph widths,
 *   so line breaks and page counts computed here match Word's Arial layout.
 * - The preview uses Arial when installed, Arimo otherwise.
 */
export const FONT_FAMILY = "Arial";
export const FONT_FILES = {
  normal: "/fonts/Arimo-Regular.ttf",
  italic: "/fonts/Arimo-Italic.ttf",
  bold: "/fonts/Arimo-Bold.ttf",
} as const;

export const PAGE = { width: 612, height: 792 }; // US Letter in pt

/** Fixed header sizes (spec: headers 12–14pt). */
export const TYPE = {
  name: 14,
  headline: 12,
  section: 12,
  sectionTracking: 0.5, // pt letter-spacing on section headers
  rule: 0.5, // pt, rule under section headers
};

/** Spacing presets tried in order until the resume fits its page target (body stays within 10–11pt). */
export type Density = {
  id: "relaxed" | "standard" | "compact" | "tight";
  body: number; // pt
  meta: number; // pt — contact line, dates, italic sublines
  lineHeight: number; // multiple of font size
  margin: number; // pt, all four sides
  sectionBefore: number; // pt above a section header
  sectionAfter: number; // pt below the rule
  entryBefore: number; // pt above each role / degree / project
  paraAfter: number; // pt after paragraphs and bullets
  bulletIndent: number; // pt, text indent for bullets (glyph sits at 2pt)
};

export const DENSITIES: Density[] = [
  { id: "relaxed", body: 11, meta: 10, lineHeight: 1.2, margin: 54, sectionBefore: 11, sectionAfter: 4, entryBefore: 6, paraAfter: 1.5, bulletIndent: 12 },
  { id: "standard", body: 10.5, meta: 10, lineHeight: 1.16, margin: 47, sectionBefore: 9, sectionAfter: 3.5, entryBefore: 5, paraAfter: 1, bulletIndent: 12 },
  { id: "compact", body: 10, meta: 10, lineHeight: 1.13, margin: 40, sectionBefore: 7, sectionAfter: 3, entryBefore: 4, paraAfter: 0.5, bulletIndent: 11 },
  { id: "tight", body: 10, meta: 10, lineHeight: 1.08, margin: 36, sectionBefore: 5.5, sectionAfter: 2.5, entryBefore: 3, paraAfter: 0, bulletIndent: 11 },
];

export const densityById = (id: Density["id"]) => DENSITIES.find((d) => d.id === id) ?? DENSITIES[1];

export type Run = { text: string; bold?: boolean; italic?: boolean };

export type Block =
  | { kind: "name"; text: string }
  | { kind: "headline"; text: string }
  | { kind: "contact"; parts: string[] }
  | { kind: "extras"; text: string }
  | { kind: "section"; title: string }
  /** Two-column row: left text flush-left, right text flush-right (tab stop in Word). */
  | { kind: "row"; level: "primary" | "secondary"; left: string; right: string }
  | { kind: "para"; runs: Run[] }
  | { kind: "bullet"; text: string };

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function buildDocModel(r: ResumeData, template: TemplateId): Block[] {
  const t = TEMPLATES[template];
  const out: Block[] = [{ kind: "name", text: clean(r.contact.fullName) || "Your Name" }];
  if (r.contact.title.trim()) out.push({ kind: "headline", text: clean(r.contact.title) });
  const contacts = contactLine(r).map(clean);
  if (contacts.length) out.push({ kind: "contact", parts: contacts });
  const extras = t.headerExtras(r);
  if (extras.length) out.push({ kind: "extras", text: extras.join("  ·  ") });

  const section = (key: SectionKey) => out.push({ kind: "section", title: sectionHeading(t, key).toUpperCase() });

  for (const key of t.sections) {
    if (!hasSection(r, key)) continue;
    section(key);
    switch (key) {
      case "summary":
        out.push({ kind: "para", runs: [{ text: clean(r.summary) }] });
        break;

      case "skills":
        r.skills
          .filter((s) => s.items.some((i) => i.trim()))
          .forEach((s) =>
            out.push({
              kind: "para",
              runs: [
                ...(s.category.trim() ? [{ text: `${clean(s.category)}: `, bold: true }] : []),
                { text: s.items.map(clean).filter(Boolean).join(", ") },
              ],
            }),
          );
        break;

      case "experience":
        r.experience
          .filter((e) => e.company.trim() || e.role.trim())
          .forEach((e) => {
            // Row 1: Role ............ Dates    Row 2: Company — Client ............ Location
            out.push({ kind: "row", level: "primary", left: clean(e.role || e.company), right: clean(dateRange(e.startDate, e.endDate)) });
            const org = [e.role ? clean(e.company) : "", t.showClient && e.client.trim() ? `Client: ${clean(e.client)}` : ""]
              .filter(Boolean)
              .join(" — ");
            if (org || e.location.trim()) out.push({ kind: "row", level: "secondary", left: org, right: clean(e.location) });
            e.bullets.map(clean).filter(Boolean).forEach((b) => out.push({ kind: "bullet", text: b }));
          });
        break;

      case "projects":
        r.projects
          .filter((p) => p.name.trim())
          .forEach((p) => {
            out.push({ kind: "row", level: "primary", left: clean(p.name), right: clean(p.link) });
            if (p.tech.trim()) out.push({ kind: "row", level: "secondary", left: clean(p.tech), right: "" });
            p.bullets.map(clean).filter(Boolean).forEach((b) => out.push({ kind: "bullet", text: b }));
          });
        break;

      case "education":
        r.education
          .filter((e) => e.school.trim() || e.degree.trim())
          .forEach((e) => {
            const degree = [e.degree, e.field].map(clean).filter(Boolean).join(", ");
            out.push({ kind: "row", level: "primary", left: degree || clean(e.school), right: clean(dateRange(e.startDate, e.endDate)) });
            if (degree && e.school.trim()) out.push({ kind: "row", level: "secondary", left: clean(e.school), right: "" });
            if (e.details.trim()) out.push({ kind: "para", runs: [{ text: clean(e.details) }] });
          });
        break;

      case "certifications":
        r.certifications.map(clean).filter(Boolean).forEach((c) => out.push({ kind: "bullet", text: c }));
        break;
    }
  }
  return out;
}

/** Page-count target per template. Full-Time must fit one page (hard cap two). */
export const PAGE_TARGET: Record<TemplateId, { target: number; max: number }> = {
  "full-time": { target: 1, max: 2 },
  w2: { target: 1, max: 3 },
  c2c: { target: 1, max: 3 },
};

// ---------------------------------------------------------------------------
// Shared justified line breaking — used by the PDF renderer and the on-screen preview so both
// break lines exactly like Word does (Word lets inter-word spaces shrink up to ~20% when justifying).
// ---------------------------------------------------------------------------
export type TokStyle = "normal" | "italic" | "bold";
export type Tok = { w: string; style: TokStyle };
export const JUSTIFY_SHRINK = 0.25; // measured against Word-compatible layout (LibreOffice DOCX rendering)

export function tokenize(runs: Run[]): Tok[] {
  const out: Tok[] = [];
  runs.forEach((r) =>
    r.text.split(/\s+/).filter(Boolean).forEach((w) => out.push({ w, style: r.bold ? "bold" : r.italic ? "italic" : "normal" })),
  );
  return out;
}

/** Greedy break; a word stays on the line if it fits once every gap is squeezed by JUSTIFY_SHRINK. */
export function breakLines(toks: Tok[], width: number, widthOf: (t: Tok) => number, space: number): Tok[][] {
  const lines: Tok[][] = [];
  let cur: Tok[] = [];
  let curW = 0;
  for (const t of toks) {
    const tw = widthOf(t);
    const next = cur.length ? curW + space + tw : tw;
    if (cur.length && next - cur.length * space * JUSTIFY_SHRINK > width + 0.01) {
      lines.push(cur);
      cur = [t];
      curW = tw;
    } else {
      cur.push(t);
      curW = next;
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** Width of each inter-word gap: justified lines fill `width`; a last line keeps normal spacing unless squeezed. */
export function lineGap(line: Tok[], width: number, widthOf: (t: Tok) => number, space: number, last: boolean): number {
  if (line.length < 2) return space;
  const total = line.reduce((s, t) => s + widthOf(t), 0);
  const natural = total + space * (line.length - 1);
  return !last || natural > width ? (width - total) / (line.length - 1) : space;
}
