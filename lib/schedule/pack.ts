import type {
  Candidate,
  FreeSlot,
  PlannedBlock,
  Unplaced,
} from "@/lib/schedule/types";

/** Free time being consumed as the packer works. Epoch ms for cheap arithmetic. */
interface OpenSlot {
  start: number;
  end: number;
  dayKey: string;
}

/** Rounds down to the slot grid, so blocks land on tidy clock times. */
function snapDown(minutes: number, grid: number): number {
  return Math.floor(minutes / grid) * grid;
}

/**
 * Places ranked candidates into free time, highest score first.
 *
 * Greedy and earliest-fit, deliberately. An optimal packing is NP-hard and, worse,
 * unstable: a small edit could reshuffle the whole week and destroy the user's
 * sense of where things are. Greedy gives a plan that changes only where the
 * input changed, and every placement has a one-line explanation.
 *
 * Three rules constrain each placement:
 *   * nothing is scheduled after a candidate's deadline;
 *   * no local day exceeds `dailyCapMinutes`, however free it looks;
 *   * no block is shorter than the candidate's `minBlockMinutes`, unless it is
 *     the final remnant of that candidate's work.
 */
export function packBlocks({
  candidates,
  freeSlots,
  slotMinutes,
  breakMinutes,
  dailyCapMinutes,
}: {
  candidates: Candidate[];
  freeSlots: FreeSlot[];
  slotMinutes: number;
  breakMinutes: number;
  dailyCapMinutes: number;
}): { blocks: PlannedBlock[]; unplaced: Unplaced[] } {
  const slots: OpenSlot[] = freeSlots
    .map((slot) => ({
      start: slot.start.getTime(),
      end: slot.end.getTime(),
      dayKey: slot.dayKey,
    }))
    .sort((a, b) => a.start - b.start);

  const usedPerDay = new Map<string, number>();
  const blocks: PlannedBlock[] = [];
  const unplaced: Unplaced[] = [];

  for (const candidate of candidates) {
    let remaining = candidate.minutesWanted;
    const deadlineMs = candidate.latestFinish?.getTime() ?? Infinity;

    // Why a candidate fell short. A limit counts whether it caused a slot to be
    // skipped or merely truncated a placement inside one — the second case is the
    // common one, and reporting "no free time" for it would be misleading.
    let capLimited = false;
    let deadlineLimited = false;
    let minBlockLimited = false;

    for (const slot of slots) {
      if (remaining <= 0) break;
      if (slot.start >= slot.end) continue;

      const usableEnd = Math.min(slot.end, deadlineMs);
      if (deadlineMs < slot.end) deadlineLimited = true;
      if (usableEnd <= slot.start) continue;

      const capLeft = dailyCapMinutes - (usedPerDay.get(slot.dayKey) ?? 0);
      if (capLeft <= 0) {
        capLimited = true;
        continue;
      }

      const slotMinutesFree = (usableEnd - slot.start) / 60_000;
      if (capLeft < Math.min(remaining, slotMinutesFree)) capLimited = true;
      let take = Math.min(remaining, slotMinutesFree, capLeft);

      // Snap to the grid, but never round a finishing remnant down to nothing.
      const snapped = snapDown(take, slotMinutes);
      if (snapped >= slotMinutes) take = snapped;

      // A fragment below the minimum is not worth scheduling — unless it is all
      // that is left of this candidate, in which case finishing beats deferring.
      const floor = Math.min(candidate.minBlockMinutes, remaining);
      if (take < floor) {
        minBlockLimited = true;
        continue;
      }

      // Indivisible work needs the whole amount in one contiguous piece.
      if (!candidate.splittable && take < remaining) {
        minBlockLimited = true;
        continue;
      }

      const startsAt = slot.start;
      const endsAt = startsAt + take * 60_000;

      blocks.push({
        task_id: candidate.kind === "task" ? candidate.id : null,
        topic_id: candidate.kind === "topic" ? candidate.id : null,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
      });

      remaining -= take;
      usedPerDay.set(slot.dayKey, (usedPerDay.get(slot.dayKey) ?? 0) + take);
      // Leave a gap before whatever lands next in this slot.
      slot.start = endsAt + breakMinutes * 60_000;
    }

    if (remaining > 0) {
      unplaced.push({
        kind: candidate.kind,
        id: candidate.id,
        label: candidate.label,
        minutesShort: Math.round(remaining),
        // Most actionable limit first: a cap is a setting the user can raise, a
        // deadline is a fact, a min-block is a property of the work itself.
        reason: capLimited
          ? "daily-cap"
          : deadlineLimited
            ? "past-deadline"
            : minBlockLimited
              ? "below-min-block"
              : "no-free-time",
      });
    }
  }

  blocks.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return { blocks, unplaced };
}
