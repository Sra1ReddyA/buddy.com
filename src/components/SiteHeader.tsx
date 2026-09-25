import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-sm font-bold text-white">B</span>
          Buddy
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/#tools" className="btn-ghost px-3 py-1.5">Tools</Link>
          <Link href="/resume-buddy" className="btn-primary px-3 py-1.5">Build my resume</Link>
        </nav>
      </div>
    </header>
  );
}
