import { LibraryList, ResumeEditor } from "@/components/PrepLibrary";
import { relTime } from "@/lib/format";
import { getResume, listLibrary } from "@/lib/prep";
import { competencies, listStars } from "@/lib/star";
import { StarLibrary } from "@/components/StarLibrary";

export const dynamic = "force-dynamic";

export const metadata = { title: "Prep library · Pursuit" };

const SECTIONS = [
  { id: "answers", title: "Standard answers", hint: "Your word-for-word scripts. Each role's prep sheet starts from these, and Claude tailors the “why this company” parts.", kind: "answer" as const },
  {
    id: "them",
    title: "Questions for them",
    hint: "You're interviewing them too: team (culture, mindset, strategy), product and growth. Every prep sheet starts with these, and Claude sharpens them for each company.",
    kind: "them" as const,
  },
  { id: "stories", title: "Story bank", hint: "What interviewers test for, and your proof point for each. Keep them to 60–90 seconds.", kind: "story" as const },
  { id: "checklist", title: "Final checklist", hint: "Copied onto every new prep sheet.", kind: "check" as const },
];

export default function PrepLibraryPage() {
  const resume = getResume();
  return (
    <div className="flex flex-col gap-[18px] px-4 py-5 md:px-8 md:py-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-[-0.03em] md:text-[28px]">Prep library</h1>
        <p className="text-sm text-muted">Write it once, reuse it for every role. Open a role&apos;s Prep tab to see it tailored.</p>
      </div>
      <nav aria-label="Library sections" className="flex gap-1.5 overflow-x-auto">
        {[{ id: "star", title: "STAR stories" }, ...SECTIONS, { id: "resume", title: "Resume" }].map((s) => (
          <a key={s.id} href={`#${s.id}`} className="chip shrink-0 px-3 py-1 text-xs hover:border-white/30 hover:text-fg">
            {s.title}
          </a>
        ))}
      </nav>
      <section id="star" className="glass flex scroll-mt-4 flex-col gap-2 rounded-xl border-accent/25 p-[18px] md:p-[22px]">
        <h2 className="text-[15px] font-semibold">STAR stories</h2>
        <p className="text-[13px] text-muted">
          Real examples behind your behavioural answers: Situation, Task, Action, Result. Practice answers for every role are built from these, so the
          more specific they are (names, numbers, what <em>you</em> did), the stronger every answer gets.
        </p>
        <StarLibrary stories={listStars()} competencies={competencies()} />
      </section>
      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="glass flex scroll-mt-4 flex-col gap-2 rounded-xl p-[18px] md:p-[22px]">
          <h2 className="text-[15px] font-semibold">{s.title}</h2>
          <p className="text-[13px] text-muted">{s.hint}</p>
          <LibraryList kind={s.kind} items={listLibrary(s.kind)} />
        </section>
      ))}
      <section id="resume" className="glass flex scroll-mt-4 flex-col gap-2 rounded-xl p-[18px] md:p-[22px]">
        <h2 className="text-[15px] font-semibold">Resume</h2>
        <ResumeEditor text={resume.text} url={resume.url} updated={resume.updated_at ? relTime(resume.updated_at) : null} />
      </section>
    </div>
  );
}
