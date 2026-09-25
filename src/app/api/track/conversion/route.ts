import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getVisitorId, trackToolEvent } from "@/lib/tracking";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const Body = z.object({
  tool: z.enum(["pdf-to-word", "word-to-pdf"]),
  status: z.enum(["success", "failed"]),
  inputBytes: z.number().int().min(0).max(2_000_000_000),
  outputBytes: z.number().int().min(0).max(2_000_000_000).optional(),
  pages: z.number().int().min(0).max(100_000).optional(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
  errorCode: z.string().max(40).regex(/^[a-z0-9_]+$/).optional(),
});

/** Records one conversion (metrics only) + the matching tool usage event. */
export async function POST(req: Request) {
  if (!rateLimit(`conv:${clientIp(req)}`, 60, 60_000).ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid conversion report" }, { status: 400 });
  const d = parsed.data;
  try {
    const visitorId = await getVisitorId();
    const known = visitorId ? await prisma.visitor.findUnique({ where: { id: visitorId }, select: { id: true } }) : null;
    await prisma.conversion.create({ data: { ...d, visitorId: known ? visitorId : null } });
  } catch (err) {
    console.error("[track] conversion failed", err);
  }
  await trackToolEvent({ tool: d.tool, action: d.status === "success" ? "convert" : "convert_failed", metadata: { pages: d.pages, bytes: d.inputBytes } });
  return NextResponse.json({ ok: true });
}
