import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";
import { TOOLS } from "@/lib/tools";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    ...TOOLS.map((t) => ({
      url: `${SITE_URL}${t.href}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: t.active ? 0.9 : 0.6,
    })),
  ];
}
