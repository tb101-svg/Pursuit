import "server-only";
import { googleGet } from "./auth";

export interface CalendarEvent {
  id: string;
  status: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email: string; displayName?: string; self?: boolean; organizer?: boolean }[];
  organizer?: { email: string; displayName?: string; self?: boolean };
  updated: string;
}

/** Events on your primary calendar in a window, including cancelled ones. */
export async function listEvents(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
  const out: CalendarEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: "true",
      showDeleted: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await googleGet<{ items?: CalendarEvent[]; nextPageToken?: string }>(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    );
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

export function durationMin(e: CalendarEvent): number | null {
  const s = e.start?.dateTime;
  const en = e.end?.dateTime;
  if (!s || !en) return null;
  return Math.round((new Date(en).getTime() - new Date(s).getTime()) / 60_000);
}

export function meetingFormat(e: CalendarEvent): string | null {
  const text = `${e.location ?? ""} ${e.description ?? ""} ${e.hangoutLink ?? ""}`.toLowerCase();
  if (text.includes("zoom.us")) return "Zoom";
  if (text.includes("meet.google.com")) return "Google Meet";
  if (text.includes("teams.microsoft.com")) return "Teams";
  if (e.location) return e.location.length > 40 ? "In person" : e.location;
  return null;
}
