"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as engine from "./engine";
import { loadDemoData } from "./demo";
import { PARKED, STAGES, isJobField, type Facts, type Stage } from "./types";

const refresh = () => revalidatePath("/", "layout");

function str(fd: FormData, name: string): string | null {
  const v = fd.get(name);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function id(fd: FormData, name: string): number {
  const n = Number(fd.get(name));
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Missing ${name}`);
  return n;
}

/** <input type="datetime-local"> values are local time; store UTC. */
function localToIso(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function createJobAction(fd: FormData) {
  const company = str(fd, "company");
  const title = str(fd, "title");
  if (!company || !title) throw new Error("Company and title are required");
  const facts: Facts = {};
  for (const [key, value] of fd.entries()) {
    if (typeof value === "string" && value.trim() !== "" && isJobField(key) && key !== "title") {
      facts[key] = value;
    }
  }
  const jobId = engine.createJob({
    company: { name: company, domain: str(fd, "domain") },
    title,
    facts,
    source: "you",
    note: str(fd, "note") ?? undefined,
  });
  refresh();
  redirect(`/jobs/${jobId}`);
}

export async function updateFieldAction(jobId: number, field: string, value: string) {
  if (!isJobField(field)) throw new Error(`Unknown field ${field}`);
  engine.updateJob(jobId, { [field]: value } as Facts);
  refresh();
}

export async function setStageAction(jobId: number, stage: string, reason?: string) {
  if (!(PARKED as readonly string[]).includes(stage) && !(STAGES as readonly string[]).includes(stage)) throw new Error(`Unknown stage ${stage}`);
  engine.setStage(jobId, stage as Stage, {}, reason);
  refresh();
}

const NOTE_TITLE: Record<string, string> = { note: "Note", call: "Call notes", interview: "Interview notes" };

export async function addNoteAction(fd: FormData) {
  const text = str(fd, "text");
  if (text) engine.addNote(id(fd, "jobId"), text, {}, NOTE_TITLE[str(fd, "type") ?? "note"] ?? "Note");
  refresh();
}

export async function saveNotesAction(jobId: number, notes: string) {
  engine.saveNotes(jobId, notes);
  refresh();
}

/** A next step: a plain step, a call, or an interview (which becomes an interview record, like calendar invites do). */
export async function addTaskAction(_prev: string | null, fd: FormData): Promise<string | null> {
  const title = str(fd, "title");
  if (!title) return null;
  const jobId = id(fd, "jobId");
  const due = localToIso(str(fd, "due"));
  const type = str(fd, "type") ?? "task";
  if (type === "interview") {
    if (!due) return "Add the date and time of the interview.";
    engine.addInterview(jobId, { name: title, startsAt: due });
    // Booking an interview means they got back to you.
    const { get } = await import("./db");
    const stage = get<{ stage: string }>("SELECT stage FROM jobs WHERE id = ?", jobId)?.stage;
    if (stage === "found" || stage === "applied" || stage === "no_reply") engine.setStage(jobId, "screening", {}, "Interview booked");
  } else {
    engine.addTask(jobId, title, due, {}, type === "call" ? "call" : "task");
  }
  refresh();
  return null;
}

export async function completeTaskAction(taskId: number) {
  engine.completeTask(taskId);
  refresh();
}

export async function addInterviewAction(fd: FormData) {
  const name = str(fd, "name");
  if (!name) return;
  const duration = Number(str(fd, "duration"));
  engine.addInterview(id(fd, "jobId"), {
    name,
    startsAt: localToIso(str(fd, "startsAt")),
    durationMin: Number.isFinite(duration) && duration > 0 ? duration : null,
    format: str(fd, "format"),
    attendees: str(fd, "attendees"),
  });
  refresh();
}

export async function completeInterviewAction(interviewId: number, debrief: string | null) {
  engine.completeInterview(interviewId, debrief && debrief.trim() ? debrief.trim() : null);
  refresh();
}

export async function addContactAction(fd: FormData) {
  engine.addContact(id(fd, "jobId"), {
    name: str(fd, "name") ?? "",
    title: str(fd, "title"),
    email: str(fd, "email"),
    role: str(fd, "role"),
    notes: str(fd, "notes"),
  });
  refresh();
}

export async function undoAction(changeId: number): Promise<engine.UndoResult> {
  const result = engine.undoChange(changeId);
  refresh();
  return result;
}

export async function loadDemoAction() {
  loadDemoData();
  refresh();
}

export async function deleteAllAction(fd: FormData) {
  if (str(fd, "confirm") !== "DELETE") throw new Error("Type DELETE to confirm");
  engine.deleteAllData();
  refresh();
  redirect("/");
}

// ── Sync & connections ──────────────────────────────────────────────────────

export async function syncNowAction() {
  const { runSync } = await import("./sync/scheduler");
  await runSync("manual");
  refresh();
}

export async function disconnectGoogleAction() {
  const { disconnect } = await import("./google/auth");
  const { setSetting } = await import("./db");
  await disconnect();
  setSetting("gmail.historyId", null);
  engine.setSourceStatus("gmail", "not_connected");
  engine.setSourceStatus("calendar", "not_connected");
  refresh();
}

export async function resolveProposalAction(id: number, action: "link" | "create" | "apply" | "keep" | "ignore", jobId?: number) {
  const { resolveProposal } = await import("./sync/apply");
  resolveProposal(id, action, jobId);
  refresh();
}

export async function connectImapAction(fd: FormData) {
  const { connectImap } = await import("./mail/imap");
  const { syncSoon } = await import("./sync/scheduler");
  const port = Number(str(fd, "port"));
  const error = await connectImap({
    email: str(fd, "email") ?? "",
    password: str(fd, "password") ?? "",
    host: str(fd, "host"),
    port: Number.isInteger(port) && port > 0 ? port : null,
  });
  if (!error) {
    engine.setSourceStatus("imap", "connected");
    syncSoon();
  }
  refresh();
  const setup = str(fd, "next") === "setup";
  if (error) redirect(setup ? `/setup?step=email&error=${encodeURIComponent(error)}` : `/settings?imap_error=${encodeURIComponent(error)}`);
  redirect(setup ? "/setup?step=email" : "/settings?imap=connected");
}

export async function disconnectImapAction() {
  const { disconnectImap } = await import("./mail/imap");
  disconnectImap();
  engine.setSourceStatus("imap", "not_connected");
  refresh();
}

export async function disconnectMicrosoftAction() {
  const { disconnect } = await import("./microsoft/auth");
  const { outlookProvider } = await import("./mail/providers");
  disconnect();
  outlookProvider.reset();
  engine.setSourceStatus("outlook", "not_connected");
  engine.setSourceStatus("outlook_calendar", "not_connected");
  refresh();
}

export async function dismissEmailAction(messageId: string) {
  const { dismissQueued } = await import("./mail/pipeline");
  dismissQueued(messageId);
  refresh();
}

export async function importPipelineDeskAction(_prev: string | null, fd: FormData): Promise<string> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return "Choose a Pipeline Desk backup file (.json) first.";
  const { importPipelineDesk } = await import("./importers/pipeline-desk");
  try {
    const r = importPipelineDesk(JSON.parse(await file.text()));
    void import("./logos").then((m) => m.refreshLogos()).catch(() => {});
    refresh();
    return `Imported ${r.imported.length} roles${r.skipped.length ? `, skipped ${r.skipped.length} (${r.skipped.join(", ")})` : ""}.`;
  } catch (err) {
    return `Couldn't import that file: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`;
  }
}

export async function quickAddAction(fd: FormData) {
  const { quickAdd } = await import("./research");
  const jobId = quickAdd({
    jd: str(fd, "jd"),
    jobUrl: str(fd, "jobUrl"),
    careersUrl: str(fd, "careersUrl"),
    website: str(fd, "website"),
    company: str(fd, "company"),
    title: str(fd, "title"),
    research: fd.get("research") === "on",
  });
  const { get } = await import("./db");
  const { refreshCompanyLogo } = await import("./logos");
  const c = get<{ company_id: number }>("SELECT company_id FROM jobs WHERE id = ?", jobId);
  if (c) void refreshCompanyLogo(c.company_id).catch(() => {}); // arrives a moment later via live refresh
  refresh();
  redirect(`/jobs/${jobId}`);
}

export async function queueResearchAction(jobId: number) {
  const { queueResearch } = await import("./research");
  queueResearch(jobId, {});
  refresh();
}

export async function deleteJobAction(jobId: number) {
  engine.deleteJob(jobId);
  refresh();
  redirect("/");
}

export async function processQueueAction(): Promise<string | null> {
  const { headers } = await import("next/headers");
  const { startQueueRun } = await import("./claude-runner");
  const host = (await headers()).get("host") ?? "localhost:3100";
  const error = startQueueRun(`http://${host}`);
  refresh();
  return error;
}

export async function stopQueueAction() {
  const { stopQueueRun } = await import("./claude-runner");
  stopQueueRun();
  refresh();
}

export async function setRatingAction(jobId: number, key: string, value: number | null) {
  const { RATINGS } = await import("./rating");
  const rating = RATINGS.find((r) => r.key === key);
  if (!rating) throw new Error(`Unknown rating ${key}`);
  if (value !== null && !(Number.isInteger(value) && value >= 1 && value <= 5)) throw new Error("Ratings are 1–5");
  engine.updateJob(jobId, { [key]: value } as Facts, {}, `Rated ${rating.label.toLowerCase()}`);
  refresh();
}

export async function refreshLogosAction(): Promise<string> {
  const { refreshLogos } = await import("./logos");
  const r = await refreshLogos({ force: true });
  refresh();
  return `Checked ${r.checked} company websites, found ${r.found} logos.`;
}

// ── Interview prep & calls ──────────────────────────────────────────────────

export async function savePrepAction(jobId: number, content: import("./prep").PrepContent) {
  const { savePrep } = await import("./prep");
  savePrep(jobId, content, "you");
  refresh();
}

export async function queuePrepAction(jobId: number, focus: string | null) {
  const { queuePrep } = await import("./prep");
  queuePrep(jobId, focus && focus.trim() ? focus.trim() : null);
  refresh();
}

export async function saveLibraryItemAction(item: { id?: number; kind: "answer" | "story" | "check" | "them"; title: string; body: string; note: string | null }) {
  if (!item.title.trim()) throw new Error("A title is required");
  const { saveLibraryItem } = await import("./prep");
  saveLibraryItem({ ...item, title: item.title.trim() });
  refresh();
}

export async function deleteLibraryItemAction(id: number) {
  const { deleteLibraryItem } = await import("./prep");
  deleteLibraryItem(id);
  refresh();
}

export async function saveResumeAction(text: string, url: string | null) {
  const { saveResume } = await import("./prep");
  saveResume(text, url && /^https:\/\//.test(url.trim()) ? url.trim() : null);
  refresh();
}

/** Saves the profile fields the form sent (Settings sends them all; setup sends a few). */
export async function saveProfileAction(fd: FormData) {
  const { saveProfile } = await import("./profile");
  const fields = ["name", "headline", "location", "region", "currency", "targetRoles", "wants", "avoid", "voice", "careerNotes", "method"] as const;
  const profile: Partial<import("./profile").Profile> = {};
  for (const f of fields) {
    const v = fd.get(f);
    if (typeof v === "string") profile[f] = v.trim();
  }
  if (profile.currency === "") profile.currency = "$";
  if (fd.has("pack")) profile.pack = fd.get("pack") === "general" ? "general" : "sales";
  saveProfile(profile);
  refresh();
  redirect(str(fd, "next") === "setup" ? "/setup?step=story" : "/settings?profile=saved");
}

// ── First-run setup ─────────────────────────────────────────────────────────

const setupStep = (step: string, error?: string) => `/setup?step=${step}${error ? `&error=${encodeURIComponent(error)}` : ""}`;

export async function saveApiKeyAction(fd: FormData) {
  const { saveApiKey } = await import("./ai/client");
  const error = await saveApiKey(str(fd, "key") ?? "");
  refresh();
  if (str(fd, "next") === "setup") redirect(setupStep(error ? "claude" : "resume", error ?? undefined));
  redirect(error ? `/settings?key_error=${encodeURIComponent(error)}` : "/settings?key=saved");
}

export async function removeApiKeyAction() {
  const { removeApiKey } = await import("./ai/client");
  removeApiKey();
  refresh();
}

const MAX_RESUME_BYTES = 8 * 1024 * 1024;

export async function setupResumeAction(fd: FormData) {
  const { isAiConfigured } = await import("./ai/client");
  const { readResume } = await import("./setup");
  const { saveResume } = await import("./prep");
  const file = fd.get("resume");
  const pdf = file instanceof File && file.size > 0 ? file : null;
  const text = str(fd, "text");
  let error: string | null = null;
  if (!pdf && !text) error = "Choose your resume PDF or paste its text.";
  else if (pdf && pdf.type !== "application/pdf" && !pdf.name.toLowerCase().endsWith(".pdf")) error = "That file isn't a PDF. Save your resume as PDF, or paste its text.";
  else if (pdf && pdf.size > MAX_RESUME_BYTES) error = "That PDF is over 8 MB. Try a smaller export, or paste the text.";
  else if (!isAiConfigured()) {
    // Without Claude, keep the pasted text and fill the profile by hand.
    if (pdf) error = "Reading a PDF needs Claude. Paste your resume text instead, or go back and add a key.";
    else saveResume(text!, null);
  } else {
    try {
      await readResume(pdf ? { pdf: Buffer.from(await pdf.arrayBuffer()) } : { text: text! });
    } catch (err) {
      error = err instanceof Error ? err.message : "Couldn't read the resume.";
    }
  }
  refresh();
  redirect(setupStep(error ? "resume" : "profile", error ?? undefined));
}

export async function setupStoryAction(fd: FormData) {
  const { isAiConfigured } = await import("./ai/client");
  const { draftStories } = await import("./setup");
  const { saveProfile } = await import("./profile");
  const notes = fd.get("careerNotes");
  if (typeof notes === "string") saveProfile({ careerNotes: notes.trim() });
  const answers = fd.getAll("answer").map((a) => (typeof a === "string" ? a : ""));
  let error: string | null = null;
  if (isAiConfigured()) {
    try {
      await draftStories(answers);
    } catch (err) {
      error = err instanceof Error ? err.message : "Couldn't draft your stories.";
    }
  }
  refresh();
  redirect(setupStep(error ? "story" : "stories", error ?? undefined));
}

export async function finishSetupAction(fd: FormData) {
  const { finishSetup } = await import("./setup");
  finishSetup();
  if (str(fd, "demo") === "1") loadDemoData();
  refresh();
  redirect("/");
}

export async function startCallAction(jobId: number, interviewId: number | null) {
  const { startCall } = await import("./prep");
  const id = startCall(jobId, interviewId);
  refresh();
  redirect(`/calls/${id}`);
}

export async function saveCallNotesAction(callId: number, notes: string) {
  const { saveCallNotes } = await import("./prep");
  saveCallNotes(callId, notes);
}

export async function endCallAction(callId: number) {
  const { endCall } = await import("./prep");
  endCall(callId);
  refresh();
}

/** Transcribe a call's recording on this computer, then have Claude summarise it. */
export async function transcribeCallAction(callId: number) {
  const { queueTranscription } = await import("./transcribe");
  queueTranscription(callId);
  refresh();
}

export async function addTranscriptAction(callId: number, transcript: string) {
  if (!transcript.trim()) return;
  const { addTranscript } = await import("./prep");
  addTranscript(callId, transcript.trim());
  const { startClaude } = await import("./transcribe");
  await startClaude(); // read it now rather than at the next queue run
  refresh();
}

// ── Edit role & company ─────────────────────────────────────────────────────

export async function editRoleAction(
  jobId: number,
  input: { company: string; website: string; title: string; url: string; location: string; research: boolean },
): Promise<string | null> {
  const { get } = await import("./db");
  const before = get<{ company_id: number; company: string; domain: string | null; title: string; url: string | null; location: string | null }>(
    "SELECT j.company_id, c.name AS company, c.domain, j.title, j.url, j.location FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = ?",
    jobId,
  );
  if (!before) return "That role no longer exists.";
  if (!input.company.trim() || !input.title.trim()) return "Company and role title are required.";

  const companyChanged = input.company.trim() !== before.company || (engine.cleanDomain(input.website) ?? before.domain) !== before.domain;
  let companyId = before.company_id;
  if (companyChanged) companyId = engine.setRoleCompany(jobId, { name: input.company, website: input.website || null });

  const facts: Facts = {};
  if (input.title.trim() !== before.title) facts.title = input.title.trim();
  if ((input.url.trim() || null) !== before.url) facts.url = input.url.trim() || null;
  if ((input.location.trim() || null) !== before.location) facts.location = input.location.trim() || null;
  if (Object.keys(facts).length) engine.updateJob(jobId, facts);

  if (companyChanged) {
    const { refreshCompanyLogo } = await import("./logos");
    void refreshCompanyLogo(companyId).catch(() => {});
  }
  if (input.research) {
    const { queueResearch } = await import("./research");
    queueResearch(jobId, { website: input.website || null, jobUrl: input.url || null });
  }
  refresh();
  return null;
}

// ── Attach a calendar event to a role ───────────────────────────────────────

export interface AttachableEvent {
  provider: string;
  id: string;
  summary: string;
  startsAt: string;
  when: string;
  attendees: string | null;
  linkedTo: string | null;
}

/** Your calendar from 2 days ago to 60 days ahead (timed events only), newest-relevant first. */
export async function listCalendarEventsAction(): Promise<{ events: AttachableEvent[]; error: string | null }> {
  const { connectedCalendars } = await import("./calendar/providers");
  const { all } = await import("./db");
  const { clock } = await import("./format");
  const calendars = connectedCalendars();
  if (calendars.length === 0) return { events: [], error: "No calendar connected. Connect Outlook in Settings." };
  const links = new Map(
    all<{ event_id: string; label: string }>(
      `SELECT l.event_id, c.name || ' · ' || j.title AS label FROM calendar_links l
       JOIN jobs j ON j.id = l.job_id JOIN companies c ON c.id = j.company_id WHERE l.status = 'linked'`,
    ).map((l) => [l.event_id, l.label]),
  );
  const from = new Date(Date.now() - 2 * 86_400_000);
  const to = new Date(Date.now() + 60 * 86_400_000);
  const events: AttachableEvent[] = [];
  try {
    for (const cal of calendars) {
      for (const e of await cal.list(from, to)) {
        if (e.cancelled || !e.startsAt) continue;
        events.push({
          provider: cal.name,
          id: e.id,
          summary: e.summary || "(no title)",
          startsAt: e.startsAt,
          when: `${new Date(e.startsAt).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })} · ${clock(e.startsAt)}`,
          attendees: e.attendees.filter((a) => !a.self).map((a) => a.name ?? a.email).slice(0, 4).join(", ") || null,
          linkedTo: links.get(e.id) ?? null,
        });
      }
    }
  } catch (err) {
    return { events: [], error: `Couldn't read your calendar: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}` };
  }
  events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { events, error: null };
}

export async function attachEventAction(jobId: number, provider: string, eventId: string): Promise<string | null> {
  const { connectedCalendars } = await import("./calendar/providers");
  const { toPayload } = await import("./sync/calendar-sync");
  const { linkEventToJob } = await import("./sync/apply");
  const cal = connectedCalendars().find((c) => c.name === provider);
  if (!cal) return "That calendar isn't connected any more.";
  const events = await cal.list(new Date(Date.now() - 2 * 86_400_000), new Date(Date.now() + 60 * 86_400_000));
  const e = events.find((x) => x.id === eventId);
  if (!e?.startsAt) return "Couldn't find that event in your calendar.";
  linkEventToJob(jobId, toPayload(e, cal));
  refresh();
  return null;
}

export async function setTaskTypeAction(taskId: number, type: "task" | "call" | "interview"): Promise<string | null> {
  const err = engine.setTaskType(taskId, type);
  refresh();
  return err;
}

/** Home screen "Refresh from email": sync mail + calendar now and say what came in. */
export async function refreshFromEmailAction(): Promise<string> {
  const { runSync, syncStatus } = await import("./sync/scheduler");
  const { connectedMailProviders } = await import("./mail/providers");
  if (connectedMailProviders().length === 0) return "No mailbox connected. Connect Outlook in Settings.";
  if (syncStatus().running) return "Already syncing. Results appear in a moment.";
  const run = await runSync("manual");
  refresh();
  if (!run) return "Nothing to sync.";
  let checked = 0, applied = 0, queued = 0, needsYou = 0, interviews = 0;
  const errors: string[] = [];
  for (const step of run.steps) {
    const r = step.result;
    if ("error" in r) errors.push(`${step.label}: ${r.error.slice(0, 80)}`);
    else if ("analysed" in r) {
      checked += r.checked;
      applied += r.applied;
      queued += r.queued;
      needsYou += r.needsYou;
    } else {
      interviews += r.linked;
      needsYou += r.needsYou;
    }
  }
  if (errors.length) return `Couldn't sync ${errors.join("; ")}`;
  const parts = [
    applied && `${applied} updated ${applied === 1 ? "a role" : "roles"}`,
    queued && `${queued} waiting for Claude`,
    interviews && `${interviews} new ${interviews === 1 ? "interview" : "interviews"} from your calendar`,
    needsYou && `${needsYou} in Needs you`,
  ].filter(Boolean);
  return checked === 0 && parts.length === 0 ? "Up to date: no new emails." : `Checked ${checked} new ${checked === 1 ? "email" : "emails"}${parts.length ? `: ${parts.join(", ")}` : ", nothing job-related"}.`;
}

/** Edit a step's wording and date. due is a <input type="datetime-local"> value (local time) or empty. */
export async function updateTaskAction(taskId: number, title: string, due: string): Promise<string | null> {
  if (!title.trim()) return "The step needs some wording.";
  engine.updateTask(taskId, { title, dueAt: localToIso(due.trim() || null) });
  refresh();
  return null;
}

export async function setMailFoldersAction(folderIds: string[]) {
  const { setChosenFolders } = await import("./mail/providers");
  setChosenFolders(folderIds);
  refresh();
}

// ── STAR stories & practice ─────────────────────────────────────────────────

export async function saveStarAction(story: {
  id?: number;
  title: string;
  competencies: string[];
  situation: string;
  task: string;
  action: string;
  result: string;
  lesson: string;
}) {
  if (!story.title.trim()) throw new Error("Give the story a short title");
  const { saveStar } = await import("./star");
  saveStar({ ...story, title: story.title.trim() });
  refresh();
}

export async function deleteStarAction(id: number) {
  const { deleteStar } = await import("./star");
  deleteStar(id);
  refresh();
}

/** Have Claude polish one story (or all of them), then start Claude so it happens now. */
export async function polishStarAction(id: number | "all") {
  const { queueStarPolish } = await import("./star");
  queueStarPolish(id);
  const { startClaude } = await import("./transcribe");
  await startClaude();
  refresh();
}

export async function undoStarPolishAction(id: number) {
  const { undoStarPolish } = await import("./star");
  undoStarPolish(id);
  refresh();
}

/** Record how a practice answer went (1 needs work, 2 okay, 3 nailed it). */
export async function ratePracticeAction(jobId: number, question: string, confidence: number) {
  const { getPrep, savePrep } = await import("./prep");
  const prep = getPrep(jobId);
  if (!prep) return;
  const questions = prep.content.questions.map((q) =>
    q.title === question ? { ...q, confidence, practiced_at: new Date().toISOString() } : q,
  );
  savePrep(jobId, { ...prep.content, questions }, prep.source === "agent" ? "agent" : "you");
  refresh();
}

/** Review an interview now (Claude scores it against your prep). */
export async function reviewCallAction(callId: number): Promise<string | null> {
  const { queueReview } = await import("./review");
  if (!queueReview(callId)) return "This call has no transcript yet. Transcribe the recording or paste the transcript first.";
  const { startClaude } = await import("./transcribe");
  await startClaude();
  refresh();
  return null;
}

// ── Interview detail ────────────────────────────────────────────────────────

export async function updateInterviewAction(
  interviewId: number,
  input: { name: string; startsAt: string; duration: string; format: string; attendees: string },
): Promise<string | null> {
  if (!input.name.trim()) return "Give the interview a name.";
  const duration = Number(input.duration);
  engine.updateInterview(interviewId, {
    name: input.name,
    startsAt: localToIso(input.startsAt.trim() || null),
    durationMin: Number.isFinite(duration) && duration > 0 ? duration : null,
    format: input.format.trim() || null,
    attendees: input.attendees.trim() || null,
  });
  refresh();
  return null;
}

export async function saveDebriefAction(interviewId: number, debrief: string) {
  engine.saveDebrief(interviewId, debrief);
  refresh();
}

export async function linkCallAction(callId: number, interviewId: number | null) {
  engine.linkCallToInterview(callId, interviewId);
  refresh();
}
