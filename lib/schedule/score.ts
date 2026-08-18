import type { Item, Priority } from "@/lib/db/types";
import { remainingMinutes } from "@/lib/db/types";
import type { Candidate } from "@/lib/schedule/types";

/**
 * Scoring turns "what matters most" into one number per item, so the packer can
 * stay a simple greedy loop.
 *
 * A score is only meaningful *within* a tier — see `rankCandidates` for why
 * finite and recurring work cannot be compared on one number.
 *
 * Every component is normalised to 0..1 and the weights below sum to 1, so a
 * score reads directly: 0.8 is genuinely urgent, 0.2 is filler. Keeping that
 * property is what makes the numbers debuggable when a plan looks wrong — if you
 * change a weight, change another to compensate.
 */

const FINITE_WEIGHTS = { urgency: 0.55, priority: 0.3, effort: 0.15 } as const;
const RECURRING_WEIGHTS = {
  deficit: 0.35,
  confidence: 0.25,
  priority: 0.25,
  urgency: 0.15,
} as const;

/** 1 (highest) -> 1.0, 3 (lowest) -> 0.2. */
export function priorityWeight(priority: Priority): number {
  return { 1: 1, 2: 0.6, 3: 0.2 }[priority];
}

/**
 * Deadline pressure, 0..1.
 *
 * Hyperbolic rather than linear: the difference between "due tomorrow" and "due
 * in two days" should matter far more than between "in 20 days" and "in 21".
 * Overdue saturates at 1 instead of growing without bound, so one forgotten item
 * cannot starve everything else forever.
 */
export function urgency(deadline: Date | null, now: Date): number {
  if (!deadline) return 0.15; // undated work should still get picked up eventually
  const days = (deadline.getTime() - now.getTime()) / 86_400_000;
  if (days <= 0) return 1;
  return 1 / (1 + days);
}

/**
 * Small-job bonus, 0..1.
 *
 * A mild nudge toward clearing short work first. Weighted lightly on purpose —
 * it breaks ties between similar items rather than letting a pile of five-minute
 * errands outrank a deadline.
 */
function effortBonus(minutes: number): number {
  return 1 / (1 + minutes / 60);
}

/**
 * Scores one item.
 *
 * The two branches are not two types resurfacing — they are the two genuinely
 * different questions the data supports. Finite work asks "how close is the
 * deadline relative to how much is left?"; recurring work asks "how far short of
 * this week's target am I?". A single formula over both would have to pretend
 * one of those questions is the other.
 *
 * @param alreadyThisWeek Minutes already committed to this item in the window.
 *        Only affects recurring items; ignored for finite ones.
 */
export function scoreItem(
  item: Item,
  now: Date,
  alreadyThisWeek = 0,
): Candidate {
  const deadline = item.due_at ? new Date(item.due_at) : null;
  const wanted = remainingMinutes(item, alreadyThisWeek);
  const recurring = item.target_minutes_per_week !== null;

  const u = urgency(deadline, now);
  const p = priorityWeight(item.priority);
  const reasons: string[] = [];

  let score: number;

  if (recurring) {
    // How far short of the weekly target we are, 0..1. An item already at target
    // scores 0 here and drops below most finite work, which is the intent.
    const deficitRatio = wanted / item.target_minutes_per_week!;
    // 1 (shaky) -> 1.0, 5 (solid) -> 0.2. Unrated sits in the middle.
    const confidenceGap = ((6 - (item.confidence ?? 3)) / 5);

    score =
      RECURRING_WEIGHTS.deficit * deficitRatio +
      RECURRING_WEIGHTS.confidence * confidenceGap +
      RECURRING_WEIGHTS.priority * p +
      RECURRING_WEIGHTS.urgency * (deadline ? u : 0);

    if (deficitRatio > 0.75) reasons.push("well short of weekly target");
    else if (deficitRatio === 0) reasons.push("weekly target already met");
    if ((item.confidence ?? 3) <= 2) reasons.push("low confidence");
    if (deadline && u > 0.4) reasons.push("target date close");
  } else {
    score =
      FINITE_WEIGHTS.urgency * u +
      FINITE_WEIGHTS.priority * p +
      FINITE_WEIGHTS.effort * effortBonus(wanted);

    if (deadline && u >= 1) reasons.push("overdue");
    else if (u > 0.4) reasons.push("deadline close");
    if (item.priority === 1) reasons.push("high priority");
    if (item.status === "doing") {
      reasons.push("already started");
      // Context is already loaded, so finishing beats starting something new.
      score += 0.05;
    }
  }

  return {
    recurring,
    id: item.id,
    label: item.title,
    minutesWanted: wanted,
    minBlockMinutes: item.min_block_minutes,
    splittable: recurring ? true : item.splittable, // study time spreads by nature
    deadline,
    latestFinish: deadline && deadline > now ? deadline : null,
    score,
    reasons,
  };
}

/**
 * All work worth scheduling, ranked. Items wanting no time are dropped.
 *
 * Ranking happens in two tiers, because finite and recurring scores are *not*
 * directly comparable and no choice of weights makes them so. A recurring item
 * starts every week at full deficit, worth 0.35 before anything else is
 * considered, while finite urgency only approaches 1 as the deadline arrives.
 * Ranked on score alone, a routine weekly target reliably outranks a paper due
 * in two days.
 *
 * The distinction that actually matters is not numeric:
 *
 *   Tier 1 — obligations. A due date inside the planning window. Missing one has
 *            a consequence outside the app.
 *   Tier 2 — goals. Weekly targets, and work due beyond the window. Missing one
 *            costs progress, not a grade.
 *
 * Obligations claim time first, earliest-deadline-first: EDF is optimal for
 * meeting deadlines on a single resource, so if any ordering fits everything,
 * EDF does. Goals fill the rest, by score.
 *
 * Note this is orthogonal to finite/recurring — a recurring item with an exam
 * date inside the window is an obligation, and that is exactly the case where
 * study time genuinely is a deadline.
 *
 * Ties break on id so two runs over identical data produce an identical plan.
 */
export function rankCandidates(
  items: Item[],
  now: Date,
  alreadyThisWeek: Map<string, number>,
  windowEnd: Date,
): Candidate[] {
  const candidates = items
    .map((item) => scoreItem(item, now, alreadyThisWeek.get(item.id) ?? 0))
    .filter((candidate) => candidate.minutesWanted > 0);

  const isObligation = (candidate: Candidate) =>
    candidate.deadline !== null &&
    candidate.deadline.getTime() <= windowEnd.getTime();

  const obligations = candidates
    .filter(isObligation)
    .sort(
      (a, b) =>
        a.deadline!.getTime() - b.deadline!.getTime() ||
        b.score - a.score ||
        a.id.localeCompare(b.id),
    );

  const goals = candidates
    .filter((candidate) => !isObligation(candidate))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  for (const candidate of obligations) candidate.reasons.unshift("due this week");

  return [...obligations, ...goals];
}
