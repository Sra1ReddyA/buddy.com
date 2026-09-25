import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ADMIN_COOKIE } from "@/lib/auth";
import { verifyAdminToken } from "@/lib/auth-edge";
import { TOOLS } from "@/lib/tools";
import { TEMPLATES } from "@/lib/resume/templates";
import { TEMPLATE_IDS } from "@/lib/resume/types";
import { CASE_TYPES } from "@/lib/law/types";

export const metadata: Metadata = { title: "Admin dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const DAYS = 14;
const fmt = new Intl.NumberFormat("en-US");

type EventGroup = { tool: string; action: string; _count: { _all: number } };
type TemplateGroup = { template: string | null; _count: { _all: number } };
type RatingGroup = { rating: number; _count: { _all: number } };
type RecentReview = { id: string; tool: string; rating: number; comment: string | null; template: string | null; format: string | null; createdAt: Date };
type ConvGroup = { tool: string; status: string; _count: { _all: number }; _sum: { pages: number | null; inputBytes: number | null }; _avg: { durationMs: number | null } };
type ToolRating = { tool: string; _avg: { rating: number | null }; _count: { _all: number } };
type LawGroup = { status: string; _count: { _all: number }; _sum: { resultCount: number | null }; _avg: { durationMs: number | null } };
type LawTypeGroup = { caseType: string; _count: { _all: number } };
type LawJurGroup = { jurisdiction: string | null; _count: { _all: number } };

async function getStats() {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (DAYS - 1));
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [uniqueVisitors, totalVisits, newToday, visitsRecent, eventGroups, templateGroups, ratingAgg, ratingGroups, recentReviews, convGroups, toolRatings, visitors30, lawTotal, lawGroups, lawTypes, lawToday, lawJurs] =
    await Promise.all([
      prisma.visitor.count(),
      prisma.visit.count(),
      prisma.visitor.count({ where: { firstSeen: { gte: startOfToday } } }),
      prisma.visit.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }) as Promise<{ createdAt: Date }[]>,
      prisma.toolUsageEvent.groupBy({ by: ["tool", "action"], _count: { _all: true } }) as unknown as Promise<EventGroup[]>,
      prisma.toolUsageEvent.groupBy({
        by: ["template"],
        where: { tool: "resume-buddy", action: "generate" },
        _count: { _all: true },
      }) as unknown as Promise<TemplateGroup[]>,
      prisma.review.aggregate({ _avg: { rating: true }, _count: { _all: true } }) as Promise<{ _avg: { rating: number | null }; _count: { _all: number } }>,
      prisma.review.groupBy({ by: ["rating"], _count: { _all: true } }) as unknown as Promise<RatingGroup[]>,
      prisma.review.findMany({ orderBy: { createdAt: "desc" }, take: 8 }) as Promise<RecentReview[]>,
      prisma.conversion.groupBy({
        by: ["tool", "status"],
        _count: { _all: true },
        _sum: { pages: true, inputBytes: true },
        _avg: { durationMs: true },
      }) as unknown as Promise<ConvGroup[]>,
      prisma.review.groupBy({ by: ["tool"], _avg: { rating: true }, _count: { _all: true } }) as unknown as Promise<ToolRating[]>,
      prisma.visitor.count({ where: { lastSeen: { gte: since30 } } }),
      prisma.lawBuddyUsage.count(),
      prisma.lawBuddyUsage.groupBy({ by: ["status"], _count: { _all: true }, _sum: { resultCount: true }, _avg: { durationMs: true } }) as unknown as Promise<LawGroup[]>,
      prisma.lawBuddyUsage.groupBy({ by: ["caseType"], _count: { _all: true } }) as unknown as Promise<LawTypeGroup[]>,
      prisma.lawBuddyUsage.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.lawBuddyUsage.groupBy({ by: ["jurisdiction"], _count: { _all: true } }) as unknown as Promise<LawJurGroup[]>,
    ]);

  // visits per day (local server time)
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    return { key: d.toDateString(), label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), count: 0 };
  });
  const byKey = new Map(days.map((d) => [d.key, d]));
  visitsRecent.forEach((v) => {
    const d = byKey.get(new Date(v.createdAt).toDateString());
    if (d) d.count++;
  });

  const count = (tool: string, action: string) => eventGroups.find((g) => g.tool === tool && g.action === action)?._count._all ?? 0;

  return {
    uniqueVisitors,
    totalVisits,
    newToday,
    days,
    count,
    templates: TEMPLATE_IDS.map((id) => ({ id, name: TEMPLATES[id].name, n: templateGroups.find((g) => g.template === id)?._count._all ?? 0 })),
    avgRating: ratingAgg._avg.rating,
    reviewCount: ratingAgg._count._all,
    ratingDist: [5, 4, 3, 2, 1].map((r) => ({ r, n: ratingGroups.find((g) => g.rating === r)?._count._all ?? 0 })),
    recentReviews,
    visitors30,
    toolRatings,
    law: (() => {
      const g = (st: string) => lawGroups.find((x) => x.status === st);
      const ok = g("success")?._count._all ?? 0;
      const none = g("no_results")?._count._all ?? 0;
      const failed = g("failed")?._count._all ?? 0;
      const answered = ok + none;
      const avgMs = [g("success"), g("no_results")].reduce((acc, x) => acc + (x?._avg.durationMs ?? 0) * (x?._count._all ?? 0), 0) / Math.max(1, answered);
      return {
        total: lawTotal,
        today: lawToday,
        ok,
        none,
        failed,
        avgResults: ok ? (g("success")?._sum.resultCount ?? 0) / ok : 0,
        avgMs: answered ? avgMs : null,
        byType: CASE_TYPES.map((t) => ({ t, n: lawTypes.find((x) => x.caseType === t)?._count._all ?? 0 })),
        topJurisdictions: lawJurs
          .filter((x) => x.jurisdiction)
          .map((x) => ({ j: x.jurisdiction as string, n: x._count._all }))
          .sort((a, b) => b.n - a.n)
          .slice(0, 8),
      };
    })(),
    converters: (["pdf-to-word", "word-to-pdf"] as const).map((tool) => {
      const ok = convGroups.find((g) => g.tool === tool && g.status === "success");
      const bad = convGroups.find((g) => g.tool === tool && g.status === "failed");
      const success = ok?._count._all ?? 0;
      const failed = bad?._count._all ?? 0;
      return {
        tool,
        success,
        failed,
        rate: success + failed ? success / (success + failed) : null,
        pages: ok?._sum.pages ?? 0,
        bytes: ok?._sum.inputBytes ?? 0,
        avgMs: ok?._avg.durationMs ?? null,
        uploads: count(tool, "upload"),
        downloads: count(tool, tool === "pdf-to-word" ? "download_docx" : "download_pdf"),
        opens: count(tool, "open"),
        rating: toolRatings.find((r) => r.tool === tool),
      };
    }),
  };
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="text-amber-400" aria-label={`${n} of 5 stars`}>
      {"★".repeat(n)}<span className="text-slate-200">{"★".repeat(5 - n)}</span>
    </span>
  );
}

export default async function AdminPage() {
  // Defence in depth: the proxy already guards /admin, verify again server-side.
  if (!(await verifyAdminToken((await cookies()).get(ADMIN_COOKIE)?.value))) redirect("/admin/login");

  let s: Awaited<ReturnType<typeof getStats>>;
  try {
    s = await getStats();
  } catch (err) {
    console.error(err);
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="card p-6">
          <h1 className="font-semibold">Database not reachable</h1>
          <p className="mt-2 text-sm text-slate-600">Check DATABASE_URL and run <code className="rounded bg-slate-100 px-1">npx prisma db push</code>.</p>
        </div>
      </div>
    );
  }

  const maxDay = Math.max(1, ...s.days.map((d) => d.count));
  const maxRating = Math.max(1, ...s.ratingDist.map((d) => d.n));
  const maxTpl = Math.max(1, ...s.templates.map((t) => t.n));
  const generations = s.count("resume-buddy", "generate");
  const downloads = s.count("resume-buddy", "download_pdf") + s.count("resume-buddy", "download_docx");

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-slate-500">Live numbers from the Buddy database</p>
        </div>
        <form action="/api/admin/logout" method="post">
          <button className="btn-secondary">Sign out</button>
        </form>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Total site visitors" value={fmt.format(s.uniqueVisitors)} hint={`${fmt.format(s.newToday)} new today · ${fmt.format(s.visitors30)} active in 30 days`} />
        <Stat label="Total visits" value={fmt.format(s.totalVisits)} hint="New session after 30 min idle" />
        <Stat label="Resumes generated" value={fmt.format(generations)} hint={`${fmt.format(downloads)} downloads`} />
        <Stat label="Law Buddy searches" value={fmt.format(s.law.total)} hint={`${fmt.format(s.law.today)} today · ${fmt.format(s.law.ok)} with results`} />
        <Stat
          label="Files converted"
          value={fmt.format(s.converters.reduce((a, c) => a + c.success, 0))}
          hint={s.converters.map((c) => `${c.tool === "pdf-to-word" ? "PDF→Word" : "Word→PDF"} ${fmt.format(c.success)}`).join(" · ")}
        />
        <Stat
          label="Average rating"
          value={s.avgRating ? `${s.avgRating.toFixed(2)} ★` : "—"}
          hint={`${fmt.format(s.reviewCount)} review${s.reviewCount === 1 ? "" : "s"}`}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <h2 className="font-semibold">Visits — last {DAYS} days</h2>
          <div className="mt-6 flex h-44 items-end gap-1.5 border-b border-slate-200" role="img" aria-label={`Daily visits: ${s.days.map((d) => `${d.label} ${d.count}`).join(", ")}`}>
            {s.days.map((d) => (
              <div key={d.key} className="group relative flex h-full flex-1 items-end" title={`${d.label}: ${d.count} visits`}>
                <div className="w-full rounded-t-[4px] bg-brand-500 transition group-hover:bg-brand-700" style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: d.count ? 3 : 0 }} />
                <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-1.5 py-0.5 text-[11px] text-white group-hover:block">
                  {d.label}: {d.count}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-slate-400">
            <span>{s.days[0].label}</span>
            <span>{s.days.at(-1)!.label}</span>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold">Ratings</h2>
          <div className="mt-4 space-y-2">
            {s.ratingDist.map((d) => (
              <div key={d.r} className="flex items-center gap-2 text-sm" title={`${d.r} stars: ${d.n}`}>
                <span className="w-8 tabular-nums text-slate-600">{d.r}★</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${(d.n / maxRating) * 100}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums text-slate-500">{d.n}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card mt-6 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Law Buddy</h2>
          <span className="text-xs text-slate-400">Only counts are stored — never the user&apos;s description</span>
        </div>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <dl className="grid grid-cols-3 gap-y-4 text-sm">
            {[
              ["Total searches", fmt.format(s.law.total)],
              ["With results", fmt.format(s.law.ok)],
              ["No results", fmt.format(s.law.none)],
              ["Failed", fmt.format(s.law.failed)],
              ["Avg cases shown", s.law.ok ? s.law.avgResults.toFixed(1) : "—"],
              ["Avg time", s.law.avgMs === null ? "—" : `${(s.law.avgMs / 1000).toFixed(1)} s`],
              ["“See more” loads", fmt.format(s.count("law-buddy", "load_more"))],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="text-lg font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
            <div className="col-span-2">
              <dt className="text-xs text-slate-500">Top jurisdictions</dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {s.law.topJurisdictions.length ? (
                  s.law.topJurisdictions.map(({ j, n }) => (
                    <span key={j} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                      {j} <span className="tabular-nums text-slate-400">{n}</span>
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-slate-400">No searches yet</span>
                )}
              </dd>
            </div>
          </dl>
          <div>
            <p className="text-xs font-medium text-slate-500">Searches by case type</p>
            <div className="mt-2 space-y-1.5">
              {(() => {
                const max = Math.max(1, ...s.law.byType.map((x) => x.n));
                return s.law.byType.map(({ t, n }) => (
                  <div key={t} className="flex items-center gap-2 text-sm" title={`${t}: ${n}`}>
                    <span className="w-36 shrink-0 truncate text-slate-600">{t}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${(n / max) * 100}%` }} />
                    </div>
                    <span className="w-8 text-right tabular-nums text-slate-500">{n}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        {s.converters.map((c) => (
          <div key={c.tool} className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{c.tool === "pdf-to-word" ? "PDF → Word" : "Word → PDF"}</h2>
              <span className="text-xs text-slate-400">
                {c.rating ? `${c.rating._avg.rating?.toFixed(1)} ★ (${c.rating._count._all})` : "no ratings yet"}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-y-4 text-sm">
              {[
                ["Conversions", fmt.format(c.success)],
                ["Failed", fmt.format(c.failed)],
                ["Success rate", c.rate === null ? "—" : `${Math.round(c.rate * 100)}%`],
                ["Page views", fmt.format(c.opens)],
                ["Files uploaded", fmt.format(c.uploads)],
                ["Downloads", fmt.format(c.downloads)],
                ["Pages converted", fmt.format(c.pages)],
                ["Data converted", c.bytes > 1e6 ? `${(c.bytes / 1e6).toFixed(1)} MB` : `${Math.round(c.bytes / 1e3)} KB`],
                ["Avg time", c.avgMs === null ? "—" : `${(c.avgMs / 1000).toFixed(1)} s`],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            {c.uploads > 0 && (
              <div className="mt-4" title="Upload → conversion → download">
                <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="bg-brand-500" style={{ width: `${Math.min(100, (c.downloads / c.uploads) * 100)}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-500">{Math.round(Math.min(1, c.downloads / c.uploads) * 100)}% of uploads end in a download</p>
              </div>
            )}
          </div>
        ))}
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <section className="card overflow-hidden lg:col-span-2">
          <h2 className="p-5 pb-3 font-semibold">Tool usage</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2 font-medium">Tool</th>
                  <th className="px-3 py-2 text-right font-medium">Opens</th>
                  <th className="px-3 py-2 text-right font-medium">“Coming soon” clicks</th>
                  <th className="px-3 py-2 text-right font-medium">Uploads</th>
                  <th className="px-3 py-2 text-right font-medium">Generations / conversions / searches</th>
                  <th className="px-3 py-2 text-right font-medium">PDF</th>
                  <th className="px-5 py-2 text-right font-medium">Word</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {TOOLS.map((t) => (
                  <tr key={t.id}>
                    <td className="px-5 py-2.5 font-medium">
                      {t.name}
                      {!t.active && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">soon</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">{fmt.format(s.count(t.id, "open"))}</td>
                    <td className="px-3 py-2.5 text-right">{fmt.format(s.count(t.id, "coming_soon_click"))}</td>
                    <td className="px-3 py-2.5 text-right">{fmt.format(s.count(t.id, "parse_upload") + s.count(t.id, "upload"))}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{fmt.format(s.count(t.id, "generate") + s.count(t.id, "convert") + s.count(t.id, "search"))}</td>
                    <td className="px-3 py-2.5 text-right">{fmt.format(s.count(t.id, "download_pdf"))}</td>
                    <td className="px-5 py-2.5 text-right">{fmt.format(s.count(t.id, "download_docx"))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold">Generations by template</h2>
          <div className="mt-4 space-y-3">
            {s.templates.map((t) => (
              <div key={t.id} title={`${t.name}: ${t.n}`}>
                <div className="flex justify-between text-sm">
                  <span>{t.name}</span>
                  <span className="tabular-nums text-slate-500">{fmt.format(t.n)}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${(t.n / maxTpl) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card mt-6 p-5">
        <h2 className="font-semibold">Latest reviews</h2>
        {s.recentReviews.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No reviews yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {s.recentReviews.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-4">
                <Stars n={r.rating} />
                <p className="flex-1 text-sm text-slate-700">{r.comment || <span className="text-slate-400">No comment</span>}</p>
                <p className="text-xs text-slate-400">
                  {[TOOLS.find((t) => t.id === r.tool)?.name, r.template && TEMPLATES[r.template as keyof typeof TEMPLATES]?.name, r.format?.toUpperCase(), new Date(r.createdAt).toLocaleString()]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
