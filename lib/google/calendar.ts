import type { CalendarEvent } from "@/lib/db/types";
import { CalendarAuthError } from "@/lib/google/env";
import { zonedTimeToInstant } from "@/lib/schedule/tz";

/**
 * The Google Calendar half of the sync: which calendars to read, and how a
 * Google event becomes a row this schema can store.
 *
 * The interesting part is `toCalendarEventRow`, which is pure and carries every
 * judgement call about what "busy" means. It is tested directly, with no
 * network — the same split the scheduler uses, for the same reason.
 */

const API = "https://www.googleapis.com/calendar/v3";

/** Google caps a page at 2500; 250 keeps each response small and is plenty. */
const PAGE_SIZE = 250;

/** A week of events never needs more. The cap exists so a bug cannot loop forever. */
const MAX_PAGES = 10;

export interface GoogleEventTime {
  /** RFC3339 instant, for a timed event. */
  dateTime?: string;
  /** `YYYY-MM-DD`, for an all-day event. Exclusive on `end`. */
  date?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id?: string;
  status?: string;
  summary?: string;
  transparency?: string;
  eventType?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  /** Requested with `maxAttendees=1`, so this holds the signed-in user or nobody. */
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
}

export interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  primary?: boolean;
  selected?: boolean;
  deleted?: boolean;
  accessRole?: string;
}

/** A row ready for `calendar_events`, minus the columns the database owns. */
export type NewCalendarEvent = Pick<
  CalendarEvent,
  "external_id" | "calendar_id" | "title" | "starts_at" | "ends_at" | "is_busy"
>;

/** `YYYY-MM-DD` from an all-day event's `date` field. */
function parseDateOnly(value: string): { year: number; month: number; day: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function parseInstant(value: string): Date | null {
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * Turns one Google event into a row, or null if it should not be stored at all.
 *
 * **Busy is not the same as "on the calendar."** Four kinds of event show up in
 * a calendar and must not erase study time:
 *
 *  - *All-day events.* "Alice's birthday", "Sprint 14", "Term starts" — treating
 *    those as busy would delete an entire day of availability for something that
 *    occupies none of it. Stored, never blocking. The cost of being wrong here
 *    is asymmetric: a spurious blocked day is invisible (work just silently does
 *    not fit), while a real all-day commitment is something you would also
 *    remove from your availability template.
 *  - *Transparent events*, which Google literally labels "free".
 *  - *Invitations you declined.* Requested with `maxAttendees=1`, so the
 *    attendee list is just you.
 *  - *Working-location markers*, which are metadata rather than commitments.
 *
 * Cancelled events return null so the pruning pass deletes any row they left
 * behind.
 *
 * @param timezone The *user's* planning zone, not the calendar's. An all-day
 *        event means "that day where you are", which is the frame the rest of
 *        the scheduler already works in.
 */
export function toCalendarEventRow(
  event: GoogleEvent,
  calendarId: string,
  timezone: string,
): NewCalendarEvent | null {
  if (!event.id || event.status === "cancelled") return null;

  const allDay = Boolean(event.start?.date);

  let startsAt: Date | null;
  let endsAt: Date | null;

  if (allDay) {
    const startDate = parseDateOnly(event.start!.date!);
    // Google's all-day `end.date` is exclusive, so it already names local
    // midnight *after* the event — no +1 needed here.
    const endDate = event.end?.date ? parseDateOnly(event.end.date) : null;
    if (!startDate || !endDate) return null;

    startsAt = zonedTimeToInstant(startDate, 0, timezone);
    endsAt = zonedTimeToInstant(endDate, 0, timezone);
  } else {
    if (!event.start?.dateTime || !event.end?.dateTime) return null;
    startsAt = parseInstant(event.start.dateTime);
    endsAt = parseInstant(event.end.dateTime);
  }

  // A zero-length or backwards event would be rejected by the `ends_at >
  // starts_at` check constraint, which would fail the whole batch insert for one
  // malformed event. Drop it here instead.
  if (!startsAt || !endsAt || endsAt.getTime() <= startsAt.getTime()) return null;

  const declined = event.attendees?.some(
    (attendee) => attendee.self && attendee.responseStatus === "declined",
  );

  const isBusy =
    !allDay &&
    event.transparency !== "transparent" &&
    event.eventType !== "workingLocation" &&
    !declined;

  return {
    // Event ids are unique per calendar, not per account: the same invitation
    // sitting on two of your calendars carries the same id. Qualifying it keeps
    // the `(user_id, external_id)` unique constraint from collapsing the two
    // into one row that flip-flops on every sync.
    external_id: `${calendarId}::${event.id}`,
    calendar_id: calendarId,
    title: event.summary?.trim() || null,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    is_busy: isBusy,
  };
}

async function googleFetch<T>(
  url: string,
  accessToken: string,
): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (response.ok) return (await response.json()) as T;

  // 401 means the token is bad; 403 usually means the calendar scope was never
  // granted. Both are fixed by reconnecting, and neither is worth retrying.
  if (response.status === 401 || response.status === 403) {
    throw new CalendarAuthError(
      "Google refused the request (" +
        response.status +
        "). Reconnect Google Calendar and make sure the calendar permission is ticked.",
    );
  }

  const body = await response.text().catch(() => "");
  throw new Error(
    `Google Calendar request failed (${response.status}): ${body.slice(0, 200)}`,
  );
}

/**
 * The calendars to sync: the primary one, plus anything the user has ticked in
 * the Google Calendar sidebar.
 *
 * `selected` is what "showing in my calendar" means, and it is the closest thing
 * to the user's own idea of which commitments are theirs. Primary is included
 * unconditionally — it can be unticked, but a plan that ignored it would be
 * wrong in a way nobody would predict.
 *
 * `freeBusyReader` calendars are skipped: `events.list` returns nothing useful
 * for them, so they would cost a round trip per sync for no rows.
 */
export async function listSyncableCalendars(
  accessToken: string,
): Promise<GoogleCalendarListEntry[]> {
  const url = new URL(`${API}/users/me/calendarList`);
  url.searchParams.set("minAccessRole", "reader");
  url.searchParams.set("showDeleted", "false");
  url.searchParams.set("maxResults", "250");

  const payload = await googleFetch<{ items?: GoogleCalendarListEntry[] }>(
    url.toString(),
    accessToken,
  );

  return (payload.items ?? []).filter(
    (calendar) =>
      !calendar.deleted &&
      calendar.accessRole !== "freeBusyReader" &&
      (calendar.primary === true || calendar.selected === true),
  );
}

/**
 * Every event on one calendar that overlaps [from, to).
 *
 * `singleEvents=true` is not optional: without it a weekly lecture arrives as
 * one recurrence rule and would block nothing. With it, Google expands the rule
 * into concrete instances and applies every exception and cancellation, which is
 * an entire class of date arithmetic we do not have to own.
 *
 * `maxAttendees=1` trims a 40-person invite down to just your own attendance —
 * the only line we read — and keeps responses small.
 */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  from: Date,
  to: Date,
): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(
      `${API}/calendars/${encodeURIComponent(calendarId)}/events`,
    );
    url.searchParams.set("timeMin", from.toISOString());
    url.searchParams.set("timeMax", to.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("maxAttendees", "1");
    url.searchParams.set("maxResults", String(PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const payload = await googleFetch<{
      items?: GoogleEvent[];
      nextPageToken?: string;
    }>(url.toString(), accessToken);

    events.push(...(payload.items ?? []));

    pageToken = payload.nextPageToken;
    if (!pageToken) break;
  }

  return events;
}
