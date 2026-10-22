import Link from "next/link";
import { CalendarIcon } from "./icons";
import { Logo } from "./ui";

/** Home: your next interviews, big and clear, then next steps due this week. */

export interface UpcomingInterviewView {
  id: number;
  jobId: number;
  company: string;
  role: string;
  color: string;
  logo: string | null;
  name: string;
  isCall: boolean;
  stage: string;
  weekday: string;
  dayNum: string;
  month: string;
  time: string | null;
  day: string;
  soon: boolean;
  detail: string | null;
}

export interface UpcomingTaskView {
  id: number;
  jobId: number;
  company: string;
  color: string;
  logo: string | null;
  title: string;
  when: string;
}

export function Upcoming({ interviews, tasks }: { interviews: UpcomingInterviewView[]; tasks: UpcomingTaskView[] }) {
  return (
    <section className="glass flex flex-col gap-2.5 rounded-xl px-4 py-3.5" aria-labelledby="upcoming-h">
      <div className="flex items-center gap-2">
        <CalendarIcon size={16} />
        <h2 id="upcoming-h" className="text-sm font-semibold">
          Upcoming
        </h2>
        <span className="ml-auto hidden text-xs text-faint sm:inline">Your next interviews and steps</span>
      </div>

      {interviews.length === 0 ? (
        <p className="py-1.5 text-sm text-muted">No interviews or calls booked. They appear here as invites arrive in Outlook, or when you add one as a next step.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {interviews.map((iv) => (
            <li key={`${iv.isCall ? "c" : "i"}${iv.id}`}>
              <InterviewRow iv={iv} />
            </li>
          ))}
        </ul>
      )}

      {tasks.length > 0 && (
        <div className="flex flex-col">
          <span className="label pt-1.5">Next steps this week</span>
          <ul className="flex flex-col">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-3 border-b border-white/7 py-1.5 last:border-0">
                <span className="w-[86px] shrink-0 font-mono text-xs text-fg-2">{t.when}</span>
                <Logo name={t.company} color={t.color} logo={t.logo} size={20} />
                <Link href={`/jobs/${t.jobId}`} className="min-w-0 flex-1 truncate text-sm text-fg hover:underline">
                  <span className="text-muted">{t.company} · </span>
                  {t.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function InterviewRow({ iv }: { iv: UpcomingInterviewView }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-2.5 ${
        iv.soon ? "border-accent/45 bg-accent/10 shadow-[0_0_24px_rgb(110_139_255/0.15)]" : "border-white/8 bg-white/4"
      }`}
    >
      <div
        className={`flex w-[52px] shrink-0 flex-col items-center rounded-md py-1 leading-none ${iv.soon ? "bg-accent/25 text-fg" : "bg-white/7 text-fg-2"}`}
        aria-hidden="true"
      >
        <span className="text-[10px] font-semibold tracking-wider uppercase">{iv.weekday}</span>
        <span className="font-mono text-xl font-medium">{iv.dayNum}</span>
        <span className="text-[10px] text-muted uppercase">{iv.month}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-base font-semibold">{iv.time ?? "Time TBC"}</span>
          <span className={`text-xs font-semibold ${iv.soon ? "text-accent-soft" : "text-muted"}`}>{iv.day}</span>
          <span
            className={`chip font-semibold ${iv.isCall ? "border-green/40 bg-green/10 text-green" : "border-accent/40 bg-accent/12 text-accent-soft"}`}
          >
            {iv.stage}
          </span>
        </div>
        <Link href={`/jobs/${iv.jobId}`} className="flex min-w-0 items-center gap-2 text-sm text-fg hover:underline">
          <Logo name={iv.company} color={iv.color} logo={iv.logo} size={18} />
          <span className="truncate">
            <span className="font-medium">{iv.company}</span>
            <span className="text-muted"> · {iv.role}</span>
          </span>
        </Link>
        {(iv.isCall ? iv.name : iv.detail) && <span className="truncate text-xs text-faint">{iv.isCall ? iv.name : iv.detail}</span>}
      </div>
      <Link href={`/jobs/${iv.jobId}?tab=prep`} className="btn btn-ghost btn-sm shrink-0">
        Prep
      </Link>
    </div>
  );
}
