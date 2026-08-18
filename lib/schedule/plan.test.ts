import { describe, expect, it } from "vitest";

import type { Task, Topic } from "@/lib/db/types";
import { generatePlan } from "@/lib/schedule";
import { rankCandidates, urgency } from "@/lib/schedule/score";
import type { FreeSlot } from "@/lib/schedule/types";

const NOW = new Date("2026-08-17T12:00:00Z");
/** End of the planning window — the tier-1/tier-2 boundary in rankCandidates. */
const WINDOW_END = new Date("2026-08-24T12:00:00Z");

function task(overrides: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
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
    ...overrides,
  } as Task;
}

function topic(overrides: Partial<Topic> & Pick<Topic, "id" | "name">): Topic {
  return {
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
    ...overrides,
  } as Topic;
}

/** One contiguous free stretch, all on the same local day. */
function slot(startIso: string, hours: number, dayKey = "2026-08-17"): FreeSlot {
  const start = new Date(startIso);
  return {
    start,
    end: new Date(start.getTime() + hours * 3_600_000),
    dayKey,
  };
}

const BASE = {
  now: NOW,
  from: NOW,
  to: WINDOW_END,
  timezone: "UTC",
  slotMinutes: 15,
  breakMinutes: 0,
  dailyCapMinutes: 480,
  topicMinutesAlready: new Map<string, number>(),
};

describe("urgency", () => {
  it("saturates at 1 for overdue work and decays with distance", () => {
    expect(urgency(new Date("2026-08-16T12:00:00Z"), NOW)).toBe(1);
    expect(urgency(new Date("2026-08-18T12:00:00Z"), NOW)).toBeCloseTo(0.5);
    expect(urgency(new Date("2026-08-20T12:00:00Z"), NOW)).toBeCloseTo(0.25);
    expect(urgency(null, NOW)).toBeLessThan(0.25);
  });
});

describe("rankCandidates", () => {
  it("puts an imminent deadline above a distant one", () => {
    const ranked = rankCandidates(
      [
        task({ id: "far", title: "Far", due_at: "2026-09-30T12:00:00Z" }),
        task({ id: "soon", title: "Soon", due_at: "2026-08-18T12:00:00Z" }),
      ],
      [],
      NOW,
      new Map(),
      WINDOW_END,
    );
    expect(ranked.map((c) => c.id)).toEqual(["soon", "far"]);
  });

  it("drops tasks with no remaining work", () => {
    const ranked = rankCandidates(
      [task({ id: "done", title: "Done", estimated_minutes: 60, spent_minutes: 60 })],
      [],
      NOW,
      new Map(),
      WINDOW_END,
    );
    expect(ranked).toHaveLength(0);
  });

  it("demotes a topic that already met its weekly target", () => {
    const ranked = rankCandidates(
      [],
      [
        topic({ id: "met", name: "Met", target_minutes_per_week: 120 }),
        topic({ id: "short", name: "Short", target_minutes_per_week: 120 }),
      ],
      NOW,
      new Map([["met", 120]]),
      WINDOW_END,
    );
    // "met" wants no more minutes at all, so it is not a candidate.
    expect(ranked.map((c) => c.id)).toEqual(["short"]);
  });

  it("is deterministic for equally-scored work", () => {
    const input = [
      task({ id: "b", title: "B" }),
      task({ id: "a", title: "A" }),
    ];
    const first = rankCandidates(input, [], NOW, new Map(), WINDOW_END);
    const second = rankCandidates([...input].reverse(), [], NOW, new Map(), WINDOW_END);
    expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id));
  });
});

describe("generatePlan", () => {
  it("schedules the urgent task before the relaxed one", () => {
    const plan = generatePlan({
      ...BASE,
      tasks: [
        task({ id: "relaxed", title: "Relaxed", due_at: "2026-09-20T12:00:00Z" }),
        task({ id: "urgent", title: "Urgent", due_at: "2026-08-18T00:00:00Z" }),
      ],
      topics: [],
      freeSlots: [slot("2026-08-17T13:00:00Z", 3)],
    });

    expect(plan.blocks).toHaveLength(2);
    expect(plan.blocks[0].task_id).toBe("urgent");
    expect(plan.blocks[0].starts_at).toBe("2026-08-17T13:00:00.000Z");
    expect(plan.blocks[1].task_id).toBe("relaxed");
    expect(plan.minutesPlaced).toBe(120);
    expect(plan.minutesFree).toBe(60);
  });

  it("never schedules past a deadline", () => {
    const plan = generatePlan({
      ...BASE,
      tasks: [
        task({
          id: "t1",
          title: "Due at 14:00",
          due_at: "2026-08-17T14:00:00Z",
          estimated_minutes: 180,
        }),
      ],
      topics: [],
      freeSlots: [slot("2026-08-17T13:00:00Z", 5)],
    });

    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].ends_at).toBe("2026-08-17T14:00:00.000Z");
    expect(plan.unplaced).toEqual([
      {
        kind: "task",
        id: "t1",
        label: "Due at 14:00",
        minutesShort: 120,
        reason: "past-deadline",
      },
    ]);
  });

  it("honours the daily cap even when the day is wide open", () => {
    const plan = generatePlan({
      ...BASE,
      dailyCapMinutes: 60,
      tasks: [task({ id: "t1", title: "Big", estimated_minutes: 300 })],
      topics: [],
      freeSlots: [slot("2026-08-17T13:00:00Z", 8)],
    });

    expect(plan.minutesPlaced).toBe(60);
    expect(plan.unplaced[0].reason).toBe("daily-cap");
  });

  it("spreads a task across days when one day is capped", () => {
    const plan = generatePlan({
      ...BASE,
      dailyCapMinutes: 60,
      tasks: [task({ id: "t1", title: "Big", estimated_minutes: 120 })],
      topics: [],
      freeSlots: [
        slot("2026-08-17T13:00:00Z", 4, "2026-08-17"),
        slot("2026-08-18T13:00:00Z", 4, "2026-08-18"),
      ],
    });

    expect(plan.blocks).toHaveLength(2);
    expect(plan.minutesPlaced).toBe(120);
    expect(plan.unplaced).toEqual([]);
  });

  it("keeps indivisible work in a single block", () => {
    const plan = generatePlan({
      ...BASE,
      tasks: [
        task({
          id: "exam",
          title: "Mock exam",
          estimated_minutes: 120,
          splittable: false,
        }),
      ],
      topics: [],
      freeSlots: [
        slot("2026-08-17T13:00:00Z", 1), // too short — must be skipped
        slot("2026-08-17T16:00:00Z", 3),
      ],
    });

    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].starts_at).toBe("2026-08-17T16:00:00.000Z");
    expect(plan.blocks[0].ends_at).toBe("2026-08-17T18:00:00.000Z");
  });

  it("inserts breaks between consecutive blocks", () => {
    const plan = generatePlan({
      ...BASE,
      breakMinutes: 15,
      tasks: [
        task({ id: "a", title: "A", estimated_minutes: 60, priority: 1 }),
        task({ id: "b", title: "B", estimated_minutes: 60, priority: 3 }),
      ],
      topics: [],
      freeSlots: [slot("2026-08-17T13:00:00Z", 4)],
    });

    expect(plan.blocks[0].ends_at).toBe("2026-08-17T14:00:00.000Z");
    expect(plan.blocks[1].starts_at).toBe("2026-08-17T14:15:00.000Z");
  });

  it("schedules topics toward their weekly deficit only", () => {
    const plan = generatePlan({
      ...BASE,
      tasks: [],
      topics: [topic({ id: "algo", name: "Algorithms", target_minutes_per_week: 120 })],
      topicMinutesAlready: new Map([["algo", 90]]),
      freeSlots: [slot("2026-08-17T13:00:00Z", 5)],
    });

    expect(plan.minutesPlaced).toBe(30);
    expect(plan.blocks[0].topic_id).toBe("algo");
    expect(plan.blocks[0].task_id).toBeNull();
  });

  it("reports work it could not place at all", () => {
    const plan = generatePlan({
      ...BASE,
      tasks: [task({ id: "t1", title: "Homeless", estimated_minutes: 60 })],
      topics: [],
      freeSlots: [],
    });

    expect(plan.blocks).toEqual([]);
    expect(plan.unplaced[0].reason).toBe("no-free-time");
  });

  it("produces an identical plan when run twice", () => {
    const input = {
      ...BASE,
      tasks: [
        task({ id: "a", title: "A", due_at: "2026-08-19T12:00:00Z" }),
        task({ id: "b", title: "B", due_at: "2026-08-19T12:00:00Z" }),
      ],
      topics: [topic({ id: "c", name: "C" })],
      freeSlots: [slot("2026-08-17T13:00:00Z", 6)],
    };

    expect(generatePlan(input).blocks).toEqual(generatePlan(input).blocks);
  });
});

describe("overdue work", () => {
  it("still gets scheduled rather than dropped", () => {
    const plan = generatePlan({
      ...BASE,
      tasks: [
        task({
          id: "late",
          title: "Late lab report",
          due_at: "2026-08-15T12:00:00Z", // two days ago
          estimated_minutes: 60,
        }),
      ],
      topics: [],
      freeSlots: [slot("2026-08-17T13:00:00Z", 4)],
    });

    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].task_id).toBe("late");
    expect(plan.unplaced).toEqual([]);
  });

  it("puts overdue work ahead of work merely due soon", () => {
    const plan = generatePlan({
      ...BASE,
      tasks: [
        task({ id: "soon", title: "Soon", due_at: "2026-08-18T12:00:00Z" }),
        task({ id: "late", title: "Late", due_at: "2026-08-15T12:00:00Z" }),
      ],
      topics: [],
      freeSlots: [slot("2026-08-17T13:00:00Z", 4)],
    });

    expect(plan.blocks[0].task_id).toBe("late");
  });
});
