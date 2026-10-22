import Link from "next/link";
import { SparkIcon } from "@/components/icons";
import { createJobAction, quickAddAction } from "@/lib/actions";
import { STAGES, STAGE_LABEL } from "@/lib/types";

export default function NewRolePage() {
  return (
    <div className="flex max-w-4xl flex-col gap-5 px-4 py-5 md:px-8 md:py-7">
      <div className="text-[13px] text-muted">
        <Link href="/" className="btn-link">
          Roles
        </Link>{" "}
        / New role
      </div>
      <h1 className="text-4xl leading-none font-semibold tracking-[-0.035em]">Add a role</h1>

      <form action={quickAddAction} className="glass flex flex-col gap-4 rounded-xl p-5">
        <div className="flex items-center gap-2">
          <SparkIcon size={16} className="text-accent" />
          <h2 className="text-[15px] font-semibold">Quick add</h2>
          <span className="text-[13px] text-muted">Give whatever you have. Claude fills in the rest.</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="jd" className="label">
            Job ad or details
          </label>
          <textarea
            id="jd"
            name="jd"
            rows={8}
            className="input font-sans"
            placeholder="Paste the job description, a recruiter’s message, or your own notes about the role…"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Job ad link" name="jobUrl" scope="quick" placeholder="https://jobs.lever.co/…" />
          <Field label="Careers page" name="careersUrl" scope="quick" placeholder="https://company.com/careers" />
          <Field label="Company website" name="website" scope="quick" placeholder="company.com" />
          <Field label="Company" name="company" scope="quick" placeholder="Worked out from the links if blank" />
          <div className="md:col-span-2">
            <Field label="Role" name="title" scope="quick" placeholder="Worked out from the job ad if blank" />
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-white/8 bg-white/4 p-3 text-sm">
          <input type="checkbox" name="research" defaultChecked className="mt-0.5 size-4 accent-[#6E8BFF]" />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">Ask Claude to research it</span>
            <span className="text-[13px] text-muted">
              Claude reads the ad and links, looks up the company (funding, size, local presence), and fills comp, segment, territory, team,
              highlights and flags with sources. Runs when you ask Claude to <span className="text-fg-2">“process my Pursuit queue”</span>, on your
              subscription.
            </span>
          </span>
        </label>

        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary">
            Add role
          </button>
          <Link href="/" className="btn btn-ghost">
            Cancel
          </Link>
        </div>
      </form>

      <details className="glass rounded-xl p-5 [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer text-[15px] font-semibold">
          Or fill everything in yourself <span className="text-[13px] font-normal text-muted">(expand)</span>
        </summary>
        <form action={createJobAction} className="mt-4 flex flex-col gap-5">
          <Section title="The role">
            <Field label="Company" name="company" required placeholder="e.g. Cortexa" />
            <Field label="Company website" name="domain" placeholder="cortexa.com" />
            <Field label="Title" name="title" required placeholder="Enterprise Account Executive" wide />
            <Field label="Job link" name="url" placeholder="https://…" wide />
            <Field label="Location" name="location" placeholder="Sydney, hybrid" />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="stage" className="label">
                Stage
              </label>
              <select id="stage" name="stage" className="input" defaultValue="found">
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          </Section>

          <Section title="Comp and territory (amounts in thousands, AUD)">
            <Field label="Base (k)" name="base_k" inputMode="decimal" placeholder="150" />
            <Field label="Variable (k)" name="variable_k" inputMode="decimal" placeholder="150" />
            <Field label="Quota (k)" name="quota_k" inputMode="decimal" placeholder="1200" />
            <Field label="Equity" name="equity" />
            <Field label="Segment" name="segment" placeholder="Enterprise" />
            <Field label="Territory" name="territory" placeholder="NSW + VIC" />
            <Field label="Team" name="team_size" placeholder="6 AEs · 2 SEs" />
            <Field label="Average deal size" name="acv" placeholder="A$80–120k" />
          </Section>

          <Section title="Your view">
            <Field label="Your rank" name="rank" inputMode="numeric" />
            <Field label="Fit score (0–100)" name="fit" inputMode="numeric" />
            <div className="col-span-2 flex flex-col gap-1.5">
              <label htmlFor="note" className="label">
                First note
              </label>
              <textarea id="note" name="note" rows={3} className="input" placeholder="Why it’s interesting, who referred you…" />
            </div>
          </Section>

          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary">
              Add role
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid grid-cols-2 gap-4 rounded-xl border border-white/8 p-4">
      <legend className="sr-only">{title}</legend>
      <h3 className="col-span-2 text-sm font-semibold">{title}</h3>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  name,
  wide,
  scope = "manual",
  ...rest
}: { label: string; name: string; wide?: boolean; scope?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  // Both forms on this page have "company" and "title" fields; keep ids unique.
  const id = `${scope}-${name}`;
  return (
    <div className={`flex flex-col gap-1.5 ${wide ? "col-span-2" : ""}`}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input id={id} name={name} className="input" autoComplete="off" {...rest} />
    </div>
  );
}
