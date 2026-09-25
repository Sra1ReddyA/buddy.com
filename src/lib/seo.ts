import type { Metadata } from "next";
import { TOOLS } from "./tools";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
export const SITE_NAME = "Buddy";

export const CORE_KEYWORDS = [
  "resume maker",
  "optimized resume generator",
  "PDF to Word converter",
  "Word to PDF converter",
  "ATS resume builder",
  "free resume builder",
  "AI resume optimizer",
  "W2 resume template",
  "C2C resume template",
  "resume to Word",
];

export function pageMetadata(opts: {
  title: string;
  description: string;
  path: string;
  keywords?: string[];
}): Metadata {
  const url = `${SITE_URL}${opts.path}`;
  return {
    title: opts.title,
    description: opts.description,
    keywords: [...(opts.keywords ?? []), ...CORE_KEYWORDS],
    alternates: { canonical: url },
    openGraph: { title: opts.title, description: opts.description, url, siteName: SITE_NAME, type: "website", locale: "en_US" },
    twitter: { card: "summary_large_image", title: opts.title, description: opts.description },
  };
}

// ---------- JSON-LD builders ----------
export const organizationLd = () => ({
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/icon.svg`,
});

export const websiteLd = () => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
  description: "Free productivity tools: optimized resume generator, PDF to Word converter, Word to PDF converter and more.",
});

export const toolsItemListLd = () => ({
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Buddy productivity tools",
  itemListElement: TOOLS.map((t, i) => ({
    "@type": "ListItem",
    position: i + 1,
    url: `${SITE_URL}${t.href}`,
    name: t.name,
  })),
});

export const softwareAppLd = (opts: { name: string; description: string; path: string; category?: string; keywords: string[] }) => ({
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: opts.name,
  url: `${SITE_URL}${opts.path}`,
  description: opts.description,
  applicationCategory: opts.category ?? "BusinessApplication",
  operatingSystem: "Any (web browser)",
  browserRequirements: "Requires JavaScript",
  keywords: opts.keywords.join(", "),
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
});

export const faqLd = (faqs: { q: string; a: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});

export const breadcrumbLd = (items: { name: string; path: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: `${SITE_URL}${it.path}` })),
});

export const howToLd = (name: string, steps: string[]) => ({
  "@context": "https://schema.org",
  "@type": "HowTo",
  name,
  step: steps.map((s, i) => ({ "@type": "HowToStep", position: i + 1, text: s })),
});
