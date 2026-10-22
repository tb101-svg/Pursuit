import Link from "next/link";
import { redirect } from "next/navigation";
import { PlusIcon } from "@/components/icons";
import { RolesView } from "@/components/RolesView";
import { TodayStrip } from "@/components/TodayStrip";
import { Upcoming } from "@/components/Upcoming";
import { RefreshEmail } from "@/components/RefreshEmail";
import { loadDemoAction } from "@/lib/actions";
import { NeedsYou } from "@/components/NeedsYou";
import { ForClaude } from "@/components/ToRead";
import { listResearch, pendingResearchCount } from "@/lib/research";
import { listPrepQueue } from "@/lib/prep";
import { findClaude, lastRun } from "@/lib/claude-runner";
import { listPending, pendingCount } from "@/lib/mail/pipeline";
import { clock, dayFromNow, relTime, when } from "@/lib/format";
import { countJobs, listRoles, listToday, listUpcoming } from "@/lib/repo";
import { isSetupDone } from "@/lib/setup";
import { listOpenProposals } from "@/lib/sync/apply";
import { interviewStage, toCard } from "@/lib/view";

export const dynamic = "force-dynamic";

export default function RolesPage() {
  // First run: set up before anything else (existing users with roles skip it).
  if (!isSetupDone() && countJobs() === 0) redirect("/setup");
  const now = new Date();
  const roles = listRoles();
  const cards = [...roles]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((r) => toCard(r, now));
  const today = listToday().map((t) => ({ ...t, time: t.kind === "interview" ? clock(t.at) : null }));
  const upcoming = listUpcoming(now);
  const upcomingInterviews = upcoming.interviews.map((iv) => {
    const d = new Date(iv.at);
    const day = dayFromNow(iv.at, now);
    return {
      id: iv.id,
      jobId: iv.job_id,
      company: iv.company,
      role: iv.role,
      color: iv.color,
      logo: iv.logo,
      name: iv.title,
      isCall: iv.kind === "call",
      stage: iv.kind === "call" ? "Call" : interviewStage(iv.title, iv.round, iv.stage),
      weekday: d.toLocaleDateString("en-AU", { weekday: "short" }),
      dayNum: String(d.getDate()),
      month: d.toLocaleDateString("en-AU", { month: "short" }),
      time: clock(iv.at),
      day,
      soon: day === "Today" || day === "Tomorrow",
      detail: [iv.duration_min ? `${iv.duration_min} min` : null, iv.format].filter(Boolean).join(" · ") || null,
    };
  });
  const upcomingTasks = upcoming.tasks.map((t) => ({ id: t.id, jobId: t.job_id, company: t.company, color: t.color, logo: t.logo, title: t.title, when: when(t.at, now) ?? "" }));
  const active = cards.filter((c) => ["screening", "interviewing", "final", "offer"].includes(c.stage));
  const applied = cards.filter((c) => c.stage === "applied").length;
  const interviewing = active.filter((c) => ["interviewing", "final", "offer"].includes(c.stage)).length;
  const dateLabel = now.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
  const labelFor = new Map(roles.map((r) => [r.id, `${r.company_name} · ${r.title}`]));
  const roleOptions = roles.filter((r) => r.stage !== "closed").map((r) => ({ id: r.id, label: labelFor.get(r.id)! }));
  const toReadTotal = pendingCount();
  const toRead = listPending(5).map((i) => ({
    id: i.message_id,
    from: i.from_addr.replace(/\s*<[^>]+>$/, "") || i.from_addr,
    subject: i.subject ?? "",
    when: relTime(i.received_at, now),
  }));
  const researchTotal = pendingResearchCount();
  const prepQueue = listPrepQueue().map((r) => ({ jobId: r.job_id ?? 0, label: r.label, when: relTime(r.at, now) }));
  const research = listResearch(5).map((r) => ({ jobId: r.role_id, label: `${r.company} · ${r.title}`, when: relTime(r.queued_at, now) }));
  const claudeRun = lastRun();
  const run = claudeRun
    ? { ...claudeRun, when: relTime(claudeRun.finished_at ?? claudeRun.started_at, now) }
    : null;
  const proposals = listOpenProposals().map((p) => ({
    id: p.id,
    kind: p.kind,
    title: p.title,
    detail: p.detail,
    when: relTime(p.createdAt, now),
    suggestedJobId: p.suggestedJobId,
    count: p.count,
    jobLabel: p.jobId ? (labelFor.get(p.jobId) ?? null) : null,
  }));

  return (
    <div className="flex flex-col gap-5 px-4 py-5 md:px-8 md:py-7">
      <header className="flex items-end gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl leading-none font-semibold tracking-[-0.035em] md:text-4xl">Your roles</h1>
          <p className="text-sm text-muted">
            {active.length} active · {interviewing} in interviews · {applied} awaiting reply · {dateLabel}
          </p>
        </div>
        <div className="flex-1" />
        <RefreshEmail />
        <Link href="/jobs/new" className="btn btn-primary h-[42px]">
          <PlusIcon size={16} />
          Add role
        </Link>
      </header>

      {roles.length === 0 ? (
        <div className="glass flex flex-col items-center gap-4 rounded-xl px-10 py-14 text-center">
          <h2 className="text-xl font-semibold tracking-tight">No roles yet</h2>
          <p className="max-w-md text-sm text-muted">
            Add your first role, or load the demo data to explore the app. You can clear the demo data from Settings at any time.
          </p>
          <div className="flex gap-2">
            <Link href="/jobs/new" className="btn btn-primary">
              Add a role
            </Link>
            <form action={loadDemoAction}>
              <button type="submit" className="btn btn-ghost">
                Load demo data
              </button>
            </form>
          </div>
        </div>
      ) : (
        <>
          <NeedsYou items={proposals} roles={roleOptions} />
          <ForClaude emails={toRead} emailTotal={toReadTotal} research={research} researchTotal={researchTotal} prep={prepQueue} run={run} canRun={!!findClaude()} />
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Upcoming interviews={upcomingInterviews} tasks={upcomingTasks} />
            <TodayStrip items={today} />
          </div>
          <RolesView cards={cards} />
        </>
      )}
    </div>
  );
}
