import { describe, expect, it } from "vitest";

import {
  computeFreeSlots,
  mergeIntervals,
  subtractIntervals,
  totalMinutes,
} from "@/lib/schedule/availability";
import type { AvailabilityBlock, Weekday } from "@/lib/db/types";

const NY = "America/New_York";

const at = (iso: string) => new Date(iso);
const span = (from: string, to: string) => ({ start: at(from), end: at(to) });

/** Weekly template row, with the ids the DB would supply. */
function block(
  weekday: Weekday,
  startHour: number,
  endHour: number,
): AvailabilityBlock {
  return {
    id: `av-${weekday}-${startHour}`,
    user_id: "u1",
    weekday,
    start_minute: startHour * 60,
    end_minute: endHour * 60,
    label: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("mergeIntervals", () => {
  it("merges overlapping and back-to-back intervals", () => {
    const merged = mergeIntervals([
      span("2026-08-18T10:00:00Z", "2026-08-18T11:00:00Z"),
      span("2026-08-18T10:30:00Z", "2026-08-18T12:00:00Z"),
      span("2026-08-18T12:00:00Z", "2026-08-18T13:00:00Z"),
      span("2026-08-18T15:00:00Z", "2026-08-18T16:00:00Z"),
    ]);

    expect(merged.map((i) => [i.start.toISOString(), i.end.toISOString()])).toEqual([
      ["2026-08-18T10:00:00.000Z", "2026-08-18T13:00:00.000Z"],
      ["2026-08-18T15:00:00.000Z", "2026-08-18T16:00:00.000Z"],
    ]);
  });
});

describe("subtractIntervals", () => {
  it("punches a hole in the middle", () => {
    const remaining = subtractIntervals(
      span("2026-08-18T09:00:00Z", "2026-08-18T17:00:00Z"),
      [span("2026-08-18T12:00:00Z", "2026-08-18T13:00:00Z")],
    );
    expect(remaining.map((i) => i.start.toISOString())).toEqual([
      "2026-08-18T09:00:00.000Z",
      "2026-08-18T13:00:00.000Z",
    ]);
  });

  it("returns nothing when fully covered", () => {
    expect(
      subtractIntervals(span("2026-08-18T09:00:00Z", "2026-08-18T10:00:00Z"), [
        span("2026-08-18T08:00:00Z", "2026-08-18T11:00:00Z"),
      ]),
    ).toEqual([]);
  });

  it("ignores busy intervals that do not overlap", () => {
    const remaining = subtractIntervals(
      span("2026-08-18T09:00:00Z", "2026-08-18T10:00:00Z"),
      [span("2026-08-18T20:00:00Z", "2026-08-18T21:00:00Z")],
    );
    expect(remaining).toHaveLength(1);
    expect(totalMinutes(remaining.map((i) => ({ ...i, dayKey: "x" })))).toBe(60);
  });
});

describe("computeFreeSlots", () => {
  it("expands a weekly template across the window in local time", () => {
    // Tuesday 18:00-21:00 local, for the week of Mon 17 Aug 2026.
    const slots = computeFreeSlots({
      template: [block(2, 18, 21)],
      busy: [],
      from: at("2026-08-17T04:00:00Z"),
      to: at("2026-08-24T04:00:00Z"),
      now: at("2026-08-17T04:00:00Z"),
      timezone: NY,
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].start.toISOString()).toBe("2026-08-18T22:00:00.000Z"); // 18:00 EDT
    expect(slots[0].dayKey).toBe("2026-08-18");
    expect(totalMinutes(slots)).toBe(180);
  });

  it("subtracts busy calendar time from the template", () => {
    const slots = computeFreeSlots({
      template: [block(2, 18, 21)],
      busy: [span("2026-08-18T23:00:00Z", "2026-08-18T23:30:00Z")], // 19:00-19:30
      from: at("2026-08-17T04:00:00Z"),
      to: at("2026-08-24T04:00:00Z"),
      now: at("2026-08-17T04:00:00Z"),
      timezone: NY,
    });

    expect(slots).toHaveLength(2);
    expect(totalMinutes(slots)).toBe(150);
  });

  it("never returns time in the past", () => {
    const slots = computeFreeSlots({
      template: [block(2, 18, 21)],
      busy: [],
      from: at("2026-08-17T04:00:00Z"),
      to: at("2026-08-24T04:00:00Z"),
      now: at("2026-08-18T23:00:00Z"), // already 19:00 on the Tuesday
      timezone: NY,
    });

    expect(totalMinutes(slots)).toBe(120);
    expect(slots[0].start.toISOString()).toBe("2026-08-18T23:00:00.000Z");
  });

  it("drops gaps too short to be usable", () => {
    const slots = computeFreeSlots({
      template: [block(2, 18, 21)],
      // Leaves a 5-minute sliver at the start, then a solid stretch.
      busy: [span("2026-08-18T22:05:00Z", "2026-08-18T23:00:00Z")],
      from: at("2026-08-17T04:00:00Z"),
      to: at("2026-08-24T04:00:00Z"),
      now: at("2026-08-17T04:00:00Z"),
      timezone: NY,
      minSlotMinutes: 15,
    });

    expect(slots).toHaveLength(1);
    expect(totalMinutes(slots)).toBe(120);
  });
});
