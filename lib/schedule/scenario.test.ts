import { describe, expect, it } from "vitest";

import type { AvailabilityBlock, Task, Topic, Weekday } from "@/lib/db/types";
import { computeFreeSlots, totalMinutes } from "@/lib/schedule/availability";
import { generatePlan } from "@/lib/schedule";
import { zonedTimeToInstant } from "@/lib/schedule/tz";

/**
 * One realistic week, end to end: weekly template -> minus calendar -> scored
 * candidates -> packed plan. Exists to catch the failures unit tests miss, where
 * every part is individually right and the composition still produces a week no
 * human would accept.
 *
 * Run `npm test -- --reporter=verbose` to read the printed week.
 */

const TZ = "America/New_York";
// Monday 17 August 2026, 09:00 local.
const NOW = zonedTimeToInstant({ year: 2026, month: 8, day: 17 }, 9 * 60, TZ);
const WEEK_END = zonedTimeToInstant({ year: 2026, month: 8, day: 24 }, 0, TZ);

let seq = 0;
const id = (prefix: string) => `${prefix}-${(seq++).toString().padStart(2, "0")}`;

function availability(
  weekday: Weekday,
  startHour: number,
  endHour: number,
  label: string,
): AvailabilityBlock {
  return {
    id: id("av"),
    user_id: "u1",
    weekday,
    start_minute: startHour * 60,
    end_minute: endHour * 60,
    label,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function localInstant(day: number, hour: number, minute = 0): Date {
  return zonedTimeToInstant(
    { year: 2026, month: 8, day },
    hour * 60 + minute,
    TZ,
  );
}

function task(t: Partial<Task> & Pick<Task, "title">): Task {
  return {
    id: id("task"),
    user_id: "u1",
    notes: null,
    due_at: null,
    estimated_minutes: 60,
    spent_minutes: 0,
    priority: 2,
    status: "todo",
    min_block_minutes: 25,
    splittable: true,
    completed_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...t,
  } as Task;
}

function topic(t: Partial<Topic> & Pick<Topic, "name">): Topic {
  return {
    id: id("topic"),
    user_id: "u1",
    notes: null,
    target_at: null,
    target_minutes_per_week: 120,
    confidence: 3,
    priority: 2,
    min_block_minutes: 30,
    active: true,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...t,
  } as Topic;
}

// --- the week -------------------------------------------------------------

const TEMPLATE: AvailabilityBlock[] = [
  availability(1, 18, 22, "weeknight"),
  availability(2, 18, 22, "weeknight"),
  availability(3, 18, 22, "weeknight"),
  availability(4, 18, 22, "weeknight"),
  availability(5, 18, 21, "friday"),
  availability(6, 10, 16, "saturday"),
  availability(0, 12, 18, "sunday"),
];

// Things already on the Google Calendar.
const BUSY = [
  { start: localInstant(18, 18, 0), end: localInstant(18, 19, 30) }, // Tue gym
  { start: localInstant(20, 18, 0), end: localInstant(20, 19, 30) }, // Thu gym
  { start: localInstant(22, 13, 0), end: localInstant(22, 15, 0) }, // Sat lunch
];

const TASKS = [
  task({
    title: "Finish 6.006 pset 4",
    due_at: localInstant(19, 23, 59).toISOString(), // Wednesday
    estimated_minutes: 180,
    priority: 1,
  }),
  task({
    title: "Read chapter 12",
    due_at: localInstant(21, 23, 59).toISOString(), // Friday
    estimated_minutes: 90,
  }),
  task({
    title: "Draft internship essay",
    due_at: localInstant(23, 23, 59).toISOString(), // Sunday
    estimated_minutes: 120,
    priority: 1,
  }),
  task({
    title: "Renew passport",
    due_at: "2026-09-30T12:00:00Z",
    estimated_minutes: 45,
    priority: 3,
    splittable: false,
  }),
];

const TOPICS = [
  topic({
    name: "Algorithms",
    target_minutes_per_week: 180,
    confidence: 2,
    priority: 1,
    target_at: localInstant(28, 9, 0).toISOString(), // exam in 11 days
  }),
  topic({ name: "Linear Algebra", target_minutes_per_week: 120, confidence: 4 }),
  topic({ name: "Spanish", target_minutes_per_week: 90, confidence: 3 }),
];

// --- helpers --------------------------------------------------------------

const DAY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  weekday: "short",
  month: "short",
  day: "numeric",
});
const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});

function buildPlan() {
  const freeSlots = computeFreeSlots({
    template: TEMPLATE,
    busy: BUSY,
    from: NOW,
    to: WEEK_END,
    now: NOW,
    timezone: TZ,
  });

  const plan = generatePlan({
    now: NOW,
    from: NOW,
    to: WEEK_END,
    timezone: TZ,
    slotMinutes: 15,
    breakMinutes: 10,
    dailyCapMinutes: 240,
    tasks: TASKS,
    topics: TOPICS,
    topicMinutesAlready: new Map(),
    freeSlots,
  });

  return { plan, freeSlots };
}

function render(plan: ReturnType<typeof buildPlan>["plan"]): string {
  const names = new Map<string, string>([
    ...TASKS.map((t) => [t.id, t.title] as const),
    ...TOPICS.map((t) => [t.id, t.name] as const),
  ]);

  const lines: string[] = [];
  let currentDay = "";

  for (const block of plan.blocks) {
    const start = new Date(block.starts_at);
    const end = new Date(block.ends_at);
    const day = DAY_FMT.format(start);
    if (day !== currentDay) {
      lines.push(`\n  ${day}`);
      currentDay = day;
    }
    const minutes = (end.getTime() - start.getTime()) / 60_000;
    const label = names.get(block.task_id ?? block.topic_id ?? "") ?? "?";
    const marker = block.task_id ? "•" : "○";
    lines.push(
      `    ${TIME_FMT.format(start)}-${TIME_FMT.format(end)}  ${marker} ${label}` +
        `  (${minutes}m)`,
    );
  }

  if (plan.unplaced.length > 0) {
    lines.push("\n  Could not place");
    for (const item of plan.unplaced) {
      lines.push(
        `    ${names.get(item.id) ?? item.label}: ${item.minutesShort}m short — ${item.reason}`,
      );
    }
  }
  return lines.join("\n");
}

// --- assertions -----------------------------------------------------------

describe("a realistic week", () => {
  it("produces a plan a human would accept", () => {
    const { plan, freeSlots } = buildPlan();

    console.log(
      `\n  ${totalMinutes(freeSlots)} free minutes across ${freeSlots.length} slots` +
        `\n  ${plan.minutesPlaced} scheduled, ${plan.minutesFree} left over` +
        `\n${render(plan)}\n`,
    );

    // Nothing may land on time the calendar already owns.
    for (const block of plan.blocks) {
      const start = new Date(block.starts_at).getTime();
      const end = new Date(block.ends_at).getTime();
      for (const busy of BUSY) {
        const overlaps = start < busy.end.getTime() && end > busy.start.getTime();
        expect(overlaps, `block ${block.starts_at} collides with a calendar event`)
          .toBe(false);
      }
    }

    // Blocks must not overlap each other.
    for (let i = 1; i < plan.blocks.length; i++) {
      expect(plan.blocks[i].starts_at >= plan.blocks[i - 1].ends_at).toBe(true);
    }

    // Every deadline respected.
    for (const block of plan.blocks) {
      const owner = TASKS.find((t) => t.id === block.task_id);
      if (owner?.due_at) {
        expect(new Date(block.ends_at).getTime()).toBeLessThanOrEqual(
          new Date(owner.due_at).getTime(),
        );
      }
    }

    // The urgent, high-priority pset should be the first thing on the calendar.
    expect(plan.blocks[0].task_id).toBe(
      TASKS.find((t) => t.title === "Finish 6.006 pset 4")!.id,
    );

    // Indivisible work stayed in one piece.
    const passport = TASKS.find((t) => t.title === "Renew passport")!;
    const passportBlocks = plan.blocks.filter((b) => b.task_id === passport.id);
    expect(passportBlocks.length).toBeLessThanOrEqual(1);
    if (passportBlocks.length === 1) {
      const minutes =
        (new Date(passportBlocks[0].ends_at).getTime() -
          new Date(passportBlocks[0].starts_at).getTime()) /
        60_000;
      expect(minutes).toBe(45);
    }
  });

  it("is stable — replanning without changes moves nothing", () => {
    expect(buildPlan().plan.blocks).toEqual(buildPlan().plan.blocks);
  });
});
