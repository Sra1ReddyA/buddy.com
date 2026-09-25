import type { Metadata } from "next";
import { LoginForm } from "@/components/admin/LoginForm";

export const metadata: Metadata = { title: "Admin sign in", robots: { index: false, follow: false } };

export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next?.startsWith("/admin") ? next : "/admin";
  return (
    <div className="grid min-h-[70vh] place-items-center px-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold">Admin sign in</h1>
        <p className="mt-1 text-sm text-slate-500">Buddy analytics dashboard</p>
        <LoginForm next={safeNext} />
      </div>
    </div>
  );
}
