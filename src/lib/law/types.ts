import { z } from "zod";
import { JURISDICTIONS, type Jurisdiction } from "./jurisdictions";

export { JURISDICTIONS, type Jurisdiction };

export const CASE_TYPES = [
  "Civil",
  "Criminal",
  "Family",
  "Corporate",
  "Real Estate",
  "Intellectual Property",
  "Traffic",
  "Administrative",
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const DETAILS_MIN = 30;
export const DETAILS_MAX = 5000;

export const MAX_PAGE = 20;
export const PAGE_SIZE = 5;

export const LawSearchRequest = z.object({
  caseType: z.enum(CASE_TYPES),
  jurisdiction: z.enum(JURISDICTIONS),
  details: z.string().trim().min(DETAILS_MIN, `Please describe your situation in at least ${DETAILS_MIN} characters.`).max(DETAILS_MAX),
});
export type LawSearchRequest = z.infer<typeof LawSearchRequest>;

/**
 * "See More Cases": page ≥ 2 re-runs the SAME query from page 1 (no new keyword extraction), so the
 * client sends back the query and keywords it received.
 */
export const LawMoreRequest = LawSearchRequest.extend({
  query: z.string().trim().min(3).max(400),
  keywords: z.array(z.string().trim().min(2).max(60)).min(1).max(5),
});
export type LawMoreRequest = z.infer<typeof LawMoreRequest>;

/**
 * What the LLM returns for step 1. The analysis fields come FIRST so the model commits to the factual
 * domain and to the meaning of ambiguous words (medical "seizure" vs. Fourth Amendment "seizure")
 * before it writes keywords or the query.
 */
export const SearchPlan = z.object({
  factualDomain: z.string().trim().max(160),
  factualCore: z.string().trim().max(500),
  ambiguousTerms: z
    .array(z.object({ term: z.string().trim().max(60), meaningHere: z.string().trim().max(200), notMeaning: z.string().trim().max(200) }))
    .max(8),
  keywords: z.array(z.string().trim().min(2).max(60)).min(3).max(5),
  booleanQuery: z.string().trim().min(3).max(400),
  broadQuery: z.string().trim().min(3).max(400),
});
export type SearchPlan = z.infer<typeof SearchPlan>;

export type CaseResult = {
  id: number;
  caseName: string;
  court: string;
  year: string;
  dateFiled: string | null;
  citations: string[];
  docketNumber: string | null;
  citeCount: number | null;
  url: string;
  /** 100–150 word summary: facts, ruling, relevance. */
  summary: string;
  /** 3–5 terms that appear in this opinion's text and connect it to the user's situation. */
  keywords: string[];
  /** true when the summary was written from the full opinion text (not just a search snippet). */
  fullText: boolean;
};

export const SUMMARY_MIN_WORDS = 100;
export const SUMMARY_MAX_WORDS = 150;

export type LawSearchResponse = {
  jurisdiction: Jurisdiction;
  /** CourtListener court IDs the search was restricted to. */
  courts: string[];
  keywords: string[];
  query: string;
  /** One-sentence reading of the facts the search was built on (page 1 with AI only). */
  interpretation?: string;
  usedBroadQuery: boolean;
  page: number;
  pageSize: number;
  hasMore: boolean;
  totalFound: number;
  results: CaseResult[];
  engine: "llm" | "rules";
  notice?: string;
};
