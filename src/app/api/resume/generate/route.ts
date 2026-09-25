import { NextResponse } from "next/server";
import { GenerateRequestSchema } from "@/lib/resume/types";
import { generateOptimizedResume } from "@/lib/resume/engine";
import { trackToolEvent } from "@/lib/tracking";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const rl = rateLimit(`gen:${clientIp(req)}`, 20, 60 * 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Generation limit reached, try again later." }, { status: 429 });

  const parsed = GenerateRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid resume data", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  if (!parsed.data.resume.contact.fullName && !parsed.data.resume.experience.some((e) => e.company || e.role))
    return NextResponse.json({ error: "Add at least your name and one role before generating." }, { status: 400 });

  try {
    const result = await generateOptimizedResume(parsed.data);
    await trackToolEvent({
      tool: "resume-buddy",
      action: "generate",
      template: parsed.data.template,
      metadata: { source: result.source, repaired: result.repairedBullets, hasCustomRules: !!parsed.data.customRules },
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[generate]", err);
    return NextResponse.json({ error: "The optimizer is busy right now. Please try again in a moment." }, { status: 502 });
  }
}
