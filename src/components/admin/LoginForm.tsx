"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: fd.get("username"), password: fd.get("password") }),
    });
    setBusy(false);
    if (res.ok) {
      router.replace(next);
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({}))).error || "Sign in failed");
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-3">
      <label className="block">
        <span className="label">Username</span>
        <input name="username" className="input" autoComplete="username" required />
      </label>
      <label className="block">
        <span className="label">Password</span>
        <input name="password" type="password" className="input" autoComplete="current-password" required />
      </label>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
