"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** Pings the visit endpoint once per page load; the server decides whether it's a new visit. */
export function VisitTracker() {
  const pathname = usePathname();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || pathname.startsWith("/admin")) return;
    sent.current = true;
    fetch("/api/track/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname, referrer: document.referrer || undefined }),
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);
  return null;
}
