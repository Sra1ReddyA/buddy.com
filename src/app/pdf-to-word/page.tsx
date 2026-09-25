import { ConverterPage } from "@/components/convert/ConverterPage";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Free PDF to Word Converter — Editable DOCX, Layout Kept",
  description:
    "Convert PDF to Word (DOCX) free, right in your browser. Forms keep their exact layout — boxes, tables and fields in place — and documents become editable paragraphs, lists and tables. No sign-up, no upload.",
  path: "/pdf-to-word",
  keywords: ["PDF to Word converter", "convert PDF to DOCX", "PDF to editable Word", "free PDF to Word", "PDF to Word online"],
});

export default function Page() {
  return (
    <ConverterPage
      mode="pdf-to-word"
      appName="PDF to Word Buddy"
      path="/pdf-to-word"
      title="PDF to Word converter"
      intro="Turn any PDF into an editable Word document. Forms and applications keep their exact page layout; letters and reports become real paragraphs, headings, lists and tables."
      keywords={["PDF to Word converter", "PDF to DOCX", "editable Word"]}
      steps={["Drop your PDF into the box (up to 50 MB).", "Click “Convert to Word”.", "Download your editable .docx file."]}
      features={[
        { title: "Exact form layout", body: "Forms, certificates and invoices keep every box, line, table and field in its original position — one Word page per PDF page." },
        { title: "Editable text", body: "Letters and reports become normal Word paragraphs that reflow when you type." },
        { title: "Headings & lists", body: "Titles become Word heading styles; bullets and numbering become real Word lists." },
        { title: "Tables & tab stops", body: "Column-aligned rows become Word tables; right-aligned dates and dot leaders become tab stops." },
        { title: "Images, links & more", body: "Images, hyperlinks, colours, section lines, headers/footers with page numbers and two-column pages." },
      ]}
      faqs={[
        { q: "Is this PDF to Word converter free?", a: "Yes. It’s free with no sign-up and no watermark." },
        { q: "Is my PDF uploaded to a server?", a: "No. The conversion runs entirely in your browser, so your file never leaves your device." },
        { q: "Will the Word file be editable?", a: "Yes. Documents become real Word paragraphs, heading styles, lists and tables. Forms keep their exact layout: ruled grids become real Word tables, and the other text is placed exactly where it is on the PDF page, still editable." },
        { q: "Will a form (like an I-20 or an application) look the same?", a: "Yes. In Auto mode, pages that look like forms keep their exact geometry: boxes, lines, shaded bars, tables, field values, checkboxes and fonts stay in place, and each PDF page becomes exactly one Word page. You can also choose “Exact layout” or “Flowing text” before converting." },
        { q: "Can it convert scanned PDFs?", a: "Scanned PDFs are images without a text layer. They’re placed into Word as images; editable text from scans (OCR) isn’t supported yet." },
        { q: "Are password-protected PDFs supported?", a: "Remove the password first (for example by printing to a new PDF), then convert." },
      ]}
    />
  );
}
