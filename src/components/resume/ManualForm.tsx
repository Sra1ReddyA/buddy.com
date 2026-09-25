"use client";
import {
  emptyEducation,
  emptyExperience,
  emptyProject,
  emptySkillGroup,
  type Education,
  type Experience,
  type Project,
  type ResumeData,
  type SkillGroup,
} from "@/lib/resume/types";

type Props = { value: ResumeData; onChange: (r: ResumeData) => void };

function Field({
  label, value, onChange, placeholder, type = "text", className = "",
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; className?: string }) {
  return (
    <label className={className}>
      <span className="label">{label}</span>
      <input className="input" type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Section({ title, hint, children, action }: { title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {hint && <p className="text-sm text-slate-500">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function BulletsField({ value, onChange, label = "Bullet points (one per line)" }: { value: string[]; onChange: (b: string[]) => void; label?: string }) {
  return (
    <label className="block sm:col-span-2">
      <span className="label">{label}</span>
      <textarea
        className="input min-h-28 font-mono text-[13px] leading-relaxed"
        value={value.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n"))}
        placeholder={"Rough notes are fine — e.g.\nbuilt payments API in Node, cut latency 40%\nled migration to AWS for 3 services"}
      />
    </label>
  );
}

const RemoveBtn = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button type="button" onClick={onClick} className="text-xs font-medium text-slate-400 hover:text-rose-600" aria-label={label}>
    Remove
  </button>
);
const AddBtn = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} className="btn-secondary px-3 py-1.5 text-xs">+ {children}</button>
);

function updateAt<T>(arr: T[], i: number, patch: Partial<T>): T[] {
  return arr.map((x, j) => (j === i ? { ...x, ...patch } : x));
}

export function ManualForm({ value: r, onChange }: Props) {
  const set = (patch: Partial<ResumeData>) => onChange({ ...r, ...patch });
  const setContact = (k: keyof ResumeData["contact"]) => (v: string) => set({ contact: { ...r.contact, [k]: v } });
  const setExp = (i: number, p: Partial<Experience>) => set({ experience: updateAt(r.experience, i, p) });
  const setEdu = (i: number, p: Partial<Education>) => set({ education: updateAt(r.education, i, p) });
  const setProj = (i: number, p: Partial<Project>) => set({ projects: updateAt(r.projects, i, p) });
  const setSkill = (i: number, p: Partial<SkillGroup>) => set({ skills: updateAt(r.skills, i, p) });

  return (
    <div className="space-y-4">
      <Section title="Contact" hint="How recruiters reach you.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name *" value={r.contact.fullName} onChange={setContact("fullName")} placeholder="Jordan Lee" />
          <Field label="Headline / target title" value={r.contact.title} onChange={setContact("title")} placeholder="Senior Full-Stack Engineer" />
          <Field label="Email" type="email" value={r.contact.email} onChange={setContact("email")} placeholder="jordan@email.com" />
          <Field label="Phone" value={r.contact.phone} onChange={setContact("phone")} placeholder="(555) 123-4567" />
          <Field label="Location" value={r.contact.location} onChange={setContact("location")} placeholder="Austin, TX" />
          <Field label="LinkedIn" value={r.contact.linkedin} onChange={setContact("linkedin")} placeholder="linkedin.com/in/jordanlee" />
          <Field label="Website / GitHub" value={r.contact.website} onChange={setContact("website")} placeholder="github.com/jordanlee" className="sm:col-span-2" />
        </div>
      </Section>

      <Section title="Summary" hint="A few lines about you — we'll tighten it.">
        <textarea className="input min-h-24" value={r.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="8 years building web platforms in fintech..." />
      </Section>

      <Section title="Experience" hint="Most recent first." action={<AddBtn onClick={() => set({ experience: [...r.experience, emptyExperience()] })}>Add role</AddBtn>}>
        <div className="space-y-5">
          {r.experience.map((e, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Role {i + 1}</span>
                {r.experience.length > 1 && <RemoveBtn label={`Remove role ${i + 1}`} onClick={() => set({ experience: r.experience.filter((_, j) => j !== i) })} />}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Job title" value={e.role} onChange={(v) => setExp(i, { role: v })} placeholder="Software Engineer" />
                <Field label="Company / employer" value={e.company} onChange={(v) => setExp(i, { company: v })} placeholder="Acme Corp" />
                <Field label="End client (W2/C2C, optional)" value={e.client} onChange={(v) => setExp(i, { client: v })} placeholder="Bank of America" />
                <Field label="Location" value={e.location} onChange={(v) => setExp(i, { location: v })} placeholder="Remote" />
                <Field label="Start" value={e.startDate} onChange={(v) => setExp(i, { startDate: v })} placeholder="Jan 2022" />
                <Field label="End" value={e.endDate} onChange={(v) => setExp(i, { endDate: v })} placeholder="Present" />
                <BulletsField value={e.bullets} onChange={(b) => setExp(i, { bullets: b })} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Skills" hint="Group them; separate items with commas." action={<AddBtn onClick={() => set({ skills: [...r.skills, emptySkillGroup()] })}>Add group</AddBtn>}>
        <div className="space-y-3">
          {r.skills.map((s, i) => (
            <div key={i} className="grid items-end gap-3 sm:grid-cols-[180px_1fr_auto]">
              <Field label="Category" value={s.category} onChange={(v) => setSkill(i, { category: v })} placeholder="Languages" />
              <label>
                <span className="label">Skills</span>
                <input className="input" value={s.items.join(",")} onChange={(e) => setSkill(i, { items: e.target.value.split(",") })} placeholder="TypeScript, Python, Go" />
              </label>
              <RemoveBtn label={`Remove skill group ${i + 1}`} onClick={() => set({ skills: r.skills.filter((_, j) => j !== i) })} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Projects" hint="Optional — side projects, open source, key deliverables." action={<AddBtn onClick={() => set({ projects: [...r.projects, emptyProject()] })}>Add project</AddBtn>}>
        {r.projects.length === 0 && <p className="text-sm text-slate-500">No projects yet.</p>}
        <div className="space-y-5">
          {r.projects.map((p, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="mb-3 flex justify-end">
                <RemoveBtn label={`Remove project ${i + 1}`} onClick={() => set({ projects: r.projects.filter((_, j) => j !== i) })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Project name" value={p.name} onChange={(v) => setProj(i, { name: v })} placeholder="Realtime fraud dashboard" />
                <Field label="Tech stack" value={p.tech} onChange={(v) => setProj(i, { tech: v })} placeholder="Next.js, Kafka, Postgres" />
                <Field label="Link" value={p.link} onChange={(v) => setProj(i, { link: v })} placeholder="github.com/you/project" className="sm:col-span-2" />
                <BulletsField value={p.bullets} onChange={(b) => setProj(i, { bullets: b })} label="Highlights (one per line)" />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Education" action={<AddBtn onClick={() => set({ education: [...r.education, emptyEducation()] })}>Add education</AddBtn>}>
        <div className="space-y-4">
          {r.education.map((e, i) => (
            <div key={i} className="grid gap-3 sm:grid-cols-2">
              <Field label="School" value={e.school} onChange={(v) => setEdu(i, { school: v })} placeholder="University of Texas" />
              <Field label="Degree" value={e.degree} onChange={(v) => setEdu(i, { degree: v })} placeholder="B.S." />
              <Field label="Field of study" value={e.field} onChange={(v) => setEdu(i, { field: v })} placeholder="Computer Science" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start" value={e.startDate} onChange={(v) => setEdu(i, { startDate: v })} placeholder="2014" />
                <Field label="End" value={e.endDate} onChange={(v) => setEdu(i, { endDate: v })} placeholder="2018" />
              </div>
              <Field label="Details (GPA, honors)" value={e.details} onChange={(v) => setEdu(i, { details: v })} className="sm:col-span-2" />
              {r.education.length > 1 && (
                <div className="sm:col-span-2"><RemoveBtn label={`Remove education ${i + 1}`} onClick={() => set({ education: r.education.filter((_, j) => j !== i) })} /></div>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Certifications" hint="One per line (optional).">
        <textarea
          className="input min-h-20"
          value={r.certifications.join("\n")}
          onChange={(e) => set({ certifications: e.target.value.split("\n") })}
          placeholder="AWS Certified Solutions Architect – Associate"
        />
      </Section>
    </div>
  );
}
