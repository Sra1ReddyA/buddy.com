import { JsonLd } from "../JsonLd";
import { Converter } from "./Converter";
import { breadcrumbLd, faqLd, howToLd, softwareAppLd } from "@/lib/seo";

type Props = {
  mode: "pdf-to-word" | "word-to-pdf";
  title: string;
  intro: string;
  steps: string[];
  features: { title: string; body: string }[];
  faqs: { q: string; a: string }[];
  keywords: string[];
  appName: string;
  path: string;
};

export function ConverterPage({ mode, title, intro, steps, features, faqs, keywords, appName, path }: Props) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
      <JsonLd
        data={[
          softwareAppLd({ name: appName, description: intro, path, category: "UtilitiesApplication", keywords }),
          howToLd(title, steps),
          faqLd(faqs),
          breadcrumbLd([{ name: "Home", path: "/" }, { name: appName, path }]),
        ]}
      />
      <header className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 text-lg text-slate-600">{intro}</p>
      </header>

      <div className="mt-8">
        <Converter mode={mode} />
      </div>

      <section className="mx-auto mt-16 max-w-3xl">
        <h2 className="text-xl font-semibold tracking-tight">How it works</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s} className="card p-4">
              <span className="text-xs font-semibold text-brand-600">Step {i + 1}</span>
              <p className="mt-1 text-sm text-slate-700">{s}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto mt-12 max-w-3xl">
        <h2 className="text-xl font-semibold tracking-tight">What’s preserved</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="font-medium">{f.title}</p>
              <p className="mt-1 text-sm text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-12 max-w-3xl">
        <h2 className="text-xl font-semibold tracking-tight">Frequently asked questions</h2>
        <div className="mt-4 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {faqs.map((f) => (
            <details key={f.q} className="group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
                {f.q}
                <span className="text-slate-400 transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm text-slate-600">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
