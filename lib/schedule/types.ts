import type { Task, Topic } from "@/lib/db/types";

/** A contiguous stretch of instants the packer may place work into. */
export interface FreeSlot {
  start: Date;
  end: Date;
  /** Local day this slot belongs to, e.g. "2026-08-18". Used for daily caps. */
  dayKey: string;
}

/** Anything competing for time, normalised so the packer treats them alike. */
export interface Candidate {
  kind: "task" | "topic";
  id: string;
  label: string;
  /** Minutes the packer should try to place. */
  minutesWanted: number;
  /** Never produce a block shorter than this. */
  minBlockMinutes: number;
  /** Whether the work may be spread over several blocks. */
  splittable: boolean;
  /**
   * When the work is due. Drives urgency and earliest-deadline-first ordering.
   * Null = no deadline. May be in the past.
   */
  deadline: Date | null;
  /**
   * Hard constraint the packer enforces: no block may end after this instant.
   *
   * Deliberately not the same field as `deadline`. A deadline in the past cannot
   * constrain anything — all remaining time is after it — so enforcing it would
   * make overdue work unschedulable, which is exactly backwards. For overdue work
   * this is null (schedule it as early as possible) while `deadline` keeps
   * driving urgency, so it still sorts first.
   */
  latestFinish: Date | null;
  /** Higher wins, but only against candidates in the same tier (see rankCandidates). */
  score: number;
  /** Retained for explanation, not used by the packer. */
  reasons: string[];
}

/** One placed block, ready to be persisted as a `scheduled_blocks` row. */
export interface PlannedBlock {
  task_id: string | null;
  topic_id: string | null;
  starts_at: string;
  ends_at: string;
}

/** Work the packer could not place, with the reason — surfaced to the user. */
export interface Unplaced {
  kind: "task" | "topic";
  id: string;
  label: string;
  minutesShort: number;
  /**
   * Which limit ran out first:
   *   no-free-time     nothing in the window could hold this at all
   *   past-deadline    there was free time, but not enough before the deadline
   *   daily-cap        `daily_cap_minutes` was reached on every candidate day
   *   below-min-block  only fragments shorter than `min_block_minutes` remained
   */
  reason: "no-free-time" | "past-deadline" | "daily-cap" | "below-min-block";
}

export interface PlanResult {
  blocks: PlannedBlock[];
  unplaced: Unplaced[];
  /** Total minutes placed, for the summary line. */
  minutesPlaced: number;
  /** Free minutes the plan did not consume. */
  minutesFree: number;
}

export interface PlanInput {
  now: Date;
  from: Date;
  to: Date;
  timezone: string;
  slotMinutes: number;
  breakMinutes: number;
  dailyCapMinutes: number;
  tasks: Task[];
  topics: Topic[];
  /** Minutes already committed to each topic in this window, by topic id. */
  topicMinutesAlready: Map<string, number>;
  freeSlots: FreeSlot[];
}
