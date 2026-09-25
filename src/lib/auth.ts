import { SignJWT } from "jose";
import { timingSafeEqual, createHash } from "node:crypto";

export const ADMIN_COOKIE = "buddy_admin";
const MAX_AGE = 60 * 60 * 8; // 8 hours

function secret() {
  const s = process.env.ADMIN_JWT_SECRET;
  if (!s || s.length < 32) throw new Error("ADMIN_JWT_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

/** Constant-time compare (hash first so lengths always match). */
function safeEqual(a: string, b: string) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkCredentials(username: string, password: string) {
  const u = process.env.ADMIN_USERNAME;
  const p = process.env.ADMIN_PASSWORD;
  if (!u || !p) return false;
  // evaluate both to avoid leaking which one failed via timing
  const okU = safeEqual(username, u);
  const okP = safeEqual(password, p);
  return okU && okP;
}

export async function createAdminToken(username: string) {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(username)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
}

export const adminCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: MAX_AGE,
};
