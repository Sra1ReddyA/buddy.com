"use client";
import { useState } from "react";

const LABELS = ["", "Poor", "Fair", "Good", "Great", "Excellent"];

/**
 * Accessible 1–5 star rating.
 * - Behaves as a radiogroup: arrow keys move, Home/End jump, number keys 1–5 select.
 * - Hover previews the rating; click commits.
 */
export function StarRating({
  value,
  onChange,
  size = "h-9 w-9",
  label = "Rate your experience",
}: {
  value: number;
  onChange: (v: number) => void;
  size?: string;
  label?: string;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;

  const onKey = (e: React.KeyboardEvent) => {
    let next = value;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(5, value + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, value - 1);
    else if (e.key === "Home") next = 1;
    else if (e.key === "End") next = 5;
    else if (/^[1-5]$/.test(e.key)) next = Number(e.key);
    else return;
    e.preventDefault();
    onChange(next);
    (e.currentTarget.querySelector(`[data-star="${next}"]`) as HTMLElement | null)?.focus();
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div role="radiogroup" aria-label={label} className="flex gap-1" onKeyDown={onKey} onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = n <= shown;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              data-star={n}
              aria-checked={value === n}
              aria-label={`${n} star${n > 1 ? "s" : ""} — ${LABELS[n]}`}
              tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(0)}
              onClick={() => onChange(n)}
              className="rounded-lg p-0.5 transition hover:scale-110 active:scale-95"
            >
              <svg viewBox="0 0 24 24" className={`${size} transition-colors ${active ? "fill-amber-400 text-amber-400" : "fill-transparent text-slate-300"}`} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
                <path d="m12 2.8 2.83 5.73 6.32.92-4.58 4.46 1.08 6.3L12 17.24l-5.65 2.97 1.08-6.3-4.58-4.46 6.32-.92z" />
              </svg>
            </button>
          );
        })}
      </div>
      <span className="h-5 text-sm font-medium text-slate-600" aria-live="polite">{LABELS[shown]}</span>
    </div>
  );
}
