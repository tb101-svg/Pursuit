"use client";

import { useState, useTransition } from "react";
import { deleteLibraryItemAction, saveLibraryItemAction, saveResumeAction } from "@/lib/actions";
import type { LibraryItem, LibraryKind } from "@/lib/prep";
import { PencilIcon, PlusIcon } from "./icons";
import { ResumeText } from "./prep";
import { PILLAR_VIEW } from "./InterviewThem";

const LABELS: Record<LibraryKind, { title: string; body: string; note?: string; add: string }> = {
  answer: { title: "Question", body: "Your answer (use [company] where the company name goes)", note: "Arc / length / coaching note", add: "Add a standard answer" },
  story: { title: "They're testing for", body: "Your proof point", add: "Add a story" },
  check: { title: "Checklist item", body: "", add: "Add a checklist item" },
  them: { title: "Question to ask them", body: "What to listen for (green and red flags)", note: "Team, product or growth", add: "Add a question" },
};

const pillarLabel = (note: string | null) => PILLAR_VIEW.find((p) => p.id === note)?.label ?? "Team";

/** One list in your library; each item edits in place. */
export function LibraryList({ kind, items }: { kind: LibraryKind; items: LibraryItem[] }) {
  const [adding, setAdding] = useState(false);
  if (kind === "them") {
    return (
      <div className="flex flex-col gap-4">
        {PILLAR_VIEW.map((p) => (
          <div key={p.id} className="flex flex-col">
            <h3 className="text-[13px] font-semibold">
              {p.label} <span className="font-normal text-muted">· {p.sub}</span>
            </h3>
            {items
              .filter((it) => pillarLabel(it.note) === p.label)
              .map((it) => (
                <LibraryRow key={it.id} kind={kind} item={it} />
              ))}
          </div>
        ))}
        {adding ? (
          <ItemForm kind={kind} onDone={() => setAdding(false)} />
        ) : (
          <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => setAdding(true)}>
            <PlusIcon size={14} /> {LABELS[kind].add}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {items.map((it) => (
        <LibraryRow key={it.id} kind={kind} item={it} />
      ))}
      {adding ? (
        <ItemForm kind={kind} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className="btn btn-ghost btn-sm mt-3 self-start" onClick={() => setAdding(true)}>
          <PlusIcon size={14} /> {LABELS[kind].add}
        </button>
      )}
    </div>
  );
}

function LibraryRow({ kind, item }: { kind: LibraryKind; item: LibraryItem }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <ItemForm kind={kind} item={item} onDone={() => setEditing(false)} />;
  return (
    <div className="flex items-start gap-3 border-t border-white/7 py-3 first:border-t-0">
      {kind === "answer" ? (
        <details className="min-w-0 flex-1 [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer text-sm font-semibold">“{item.title}”</summary>
          <div className="flex flex-col gap-2 pt-2.5">
            {item.body ? <p className="text-[15px] leading-relaxed whitespace-pre-line">{item.body}</p> : <p className="text-sm text-amber-soft">No answer written yet.</p>}
            {item.note && <p className="text-[13px] text-muted">{item.note}</p>}
          </div>
        </details>
      ) : kind === "them" ? (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
          <span>{item.title}</span>
          {item.body && <span className="text-xs text-faint">Listen for: {item.body}</span>}
        </div>
      ) : kind === "story" ? (
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-3">
          <span className="font-medium">{item.title}</span>
          <span className="text-fg-2">{item.body}</span>
        </div>
      ) : (
        <span className="min-w-0 flex-1 text-sm">{item.title}</span>
      )}
      <button type="button" className="btn-link inline-flex shrink-0 items-center gap-1 text-[13px]" onClick={() => setEditing(true)}>
        <PencilIcon size={13} /> Edit
      </button>
    </div>
  );
}

function ItemForm({ kind, item, onDone }: { kind: LibraryKind; item?: LibraryItem; onDone: () => void }) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [note, setNote] = useState(item?.note ?? (kind === "them" ? "team" : ""));
  const [busy, start] = useTransition();
  const l = LABELS[kind];
  return (
    <form
      className="flex flex-col gap-2 border-t border-white/7 py-3 first:border-t-0"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await saveLibraryItemAction({ id: item?.id, kind, title, body, note: note.trim() || null });
          onDone();
        });
      }}
    >
      <input className="input" placeholder={l.title} aria-label={l.title} value={title} onChange={(e) => setTitle(e.target.value)} required />
      {l.body && (
        <textarea className={`input ${kind === "answer" ? "min-h-[200px]" : "min-h-[70px]"}`} placeholder={l.body} aria-label={l.body} value={body} onChange={(e) => setBody(e.target.value)} />
      )}
      {kind === "them" ? (
        <select className="input" aria-label={l.note} value={note} onChange={(e) => setNote(e.target.value)}>
          {PILLAR_VIEW.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}: {p.sub}
            </option>
          ))}
        </select>
      ) : (
        l.note && <input className="input" placeholder={l.note} aria-label={l.note} value={note} onChange={(e) => setNote(e.target.value)} />
      )}
      <div className="flex gap-2">
        {item && (
          <button
            type="button"
            className="text-xs text-[#FFB3BA] hover:underline"
            disabled={busy}
            onClick={() => {
              if (confirm(`Remove “${item.title}” from your library?`))
                start(async () => {
                  await deleteLibraryItemAction(item.id);
                  onDone();
                });
            }}
          >
            Remove
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

export function ResumeEditor({ text, url, updated }: { text: string; url: string | null; updated: string | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const [link, setLink] = useState(url ?? "");
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="btn-link">
            Open in Google Drive
          </a>
        )}
        {updated && <span className="text-faint">Updated {updated}</span>}
        <button type="button" className="btn-link ml-auto inline-flex items-center gap-1" onClick={() => setEditing((v) => !v)}>
          {editing ? "Cancel" : <><PencilIcon size={13} /> Edit</>}
        </button>
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              await saveResumeAction(value, link);
              setEditing(false);
            });
          }}
        >
          <input className="input" placeholder="Google Drive link (https://…)" aria-label="Google Drive link" value={link} onChange={(e) => setLink(e.target.value)} />
          <textarea
            className="input min-h-[480px] text-[13px]"
            aria-label="Resume text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste your resume text. Lines in CAPITALS become headings; lines starting with • become bullets."
          />
          <button type="submit" className="btn btn-primary btn-sm self-end" disabled={busy}>
            {busy ? "Saving…" : "Save resume"}
          </button>
        </form>
      ) : text ? (
        <ResumeText text={text} />
      ) : (
        <p className="text-sm text-muted">No resume yet. Click Edit and paste it in; Claude uses it when preparing your prep sheets.</p>
      )}
    </div>
  );
}
