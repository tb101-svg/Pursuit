export const STAGES = ["found", "applied", "screening", "interviewing", "final", "offer"] as const;
export type OpenStage = (typeof STAGES)[number];
/**
 * Off the progress track: "no_reply" is an application that went quiet (moved
 * automatically after 3 weeks), "later" is parked (no suitable role yet, role
 * filled), "closed" is done.
 */
export type ParkedStage = "no_reply" | "later" | "closed";
export type Stage = OpenStage | ParkedStage;
export const PARKED: readonly ParkedStage[] = ["no_reply", "later", "closed"];
export const isParked = (s: Stage) => (PARKED as readonly string[]).includes(s);

export const STAGE_LABEL: Record<Stage, string> = {
  found: "Found",
  applied: "Applied",
  screening: "1st stage",
  interviewing: "Interviewing",
  final: "Final",
  offer: "Offer",
  no_reply: "No reply",
  later: "Try later",
  closed: "Closed",
};

/** Where a piece of information came from. Every event carries one. */
export type Source =
  | "you"
  | "gmail"
  | "outlook"
  | "imap"
  | "calendar"
  | "call"
  | "linkedin"
  | "seek"
  | "careers"
  | "agent"
  | "import"
  | "auto"
  | "demo";

export const SOURCE_LABEL: Record<Source, string> = {
  you: "You",
  gmail: "Gmail",
  outlook: "Outlook",
  imap: "Email",
  calendar: "Calendar",
  call: "From a call",
  linkedin: "LinkedIn",
  seek: "Seek",
  careers: "Careers page",
  agent: "Claude",
  import: "Pipeline Desk",
  auto: "Pursuit (automatic)",
  demo: "Demo",
};

export type FieldType = "text" | "number" | "stage";

/**
 * Job fields that events may set. Anything not listed here can't be changed
 * through the event engine, which also keeps the SQL column names whitelisted.
 */
export const JOB_FIELDS = {
  title: { label: "Title", type: "text" },
  url: { label: "Job link", type: "text" },
  location: { label: "Location", type: "text" },
  stage: { label: "Stage", type: "stage" },
  stage_detail: { label: "Stage detail", type: "text" },
  closed_reason: { label: "Reason (try later / closed)", type: "text" },
  rank: { label: "Your rank", type: "number" },
  fit: { label: "Fit score", type: "number" },
  base_k: { label: "Base", type: "number" },
  variable_k: { label: "Variable", type: "number" },
  quota_k: { label: "Quota", type: "number" },
  equity: { label: "Equity", type: "text" },
  acv: { label: "Average deal size", type: "text" },
  sales_cycle: { label: "Sales cycle", type: "text" },
  segment: { label: "Segment", type: "text" },
  territory: { label: "Territory", type: "text" },
  team_size: { label: "Team", type: "text" },
  ramp: { label: "Ramp", type: "text" },
  attainment: { label: "Team attainment", type: "text" },
  rating_culture: { label: "Culture rating", type: "number" },
  rating_product: { label: "Product rating", type: "number" },
  rating_cash: { label: "Cash rating", type: "number" },
  rating_growth: { label: "Growth rating", type: "number" },
} as const satisfies Record<string, { label: string; type: FieldType }>;

export type JobField = keyof typeof JOB_FIELDS;
export type FieldValue = string | number | null;
export type Facts = Partial<Record<JobField, FieldValue>>;

export function isJobField(name: string): name is JobField {
  return Object.prototype.hasOwnProperty.call(JOB_FIELDS, name);
}

export interface Company {
  id: number;
  name: string;
  domain: string | null;
  color: string;
  summary: string | null;
  funding_stage: string | null;
  headcount: string | null;
  hq: string | null;
  glassdoor: string | null;
  careers_url: string | null;
  logo_url: string | null;
}

export interface Job {
  id: number;
  company_id: number;
  title: string;
  url: string | null;
  location: string | null;
  stage: Stage;
  stage_detail: string | null;
  closed_reason: string | null;
  rank: number | null;
  fit: number | null;
  base_k: number | null;
  variable_k: number | null;
  quota_k: number | null;
  equity: string | null;
  acv: string | null;
  sales_cycle: string | null;
  segment: string | null;
  territory: string | null;
  team_size: string | null;
  ramp: string | null;
  attainment: string | null;
  rating_culture: number | null;
  rating_product: number | null;
  rating_cash: number | null;
  rating_growth: number | null;
  notes: string;
  jd: string | null;
  created_at: string;
  updated_at: string;
  updated_source: Source | null;
}

export interface RoleRow extends Job {
  company_name: string;
  company_color: string;
  company_logo: string | null;
  next_task_id: number | null;
  next_task: string | null;
  next_task_due: string | null;
  next_task_kind: TaskKind | null;
  next_interview_id: number | null;
  next_interview: string | null;
  next_interview_at: string | null;
  next_interview_round: number | null;
  rounds_total: number;
  rounds_done: number;
}

export interface Task {
  id: number;
  job_id: number;
  title: string;
  due_at: string | null;
  done_at: string | null;
  source: Source;
  created_at: string;
  kind: TaskKind;
}

/** A plain next step, or a call booked in with someone. (Interviews are their own records.) */
export type TaskKind = "task" | "call";

export interface Interview {
  id: number;
  job_id: number;
  round: number;
  name: string;
  starts_at: string | null;
  duration_min: number | null;
  format: string | null;
  attendees: string | null;
  status: "scheduled" | "done" | "cancelled";
  debrief: string | null;
}

export interface Contact {
  id: number;
  company_id: number;
  job_id: number | null;
  name: string;
  title: string | null;
  email: string | null;
  role: string | null;
  notes: string | null;
  last_contact_at: string | null;
}

export interface Change {
  id: number;
  event_id: number;
  job_id: number;
  field: JobField;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  undone_at: string | null;
}

export interface EventRow {
  id: number;
  job_id: number | null;
  kind: string;
  source: Source;
  occurred_at: string;
  title: string;
  body: string | null;
  payload: string | null;
  company_name: string | null;
  company_color: string | null;
  company_logo: string | null;
  job_title: string | null;
  changes: Change[];
}

export interface SourceStatus {
  name: string;
  label: string;
  status: "connected" | "not_connected" | "error";
  last_sync_at: string | null;
  error: string | null;
}
