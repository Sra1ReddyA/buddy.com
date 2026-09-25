import { ImageResponse } from "next/og";

export const alt = "Buddy — Free resume maker and optimized resume generator";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OG() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "linear-gradient(135deg,#eef2ff 0%,#ffffff 60%)", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 18, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontSize: 44, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>B</div>
          <div style={{ fontSize: 44, fontWeight: 700, color: "#0f172a" }}>Buddy</div>
        </div>
        <div style={{ marginTop: 40, fontSize: 64, fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>Free resume maker &amp; optimized resume generator</div>
        <div style={{ marginTop: 24, fontSize: 30, color: "#475569" }}>Full-Time · W2 · C2C templates — download PDF or editable Word</div>
      </div>
    ),
    size,
  );
}
