import "server-only";
import { cookies } from "next/headers";
import { prisma } from "./prisma";

export const VISITOR_COOKIE = "buddy_vid";
export const SESSION_COOKIE = "buddy_session";
export const SESSION_WINDOW_S = 30 * 60;

export const TRACKED_ACTIONS = [
  "open",
  "coming_soon_click",
  "upload",
  "parse_upload",
  "generate",
  "convert",
  "convert_failed",
  "search",
  "search_failed",
  "load_more",
  "download_pdf",
  "download_docx",
] as const;
export type TrackedAction = (typeof TRACKED_ACTIONS)[number];

export async function getVisitorId(): Promise<string | null> {
  return (await cookies()).get(VISITOR_COOKIE)?.value ?? null;
}

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|preview|lighthouse|headless|curl|wget/i;
export const isBot = (ua: string | null) => !ua || BOT_UA.test(ua);

/** Record a tool event. Never throws — analytics must not break the product. */
export async function trackToolEvent(input: {
  tool: string;
  action: TrackedAction;
  template?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    const visitorId = await getVisitorId();
    const visitorExists = visitorId ? await prisma.visitor.findUnique({ where: { id: visitorId }, select: { id: true } }) : null;
    await prisma.toolUsageEvent.create({
      data: {
        tool: input.tool,
        action: input.action,
        template: input.template ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata).slice(0, 2000) : null,
        visitorId: visitorExists ? visitorId : null,
      },
    });
  } catch (err) {
    console.error("[track] tool event failed", err);
  }
}
