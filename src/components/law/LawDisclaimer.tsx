export const DISCLAIMER = "Law Buddy is an AI research tool and does not provide formal legal advice. Please consult a licensed attorney.";

export function LawDisclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <div role="note" aria-label="Legal disclaimer" className={`flex gap-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 ${compact ? "p-3 text-xs" : "p-4 text-sm"}`}>
      <svg viewBox="0 0 24 24" className={`${compact ? "h-4 w-4" : "h-5 w-5"} mt-0.5 shrink-0`} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      </svg>
      <p>
        <strong className="font-semibold">Disclaimer: </strong>
        {DISCLAIMER}
      </p>
    </div>
  );
}
