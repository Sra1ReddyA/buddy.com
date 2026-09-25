// Token verification only — safe to import from proxy.ts (no node:crypto).
import { jwtVerify } from "jose";

export async function verifyAdminToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const s = process.env.ADMIN_JWT_SECRET;
  if (!s || s.length < 32) return false;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(s), { algorithms: ["HS256"] });
    return payload.role === "admin";
  } catch {
    return false;
  }
}
