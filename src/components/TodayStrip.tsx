"use client";

import Link from "next/link";
import { useTransition } from "react";
import { completeInterviewAction, completeTaskAction } from "@/lib/actions";
import { CalendarIcon } from "./icons";
import { Logo } from "./ui";

export interface TodayView {
  kind: "interview" | "task";
  id: number;
  jobId: number;
  time: string | null;
  title: string;
  company: string;
  color: string;
  logo: string | null;
  overdue: boolean;
}

export function TodayStrip({ items }: { items: TodayView[] }) {
  return (
    <section className="glass flex flex-col gap-2 rounded-xl px-4 py-3.5" aria-labelledby="today-h">
      <div className="flex items-center gap-2">
        <CalendarIcon size={16} />
        <h2 id="today-h" className="text-sm font-semibold">
          Today
        </h2>
        <span className="ml-auto hidden text-xs text-faint sm:inline">Interviews today and next steps due</span>
      </div>
      {items.length === 0 ? (
        <p className="py-1.5 text-sm text-muted">Nothing due today.</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => (
            <TodayRow key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TodayRow({ item }: { item: TodayView }) {
  const [pending, start] = useTransition();
  const done = () =>
    start(async () => {
      if (item.kind === "task") await completeTaskAction(item.id);
      else await completeInterviewAction(item.id, null);
    });
  return (
    <li className={`flex items-center gap-3 py-1.5 ${pending ? "opacity-50" : ""}`}>
      <span className={`w-[70px] font-mono text-sm font-medium ${item.overdue ? "text-[#FFB3BA]" : ""}`}>
        {item.overdue ? "Overdue" : (item.time ?? "Today")}
      </span>
      <Logo name={item.company} color={item.color} logo={item.logo} size={22} />
      <Link href={`/jobs/${item.jobId}`} className="min-w-0 flex-1 truncate text-sm text-fg hover:underline">
        <span className="text-muted">{item.company} · </span>
        {item.title}
      </Link>
      {item.kind === "interview" && <span className="chip hidden sm:inline-flex">Interview</span>}
      <button type="button" className="btn btn-ghost btn-sm" onClick={done} disabled={pending}>
        Mark done
      </button>
    </li>
  );
}
