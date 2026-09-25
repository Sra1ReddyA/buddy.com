/**
 * PDF → Word (.docx), entirely in the browser.
 *
 * A PDF is a set of positioned glyphs, not a document. This module rebuilds real Word structure from
 * those positions so the result is cleanly editable — nothing is placed in fixed text boxes:
 *
 *   glyphs → lines → (columns?) → blocks:
 *     • paragraphs (reflowable, with alignment, indents, spacing, line spacing)
 *     • headings (Heading 1–3 styles, from font size tiers)
 *     • bulleted / numbered lists (real Word numbering)
 *     • tables (from column-aligned rows)
 *     • tab-aligned lines (e.g. "Title ........ Date" → right tab stop)
 *     • images (inline, or behind text when they sit under text such as letterheads)
 *     • hyperlinks, repeating headers/footers (with page-number fields), multi-column pages (Word columns)
 *
 * Fonts are mapped to standard Word fonts; bold/italic come from the embedded font's style flags,
 * text colour is sampled from a render of the page (browser only).
 * Scanned PDFs (images only, no text layer) are placed as full-page images — OCR is not included.
 */
import {
  AlignmentType,
  ColumnBreak,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  SectionType,
  Tab,
  TabStopType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  TextWrappingType,
  VerticalPositionRelativeFrom,
  WidthType,
  BorderStyle,
  type ISectionOptions,
  type ParagraphChild,
} from "docx";
import { encodePng } from "./png";
import { fixedPage, formStats, injectShapes, newFixedDoc } from "./pdf-fixed";
import { METRICS, compatFor } from "./fonts";

// ---------------------------------------------------------------------------
// Extraction types
// ---------------------------------------------------------------------------
type FontInfo = { family: string; bold: boolean; italic: boolean; mono: boolean; serif: boolean };
type Glyph = { s: string; x: number; y: number; w: number; size: number; font: FontInfo; color?: string; link?: string; vert?: "super" | "sub"; spaceBefore?: boolean; joined?: boolean };
type Seg = { x: number; right: number; glyphs: Glyph[] };
type TLine = { y: number; size: number; maxSize: number; x: number; right: number; segs: Seg[]; bold: boolean; text: string };
type Img = { x: number; y: number; w: number; h: number; png: Uint8Array; /** paint order on the page */ z?: number };
/** Path command in page coordinates (points, top-left origin). */
export type PathCmd = { op: "M" | "L" | "C" | "Z"; pts: number[] };
/**
 * A painted vector shape, in paint order (z). "rect" is an axis-aligned rectangle (also used for straight
 * horizontal/vertical strokes, as a filled rectangle of the stroke's thickness); "path" keeps the full geometry.
 */
export type Shape = {
  kind: "rect" | "path";
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  stroke?: string;
  lw: number;
  z: number;
  cmds?: PathCmd[];
  /** straight line drawn as a stroke (stored as a thin filled rect) */
  line?: boolean;
};
type Rule = { x: number; right: number; y: number; width: number; color: string };
/** Rotated text run (kept only by the exact-layout converter). x/y = baseline origin; angle in degrees, clockwise, y-down. */
export type RotText = { text: string; x: number; y: number; len: number; size: number; angle: number; font: FontInfo };
type PageData = { w: number; h: number; lines: TLine[]; images: Img[]; rules: Rule[]; shapes: Shape[]; rotated: RotText[]; scanned: boolean };
export type { Glyph, Seg, TLine, Img, PageData, FontInfo };

export type PdfToDocxResult = {
  blob: Blob;
  pages: number;
  warnings: string[];
  /** pages converted with exact (form) layout */
  exactPages: number;
  pageModes: ("exact" | "flow" | "scan")[];
};
/**
 * auto  — forms (boxes, grids, label/value fields) keep their exact page geometry; prose pages flow.
 * exact — every page keeps its exact geometry (best visual match, one Word page per PDF page).
 * flow  — every page becomes flowing, reflowable paragraphs (best for editing long text).
 */
export type LayoutMode = "auto" | "exact" | "flow";
export type Progress = (done: number, total: number) => void;

const round = (v: number, p = 1) => Math.round(v * p) / p;
const tw = (pt: number) => Math.round(pt * 20);
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

// ---------------------------------------------------------------------------
// Font mapping
// ---------------------------------------------------------------------------
const WORD_FONTS: [RegExp, string][] = [
  [/calibri|carlito/i, "Calibri"],
  [/cambria|caladea/i, "Cambria"],
  [/aptos/i, "Aptos"],
  [/arial|arimo|helvetica|liberationsans|nimbussans/i, "Arial"],
  [/times|tinos|liberationserif|nimbusrom/i, "Times New Roman"],
  [/courier|cousine|liberationmono|nimbusmono/i, "Courier New"],
  [/georgia/i, "Georgia"],
  [/verdana/i, "Verdana"],
  [/tahoma/i, "Tahoma"],
  [/garamond/i, "Garamond"],
  [/segoe/i, "Segoe UI"],
  [/trebuchet/i, "Trebuchet MS"],
  [/centurygothic/i, "Century Gothic"],
  [/century/i, "Century"],
  [/bookantiqua|palatino/i, "Palatino Linotype"],
  [/consolas/i, "Consolas"],
  [/opensans/i, "Open Sans"],
  [/roboto/i, "Roboto"],
  [/lato/i, "Lato"],
  [/symbol|opensymbol|wingdings|dingbat/i, "Symbol"],
];

function macStyle(data?: Uint8Array): number {
  if (!data || data.length < 12) return 0;
  try {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const n = dv.getUint16(4);
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16;
      if (String.fromCharCode(data[o], data[o + 1], data[o + 2], data[o + 3]) === "head") return dv.getUint16(dv.getUint32(o + 8) + 44);
    }
  } catch {
    /* ignore */
  }
  return 0;
}

function fontInfo(raw: { name?: string; data?: Uint8Array; isSerifFont?: boolean; isMonospace?: boolean } | null, cssFamily?: string): FontInfo {
  const name = (raw?.name ?? "").replace(/^[A-Z]{6}\+/, "");
  const flat = name.replace(/[\s_-]/g, "");
  const style = macStyle(raw?.data);
  const bold = !!(style & 1) || /bold|black|heavy|semibold|demibold|extrabold|,b$/i.test(name);
  const italic = !!(style & 2) || /italic|oblique|,i$/i.test(name);
  const mono = !!raw?.isMonospace || cssFamily === "monospace";
  const serif = !!raw?.isSerifFont || cssFamily === "serif";
  let family = WORD_FONTS.find(([re]) => re.test(flat))?.[1];
  if (!family) family = mono ? "Courier New" : serif ? "Times New Roman" : "Calibri";
  return { family, bold, italic, mono, serif };
}

/** Symbol-font and private-use glyphs (common for bullets) → Unicode. */
function normalizeSymbols(s: string, fi: FontInfo): string {
  const map: Record<string, string> = {
    "\uF0B7": "•", "\uF0A7": "▪", "\uF0D8": "►", "\uF0FC": "✓", "\uF076": "❖", "\uF06E": "■", "\uF0A8": "□",
    "\uF0E0": "→", "\uF0A2": "•", "\uF0B0": "°", "\uF02D": "–",
  };
  let out = [...s].map((ch) => map[ch] ?? (/[\uE000-\uF8FF]/.test(ch) ? "•" : ch)).join("");
  if (fi.family === "Symbol" && out === "·") out = "•";
  return out;
}

// ---------------------------------------------------------------------------
// Page extraction (pdf.js via unpdf)
// ---------------------------------------------------------------------------
type PdfJs = Awaited<ReturnType<typeof import("unpdf")["getResolvedPDFJS"]>>;

async function imageToPng(obj: { width: number; height: number; kind?: number; data?: Uint8ClampedArray | Uint8Array; bitmap?: ImageBitmap }): Promise<Uint8Array | null> {
  const { width, height } = obj;
  if (!width || !height) return null;
  if (obj.bitmap && typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    c.getContext("2d")!.drawImage(obj.bitmap, 0, 0);
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }
  if (!obj.data) return null;
  if (obj.kind === 1) {
    // 1 bit per pixel grayscale → expand to 8-bit gray
    const rowBytes = (width + 7) >> 3;
    const gray = new Uint8Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) gray[y * width + x] = obj.data[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7)) ? 255 : 0;
    return encodePng(gray, width, height, 1);
  }
  const channels = obj.kind === 3 ? 4 : 3;
  if (obj.data.length < width * height * channels) return null;
  return encodePng(obj.data, width, height, channels as 3 | 4);
}

async function extractPage(pdfjs: PdfJs, page: any, warnings: Set<string>): Promise<PageData> {
  const vp = page.getViewport({ scale: 1 });
  const [tc, ops, annots] = await Promise.all([
    page.getTextContent({ includeMarkedContent: false }),
    page.getOperatorList(),
    page.getAnnotations().catch(() => []),
  ]);
  const Util = pdfjs.Util;

  // links
  const links = (annots as any[])
    .filter((a) => a.subtype === "Link" && a.url)
    .map((a) => {
      const m = vp.transform as number[];
      const pt = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
      const [p1, p2] = [pt(a.rect[0], a.rect[1]), pt(a.rect[2], a.rect[3])];
      const r = [p1[0], p1[1], p2[0], p2[1]];
      return { x1: Math.min(r[0], r[2]), y1: Math.min(r[1], r[3]), x2: Math.max(r[0], r[2]), y2: Math.max(r[1], r[3]), url: a.url as string };
    });

  // glyph runs
  const fontCache = new Map<string, FontInfo>();
  const glyphs: Glyph[] = [];
  const rotated: RotText[] = [];
  for (const it of tc.items as any[]) {
    if (!("str" in it) || !it.str || !it.str.trim()) continue;
    const t = Util.transform(vp.transform, it.transform);
    const isRotated = Math.abs(t[1]) > Math.abs(t[0]) * 0.05 || Math.abs(t[2]) > Math.abs(t[3]) * 0.05;
    const size = Math.hypot(t[2], t[3]);
    if (size < 1) continue;
    let fi = fontCache.get(it.fontName);
    if (!fi) {
      let raw = null;
      try {
        raw = page.commonObjs.get(it.fontName);
      } catch {
        /* not loaded */
      }
      fi = fontInfo(raw, tc.styles[it.fontName]?.fontFamily);
      fontCache.set(it.fontName, fi);
    }
    if (isRotated) {
      // rotated text doesn't fit the line model; the exact-layout converter places it in a rotated text box
      const angle = (Math.atan2(t[1], t[0]) * 180) / Math.PI;
      rotated.push({ text: normalizeSymbols(it.str, fi), x: t[4], y: t[5], len: Math.abs(it.width) * (vp.scale ?? 1) || it.str.length * size * 0.5, size, angle, font: fi });
      continue;
    }
    const w = it.width * (vp.scale ?? 1);
    const str: string = it.str;
    // split each text item into words so links and colours attach to the right words
    // (x positions inside an item are proportional to character count)
    const avg = w / Math.max(1, str.length);
    for (const m of str.matchAll(/\S+/g)) {
      const s = normalizeSymbols(m[0], fi);
      const g: Glyph = { s, x: t[4] + m.index! * avg, y: t[5], w: m[0].length * avg, size, font: fi };
      if (m.index! > 0) {
        g.spaceBefore = /\s/.test(str[m.index! - 1]);
        g.joined = true; // same PDF text item as the previous word: never split into separate segments
      }
      const cx = g.x + g.w / 2;
      const cy = g.y - size * 0.35;
      const link = links.find((l) => cx >= l.x1 && cx <= l.x2 && cy >= l.y1 - 2 && cy <= l.y2 + 2);
      if (link) g.link = link.url;
      glyphs.push(g);
    }
  }

  // fillable-form fields: their values live in widget annotations, not in the page's text
  glyphs.push(...widgetGlyphs(annots as any[], vp.transform as number[]));

  // images: walk the operator list tracking the transformation matrix
  const images: Img[] = [];
  const rules: Rule[] = [];
  const shapes: Shape[] = [];
  let z = 0;
  const MAX_SHAPES = 3000;
  const OPS = pdfjs.OPS;
  let ctm = [1, 0, 0, 1, 0, 0];
  let lineWidth = 1;
  let stroke = "000000";
  let fill = "000000";
  const stack: { ctm: number[]; lineWidth: number; stroke: string; fill: string }[] = [];
  const hex = (r: number, g: number, b: number) => [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push({ ctm, lineWidth, stroke, fill });
    else if (fn === OPS.restore) ({ ctm, lineWidth, stroke, fill } = stack.pop() ?? { ctm: [1, 0, 0, 1, 0, 0], lineWidth: 1, stroke: "000000", fill: "000000" });
    else if (fn === OPS.transform) ctm = Util.transform(ctm, args);
    // Form XObjects (used by form generators for logos, seals, signatures, barcodes) carry their own
    // /Matrix. pdf.js applies it inside paintFormXObjectBegin without emitting save/transform ops, so
    // track it here — otherwise images inside forms come out at the wrong (usually smaller) size.
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push({ ctm, lineWidth, stroke, fill });
      const matrix = args?.[0];
      if (Array.isArray(matrix) || ArrayBuffer.isView(matrix)) {
        const mx = Array.from(matrix as ArrayLike<number>);
        if (mx.length === 6 && mx.every(Number.isFinite)) ctm = Util.transform(ctm, mx);
      }
    } else if (fn === OPS.paintFormXObjectEnd) ({ ctm, lineWidth, stroke, fill } = stack.pop() ?? { ctm: [1, 0, 0, 1, 0, 0], lineWidth: 1, stroke: "000000", fill: "000000" });
    else if (fn === OPS.setLineWidth) lineWidth = args[0];
    else if (fn === OPS.setStrokeRGBColor) stroke = typeof args[0] === "string" ? args[0].replace("#", "").toUpperCase() : hex(args[0], args[1], args[2]);
    else if (fn === OPS.setFillRGBColor) fill = typeof args[0] === "string" ? args[0].replace("#", "").toUpperCase() : hex(args[0], args[1], args[2]);
    else if (fn === OPS.constructPath) {
      const m = Util.transform(vp.transform, ctm);
      if (shapes.length < MAX_SHAPES) collectShapes(args, m, lineWidth, stroke, fill, OPS, shapes, () => z++);
      else warnings.add("This page has very complex vector artwork; some of it was left out.");
      // thin horizontal strokes/fills become paragraph borders (section rules, underlines of headings)
      const mm = args[2];
      if (!mm || mm.length < 4) continue;
      const p1 = [m[0] * mm[0] + m[2] * mm[1] + m[4], m[1] * mm[0] + m[3] * mm[1] + m[5]];
      const p2 = [m[0] * mm[2] + m[2] * mm[3] + m[4], m[1] * mm[2] + m[3] * mm[3] + m[5]];
      const box = { x: Math.min(p1[0], p2[0]), right: Math.max(p1[0], p2[0]), y1: Math.min(p1[1], p2[1]), y2: Math.max(p1[1], p2[1]) };
      const scale = Math.hypot(m[0], m[1]);
      const isFill = args[0] === OPS.fill || args[0] === OPS.eoFill;
      const height = box.y2 - box.y1 + (isFill ? 0 : lineWidth * scale);
      if (box.right - box.x >= 40 && height <= 3.5) rules.push({ x: box.x, right: box.right, y: (box.y1 + box.y2) / 2, width: Math.max(0.25, isFill ? box.y2 - box.y1 : lineWidth * scale), color: isFill ? fill : stroke });
    }
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const m = Util.transform(vp.transform, ctm);
      const corners = [
        [m[4], m[5]],
        [m[0] + m[4], m[1] + m[5]],
        [m[2] + m[4], m[3] + m[5]],
        [m[0] + m[2] + m[4], m[1] + m[3] + m[5]],
      ];
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      if (box.w < 4 || box.h < 4) continue;
      let obj: any = null;
      if (fn === OPS.paintInlineImageXObject) obj = args[0];
      else {
        const store = String(args[0]).startsWith("g_") ? page.commonObjs : page.objs;
        // image data is decoded asynchronously; wait for it (with a timeout)
        obj = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), 8000);
          try {
            store.get(args[0], (o: unknown) => {
              clearTimeout(timer);
              resolve(o);
            });
          } catch {
            clearTimeout(timer);
            resolve(null);
          }
        });
      }
      const png = obj ? await imageToPng(obj).catch(() => null) : null;
      if (png) images.push({ ...box, png, z: z++ });
      else warnings.add("Some images couldn't be extracted and were left out.");
    }
  }

  shapes.push(...widgetShapes(annots as any[], vp.transform as number[], () => z++));
  const scanned = glyphs.length === 0 && images.some((im) => im.w * im.h > vp.width * vp.height * 0.4);
  return { w: vp.width, h: vp.height, lines: buildLines(glyphs), images, rules, shapes, rotated, scanned };
}

/**
 * Turn one pdf.js constructPath op into shapes. pdf.js 6 packs the path as
 * [paintOp, [Float32Array of DrawOPS codes + coords], minMax] with codes 0 moveTo, 1 lineTo, 2 curveTo,
 * 3 quadraticCurveTo, 4 closePath. Coordinates are in user space; `m` maps them to page space.
 */
function collectShapes(args: any[], m: number[], lineWidth: number, stroke: string, fill: string, OPS: Record<string, number>, out: Shape[], nextZ: () => number) {
  const paint = args[0];
  const doStroke = [OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(paint);
  const doFill = [OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(paint);
  if (!doStroke && !doFill) return; // endPath (clipping) paints nothing
  const data = args[1]?.[0];
  if (!data || !data.length) return;
  const pt = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  const lw = Math.max(0.25, (lineWidth || 0) * scale);
  // split into subpaths of commands
  const subs: PathCmd[][] = [];
  let cur: PathCmd[] = [];
  for (let i = 0; i < data.length; ) {
    const op = data[i++];
    if (op === 0) {
      if (cur.length) subs.push(cur);
      cur = [{ op: "M", pts: pt(data[i], data[i + 1]) }];
      i += 2;
    } else if (op === 1) {
      cur.push({ op: "L", pts: pt(data[i], data[i + 1]) });
      i += 2;
    } else if (op === 2) {
      cur.push({ op: "C", pts: [...pt(data[i], data[i + 1]), ...pt(data[i + 2], data[i + 3]), ...pt(data[i + 4], data[i + 5])] });
      i += 6;
    } else if (op === 3) {
      // quadratic → cubic
      const last = cur.at(-1)?.pts.slice(-2) ?? [0, 0];
      const [cx, cy] = pt(data[i], data[i + 1]);
      const [x, y] = pt(data[i + 2], data[i + 3]);
      cur.push({ op: "C", pts: [last[0] + (2 / 3) * (cx - last[0]), last[1] + (2 / 3) * (cy - last[1]), x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y), x, y] });
      i += 4;
    } else if (op === 4) {
      cur.push({ op: "Z", pts: [] });
    } else break; // unknown code: stop parsing this path
  }
  if (cur.length) subs.push(cur);

  const f = doFill ? fill : undefined;
  const st = doStroke ? stroke : undefined;
  const complex: PathCmd[] = [];
  for (const sub of subs) {
    const pts = sub.filter((c) => c.op !== "Z").map((c) => c.pts);
    const allLines = sub.every((c) => c.op !== "C");
    const xs = pts.flatMap((p) => p.filter((_, k) => k % 2 === 0));
    const ys = pts.flatMap((p) => p.filter((_, k) => k % 2 === 1));
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    const axis = allLines && pts.every((p, k) => k === 0 || Math.abs(p[0] - pts[k - 1][0]) < 0.3 || Math.abs(p[1] - pts[k - 1][1]) < 0.3);
    // straight horizontal / vertical stroke → thin filled rect of the stroke thickness
    if (allLines && pts.length === 2 && st && axis) {
      if (box.h < 0.3) out.push({ kind: "rect", x: box.x, y: box.y - lw / 2, w: box.w, h: lw, fill: st, lw: 0, z: nextZ(), line: true });
      else out.push({ kind: "rect", x: box.x - lw / 2, y: box.y, w: lw, h: box.h, fill: st, lw: 0, z: nextZ(), line: true });
      continue;
    }
    // axis-aligned rectangle (4 corners, optionally repeating the first)
    const corners = pts.length === 5 && Math.abs(pts[4][0] - pts[0][0]) < 0.3 && Math.abs(pts[4][1] - pts[0][1]) < 0.3 ? pts.slice(0, 4) : pts;
    const distinct = (v: number[]) => v.filter((x, k) => v.findIndex((y) => Math.abs(y - x) < 0.3) === k).length;
    const isBox = corners.length === 4 && distinct(corners.map((c) => c[0])) === 2 && distinct(corners.map((c) => c[1])) === 2;
    if (axis && isBox && box.w > 0.1 && box.h > 0.1 && (sub.at(-1)!.op === "Z" || pts.length === 5 || f)) {
      out.push({ kind: "rect", ...box, fill: f, stroke: st, lw: st ? lw : 0, z: nextZ() });
      continue;
    }
    complex.push(...sub);
  }
  if (complex.length) {
    const pts = complex.filter((c) => c.op !== "Z").flatMap((c) => c.pts);
    const xs = pts.filter((_, k) => k % 2 === 0);
    const ys = pts.filter((_, k) => k % 2 === 1);
    if (xs.length) {
      const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      out.push({ kind: "path", ...box, fill: f, stroke: st, lw: st ? lw : 0, z: nextZ(), cmds: complex });
    }
  }
}

// ---------------------------------------------------------------------------
// Fillable form fields (AcroForm widgets)
// ---------------------------------------------------------------------------
const rgbHex = (c: any): string | undefined => {
  if (!c || c.length === undefined || c.length < 3) return undefined;
  const v = [c[0], c[1], c[2]].map((x: number) => Math.round(Math.max(0, Math.min(255, x))));
  if (Math.max(...v) < 60) return undefined; // near-black → automatic colour
  return v.map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
};

function widgetBox(a: any, m: number[]) {
  const pt = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const [p1, p2] = [pt(a.rect[0], a.rect[1]), pt(a.rect[2], a.rect[3])];
  return { x: Math.min(p1[0], p2[0]), y: Math.min(p1[1], p2[1]), w: Math.abs(p2[0] - p1[0]), h: Math.abs(p2[1] - p1[1]) };
}

const isWidget = (a: any) => a?.annotationType === 20 && !a.hidden && !!a.rect;

/** Values typed into text/choice fields and ticked checkboxes/radio buttons, as positioned glyphs. */
function widgetGlyphs(annots: any[], m: number[]): Glyph[] {
  const out: Glyph[] = [];
  for (const a of annots ?? []) {
    if (!isWidget(a) || !a.rect) continue;
    const box = widgetBox(a, m);
    if (box.w < 2 || box.h < 2) continue;
    const da = a.defaultAppearanceData ?? {};
    const fname = String(da.fontName ?? "");
    const family = /^cour/i.test(fname) ? "Courier New" : /tiro|times/i.test(fname) ? "Times New Roman" : "Arial";
    const font: FontInfo = { family, bold: /bo/i.test(fname.replace(/^[a-z]{4}/i, "")), italic: /it|ob/i.test(fname.replace(/^[a-z]{4}/i, "")), mono: family === "Courier New", serif: family === "Times New Roman" };
    const color = rgbHex(da.fontColor);
    const charW = family === "Courier New" ? 0.6 : 0.5;
    if (a.fieldType === "Btn") {
      const on = a.checkBox ? a.fieldValue && a.fieldValue !== "Off" : a.radioButton ? a.fieldValue != null && a.fieldValue === a.buttonValue : false;
      if (!on) continue;
      const size = Math.max(4, Math.min(box.w, box.h) * 0.8);
      const mark = a.radioButton ? "●" : "X";
      out.push({ s: mark, x: box.x + (box.w - size * 0.6) / 2, y: box.y + box.h / 2 + 0.35 * size, w: size * 0.6, size, font: { ...font, family: "Arial", mono: false, serif: false }, color });
      continue;
    }
    if (a.fieldType !== "Tx" && a.fieldType !== "Ch") continue;
    const raw = Array.isArray(a.fieldValue) ? a.fieldValue.join(", ") : typeof a.fieldValue === "string" ? a.fieldValue : "";
    if (!raw.trim()) continue;
    const multi = !!a.multiLine;
    const pad = 2 + (a.borderStyle?.width ?? 1); // viewers inset field text by 2pt plus the border width
    const lines: string[] = multi ? raw.split(/\r\n|\r|\n/) : [raw.replace(/\s+/g, " ")];
    const size = da.fontSize > 0 ? da.fontSize : Math.max(6, Math.min(12, multi ? 10 : box.h * 0.65));
    // comb fields: one character per equal-width cell
    if (a.comb && a.maxLen > 0 && !multi) {
      const cell = box.w / a.maxLen;
      [...lines[0]].forEach((ch, i) => {
        if (!ch.trim()) return;
        out.push({ s: ch, x: box.x + (i + 0.5) * cell - (charW * size) / 2, y: box.y + box.h / 2 + 0.35 * size, w: charW * size, size, font, color });
      });
      continue;
    }
    lines.forEach((text, li) => {
      if (!text.trim()) return;
      const width = text.length * charW * size;
      const align = a.textAlignment ?? 0;
      const x0 = align === 1 ? box.x + (box.w - width) / 2 : align === 2 ? box.x + box.w - pad - width : box.x + pad;
      const y = multi ? box.y + pad + 0.9 * size + li * size * 1.15 : box.y + box.h / 2 + 0.35 * size;
      let first = true;
      for (const mm of text.matchAll(/\S+/g)) {
        const g: Glyph = { s: mm[0], x: x0 + mm.index! * charW * size, y, w: mm[0].length * charW * size, size, font, color };
        if (!first) {
          g.joined = true;
          g.spaceBefore = true;
        }
        first = false;
        out.push(g);
      }
    });
  }
  return out;
}

/** Field borders and backgrounds (drawn by the viewer, not in the page content). */
function widgetShapes(annots: any[], m: number[], nextZ: () => number): Shape[] {
  const out: Shape[] = [];
  for (const a of annots ?? []) {
    if (!isWidget(a) || !a.rect) continue;
    const box = widgetBox(a, m);
    if (box.w < 2 || box.h < 2) continue;
    const bw = a.borderStyle?.width ?? 0;
    const stroke = a.borderColor && a.borderColor.length >= 3 && bw > 0 ? [a.borderColor[0], a.borderColor[1], a.borderColor[2]].map((x: number) => Math.round(x).toString(16).padStart(2, "0")).join("").toUpperCase() : undefined;
    const bg = a.backgroundColor && a.backgroundColor.length >= 3 ? [a.backgroundColor[0], a.backgroundColor[1], a.backgroundColor[2]].map((x: number) => Math.round(x).toString(16).padStart(2, "0")).join("").toUpperCase() : undefined;
    const fill = bg && bg !== "FFFFFF" ? bg : undefined;
    if (!stroke && !fill) continue;
    out.push({ kind: "rect", x: box.x + bw / 2, y: box.y + bw / 2, w: box.w - bw, h: box.h - bw, fill, stroke, lw: stroke ? bw : 0, z: nextZ() });
  }
  return out;
}

/**
 * Sample text colours from a canvas render of the page (browser only).
 * Thin text (small Courier, light serif) is mostly anti-aliased grey pixels, so the most common colour of a
 * black word is grey. Neutral text is therefore judged by its darkest pixel: black text always has
 * near-black pixels at its core, real grey text never gets darker than its own colour.
 */
async function sampleColors(page: any, data: PageData) {
  if (typeof document === "undefined") return;
  const scale = 3;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const W = canvas.width;
  const H = canvas.height;
  for (const line of data.lines)
    for (const seg of line.segs)
      for (const g of seg.glyphs) {
        const x0 = Math.max(0, Math.floor(g.x * scale));
        const y0 = Math.max(0, Math.floor((g.y - g.size * 0.72) * scale));
        const x1 = Math.min(W, Math.ceil((g.x + g.w) * scale));
        const y1 = Math.min(H, Math.ceil(g.y * scale));
        let neutral = 0;
        let colored = 0;
        let darkest = 255;
        const counts = new Map<string, number>();
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const k = (y * W + x) * 4;
            const [r, gg, b] = [img[k], img[k + 1], img[k + 2]];
            const lum = 0.299 * r + 0.587 * gg + 0.114 * b;
            if (lum > 215) continue; // background
            const weight = 255 - lum;
            if (Math.max(r, gg, b) - Math.min(r, gg, b) < 40) {
              neutral += weight;
              darkest = Math.min(darkest, lum);
            } else {
              colored += weight;
              const key = `${r >> 5},${gg >> 5},${b >> 5}`;
              counts.set(key, (counts.get(key) ?? 0) + weight);
            }
          }
        if (!neutral && !colored) continue;
        if (neutral >= colored) {
          // grey only if even the darkest pixel is clearly grey; otherwise automatic (black)
          if (darkest >= 110) {
            const v = Math.round(darkest).toString(16).padStart(2, "0").toUpperCase();
            g.color = v + v + v;
          }
          continue;
        }
        const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        if (!best) continue;
        const [r, gg, b] = best[0].split(",").map((v) => Number(v) * 32 + 16);
        g.color = [r, gg, b].map((v) => Math.min(255, v).toString(16).padStart(2, "0")).join("").toUpperCase();
      }
}

// ---------------------------------------------------------------------------
// Lines and segments
// ---------------------------------------------------------------------------
function buildLines(glyphs: Glyph[]): TLine[] {
  const sorted = [...glyphs].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { y: number; size: number; glyphs: Glyph[] }[] = [];
  for (const g of sorted) {
    // find a line on the same baseline (superscripts sit a little higher and are smaller)
    const line = lines.find((l) => Math.abs(l.y - g.y) <= Math.max(1.5, 0.42 * Math.max(l.size, g.size)) && overlapsNothing(l.glyphs, g));
    if (line) {
      line.glyphs.push(g);
      if (g.size > line.size) {
        line.size = g.size;
        line.y = g.y;
      }
    } else lines.push({ y: g.y, size: g.size, glyphs: [g] });
  }
  return lines
    .map((l) => {
      const gs = l.glyphs.sort((a, b) => a.x - b.x);
      // dominant size by character count (one larger word must not change the paragraph's size)
      const weight = new Map<number, number>();
      gs.forEach((g) => weight.set(round(g.size, 2), (weight.get(round(g.size, 2)) ?? 0) + g.s.length));
      const size = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const base = gs.find((g) => Math.abs(g.size - size) < 0.3) ?? gs[0];
      for (const g of gs) {
        if (g.size < size * 0.85) {
          if (g.y < base.y - size * 0.12) g.vert = "super";
          else if (g.y > base.y + size * 0.08) g.vert = "sub";
        }
      }
      const segs: Seg[] = [];
      for (const g of gs) {
        const cur = segs.at(-1);
        const prev = cur?.glyphs.at(-1);
        const gap = prev ? g.x - (prev.x + prev.w) : Infinity;
        if (cur && (g.joined || gap < Math.max(2.2 * Math.max(prev!.size, g.size), 18))) {
          cur.glyphs.push(g);
          cur.right = Math.max(cur.right, g.x + g.w);
        } else segs.push({ x: g.x, right: g.x + g.w, glyphs: [g] });
      }
      const text = segs.map(segText).join("\t");
      const bold = gs.every((g) => g.font.bold);
      return { y: base.y, size, maxSize: l.size, x: segs[0].x, right: segs.at(-1)!.right, segs, bold, text };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function overlapsNothing(existing: Glyph[], g: Glyph) {
  // two glyph runs occupying the same x-range can't be on one line (e.g. stacked table cells)
  return !existing.some((e) => g.x < e.x + e.w - 1 && e.x < g.x + g.w - 1);
}

function segText(seg: Seg) {
  let out = "";
  seg.glyphs.forEach((g, i) => {
    const prev = seg.glyphs[i - 1];
    if (prev && (g.joined ? g.spaceBefore : g.x - (prev.x + prev.w) > 0.12 * g.size && !g.vert && !prev.vert) && !out.endsWith(" ")) out += " ";
    out += g.s;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------
type ListInfo =
  | { kind: "bullet"; glyph: string }
  | { kind: "number"; fmt: "decimal" | "lowerLetter" | "upperLetter" | "lowerRoman" | "upperRoman"; prefix: "" | "("; suffix: "." | ")"; start: number; token: string };

/** Value of a Roman numeral (i → 1, iv → 4, xii → 12); NaN if it isn't one. */
function romanValue(tok: string): number {
  const v: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const t = tok.toLowerCase();
  if (!/^[ivxlcdm]+$/.test(t)) return NaN;
  let total = 0;
  for (let i = 0; i < t.length; i++) total += v[t[i]] < (v[t[i + 1]] ?? 0) ? -v[t[i]] : v[t[i]];
  return total;
}
type ParaBlock = {
  type: "para";
  borderBottom?: Rule;
  lines: TLine[];
  glyphs: Glyph[][]; // per line (list marker removed)
  size: number;
  x: number; // left of body lines
  firstX: number;
  top: number;
  bottom: number;
  align: "left" | "center" | "right" | "both";
  heading?: 1 | 2 | 3;
  list?: ListInfo & { markerX: number; textX: number; level: number };
  spacingBefore: number;
  lineMultiple?: number;
  pageBreakBefore?: boolean;
  columnBreakAfter?: boolean;
  floating?: Img[];
};
type TabBlock = {
  type: "tabs";
  borderBottom?: Rule;
  line: TLine;
  top: number;
  bottom: number;
  spacingBefore: number;
  leader?: { left: string; right: string };
  pageBreakBefore?: boolean;
  columnBreakAfter?: boolean;
  floating?: Img[];
};
type TableBlock = { borderBottom?: Rule; type: "table"; cols: number[]; rows: Glyph[][][][]; top: number; bottom: number; spacingBefore: number; pageBreakBefore?: boolean; columnBreakAfter?: boolean; floating?: Img[] };
type ImageBlock = { borderBottom?: Rule; type: "image"; img: Img; /** more images on the same row, left → right */ row?: Img[]; top: number; bottom: number; align: "left" | "center" | "right"; indent: number; spacingBefore: number; pageBreakBefore?: boolean; columnBreakAfter?: boolean; floating?: Img[] };
type Block = ParaBlock | TabBlock | TableBlock | ImageBlock;

type Region = { left: number; right: number; lines: TLine[]; images: Img[]; rules?: Rule[] };
type PageLayout = { parts: { cols: 1 | 2; regions: Region[] }[]; floating: Img[] };

const BULLET_RE = /^([•●○◦▪■□►▸‣⁃∙·✓✔➢➤\-–—*])\s*/;
const NUMBER_RE = /^(\(?)(\d{1,3}|[a-zA-Z]|[ivxlcdm]{1,6}|[IVXLCDM]{1,6})([.)])\s+/;

function detectList(text: string): { info: ListInfo; markerLen: number } | null {
  const b = text.match(BULLET_RE);
  if (b && text.length > b[0].length) {
    // a lone hyphen followed by a lowercase word is more likely a dash in prose
    if (/^[-–—]$/.test(b[1]) && !/\s/.test(text.charAt(1))) return null;
    return { info: { kind: "bullet", glyph: b[1] === "*" || b[1] === "-" || b[1] === "∙" || b[1] === "·" ? "•" : b[1] }, markerLen: b[0].length };
  }
  const n = text.match(NUMBER_RE);
  if (n && text.length > n[0].length + 1) {
    const tok = n[2];
    let fmt: Extract<ListInfo, { kind: "number" }>["fmt"] = "decimal";
    let start = 1;
    if (/^\d+$/.test(tok)) start = Number(tok);
    else if (/^[ivxlcdm]+$/.test(tok) && tok.length > 1) (fmt = "lowerRoman"), (start = romanValue(tok));
    else if (/^[IVXLCDM]+$/.test(tok) && tok.length > 1) (fmt = "upperRoman"), (start = romanValue(tok));
    else if (/^[a-z]$/.test(tok)) (fmt = "lowerLetter"), (start = tok.charCodeAt(0) - 96);
    else if (/^[A-Z]$/.test(tok)) (fmt = "upperLetter"), (start = tok.charCodeAt(0) - 64);
    else return null;
    if ((fmt === "decimal" && start > 200) || !Number.isFinite(start) || start < 1) return null;
    // "(1)" / "(a)" keep their opening bracket; "(1." is not a list marker
    if (n[1] === "(" && n[3] !== ")") return null;
    return { info: { kind: "number", fmt, prefix: n[1] as "" | "(", suffix: n[3] as "." | ")", start, token: tok }, markerLen: n[0].length };
  }
  return null;
}

/** Remove the list marker characters from a line's glyphs; returns x where the text starts. */
function stripMarker(line: TLine, markerLen: number): { glyphs: Glyph[]; textX: number } {
  const all = line.segs.flatMap((s) => s.glyphs.map((g) => ({ ...g })));
  let remaining = markerLen;
  while (remaining > 0 && all.length) {
    const g = all[0];
    const s = g.s;
    if (s.length <= remaining) {
      remaining -= s.length;
      all.shift();
      remaining = Math.max(0, remaining - 1); // the space between marker and text is not part of any glyph run
    } else {
      const cut = s.slice(0, remaining);
      const rest = s.slice(remaining).trimStart();
      const avg = g.w / Math.max(1, s.length);
      g.x += (s.length - rest.length) * avg;
      g.w -= (s.length - rest.length) * avg;
      g.s = rest;
      remaining = 0;
      void cut;
    }
  }
  return { glyphs: all, textX: all[0]?.x ?? line.x };
}

function pageLayout(p: PageData): PageLayout {
  const lines = p.lines;
  const W = p.w;
  // --- 2-column detection -------------------------------------------------
  let gutter: number | null = null;
  if (lines.length >= 12) {
    let best: { gx: number; score: number } | null = null;
    for (let gx = W * 0.3; gx <= W * 0.7; gx += 2) {
      const L = lines.filter((l) => l.right < gx - 2);
      const R = lines.filter((l) => l.x > gx + 2);
      const C = lines.filter((l) => l.x <= gx + 2 && l.right >= gx - 2);
      if (L.length < 5 || R.length < 5) continue;
      const bandTop = Math.max(Math.min(...L.map((l) => l.y)), Math.min(...R.map((l) => l.y)));
      const bandBot = Math.min(Math.max(...L.map((l) => l.y)), Math.max(...R.map((l) => l.y)));
      if (bandBot - bandTop < p.h * 0.25) continue;
      if (C.some((l) => l.y > bandTop + 2 && l.y < bandBot - 2)) continue;
      // both columns must be left-aligned text (not a column of right-aligned dates)
      const lx = Math.min(...R.map((l) => l.x));
      const alignedR = R.filter((l) => Math.abs(l.x - lx) < 6).length / R.length;
      const lx2 = Math.min(...L.map((l) => l.x));
      const alignedL = L.filter((l) => Math.abs(l.x - lx2) < 6).length / L.length;
      if (alignedR < 0.6 || alignedL < 0.6) continue;
      const score = L.length + R.length;
      if (!best || score > best.score) best = { gx, score };
    }
    if (best) gutter = best.gx;
  }

  const textBox = (ls: TLine[]) => ({
    left: ls.length ? Math.min(...ls.map((l) => l.x)) : 0,
    right: ls.length ? percentile(ls.map((l) => l.right), 0.95) : W,
  });
  const allImages = p.images;
  // images that sit under text (letterheads, watermarks, full-page backgrounds) float behind text
  const overlapsText = (im: Img) => lines.filter((l) => l.y > im.y && l.y - l.size < im.y + im.h && l.right > im.x && l.x < im.x + im.w).length >= 2;
  const floating = allImages.filter(overlapsText);
  const inline = allImages.filter((im) => !floating.includes(im));

  if (gutter === null) {
    const box = textBox(lines);
    return { parts: [{ cols: 1, regions: [{ ...box, lines, images: inline, rules: p.rules }] }], floating };
  }
  const gx = gutter;
  const colLines = lines.filter((l) => l.right < gx - 2 || l.x > gx + 2);
  const bandTop = Math.min(...colLines.map((l) => l.y));
  const bandBot = Math.max(...colLines.map((l) => l.y));
  const top = lines.filter((l) => l.y < bandTop && l.x <= gx + 2 && l.right >= gx - 2);
  const bottom = lines.filter((l) => l.y > bandBot && l.x <= gx + 2 && l.right >= gx - 2);
  const left = lines.filter((l) => !top.includes(l) && !bottom.includes(l) && l.x < gx);
  const right = lines.filter((l) => !top.includes(l) && !bottom.includes(l) && l.x >= gx);
  const imgIn = (pred: (im: Img) => boolean) => inline.filter(pred);
  const parts: PageLayout["parts"] = [];
  const full = textBox(lines);
  if (top.length) parts.push({ cols: 1, regions: [{ ...full, lines: top, images: imgIn((im) => im.y + im.h <= bandTop) }] });
  parts.push({
    cols: 2,
    regions: [
      { ...textBox(left), lines: left, images: imgIn((im) => im.y + im.h > bandTop && im.y < bandBot && im.x + im.w / 2 < gx) },
      { ...textBox(right), lines: right, images: imgIn((im) => im.y + im.h > bandTop && im.y < bandBot && im.x + im.w / 2 >= gx) },
    ],
  });
  if (bottom.length) parts.push({ cols: 1, regions: [{ ...full, lines: bottom, images: imgIn((im) => im.y >= bandBot) }] });
  return { parts, floating };
}

function percentile(v: number[], q: number) {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
}

/** Turn one region's lines into blocks. */
function regionBlocks(r: Region, ctx: { bodySize: number; headingTiers: number[]; lineRatio: number }): Block[] {
  const blocks: Block[] = [];
  const L = r.left;
  const R = r.right;
  const lines = r.lines;
  const width = Math.max(1, R - L);
  let i = 0;

  const isMulti = (l: TLine) => l.segs.length >= 2 && !(l.segs.length === 2 && detectList(segText(l.segs[0]) + " x") && segText(l.segs[0]).length <= 4);

  while (i < lines.length) {
    const line = lines[i];

    // ---- tables: 2+ consecutive multi-segment lines whose segments start at shared column x positions
    if (isMulti(line)) {
      let j = i;
      const run: TLine[] = [];
      while (
        j < lines.length &&
        (isMulti(lines[j]) ||
          (run.length &&
            !detectList(lines[j].text) &&
            lines[j].y - lines[j - 1].y < lines[j].size * 1.35 &&
            lines[j].segs.every((s) => run.some((rl) => rl.segs.length >= 2 && rl.segs.some((rs) => Math.abs(rs.x - s.x) < 6)))))
      ) {
        if (run.length && lines[j].y - run.at(-1)!.y > Math.max(lines[j].size, run.at(-1)!.size) * 3) break;
        run.push(lines[j]);
        j++;
      }
      const starts = cluster(run.flatMap((l) => l.segs.map((s) => s.x)), 6);
      const multiLines = run.filter((l) => l.segs.length >= 2);
      const rightAligned = multiLines.every((l) => l.segs.length === 2 && Math.abs(l.right - R) < 8);
      const consistent = run.filter((l) => l.segs.length >= 2 && l.segs.every((s) => starts.some((c) => Math.abs(c - s.x) < 6))).length;
      if (run.length >= 2 && starts.length >= 2 && consistent >= 2 && !rightAligned) {
        blocks.push(buildTable(run, starts, L, R));
        i = j;
        continue;
      }
      // otherwise: a tab-aligned line
      blocks.push({ type: "tabs", line, top: line.y - line.size, bottom: line.y, spacingBefore: 0 });
      i++;
      continue;
    }

    // ---- paragraphs and list items
    // leader-dot lines ("Introduction ........ 3") become a right tab with a dot leader
    const leader = line.text.match(/^(.*?\S)\s*\.{4,}\s*(\S{1,8})$/);
    if (leader) {
      blocks.push({ type: "tabs", line, top: line.y - line.size, bottom: line.y, spacingBefore: 0, leader: { left: leader[1], right: leader[2] } });
      i++;
      continue;
    }
    const listDet = line.size >= ctx.bodySize * 1.15 ? null : detectList(line.text);
    const para: ParaBlock = {
      type: "para",
      lines: [line],
      glyphs: [],
      size: line.size,
      x: line.x,
      firstX: line.x,
      top: line.y - line.size,
      bottom: line.y,
      align: "left",
      spacingBefore: 0,
    };
    if (listDet) {
      const { glyphs, textX } = stripMarker(line, listDet.markerLen);
      para.glyphs.push(glyphs);
      para.list = { ...listDet.info, markerX: line.x, textX, level: 0 } as ParaBlock["list"];
      para.x = textX;
    } else para.glyphs.push(line.segs.flatMap((s) => s.glyphs));

    let k = i + 1;
    while (k < lines.length) {
      const a = para.lines.at(-1)!;
      const b = lines[k];
      if (isMulti(b) || (b.size < ctx.bodySize * 1.15 && detectList(b.text)) || /\.{4,}\s*\S{1,8}$/.test(b.text)) break;
      // "Label: value" lines (bold label ending in a colon) start their own paragraph
      const lead = b.segs[0].glyphs;
      const labelEnd = lead.findIndex((g) => /:$/.test(g.s));
      if (labelEnd >= 0 && labelEnd < 5 && lead.slice(0, labelEnd + 1).every((g) => g.font.bold) && lead.slice(labelEnd + 1).some((g) => !g.font.bold)) break;
      const sameSize = Math.abs(a.size - b.size) < 0.6;
      const gap = b.y - a.y;
      const typical = para.lines.length >= 2 ? median(para.lines.slice(1).map((l, idx) => l.y - para.lines[idx].y)) : a.size * ctx.lineRatio;
      const close = gap > 0 && gap <= Math.max(typical * 1.3, a.size * 1.05) && gap < a.size * 2.2;
      const sameWeight = a.bold === b.bold || para.lines.length > 1;
      const bothCentered = Math.abs((a.x + a.right) / 2 - (L + R) / 2) < 6 && Math.abs((b.x + b.right) / 2 - (L + R) / 2) < 6 && a.x > L + 10;
      const bodyX = para.list ? para.list.textX : para.lines.length === 1 ? b.x : para.x;
      const xAligned = Math.abs(b.x - bodyX) < 4 || (para.lines.length === 1 && !para.list && a.x > b.x && a.x - b.x < 60 && Math.abs(b.x - L) < 4);
      const aShort = a.right < R - Math.max(width * 0.12, a.size * 5);
      const endsSentence = /[.!?:]["')\]]?$/.test(a.text);
      const headingLike = para.lines.length === 1 && a.size >= ctx.bodySize * 1.2 && Math.abs(b.size - a.size) > 0.6;
      if (!(sameSize && close && sameWeight && !headingLike && ((xAligned && (!aShort || (!endsSentence && /^[a-z]/.test(b.text)))) || bothCentered))) break;
      para.lines.push(b);
      para.glyphs.push(b.segs.flatMap((s) => s.glyphs));
      para.bottom = b.y;
      if (para.lines.length === 2 && !para.list) para.x = b.x;
      k++;
    }
    finishPara(para, L, R, ctx);
    blocks.push(para);
    i = k;
  }

  // images, placed in reading order by their top edge. Images side by side (e.g. a logo next to a seal)
  // share one paragraph so they stay on the same row instead of stacking and pushing the text down.
  const rows: Img[][] = [];
  for (const im of [...r.images].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((g) =>
      g.every((o) => {
        const vOverlap = Math.min(o.y + o.h, im.y + im.h) - Math.max(o.y, im.y);
        const hApart = im.x >= o.x + o.w - 2 || o.x >= im.x + im.w - 2;
        return hApart && vOverlap >= 0.5 * Math.min(o.h, im.h);
      }),
    );
    if (row) row.push(im);
    else rows.push([im]);
  }
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    const [im, ...rest] = row;
    const top = Math.min(...row.map((x) => x.y));
    const bottom = Math.max(...row.map((x) => x.y + x.h));
    if (rest.length) {
      blocks.push({ type: "image", img: im, row: rest, top, bottom, align: "left", indent: Math.max(0, im.x - L), spacingBefore: 0 });
      continue;
    }
    const cx = im.x + im.w / 2;
    const align = Math.abs(cx - (L + R) / 2) < 12 ? "center" : Math.abs(im.x + im.w - R) < 8 && im.x > L + 20 ? "right" : "left";
    blocks.push({ type: "image", img: im, top, bottom, align, indent: align === "left" ? Math.max(0, im.x - L) : 0, spacingBefore: 0 });
  }
  blocks.sort((a, b) => a.top - b.top);

  // attach horizontal rules to the text block directly above them (Word paragraph bottom border)
  for (const rule of r.rules ?? []) {
    if (rule.right < L - 2 || rule.x > R + 2) continue;
    if (rule.right - rule.x < (R - L) * 0.6) continue; // underlines of words/links are not section rules
    const above = blocks.filter((b) => b.bottom <= rule.y + 1).at(-1);
    if (!above || rule.y - above.bottom > 14 || !(above.type === "para" || above.type === "tabs")) continue; // table grid lines stay with the table
    if (!above.borderBottom) above.borderBottom = rule;
  }

  // vertical spacing between blocks, using Word's line-box model (line height = font line × multiple,
  // text baseline sits `ascent` below the top of an unscaled line; extra multiple spacing goes above the text)
  const lineBox = (size: number, family: string, multiple = 1) => {
    const m = METRICS[compatFor(family)];
    const h = size * m.line * multiple;
    return { above: h - (m.line - m.asc) * size, below: (m.line - m.asc) * size };
  };
  let prevBottom: number | null = null;
  for (const b of blocks) {
    let topEdge: number;
    let bottomEdge: number;
    if (b.type === "para" || b.type === "tabs") {
      const first = b.type === "para" ? b.lines[0] : b.line;
      const last = b.type === "para" ? b.lines.at(-1)! : b.line;
      const fam = first.segs[0].glyphs[0].font.family;
      const mult = b.type === "para" && b.lineMultiple && Math.abs(b.lineMultiple - 1) > 0.06 ? b.lineMultiple : 1;
      topEdge = first.y - lineBox(first.size, fam, mult).above;
      bottomEdge = last.y + lineBox(last.size, fam, mult).below;
    } else {
      topEdge = b.top;
      bottomEdge = b.bottom;
    }
    if (prevBottom !== null) b.spacingBefore = Math.max(0, Math.min(72, round(topEdge - prevBottom, 2)));
    prevBottom = bottomEdge;
  }
  return blocks;
}

function finishPara(p: ParaBlock, L: number, R: number, ctx: { bodySize: number; headingTiers: number[]; lineRatio: number }) {
  const ls = p.lines;
  const center = (L + R) / 2;
  if (ls.every((l) => Math.abs((l.x + l.right) / 2 - center) < Math.max(5, (R - L) * 0.02)) && ls[0].x > L + 10) p.align = "center";
  else if (ls.every((l) => Math.abs(l.right - R) < 5) && ls[0].x > L + 30) p.align = "right";
  else if (ls.length >= 2 && ls.slice(0, -1).every((l) => Math.abs(l.right - R) < 3.5) && ls.at(-1)!.right < R - 3) p.align = "both";
  p.firstX = ls[0].x;
  if (ls.length >= 2) {
    const deltas = ls.slice(1).map((l, i) => l.y - ls[i].y);
    const m = median(deltas);
    const compat = compatFor(ls[0].segs[0].glyphs[0].font.family);
    p.lineMultiple = m / (p.size * METRICS[compat].line);
  }
  const tier = ctx.headingTiers.findIndex((s) => Math.abs(s - p.size) < 0.6);
  if (tier >= 0 && ls.length <= 3 && !p.list) p.heading = Math.min(3, tier + 1) as 1 | 2 | 3;
}

function cluster(values: number[], tol: number): number[] {
  const s = [...values].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const v of s) {
    const last = out.at(-1);
    if (last && v - last[last.length - 1] <= tol) last.push(v);
    else out.push([v]);
  }
  return out.filter((c) => c.length >= 2).map((c) => c[0]);
}

function buildTable(run: TLine[], starts: number[], L: number, R: number): TableBlock {
  const cols = starts.sort((a, b) => a - b);
  const colOf = (x: number) => {
    let idx = 0;
    cols.forEach((c, i) => {
      if (x >= c - 6) idx = i;
    });
    return idx;
  };
  const rows: Glyph[][][][] = []; // row → cell → lines → glyphs
  for (const line of run) {
    const cells: Glyph[][][] = cols.map(() => []);
    for (const s of line.segs) cells[colOf(s.x)].push(s.glyphs);
    const hasFirst = cells[0].length > 0;
    const prev = rows.at(-1);
    const filled = cells.filter((c) => c.length).length;
    if (prev && (!hasFirst || (filled === 1 && line.segs.length === 1 && run.indexOf(line) > 0 && line.y - run[run.indexOf(line) - 1].y < line.size * 1.3))) {
      cells.forEach((c, ci) => prev[ci].push(...c)); // wrapped cell text
    } else rows.push(cells);
  }
  const edges = [...cols, R + 4];
  const widths = cols.map((c, i) => Math.max(20, edges[i + 1] - c));
  void L;
  return { type: "table", cols: widths, rows, top: run[0].y - run[0].size, bottom: run.at(-1)!.y, spacingBefore: 0 };
}

// ---------------------------------------------------------------------------
// Headers & footers
// ---------------------------------------------------------------------------
type HF = { header?: TLine; footer?: TLine; headerNorm?: string; footerNorm?: string };

function detectHeadersFooters(pages: PageData[]): HF {
  if (pages.length < 2) return {};
  const norm = (t: string) => t.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
  const tops = new Map<string, number>();
  const bots = new Map<string, number>();
  pages.forEach((p) => {
    const first = p.lines[0];
    const last = p.lines.at(-1);
    if (first && first.y < p.h * 0.12) tops.set(norm(first.text), (tops.get(norm(first.text)) ?? 0) + 1);
    if (last && last.y > p.h * 0.88) bots.set(norm(last.text), (bots.get(norm(last.text)) ?? 0) + 1);
  });
  const need = Math.max(2, Math.ceil(pages.length * 0.5));
  const hf: HF = {};
  const topKey = [...tops.entries()].find(([, c]) => c >= need)?.[0];
  const botKey = [...bots.entries()].find(([, c]) => c >= need)?.[0];
  if (topKey) {
    hf.headerNorm = topKey;
    hf.header = pages.map((p) => p.lines[0]).find((l) => l && norm(l.text) === topKey);
  }
  if (botKey) {
    hf.footerNorm = botKey;
    hf.footer = pages.map((p) => p.lines.at(-1)).find((l) => l && norm(l.text) === botKey);
  }
  pages.forEach((p) => {
    if (topKey && p.lines[0] && p.lines[0].y < p.h * 0.12 && norm(p.lines[0].text) === topKey) p.lines = p.lines.slice(1);
    const last = p.lines.at(-1);
    if (botKey && last && last.y > p.h * 0.88 && norm(last.text) === botKey) p.lines = p.lines.slice(0, -1);
  });
  return hf;
}

// ---------------------------------------------------------------------------
// DOCX output
// ---------------------------------------------------------------------------
function runsFor(glyphLines: Glyph[][], opts: { joinLines: boolean; lineBreaks?: boolean }): ParagraphChild[] {
  type R = { text: string; font: FontInfo; size: number; color?: string; link?: string; vert?: Glyph["vert"]; breakBefore?: boolean };
  const runs: R[] = [];
  const push = (text: string, g: Glyph) => {
    const last = runs.at(-1);
    if (last && last.font.family === g.font.family && last.font.bold === g.font.bold && last.font.italic === g.font.italic && Math.abs(last.size - g.size) < 0.3 && last.color === g.color && last.link === g.link && last.vert === g.vert)
      last.text += text;
    else runs.push({ text, font: g.font, size: g.vert ? g.size / 0.65 : g.size, color: g.color, link: g.link, vert: g.vert });
  };
  glyphLines.forEach((gs, li) => {
    gs.forEach((g, gi) => {
      const prev = gs[gi - 1];
      let text = g.s;
      if (prev && (g.joined ? g.spaceBefore : g.x - (prev.x + prev.w) > 0.12 * g.size && !g.vert && !prev.vert)) text = " " + text;
      push(text, g);
    });
    if (opts.lineBreaks && li < glyphLines.length - 1) {
      const next = glyphLines[li + 1][0];
      if (next) runs.push({ text: "", font: next.font, size: next.size, color: next.color, link: next.link, vert: next.vert, breakBefore: true });
    } else if (opts.joinLines && li < glyphLines.length - 1 && runs.length) {
      const last = runs.at(-1)!;
      const next = glyphLines[li + 1][0];
      // re-join words hyphenated at the line end
      if (/[a-z]-$/.test(last.text) && next && /^[a-z]/.test(next.s)) last.text = last.text.slice(0, -1);
      else last.text += " ";
    }
  });
  const size = (s: number) => Math.round(s * 2);
  return runs.map((r) => {
    const tr = new TextRun({
      text: r.text,
      break: r.breakBefore ? 1 : undefined,
      font: r.font.family,
      size: size(r.vert ? Math.min(r.size, 72) : r.size),
      bold: r.font.bold,
      italics: r.font.italic,
      color: r.color,
      style: r.link ? "Hyperlink" : undefined,
      superScript: r.vert === "super" || undefined,
      subScript: r.vert === "sub" || undefined,
    });
    return r.link ? new ExternalHyperlink({ link: r.link, children: [tr] }) : tr;
  });
}

function floatingImages(imgs: Img[] | undefined): ParagraphChild[] {
  return (imgs ?? []).map(
    (im) =>
      new ImageRun({
        type: "png",
        data: im.png,
        transformation: { width: im.w * (96 / 72), height: im.h * (96 / 72) },
        floating: {
          horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: Math.round(im.x * 12700) },
          verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: Math.round(im.y * 12700) },
          behindDocument: true,
          allowOverlap: true,
          wrap: { type: TextWrappingType.NONE },
        },
      }),
  );
}

type NumberingState = { configs: Map<string, { reference: string; levels: object[] }>; instance: number };

/** Continuity key for consecutive list items (same kind, format, punctuation and indent) — no start number. */
function listRunKey(list: NonNullable<ParaBlock["list"]>, indentLeft: number, hanging: number): string {
  return list.kind === "bullet"
    ? `b-${list.glyph.codePointAt(0)}-${Math.round(indentLeft)}-${Math.round(hanging)}`
    : `n-${list.fmt}-${list.prefix}-${list.suffix}-${Math.round(indentLeft)}-${Math.round(hanging)}`;
}

/**
 * Word numbering definition for a list run. The run's first item decides the start number, so a list
 * that begins at "4." in the PDF also begins at 4 in Word.
 */
function listRef(list: NonNullable<ParaBlock["list"]>, st: NumberingState, indentLeft: number, hanging: number, runStart: number): string {
  const raw = `${listRunKey(list, indentLeft, hanging)}${list.kind === "number" ? `-s${runStart}` : ""}`;
  // The docx library builds a RegExp from each numbering reference, so the key must not contain regex
  // metacharacters — list punctuation like ")" in "1)" or "(a)" would throw "Unmatched ')'". Encode anything
  // that isn't a letter, digit or hyphen as its code point.
  const key = raw.replace(/[^A-Za-z0-9-]/g, (c) => `u${c.codePointAt(0)}`);
  if (!st.configs.has(key)) {
    const fmt =
      list.kind === "bullet"
        ? LevelFormat.BULLET
        : { decimal: LevelFormat.DECIMAL, lowerLetter: LevelFormat.LOWER_LETTER, upperLetter: LevelFormat.UPPER_LETTER, lowerRoman: LevelFormat.LOWER_ROMAN, upperRoman: LevelFormat.UPPER_ROMAN }[list.fmt];
    st.configs.set(key, {
      reference: key,
      levels: [0, 1, 2].map((level) => ({
        level,
        format: fmt,
        text: list.kind === "bullet" ? list.glyph : `${list.prefix}%${level + 1}${list.suffix}`,
        alignment: AlignmentType.LEFT,
        start: list.kind === "number" && level === 0 ? runStart : 1,
        style: { paragraph: { indent: { left: tw(indentLeft + level * 18), hanging: tw(hanging) } } },
      })),
    });
  }
  return key;
}

/**
 * A lone "i)", "v)" or "x)" is ambiguous (letter or Roman numeral). If the next item of the same list is
 * Roman ("ii)", "vi)", "xi)"), treat it as Roman too, so "i) ii) iii)" doesn't become "i) i) ii)".
 */
function fixRomanLists(blocks: Block[]) {
  const items = blocks.filter((b): b is ParaBlock => b.type === "para" && !!b.list && b.list.kind === "number");
  for (let i = items.length - 1; i >= 0; i--) {
    const cur = items[i].list!;
    if (cur.kind !== "number" || (cur.fmt !== "lowerLetter" && cur.fmt !== "upperLetter") || !/^[ivxIVX]$/.test(cur.token)) continue;
    const next = items[i + 1]?.list;
    const roman = cur.fmt === "lowerLetter" ? "lowerRoman" : "upperRoman";
    const prev = items[i - 1]?.list;
    // "h) i)" stays alphabetical
    const prevIsLetterBefore = prev?.kind === "number" && prev.fmt === cur.fmt && prev.start === cur.start - 1 && Math.abs(prev.markerX - cur.markerX) < 4;
    if (!prevIsLetterBefore && next?.kind === "number" && next.fmt === roman && Math.abs(next.markerX - cur.markerX) < 4) {
      items[i].list = { ...cur, fmt: roman, start: romanValue(cur.token) };
    }
  }
}

function toDocxBlocks(blocks: Block[], L: number, R: number, st: NumberingState, bodySize: number): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  let prevList: string | null = null;
  let runStart = 1;
  fixRomanLists(blocks);
  for (const b of blocks) {
    const extras: ParagraphChild[] = floatingImages(b.floating);
    const border = b.borderBottom
      ? { bottom: { style: BorderStyle.SINGLE, size: Math.max(2, Math.round(b.borderBottom.width * 8)), color: b.borderBottom.color || "000000", space: Math.max(0, Math.round(b.borderBottom.y - b.bottom - 2)) } }
      : undefined;
    const common = { pageBreakBefore: b.pageBreakBefore || undefined, border };
    if (b.type === "para") {
      const indentLeft = Math.max(0, round(b.x - L, 2));
      const first = round(b.firstX - b.x, 2);
      const line = b.lineMultiple && Math.abs(b.lineMultiple - 1) > 0.06 ? { line: Math.round(Math.min(3, Math.max(0.75, b.lineMultiple)) * 240), lineRule: LineRuleType.AUTO } : {};
      let numbering: { reference: string; level: number; instance: number } | undefined;
      if (b.list) {
        const hanging = Math.max(6, round(b.list.textX - b.list.markerX, 2));
        const runKey = listRunKey(b.list, Math.max(0, b.list.textX - L), hanging);
        if (prevList !== runKey || b.spacingBefore > b.size * 1.5) {
          st.instance++;
          runStart = b.list.kind === "number" ? b.list.start : 1;
        }
        const ref = listRef(b.list, st, Math.max(0, b.list.textX - L), hanging, runStart);
        numbering = { reference: ref, level: b.list.level, instance: st.instance };
        prevList = runKey;
      } else prevList = null;
      const keepBreaks = b.align === "center" || b.align === "right";
      const children = [...extras, ...runsFor(b.glyphs, { joinLines: !keepBreaks, lineBreaks: keepBreaks })];
      if (b.columnBreakAfter) children.push(new ColumnBreak() as unknown as ParagraphChild);
      out.push(
        new Paragraph({
          ...common,
          heading: b.heading ? [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][b.heading - 1] : undefined,
          alignment: { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, both: AlignmentType.JUSTIFIED }[b.align],
          indent: numbering || keepBreaks ? undefined : { left: tw(indentLeft), ...(first > 1 ? { firstLine: tw(first) } : first < -1 ? { hanging: tw(-first) } : {}) },
          spacing: { before: tw(b.spacingBefore), after: 0, ...line },
          keepNext: b.heading ? true : undefined,
          numbering,
          children,
        }),
      );
    } else if (b.type === "tabs" && b.leader) {
      prevList = null;
      const g = b.line.segs[0].glyphs[0];
      const base = { font: g.font.family, size: Math.round(g.size * 2), bold: g.font.bold, italics: g.font.italic, color: g.color };
      const children: ParagraphChild[] = [...extras, new TextRun({ ...base, text: b.leader.left }), new TextRun({ ...base, children: [new Tab(), b.leader.right] })];
      if (b.columnBreakAfter) children.push(new ColumnBreak() as unknown as ParagraphChild);
      out.push(
        new Paragraph({
          ...common,
          tabStops: [{ type: TabStopType.RIGHT, position: tw(R - L), leader: "dot" }],
          indent: { left: tw(Math.max(0, b.line.x - L)) },
          spacing: { before: tw(b.spacingBefore), after: 0 },
          children,
        }),
      );
    } else if (b.type === "tabs") {
      prevList = null;
      const segs = b.line.segs;
      const stops = segs.slice(1).map((s) => (Math.abs(s.right - R) < 8 ? { type: TabStopType.RIGHT, position: tw(R - L) } : { type: TabStopType.LEFT, position: tw(Math.max(0, s.x - L)) }));
      const children: ParagraphChild[] = [...extras];
      segs.forEach((s, i) => {
        if (i > 0) children.push(new TextRun({ children: [new Tab()] }));
        children.push(...runsFor([s.glyphs], { joinLines: false }));
      });
      if (b.columnBreakAfter) children.push(new ColumnBreak() as unknown as ParagraphChild);
      out.push(
        new Paragraph({
          ...common,
          tabStops: stops,
          indent: { left: tw(Math.max(0, segs[0].x - L)) },
          spacing: { before: tw(b.spacingBefore), after: 0 },
          children,
        }),
      );
    } else if (b.type === "table") {
      prevList = null;
      if (b.spacingBefore > 2 || b.pageBreakBefore || extras.length)
        out.push(new Paragraph({ ...common, spacing: { before: 0, after: 0, line: Math.max(20, tw(b.spacingBefore)), lineRule: LineRuleType.EXACT }, children: extras }));
      const border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
      out.push(
        new Table({
          layout: TableLayoutType.FIXED,
          width: { size: tw(b.cols.reduce((s, c) => s + c, 0)), type: WidthType.DXA },
          columnWidths: b.cols.map(tw),
          borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
          rows: b.rows.map(
            (cells) =>
              new TableRow({
                children: cells.map(
                  (lines, ci) =>
                    new TableCell({
                      width: { size: tw(b.cols[ci]), type: WidthType.DXA },
                      margins: { left: 72, right: 72, top: 20, bottom: 20 },
                      children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: lines.length ? runsFor(lines, { joinLines: true }) : [] })],
                    }),
                ),
              }),
          ),
        }),
      );
      if (b.columnBreakAfter) out.push(new Paragraph({ children: [new ColumnBreak() as unknown as ParagraphChild] }));
    } else {
      prevList = null;
      const imageRun = (im: Img) => new ImageRun({ type: "png", data: im.png, transformation: { width: im.w * (96 / 72), height: im.h * (96 / 72) } });
      const children: ParagraphChild[] = [...extras, imageRun(b.img)];
      // same-row images: a left tab stop at each image's original x (tab positions are measured from the margin)
      const rowStops = (b.row ?? []).map((im) => ({ type: TabStopType.LEFT, position: tw(Math.max(0, im.x - L)) }));
      for (const im of b.row ?? []) children.push(new TextRun({ children: [new Tab()] }), imageRun(im));
      if (b.columnBreakAfter) children.push(new ColumnBreak() as unknown as ParagraphChild);
      out.push(
        new Paragraph({
          ...common,
          alignment: { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT }[b.align],
          indent: b.align === "left" && b.indent > 1 ? { left: tw(b.indent) } : undefined,
          tabStops: rowStops.length ? rowStops : undefined,
          spacing: { before: tw(b.spacingBefore), after: 0, line: 240, lineRule: LineRuleType.AUTO },
          children,
        }),
      );
    }
  }
  void bodySize;
  return out;
}

function hfParagraph(line: TLine, L: number, R: number): Paragraph {
  const center = (L + R) / 2;
  const align = Math.abs((line.x + line.right) / 2 - center) < 10 ? AlignmentType.CENTER : Math.abs(line.right - R) < 10 && line.x > L + 30 ? AlignmentType.RIGHT : AlignmentType.LEFT;
  const g = line.segs[0].glyphs[0];
  // replace the digit sequence that looks like a page number with a PAGE field
  const text = line.segs.map(segText).join("\t");
  const m = text.match(/^(.*?)(\d+)(\D*?)(?:(\d+)(\D*))?$/);
  const base = { font: g.font.family, size: Math.round(g.size * 2), color: g.color };
  if (m) {
    const children: (string | typeof PageNumber.CURRENT)[] = [m[1], PageNumber.CURRENT, m[3]];
    if (m[4]) children.push(PageNumber.TOTAL_PAGES, m[5] ?? "");
    return new Paragraph({ alignment: align, children: [new TextRun({ ...base, children: children.filter((c) => c !== "") as never })] });
  }
  return new Paragraph({ alignment: align, children: [new TextRun({ ...base, text })] });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export async function pdfToDocx(input: Uint8Array, opts: { onProgress?: Progress; maxPages?: number; layout?: LayoutMode } = {}): Promise<PdfToDocxResult> {
  const { getDocumentProxy, getResolvedPDFJS } = await import("unpdf");
  const pdfjs = await getResolvedPDFJS();
  let pdf;
  try {
    pdf = await getDocumentProxy(input, { isOffscreenCanvasSupported: false, fontExtraProperties: true } as never);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/password/i.test(msg)) throw new Error("This PDF is password-protected. Remove the password and try again.");
    throw new Error("This file couldn't be read as a PDF.");
  }
  const total = Math.min(pdf.numPages, opts.maxPages ?? 300);
  const warnings = new Set<string>();
  if (pdf.numPages > total) warnings.add(`Only the first ${total} pages were converted.`);

  const pages: PageData[] = [];
  for (let n = 1; n <= total; n++) {
    const page = await pdf.getPage(n);
    const data = await extractPage(pdfjs, page, warnings);
    await sampleColors(page, data).catch(() => {});
    pages.push(data);
    page.cleanup();
    opts.onProgress?.(n, total);
  }
  if (pages.every((p) => p.lines.length === 0)) {
    if (pages.some((p) => p.scanned)) warnings.add("This looks like a scanned PDF (no text layer). Pages were placed as images; text in them isn't editable.");
    else throw new Error("This PDF has no extractable text.");
  } else if (pages.some((p) => p.scanned)) warnings.add("Some pages are scanned images; their text isn't editable.");

  // per-page layout: exact geometry for form-like pages (or everything, if asked), flowing text otherwise
  const layout = opts.layout ?? "auto";
  const mode = pages.map((p) => (p.scanned && p.lines.length === 0 ? "scan" : layout === "exact" ? "fixed" : layout === "flow" ? "flow" : formStats(p).form ? "fixed" : "flow"));
  const hf = detectHeadersFooters(pages.filter((_, i) => mode[i] === "flow"));

  // document-wide metrics
  const allLines = pages.flatMap((p) => p.lines);
  const sizeWeight = new Map<number, number>();
  allLines.forEach((l) => l.segs.forEach((s) => s.glyphs.forEach((g) => sizeWeight.set(round(g.size, 2), (sizeWeight.get(round(g.size, 2)) ?? 0) + g.s.length))));
  const bodySize = [...sizeWeight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;
  const headingTiers = [...new Set(allLines.filter((l) => l.size >= bodySize * 1.2 && l.text.length < 120).map((l) => round(l.size, 2)))].sort((a, b) => b - a).slice(0, 3);
  const bodyDeltas: number[] = [];
  pages.forEach((p) =>
    p.lines.forEach((l, i) => {
      const n = p.lines[i + 1];
      if (n && Math.abs(n.size - bodySize) < 0.5 && Math.abs(l.size - bodySize) < 0.5 && n.y - l.y < bodySize * 2 && n.y > l.y) bodyDeltas.push(n.y - l.y);
    }),
  );
  const lineRatio = bodyDeltas.length ? median(bodyDeltas) / bodySize : 1.2;

  // margins from the text box of all pages (median across pages)
  const withText = pages.filter((p) => p.lines.length);
  const L = Math.max(18, median(withText.map((p) => Math.min(...p.lines.map((l) => l.x)))));
  const Rr = median(withText.map((p) => percentile(p.lines.map((l) => l.right), 0.97)));
  const pageW = median(pages.map((p) => p.w)) || 612;
  const pageH = median(pages.map((p) => p.h)) || 792;
  // Ragged text (short lines) under-reports the right margin, which made Word wrap lines the PDF kept on one
  // line. Pages almost always have symmetric margins, so never place the right margin further in than the left.
  const R = Math.min(pageW - 18, Math.max(Rr, L + 100, pageW - L));
  const topM = Math.max(18, Math.min(144, median(withText.map((p) => p.lines[0].y - p.lines[0].size))));
  const botM = Math.max(18, Math.min(144, median(withText.map((p) => pageH - p.lines.at(-1)!.y - p.lines.at(-1)!.size * 0.3))));

  // blocks per page, grouped into Word sections by column layout
  const st: NumberingState = { configs: new Map(), instance: 0 };
  const sections: ISectionOptions[] = [];
  const headers = hf.header ? { default: new Header({ children: [hfParagraph(hf.header, L, R)] }) } : undefined;
  const footers = hf.footer ? { default: new Footer({ children: [hfParagraph(hf.footer, L, R)] }) } : undefined;
  const pageProps = {
    size: { width: tw(pageW), height: tw(pageH) },
    margin: { top: tw(topM), bottom: tw(Math.min(botM, 108)), left: tw(L), right: tw(Math.max(18, pageW - R)), header: tw(Math.max(18, topM / 2)), footer: tw(Math.max(18, Math.min(botM, 108) / 2)) },
  };
  let current: { cols: number; children: (Paragraph | Table)[]; fixed?: { w: number; h: number } } | null = null;
  let lastWasFixed = false;
  const blankHF = { default: new Header({ children: [new Paragraph("")] }) };
  const blankFooter = { default: new Footer({ children: [new Paragraph("")] }) };
  const flush = () => {
    if (!current || !current.children.length) return;
    if (current.fixed) {
      // exact-layout pages: the PDF's own page size, no running header/footer (their text is on the page)
      sections.push({
        properties: {
          type: SectionType.NEXT_PAGE,
          page: { size: { width: tw(current.fixed.w), height: tw(current.fixed.h) }, margin: { top: tw(18), bottom: tw(18), left: tw(18), right: tw(18), header: 0, footer: 0 } },
        },
        headers: headers ? blankHF : undefined,
        footers: footers ? blankFooter : undefined,
        children: current.children,
      });
      lastWasFixed = true;
      return;
    }
    sections.push({
      properties: {
        type: sections.length === 0 || lastWasFixed ? SectionType.NEXT_PAGE : SectionType.CONTINUOUS,
        page: pageProps,
        column: current.cols > 1 ? { count: current.cols, space: tw(24), equalWidth: true } : undefined,
      },
      headers,
      footers,
      children: current.children,
    });
    lastWasFixed = false;
  };
  const fixedDoc = newFixedDoc();

  pages.forEach((p, pi) => {
    if (mode[pi] === "fixed") {
      const size = { w: round(p.w, 10), h: round(p.h, 10) };
      const sameSize = current?.fixed && current.fixed.w === size.w && current.fixed.h === size.h;
      if (!sameSize) {
        flush();
        current = { cols: 1, children: [], fixed: size };
      }
      current!.children.push(...fixedPage(p, { first: !sameSize, runs: runsFor, doc: fixedDoc }));
      return;
    }
    if (current?.fixed) {
      flush();
      current = null;
    }
    if (p.scanned && p.lines.length === 0) {
      // Scanned page: keep every image at its exact size and position on the page (behind text, so the
      // user can still type over it) instead of shrinking the scan to fit inside the text margins.
      if (!current || current.cols !== 1) {
        flush();
        current = { cols: 1, children: [] };
      }
      current.children.push(
        new Paragraph({ pageBreakBefore: pi > 0 || undefined, spacing: { before: 0, after: 0 }, children: floatingImages(p.images) }),
      );
      return;
    }
    const layout = pageLayout(p);
    const lastBottom = Math.max(0, ...p.lines.map((l) => l.y));
    layout.parts.forEach((part, partIdx) => {
      const partBlocks = part.regions.map((r) => regionBlocks({ ...r, left: part.cols === 1 ? L : r.left, right: part.cols === 1 ? R : r.right }, { bodySize, headingTiers, lineRatio }));
      if (part.cols === 2 && partBlocks[0].length) partBlocks[0][partBlocks[0].length - 1].columnBreakAfter = true;
      const flat = partBlocks.flat();
      if (!flat.length) return;
      // page flow: force a page break only where the previous page ended early (intentional break)
      if (partIdx === 0 && pi > 0) {
        const prev = pages[pi - 1];
        const prevBottom = Math.max(0, ...prev.lines.map((l) => l.y));
        if (prevBottom < prev.h * 0.72 || flat[0].type === "para" && (flat[0] as ParaBlock).heading === 1) flat[0].pageBreakBefore = true;
        flat[0].spacingBefore = 0;
      }
      if (partIdx === 0) flat[0].floating = layout.floating;
      if (!current || current.cols !== part.cols) {
        flush();
        current = { cols: part.cols, children: [] };
      }
      const colL = part.cols === 1 ? L : Math.min(...part.regions.map((r) => r.left));
      current.children.push(...toDocxBlocks(flat, colL, part.cols === 1 ? R : colL + (R - L - 24) / 2, st, bodySize));
    });
    void lastBottom;
  });
  flush();
  if (!sections.length) sections.push({ properties: { page: pageProps }, children: [new Paragraph("")] });

  const bodyFont = (() => {
    const fam = new Map<string, number>();
    allLines.forEach((l) => l.segs.forEach((s) => s.glyphs.forEach((g) => fam.set(g.font.family, (fam.get(g.font.family) ?? 0) + g.s.length))));
    return [...fam.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Calibri";
  })();

  const doc = new Document({
    creator: "Buddy — PDF to Word",
    styles: {
      default: {
        document: { run: { font: bodyFont, size: Math.round(bodySize * 2) }, paragraph: { spacing: { after: 0 } } },
        heading1: { run: { color: "000000" }, paragraph: { spacing: { before: 0, after: 0 } } },
        heading2: { run: { color: "000000" }, paragraph: { spacing: { before: 0, after: 0 } } },
        heading3: { run: { color: "000000" }, paragraph: { spacing: { before: 0, after: 0 } } },
        hyperlink: { run: { color: "0563C1", underline: {} } },
      },
    },
    numbering: { config: [...st.configs.values()] as never },
    sections,
  });
  const blob = await injectShapes(await Packer.toBlob(doc), fixedDoc);
  const exactPages = mode.filter((m) => m === "fixed").length;
  return { blob, pages: total, warnings: [...warnings], exactPages, pageModes: mode.map((m) => (m === "fixed" ? "exact" : m === "scan" ? "scan" : "flow")) };
}
