/**
 * DOCX → document model.
 *
 * Reads the parts of a .docx package (document, styles, numbering, theme, settings, headers/footers,
 * relationships, media) and resolves Word's style inheritance into plain, fully-specified blocks
 * that the PDF layout engine can render. Runs in the browser (DOMParser + JSZip).
 *
 * Units in the model are PDF points (1pt = 20 twips = 12700 EMU = 2 half-points).
 */
import JSZip from "jszip";

export type RunProps = {
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string; // hex without '#'
  highlight?: string;
  vertAlign?: "superscript" | "subscript";
  caps: boolean;
  charSpace: number; // extra letter spacing in pt
};

export type TabStop = { pos: number; align: "left" | "right" | "center" | "decimal"; leader?: "dot" | "hyphen" | "underscore" };
export type Border = { width: number; color: string; space: number } | null;
export type LineRule = { rule: "auto" | "exact" | "atLeast"; value: number };

export type ParaProps = {
  styleId: string;
  align: "left" | "center" | "right" | "both";
  spaceBefore: number;
  spaceAfter: number;
  line: LineRule;
  indLeft: number;
  indRight: number;
  indFirst: number; // negative = hanging
  keepNext: boolean;
  keepLines: boolean;
  pageBreakBefore: boolean;
  contextual: boolean;
  tabs: TabStop[];
  shading?: string;
  borderTop?: Border;
  borderBottom?: Border;
  numId?: string;
  ilvl?: number;
};

export type Inline =
  | { type: "text"; text: string; props: RunProps; link?: string }
  | { type: "tab"; props: RunProps }
  | { type: "break"; kind: "line" | "page" | "column" }
  | { type: "image"; data: Uint8Array; mime: string; w: number; h: number }
  | { type: "field"; field: "PAGE" | "NUMPAGES"; props: RunProps };

export type Para = { type: "p"; props: ParaProps; inlines: Inline[]; markProps: RunProps; numLabel?: { text: string; props: RunProps } };

export type CellBorders = { top: Border; bottom: Border; left: Border; right: Border; insideH?: Border; insideV?: Border };
export type Cell = { span: number; vMerge?: "restart" | "continue"; shading?: string; borders: CellBorders; vAlign: "top" | "center" | "bottom"; blocks: Block[] };
export type Row = { cells: Cell[]; height?: LineRule; header: boolean; cantSplit: boolean };
export type Table = {
  type: "table";
  grid: number[];
  rows: Row[];
  indent: number;
  align: "left" | "center" | "right";
  margins: { left: number; right: number; top: number; bottom: number };
};
export type Block = Para | Table;

export type SectionProps = {
  pageW: number;
  pageH: number;
  margin: { top: number; right: number; bottom: number; left: number; header: number; footer: number };
  cols: { num: number; space: number };
  type: "nextPage" | "continuous" | "evenPage" | "oddPage" | "nextColumn";
  titlePg: boolean;
  header?: Block[];
  footer?: Block[];
  firstHeader?: Block[];
  firstFooter?: Block[];
};
export type Section = { props: SectionProps; blocks: Block[] };
export type DocModel = { sections: Section[]; fontsUsed: Set<string>; warnings: string[]; defaultTab: number };

// ---------------------------------------------------------------------------
// XML helpers (namespace-agnostic, work with browser DOMParser and xmldom)
// ---------------------------------------------------------------------------
type El = Element;
const kids = (el: El | null | undefined): El[] => {
  const out: El[] = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as El);
  return out;
};
const ln = (el: El) => el.localName || el.nodeName.split(":").pop()!;
const child = (el: El | null | undefined, name: string) => kids(el).find((c) => ln(c) === name) ?? null;
const childrenNamed = (el: El | null | undefined, name: string) => kids(el).filter((c) => ln(c) === name);
const attr = (el: El | null | undefined, name: string): string | null => {
  if (!el) return null;
  const a = el.attributes;
  for (let i = 0; i < a.length; i++) {
    const n = a[i].localName || a[i].name.split(":").pop();
    if (n === name) return a[i].value;
  }
  return null;
};
const descendants = (el: El, name: string): El[] => {
  const out: El[] = [];
  const walk = (e: El) => kids(e).forEach((c) => (ln(c) === name ? out.push(c) : walk(c)));
  walk(el);
  return out;
};
const onOff = (el: El | null): boolean | undefined => {
  if (!el) return undefined;
  const v = attr(el, "val");
  return v === null || !["0", "false", "off", "none"].includes(v);
};
const twip = (v: string | null) => (v === null ? undefined : Number(v) / 20);
const parseXml = (s: string): Document => new DOMParser().parseFromString(s, "application/xml");

// ---------------------------------------------------------------------------
// Style resolution
// ---------------------------------------------------------------------------
type PartialRun = Partial<RunProps>;
type PartialPara = Partial<ParaProps>;
type StyleDef = { id: string; type: string; basedOn?: string; ppr?: El | null; rpr?: El | null; tblPr?: El | null; isDefault: boolean };

type Ctx = {
  styles: Map<string, StyleDef>;
  defaultParaStyle?: string;
  docRpr: PartialRun;
  docPpr: PartialPara;
  theme: { major: string; minor: string };
  numbering: Numbering;
  rels: Map<string, string>;
  zip: JSZip;
  basePath: string;
  fontsUsed: Set<string>;
  warnings: string[];
  defaultTab: number;
};

function readRpr(rpr: El | null | undefined, ctx: Pick<Ctx, "theme">): PartialRun {
  const p: PartialRun = {};
  if (!rpr) return p;
  const fonts = child(rpr, "rFonts");
  if (fonts) {
    const theme = attr(fonts, "asciiTheme") ?? attr(fonts, "hAnsiTheme");
    const f = attr(fonts, "ascii") ?? attr(fonts, "hAnsi") ?? attr(fonts, "cs");
    if (f) p.font = f;
    else if (theme) p.font = theme.startsWith("major") ? ctx.theme.major : ctx.theme.minor;
  }
  const sz = child(rpr, "sz");
  if (sz && attr(sz, "val")) p.size = Number(attr(sz, "val")) / 2;
  const b = onOff(child(rpr, "b"));
  if (b !== undefined) p.bold = b;
  const i = onOff(child(rpr, "i"));
  if (i !== undefined) p.italic = i;
  const u = child(rpr, "u");
  if (u) p.underline = attr(u, "val") !== "none";
  const s = onOff(child(rpr, "strike")) ?? onOff(child(rpr, "dstrike"));
  if (s !== undefined) p.strike = s;
  const c = child(rpr, "color");
  if (c && attr(c, "val")) p.color = attr(c, "val") === "auto" ? "000000" : attr(c, "val")!;
  const h = child(rpr, "highlight");
  if (h && attr(h, "val") && attr(h, "val") !== "none") p.highlight = HIGHLIGHT[attr(h, "val")!] ?? "FFFF00";
  const shd = child(rpr, "shd");
  if (!p.highlight && shd && attr(shd, "fill") && !["auto", "FFFFFF"].includes(attr(shd, "fill")!)) p.highlight = attr(shd, "fill")!;
  const va = child(rpr, "vertAlign");
  if (va) {
    const v = attr(va, "val");
    if (v === "superscript" || v === "subscript") p.vertAlign = v;
  }
  const caps = onOff(child(rpr, "caps"));
  if (caps !== undefined) p.caps = caps;
  const spacing = child(rpr, "spacing");
  if (spacing && attr(spacing, "val") !== null) p.charSpace = Number(attr(spacing, "val")) / 20;
  return p;
}

const HIGHLIGHT: Record<string, string> = {
  yellow: "FFFF00", green: "00FF00", cyan: "00FFFF", magenta: "FF00FF", blue: "0000FF", red: "FF0000",
  darkBlue: "000080", darkCyan: "008080", darkGreen: "008000", darkMagenta: "800080", darkRed: "800000",
  darkYellow: "808000", darkGray: "808080", lightGray: "C0C0C0", black: "000000", white: "FFFFFF",
};

function readBorder(el: El | null): Border | undefined {
  if (!el) return undefined;
  const v = attr(el, "val");
  if (!v || v === "nil" || v === "none") return null;
  return { width: Math.max(0.25, Number(attr(el, "sz") ?? 4) / 8), color: (attr(el, "color") ?? "000000").replace("auto", "000000"), space: Number(attr(el, "space") ?? 0) };
}

function readPpr(ppr: El | null | undefined): PartialPara {
  const p: PartialPara = {};
  if (!ppr) return p;
  const jc = attr(child(ppr, "jc"), "val");
  if (jc) p.align = jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : jc === "both" || jc === "distribute" ? "both" : "left";
  const sp = child(ppr, "spacing");
  if (sp) {
    if (attr(sp, "before") !== null && attr(sp, "beforeAutospacing") !== "1") p.spaceBefore = twip(attr(sp, "before"));
    if (attr(sp, "after") !== null && attr(sp, "afterAutospacing") !== "1") p.spaceAfter = twip(attr(sp, "after"));
    if (attr(sp, "line") !== null) {
      const rule = attr(sp, "lineRule") ?? "auto";
      const v = Number(attr(sp, "line"));
      p.line = rule === "auto" ? { rule: "auto", value: v / 240 } : { rule: rule === "exact" ? "exact" : "atLeast", value: v / 20 };
    }
  }
  const ind = child(ppr, "ind");
  if (ind) {
    const l = twip(attr(ind, "left") ?? attr(ind, "start"));
    const r = twip(attr(ind, "right") ?? attr(ind, "end"));
    if (l !== undefined) p.indLeft = l;
    if (r !== undefined) p.indRight = r;
    if (attr(ind, "hanging") !== null) p.indFirst = -(twip(attr(ind, "hanging")) ?? 0);
    else if (attr(ind, "firstLine") !== null) p.indFirst = twip(attr(ind, "firstLine"));
  }
  const kn = onOff(child(ppr, "keepNext"));
  if (kn !== undefined) p.keepNext = kn;
  const kl = onOff(child(ppr, "keepLines"));
  if (kl !== undefined) p.keepLines = kl;
  const pb = onOff(child(ppr, "pageBreakBefore"));
  if (pb !== undefined) p.pageBreakBefore = pb;
  const cs = onOff(child(ppr, "contextualSpacing"));
  if (cs !== undefined) p.contextual = cs;
  const tabs = child(ppr, "tabs");
  if (tabs) {
    p.tabs = childrenNamed(tabs, "tab")
      .filter((t) => attr(t, "val") !== "clear")
      .map((t) => {
        const v = attr(t, "val");
        const leader = attr(t, "leader");
        return {
          pos: Number(attr(t, "pos")) / 20,
          align: v === "right" || v === "end" ? "right" : v === "center" ? "center" : v === "decimal" ? "decimal" : "left",
          leader: leader === "dot" || leader === "hyphen" || leader === "underscore" ? leader : undefined,
        } as TabStop;
      })
      .sort((a, b) => a.pos - b.pos);
  }
  const shd = child(ppr, "shd");
  if (shd && attr(shd, "fill") && !["auto", "FFFFFF"].includes(attr(shd, "fill")!)) p.shading = attr(shd, "fill")!;
  const bdr = child(ppr, "pBdr");
  if (bdr) {
    const t = readBorder(child(bdr, "top"));
    const b = readBorder(child(bdr, "bottom"));
    if (t !== undefined) p.borderTop = t;
    if (b !== undefined) p.borderBottom = b;
  }
  const num = child(ppr, "numPr");
  if (num) {
    const id = attr(child(num, "numId"), "val");
    if (id !== null) p.numId = id;
    const lvl = attr(child(num, "ilvl"), "val");
    if (lvl !== null) p.ilvl = Number(lvl);
  }
  return p;
}

function styleChain(ctx: Ctx, id: string | undefined): StyleDef[] {
  const chain: StyleDef[] = [];
  const seen = new Set<string>();
  let cur = id ? ctx.styles.get(id) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.basedOn ? ctx.styles.get(cur.basedOn) : undefined;
  }
  return chain;
}

const BASE_RUN: RunProps = { font: "Calibri", size: 11, bold: false, italic: false, underline: false, strike: false, color: "000000", caps: false, charSpace: 0 };
const BASE_PARA: ParaProps = {
  styleId: "", align: "left", spaceBefore: 0, spaceAfter: 0, line: { rule: "auto", value: 1 }, indLeft: 0, indRight: 0, indFirst: 0,
  keepNext: false, keepLines: false, pageBreakBefore: false, contextual: false, tabs: [],
};

function resolvePara(ctx: Ctx, ppr: El | null): { para: ParaProps; run: RunProps } {
  const styleId = attr(child(ppr, "pStyle"), "val") ?? ctx.defaultParaStyle;
  let para: ParaProps = { ...BASE_PARA, ...ctx.docPpr };
  let run: RunProps = { ...BASE_RUN, ...ctx.docRpr };
  for (const s of styleChain(ctx, styleId)) {
    para = mergePara(para, readPpr(s.ppr));
    run = { ...run, ...readRpr(s.rpr, ctx) };
  }
  para = mergePara(para, readPpr(ppr));
  para.styleId = styleId ?? "";
  // numbering indents apply unless the paragraph overrides them directly
  if (para.numId && para.numId !== "0") {
    const lvl = ctx.numbering.level(para.numId, para.ilvl ?? 0);
    if (lvl) {
      const direct = readPpr(ppr);
      const lp = readPpr(lvl.ppr);
      if (direct.indLeft === undefined && lp.indLeft !== undefined) para.indLeft = lp.indLeft;
      if (direct.indFirst === undefined && lp.indFirst !== undefined) para.indFirst = lp.indFirst;
      if (lp.tabs && !direct.tabs) para.tabs = [...para.tabs, ...lp.tabs].sort((a, b) => a.pos - b.pos);
    }
  }
  return { para, run };
}

function mergePara(base: ParaProps, over: PartialPara): ParaProps {
  const out = { ...base };
  (Object.keys(over) as (keyof ParaProps)[]).forEach((k) => {
    if (over[k] !== undefined) (out as Record<string, unknown>)[k] = over[k];
  });
  return out;
}

function resolveRun(ctx: Ctx, base: RunProps, rpr: El | null): RunProps {
  let run = { ...base };
  const rStyle = attr(child(rpr, "rStyle"), "val");
  if (rStyle) for (const s of styleChain(ctx, rStyle)) run = { ...run, ...readRpr(s.rpr, ctx) };
  run = { ...run, ...readRpr(rpr, ctx) };
  ctx.fontsUsed.add(fontKey(run));
  return run;
}

export const fontKey = (r: Pick<RunProps, "font" | "bold" | "italic">) => `${r.font}|${r.bold ? 1 : 0}${r.italic ? 1 : 0}`;

// ---------------------------------------------------------------------------
// Numbering (bullets and numbered lists)
// ---------------------------------------------------------------------------
type Level = { fmt: string; text: string; start: number; ppr: El | null; rpr: El | null };
class Numbering {
  private abstract = new Map<string, Map<number, Level>>();
  private nums = new Map<string, { abs: string; overrides: Map<number, number> }>();
  private counters = new Map<string, number[]>();

  load(doc: Document | null) {
    if (!doc) return;
    const root = doc.documentElement;
    childrenNamed(root, "abstractNum").forEach((a) => {
      const levels = new Map<number, Level>();
      childrenNamed(a, "lvl").forEach((l) =>
        levels.set(Number(attr(l, "ilvl") ?? 0), {
          fmt: attr(child(l, "numFmt"), "val") ?? "decimal",
          text: attr(child(l, "lvlText"), "val") ?? "",
          start: Number(attr(child(l, "start"), "val") ?? 1),
          ppr: child(l, "pPr"),
          rpr: child(l, "rPr"),
        }),
      );
      this.abstract.set(attr(a, "abstractNumId") ?? "", levels);
    });
    childrenNamed(root, "num").forEach((n) => {
      const overrides = new Map<number, number>();
      childrenNamed(n, "lvlOverride").forEach((o) => {
        const s = attr(child(o, "startOverride"), "val");
        if (s !== null) overrides.set(Number(attr(o, "ilvl") ?? 0), Number(s));
      });
      this.nums.set(attr(n, "numId") ?? "", { abs: attr(child(n, "abstractNumId"), "val") ?? "", overrides });
    });
  }

  level(numId: string, ilvl: number): Level | undefined {
    const n = this.nums.get(numId);
    return n ? this.abstract.get(n.abs)?.get(ilvl) : undefined;
  }

  /** Advance the counter and return the label text for this list item. */
  next(numId: string, ilvl: number): { text: string; lvl: Level } | null {
    const n = this.nums.get(numId);
    const levels = n ? this.abstract.get(n.abs) : undefined;
    const lvl = levels?.get(ilvl);
    if (!n || !levels || !lvl) return null;
    const key = n.abs; // Word shares counters across nums pointing at the same abstract list
    const c = this.counters.get(key) ?? [];
    for (let i = 0; i <= ilvl; i++) if (c[i] === undefined) c[i] = (n.overrides.get(i) ?? levels.get(i)?.start ?? 1) - 1;
    c[ilvl] += 1;
    c.length = ilvl + 1; // reset deeper levels
    this.counters.set(key, c);
    if (lvl.fmt === "none") return { text: "", lvl };
    if (lvl.fmt === "bullet") return { text: mapSymbol(lvl.text, attr(child(lvl.rpr, "rFonts"), "ascii")), lvl };
    const text = lvl.text.replace(/%(\d)/g, (_m, d: string) => {
      const i = Number(d) - 1;
      const L = levels.get(i);
      return formatNumber(c[i] ?? L?.start ?? 1, L?.fmt ?? "decimal");
    });
    return { text, lvl };
  }
}

function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case "lowerLetter": return alpha(n).toLowerCase();
    case "upperLetter": return alpha(n);
    case "lowerRoman": return roman(n).toLowerCase();
    case "upperRoman": return roman(n);
    case "decimalZero": return n < 10 ? `0${n}` : String(n);
    default: return String(n);
  }
}
const alpha = (n: number) => {
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
};
const roman = (n: number) => {
  const map: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  for (const [v, r] of map) while (n >= v) (s += r), (n -= v);
  return s;
};

/** Symbol/Wingdings private-use glyphs → Unicode equivalents that our fonts contain. */
export function mapSymbol(text: string, font?: string | null): string {
  const f = (font ?? "").toLowerCase();
  const map: Record<string, string> = {
    "": "•", "": "▪", "": "►", "": "✓", "": "❖", "": "■", "": "□", "": "❑",
    "": "→", "": "►", "": "–", "": "°", "": "•",
  };
  let out = [...text].map((ch) => map[ch] ?? ch).join("");
  if (f.includes("courier") && out === "o") out = "◦";
  if (f.includes("wingdings") && out === "§") out = "▪";
  if (f.includes("symbol") && out === "·") out = "•";
  return out || "•";
}

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------
async function relsFor(zip: JSZip, partPath: string): Promise<Map<string, string>> {
  const dir = partPath.substring(0, partPath.lastIndexOf("/") + 1);
  const name = partPath.substring(partPath.lastIndexOf("/") + 1);
  const xml = await zip.file(`${dir}_rels/${name}.rels`)?.async("string");
  const map = new Map<string, string>();
  if (!xml) return map;
  const doc = parseXml(xml);
  kids(doc.documentElement).forEach((r) => {
    const target = attr(r, "Target") ?? "";
    const external = attr(r, "TargetMode") === "External";
    map.set(attr(r, "Id") ?? "", external ? target : resolvePath(dir, target));
  });
  return map;
}
const resolvePath = (dir: string, target: string) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = (dir + target).split("/");
  const out: string[] = [];
  for (const p of parts) p === ".." ? out.pop() : p !== "." && out.push(p);
  return out.join("/");
};
const mimeOf = (path: string) => {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "bmp" ? "image/bmp" : `image/${ext}`;
};

type ParseState = { images: Map<string, Uint8Array> };

async function parseBlocks(container: El, ctx: Ctx, st: ParseState, out: Block[], sections?: Section[]) {
  for (const el of kids(container)) {
    const name = ln(el);
    if (name === "p") {
      const extra: Block[] = [];
      out.push(await parseParagraph(el, ctx, st, extra));
      out.push(...extra); // text boxes etc. flow after their anchor paragraph
      const sect = child(child(el, "pPr"), "sectPr");
      if (sect && sections) {
        sections.push({ props: await parseSectPr(sect, ctx, sections.at(-1)?.props), blocks: out.splice(0) });
      }
    } else if (name === "tbl") {
      out.push(await parseTable(el, ctx, st));
    } else if (name === "sdt") {
      await parseBlocks(child(el, "sdtContent")!, ctx, st, out, sections);
    } else if (["customXml", "ins", "smartTag"].includes(name)) {
      await parseBlocks(el, ctx, st, out, sections);
    } else if (name === "AlternateContent") {
      const choice = child(el, "Choice") ?? child(el, "Fallback");
      if (choice) await parseBlocks(choice, ctx, st, out, sections);
    }
  }
}

async function parseParagraph(p: El, ctx: Ctx, st: ParseState, extra: Block[]): Promise<Para> {
  const ppr = child(p, "pPr");
  const { para, run: paraRun } = resolvePara(ctx, ppr);
  const markProps = resolveRun(ctx, paraRun, child(ppr, "rPr"));
  const inlines: Inline[] = [];
  const field = { depth: 0, instr: "", inResult: false, dynamic: null as null | "PAGE" | "NUMPAGES" };

  const walk = async (el: El, link?: string) => {
    for (const c of kids(el)) {
      const n = ln(c);
      if (n === "r") await parseRun(c, link);
      else if (n === "hyperlink") {
        const rid = attr(c, "id");
        await walk(c, rid ? ctx.rels.get(rid) : undefined);
      } else if (n === "fldSimple") {
        const instr = (attr(c, "instr") ?? "").trim().toUpperCase();
        const dyn = /^NUMPAGES\b/.test(instr) ? "NUMPAGES" : /^PAGE\b/.test(instr) ? "PAGE" : null;
        if (dyn) inlines.push({ type: "field", field: dyn, props: resolveRun(ctx, paraRun, child(child(c, "r"), "rPr")) });
        else await walk(c, link);
      } else if (["ins", "smartTag", "customXml", "bdo", "dir"].includes(n)) await walk(c, link);
      else if (n === "sdt") await walk(child(c, "sdtContent")!, link);
      else if (n === "AlternateContent") {
        const ch = child(c, "Choice") ?? child(c, "Fallback");
        if (ch) await walk(ch, link);
      }
    }
  };

  const parseRun = async (r: El, link?: string) => {
    const props = resolveRun(ctx, paraRun, child(r, "rPr"));
    for (const c of kids(r)) {
      const n = ln(c);
      if (n === "fldChar") {
        const t = attr(c, "fldCharType");
        if (t === "begin") {
          field.depth++;
          field.instr = "";
          field.inResult = false;
          field.dynamic = null;
        } else if (t === "separate") {
          field.inResult = true;
          const instr = field.instr.trim().toUpperCase();
          field.dynamic = /^NUMPAGES\b/.test(instr) ? "NUMPAGES" : /^PAGE\b/.test(instr) ? "PAGE" : null;
          if (field.dynamic) inlines.push({ type: "field", field: field.dynamic, props });
        } else if (t === "end") {
          if (!field.inResult) {
            const instr = field.instr.trim().toUpperCase();
            const dyn = /^NUMPAGES\b/.test(instr) ? "NUMPAGES" : /^PAGE\b/.test(instr) ? "PAGE" : null;
            if (dyn) inlines.push({ type: "field", field: dyn, props });
          }
          field.depth = Math.max(0, field.depth - 1);
          field.inResult = false;
          field.dynamic = null;
        }
        continue;
      }
      if (n === "instrText") {
        field.instr += c.textContent ?? "";
        continue;
      }
      if (field.depth > 0 && (!field.inResult || field.dynamic)) continue; // skip instructions / replaced results
      if (n === "t") {
        // literal tab characters inside w:t behave like <w:tab/>
        (c.textContent ?? "")
          .replace(/\u00A0/g, " ")
          .split("\t")
          .forEach((part, idx) => {
            if (idx > 0) inlines.push({ type: "tab", props });
            if (part) inlines.push({ type: "text", text: part, props, link });
          });
      }
      else if (n === "tab" || n === "ptab") inlines.push({ type: "tab", props });
      else if (n === "br") {
        const t = attr(c, "type");
        inlines.push({ type: "break", kind: t === "page" ? "page" : t === "column" ? "column" : "line" });
      } else if (n === "cr") inlines.push({ type: "break", kind: "line" });
      else if (n === "noBreakHyphen") inlines.push({ type: "text", text: "-", props, link });
      else if (n === "sym") {
        const code = attr(c, "char") ?? "";
        const ch = String.fromCharCode(parseInt(code, 16) < 0xf000 ? 0xf000 + parseInt(code, 16) : parseInt(code, 16));
        inlines.push({ type: "text", text: mapSymbol(ch, attr(c, "font")), props, link });
      } else if (n === "drawing" || n === "pict" || n === "AlternateContent" || n === "object") {
        await parseDrawing(c, props, link);
      }
    }
  };

  const parseDrawing = async (d: El, props: RunProps, link?: string) => {
    // text boxes: render their paragraphs after this paragraph
    const txbx = descendants(d, "txbxContent")[0];
    if (txbx) {
      await parseBlocks(txbx, ctx, st, extra);
      return;
    }
    const blip = descendants(d, "blip")[0] ?? descendants(d, "imagedata")[0];
    if (!blip) return;
    const rid = attr(blip, "embed") ?? attr(blip, "id");
    const path = rid ? ctx.rels.get(rid) : undefined;
    if (!path) return;
    const extent = descendants(d, "extent")[0];
    let w = extent ? Number(attr(extent, "cx")) / 12700 : 0;
    let h = extent ? Number(attr(extent, "cy")) / 12700 : 0;
    if (!w || !h) {
      const shape = descendants(d, "shape")[0];
      const style = attr(shape, "style") ?? "";
      const wm = style.match(/width:([\d.]+)pt/);
      const hm = style.match(/height:([\d.]+)pt/);
      w = wm ? Number(wm[1]) : 144;
      h = hm ? Number(hm[1]) : 108;
    }
    let data = st.images.get(path);
    if (!data) {
      data = (await ctx.zip.file(path)?.async("uint8array")) ?? undefined;
      if (data) st.images.set(path, data);
    }
    if (data) inlines.push({ type: "image", data, mime: mimeOf(path), w, h });
    void props;
    void link;
  };

  await walk(p);

  const result: Para = { type: "p", props: para, inlines, markProps };
  if (para.numId && para.numId !== "0") {
    const label = ctx.numbering.next(para.numId, para.ilvl ?? 0);
    if (label && label.text) {
      const lvlRun = resolveRun(ctx, { ...markProps }, label.lvl.rpr);
      const font = attr(child(label.lvl.rpr, "rFonts"), "ascii") ?? "";
      const labelProps = /symbol|wingdings|courier/i.test(font) ? { ...lvlRun, font: markProps.font } : lvlRun;
      ctx.fontsUsed.add(fontKey(labelProps));
      result.numLabel = { text: label.text, props: labelProps };
    }
  }
  return result;
}

async function parseTable(tbl: El, ctx: Ctx, st: ParseState): Promise<Table> {
  const tblPr = child(tbl, "tblPr");
  const styleId = attr(child(tblPr, "tblStyle"), "val");
  const chain = styleChain(ctx, styleId ?? undefined);
  const prs = [...chain.map((s) => s.tblPr).filter(Boolean), tblPr] as El[];
  // borders: style first, then direct
  let borders: CellBorders = { top: null, bottom: null, left: null, right: null, insideH: null, insideV: null };
  let margins = { left: 5.4, right: 5.4, top: 0, bottom: 0 };
  let indent = 0;
  let align: Table["align"] = "left";
  for (const pr of prs) {
    const b = child(pr, "tblBorders");
    if (b) {
      const read = (n: string) => readBorder(child(b, n) ?? child(b, n === "left" ? "start" : n === "right" ? "end" : n));
      borders = {
        top: read("top") ?? borders.top,
        bottom: read("bottom") ?? borders.bottom,
        left: read("left") ?? borders.left,
        right: read("right") ?? borders.right,
        insideH: read("insideH") ?? borders.insideH,
        insideV: read("insideV") ?? borders.insideV,
      };
    }
    const m = child(pr, "tblCellMar");
    if (m) {
      const g = (n: string, alt: string) => twip(attr(child(m, n) ?? child(m, alt), "w"));
      margins = { left: g("left", "start") ?? margins.left, right: g("right", "end") ?? margins.right, top: g("top", "top") ?? margins.top, bottom: g("bottom", "bottom") ?? margins.bottom };
    }
    const ind = child(pr, "tblInd");
    if (ind && attr(ind, "type") !== "pct") indent = twip(attr(ind, "w")) ?? indent;
    const jc = attr(child(pr, "jc"), "val");
    if (jc) align = jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : "left";
  }
  const grid = childrenNamed(child(tbl, "tblGrid"), "gridCol").map((g) => Number(attr(g, "w") ?? 0) / 20);

  // paragraphs inside the table inherit the table style's run/para props through the style chain
  const tblStylePpr = chain.map((s) => s.ppr).filter(Boolean) as El[];
  const tblStyleRpr = chain.map((s) => s.rpr).filter(Boolean) as El[];
  const savedDocRpr = ctx.docRpr;
  const savedDocPpr = ctx.docPpr;
  ctx.docRpr = tblStyleRpr.reduce((acc, r) => ({ ...acc, ...readRpr(r, ctx) }), { ...ctx.docRpr });
  ctx.docPpr = tblStylePpr.reduce((acc, p) => ({ ...acc, ...readPpr(p) }), { ...ctx.docPpr });

  const rows: Row[] = [];
  for (const tr of childrenNamed(tbl, "tr")) {
    const trPr = child(tr, "trPr");
    const hEl = child(trPr, "trHeight");
    const height = hEl ? { rule: (attr(hEl, "hRule") === "exact" ? "exact" : "atLeast") as LineRule["rule"], value: Number(attr(hEl, "val") ?? 0) / 20 } : undefined;
    const cells: Cell[] = [];
    const cellEls = kids(tr).flatMap((c) => (ln(c) === "tc" ? [c] : ln(c) === "sdt" ? childrenNamed(child(c, "sdtContent"), "tc") : []));
    for (const tc of cellEls) {
      const tcPr = child(tc, "tcPr");
      const span = Number(attr(child(tcPr, "gridSpan"), "val") ?? 1);
      const vm = child(tcPr, "vMerge");
      const vMerge = vm ? (attr(vm, "val") === "restart" ? "restart" : "continue") : undefined;
      const shdFill = attr(child(tcPr, "shd"), "fill");
      const tb = child(tcPr, "tcBorders");
      const rb = (n: string) => (tb ? readBorder(child(tb, n) ?? child(tb, n === "left" ? "start" : n === "right" ? "end" : n)) : undefined);
      const cb: CellBorders = {
        top: rb("top") !== undefined ? rb("top")! : null,
        bottom: rb("bottom") !== undefined ? rb("bottom")! : null,
        left: rb("left") !== undefined ? rb("left")! : null,
        right: rb("right") !== undefined ? rb("right")! : null,
      };
      // mark which borders were set directly (undefined → inherit from table)
      const inherit = { top: rb("top") === undefined, bottom: rb("bottom") === undefined, left: rb("left") === undefined, right: rb("right") === undefined };
      const va = attr(child(tcPr, "vAlign"), "val");
      const blocks: Block[] = [];
      await parseBlocks(tc, ctx, st, blocks);
      cells.push({
        span,
        vMerge,
        shading: shdFill && !["auto", "FFFFFF"].includes(shdFill) ? shdFill : undefined,
        borders: { ...cb, ...({ _inherit: inherit } as object) } as CellBorders,
        vAlign: va === "center" ? "center" : va === "bottom" ? "bottom" : "top",
        blocks,
      });
    }
    rows.push({ cells, height, header: onOff(child(trPr, "tblHeader")) ?? false, cantSplit: onOff(child(trPr, "cantSplit")) ?? false });
  }
  ctx.docRpr = savedDocRpr;
  ctx.docPpr = savedDocPpr;

  // resolve inherited cell borders from table borders (outer vs inside)
  const nCols = Math.max(grid.length, 1);
  rows.forEach((row, ri) => {
    let col = 0;
    row.cells.forEach((cell) => {
      const inh = (cell.borders as unknown as { _inherit: Record<string, boolean> })._inherit;
      const first = col === 0;
      const last = col + cell.span >= nCols;
      if (inh.top) cell.borders.top = ri === 0 ? borders.top : borders.insideH ?? null;
      if (inh.bottom) cell.borders.bottom = ri === rows.length - 1 ? borders.bottom : borders.insideH ?? null;
      if (inh.left) cell.borders.left = first ? borders.left : borders.insideV ?? null;
      if (inh.right) cell.borders.right = last ? borders.right : borders.insideV ?? null;
      col += cell.span;
    });
  });

  // grid fallback when tblGrid is missing
  const finalGrid = grid.length ? grid : Array.from({ length: Math.max(...rows.map((r) => r.cells.reduce((s, c) => s + c.span, 0)), 1) }, () => 100);
  return { type: "table", grid: finalGrid, rows, indent, align, margins };
}

async function parseHeaderFooter(ctx: Ctx, st: ParseState, rid: string | null): Promise<Block[] | undefined> {
  if (!rid) return undefined;
  const path = ctx.rels.get(rid);
  const xml = path ? await ctx.zip.file(path)?.async("string") : undefined;
  if (!xml || !path) return undefined;
  const savedRels = ctx.rels;
  ctx.rels = await relsFor(ctx.zip, path);
  const blocks: Block[] = [];
  await parseBlocks(parseXml(xml).documentElement, ctx, st, blocks);
  ctx.rels = savedRels;
  return blocks;
}

let hfState: ParseState = { images: new Map() };

async function parseSectPr(s: El, ctx: Ctx, prev?: SectionProps): Promise<SectionProps> {
  const pgSz = child(s, "pgSz");
  const pgMar = child(s, "pgMar");
  const cols = child(s, "cols");
  const t = attr(child(s, "type"), "val");
  const props: SectionProps = {
    pageW: twip(attr(pgSz, "w")) ?? prev?.pageW ?? 612,
    pageH: twip(attr(pgSz, "h")) ?? prev?.pageH ?? 792,
    margin: {
      top: Math.abs(twip(attr(pgMar, "top")) ?? prev?.margin.top ?? 72),
      right: twip(attr(pgMar, "right")) ?? prev?.margin.right ?? 72,
      bottom: Math.abs(twip(attr(pgMar, "bottom")) ?? prev?.margin.bottom ?? 72),
      left: twip(attr(pgMar, "left")) ?? prev?.margin.left ?? 72,
      header: twip(attr(pgMar, "header")) ?? prev?.margin.header ?? 36,
      footer: twip(attr(pgMar, "footer")) ?? prev?.margin.footer ?? 36,
    },
    cols: { num: Number(attr(cols, "num") ?? 1) || 1, space: twip(attr(cols, "space")) ?? 36 },
    type: (t as SectionProps["type"]) ?? "nextPage",
    titlePg: onOff(child(s, "titlePg")) ?? false,
    header: prev?.header,
    footer: prev?.footer,
    firstHeader: prev?.firstHeader,
    firstFooter: prev?.firstFooter,
  };
  for (const ref of childrenNamed(s, "headerReference")) {
    const blocks = await parseHeaderFooter(ctx, hfState, attr(ref, "id"));
    const type = attr(ref, "type");
    if (type === "first") props.firstHeader = blocks;
    else if (type === "default") props.header = blocks;
  }
  for (const ref of childrenNamed(s, "footerReference")) {
    const blocks = await parseHeaderFooter(ctx, hfState, attr(ref, "id"));
    const type = attr(ref, "type");
    if (type === "first") props.firstFooter = blocks;
    else if (type === "default") props.footer = blocks;
  }
  return props;
}

/** Parse a .docx file into the render model. */
export async function parseDocx(input: ArrayBuffer | Uint8Array): Promise<DocModel> {
  const zip = await JSZip.loadAsync(input);
  // locate the main document part via [Content_Types] / _rels/.rels
  const rootRels = await zip.file("_rels/.rels")?.async("string");
  let docPath = "word/document.xml";
  if (rootRels) {
    const r = kids(parseXml(rootRels).documentElement).find((e) => (attr(e, "Type") ?? "").endsWith("/officeDocument"));
    if (r) docPath = resolvePath("", attr(r, "Target") ?? docPath);
  }
  const docXml = await zip.file(docPath)?.async("string");
  if (!docXml) throw new ConvertError("This file isn't a valid Word document (.docx).");
  const rels = await relsFor(zip, docPath);
  const findRel = (suffix: string) => [...rels.values()].find((p) => p.endsWith(suffix));
  const read = async (p?: string) => (p ? await zip.file(p)?.async("string") : undefined);

  const stylesXml = await read(findRel("styles.xml") ?? "word/styles.xml");
  const numberingXml = await read(findRel("numbering.xml") ?? "word/numbering.xml");
  const themeXml = await read([...rels.values()].find((p) => /theme\/theme\d*\.xml$/.test(p)) ?? "word/theme/theme1.xml");
  const settingsXml = await read(findRel("settings.xml") ?? "word/settings.xml");

  const theme = { major: "Calibri Light", minor: "Calibri" };
  if (themeXml) {
    const t = parseXml(themeXml).documentElement;
    const major = descendants(t, "majorFont")[0];
    const minor = descendants(t, "minorFont")[0];
    theme.major = attr(child(major, "latin"), "typeface") || theme.major;
    theme.minor = attr(child(minor, "latin"), "typeface") || theme.minor;
  }

  const ctx: Ctx = {
    styles: new Map(),
    docRpr: {},
    docPpr: {},
    theme,
    numbering: new Numbering(),
    rels,
    zip,
    basePath: docPath,
    fontsUsed: new Set(),
    warnings: [],
    defaultTab: 36,
  };
  if (settingsXml) {
    const dt = descendants(parseXml(settingsXml).documentElement, "defaultTabStop")[0];
    if (dt) ctx.defaultTab = (Number(attr(dt, "val")) || 720) / 20;
  }
  if (stylesXml) {
    const s = parseXml(stylesXml).documentElement;
    const dd = child(s, "docDefaults");
    ctx.docRpr = readRpr(child(child(dd, "rPrDefault"), "rPr"), ctx);
    ctx.docPpr = readPpr(child(child(dd, "pPrDefault"), "pPr"));
    childrenNamed(s, "style").forEach((st) => {
      const id = attr(st, "styleId") ?? "";
      const def: StyleDef = {
        id,
        type: attr(st, "type") ?? "paragraph",
        basedOn: attr(child(st, "basedOn"), "val") ?? undefined,
        ppr: child(st, "pPr"),
        rpr: child(st, "rPr"),
        tblPr: child(st, "tblPr"),
        isDefault: attr(st, "default") === "1",
      };
      ctx.styles.set(id, def);
      if (def.isDefault && def.type === "paragraph") ctx.defaultParaStyle = id;
    });
  } else {
    // documents without styles.xml (rare): Word falls back to Times New Roman 10pt
    ctx.docRpr = { font: "Times New Roman", size: 10 };
  }
  if (numberingXml) ctx.numbering.load(parseXml(numberingXml));

  hfState = { images: new Map() };
  const body = child(parseXml(docXml).documentElement, "body");
  if (!body) throw new ConvertError("This Word document has no body content.");
  const sections: Section[] = [];
  const blocks: Block[] = [];
  const st: ParseState = { images: new Map() };
  await parseBlocks(body, ctx, st, blocks, sections);
  const finalSect = child(body, "sectPr");
  sections.push({ props: finalSect ? await parseSectPr(finalSect, ctx, sections.at(-1)?.props) : defaultSection(sections.at(-1)?.props), blocks });
  // header/footer inheritance flows forward; a later section's explicit sectPr overrides
  return { sections, fontsUsed: ctx.fontsUsed, warnings: ctx.warnings, defaultTab: ctx.defaultTab };
}

function defaultSection(prev?: SectionProps): SectionProps {
  return prev ?? {
    pageW: 612, pageH: 792,
    margin: { top: 72, right: 72, bottom: 72, left: 72, header: 36, footer: 36 },
    cols: { num: 1, space: 36 }, type: "nextPage", titlePg: false,
  };
}

export class ConvertError extends Error {}
