import { describe, expect, it } from "vitest";

import {
  addDays,
  dateKey,
  offsetMs,
  toZonedDate,
  zonedTimeToInstant,
} from "@/lib/schedule/tz";

const NY = "America/New_York";

describe("offsetMs", () => {
  it("reports standard and daylight offsets for the same zone", () => {
    expect(offsetMs(new Date("2026-01-15T12:00:00Z"), NY)).toBe(-5 * 3_600_000);
    expect(offsetMs(new Date("2026-07-15T12:00:00Z"), NY)).toBe(-4 * 3_600_000);
  });
});

describe("zonedTimeToInstant", () => {
  it("resolves a wall-clock time to the right instant in winter", () => {
    const instant = zonedTimeToInstant(
      { year: 2026, month: 1, day: 15 },
      18 * 60,
      NY,
    );
    expect(instant.toISOString()).toBe("2026-01-15T23:00:00.000Z");
  });

  it("keeps the same wall-clock time across the DST boundary", () => {
    // 8 March 2026 is the US spring-forward. 18:00 local must stay 18:00 local
    // on both sides, which means the UTC instants differ by 23 hours, not 24.
    const before = zonedTimeToInstant({ year: 2026, month: 3, day: 7 }, 18 * 60, NY);
    const after = zonedTimeToInstant({ year: 2026, month: 3, day: 8 }, 18 * 60, NY);

    expect(before.toISOString()).toBe("2026-03-07T23:00:00.000Z");
    expect(after.toISOString()).toBe("2026-03-08T22:00:00.000Z");
    expect(after.getTime() - before.getTime()).toBe(23 * 3_600_000);
  });

  it("round-trips through toZonedDate", () => {
    const instant = zonedTimeToInstant({ year: 2026, month: 8, day: 18 }, 9 * 60, NY);
    const zoned = toZonedDate(instant, NY);
    expect(dateKey(zoned)).toBe("2026-08-18");
    expect(zoned.weekday).toBe(2); // Tuesday
  });
});

describe("addDays", () => {
  it("rolls over month and year boundaries", () => {
    expect(dateKey(addDays({ year: 2026, month: 12, day: 31, weekday: 4 }, 1)))
      .toBe("2027-01-01");
    expect(dateKey(addDays({ year: 2026, month: 3, day: 1, weekday: 0 }, -1)))
      .toBe("2026-02-28");
  });
});
