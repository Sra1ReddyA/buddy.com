/**
 * Word (.docx) → PDF, entirely in the browser.
 *
 * Pipeline: parseDocx() → layout (line breaking, tabs, lists, tables, columns) → pagination → jsPDF drawing.
 * Text is real, selectable PDF text in metric-compatible fonts, so lines wrap where Word wraps them.
 *
 * Supported: styles & themes, fonts/sizes/bold/italic/underline/strike/colour/highlight/super-/subscript,
 * alignment incl. justify, indents, spacing & line rules, tab stops (left/right/center, dot leaders),
 * bullets & numbering, tables (grid widths, spans, vertical merges, borders, shading, header rows),
 * inline images, hyperlinks, page/column/section breaks, multi-column sections, page size & margins,
 * headers/footers with PAGE / NUMPAGES fields, text boxes (flowed inline).
 * Not rendered: footnotes/endnotes, comments, charts/SmartArt, WordArt, EMF/WMF vector images.
 */
import { jsPDF } from "jspdf";
import { parseDocx, type Block, type Border, type Inline, type Para, type RunProps, type SectionProps, type Table, type DocModel } from "./docx-model";
import { METRICS, compatFor, faceOf, pdfFontName, registerFonts, type Compat, type Face } from "./fonts";

// ---------------------------------------------------------------------------
// Draw list (page-independent) — laid out first, painted after pagination
// ---------------------------------------------------------------------------
type Font = { c: Compat; face: Face; size: number; cs?: number };
type Draw =
  | { k: "text"; x: number; y: number; s: string; font: Font; color: string }
  | { k: "field"; x: number; y: number; field: "PAGE" | "NUMPAGES"; font: Font; color: string }
  | { k: "rect"; x: number; y: number; w: number; h: number; fill: string }
  | { k: "line"; x1: number; y1: number; x2: number; y2: number; w: number; color: string }
  | { k: "image"; x: number; y: number; w: number; h: number; data: Uint8Array | null; fmt: string }
  | { k: "link"; x: number; y: number; w: number; h: number; url: string };

const shift = (d: Draw, dx: number, dy: number): Draw => {
  switch (d.k) {
    case "line":
      return { ...d, x1: d.x1 + dx, x2: d.x2 + dx, y1: d.y1 + dy, y2: d.y2 + dy };
    default:
      return { ...d, x: d.x + dx, y: d.y + dy } as Draw;
  }
};

type Env = {
  doc: jsPDF;
  defaultTab: number;
  widthCache: Map<string, number>;
  /** Known while laying out headers/footers (after pagination), so page-number fields get their real width. */
  pageNo?: number;
  total?: number;
};
const fieldText = (env: Env, f: "PAGE" | "NUMPAGES") => (f === "PAGE" ? env.pageNo : env.total)?.toString() ?? "88";

function fontOf(p: RunProps): Font {
  const size = p.vertAlign ? p.size * 0.65 : p.size;
  return { c: compatFor(p.font), face: faceOf(p.bold, p.italic), size, cs: p.charSpace || undefined };
}

function measure(env: Env, s: string, f: Font): number {
  const key = `${f.c}${f.face}${f.size}${f.cs ?? ""}\u0000${s}`;
  let w = env.widthCache.get(key);
  if (w === undefined) {
    env.doc.setFont(pdfFontName(f.c, f.face), "normal");
    env.doc.setFontSize(f.size);
    w = env.doc.getTextWidth(s) + (f.cs ?? 0) * [...s].length;
    env.widthCache.set(key, w);
  }
  return w;
}

// ---------------------------------------------------------------------------
// Paragraph layout
// ---------------------------------------------------------------------------
type Atom =
  | { t: "word"; s: string; w: number; p: RunProps; f: Font; link?: string }
  | { t: "space"; s: string; w: number; p: RunProps; f: Font; link?: string }
  | { t: "tab"; w: number; p: RunProps; f: Font; leader?: string; align?: "left" | "right" | "center" | "decimal"; stop?: number; num?: boolean }
  | { t: "break"; kind: "line" | "page" | "column" }
  | { t: "image"; w: number; h: number; data: Uint8Array | null; fmt: string }
  | { t: "field"; field: "PAGE" | "NUMPAGES"; w: number; p: RunProps; f: Font };

type Line = { atoms: Atom[]; x0: number; width: number; brk?: "line" | "page" | "column"; last: boolean };
export type LineBox = { h: number; draws: Draw[]; brk?: "page" | "column" };
type LaidPara = { kind: "para"; lines: LineBox[]; before: number; after: number; para: Para };

function atomsOf(env: Env, p: Para): Atom[] {
  const atoms: Atom[] = [];
  const pushText = (text: string, props: RunProps, link?: string) => {
    const s = props.caps ? text.toUpperCase() : text;
    const f = fontOf(props);
    for (const m of s.matchAll(/(\s+)|([^\s]+)/g)) {
      if (m[1]) atoms.push({ t: "space", s: m[1].replace(/\s/g, " "), w: measure(env, m[1].replace(/\s/g, " "), f), p: props, f, link });
      else atoms.push({ t: "word", s: m[2], w: measure(env, m[2], f), p: props, f, link });
    }
  };
  if (p.numLabel) {
    pushText(p.numLabel.text, p.numLabel.props);
    // label and text are separated by a tab to the left indent (Word's default list suffix)
    atoms.push({ t: "tab", w: 0, p: p.numLabel.props, f: fontOf(p.numLabel.props), num: true });
  }
  for (const i of p.inlines) {
    if (i.type === "text") pushText(i.text, i.props, i.link);
    else if (i.type === "tab") atoms.push({ t: "tab", w: 0, p: i.props, f: fontOf(i.props) });
    else if (i.type === "break") atoms.push({ t: "break", kind: i.kind });
    else if (i.type === "image") atoms.push({ t: "image", w: i.w, h: i.h, data: i.data, fmt: i.mime });
    else if (i.type === "field") {
      const f = fontOf(i.props);
      atoms.push({ t: "field", field: i.field, w: measure(env, fieldText(env, i.field), f), p: i.props, f });
    }
  }
  // merge adjacent word atoms that belong to one word but differ in style ("Hello" + "World" without space)
  return atoms;
}

/** Width of the text following a tab up to the next tab/break (for right/center tabs). */
function segmentWidth(atoms: Atom[], from: number) {
  let w = 0;
  for (let i = from; i < atoms.length; i++) {
    const a = atoms[i];
    if (a.t === "tab" || a.t === "break") break;
    w += "w" in a ? a.w : 0;
  }
  return w;
}

function nextTab(p: Para, env: Env, x: number, isNum: boolean) {
  const ind = p.props.indLeft;
  if (isNum || (p.props.indFirst < 0 && x < ind - 0.01)) {
    // hanging indent acts as an implicit tab stop
    if (x < ind - 0.01) return { pos: ind, align: "left" as const };
  }
  const stop = p.props.tabs.find((t) => t.pos > x + 0.01);
  if (stop) return stop;
  const d = env.defaultTab || 36;
  return { pos: Math.floor(x / d + 1) * d, align: "left" as const };
}

function breakLines(env: Env, p: Para, atoms: Atom[], width: number): Line[] {
  const { indLeft, indRight, indFirst } = p.props;
  const lines: Line[] = [];
  let cur: Atom[] = [];
  let first = true;
  let x0 = indLeft + indFirst;
  let x = x0;
  const right = width - indRight;

  const flush = (brk?: Line["brk"], last = false) => {
    while (cur.length && cur.at(-1)!.t === "space") cur.pop(); // trailing spaces never count
    lines.push({ atoms: cur, x0, width: right - x0, brk, last });
    cur = [];
    first = false;
    x0 = indLeft;
    x = x0;
  };

  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    if (a.t === "break") {
      flush(a.kind, true);
      continue;
    }
    if (a.t === "tab") {
      const stop = nextTab(p, env, x, !!a.num);
      let target = stop.pos;
      if (stop.align === "right" || stop.align === "decimal") target = Math.max(x, stop.pos - segmentWidth(atoms, i + 1));
      else if (stop.align === "center") target = Math.max(x, stop.pos - segmentWidth(atoms, i + 1) / 2);
      if (a.num && x > indLeft - 0.01) target = x + measure(env, " ", a.f); // label wider than the hanging indent
      if (target > right + 0.5 && cur.length) {
        flush();
        continue;
      }
      const leader = "leader" in stop && stop.leader ? (stop.leader === "dot" ? "." : stop.leader === "hyphen" ? "-" : "_") : undefined;
      cur.push({ ...a, w: Math.max(0, target - x), leader, align: stop.align, stop: stop.pos });
      x = target;
      continue;
    }
    const w = a.w;
    if (a.t === "space") {
      cur.push(a);
      x += w;
      continue;
    }
    if (x + w > right + 0.01 && cur.some((c) => c.t !== "space")) {
      flush();
    }
    if (a.t === "word" && w > right - x0 + 0.01) {
      // a single word wider than the line: split by characters
      let buf = "";
      for (const ch of a.s) {
        const test = buf + ch;
        if (x + measure(env, test, a.f) > right && buf) {
          cur.push({ ...a, s: buf, w: measure(env, buf, a.f) });
          flush();
          buf = ch;
        } else buf = test;
      }
      const rest = { ...a, s: buf, w: measure(env, buf, a.f) };
      cur.push(rest);
      x += rest.w;
      continue;
    }
    cur.push(a);
    x += w;
  }
  if (cur.length || first || lines.length === 0) flush(undefined, true);
  else if (lines.length) lines[lines.length - 1].last = true;
  return lines;
}

function lineMetrics(p: Para, atoms: Atom[]) {
  let asc = 0;
  let desc = 0;
  let natural = 0;
  let img = 0;
  const texts = atoms.filter((a) => a.t === "word" || a.t === "space" || a.t === "field" || a.t === "tab") as { p: RunProps; f: Font }[];
  const props = texts.length ? texts.map((t) => t.p) : [p.markProps];
  for (const rp of props) {
    const m = METRICS[compatFor(rp.font)];
    asc = Math.max(asc, rp.size * m.asc);
    desc = Math.max(desc, rp.size * m.desc);
    natural = Math.max(natural, rp.size * m.line);
  }
  for (const a of atoms) if (a.t === "image") img = Math.max(img, a.h);
  const rule = p.props.line;
  let h: number;
  if (rule.rule === "exact") h = rule.value;
  else if (rule.rule === "atLeast") h = Math.max(rule.value, Math.max(natural, img + desc));
  else h = Math.max(natural * rule.value, img + desc + (natural - asc - desc));
  // text sits on the bottom of the line box (Word adds extra line spacing above the text)
  return { h, baseline: h - desc, asc: Math.max(asc, img) };
}

function layoutPara(env: Env, p: Para, width: number): LaidPara {
  const atoms = atomsOf(env, p);
  const lines = breakLines(env, p, atoms, width);
  const boxes: LineBox[] = [];
  const align = p.props.align;

  for (const line of lines) {
    const { h, baseline } = lineMetrics(p, line.atoms);
    const draws: Draw[] = [];
    // alignment only applies to the part after the last tab (Word behaviour)
    const lastTab = line.atoms.map((a) => a.t).lastIndexOf("tab");
    const content = line.atoms.reduce((s, a) => s + ("w" in a ? a.w : 0), 0);
    let offset = 0;
    let extraPerSpace = 0;
    const free = line.width - content;
    if (align === "center" && lastTab < 0) offset = free / 2;
    else if (align === "right" && lastTab < 0) offset = free;
    else if (align === "both" && !line.last && free > 0) {
      const spaces = line.atoms.filter((a, idx) => a.t === "space" && idx > lastTab).length;
      if (spaces) extraPerSpace = free / spaces;
    }
    let x = line.x0 + offset;
    const baseY = baseline;
    for (let idx = 0; idx < line.atoms.length; idx++) {
      const a = line.atoms[idx];
      if (a.t === "word" || a.t === "field") {
        const rp = a.p;
        const dy = rp.vertAlign === "superscript" ? -rp.size * 0.33 : rp.vertAlign === "subscript" ? rp.size * 0.14 : 0;
        const m = METRICS[a.f.c];
        if (rp.highlight) draws.push({ k: "rect", x, y: baseY - rp.size * m.asc, w: a.w, h: rp.size * (m.asc + m.desc), fill: rp.highlight });
        if (a.t === "word") draws.push({ k: "text", x, y: baseY + dy, s: a.s, font: a.f, color: rp.color });
        else draws.push({ k: "field", x, y: baseY + dy, field: a.field, font: a.f, color: rp.color });
        if (a.t === "word" && a.link) draws.push({ k: "link", x, y: baseY - rp.size * m.asc, w: a.w, h: rp.size * (m.asc + m.desc), url: a.link });
        const next = line.atoms[idx + 1];
        const spanW = a.w + (next && next.t === "space" && next.p === rp && idx + 2 < line.atoms.length ? next.w + extraPerSpace : 0);
        if (rp.underline) draws.push({ k: "line", x1: x, y1: baseY + rp.size * 0.12, x2: x + spanW, y2: baseY + rp.size * 0.12, w: Math.max(0.5, rp.size * 0.05), color: rp.color });
        if (rp.strike) draws.push({ k: "line", x1: x, y1: baseY - rp.size * 0.28, x2: x + a.w, y2: baseY - rp.size * 0.28, w: Math.max(0.5, rp.size * 0.05), color: rp.color });
        x += a.w;
      } else if (a.t === "space") {
        if (a.p.highlight) {
          const m = METRICS[a.f.c];
          draws.push({ k: "rect", x, y: baseY - a.p.size * m.asc, w: a.w + extraPerSpace, h: a.p.size * (m.asc + m.desc), fill: a.p.highlight });
        }
        x += a.w + (idx > lastTab ? extraPerSpace : 0);
      } else if (a.t === "tab") {
        if (a.leader && a.w > 4) {
          const dot = measure(env, a.leader, a.f);
          const n = Math.floor((a.w - 4) / dot);
          if (n > 0) draws.push({ k: "text", x: x + (a.w - n * dot) - 2, y: baseY, s: a.leader.repeat(n), font: a.f, color: a.p.color });
        }
        x += a.w;
      } else if (a.t === "image") {
        draws.push({ k: "image", x, y: baseY - a.h, w: a.w, h: a.h, data: a.data, fmt: a.fmt });
        x += a.w;
      }
    }
    boxes.push({ h, draws, brk: line.brk === "page" || line.brk === "column" ? line.brk : undefined });
  }

  // paragraph shading / borders span the full text box
  if (p.props.shading || p.props.borderBottom || p.props.borderTop) {
    const total = boxes.reduce((s, b) => s + b.h, 0);
    const x1 = p.props.indLeft;
    const x2 = width - p.props.indRight;
    if (p.props.shading && boxes.length) boxes[0].draws.unshift({ k: "rect", x: x1, y: 0, w: x2 - x1, h: total, fill: p.props.shading });
    if (p.props.borderTop && boxes.length) boxes[0].draws.push({ k: "line", x1, y1: -p.props.borderTop.space, x2, y2: -p.props.borderTop.space, w: p.props.borderTop.width, color: p.props.borderTop.color });
    if (p.props.borderBottom && boxes.length) {
      const last = boxes[boxes.length - 1];
      const y = last.h + p.props.borderBottom.space + p.props.borderBottom.width / 2;
      last.draws.push({ k: "line", x1, y1: y, x2, y2: y, w: p.props.borderBottom.width, color: p.props.borderBottom.color });
    }
  }
  return { kind: "para", lines: boxes, before: p.props.spaceBefore, after: p.props.spaceAfter, para: p };
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
type LaidRow = { h: number; draws: Draw[]; header: boolean };
type LaidTable = { kind: "table"; rows: LaidRow[]; x: number };

/** Lay out a stack of blocks into a fixed-width box without pagination (table cells, headers, footers). */
function layoutStack(env: Env, blocks: Block[], width: number): { draws: Draw[]; h: number } {
  const draws: Draw[] = [];
  let y = 0;
  let prevAfter = 0;
  let prevStyle = "";
  let prevContextual = false;
  blocks.forEach((b, i) => {
    if (b.type === "p") {
      const lp = layoutPara(env, b, width);
      const sameCtx = b.props.contextual && prevContextual && b.props.styleId === prevStyle;
      y += i === 0 ? 0 : sameCtx ? 0 : lp.before;
      if (sameCtx) y -= prevAfter;
      for (const line of lp.lines) {
        line.draws.forEach((d) => draws.push(shift(d, 0, y)));
        y += line.h;
      }
      prevAfter = lp.after;
      y += lp.after;
      prevStyle = b.props.styleId;
      prevContextual = b.props.contextual;
    } else {
      const lt = layoutTable(env, b, width);
      for (const row of lt.rows) {
        row.draws.forEach((d) => draws.push(shift(d, lt.x, y)));
        y += row.h;
      }
      prevAfter = 0;
    }
  });
  // Word ignores the last paragraph's space-after inside cells when computing the row height
  return { draws, h: Math.max(0, y - prevAfter) };
}

function layoutTable(env: Env, t: Table, avail: number): LaidTable {
  const total = t.grid.reduce((s, g) => s + g, 0) || avail;
  const maxW = avail - t.indent;
  const scale = total > maxW + 1 ? maxW / total : 1;
  const grid = t.grid.map((g) => g * scale);
  const tableW = grid.reduce((s, g) => s + g, 0);
  const x = t.align === "center" ? (avail - tableW) / 2 : t.align === "right" ? avail - tableW : t.indent - (t.margins.left > 0 ? 0 : 0);
  const colX = [0];
  grid.forEach((g, i) => colX.push(colX[i] + g));

  // first pass: cell content
  type LaidCell = { col: number; w: number; content: { draws: Draw[]; h: number }; cell: Table["rows"][number]["cells"][number] };
  const rowsCells: LaidCell[][] = t.rows.map((row) => {
    let col = 0;
    return row.cells.map((cell) => {
      const w = colX[Math.min(col + cell.span, grid.length)] - colX[col];
      const inner = Math.max(1, w - t.margins.left - t.margins.right);
      const content = cell.vMerge === "continue" ? { draws: [], h: 0 } : layoutStack(env, cell.blocks, inner);
      const lc = { col, w, content, cell };
      col += cell.span;
      return lc;
    });
  });

  // row heights (vertical merges contribute to the last row they span)
  const heights = t.rows.map((row, ri) => {
    let h = 0;
    rowsCells[ri].forEach((c) => {
      if (c.cell.vMerge === "restart") return;
      h = Math.max(h, c.content.h + t.margins.top + t.margins.bottom);
    });
    if (row.height) h = row.height.rule === "exact" ? row.height.value : Math.max(h, row.height.value);
    return Math.max(h, 1);
  });
  rowsCells.forEach((cells, ri) =>
    cells.forEach((c) => {
      if (c.cell.vMerge !== "restart") return;
      let end = ri;
      while (end + 1 < t.rows.length && rowsCells[end + 1].some((n) => n.col === c.col && n.cell.vMerge === "continue")) end++;
      const need = c.content.h + t.margins.top + t.margins.bottom;
      const have = heights.slice(ri, end + 1).reduce((s, h) => s + h, 0);
      if (need > have) heights[end] += need - have;
    }),
  );

  const rows: LaidRow[] = rowsCells.map((cells, ri) => {
    const h = heights[ri];
    const draws: Draw[] = [];
    const lineDraws: Draw[] = [];
    for (const c of cells) {
      const cx = colX[c.col];
      // merged region height for restart cells
      let spanH = h;
      if (c.cell.vMerge === "restart") {
        let end = ri;
        while (end + 1 < t.rows.length && rowsCells[end + 1].some((n) => n.col === c.col && n.cell.vMerge === "continue")) end++;
        spanH = heights.slice(ri, end + 1).reduce((s, v) => s + v, 0);
      }
      if (c.cell.shading && c.cell.vMerge !== "continue") draws.push({ k: "rect", x: cx, y: 0, w: c.w, h: spanH, fill: c.cell.shading });
      const free = spanH - c.content.h - t.margins.top - t.margins.bottom;
      const vOff = c.cell.vAlign === "center" ? free / 2 : c.cell.vAlign === "bottom" ? free : 0;
      c.content.draws.forEach((d) => draws.push(shift(d, cx + t.margins.left, t.margins.top + Math.max(0, vOff))));
      const b = c.cell.borders;
      const edge = (bd: Border | undefined, x1: number, y1: number, x2: number, y2: number) => {
        if (bd) lineDraws.push({ k: "line", x1, y1, x2, y2, w: bd.width, color: bd.color });
      };
      if (c.cell.vMerge !== "continue") edge(b.top, cx, 0, cx + c.w, 0);
      const continuesBelow = ri + 1 < t.rows.length && rowsCells[ri + 1].some((n) => n.col === c.col && n.cell.vMerge === "continue");
      if (!continuesBelow) edge(b.bottom, cx, h, cx + c.w, h);
      edge(b.left, cx, 0, cx, h);
      edge(b.right, cx + c.w, 0, cx + c.w, h);
    }
    return { h, draws: [...draws, ...lineDraws], header: t.rows[ri].header };
  });
  return { kind: "table", rows, x };
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------
type Page = { props: SectionProps; draws: Draw[]; first: boolean };

function paginate(env: Env, model: DocModel): Page[] {
  const pages: Page[] = [];
  let page: Page | null = null;
  let colIdx = 0;
  let colTop = 0;
  let y = 0;
  let props: SectionProps = model.sections[0].props;

  const colGeom = () => {
    const contentW = props.pageW - props.margin.left - props.margin.right;
    const n = Math.max(1, props.cols.num);
    const w = (contentW - (n - 1) * props.cols.space) / n;
    return { n, w, x: props.margin.left + colIdx * (w + props.cols.space) };
  };
  const bottom = () => props.pageH - props.margin.bottom;
  const newPage = (firstOfSection: boolean) => {
    page = { props, draws: [], first: firstOfSection };
    pages.push(page);
    colIdx = 0;
    colTop = props.margin.top;
    y = colTop;
  };
  const nextColumn = () => {
    const { n } = colGeom();
    if (colIdx + 1 < n) {
      colIdx++;
      y = colTop;
    } else newPage(false);
  };
  const atTop = () => Math.abs(y - colTop) < 0.01;

  model.sections.forEach((section, si) => {
    const prevProps = props;
    props = section.props;
    const samePageSize = prevProps.pageW === props.pageW && prevProps.pageH === props.pageH;
    if (si === 0 || !page) newPage(true);
    else if (props.type === "continuous" && samePageSize) {
      // new column layout starts below existing content on the same page
      colIdx = 0;
      colTop = y;
    } else newPage(true);

    let prevAfter = 0;
    let prevStyle = "";
    let prevContextual = false;
    const blocks = section.blocks;
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      const { w: colW } = colGeom();
      if (b.type === "p") {
        const lp = layoutPara(env, b, colW);
        if (b.props.pageBreakBefore && !atTop()) newPage(false);
        const sameCtx = b.props.contextual && prevContextual && b.props.styleId === prevStyle;
        let before = atTop() ? 0 : sameCtx ? -prevAfter : lp.before;
        // keep-with-next / keep-lines: move the whole paragraph (plus next line) if it won't fit
        const paraH = lp.lines.reduce((s, l) => s + l.h, 0);
        let need = before + (b.props.keepLines || b.props.keepNext ? paraH : lp.lines[0]?.h ?? 0);
        if (b.props.keepNext && bi + 1 < blocks.length) {
          const nb = blocks[bi + 1];
          if (nb.type === "p") {
            const nl = layoutPara(env, nb, colW);
            need += nb.props.spaceBefore + (nl.lines[0]?.h ?? 0);
          } else need += 20;
        }
        if (y + need > bottom() + 0.01 && !atTop() && need < bottom() - colTop) {
          nextColumn();
          before = 0;
        }
        y += before;
        lp.lines.forEach((line, li) => {
          if (y + line.h > bottom() + 0.01 && !atTop()) {
            // widow/orphan control: don't leave a single line of a multi-line paragraph behind
            nextColumn();
          }
          const { x } = colGeom();
          line.draws.forEach((d) => page!.draws.push(shift(d, x, y)));
          y += line.h;
          if (line.brk === "page") newPage(false);
          else if (line.brk === "column") nextColumn();
          void li;
        });
        y += lp.after;
        prevAfter = lp.after;
        prevStyle = b.props.styleId;
        prevContextual = b.props.contextual;
      } else {
        const lt = layoutTable(env, b, colW);
        const headerRows = lt.rows.filter((r) => r.header);
        lt.rows.forEach((row, ri) => {
          if (y + row.h > bottom() + 0.01 && !atTop()) {
            nextColumn();
            if (!row.header && ri > 0)
              headerRows.forEach((hr) => {
                const { x } = colGeom();
                hr.draws.forEach((d) => page!.draws.push(shift(d, x + lt.x, y)));
                y += hr.h;
              });
          }
          const { x } = colGeom();
          row.draws.forEach((d) => page!.draws.push(shift(d, x + lt.x, y)));
          y += row.h;
        });
        prevAfter = 0;
        prevStyle = "";
        prevContextual = false;
      }
    }
  });
  return pages;
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------
function imageFormat(mime: string) {
  if (/png/.test(mime)) return "PNG";
  if (/jpe?g/.test(mime)) return "JPEG";
  return "";
}

/** Convert GIF/BMP/WebP/TIFF images to PNG in the browser so jsPDF can embed them. */
async function normalizeImages(model: DocModel) {
  const all: Extract<Inline, { type: "image" }>[] = [];
  const visit = (blocks: Block[] | undefined) =>
    blocks?.forEach((b) => {
      if (b.type === "p") b.inlines.forEach((i) => i.type === "image" && all.push(i));
      else b.rows.forEach((r) => r.cells.forEach((c) => visit(c.blocks)));
    });
  model.sections.forEach((s) => {
    visit(s.blocks);
    visit(s.props.header);
    visit(s.props.footer);
    visit(s.props.firstHeader);
    visit(s.props.firstFooter);
  });
  for (const img of all) {
    if (imageFormat(img.mime)) continue;
    try {
      if (typeof createImageBitmap === "undefined" || /emf|wmf|svg/.test(img.mime)) throw new Error("unsupported");
      const bmp = await createImageBitmap(new Blob([img.data as BlobPart], { type: img.mime }));
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.getContext("2d")!.drawImage(bmp, 0, 0);
      const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("png"))), "image/png"));
      img.data = new Uint8Array(await blob.arrayBuffer());
      img.mime = "image/png";
    } catch {
      img.mime = "unsupported";
    }
  }
}

function paint(doc: jsPDF, pages: Page[], env: Env) {
  const total = pages.length;
  const hexRgb = (h: string) => {
    const v = h.replace("#", "").padEnd(6, "0");
    return [parseInt(v.slice(0, 2), 16) || 0, parseInt(v.slice(2, 4), 16) || 0, parseInt(v.slice(4, 6), 16) || 0] as const;
  };
  const drawAll = (draws: Draw[], pageNo: number) => {
    for (const d of draws) {
      switch (d.k) {
        case "rect":
          doc.setFillColor(...hexRgb(d.fill));
          doc.rect(d.x, d.y, d.w, d.h, "F");
          break;
        case "line":
          doc.setDrawColor(...hexRgb(d.color));
          doc.setLineWidth(d.w);
          doc.line(d.x1, d.y1, d.x2, d.y2);
          break;
        case "text":
        case "field":
          doc.setFont(pdfFontName(d.font.c, d.font.face), "normal");
          doc.setFontSize(d.font.size);
          doc.setTextColor(...hexRgb(d.color));
          doc.text(d.k === "text" ? d.s : String(d.field === "PAGE" ? pageNo : total), d.x, d.y, d.font.cs ? { charSpace: d.font.cs } : undefined);
          break;
        case "image": {
          const fmt = imageFormat(d.fmt);
          if (d.data && fmt) {
            try {
              doc.addImage(d.data, fmt, d.x, d.y, d.w, d.h, undefined, "FAST");
              break;
            } catch {
              /* fall through to placeholder */
            }
          }
          doc.setDrawColor(190, 190, 190);
          doc.setLineWidth(0.5);
          doc.rect(d.x, d.y, d.w, d.h, "S");
          break;
        }
        case "link":
          doc.link(d.x, d.y, d.w, d.h, { url: d.url });
          break;
      }
    }
  };

  pages.forEach((pg, i) => {
    const { pageW, pageH } = pg.props;
    env.pageNo = undefined;
    if (i === 0) {
      // first page was created with the constructor
    } else doc.addPage([pageW, pageH], pageW > pageH ? "l" : "p");
    const contentW = pageW - pg.props.margin.left - pg.props.margin.right;
    const useFirst = pg.first && pg.props.titlePg;
    const header = useFirst ? pg.props.firstHeader : pg.props.header;
    const footer = useFirst ? pg.props.firstFooter : pg.props.footer;
    env.pageNo = i + 1;
    env.total = total;
    if (header?.length) {
      const hs = layoutStack(env, header, contentW);
      drawAll(hs.draws.map((d) => shift(d, pg.props.margin.left, pg.props.margin.header)), i + 1);
    }
    drawAll(pg.draws, i + 1);
    if (footer?.length) {
      const fs = layoutStack(env, footer, contentW);
      drawAll(fs.draws.map((d) => shift(d, pg.props.margin.left, pageH - pg.props.margin.footer - fs.h)), i + 1);
    }
  });
}

export type ConvertResult = { blob: Blob; pages: number; warnings: string[] };

export async function docxToPdf(input: ArrayBuffer | Uint8Array, opts: { title?: string } = {}): Promise<ConvertResult> {
  const model = await parseDocx(input);
  await normalizeImages(model).catch(() => {});
  const first = model.sections[0].props;
  const doc = new jsPDF({ unit: "pt", format: [first.pageW, first.pageH], orientation: first.pageW > first.pageH ? "l" : "p", compress: true, putOnlyUsedFonts: true });
  if (opts.title) doc.setProperties({ title: opts.title, creator: "Buddy — Word to PDF" });

  // register every face the document uses (plus Calibri as fallback for labels/empty paragraphs)
  const needed: [Compat, Face][] = [["calibri", "Regular"]];
  model.fontsUsed.forEach((k) => {
    const [family, flags] = k.split("|");
    needed.push([compatFor(family), faceOf(flags[0] === "1", flags[1] === "1")]);
  });
  // superscript/label variants use the same faces; symbols map to Unicode glyphs we ship
  await registerFonts(doc, needed);

  const env: Env = { doc, defaultTab: model.defaultTab || 36, widthCache: new Map() };
  const pages = paginate(env, model);
  paint(doc, pages, env);
  return { blob: doc.output("blob"), pages: pages.length, warnings: model.warnings };
}
