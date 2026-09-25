import { ConverterPage } from "@/components/convert/ConverterPage";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Free Word to PDF Converter — DOCX to PDF in Your Browser",
  description:
    "Convert Word (DOCX) to PDF free and instantly. Fonts, tables, images, lists, headers and page numbers are preserved, with selectable text. No sign-up, no upload.",
  path: "/word-to-pdf",
  keywords: ["Word to PDF converter", "DOCX to PDF", "convert Word to PDF free", "Word to PDF online"],
});

export default function Page() {
  return (
    <ConverterPage
      mode="word-to-pdf"
      appName="Word to PDF Converter Buddy"
      path="/word-to-pdf"
      title="Word to PDF converter"
      intro="Turn a Word document (.docx) into a clean, shareable PDF with selectable text — laid out the way Word lays it out."
      keywords={["Word to PDF converter", "DOCX to PDF"]}
      steps={["Drop your .docx file into the box (up to 50 MB).", "Click “Convert to PDF”.", "Download your PDF."]}
      features={[
        { title: "Word-accurate fonts", body: "Calibri, Cambria, Arial, Times New Roman and Courier New are matched with metric-identical fonts, so lines wrap where Word wraps them." },
        { title: "Styles & lists", body: "Headings, bold/italic/underline, colours, bullets, numbering, indents, spacing and tab stops (including dot leaders)." },
        { title: "Tables & images", body: "Tables with merged cells, borders and shading; inline pictures; multi-column sections." },
        { title: "Headers, footers & links", body: "Headers and footers with “Page X of Y”, clickable hyperlinks, page size and margins from your document." },
      ]}
      faqs={[
        { q: "Is this Word to PDF converter free?", a: "Yes. It’s free with no sign-up and no watermark." },
        { q: "Is my document uploaded?", a: "No. Conversion happens in your browser; the document never leaves your device." },
        { q: "Does it support .doc files?", a: "It supports .docx. For an older .doc file, open it in Word and use “Save as” → .docx first." },
        { q: "What isn’t converted?", a: "Footnotes, comments, charts, SmartArt and EMF/WMF drawings aren’t rendered yet. Everything else in a typical document is." },
      ]}
    />
  );
}
