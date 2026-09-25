import { NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES, detectKind, extractText } from "@/lib/resume/extract";
import { structureResumeText } from "@/lib/resume/engine";
import { trackToolEvent } from "@/lib/tracking";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!rateLimit(`parse:${clientIp(req)}`, 15, 60 * 60_000).ok)
    return NextResponse.json({ error: "Upload limit reached, try again later." }, { status: 429 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "File must be 5 MB or smaller" }, { status: 413 });
  const kind = detectKind(file);
  if (!kind) return NextResponse.json({ error: "Upload a PDF or Word (.docx) file" }, { status: 415 });

  try {
    const text = (await extractText(file)).trim();
    if (text.length < 50)
      return NextResponse.json(
        { error: "We couldn't read text from this file. If it's a scanned PDF, try the Word version or fill the form." },
        { status: 422 },
      );
    const { resume, source } = await structureResumeText(text);
    await trackToolEvent({ tool: "resume-buddy", action: "parse_upload", metadata: { kind, source } });
    return NextResponse.json({ resume, source });
  } catch (err) {
    console.error("[parse]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not parse file" }, { status: 422 });
  }
}
