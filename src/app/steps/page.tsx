import { StepsView, type StepView } from "@/components/StepsView";
import { when } from "@/lib/format";
import { listOpenTasks, listRoles } from "@/lib/repo";
import { SOURCE_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Next steps · Pursuit" };

export default function StepsPage() {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 8);

  const steps: StepView[] = listOpenTasks().map((t) => {
    const due = t.due_at ? new Date(t.due_at) : null;
    const bucket: StepView["bucket"] = !due ? "undated" : due < today ? "overdue" : due < tomorrow ? "today" : due < weekEnd ? "week" : "later";
    return {
      id: t.id,
      title: t.title,
      due: when(t.due_at, now),
      dueIso: t.due_at,
      done: false,
      overdue: bucket === "overdue",
      source: SOURCE_LABEL[t.source] ?? t.source,
      kind: t.kind === "call" ? "call" : "task",
      bucket,
      parked: t.stage === "no_reply" || t.stage === "later",
      role: { id: t.job_id, company: t.company, title: t.role, color: t.color, logo: t.logo },
    };
  });
  const due = steps.filter((s) => !s.parked && (s.bucket === "overdue" || s.bucket === "today")).length;
  const roles = listRoles()
    .filter((r) => r.stage !== "closed")
    .map((r) => ({ id: r.id, label: `${r.company_name} · ${r.title}` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="flex flex-col gap-5 px-4 py-5 md:px-8 md:py-7">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl leading-none font-semibold tracking-[-0.035em] md:text-4xl">Next steps</h1>
        <p className="text-sm text-muted">
          {steps.filter((s) => !s.parked).length} open across your roles
          {due > 0 ? ` · ${due} due today or overdue` : " · nothing due today"}. Tick them off as you go; edit any to change its wording or date.
        </p>
      </header>
      <StepsView steps={steps} roles={roles} />
    </div>
  );
}
