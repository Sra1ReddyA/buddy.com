import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, SESSION_WINDOW_S, VISITOR_COOKIE, isBot } from "@/lib/tracking";

const Body = z.object({ path: z.string().max(300).default("/"), referrer: z.string().max(500).optional() });

/**
 * Called once per page load by <VisitTracker/>.
 * - New visitor id  -> Visitor row created (unique visitors +1) and Visit row created.
 * - Known visitor, no active session cookie -> visitCount +1 and a new Visit row.
 * - Active session (within 30 min) -> nothing is counted, session window is extended.
 */
export async function POST(req: Request) {
  const ua = req.headers.get("user-agent");
  if (isBot(ua)) return NextResponse.json({ counted: false, reason: "bot" });

  const jar = await cookies();
  const visitorId = jar.get(VISITOR_COOKIE)?.value;
  if (!visitorId || !/^[0-9a-f-]{36}$/i.test(visitorId)) return NextResponse.json({ counted: false });

  const body = Body.safeParse(await req.json().catch(() => ({})));
  const path = body.success ? body.data.path : "/";
  const referrer = body.success ? body.data.referrer : undefined;
  const inSession = !!jar.get(SESSION_COOKIE);

  let counted = false;
  try {
    if (!inSession) {
      await prisma.$transaction([
        prisma.visitor.upsert({
          where: { id: visitorId },
          create: { id: visitorId, userAgent: ua?.slice(0, 300), referrer: referrer?.slice(0, 300) },
          update: { visitCount: { increment: 1 } },
        }),
        prisma.visit.create({ data: { visitorId, path, referrer: referrer?.slice(0, 300) } }),
      ]);
      counted = true;
    }
  } catch (err) {
    console.error("[track] visit failed", err);
  }

  const res = NextResponse.json({ counted });
  res.cookies.set(SESSION_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_WINDOW_S });
  return res;
}
