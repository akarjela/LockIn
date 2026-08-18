import { totalMinutes } from "@/lib/schedule/availability";
import { packBlocks } from "@/lib/schedule/pack";
import { rankCandidates } from "@/lib/schedule/score";
import type { PlanInput, PlanResult } from "@/lib/schedule/types";

export { computeFreeSlots, mergeIntervals, subtractIntervals, totalMinutes } from "@/lib/schedule/availability";
export { packBlocks } from "@/lib/schedule/pack";
export { priorityWeight, rankCandidates, scoreTask, scoreTopic, urgency } from "@/lib/schedule/score";
export * from "@/lib/schedule/types";

/**
 * Produces a plan. Pure: same input, same output, no clock and no I/O.
 *
 * `now` is a parameter rather than a call to `Date.now()` precisely so this holds
 * — it is what lets the tests pin a week and assert exact block boundaries, and
 * what lets the CLI and the web app produce byte-identical plans.
 */
export function generatePlan(input: PlanInput): PlanResult {
  const candidates = rankCandidates(
    input.tasks,
    input.topics,
    input.now,
    input.topicMinutesAlready,
    input.to,
  );

  const { blocks, unplaced } = packBlocks({
    candidates,
    freeSlots: input.freeSlots,
    slotMinutes: input.slotMinutes,
    breakMinutes: input.breakMinutes,
    dailyCapMinutes: input.dailyCapMinutes,
  });

  const minutesPlaced = blocks.reduce(
    (sum, block) =>
      sum +
      (new Date(block.ends_at).getTime() - new Date(block.starts_at).getTime()) /
        60_000,
    0,
  );

  return {
    blocks,
    unplaced,
    minutesPlaced,
    minutesFree: totalMinutes(input.freeSlots) - minutesPlaced,
  };
}
