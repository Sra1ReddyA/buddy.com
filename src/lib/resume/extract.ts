import "server-only";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function detectKind(file: File): "pdf" | "docx" | null {
  const name = file.name.toLowerCase();
  if (file.type === PDF || name.endsWith(".pdf")) return "pdf";
  if (file.type === DOCX || name.endsWith(".docx")) return "docx";
  return null;
}

/** Extract plain text from an uploaded PDF or DOCX, verifying magic bytes. */
export async function extractText(file: File): Promise<string> {
  const kind = detectKind(file);
  const buf = new Uint8Array(await file.arrayBuffer());

  if (kind === "pdf") {
    if (String.fromCharCode(...buf.slice(0, 4)) !== "%PDF") throw new Error("File is not a valid PDF");
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(buf);
    const { text } = await pdfText(pdf, { mergePages: true });
    return text;
  }
  if (kind === "docx") {
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("File is not a valid .docx");
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
    return value;
  }
  throw new Error("Unsupported file type. Upload a PDF or .docx file.");
}
