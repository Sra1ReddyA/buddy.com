import { NextResponse } from "next/server";
import { z } from "zod";
import { ADMIN_COOKIE, adminCookieOptions, checkCredentials, createAdminToken } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const Body = z.object({ username: z.string().max(100), password: z.string().max(200) });

export async function POST(req: Request) {
  const rl = rateLimit(`login:${clientIp(req)}`, 5, 15 * 60_000);
  if (!rl.ok)
    return NextResponse.json({ error: `Too many attempts. Try again in ${Math.ceil(rl.retryAfter / 60)} min.` }, { status: 429 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !checkCredentials(parsed.data.username, parsed.data.password)) {
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, await createAdminToken(parsed.data.username), adminCookieOptions);
  return res;
}
