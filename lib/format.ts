/**
 * Display helpers. Every one takes an explicit timezone rather than relying on
 * the runtime default — server rendering happens in UTC on Vercel, so a date
 * formatted without a zone would show the wrong day to half the world.
 */

export function formatTime(instant: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instant));
}

export function formatDayHeading(instant: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(instant));
}

/** `Aug 19, 11:59 PM` — compact enough for a deadline in a list row. */
export function formatDeadline(instant: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instant));
}

/** `2h 30m`, `45m`, `3h`. Minutes are the scheduler's unit; humans read hours. */
export function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

/** `in 3 days`, `tomorrow`, `2 days ago`. Null input yields "no deadline". */
export function formatRelativeDay(
  instant: Date | string | null,
  now: Date,
): string {
  if (!instant) return "no deadline";
  const days = Math.round(
    (new Date(instant).getTime() - now.getTime()) / 86_400_000,
  );
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

/** Minutes from local midnight as `18:30`, for the availability editor. */
export function formatMinuteOfDay(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
