/**
 * Timezone arithmetic, built on `Intl` so the app carries no date dependency.
 *
 * The whole scheduler rests on one distinction: availability is *wall-clock*
 * ("Tuesdays, 18:00-21:00"), while deadlines and scheduled blocks are *instants*.
 * Converting between them is the only place a timezone is allowed to matter, and
 * that conversion lives here.
 */

/** Local calendar date in a given zone. Month is 1-12, matching how humans write it. */
export interface ZonedDate {
  year: number;
  month: number;
  day: number;
  /** 0 = Sunday .. 6 = Saturday. */
  weekday: number;
}

const PART_FORMATTER = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = PART_FORMATTER.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    PART_FORMATTER.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function partsOf(instant: Date, timeZone: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    parts[part.type] = part.value;
  }
  return parts;
}

/**
 * The zone's UTC offset in milliseconds at a given instant.
 *
 * Derived by formatting the instant in the zone and reading the result back as
 * if it were UTC; the difference is the offset. This is the standard trick and
 * it handles DST because `Intl` already did.
 */
export function offsetMs(instant: Date, timeZone: string): number {
  const p = partsOf(instant, timeZone);
  const asIfUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  // `instant` carries milliseconds the formatter dropped; ignore them so the
  // offset comes out as a clean number rather than offset-minus-a-few-ms.
  return asIfUtc - (instant.getTime() - instant.getMilliseconds());
}

/** The local calendar date an instant falls on, in the given zone. */
export function toZonedDate(instant: Date, timeZone: string): ZonedDate {
  const p = partsOf(instant, timeZone);
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    weekday: WEEKDAY_INDEX[p.weekday] ?? 0,
  };
}

/**
 * The instant at which `minutes` past local midnight occurs on `date` in `timeZone`.
 *
 * Two passes: guess using the offset at local-midnight-treated-as-UTC, then
 * re-resolve using the offset at the guessed instant. Across a DST transition the
 * two differ, and the second pass is the correct one. Times that do not exist
 * (the spring-forward gap) resolve to the instant just after the jump, which is
 * the least surprising behaviour for "schedule me at 2:30am".
 */
export function zonedTimeToInstant(
  date: Pick<ZonedDate, "year" | "month" | "day">,
  minutes: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(date.year, date.month - 1, date.day, 0, minutes);
  const firstGuess = naive - offsetMs(new Date(naive), timeZone);
  const corrected = naive - offsetMs(new Date(firstGuess), timeZone);
  return new Date(corrected);
}

/** Adds whole days to a local calendar date, normalising month/year rollover. */
export function addDays(date: ZonedDate, days: number): ZonedDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/** `2026-08-18` — stable key for grouping blocks by local day. */
export function dateKey(date: ZonedDate): string {
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${date.year}-${month}-${day}`;
}
