import { NextResponse } from "next/server";
import { LawMoreRequest, LawSearchRequest, MAX_PAGE } from "@/lib/law/types";
import { runLawSearch } from "@/lib/law/engine";
import { CourtListenerError } from "@/lib/law/courtlistener";
import { prisma } from "@/lib/prisma";
import { getVisitorId, trackToolEvent } from "@/lib/tracking";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * POST /api/law-buddy?page=N
 *
 * Page 1 — body { caseType, jurisdiction, details }
 *   1) LLM analyzes the factual domain, disambiguates terms and extracts 3–5 fact-based keywords + a Boolean query
 *      (unsupported procedural boilerplate like "search and seizure" is rejected and repaired)
 *   2) CourtListener v4 search (type=o), filtered to the jurisdiction's courts — results 1–5
 *   3) full text of each opinion, 4) LLM 100–150 word summary + 3–5 case-specific keywords per opinion
 *
 * Page N ≥ 2 ("See More Cases") — body also carries { query, keywords } from the page-1 response.
 *   The SAME query is re-run and results (N-1)*5+1 … N*5 are analyzed; nothing is re-extracted.
 *   `page` may be sent as ?page=N or in the body.
 *
 * Page-1 searches are recorded in LawBuddyUsage (metrics only); extra pages as "load_more" events.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const rawPage = new URL(req.url).searchParams.get("page") ?? body?.page ?? 1;
  const page = Number(rawPage);
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    return NextResponse.json({ error: `page must be a whole number from 1 to ${MAX_PAGE}.` }, { status: 400 });
  }
  const more = page > 1;

  const rl = more ? rateLimit(`law-more:${clientIp(req)}`, 40, 60 * 60_000) : rateLimit(`law:${clientIp(req)}`, 12, 60 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `You've reached the hourly ${more ? "“See more” limit" : "search limit"}. Try again in ${Math.ceil(rl.retryAfter / 60)} minutes.` },
      { status: 429 },
    );
  }

  const parsed = (more ? LawMoreRequest : LawSearchRequest).safeParse(body);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const msg =
      field === "caseType"
        ? "Please choose a case type."
        : field === "jurisdiction"
          ? "Please choose a state or Federal jurisdiction."
          : field === "query" || field === "keywords"
            ? "Run a new search first — the original search query is missing."
            : (parsed.error.issues[0]?.message ?? "Invalid request.");
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const data = parsed.data;

  const started = Date.now();
  const record = async (r: { status: "success" | "no_results" | "failed"; resultCount?: number; engine?: string; errorCode?: string }) => {
    if (more) {
      await trackToolEvent({ tool: "law-buddy", action: "load_more", metadata: { page, status: r.status, resultCount: r.resultCount ?? 0 } });
      return;
    }
    try {
      const visitorId = await getVisitorId();
      const known = visitorId ? await prisma.visitor.findUnique({ where: { id: visitorId }, select: { id: true } }) : null;
      await prisma.lawBuddyUsage.create({
        data: { caseType: data.caseType, jurisdiction: data.jurisdiction, durationMs: Date.now() - started, visitorId: known ? visitorId : null, resultCount: 0, ...r },
      });
    } catch (err) {
      console.error("[law-buddy] usage record failed", err);
    }
    await trackToolEvent({ tool: "law-buddy", action: r.status === "failed" ? "search_failed" : "search", metadata: { caseType: data.caseType, jurisdiction: data.jurisdiction } });
  };

  try {
    const result = await runLawSearch(data, page);
    await record({ status: result.results.length ? "success" : "no_results", resultCount: result.results.length, engine: result.engine });
    return NextResponse.json(result);
  } catch (err) {
    const cl = err instanceof CourtListenerError ? err : null;
    console.error("[law-buddy]", err);
    await record({ status: "failed", errorCode: cl?.code ?? "internal" });
    return NextResponse.json({ error: cl ? cl.message : "Something went wrong while searching. Please try again." }, { status: cl?.status ?? 500 });
  }
}
