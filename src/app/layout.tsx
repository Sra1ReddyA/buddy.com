import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { SITE_NAME, SITE_URL, CORE_KEYWORDS, organizationLd, websiteLd } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";
import { VisitTracker } from "@/components/VisitTracker";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Buddy — Free Resume Maker, Optimized Resume Generator & PDF to Word Converter",
    template: "%s | Buddy",
  },
  description:
    "Buddy is a free suite of productivity tools: an ATS-optimized resume maker (Full-Time, W2 and C2C templates), a PDF to Word converter and a Word to PDF converter — all in your browser.",
  applicationName: SITE_NAME,
  keywords: CORE_KEYWORDS,
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", url: SITE_URL },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: SITE_URL },
  category: "productivity",
};

export const viewport: Viewport = { themeColor: "#4f46e5", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen font-sans">
        <JsonLd data={[organizationLd(), websiteLd()]} />
        <VisitTracker />
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
