import type { AvailabilityBlock } from "@/lib/db/types";
import type { FreeSlot } from "@/lib/schedule/types";
import {
  addDays,
  dateKey,
  toZonedDate,
  zonedTimeToInstant,
} from "@/lib/schedule/tz";

/** Half-open interval [start, end). */
export interface Interval {
  start: Date;
  end: Date;
}

/**
 * Merges overlapping and touching intervals into a minimal sorted set.
 *
 * Touching counts as overlapping: two back-to-back meetings are one busy stretch,
 * and leaving them separate would let a zero-length gap survive into the packer.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const merged: Interval[] = [{ ...sorted[0] }];

  for (const current of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (current.start.getTime() <= last.end.getTime()) {
      if (current.end.getTime() > last.end.getTime()) last.end = current.end;
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/**
 * `base` minus every interval in `busy`.
 *
 * `busy` need not be sorted or disjoint — it is merged first — so callers can
 * concatenate calendar events and locked blocks without pre-processing.
 */
export function subtractIntervals(
  base: Interval,
  busy: Interval[],
): Interval[] {
  const remaining: Interval[] = [];
  let cursor = base.start.getTime();
  const end = base.end.getTime();

  for (const block of mergeIntervals(busy)) {
    const blockStart = block.start.getTime();
    const blockEnd = block.end.getTime();

    if (blockEnd <= cursor) continue; // entirely before what is left
    if (blockStart >= end) break; // merged list is sorted, so we are done

    if (blockStart > cursor) {
      remaining.push({ start: new Date(cursor), end: new Date(blockStart) });
    }
    cursor = Math.max(cursor, blockEnd);
    if (cursor >= end) return remaining;
  }

  if (cursor < end) remaining.push({ start: new Date(cursor), end: new Date(end) });
  return remaining;
}

/**
 * Expands the recurring weekly template into concrete free slots across a window,
 * then removes everything already spoken for.
 *
 * Walks local calendar days rather than adding 24h repeatedly: across a DST
 * change a "day" is 23 or 25 hours, and "Tuesday 18:00" must stay 18:00 either way.
 *
 * @param busy Calendar events and locked blocks — anything the packer must avoid.
 */
export function computeFreeSlots({
  template,
  busy,
  from,
  to,
  now,
  timezone,
  minSlotMinutes = 15,
}: {
  template: AvailabilityBlock[];
  busy: Interval[];
  from: Date;
  to: Date;
  now: Date;
  timezone: string;
  minSlotMinutes?: number;
}): FreeSlot[] {
  // Nothing can be scheduled in the past, so the window never opens before now.
  const windowStart = new Date(Math.max(from.getTime(), now.getTime()));
  if (windowStart >= to) return [];

  const byWeekday = new Map<number, AvailabilityBlock[]>();
  for (const block of template) {
    const list = byWeekday.get(block.weekday) ?? [];
    list.push(block);
    byWeekday.set(block.weekday, list);
  }

  const slots: FreeSlot[] = [];
  // Start a day early: a template block ending at 1440 belongs to the previous
  // local day but can still overlap the window's opening moments.
  let day = addDays(toZonedDate(windowStart, timezone), -1);
  const lastDay = addDays(toZonedDate(to, timezone), 1);
  const lastKey = dateKey(lastDay);

  for (let guard = 0; guard < 400; guard++) {
    const key = dateKey(day);
    for (const block of byWeekday.get(day.weekday) ?? []) {
      const start = zonedTimeToInstant(day, block.start_minute, timezone);
      const end = zonedTimeToInstant(day, block.end_minute, timezone);

      const clippedStart = new Date(
        Math.max(start.getTime(), windowStart.getTime()),
      );
      const clippedEnd = new Date(Math.min(end.getTime(), to.getTime()));
      if (clippedEnd <= clippedStart) continue;

      for (const free of subtractIntervals(
        { start: clippedStart, end: clippedEnd },
        busy,
      )) {
        const minutes = (free.end.getTime() - free.start.getTime()) / 60_000;
        // A four-minute gap between two meetings is not usable study time.
        if (minutes >= minSlotMinutes) {
          slots.push({ start: free.start, end: free.end, dayKey: key });
        }
      }
    }

    if (key === lastKey) break;
    day = addDays(day, 1);
  }

  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Total usable minutes across a set of slots. */
export function totalMinutes(slots: FreeSlot[]): number {
  return slots.reduce(
    (sum, slot) => sum + (slot.end.getTime() - slot.start.getTime()) / 60_000,
    0,
  );
}
