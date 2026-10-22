import { ChangeFeed } from "@/components/ChangeFeed";
import { listAllEvents } from "@/lib/repo";
import { toFeedItem } from "@/lib/view";

export const dynamic = "force-dynamic";

export default function ChangesPage() {
  const now = new Date();
  const items = listAllEvents(200).map((e) => toFeedItem(e, now));
  return (
    <div className="flex flex-col gap-5 px-4 py-5 md:px-8 md:py-7">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl leading-none font-semibold tracking-[-0.035em]">Changes</h1>
        <p className="text-sm text-muted">
          Everything that has updated your roles, newest first. Any field change can be undone; the undo is logged too.
        </p>
      </header>
      <section className="glass rounded-xl px-5 py-2">
        <ChangeFeed items={items} />
      </section>
    </div>
  );
}
