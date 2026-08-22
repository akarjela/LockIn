import { describe, expect, it } from "vitest";

import { toCalendarEventRow, type GoogleEvent } from "@/lib/google/calendar";
import { expiryFromNow, hasScope, needsRefresh } from "@/lib/google/oauth";

/**
 * The sync's decisions all live in one pure function, so they can be tested the
 * way the scheduler is: no network, no database, no clock.
 *
 * What is being pinned here is the definition of *busy*. Getting it wrong is not
 * a visible failure — an over-eager rule silently deletes free time, and work
 * just quietly stops fitting into the week.
 */

const TZ = "America/New_York";

function timed(overrides: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: "evt1",
    summary: "Standup",
    start: { dateTime: "2026-08-18T09:00:00-04:00" },
    end: { dateTime: "2026-08-18T09:30:00-04:00" },
    ...overrides,
  };
}

describe("toCalendarEventRow", () => {
  it("maps a timed event to a busy row", () => {
    const row = toCalendarEventRow(timed(), "primary", TZ);

    expect(row).toEqual({
      external_id: "primary::evt1",
      calendar_id: "primary",
      title: "Standup",
      starts_at: "2026-08-18T13:00:00.000Z",
      ends_at: "2026-08-18T13:30:00.000Z",
      is_busy: true,
    });
  });

  it("qualifies the id with the calendar it came from", () => {
    // The same invitation on two calendars carries the same Google id. Unqualified,
    // the (user_id, external_id) unique constraint would fold them into one row
    // that flip-flops between calendars on every sync.
    const a = toCalendarEventRow(timed(), "primary", TZ);
    const b = toCalendarEventRow(timed(), "team@group.calendar.google.com", TZ);

    expect(a!.external_id).not.toBe(b!.external_id);
  });

  it("stores an all-day event but does not let it block time", () => {
    // The asymmetry that decides this: a wrongly-busy all-day event silently
    // erases a whole day of availability, while a wrongly-free one costs
    // nothing that the availability template does not already express.
    const row = toCalendarEventRow(
      {
        id: "bday",
        summary: "Alice's birthday",
        start: { date: "2026-08-18" },
        end: { date: "2026-08-19" },
      },
      "primary",
      TZ,
    );

    expect(row).not.toBeNull();
    expect(row!.is_busy).toBe(false);
    // Google's all-day `end.date` is exclusive, so the row spans exactly one
    // local day — midnight to midnight in the user's zone, not in UTC.
    expect(row!.starts_at).toBe("2026-08-18T04:00:00.000Z");
    expect(row!.ends_at).toBe("2026-08-19T04:00:00.000Z");
  });

  it("resolves an all-day event across a DST change in local days, not 24h steps", () => {
    // 2026-03-08 is the US spring-forward. A three-day all-day event spans 71
    // hours, not 72, and only local-midnight arithmetic gets that right.
    const row = toCalendarEventRow(
      {
        id: "trip",
        start: { date: "2026-03-07" },
        end: { date: "2026-03-10" },
      },
      "primary",
      TZ,
    );

    const hours =
      (new Date(row!.ends_at).getTime() - new Date(row!.starts_at).getTime()) /
      3_600_000;
    expect(hours).toBe(71);
  });

  it("treats an event marked free as not busy", () => {
    const row = toCalendarEventRow(
      timed({ transparency: "transparent" }),
      "primary",
      TZ,
    );
    expect(row!.is_busy).toBe(false);
  });

  it("treats an invitation you declined as not busy", () => {
    const row = toCalendarEventRow(
      timed({ attendees: [{ self: true, responseStatus: "declined" }] }),
      "primary",
      TZ,
    );
    expect(row!.is_busy).toBe(false);
  });

  it("keeps an accepted invitation busy", () => {
    const row = toCalendarEventRow(
      timed({ attendees: [{ self: true, responseStatus: "accepted" }] }),
      "primary",
      TZ,
    );
    expect(row!.is_busy).toBe(true);
  });

  it("ignores someone else's declination", () => {
    // `maxAttendees=1` should mean only the signed-in user is listed, but the
    // rule must not depend on that holding.
    const row = toCalendarEventRow(
      timed({ attendees: [{ responseStatus: "declined" }] }),
      "primary",
      TZ,
    );
    expect(row!.is_busy).toBe(true);
  });

  it("treats a working-location marker as not busy", () => {
    const row = toCalendarEventRow(
      timed({ eventType: "workingLocation", summary: "Office" }),
      "primary",
      TZ,
    );
    expect(row!.is_busy).toBe(false);
  });

  it("drops cancelled events so the prune deletes any row they left", () => {
    expect(toCalendarEventRow(timed({ status: "cancelled" }), "primary", TZ)).toBeNull();
  });

  it("drops events the database would reject", () => {
    // A zero-length event violates `ends_at > starts_at`, and one malformed row
    // would fail the whole batch upsert rather than just itself.
    const zeroLength = timed({
      end: { dateTime: "2026-08-18T09:00:00-04:00" },
    });
    expect(toCalendarEventRow(zeroLength, "primary", TZ)).toBeNull();

    const backwards = timed({
      start: { dateTime: "2026-08-18T10:00:00-04:00" },
      end: { dateTime: "2026-08-18T09:00:00-04:00" },
    });
    expect(toCalendarEventRow(backwards, "primary", TZ)).toBeNull();

    expect(toCalendarEventRow(timed({ start: {}, end: {} }), "primary", TZ)).toBeNull();
    expect(toCalendarEventRow(timed({ id: undefined }), "primary", TZ)).toBeNull();
  });

  it("normalises a missing or blank title to null", () => {
    expect(toCalendarEventRow(timed({ summary: undefined }), "primary", TZ)!.title)
      .toBeNull();
    expect(toCalendarEventRow(timed({ summary: "   " }), "primary", TZ)!.title)
      .toBeNull();
  });
});

describe("token expiry", () => {
  const now = new Date("2026-08-18T12:00:00Z");

  it("refreshes before the token actually dies", () => {
    // A sync walks several calendars, so a token with a minute left would expire
    // partway through and fail the rest of the pages.
    expect(needsRefresh(new Date("2026-08-18T12:00:30Z"), now)).toBe(true);
    expect(needsRefresh(new Date("2026-08-18T11:00:00Z"), now)).toBe(true);
    expect(needsRefresh(new Date("2026-08-18T12:30:00Z"), now)).toBe(false);
  });

  it("falls back to Google's documented hour for a nonsense lifetime", () => {
    expect(expiryFromNow(3600, now).toISOString()).toBe("2026-08-18T13:00:00.000Z");
    expect(expiryFromNow(Number.NaN, now).toISOString()).toBe("2026-08-18T13:00:00.000Z");
    expect(expiryFromNow(-1, now).toISOString()).toBe("2026-08-18T13:00:00.000Z");
  });
});

describe("hasScope", () => {
  const CALENDAR = "https://www.googleapis.com/auth/calendar.readonly";

  it("matches whole scopes only", () => {
    expect(hasScope(`openid email ${CALENDAR}`, CALENDAR)).toBe(true);
    expect(hasScope("openid email", CALENDAR)).toBe(false);
    expect(hasScope(null, CALENDAR)).toBe(false);
    // A prefix match would accept `.../calendar.readonly.extra` — a scope that
    // does not exist today, but the check costs nothing.
    expect(hasScope(`${CALENDAR}.extra`, CALENDAR)).toBe(false);
  });
});
