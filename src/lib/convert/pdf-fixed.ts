/**
 * Exact-layout PDF → Word for form-like pages (government forms, applications, certificates, invoices…).
 *
 * The flowing converter in pdf-to-docx.ts rebuilds paragraphs, which is right for reports and letters but
 * loses the geometry of forms: boxes disappear, label/value pairs drift and Word reflows everything. For
 * pages that look like forms, this module reproduces the page by coordinates instead:
 *
 *   PDF page → text segments + vector shapes (paint order) + images
 *     → ruled grids            → floating Word tables (fixed column widths, exact row heights, real borders,
 *                                 cell shading, merged cells), text placed inside the cells at its PDF offset
 *     → all other text         → absolutely positioned paragraphs (Word frames) at the PDF x/y, exact line
 *                                 height, original font/size/bold/italic/colour
 *     → other lines/boxes/fills → anchored DrawingML shapes at their exact page position and stroke width
 *     → images                 → anchored pictures, same position and size
 *
 * Every PDF page becomes exactly one Word page; nothing flows between pages. Text stays editable.
 * Word has no API for shapes in the `docx` library, so shapes are written as placeholders and swapped for
 * raw DrawingML XML after packing (see injectShapes).
 */
import {
  AlignmentType,
  BorderStyle,
  HeightRule,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LineRuleType,
  OverlapType,
  Paragraph,
  ShadingType,
  Tab,
  TabStopType,
  Table,
  TableAnchorType,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  TextWrappingType,
  VerticalAlign,
  VerticalPositionRelativeFrom,
  WidthType,
  type ParagraphChild,
} from "docx";
import type { Glyph, Img, PageData, PathCmd, RotText, Seg, Shape, TLine } from "./pdf-to-docx";
import { METRICS, compatFor } from "./fonts";

const tw = (pt: number) => Math.round(pt * 20);
const emu = (pt: number) => Math.round(pt * 12700);

type RunsFor = (glyphLines: Glyph[][], opts: { joinLines: boolean; lineBreaks?: boolean }) => ParagraphChild[];

/** Shape XML registered while building pages, injected into document.xml after packing. */
export type FixedDoc = { shapes: Map<number, string>; nextId: number };
export const newFixedDoc = (): FixedDoc => ({ shapes: new Map(), nextId: 1 });
const TOKEN = (id: number) => `@@BUDDYSHAPE${id}@@`;

// ---------------------------------------------------------------------------
// Edges (straight horizontal / vertical strokes) from shapes
// ---------------------------------------------------------------------------
type Edge = { o: "h" | "v"; pos: number; a: number; b: number; w: number; color: string; shape: number; used?: boolean };

function edgesFrom(shapes: Shape[]): Edge[] {
  const out: Edge[] = [];
  shapes.forEach((s, i) => {
    if (s.kind !== "rect") return;
    const thin = s.line || (s.fill && !s.stroke && (s.h <= 2.5 || s.w <= 2.5));
    if (thin) {
      const color = s.fill ?? s.stroke ?? "000000";
      if (s.w >= s.h) out.push({ o: "h", pos: s.y + s.h / 2, a: s.x, b: s.x + s.w, w: s.h, color, shape: i });
      else out.push({ o: "v", pos: s.x + s.w / 2, a: s.y, b: s.y + s.h, w: s.w, color, shape: i });
    } else if (s.stroke) {
      const c = s.stroke;
      out.push({ o: "h", pos: s.y, a: s.x, b: s.x + s.w, w: s.lw, color: c, shape: i });
      out.push({ o: "h", pos: s.y + s.h, a: s.x, b: s.x + s.w, w: s.lw, color: c, shape: i });
      out.push({ o: "v", pos: s.x, a: s.y, b: s.y + s.h, w: s.lw, color: c, shape: i });
      out.push({ o: "v", pos: s.x + s.w, a: s.y, b: s.y + s.h, w: s.lw, color: c, shape: i });
    }
  });
  return out.filter((e) => e.b - e.a >= 3);
}

const POS_TOL = 1.2;

/** Fraction of [a,b] covered by edges of orientation o lying on `pos`. */
function coverage(edges: Edge[], o: "h" | "v", pos: number, a: number, b: number): number {
  if (b - a <= 0) return 0;
  const iv = edges
    .filter((e) => e.o === o && Math.abs(e.pos - pos) <= POS_TOL + e.w / 2 && e.b > a - 1 && e.a < b + 1)
    .map((e) => [Math.max(a, e.a - 1.5), Math.min(b, e.b + 1.5)] as [number, number])
    .sort((x, y) => x[0] - y[0]);
  let covered = 0;
  let end = a;
  for (const [s, e] of iv) {
    if (e <= end) continue;
    covered += e - Math.max(s, end);
    end = e;
  }
  return covered / (b - a);
}

/** Border (width, colour) drawn along [a,b] on `pos`, or null. */
function borderAt(edges: Edge[], o: "h" | "v", pos: number, a: number, b: number) {
  const hits = edges.filter((e) => e.o === o && Math.abs(e.pos - pos) <= POS_TOL + e.w / 2 && Math.min(b, e.b) - Math.max(a, e.a) >= (b - a) * 0.5);
  if (!hits.length) return null;
  const best = hits.reduce((x, y) => (y.w > x.w ? y : x));
  return { w: best.w, color: best.color };
}

function clusterValues(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of sorted) {
    const g = groups.at(-1);
    if (g && v - g.at(-1)! <= tol) g.push(v);
    else groups.push([v]);
  }
  return groups.map((g) => g.reduce((s, v) => s + v, 0) / g.length);
}

// ---------------------------------------------------------------------------
// Grid (table) detection
// ---------------------------------------------------------------------------
type Region = { r0: number; r1: number; c0: number; c1: number; x0: number; x1: number; y0: number; y1: number; segs: { line: TLine; seg: Seg }[]; fill?: string };
type Grid = { xs: number[]; ys: number[]; regions: Region[]; edges: Edge[] };

function findGrids(edges: Edge[]): Grid[] {
  // connected components: collinear overlapping or perpendicular touching edges
  const parent = edges.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (i: number, j: number) => (parent[find(i)] = find(j));
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const e = edges[i];
      const f = edges[j];
      const tol = 1.5 + Math.max(e.w, f.w);
      if (e.o === f.o) {
        if (Math.abs(e.pos - f.pos) <= POS_TOL && e.a <= f.b + tol && f.a <= e.b + tol) join(i, j);
      } else {
        const h = e.o === "h" ? e : f;
        const v = e.o === "h" ? f : e;
        if (h.pos >= v.a - tol && h.pos <= v.b + tol && v.pos >= h.a - tol && v.pos <= h.b + tol) join(i, j);
      }
    }
  const comps = new Map<number, Edge[]>();
  edges.forEach((e, i) => comps.set(find(i), [...(comps.get(find(i)) ?? []), e]));

  const grids: Grid[] = [];
  for (const comp of comps.values()) {
    const hs = comp.filter((e) => e.o === "h");
    const vs = comp.filter((e) => e.o === "v");
    if (hs.length < 2 || vs.length < 2) continue;
    const xs = clusterValues(vs.map((e) => e.pos), 2);
    const ys = clusterValues(hs.map((e) => e.pos), 2);
    if (xs.length < 2 || ys.length < 2) continue;
    const [x0, x1, y0, y1] = [xs[0], xs.at(-1)!, ys[0], ys.at(-1)!];
    if (x1 - x0 < 20 || y1 - y0 < 8) continue;
    if (xs.some((x, i) => i && x - xs[i - 1] < 2.5) || ys.some((y, i) => i && y - ys[i - 1] < 2.5)) continue; // double rules
    // closed outer frame
    if (coverage(comp, "h", y0, x0, x1) < 0.9 || coverage(comp, "h", y1, x0, x1) < 0.9) continue;
    if (coverage(comp, "v", x0, y0, y1) < 0.9 || coverage(comp, "v", x1, y0, y1) < 0.9) continue;
    const R = ys.length - 1;
    const C = xs.length - 1;
    if (R * C < 2) continue;
    // interior boundaries present?
    const cell = (r: number, c: number) => r * C + c;
    const p2 = Array.from({ length: R * C }, (_, i) => i);
    const f2 = (i: number): number => (p2[i] === i ? i : (p2[i] = f2(p2[i])));
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++) {
        if (c < C - 1 && coverage(comp, "v", xs[c + 1], ys[r], ys[r + 1]) < 0.75) p2[f2(cell(r, c))] = f2(cell(r, c + 1));
        if (r < R - 1 && coverage(comp, "h", ys[r + 1], xs[c], xs[c + 1]) < 0.75) p2[f2(cell(r, c))] = f2(cell(r + 1, c));
      }
    const groups = new Map<number, number[]>();
    for (let i = 0; i < R * C; i++) groups.set(f2(i), [...(groups.get(f2(i)) ?? []), i]);
    const regions: Region[] = [];
    let ok = true;
    for (const cells of groups.values()) {
      const rs = cells.map((i) => Math.floor(i / C));
      const cs = cells.map((i) => i % C);
      const [r0, r1, c0, c1] = [Math.min(...rs), Math.max(...rs), Math.min(...cs), Math.max(...cs)];
      if ((r1 - r0 + 1) * (c1 - c0 + 1) !== cells.length) {
        ok = false; // merged area isn't a rectangle — not representable as a Word table
        break;
      }
      regions.push({ r0, r1, c0, c1, x0: xs[c0], x1: xs[c1 + 1], y0: ys[r0], y1: ys[r1 + 1], segs: [] });
    }
    if (!ok || regions.length < 2) continue;
    grids.push({ xs, ys, regions, edges: comp });
  }
  return grids;
}

// ---------------------------------------------------------------------------
// Form detection
// ---------------------------------------------------------------------------
export type FormStats = { edges: number; grids: number; boxes: number; boxedRatio: number; proseRatio: number; multiSegRatio: number; form: boolean };

/**
 * Does this page read like a form (fields, boxes, grids) rather than flowing prose? Forms are converted by
 * coordinates; prose pages keep the flowing, fully editable conversion. The strongest signal is how much of
 * the text sits inside boxes or grid cells — a report with one ruled table is not a form.
 */
export function formStats(p: PageData): FormStats {
  const edges = edgesFrom(p.shapes).filter((e) => e.b - e.a >= 10);
  const grids = findGrids(edges);
  const boxRects = p.shapes.filter((s) => s.kind === "rect" && s.stroke && s.w >= 12 && s.h >= 8);
  const boxes = p.shapes.filter((s) => s.kind === "rect" && s.stroke && s.w >= 6 && s.h >= 6).length;
  const areas = [
    ...boxRects.map((s) => ({ x0: s.x, x1: s.x + s.w, y0: s.y, y1: s.y + s.h })),
    ...grids.flatMap((g) => g.regions.map((r) => ({ x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1 }))),
  ];
  const lines = p.lines;
  const left = Math.min(...lines.map((l) => l.x), p.w);
  const right = Math.max(...lines.map((l) => l.right), 0);
  const width = Math.max(1, right - left);
  let total = 0;
  let prose = 0;
  let multi = 0;
  let boxed = 0;
  lines.forEach((l, i) => {
    const n = l.text.length;
    total += n;
    if (l.segs.length >= 2) multi++;
    const long = (x?: TLine) => !!x && x.segs.length === 1 && x.right - x.x >= width * 0.55 && x.text.length >= 35;
    // prose = a long single-segment line that belongs to a paragraph (a neighbour is long too)
    if (long(l) && (long(lines[i - 1]) || long(lines[i + 1]))) prose += n;
    for (const sg of l.segs) {
      const cx = (sg.x + sg.right) / 2;
      const cy = l.y - l.size * 0.3;
      if (areas.some((a) => cx > a.x0 && cx < a.x1 && cy > a.y0 && cy < a.y1)) boxed += sg.glyphs.reduce((k, g) => k + g.s.length + 1, 0);
    }
  });
  const proseRatio = total ? prose / total : 0;
  const boxedRatio = total ? Math.min(1, boxed / total) : 0;
  const multiSegRatio = lines.length ? multi / lines.length : 0;
  const form =
    lines.length > 0 &&
    ((boxedRatio >= 0.3 && edges.length >= 8 && proseRatio < 0.55) ||
      (grids.length >= 2 && proseRatio < 0.5) ||
      (boxes >= 4 && proseRatio < 0.5) ||
      // label/value forms (e.g. an I-20): most lines hold several separate fields, with section rules
      (multiSegRatio >= 0.4 && edges.length >= 4 && proseRatio < 0.55));
  return { edges: edges.length, grids: grids.length, boxes, boxedRatio, proseRatio, multiSegRatio, form };
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------
function segMetrics(glyphs: Glyph[]) {
  const weight = new Map<string, number>();
  let size = 0;
  for (const g of glyphs) {
    weight.set(g.font.family, (weight.get(g.font.family) ?? 0) + g.s.length);
    if (!g.vert) size = Math.max(size, g.size);
  }
  if (!size) size = Math.max(...glyphs.map((g) => g.size));
  const family = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Arial";
  const m = METRICS[compatFor(family)];
  const desc = m.desc * size;
  // Exact line height, chosen so Word and LibreOffice put the baseline in the same place. Word keeps the
  // font's descent at the bottom of an "exactly" line (baseline = L − descent); LibreOffice puts the
  // baseline at 80% of the line (measured). Both agree when L = 5 × descent.
  const L = 5 * desc;
  return { size, L, desc, baseline: L - desc };
}

/**
 * The flowing converter groups words generously into segments. For exact placement, split a line wherever
 * there is more than a normal word gap, and always at a vertical rule (a table column or box edge), so every
 * piece is positioned on its own — otherwise a label in one cell glues onto the value in the next cell.
 */
function splitSegs(line: TLine, edges: Edge[]): Seg[] {
  const glyphs = line.segs.flatMap((s) => s.glyphs).sort((a, b) => a.x - b.x);
  const out: Seg[] = [];
  for (const g of glyphs) {
    const cur = out.at(-1);
    const prev = cur?.glyphs.at(-1);
    let split = !cur;
    if (cur && prev) {
      const gap = g.x - (prev.x + prev.w);
      const size = Math.max(prev.size, g.size);
      const ruleBetween = edges.some((e) => e.o === "v" && e.pos > prev.x + prev.w - 0.5 && e.pos < g.x + 0.5 && e.a <= g.y + 1 && e.b >= g.y - size * 0.7);
      split = ruleBetween || (!g.joined && gap > Math.max(0.55 * size, 3));
    }
    if (split) out.push({ x: g.x, right: g.x + g.w, glyphs: [g] });
    else {
      cur!.glyphs.push(g);
      cur!.right = Math.max(cur!.right, g.x + g.w);
    }
  }
  return out;
}

const segBaseline = (line: TLine, seg: Seg) => {
  const main = seg.glyphs.filter((g) => !g.vert);
  return main.length ? Math.max(...main.map((g) => g.y)) : line.y;
};

// ---------------------------------------------------------------------------
// Shapes → DrawingML
// ---------------------------------------------------------------------------
const hexOk = (c?: string) => (c && /^[0-9A-F]{6}$/i.test(c) ? c.toUpperCase() : "000000");

function geometryXml(s: Shape, w: number, h: number): string {
  if (s.kind === "rect" || !s.cmds?.length) return `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`;
  const P = (x: number, y: number) => `<a:pt x="${emu(Math.max(0, x - s.x))}" y="${emu(Math.max(0, y - s.y))}"/>`;
  let d = "";
  for (const c of s.cmds) {
    if (c.op === "M") d += `<a:moveTo>${P(c.pts[0], c.pts[1])}</a:moveTo>`;
    else if (c.op === "L") d += `<a:lnTo>${P(c.pts[0], c.pts[1])}</a:lnTo>`;
    else if (c.op === "C") d += `<a:cubicBezTo>${P(c.pts[0], c.pts[1])}${P(c.pts[2], c.pts[3])}${P(c.pts[4], c.pts[5])}</a:cubicBezTo>`;
    else d += `<a:close/>`;
  }
  const noFill = s.fill ? "" : ` fill="none"`;
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${emu(w)}" h="${emu(h)}"${noFill}>${d}</a:path></a:pathLst></a:custGeom>`;
}

function shapeXml(s: Shape, id: number): string {
  const w = Math.max(s.w, 0.05);
  const h = Math.max(s.h, 0.05);
  const fill = s.fill ? `<a:solidFill><a:srgbClr val="${hexOk(s.fill)}"/></a:solidFill>` : `<a:noFill/>`;
  const ln = s.stroke
    ? `<a:ln w="${emu(s.lw)}"><a:solidFill><a:srgbClr val="${hexOk(s.stroke)}"/></a:solidFill><a:miter lim="800000"/></a:ln>`
    : `<a:ln><a:noFill/></a:ln>`;
  return (
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${1000 + s.z * 2}" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${emu(s.x)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${emu(s.y)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${emu(w)}" cy="${emu(h)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    `<wp:docPr id="${50000 + id}" name="Shape ${id}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
    `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>${geometryXml(s, w, h)}${fill}${ln}</wps:spPr>` +
    `<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr></wps:wsp>` +
    `</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
  );
}

const xmlEsc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Rotated text (e.g. a form number running up the margin) as a rotated text box. DrawingML rotates a shape
 * around its centre, so the unrotated box (run length × line height) is centred where the rotated run is.
 */
function rotatedTextXml(r: RotText, id: number, z: number): string {
  const m = METRICS[compatFor(r.font.family)];
  const desc = m.desc * r.size;
  const L = 5 * desc;
  const len = r.len * 1.08 + r.size * 0.5;
  const deg = ((r.angle % 360) + 360) % 360;
  // Vertical text (the usual case: form numbers and notices up the margin) uses a vertical text direction,
  // which both Word and LibreOffice lay out. Other angles fall back to a rotated box (Word honours it).
  let box: { x: number; y: number; w: number; h: number };
  let vert = "horz";
  let rot = 0;
  if (Math.abs(deg - 270) < 3) {
    // reads bottom → top, glyph tops point left: the line box sits left of the baseline
    vert = "vert270";
    box = { x: r.x - (L - desc), y: r.y - len, w: L, h: len };
  } else if (Math.abs(deg - 90) < 3) {
    // reads top → bottom, glyph tops point right
    vert = "vert";
    box = { x: r.x - desc, y: r.y, w: L, h: len };
  } else {
    const a = (r.angle * Math.PI) / 180;
    const u = [Math.cos(a), Math.sin(a)];
    const v = [-Math.sin(a), Math.cos(a)];
    const across = (desc - (L - desc)) / 2;
    const cx = r.x + (len / 2) * u[0] + across * v[0];
    const cy = r.y + (len / 2) * u[1] + across * v[1];
    box = { x: cx - len / 2, y: cy - L / 2, w: len, h: L };
    rot = Math.round(deg * 60000);
  }
  const run =
    `<w:r><w:rPr><w:rFonts w:ascii="${r.font.family}" w:hAnsi="${r.font.family}" w:cs="${r.font.family}"/>${r.font.bold ? "<w:b/>" : ""}${r.font.italic ? "<w:i/>" : ""}` +
    `<w:sz w:val="${Math.round(r.size * 2)}"/><w:szCs w:val="${Math.round(r.size * 2)}"/></w:rPr><w:t xml:space="preserve">${xmlEsc(r.text)}</w:t></w:r>`;
  return (
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${1000 + z * 2}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${emu(box.x)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${emu(box.y)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${emu(box.w)}" cy="${emu(box.h)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    `<wp:docPr id="${50000 + id}" name="Text ${id}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
    `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm${rot ? ` rot="${rot}"` : ""}><a:off x="0" y="0"/><a:ext cx="${emu(box.w)}" cy="${emu(box.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr>` +
    `<wps:txbx><w:txbxContent><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${tw(L)}" w:lineRule="exact"/></w:pPr>${run}</w:p></w:txbxContent></wps:txbx>` +
    `<wps:bodyPr rot="0" vert="${vert}" wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr></wps:wsp>` +
    `</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
  );
}

/** Replace shape placeholders in word/document.xml with DrawingML (called after Packer). */
export async function injectShapes(blob: Blob, doc: FixedDoc): Promise<Blob> {
  if (!doc.shapes.size) return blob;
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const path = "word/document.xml";
  let xml = await zip.file(path)!.async("string");
  xml = xml.replace(/<w:r>(?:<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>)?<w:t(?: [^>]*)?>@@BUDDYSHAPE(\d+)@@<\/w:t><\/w:r>/g, (_, id) => doc.shapes.get(Number(id)) ?? "");
  zip.file(path, xml);
  // forms are full of codes, names and abbreviations: hide spelling/grammar squiggles
  const settingsPath = "word/settings.xml";
  const settings = await zip.file(settingsPath)?.async("string");
  if (settings && !settings.includes("hideSpellingErrors")) {
    // schema order: …displayBackgroundShape … hideSpellingErrors, hideGrammaticalErrors … evenAndOddHeaders…
    const flags = "<w:hideSpellingErrors/><w:hideGrammaticalErrors/>";
    zip.file(
      settingsPath,
      settings.includes("<w:displayBackgroundShape/>")
        ? settings.replace("<w:displayBackgroundShape/>", `<w:displayBackgroundShape/>${flags}`)
        : settings.replace(/<w:settings([^>]*)>/, `<w:settings$1>${flags}`),
    );
  }
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", compression: "DEFLATE" });
}

// ---------------------------------------------------------------------------
// Page builder
// ---------------------------------------------------------------------------
const NONE = { style: BorderStyle.NONE, size: 0, color: "auto" };
const border = (b: { w: number; color: string } | null) =>
  b ? { style: BorderStyle.SINGLE, size: Math.max(2, Math.min(96, Math.round(b.w * 8))), color: hexOk(b.color) } : NONE;

const tinyPara = (pageBreakBefore = false, children: ParagraphChild[] = []) =>
  new Paragraph({
    pageBreakBefore: pageBreakBefore || undefined,
    spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
    children: [new TextRun({ text: "", size: 2 }), ...children],
  });

function cellParagraphs(reg: Region, runs: RunsFor): Paragraph[] {
  // group this cell's segments by PDF line, top to bottom
  const byLine = new Map<TLine, Seg[]>();
  for (const { line, seg } of reg.segs) byLine.set(line, [...(byLine.get(line) ?? []), seg]);
  const lines = [...byLine.entries()].sort((a, b) => a[0].y - b[0].y);
  if (!lines.length) return [new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT }, children: [new TextRun({ text: "", size: 2 })] })];
  let cursor = reg.y0;
  return lines.map(([line, segs]) => {
    segs.sort((a, b) => a.x - b.x);
    const m = segMetrics(segs.flatMap((s) => s.glyphs));
    const base = Math.max(...segs.map((s) => segBaseline(line, s)));
    // the line box ends at baseline + descent; if the previous line (or the cell top) is closer than the
    // natural height, shrink this line's height instead of pushing it down
    const bottom = base + m.desc;
    const L = Math.max(1, Math.min(m.L, bottom - cursor));
    const top = bottom - L;
    const before = Math.max(0, top - cursor);
    cursor = top + L;
    const first = segs[0];
    const onlyRight = segs.length === 1 && reg.x1 - first.right < 8 && first.x - reg.x0 > 20;
    const children: ParagraphChild[] = [...runs([first.glyphs], { joinLines: false })];
    const tabStops: { type: (typeof TabStopType)[keyof typeof TabStopType]; position: number }[] = [];
    for (const s of segs.slice(1)) {
      const right = reg.x1 - s.right < 8;
      tabStops.push(right ? { type: TabStopType.RIGHT, position: tw(s.right - reg.x0) } : { type: TabStopType.LEFT, position: tw(s.x - reg.x0) });
      children.push(new TextRun({ children: [new Tab()] }), ...runs([s.glyphs], { joinLines: false }));
    }
    return new Paragraph({
      alignment: onlyRight ? AlignmentType.RIGHT : AlignmentType.LEFT,
      indent: onlyRight ? { right: tw(Math.max(0, reg.x1 - first.right)) } : { left: tw(Math.max(0, first.x - reg.x0)) },
      tabStops: tabStops.length ? tabStops : undefined,
      spacing: { before: tw(before), after: 0, line: tw(L), lineRule: LineRuleType.EXACT },
      children,
    });
  });
}

function gridTable(g: Grid, runs: RunsFor): Table {
  const R = g.ys.length - 1;
  const C = g.xs.length - 1;
  const at = new Map<string, Region>();
  g.regions.forEach((r) => at.set(`${r.r0},${r.c0}`, r));
  const covered = new Set<string>();
  g.regions.forEach((r) => {
    for (let rr = r.r0; rr <= r.r1; rr++) for (let cc = r.c0; cc <= r.c1; cc++) if (rr !== r.r0 || cc !== r.c0) covered.add(`${rr},${cc}`);
  });
  const rows: TableRow[] = [];
  for (let r = 0; r < R; r++) {
    const cells: TableCell[] = [];
    for (let c = 0; c < C; c++) {
      const reg = at.get(`${r},${c}`);
      if (!reg) {
        if (covered.has(`${r},${c}`)) continue; // spanned by a merged cell (docx adds the vMerge continuations)
        continue;
      }
      cells.push(
        new TableCell({
          columnSpan: reg.c1 - reg.c0 + 1 > 1 ? reg.c1 - reg.c0 + 1 : undefined,
          rowSpan: reg.r1 - reg.r0 + 1 > 1 ? reg.r1 - reg.r0 + 1 : undefined,
          width: { size: tw(reg.x1 - reg.x0), type: WidthType.DXA },
          margins: { top: 0, bottom: 0, left: 0, right: 0, marginUnitType: WidthType.DXA },
          verticalAlign: VerticalAlign.TOP,
          shading: reg.fill ? { fill: reg.fill, type: ShadingType.CLEAR, color: "auto" } : undefined,
          borders: {
            top: border(borderAt(g.edges, "h", reg.y0, reg.x0, reg.x1)),
            bottom: border(borderAt(g.edges, "h", reg.y1, reg.x0, reg.x1)),
            left: border(borderAt(g.edges, "v", reg.x0, reg.y0, reg.y1)),
            right: border(borderAt(g.edges, "v", reg.x1, reg.y0, reg.y1)),
          },
          children: cellParagraphs(reg, runs),
        }),
      );
    }
    rows.push(new TableRow({ height: { value: tw(g.ys[r + 1] - g.ys[r]), rule: HeightRule.EXACT }, cantSplit: true, children: cells }));
  }
  const x0 = g.xs[0];
  const y0 = g.ys[0];
  return new Table({
    rows,
    columnWidths: g.xs.slice(1).map((x, i) => tw(x - g.xs[i])),
    width: { size: tw(g.xs.at(-1)! - x0), type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    margins: { top: 0, bottom: 0, left: 0, right: 0, marginUnitType: WidthType.DXA },
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    float: {
      horizontalAnchor: TableAnchorType.PAGE,
      verticalAnchor: TableAnchorType.PAGE,
      absoluteHorizontalPosition: tw(x0),
      absoluteVerticalPosition: tw(y0),
      overlap: OverlapType.OVERLAP,
      leftFromText: 0,
      rightFromText: 0,
      topFromText: 0,
      bottomFromText: 0,
    },
  });
}

/** Word run XML for one line of glyphs (same grouping and spacing rules as runsFor). */
function runsXml(glyphs: Glyph[]): string {
  type R = { text: string; g: Glyph };
  const runs: R[] = [];
  glyphs.forEach((g, gi) => {
    const prev = glyphs[gi - 1];
    let text = g.s;
    if (prev && (g.joined ? g.spaceBefore : g.x - (prev.x + prev.w) > 0.12 * g.size && !g.vert && !prev.vert)) text = " " + text;
    const last = runs.at(-1);
    const same = last && last.g.font.family === g.font.family && last.g.font.bold === g.font.bold && last.g.font.italic === g.font.italic && Math.abs(last.g.size - g.size) < 0.3 && last.g.color === g.color && last.g.vert === g.vert;
    if (same) last!.text += text;
    else runs.push({ text, g });
  });
  return runs
    .map(({ text, g }) => {
      const f = xmlEsc(g.font.family);
      const size = Math.round((g.vert ? Math.min(g.size / 0.65, 72) : g.size) * 2);
      // rPr children in schema order: rFonts, b, i, noProof, color, sz, szCs, vertAlign
      return (
        `<w:r><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}" w:eastAsia="${f}"/>${g.font.bold ? "<w:b/><w:bCs/>" : ""}${g.font.italic ? "<w:i/><w:iCs/>" : ""}<w:noProof/>` +
        `${g.color ? `<w:color w:val="${hexOk(g.color)}"/>` : ""}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` +
        `${g.vert ? `<w:vertAlign w:val="${g.vert === "super" ? "superscript" : "subscript"}"/>` : ""}</w:rPr><w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`
      );
    })
    .join("");
}

/**
 * Positioned text as an anchored text box. Word keeps anchored objects with allowOverlap exactly where they
 * are; legacy frames (w:framePr) are pushed apart by Word whenever they touch, which scrambled tightly
 * packed forms (labels 9pt above their values). The box doesn't wrap, so its width can't move anything.
 */
function textBoxXml(line: TLine, seg: Seg, id: number, z: number, justified: boolean): string {
  const m = segMetrics(seg.glyphs);
  const base = segBaseline(line, seg);
  const top = base - m.baseline;
  const w = justified ? seg.right - seg.x + 0.3 : (seg.right - seg.x) * 1.12 + m.size;
  const h = m.L + 0.5;
  const jc = justified ? `<w:jc w:val="distribute"/>` : "";
  return (
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${z}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${emu(seg.x)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${emu(top)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${emu(w)}" cy="${emu(h)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    `<wp:docPr id="${50000 + id}" name="Text ${id}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
    `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr>` +
    `<wps:txbx><w:txbxContent><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${tw(m.L)}" w:lineRule="exact"/>${jc}</w:pPr>${runsXml(seg.glyphs)}</w:p></w:txbxContent></wps:txbx>` +
    `<wps:bodyPr rot="0" vert="horz" wrap="${justified ? "square" : "none"}" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr></wps:wsp>` +
    `</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
  );
}

function imageRun(im: Img): ImageRun {
  return new ImageRun({
    type: "png",
    data: im.png,
    transformation: { width: im.w * (96 / 72), height: im.h * (96 / 72) },
    floating: {
      horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: emu(im.x) },
      verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: emu(im.y) },
      behindDocument: true,
      allowOverlap: true,
      zIndex: 1000 + (im.z ?? 0) * 2,
      wrap: { type: TextWrappingType.NONE },
    },
  });
}

/**
 * One PDF page → Word content that lays out on exactly one page:
 *   [page anchor] [floating tables…] [positioned text…] [anchor holding shapes + images]
 */
export function fixedPage(p: PageData, opts: { first: boolean; runs: RunsFor; doc: FixedDoc }): (Paragraph | Table)[] {
  const edges = edgesFrom(p.shapes);
  const grids = findGrids(edges);
  const lines: TLine[] = p.lines.map((l) => ({ ...l, segs: splitSegs(l, edges) }));

  // text → grid cells (a segment belongs to a cell if its box sits inside the cell)
  const placed = new Set<Seg>();
  for (const line of lines)
    for (const seg of line.segs) {
      const m = segMetrics(seg.glyphs);
      const base = segBaseline(line, seg);
      const top = base - m.size * 0.75;
      for (const g of grids) {
        const reg = g.regions.find((r) => seg.x >= r.x0 - 1 && seg.right <= r.x1 + 2 && top >= r.y0 - 1.5 && base <= r.y1 + 1);
        if (reg) {
          reg.segs.push({ line, seg });
          placed.add(seg);
          break;
        }
      }
    }

  // shapes consumed by tables: grid edges become cell borders, cell-sized fills become shading
  const consumed = new Set<number>();
  for (const g of grids) {
    const [x0, x1, y0, y1] = [g.xs[0], g.xs.at(-1)!, g.ys[0], g.ys.at(-1)!];
    for (const e of g.edges) {
      const onLine = e.o === "h" ? g.ys.some((y) => Math.abs(y - e.pos) <= POS_TOL + e.w / 2) : g.xs.some((x) => Math.abs(x - e.pos) <= POS_TOL + e.w / 2);
      const inside = e.o === "h" ? e.a >= x0 - 2 - e.w && e.b <= x1 + 2 + e.w : e.a >= y0 - 2 - e.w && e.b <= y1 + 2 + e.w;
      if (onLine && inside) e.used = true;
    }
    // fills that exactly cover one or more whole cells become cell shading (e.g. a grey header row)
    p.shapes.forEach((s, i) => {
      if (consumed.has(i) || s.kind !== "rect" || !s.fill || s.line || s.stroke || s.w <= 3 || s.h <= 3) return;
      const cells = g.regions.filter((r) => r.x0 >= s.x - 1.5 && r.x1 <= s.x + s.w + 1.5 && r.y0 >= s.y - 1.5 && r.y1 <= s.y + s.h + 1.5);
      const area = cells.reduce((a, r) => a + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
      if (!cells.length || area < s.w * s.h * 0.9) return;
      cells.forEach((r) => (r.fill = hexOk(s.fill)));
      consumed.add(i);
    });
  }
  const byShape = new Map<number, Edge[]>();
  edges.forEach((e) => byShape.set(e.shape, [...(byShape.get(e.shape) ?? []), e]));
  for (const [i, es] of byShape) if (es.every((e) => e.used)) consumed.add(i);

  const out: (Paragraph | Table)[] = [tinyPara(!opts.first)];
  for (const g of grids) {
    out.push(gridTable(g, opts.runs));
    out.push(tinyPara()); // keeps consecutive floating tables from being merged into one
  }
  // justified text: consecutive lines of one paragraph that share both the left and the right edge
  const justified = new Set<Seg>();
  const loose = lines.flatMap((line) => line.segs.filter((sg) => !placed.has(sg)).map((seg) => ({ line, seg })));
  for (const a of loose) {
    const words = a.seg.glyphs.length;
    if (words < 4 || a.seg.right - a.seg.x < 120) continue;
    const partner = loose.some(
      (b) =>
        b !== a &&
        Math.abs(b.seg.x - a.seg.x) <= 1 &&
        Math.abs(b.seg.right - a.seg.right) <= 0.8 &&
        Math.abs(b.line.y - a.line.y) <= Math.max(a.line.size, b.line.size) * 2 &&
        Math.abs(b.line.size - a.line.size) < 0.5,
    );
    if (partner) justified.add(a.seg);
  }
  const textBoxes: ParagraphChild[] = [];
  loose.forEach(({ line, seg }, k) => {
    const id = opts.doc.nextId++;
    opts.doc.shapes.set(id, textBoxXml(line, seg, id, 500000 + k, justified.has(seg)));
    textBoxes.push(new TextRun({ text: TOKEN(id) }));
  });

  const anchors: ParagraphChild[] = [];
  p.shapes.forEach((s, i) => {
    if (consumed.has(i)) return;
    const id = opts.doc.nextId++;
    opts.doc.shapes.set(id, shapeXml(s, id));
    anchors.push(new TextRun({ text: TOKEN(id) }));
  });
  for (const im of p.images) anchors.push(imageRun(im));
  const topZ = Math.max(0, ...p.shapes.map((s) => s.z), ...p.images.map((im) => im.z ?? 0)) + 1;
  p.rotated.forEach((r, k) => {
    const id = opts.doc.nextId++;
    opts.doc.shapes.set(id, rotatedTextXml(r, id, topZ + k));
    anchors.push(new TextRun({ text: TOKEN(id) }));
  });
  out.push(tinyPara(false, [...anchors, ...textBoxes]));
  return out;
}

export type { PathCmd };
