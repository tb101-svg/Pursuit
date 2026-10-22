import "server-only";
import { connectedAccount as googleAccount } from "../google/auth";
import { durationMin, listEvents as listGoogleEvents, meetingFormat } from "../google/calendar";
import { connectedAccount as microsoftAccount, graphGet } from "../microsoft/auth";

/** A calendar event, the same shape whichever calendar it came from. */
export interface CalEvent {
  id: string;
  cancelled: boolean;
  summary: string;
  startsAt: string | null; // ISO; null for all-day events
  durationMin: number | null;
  format: string | null;
  attendees: { email: string; name: string | null; self: boolean }[];
  link: string | null;
}

export interface CalendarProvider {
  name: "google_calendar" | "outlook_calendar";
  label: string;
  selfEmail(): string | null;
  list(from: Date, to: Date): Promise<CalEvent[]>;
  /** Whether deleted events come back marked cancelled (Google) or simply disappear (Outlook). */
  reportsDeletions: boolean;
}

export const googleCalendar: CalendarProvider = {
  name: "google_calendar",
  label: "Google Calendar",
  selfEmail: () => googleAccount()?.email ?? null,
  reportsDeletions: true,
  async list(from, to) {
    const self = googleAccount()?.email.toLowerCase() ?? "";
    return (await listGoogleEvents(from, to)).map((e) => ({
      id: e.id,
      cancelled: e.status === "cancelled",
      summary: e.summary ?? "",
      startsAt: e.start?.dateTime ? new Date(e.start.dateTime).toISOString() : null,
      durationMin: durationMin(e),
      format: meetingFormat(e),
      attendees: (e.attendees ?? []).map((a) => ({ email: a.email.toLowerCase(), name: a.displayName ?? null, self: !!a.self || a.email.toLowerCase() === self })),
      link: e.htmlLink ?? null,
    }));
  },
};

interface GraphEvent {
  id: string;
  subject?: string;
  isCancelled?: boolean;
  isAllDay?: boolean;
  start?: { dateTime: string };
  end?: { dateTime: string };
  attendees?: { emailAddress: { name?: string; address?: string } }[];
  organizer?: { emailAddress: { name?: string; address?: string } };
  webLink?: string;
  location?: { displayName?: string };
  onlineMeetingProvider?: string;
  onlineMeeting?: { joinUrl?: string } | null;
  bodyPreview?: string;
}

// Graph returns UTC times without a zone suffix when asked for UTC.
const utc = (s: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`).toISOString();

function outlookFormat(e: GraphEvent): string | null {
  const text = `${e.onlineMeeting?.joinUrl ?? ""} ${e.location?.displayName ?? ""} ${e.bodyPreview ?? ""}`.toLowerCase();
  if (text.includes("zoom.us")) return "Zoom";
  if (text.includes("teams.microsoft.com") || e.onlineMeetingProvider === "teamsForBusiness") return "Teams";
  if (text.includes("meet.google.com")) return "Google Meet";
  const loc = e.location?.displayName;
  return loc ? (loc.length > 40 ? "In person" : loc) : null;
}

export const outlookCalendar: CalendarProvider = {
  name: "outlook_calendar",
  label: "Outlook calendar",
  selfEmail: () => microsoftAccount()?.email ?? null,
  reportsDeletions: false,
  async list(from, to) {
    const self = microsoftAccount()?.email.toLowerCase() ?? "";
    const params = new URLSearchParams({
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
      $select: "id,subject,isCancelled,isAllDay,start,end,attendees,organizer,webLink,location,onlineMeetingProvider,onlineMeeting,bodyPreview",
      $top: "100",
    });
    const out: CalEvent[] = [];
    let url: string | undefined = `https://graph.microsoft.com/v1.0/me/calendarView?${params}`;
    while (url) {
      const page: { value: GraphEvent[]; "@odata.nextLink"?: string } = await graphGet(url, ['outlook.timezone="UTC"']);
      for (const e of page.value) {
        const people = [...(e.attendees ?? []), ...(e.organizer ? [e.organizer] : [])]
          .filter((a) => a.emailAddress?.address)
          .map((a) => ({ email: a.emailAddress.address!.toLowerCase(), name: a.emailAddress.name ?? null, self: a.emailAddress.address!.toLowerCase() === self }));
        const unique = [...new Map(people.map((p) => [p.email, p])).values()];
        const start = e.start?.dateTime && !e.isAllDay ? utc(e.start.dateTime) : null;
        const end = e.end?.dateTime && !e.isAllDay ? utc(e.end.dateTime) : null;
        out.push({
          id: e.id,
          cancelled: !!e.isCancelled,
          summary: (e.subject ?? "").replace(/^Canceled:\s*/i, ""),
          startsAt: start,
          durationMin: start && end ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000) : null,
          format: outlookFormat(e),
          attendees: unique,
          link: e.webLink ?? null,
        });
      }
      url = page["@odata.nextLink"];
    }
    return out;
  },
};

export const CALENDAR_PROVIDERS = [outlookCalendar, googleCalendar];
export const connectedCalendars = () => CALENDAR_PROVIDERS.filter((p) => p.selfEmail() !== null);
