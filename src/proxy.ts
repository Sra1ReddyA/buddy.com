// Next.js 16 "proxy" (formerly middleware):
//  1. Gives every browser a stable anonymous visitor id cookie (for unique-visitor counts).
//  2. Protects /admin/* behind the admin session cookie.
import { NextResponse, type NextRequest } from "next/server";
import { verifyAdminToken } from "@/lib/auth-edge";

const VISITOR_COOKIE = "buddy_vid";
const ADMIN_COOKIE = "buddy_admin";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const ok = await verifyAdminToken(req.cookies.get(ADMIN_COOKIE)?.value);
    if (!ok) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  const res = NextResponse.next();
  if (!req.cookies.get(VISITOR_COOKIE)) {
    res.cookies.set(VISITOR_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  // Admin pages must never be cached or indexed
  if (pathname.startsWith("/admin")) res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export const config = {
  // skip static assets, images and SEO files
  matcher: ["/((?!_next/static|_next/image|fonts/|favicon.ico|icon.svg|robots.txt|sitemap.xml|opengraph-image).*)"],
};
