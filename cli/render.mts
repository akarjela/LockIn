import type { Item, ScheduledBlock } from "@/lib/db/types";
import type { Unplaced } from "@/lib/schedule/types";
import { isRecurring, remainingMinutes } from "@/lib/db/types";
import {
  formatDayHeading,
  formatDeadline,
  formatDuration,
  formatRelativeDay,
  formatTime,
} from "@/lib/format";
import { dateKey, toZonedDate } from "@/lib/schedule/tz";

/**
 * Terminal output.
 *
 * Reuses `lib/format.ts` rather than reformatting dates here, so the CLI and the
 * web app describe the same block the same way. Every helper there takes an
 * explicit timezone, which is what makes them usable from a process whose own
 * clock is in some unrelated zone.
 */

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const paint = (code: string) => (text: string) =>
  useColor ? `\u001b[${code}m${text}\u001b[0m` : text;

export const dim = paint("2");
export const bold = paint("1");
export const green = paint("32");
export const yellow = paint("33");
export const red = paint("31");

/** Enough of a uuid to name a row on the command line without pasting 36 chars. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function renderWeek(
  blocks: ScheduledBlock[],
  items: Item[],
  timezone: string,
  now: Date,
): string {
  if (blocks.length === 0) {
    return dim("Nothing scheduled. Run `lockin plan` to build the week.");
  }

  const titles = new Map(items.map((item) => [item.id, item.title]));
  const lines: string[] = [];

  // Group by *local* day, which is the only grouping that matches what a person
  // means by "Tuesday" — a UTC-based one splits an evening across two headings
  // for anyone west of Greenwich.
  const byDay = new Map<string, ScheduledBlock[]>();
  for (const block of blocks) {
    const key = dateKey(toZonedDate(new Date(block.starts_at), timezone));
    const list = byDay.get(key) ?? [];
    list.push(block);
    byDay.set(key, list);
  }

  const todayKey = dateKey(toZonedDate(now, timezone));

  for (const [key, dayBlocks] of byDay) {
    const heading = formatDayHeading(dayBlocks[0].starts_at, timezone);
    const dayMinutes = dayBlocks.reduce(
      (sum, block) =>
        sum +
        (new Date(block.ends_at).getTime() -
          new Date(block.starts_at).getTime()) /
          60_000,
      0,
    );

    lines.push("");
    lines.push(
      `${bold(heading)}${key === todayKey ? green("  · today") : ""}  ${dim(
        formatDuration(dayMinutes),
      )}`,
    );

    for (const block of dayBlocks) {
      const span = `${formatTime(block.starts_at, timezone)}–${formatTime(
        block.ends_at,
        timezone,
      )}`;
      const minutes =
        (new Date(block.ends_at).getTime() -
          new Date(block.starts_at).getTime()) /
        60_000;

      lines.push(
        `  ${span.padEnd(18)} ${
          titles.get(block.item_id) ?? dim("(deleted item)")
        } ${dim(formatDuration(minutes))}${
          block.locked ? yellow(" pinned") : ""
        }`,
      );
    }
  }

  return lines.join("\n").trimStart();
}

export function renderUnplaced(unplaced: Unplaced[]): string {
  if (unplaced.length === 0) return "";

  const explain: Record<Unplaced["reason"], string> = {
    "no-free-time": "no free time in the window",
    "past-deadline": "not enough free time before the deadline",
    "daily-cap": "every candidate day hit the daily cap",
    "below-min-block": "only fragments shorter than its minimum block remained",
  };

  const lines = [yellow("Could not fit:")];
  for (const item of unplaced) {
    lines.push(
      `  ${item.label} ${dim(
        `— ${formatDuration(item.minutesShort)} short, ${explain[item.reason]}`,
      )}`,
    );
  }
  return lines.join("\n");
}

export function renderItems(
  items: Item[],
  timezone: string,
  now: Date,
): string {
  if (items.length === 0) {
    return dim("Nothing on the list. Add something with `lockin add`.");
  }

  const lines: string[] = [];
  for (const item of items) {
    const workload = isRecurring(item)
      ? `${formatDuration(item.target_minutes_per_week ?? 0)}/week`
      : `${formatDuration(remainingMinutes(item))} left`;

    const due = item.due_at
      ? `${formatDeadline(item.due_at, timezone)} (${formatRelativeDay(
          item.due_at,
          now,
        )})`
      : "no deadline";

    const overdue = item.due_at && new Date(item.due_at) < now;

    lines.push(
      `${dim(shortId(item.id))}  ${item.title.padEnd(34)} ${workload.padEnd(
        14,
      )} ${overdue ? red(due) : dim(due)}`,
    );
  }
  return lines.join("\n");
}
