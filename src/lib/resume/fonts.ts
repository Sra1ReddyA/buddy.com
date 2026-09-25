"use client";
/** Loads the subset Arimo TTFs (Arial-metric, ≈25 KB each) once per session for PDF export and page fitting. */
import { FONT_FILES } from "./layout";

export type FontBytes = { normal: Uint8Array; italic: Uint8Array; bold: Uint8Array };

let cache: Promise<FontBytes> | null = null;

export function loadResumeFonts(): Promise<FontBytes> {
  cache ??= (async () => {
    const get = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Font failed to load: ${url}`);
      return new Uint8Array(await res.arrayBuffer());
    };
    const [normal, italic, bold] = await Promise.all([get(FONT_FILES.normal), get(FONT_FILES.italic), get(FONT_FILES.bold)]);
    return { normal, italic, bold };
  })().catch((e) => {
    cache = null; // allow retry
    throw e;
  });
  return cache;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
