import { randomUUID } from "node:crypto";

import { listAvailability, listBusyEvents } from "@/lib/db/availability";
import { listBlocks, replacePlan } from "@/lib/db/plan";
import { getSettings } from "@/lib/db/settings";
import { listOpenItems } from "@/lib/db/items";
import { computeFreeSlots } from "@/lib/schedule/availability";
import { generatePlan } from "@/lib/schedule";
import type { PlanResult } from "@/lib/schedule/types";
import { addDays, toZonedDate, zonedTimeToInstant } from "@/lib/schedule/tz";

/** How far ahead a plan reaches. A rolling week, not a fixed Monday-to-Sunday. */
const HORIZON_DAYS = 7;

export interface PlanWindow {
  from: Date;
  to: Date;
}

/**
 * The window a plan covers: now until local midnight `HORIZON_DAYS` out.
 *
 * Ending on a local midnight rather than "now + 168h" keeps the last day whole,
 * so the week view never shows a final day that stops at an arbitrary time.
 */
export function planWindow(now: Date, timezone: string): PlanWindow {
  const endDay = addDays(toZonedDate(now, timezone), HORIZON_DAYS);
  return { from: now, to: zonedTimeToInstant(endDay, 0, timezone) };
}

/**
 * Loads everything the scheduler needs, runs it, and persists the result.
 *
 * The split matters: every decision happens in the pure engine, and this function
 * only moves data. That is what lets the whole scheduling behaviour be tested
 * without a database, and what will let the CLI reuse it unchanged.
 */
export async function regeneratePlan(
  userId: string,
  now = new Date(),
): Promise<PlanResult & { window: PlanWindow }> {
  const settings = await getSettings(userId);
  const window = planWindow(now, settings.timezone);

  const [template, busyEvents, existingBlocks, items] = await Promise.all([
    listAvailability(userId),
    listBusyEvents(userId, window.from, window.to),
    listBlocks(userId, window.from, window.to),
    listOpenItems(userId),
  ]);

  // Locked blocks are obstacles, not candidates — the user pinned them, so the
  // packer schedules around them exactly as it does a calendar event.
  const locked = existingBlocks.filter((block) => block.locked);

  const busy = [
    ...busyEvents.map((event) => ({
      start: new Date(event.starts_at),
      end: new Date(event.ends_at),
    })),
    ...locked.map((block) => ({
      start: new Date(block.starts_at),
      end: new Date(block.ends_at),
    })),
  ];

  // Time already committed per item. Counted from locked blocks only: the
  // unlocked ones are about to be deleted, and counting them would make each
  // regeneration believe the weekly target was already met and schedule nothing.
  const minutesAlready = new Map<string, number>();
  for (const block of locked) {
    const minutes =
      (new Date(block.ends_at).getTime() - new Date(block.starts_at).getTime()) /
      60_000;
    minutesAlready.set(
      block.item_id,
      (minutesAlready.get(block.item_id) ?? 0) + minutes,
    );
  }

  const freeSlots = computeFreeSlots({
    template,
    busy,
    from: window.from,
    to: window.to,
    now,
    timezone: settings.timezone,
    minSlotMinutes: settings.slot_minutes,
  });

  const result = generatePlan({
    now,
    from: window.from,
    to: window.to,
    timezone: settings.timezone,
    slotMinutes: settings.slot_minutes,
    breakMinutes: settings.break_minutes,
    dailyCapMinutes: settings.daily_cap_minutes,
    items,
    minutesAlready,
    freeSlots,
  });

  await replacePlan(
    userId,
    window.from,
    window.to,
    result.blocks,
    randomUUID(),
  );

  return { ...result, window };
}
