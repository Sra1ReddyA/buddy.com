/**
 * Metric-compatible fonts for document conversion (all SIL OFL, subset to Latin/Greek/Cyrillic,
 * renamed "Buddy…Compat" because Carlito reserves its name):
 *   Calibri → Carlito · Cambria → Caladea · Times New Roman → Tinos · Arial/Helvetica → Arimo · Courier New → Cousine
 * Same glyph widths as the Microsoft originals, so text wraps where Word wraps it.
 */
import type { jsPDF } from "jspdf";

export type Compat = "calibri" | "cambria" | "times" | "arial" | "courier";
export type Face = "Regular" | "Bold" | "Italic" | "BoldItalic";

const FILE: Record<Compat, string> = {
  calibri: "BuddyCalibriCompat",
  cambria: "BuddyCambriaCompat",
  times: "BuddyTimesCompat",
  arial: "BuddyArialCompat",
  courier: "BuddyCourierCompat",
};

/** Vertical metrics of the Microsoft originals (ascent, descent, single line height) in em. */
export const METRICS: Record<Compat, { asc: number; desc: number; line: number }> = {
  calibri: { asc: 0.952, desc: 0.269, line: 1.2207 },
  cambria: { asc: 0.95, desc: 0.222, line: 1.172 },
  times: { asc: 0.891, desc: 0.216, line: 1.15 },
  arial: { asc: 0.905, desc: 0.212, line: 1.15 },
  courier: { asc: 0.833, desc: 0.3, line: 1.133 },
};

/** Map any font family name to the closest metric-compatible face we ship. */
export function compatFor(family: string): Compat {
  const f = family.toLowerCase();
  if (/calibri|carlito|aptos|segoe|verdana|tahoma|open sans|lato|source sans/.test(f)) return "calibri";
  if (/cambria|caladea/.test(f)) return "cambria";
  if (/courier|consolas|mono|menlo|monaco|lucida console|cousine|code/.test(f)) return "courier";
  if (/times|tinos|georgia|garamond|book antiqua|palatino|century|baskerville|serif|minion|constantia|bookman|cochin|didot|rockwell/.test(f) && !/sans/.test(f))
    return "times";
  return "arial";
}

/** Each face is registered as its own family so PDF readers never merge faces (keeps bold/italic detectable). */
export const pdfFontName = (c: Compat, face: Face) => `${FILE[c]}-${face}`;

export const faceOf = (bold: boolean, italic: boolean): Face => (bold ? (italic ? "BoldItalic" : "Bold") : italic ? "Italic" : "Regular");
export const jsStyle = (face: Face) => (face === "Regular" ? "normal" : face === "Bold" ? "bold" : face === "Italic" ? "italic" : "bolditalic");

const cache = new Map<string, Promise<string>>();

function toB64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Fetch one face (cached for the session). `loader` is swappable for tests running outside the browser. */
export let fontLoader = async (path: string): Promise<Uint8Array> => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Font failed to load: ${path}`);
  return new Uint8Array(await res.arrayBuffer());
};
export const setFontLoader = (fn: typeof fontLoader) => (fontLoader = fn);

function loadFace(c: Compat, face: Face) {
  const key = `${c}-${face}`;
  if (!cache.has(key)) cache.set(key, fontLoader(`/fonts/convert/${FILE[c]}-${face}.ttf`).then(toB64));
  return cache.get(key)!;
}

/** Register the requested faces with a jsPDF document. Family names inside the PDF are the compat keys. */
export async function registerFonts(doc: jsPDF, needed: Iterable<[Compat, Face]>) {
  const uniq = new Map<string, [Compat, Face]>();
  for (const n of needed) uniq.set(n.join("-"), n);
  await Promise.all(
    [...uniq.values()].map(async ([c, face]) => {
      const b64 = await loadFace(c, face);
      const file = `${FILE[c]}-${face}.ttf`;
      doc.addFileToVFS(file, b64);
      doc.addFont(file, pdfFontName(c, face), "normal");
    }),
  );
}
