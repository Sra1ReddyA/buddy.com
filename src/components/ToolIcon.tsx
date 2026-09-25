import type { Tool } from "@/lib/tools";

const paths: Record<Tool["icon"], React.ReactNode> = {
  resume: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  law: (
    <>
      <path d="M12 3v18M8 21h8M5 7h14M12 5l-7 2M12 5l7 2" />
      <path d="M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z" />
    </>
  ),
  gym: <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />,
  pdf2word: (
    <>
      <path d="M4 4h7v7H4zM13 13h7v7h-7z" />
      <path d="M15 4h3a2 2 0 0 1 2 2v3M9 20H6a2 2 0 0 1-2-2v-3" />
      <path d="m18 7 2 2 2-2M2 17l2-2 2 2" />
    </>
  ),
  word2pdf: (
    <>
      <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10z" />
      <path d="M13 3v7h7M8 14l2 4 2-4 2 4 2-4" />
    </>
  ),
};

export function ToolIcon({ icon, className = "h-6 w-6" }: { icon: Tool["icon"]; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {paths[icon]}
    </svg>
  );
}
