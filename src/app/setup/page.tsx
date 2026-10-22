import Link from "next/link";
import { ImapConnect } from "@/components/ImapConnect";
import { SubmitButton } from "@/components/SubmitButton";
import { finishSetupAction, saveApiKeyAction, saveProfileAction, setupResumeAction, setupStoryAction } from "@/lib/actions";
import { isAiConfigured } from "@/lib/ai/client";
import { connectedAccount as microsoftAccount, isMicrosoftConfigured } from "@/lib/microsoft/auth";
import { getResume } from "@/lib/prep";
import { getProfile } from "@/lib/profile";
import { getDraft, SETUP_STEPS, type SetupStep } from "@/lib/setup";
import { listStars } from "@/lib/star";

export const dynamic = "force-dynamic";

const TITLES: Record<SetupStep, string> = {
  welcome: "Welcome to Pursuit",
  claude: "Connect Claude",
  resume: "Your resume",
  profile: "What you're looking for",
  story: "Your story",
  stories: "Your first stories",
  email: "Your inbox",
};

export default async function SetupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const step: SetupStep = (SETUP_STEPS as readonly string[]).includes(params.step ?? "") ? (params.step as SetupStep) : "welcome";
  const index = SETUP_STEPS.indexOf(step);
  const prev = index > 0 ? SETUP_STEPS[index - 1] : null;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-8 md:py-14">
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG */}
      <img src="/brand/pursuit-lockup-dark.svg" alt="Pursuit" width={123} height={34} className="h-[34px] w-auto self-start" />
      {step !== "welcome" && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-faint">
            Step {index} of {SETUP_STEPS.length - 1}
          </span>
          <div className="h-1 overflow-hidden rounded-full bg-white/8" aria-hidden="true">
            <div className="h-full rounded-full bg-[#6E8BFF]" style={{ width: `${(index / (SETUP_STEPS.length - 1)) * 100}%` }} />
          </div>
        </div>
      )}
      <h1 className="text-3xl leading-tight font-semibold tracking-[-0.03em]">{TITLES[step]}</h1>
      {params.error && (
        <div role="alert" className="rounded-xl border border-red/35 bg-red/10 px-4 py-3 text-sm text-[#FFB3BA]">
          {params.error}
        </div>
      )}
      <section className="glass flex flex-col gap-4 rounded-xl p-5">
        <Step step={step} />
      </section>
      {prev && (
        <Link href={`/setup?step=${prev}`} className="btn-link self-start">
          ← Back
        </Link>
      )}
    </div>
  );
}

function Step({ step }: { step: SetupStep }) {
  switch (step) {
    case "welcome":
      return <Welcome />;
    case "claude":
      return <ClaudeStep />;
    case "resume":
      return <ResumeStep />;
    case "profile":
      return <ProfileStep />;
    case "story":
      return <StoryStep />;
    case "stories":
      return <StoriesStep />;
    case "email":
      return <EmailStep />;
  }
}

function Welcome() {
  return (
    <>
      <p className="text-sm text-fg-2">Pursuit keeps your whole job search in one place and helps you prepare for every interview. Setup takes about five minutes:</p>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-fg-2">
        <li>Connect Claude, the AI that reads, researches and prepares for you.</li>
        <li>Add your resume. Claude drafts your profile from it.</li>
        <li>Say what you're looking for.</li>
        <li>Answer a few questions so Claude can draft your interview stories.</li>
      </ol>
      <p className="text-[13px] text-muted">Everything stays on this computer. You can change any of it later in Settings.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/setup?step=claude" className="btn btn-primary">
          Start setup
        </Link>
        <form action={finishSetupAction}>
          <input type="hidden" name="demo" value="1" />
          <SubmitButton className="btn btn-ghost" pending="Loading demo…">
            Look around with demo data first
          </SubmitButton>
        </form>
      </div>
    </>
  );
}

function ClaudeStep() {
  if (isAiConfigured()) {
    return (
      <>
        <p className="text-sm text-fg-2">Claude is connected.</p>
        <Link href="/setup?step=resume" className="btn btn-primary self-start">
          Continue
        </Link>
      </>
    );
  }
  return (
    <>
      <p className="text-sm text-fg-2">
        Pursuit uses Claude to read your resume and job emails, research roles and prepare you for interviews. It needs an Anthropic API key; usage is billed by
        Anthropic to your own account.
      </p>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px] text-fg-2">
        <li>
          Go to{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="btn-link">
            console.anthropic.com → API keys
          </a>{" "}
          and sign in (or sign up).
        </li>
        <li>Add a payment method or credits under Billing.</li>
        <li>Create a key, copy it, and paste it here.</li>
      </ol>
      <form action={saveApiKeyAction} className="flex flex-col gap-3">
        <input type="hidden" name="next" value="setup" />
        <label htmlFor="setup-key" className="label">
          API key
        </label>
        <input id="setup-key" name="key" type="password" className="input" placeholder="sk-ant-…" autoComplete="off" required />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pending="Checking the key…">Save and continue</SubmitButton>
          <Link href="/setup?step=resume" className="btn-link">
            Skip for now
          </Link>
        </div>
      </form>
      <p className="text-xs text-faint">The key is kept in Pursuit's database on this computer and only sent to Anthropic.</p>
    </>
  );
}

function ResumeStep() {
  const ai = isAiConfigured();
  const resume = getResume();
  return (
    <form action={setupResumeAction} className="flex flex-col gap-4">
      <p className="text-sm text-fg-2">
        {ai
          ? "Claude reads your resume to draft your profile and interview stories. Choose the PDF, or paste the text."
          : "Paste your resume text. Without Claude connected you'll fill in your profile yourself on the next step."}
      </p>
      {ai && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="setup-resume" className="label">
            Resume PDF
          </label>
          <input id="setup-resume" name="resume" type="file" accept="application/pdf,.pdf" className="text-sm text-fg-2" />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="setup-text" className="label">
          {ai ? "Or paste the text" : "Resume text"}
        </label>
        <textarea id="setup-text" name="text" rows={8} className="input" defaultValue={resume.text} placeholder="Paste your resume here" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending={ai ? "Claude is reading your resume… (up to a minute)" : "Saving…"}>{ai ? "Read my resume" : "Save and continue"}</SubmitButton>
        <Link href="/setup?step=profile" className="btn-link">
          Skip
        </Link>
      </div>
    </form>
  );
}

function ProfileStep() {
  const p = getProfile();
  return (
    <form action={saveProfileAction} className="flex flex-col gap-3">
      <input type="hidden" name="next" value="setup" />
      <p className="text-sm text-fg-2">{p.name ? "Here's what Claude found. Check it and fill any gaps." : "Tell Pursuit about you and the role you want."}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" name="name" value={p.name} placeholder="Sam Taylor" />
        <Field label="Location" name="location" value={p.location} placeholder="Sydney, Australia" />
        <Field label="How you'd describe yourself" name="headline" value={p.headline} placeholder="an experienced Account Executive" />
        <Field label="Region or market" name="region" value={p.region} placeholder="ANZ" />
        <Field label="Roles you want" name="targetRoles" value={p.targetRoles} placeholder="Enterprise Account Executive, SaaS" />
        <Field label="Currency" name="currency" value={p.currency} placeholder="A$" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="setup-pack" className="label">
          Kind of role
        </label>
        <select id="setup-pack" name="pack" defaultValue={p.pack} className="input">
          <option value="sales">Sales (quota, deal size, territory)</option>
          <option value="general">General</option>
        </select>
      </div>
      <Area label="What makes a role right for you" name="wants" value={p.wants} placeholder="e.g. Senior IC, $180k+ base, Series B or later, hybrid" />
      <Area label="Deal-breakers" name="avoid" value={p.avoid} placeholder="e.g. Fully in-office, crypto, no clear territory" />
      <div>
        <SubmitButton pending="Saving…">Continue</SubmitButton>
      </div>
    </form>
  );
}

function StoryStep() {
  const ai = isAiConfigured();
  const draft = getDraft();
  const p = getProfile();
  const questions = ai ? draft.questions : [];
  return (
    <form action={setupStoryAction} className="flex flex-col gap-4">
      <p className="text-sm text-fg-2">
        {questions.length
          ? "Interviewers dig into your story. Answer what you can (short notes are fine) and Claude drafts your first STAR stories from your resume and these answers."
          : "Interviewers dig into your story. Note anything they're likely to probe, and how you explain it."}
      </p>
      {questions.map((q, i) => (
        <div key={q} className="flex flex-col gap-1.5">
          <label htmlFor={`setup-q-${i}`} className="text-sm font-medium">
            {q}
          </label>
          <textarea id={`setup-q-${i}`} name="answer" rows={3} className="input" defaultValue={draft.answers[i] ?? ""} />
        </div>
      ))}
      <Area
        label="Anything to handle with care"
        name="careerNotes"
        value={p.careerNotes}
        placeholder="e.g. Made redundant in a global restructure in March, not for performance. Say it in one line and move on."
      />
      <div>
        <SubmitButton pending="Claude is drafting your stories… (about a minute)">{questions.length ? "Draft my stories" : "Continue"}</SubmitButton>
      </div>
    </form>
  );
}

function StoriesStep() {
  const stories = listStars();
  return (
    <>
      {stories.length ? (
        <>
          <p className="text-sm text-fg-2">
            Claude drafted {stories.length} {stories.length === 1 ? "story" : "stories"}. Anything marked [add: …] needs a detail only you know. Polish them any time in
            the Prep library.
          </p>
          <ul className="flex flex-col gap-2">
            {stories.map((s) => (
              <li key={s.id} className="rounded-lg border border-white/8 bg-white/4 p-3">
                <div className="text-sm font-medium">{s.title}</div>
                {s.competencies.length > 0 && <div className="text-xs text-faint">{s.competencies.join(" · ")}</div>}
                {s.result && <div className="mt-1 line-clamp-2 text-[13px] text-fg-2">{s.result}</div>}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-fg-2">No stories yet. You can write them in the Prep library, and Claude will polish them once it's connected.</p>
      )}
      <Link href="/setup?step=email" className="btn btn-primary self-start">
        Continue
      </Link>
    </>
  );
}

function EmailStep() {
  const ms = isMicrosoftConfigured();
  const account = microsoftAccount();
  return (
    <>
      <p className="text-sm text-fg-2">
        Pursuit can watch your inbox for job emails (applications, interview invites, offers) and update your roles by itself. Access is read-only.
      </p>
      {account ? (
        <p className="text-sm text-fg-2">Connected to Outlook as {account.email}.</p>
      ) : ms ? (
        <a href="/api/microsoft/connect" className="btn btn-ghost self-start">
          Connect Outlook
        </a>
      ) : null}
      <ImapConnect next="setup" />
      <p className="text-[13px] text-muted">You can skip this and connect later in Settings.</p>
      <form action={finishSetupAction}>
        <SubmitButton pending="Finishing…">Finish setup</SubmitButton>
      </form>
    </>
  );
}

function Field({ label, name, value, placeholder }: { label: string; name: string; value: string; placeholder: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`setup-${name}`} className="label">
        {label}
      </label>
      <input id={`setup-${name}`} name={name} defaultValue={value} placeholder={placeholder} className="input" autoComplete="off" />
    </div>
  );
}

function Area({ label, name, value, placeholder }: { label: string; name: string; value: string; placeholder: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`setup-${name}`} className="label">
        {label}
      </label>
      <textarea id={`setup-${name}`} name={name} rows={2} className="input" defaultValue={value} placeholder={placeholder} />
    </div>
  );
}
