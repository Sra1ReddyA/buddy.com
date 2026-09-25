import { NextResponse } from "next/server";
import { z } from "zod";
import { TOOL_IDS } from "@/lib/tools";
import { TEMPLATE_IDS } from "@/lib/resume/types";
import { TRACKED_ACTIONS, trackToolEvent } from "@/lib/tracking";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// Client-reported events (tool opens, coming-soon clicks, downloads).
// "generate"/"parse_upload" are recorded by their own routes, "convert"/"convert_failed" by /api/track/conversion.
const Body = z.object({
  tool: z.enum(TOOL_IDS),
  action: z.enum(TRACKED_ACTIONS).refine((a) => !["generate", "parse_upload", "convert", "convert_failed", "search", "search_failed", "load_more"].includes(a)),
  template: z.enum(TEMPLATE_IDS).optional(),
});

export async function POST(req: Request) {
  if (!rateLimit(`usage:${clientIp(req)}`, 120, 60_000).ok)
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid event" }, { status: 400 });

  await trackToolEvent(parsed.data);
  return NextResponse.json({ ok: true });
}
