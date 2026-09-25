import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getVisitorId } from "@/lib/tracking";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { TEMPLATE_IDS } from "@/lib/resume/types";

const Body = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
  template: z.enum(TEMPLATE_IDS).optional(),
  format: z.enum(["pdf", "docx"]).optional(),
  tool: z.enum(["resume-buddy", "pdf-to-word", "word-to-pdf"]).default("resume-buddy"),
});

export async function POST(req: Request) {
  if (!rateLimit(`feedback:${clientIp(req)}`, 10, 60 * 60_000).ok)
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Rating must be a whole number from 1 to 5" }, { status: 400 });

  const visitorId = await getVisitorId();
  try {
    const known = visitorId ? await prisma.visitor.findUnique({ where: { id: visitorId }, select: { id: true } }) : null;
    const review = await prisma.review.create({
      data: { ...parsed.data, comment: parsed.data.comment || null, visitorId: known ? visitorId : null },
      select: { id: true },
    });
    return NextResponse.json({ ok: true, id: review.id });
  } catch (err) {
    console.error("[feedback] failed", err);
    return NextResponse.json({ error: "Could not save feedback" }, { status: 500 });
  }
}
