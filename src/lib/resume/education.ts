/**
 * Education parsing: keep School + Degree (+ field, dates, GPA/honors) together as ONE entry.
 *
 * Resumes put a single degree on 2–4 lines in any order, e.g.
 *     University of Texas at Austin            Austin, TX
 *     B.S. in Computer Science                 2014 – 2018
 *     GPA 3.8 / 4.0, Magna Cum Laude
 * Line-by-line parsers (and sometimes the LLM) turn that into several entries.
 * parseEducationLine() classifies each fragment; mergeEducation() stitches fragments
 * into complete entries and is applied to BOTH the heuristic and the LLM parse output.
 */
import type { Education } from "./types";

const SCHOOL_RE =
  /\b(university|universit[äé]|college|institute|institution|school|academy|polytechnic|conservatory|seminary|iit|nit|mit|ucla|nyu|usc|cuny|suny)\b/i;
const DEGREE_RE =
  /\b(bachelor'?s?|master'?s?|doctor(ate)?|associate'?s?|diploma|certificate|degree|ph\.?\s?d|m\.?\s?b\.?\s?a|b\.?\s?(?:s|a|e|sc|com|tech|eng|arch|ba|fa)\b\.?|m\.?\s?(?:s|a|e|sc|tech|eng|fa|phil|ed)\b\.?|b\.?tech|m\.?tech|j\.?d|m\.?d|ll\.?[bm]|ed\.?d)/i;
const DETAIL_RE = /\b(gpa|cgpa|honou?rs|cum laude|dean'?s list|thesis|coursework|minor|scholarship|valedictorian|summa|magna)\b/i;
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?,?\\s";
const YEARS_RE = new RegExp(
  `((?:${MONTH})?(?:19|20)\\d{2})\\s*(?:[-–—]|to)\\s*((?:${MONTH})?(?:19|20)\\d{2}|present|current|expected\\s(?:${MONTH})?(?:19|20)\\d{2})`,
  "i",
);
const SINGLE_YEAR_RE = new RegExp(`(?:expected\\s|graduated\\s|class of\\s)?((?:${MONTH})?(?:19|20)\\d{2})\\b`, "i");
const LOCATION_RE = /^[A-Z][A-Za-z .'-]+,\s*(?:[A-Z]{2}|[A-Z][a-z]+)$/;

const blank = (): Education => ({ school: "", degree: "", field: "", startDate: "", endDate: "", details: "" });
const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s,|–—-]+|[\s,|–—-]+$/g, "").trim();

/** Split "B.S. in Computer Science" / "Bachelor of Science, Computer Science" into degree + field. */
export function splitDegree(text: string): { degree: string; field: string } {
  const t = tidy(text);
  const m =
    t.match(/^(.*?\b(?:of|in)\s+(?:science|arts|engineering|technology|business administration|commerce|fine arts|laws|education|philosophy)\b)(?:\s*(?:in|,|-|–)\s*(.+))?$/i) ||
    t.match(/^(.*?)(?:\s+in\s+|\s*,\s*|\s+[-–]\s+)(.+)$/);
  if (m && DEGREE_RE.test(m[1])) return { degree: tidy(m[1]), field: tidy(m[2] ?? "") };
  // Abbreviated degree followed directly by the field: "M.S. Electrical Engineering", "B.Tech Computer Science"
  const abbr = t.match(/^((?:[BM]\.?\s?(?:S|A|E|Sc|Com|Tech|Eng|Arch|FA|Phil|Ed)\.?(?:E\.)?)|MBA|M\.?B\.?A\.?|Ph\.?\s?D\.?|J\.?D\.?|LL\.?[BM]\.?)\s+(?:in\s+)?([A-Z].+)$/);
  if (abbr) return { degree: tidy(abbr[1]), field: tidy(abbr[2]) };
  return { degree: t, field: "" };
}

/** Classify one line of an education section into a partial entry. */
export function parseEducationLine(line: string): Education {
  const e = blank();
  let rest = line.replace(/^[\s•\-–—*·▪◦►]+/, "");

  const years = rest.match(YEARS_RE);
  if (years) {
    e.startDate = tidy(years[1]);
    e.endDate = tidy(years[2]);
    rest = rest.replace(years[0], " ");
  } else {
    const y = rest.match(SINGLE_YEAR_RE);
    if (y && rest.replace(y[0], "").trim().length < rest.length) {
      e.endDate = tidy(y[0].replace(/^(graduated|class of)\s/i, ""));
      rest = rest.replace(y[0], " ");
    }
  }

  // Split on strong separators; keep commas inside degree names ("Bachelor of Science, CS") for splitDegree
  const segments = rest.split(/\s+\|\s+|\s+[–—]\s+|\t+|\s{3,}/).map(tidy).filter(Boolean);
  for (const segRaw of segments) {
    let seg = segRaw;
    if (DETAIL_RE.test(seg) && !DEGREE_RE.test(seg.replace(DETAIL_RE, ""))) {
      e.details = [e.details, seg].filter(Boolean).join("; ");
      continue;
    }
    // "B.S. in CS, University of Texas" or "University of Texas, B.S. Computer Science"
    const comma = seg.split(/,\s*/);
    if (comma.length > 1 && SCHOOL_RE.test(seg) && DEGREE_RE.test(seg)) {
      const idx = comma.findIndex((c) => SCHOOL_RE.test(c) && !DEGREE_RE.test(c));
      if (idx >= 0) {
        e.school = e.school || comma[idx];
        seg = comma.filter((_, i) => i !== idx).join(", ");
      }
    }
    const at = seg.match(/^(.+?)\s+(?:at|from)\s+(.+)$/i);
    if (at && DEGREE_RE.test(at[1]) && SCHOOL_RE.test(at[2])) {
      Object.assign(e, splitDegree(at[1]));
      e.school = e.school || tidy(at[2]);
      continue;
    }
    if (DEGREE_RE.test(seg) && !(SCHOOL_RE.test(seg) && !/\b(of|in)\b/i.test(seg))) {
      const { degree, field } = splitDegree(seg);
      if (!e.degree) {
        e.degree = degree;
        e.field = e.field || field;
      } else e.field = e.field || seg;
    } else if (SCHOOL_RE.test(seg) && !e.school) {
      e.school = seg;
    } else if (LOCATION_RE.test(seg)) {
      /* location of the school — not stored separately */
    } else if (!e.school && !e.degree && /^[A-Z]/.test(seg) && seg.split(" ").length <= 8) {
      e.school = seg; // unlabeled proper noun line, most likely the institution
    } else if (e.degree && !e.field) {
      e.field = seg;
    } else {
      e.details = [e.details, seg].filter(Boolean).join("; ");
    }
  }
  return e;
}

/** Fix entries where the school and degree ended up in the wrong fields. */
function normalizeEntry(raw: Education): Education {
  const e = { ...blank(), ...raw };
  (Object.keys(e) as (keyof Education)[]).forEach((k) => (e[k] = tidy(e[k] ?? "")));
  if (!e.degree && DEGREE_RE.test(e.school) && !SCHOOL_RE.test(e.school)) {
    Object.assign(e, splitDegree(e.school));
    e.school = "";
  }
  if (!e.school && SCHOOL_RE.test(e.degree) && !DEGREE_RE.test(e.degree)) {
    e.school = e.degree;
    e.degree = "";
  }
  if (e.degree && !e.field) Object.assign(e, splitDegree(e.degree));
  return e;
}

const fill = (a: Education, b: Education): Education => ({
  school: a.school || b.school,
  degree: a.degree || b.degree,
  field: a.field || b.field,
  startDate: a.startDate || b.startDate,
  endDate: a.endDate || b.endDate,
  details: [a.details, b.details].filter(Boolean).join("; "),
});

/**
 * Stitch fragments into complete entries. A fragment is merged into the previous entry when it
 * supplies something that entry is missing (school-only after degree-only, dates/details only, etc.).
 * Two complete entries (school + degree each) are never merged, so separate degrees stay separate.
 */
export function mergeEducation(list: Education[]): Education[] {
  const out: Education[] = [];
  for (const raw of list) {
    let e = normalizeEntry(raw);
    if (!e.school && !e.degree && !e.field && !e.details && !e.startDate && !e.endDate) continue;
    const prev = out.at(-1);
    // A bare non-institution line right after a degree with no field is that degree's field
    // ("Bachelor of Engineering" / "Electronics and Communication").
    if (prev && prev.degree && !prev.field && e.school && !e.degree && !SCHOOL_RE.test(e.school)) {
      e = { ...e, field: e.school, school: "" };
    }
    const fragmentOnly = !e.school && !e.degree; // dates / field / GPA line
    const complements =
      prev &&
      ((e.school && !e.degree && !prev.school) || // school line for a degree-first entry
        (e.degree && !e.school && !prev.degree) || // degree line for a school-first entry
        (e.school && e.degree && !prev.school && !prev.degree)); // only dates/details so far
    const conflicts = prev && fragmentOnly && e.field && prev.field; // a second field → new degree, not a fragment
    if (prev && (fragmentOnly || complements) && !conflicts) out[out.length - 1] = fill(prev, e);
    else out.push(e);
  }
  // Several degrees listed under one institution: later degrees inherit the school above them.
  for (let i = 1; i < out.length; i++) if (!out[i].school && out[i].degree) out[i].school = out[i - 1].school;
  return out.slice(0, 8);
}
