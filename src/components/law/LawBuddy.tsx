"use client";
import { useEffect, useRef, useState } from "react";
import { CASE_TYPES, DETAILS_MAX, DETAILS_MIN, type CaseResult, type CaseType, type LawSearchResponse } from "@/lib/law/types";
import { STATES, jurisdictionLabel, type Jurisdiction } from "@/lib/law/jurisdictions";
import { trackUsage } from "@/lib/track-client";
import { LawDisclaimer } from "./LawDisclaimer";

const stagesFor = (j: Jurisdiction | "") => [
  "Extracting legal keywords…",
  `Searching ${j ? jurisdictionLabel(j) : "public court opinions"}…`,
  "Reading each opinion…",
  "Writing detailed case summaries…",
];
const STAGE_AT_MS = [2500, 6000, 11000];

/** CourtListener search page limited to the same courts (used by the keyword pills and "See all results"). */
const clSearchUrl = (q: string, courts: string[]) =>
  `https://www.courtlistener.com/?q=${encodeURIComponent(q)}&type=o&order_by=score%20desc${courts.length ? `&court=${encodeURIComponent(courts.join(" "))}` : ""}`;

const PLACEHOLDERS: Record<CaseType, string> = {
  Civil: "e.g. I was let go two weeks after reporting safety violations to HR. My manager had praised my work in writing a month earlier…",
  Criminal: "e.g. Police searched my car during a traffic stop without asking for consent and found…",
  Family: "e.g. My ex-spouse wants to move to another state with our 8-year-old. We currently share custody 50/50…",
  Corporate: "e.g. As a minority shareholder, I learned the majority owner has been paying himself through a side company…",
  "Real Estate": "e.g. My landlord kept my entire security deposit and says I caused damage that was already there when I moved in…",
  "Intellectual Property": "e.g. A company used my photographs on their website without permission and says it's fair use…",
  Traffic: "e.g. I was cited for speeding based on a radar reading, but the officer didn't show calibration records…",
  Administrative: "e.g. The state agency revoked my professional license without a hearing after a single complaint…",
};

/** Law Buddy: case type + jurisdiction + facts → relevant public court opinions with 100–150 word summaries and case-specific keyword pills. */
export function LawBuddy() {
  const [caseType, setCaseType] = useState<CaseType | "">("");
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction | "">("");
  const [details, setDetails] = useState("");
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LawSearchResponse | null>(null);
  // pagination: all cases shown so far (page 1 + every "See More Cases" page), appended in order
  const [cases, setCases] = useState<CaseResult[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  // the exact inputs page 1 ran with, so later pages use the same search even if the form is edited
  const searched = useRef<{ caseType: CaseType; jurisdiction: Jurisdiction; details: string } | null>(null);
  const firstNewRef = useRef<HTMLAnchorElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    trackUsage("law-buddy", "open");
  }, []);

  // progress through the three stages while the single request runs
  useEffect(() => {
    if (!loading) return;
    setStage(0);
    const timers = STAGE_AT_MS.map((ms, i) => setTimeout(() => setStage(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [loading]);

  const len = details.trim().length;
  const typeError = touched && !caseType ? "Please choose a case type." : null;
  const jurError = touched && !jurisdiction ? "Please choose a state or Federal." : null;
  const detailsError = touched && len < DETAILS_MIN ? `Please describe your situation in at least ${DETAILS_MIN} characters (${len}/${DETAILS_MIN}).` : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!caseType || !jurisdiction || len < DETAILS_MIN) return;
    setLoading(true);
    setError(null);
    setData(null);
    setCases([]);
    setMoreError(null);
    try {
      const input = { caseType, jurisdiction, details };
      const res = await fetch("/api/law-buddy?page=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = (await res.json()) as LawSearchResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || "Search failed.");
      searched.current = input;
      setData(json);
      setCases(json.results);
      setPage(1);
      setHasMore(json.hasMore);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  /** "See More Cases": fetch page N+1 with the same query and append (never replace) the results. */
  async function loadMore() {
    if (!data || !searched.current || loadingMore) return;
    const next = page + 1;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await fetch(`/api/law-buddy?page=${next}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...searched.current, query: data.query, keywords: data.keywords }),
      });
      const json = (await res.json()) as LawSearchResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || "Couldn't load more cases.");
      setCases((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...json.results.filter((c) => !seen.has(c.id))];
      });
      setPage(next);
      setHasMore(json.hasMore && json.results.length > 0);
      // move keyboard focus to the first newly added case
      if (json.results.length) setTimeout(() => firstNewRef.current?.focus(), 50);
    } catch (err) {
      setMoreError(err instanceof Error ? err.message : "Couldn't load more cases.");
    } finally {
      setLoadingMore(false);
    }
  }

  const firstOfLastPage = (page - 1) * (data?.pageSize ?? 5);

  return (
    <div className="space-y-8">
      <LawDisclaimer />

      <form onSubmit={onSubmit} noValidate className="card space-y-5 p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="lb-type" className="mb-1 block text-sm font-semibold text-slate-800">
              Case type <span className="text-rose-600" aria-hidden>*</span>
            </label>
            <select
              id="lb-type"
              required
              aria-required="true"
              aria-invalid={!!typeError}
              aria-describedby={typeError ? "lb-type-err" : undefined}
              value={caseType}
              onChange={(e) => setCaseType(e.target.value as CaseType)}
              className={`input h-11 ${typeError ? "border-rose-400" : ""}`}
            >
              <option value="" disabled>Select a case type…</option>
              {CASE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {typeError && <p id="lb-type-err" className="mt-1 text-xs text-rose-600">{typeError}</p>}
          </div>

          <div>
            <label htmlFor="lb-jur" className="mb-1 block text-sm font-semibold text-slate-800">
              U.S. State Jurisdiction <span className="text-rose-600" aria-hidden>*</span>
            </label>
            <select
              id="lb-jur"
              required
              aria-required="true"
              aria-invalid={!!jurError}
              aria-describedby={jurError ? "lb-jur-err" : "lb-jur-hint"}
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value as Jurisdiction)}
              className={`input h-11 ${jurError ? "border-rose-400" : ""}`}
            >
              <option value="" disabled>Select a state or Federal…</option>
              <optgroup label="Federal">
                <option value="Federal">Federal (U.S. Supreme Court, circuits, district courts)</option>
              </optgroup>
              <optgroup label="States">
                {STATES.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </optgroup>
            </select>
            {jurError ? (
              <p id="lb-jur-err" className="mt-1 text-xs text-rose-600">{jurError}</p>
            ) : (
              <p id="lb-jur-hint" className="mt-1 text-xs text-slate-500">Only cases from these courts are searched.</p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="lb-details" className="mb-1 block text-sm font-semibold text-slate-800">
            Case details <span className="text-rose-600" aria-hidden>*</span>
          </label>
          <p className="mb-2 text-xs text-slate-500">Describe what happened, when, and the key facts. Leave out names, addresses and other personal details.</p>
          <textarea
            id="lb-details"
            required
            aria-invalid={!!detailsError}
            aria-describedby="lb-details-hint"
            value={details}
            maxLength={DETAILS_MAX}
            onChange={(e) => setDetails(e.target.value)}
            placeholder={caseType ? PLACEHOLDERS[caseType] : "Describe your situation, the incident and the key facts…"}
            className={`input min-h-44 leading-relaxed ${detailsError ? "border-rose-400" : ""}`}
          />
          <div id="lb-details-hint" className="mt-1 flex justify-between text-xs">
            <span className="text-rose-600">{detailsError}</span>
            <span className="text-slate-400">{details.length}/{DETAILS_MAX}</span>
          </div>
        </div>

        <button type="submit" className="btn-primary w-full py-3 text-base" disabled={loading}>
          {loading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Searching…
            </>
          ) : (
            "Find relevant cases"
          )}
        </button>

        {loading && (
          <ol className="space-y-1.5 text-sm" aria-live="polite">
            {stagesFor(jurisdiction).map((s, i) => (
              <li key={s} className={`flex items-center gap-2 ${i < stage ? "text-emerald-700" : i === stage ? "font-medium text-slate-800" : "text-slate-400"}`}>
                <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${i < stage ? "bg-emerald-100" : i === stage ? "bg-brand-100 text-brand-700" : "bg-slate-100"}`}>
                  {i < stage ? "✓" : i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        )}
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </form>

      {data && (
        <section ref={resultsRef} aria-labelledby="lb-results" className="scroll-mt-20 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="lb-results" className="text-xl font-semibold tracking-tight">
                {cases.length ? `${cases.length} relevant opinion${cases.length > 1 ? "s" : ""}` : "No matching opinions found"}
              </h2>
              {data.totalFound > 0 && (
                <p className="text-sm text-slate-500">
                  From {data.totalFound.toLocaleString()} public opinions in {jurisdictionLabel(data.jurisdiction)} on CourtListener
                  {data.usedBroadQuery ? " (using a broader search)" : ""}.
                </p>
              )}
            </div>
          </div>

          <div className="card space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Legal keywords</span>
              {data.keywords.map((k) => (
                <span key={k} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">{k}</span>
              ))}
            </div>
            {data.interpretation && (
              <p className="text-sm text-slate-600">
                <span className="font-medium text-slate-800">Read as:</span> {data.interpretation}
              </p>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-600 hover:text-slate-900">Search query used</summary>
              <code className="mt-2 block overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100">{data.query}</code>
              <a
                href={clSearchUrl(data.query, data.courts)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs font-medium text-brand-600 hover:underline"
              >
                See all results on CourtListener ↗
              </a>
            </details>
          </div>

          {data.notice && <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">{data.notice}</p>}

          {cases.length === 0 ? (
            <div className="card p-6 text-sm text-slate-600">
              <p>We couldn&apos;t find published opinions in {jurisdictionLabel(data.jurisdiction)} for this description. Try:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>adding the specific legal issue (e.g. “security deposit”, “unlawful search”),</li>
                <li>searching Federal or a neighboring state (courts often look at similar cases elsewhere), or</li>
                <li>choosing a different case type.</li>
              </ul>
            </div>
          ) : (
            <ol className="space-y-4">
              {cases.map((c, i) => (
                <li key={c.id} className="card p-5">
                  <div className="flex items-start gap-4">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-900 text-sm font-bold text-white" aria-hidden>{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold leading-snug text-slate-900">
                        <a
                          ref={page > 1 && i === firstOfLastPage ? firstNewRef : undefined}
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-brand-700 hover:underline"
                        >
                          {c.caseName}
                        </a>
                      </h3>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
                        <span>{c.court}</span>
                        {c.year && (
                          <>
                            <span aria-hidden>·</span>
                            <span>Filed {c.year}</span>
                          </>
                        )}
                        {c.citations[0] && (
                          <>
                            <span aria-hidden>·</span>
                            <span className="font-mono text-xs">{c.citations[0]}</span>
                          </>
                        )}
                      </p>
                      <p className="mt-3 text-justify text-sm leading-relaxed text-slate-700 hyphens-auto">{c.summary}</p>
                      {!c.fullText && (
                        <p className="mt-1 text-xs text-slate-400">Summary based on the search excerpt — the full text wasn&apos;t available.</p>
                      )}

                      {c.keywords.length > 0 && (
                        <ul className="mt-3 flex flex-wrap gap-2" aria-label={`Key terms from ${c.caseName}`}>
                          {c.keywords.map((k) => (
                            <li key={k}>
                              <a
                                href={clSearchUrl(`"${k}"`, data.courts)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`Search ${jurisdictionLabel(data.jurisdiction)} for “${k}”`}
                                className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full transition-colors hover:bg-blue-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                              >
                                {k}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="btn-secondary mt-4 px-3 py-1.5 text-xs">
                        Read the full opinion
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><path d="M14 4h6v6M20 4 10 14M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {cases.length > 0 && (
            <div className="flex flex-col items-center gap-2 pt-2" aria-live="polite">
              {hasMore ? (
                <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-secondary min-w-48 px-5 py-2.5 text-sm">
                  {loadingMore ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" /> Loading more cases…
                    </>
                  ) : (
                    "See More Cases"
                  )}
                </button>
              ) : (
                <p className="text-sm text-slate-500">That&apos;s every matching case we could load for this search.</p>
              )}
              {loadingMore && <p className="text-xs text-slate-400">Reading and summarizing the next {data.pageSize} opinions — this takes a few seconds.</p>}
              {moreError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{moreError}</p>}
            </div>
          )}

          <LawDisclaimer compact />
          <p className="text-center text-xs text-slate-400">Case data from CourtListener, a free public legal database by the Free Law Project.</p>
        </section>
      )}
    </div>
  );
}
