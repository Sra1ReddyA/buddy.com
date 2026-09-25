/**
 * Word export built with the `docx` library (real OOXML, no HTML-to-Word conversion).
 *
 * Why it stays editable and matches the PDF:
 * - Single column: no tables, text boxes or floating shapes that break when edited.
 * - Named paragraph styles (Resume Body, Resume Section, Resume Role, ...) editable in Word's Styles pane.
 * - Real Word bullets (numbering definition), so Enter creates the next bullet.
 * - Dates and locations sit on a right-aligned TAB STOP, not in a second column.
 * - Arial throughout, with line spacing set to EXACT points, so Word lays text out with the
 *   same metrics the PDF and page-fit measurement use (Arimo = Arial's glyph widths).
 * - Body paragraphs and bullets are justified (flush to both margins); all text is black.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  LineRuleType,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
} from "docx";
import { FONT_FAMILY, PAGE, TYPE, buildDocModel, type Block, type Density } from "./layout";
import { TEMPLATES } from "./templates";
import type { ResumeData, TemplateId } from "./types";

const tw = (pt: number) => Math.round(pt * 20); // points -> twips
const hp = (pt: number) => Math.round(pt * 2); // points -> half-points
const exact = (size: number, lh: number) => ({ line: tw(size * lh), lineRule: LineRuleType.EXACT });

function paragraphsFor(blocks: Block[], d: Density): Paragraph[] {
  const contentW = PAGE.width - d.margin * 2;
  const out: Paragraph[] = [];
  let prev: Block["kind"] | null = null;

  for (const b of blocks) {
    switch (b.kind) {
      case "name":
        out.push(new Paragraph({ style: "ResumeName", children: [new TextRun(b.text)] }));
        break;
      case "headline":
        out.push(new Paragraph({ style: "ResumeHeadline", children: [new TextRun(b.text)] }));
        break;
      case "contact":
        out.push(
          new Paragraph({
            style: "ResumeMeta",
            alignment: AlignmentType.CENTER,
            children: b.parts.flatMap((p, i) => [...(i ? [new TextRun("  |  ")] : []), new TextRun(p)]),
          }),
        );
        break;
      case "extras":
        out.push(new Paragraph({ style: "ResumeMeta", alignment: AlignmentType.CENTER, children: [new TextRun({ text: b.text, italics: true })] }));
        break;
      case "section":
        out.push(
          new Paragraph({
            style: "ResumeSection",
            spacing: { before: tw(d.sectionBefore), after: tw(d.sectionAfter + 1), ...exact(TYPE.section, 1.15) },
            children: [new TextRun(b.title)],
          }),
        );
        break;
      case "row": {
        const primary = b.level === "primary";
        const size = primary ? d.body : d.meta;
        out.push(
          new Paragraph({
            style: primary ? "ResumeRole" : "ResumeRoleSub",
            keepNext: true,
            keepLines: true,
            spacing: { before: primary && prev !== "section" ? tw(d.entryBefore) : 0, after: 0, ...exact(size, d.lineHeight) },
            tabStops: [{ type: TabStopType.RIGHT, position: tw(contentW) }],
            children: [
              new TextRun({ text: b.left, bold: primary, italics: !primary }),
              ...(b.right ? [new TextRun({ text: `\t${b.right}`, bold: false, italics: !primary })] : []),
            ],
          }),
        );
        break;
      }
      case "para":
        out.push(
          new Paragraph({
            style: "ResumeBody",
            children: b.runs.map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic })),
          }),
        );
        break;
      case "bullet":
        out.push(new Paragraph({ style: "ResumeBody", numbering: { reference: "resume-bullets", level: 0 }, children: [new TextRun(b.text)] }));
        break;
    }
    prev = b.kind;
  }
  return out;
}

export function buildResumeDocx(r: ResumeData, template: TemplateId, d: Density): Document {
  const t = TEMPLATES[template];
  const black = "000000";
  const run = (size: number, extra: object = {}) => ({ font: FONT_FAMILY, size: hp(size), color: black, ...extra });

  return new Document({
    creator: "Buddy — Resume Buddy",
    title: `${r.contact.fullName || "Resume"} — ${t.name}`,
    description: "Generated with Resume Buddy",
    styles: {
      default: {
        document: {
          run: run(d.body),
          paragraph: { spacing: { before: 0, after: 0, ...exact(d.body, d.lineHeight) } },
        },
      },
      paragraphStyles: [
        { id: "ResumeName", name: "Resume Name", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: run(TYPE.name, { bold: true }),
          paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0, ...exact(TYPE.name, 1.15) } } },
        { id: "ResumeHeadline", name: "Resume Headline", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: run(TYPE.headline),
          paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0, ...exact(TYPE.headline, 1.15) } } },
        { id: "ResumeMeta", name: "Resume Meta", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: run(d.meta),
          paragraph: { spacing: { before: 0, after: 0, ...exact(d.meta, d.lineHeight) } } },
        { id: "ResumeSection", name: "Resume Section", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: run(TYPE.section, { bold: true, characterSpacing: tw(TYPE.sectionTracking) }),
          paragraph: {
            keepNext: true,
            keepLines: true,
            border: { bottom: { style: BorderStyle.SINGLE, size: Math.round(TYPE.rule * 8), color: black, space: 1 } },
          } },
        { id: "ResumeRole", name: "Resume Role", basedOn: "Normal", next: "Normal", quickFormat: true, run: run(d.body) },
        { id: "ResumeRoleSub", name: "Resume Role Detail", basedOn: "Normal", next: "Normal", quickFormat: true, run: run(d.meta) },
        { id: "ResumeBody", name: "Resume Body", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: run(d.body),
          paragraph: { alignment: AlignmentType.JUSTIFIED, keepLines: true, spacing: { before: 0, after: tw(d.paraAfter), ...exact(d.body, d.lineHeight) } } },
      ],
    },
    numbering: {
      config: [
        {
          reference: "resume-bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: {
                run: run(d.body),
                paragraph: { indent: { left: tw(d.bulletIndent), hanging: tw(d.bulletIndent - 2) } },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: tw(PAGE.width), height: tw(PAGE.height) },
            margin: { top: tw(d.margin), bottom: tw(d.margin), left: tw(d.margin), right: tw(d.margin), header: 0, footer: 0 },
          },
        },
        children: paragraphsFor(buildDocModel(r, template), d),
      },
    ],
  });
}

export async function resumeToDocxBlob(r: ResumeData, template: TemplateId, density: Density): Promise<Blob> {
  return Packer.toBlob(buildResumeDocx(r, template, density));
}
