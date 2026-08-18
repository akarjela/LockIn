import type { Priority, Task, Topic } from "@/lib/db/types";
import { remainingMinutes } from "@/lib/db/types";
import type { Candidate } from "@/lib/schedule/types";

/**
 * Scoring turns "what matters most" into one number per candidate, so the packer
 * can stay a simple greedy loop.
 *
 * A score is only meaningful *within* a tier — see `rankCandidates` for why task
 * and topic scores cannot be compared directly.
 *
 * Every component is normalised to 0..1 and the weights below sum to 1, which
 * means a score is directly readable: 0.8 is genuinely urgent, 0.2 is filler.
 * Keeping that property is what makes the numbers debuggable when a plan looks
 * wrong — if you change a weight, change another to compensate.
 */

const TASK_WEIGHTS = { urgency: 0.55, priority: 0.3, effort: 0.15 } as const;
const TOPIC_WEIGHTS = {
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
 * Overdue saturates at 1 instead of growing without bound, so one forgotten task
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
 * A mild nudge toward clearing short tasks first. Weighted lightly on purpose —
 * it breaks ties between similar work rather than letting a pile of five-minute
 * errands outrank a deadline.
 */
function effortBonus(minutes: number): number {
  return 1 / (1 + minutes / 60);
}

export function scoreTask(task: Task, now: Date): Candidate {
  const deadline = task.due_at ? new Date(task.due_at) : null;
  const wanted = remainingMinutes(task);

  const u = urgency(deadline, now);
  const p = priorityWeight(task.priority);
  const e = effortBonus(wanted);

  const score =
    TASK_WEIGHTS.urgency * u +
    TASK_WEIGHTS.priority * p +
    TASK_WEIGHTS.effort * e;

  const reasons: string[] = [];
  if (deadline && u >= 1) reasons.push("overdue");
  else if (u > 0.4) reasons.push("deadline close");
  if (task.priority === 1) reasons.push("high priority");
  if (task.status === "doing") reasons.push("already started");

  return {
    kind: "task",
    id: task.id,
    label: task.title,
    minutesWanted: wanted,
    minBlockMinutes: task.min_block_minutes,
    splittable: task.splittable,
    deadline,
    latestFinish: deadline && deadline > now ? deadline : null,
    // Work in progress edges out an identical untouched task; context is already
    // loaded, so finishing it is cheaper than starting something new.
    score: task.status === "doing" ? score + 0.05 : score,
    reasons,
  };
}

export function scoreTopic(
  topic: Topic,
  now: Date,
  minutesAlreadyScheduled: number,
): Candidate {
  const deadline = topic.target_at ? new Date(topic.target_at) : null;
  const deficit = Math.max(
    0,
    topic.target_minutes_per_week - minutesAlreadyScheduled,
  );

  // How far short of the weekly target we are, 0..1. A topic already at target
  // scores 0 here and drops below most tasks, which is the intent.
  const deficitRatio = deficit / topic.target_minutes_per_week;
  // 1 (shaky) -> 1.0, 5 (solid) -> 0.2. Shaky topics pull time toward themselves.
  const confidenceGap = (6 - topic.confidence) / 5;
  const p = priorityWeight(topic.priority);
  const u = deadline ? urgency(deadline, now) : 0;

  const score =
    TOPIC_WEIGHTS.deficit * deficitRatio +
    TOPIC_WEIGHTS.confidence * confidenceGap +
    TOPIC_WEIGHTS.priority * p +
    TOPIC_WEIGHTS.urgency * u;

  const reasons: string[] = [];
  if (deficitRatio > 0.75) reasons.push("well short of weekly target");
  else if (deficitRatio === 0) reasons.push("weekly target already met");
  if (topic.confidence <= 2) reasons.push("low confidence");
  if (deadline && u > 0.4) reasons.push("target date close");

  return {
    kind: "topic",
    id: topic.id,
    label: topic.name,
    minutesWanted: deficit,
    minBlockMinutes: topic.min_block_minutes,
    splittable: true, // study time is spread by nature
    deadline,
    latestFinish: deadline && deadline > now ? deadline : null,
    score,
    reasons,
  };
}

/**
 * All work worth scheduling, ranked. Candidates wanting no time are dropped.
 *
 * Ranking happens in two tiers, because task and topic scores are *not* directly
 * comparable and no choice of weights makes them so. A topic starts every week at
 * full deficit, which is worth 0.35 before anything else is considered, while a
 * task's urgency only approaches 1 as its deadline arrives. Ranked on score alone,
 * a routine study target reliably outranks a paper due in two days.
 *
 * The distinction that actually matters is not numeric:
 *
 *   Tier 1 — obligations. Work with a deadline inside the planning window.
 *            Missing one has a consequence outside the app.
 *   Tier 2 — goals. Weekly study targets, and work due beyond the window.
 *            Missing one costs progress, not a grade.
 *
 * Obligations claim time first; goals fill what is left. Within tier 1 the order
 * is earliest-deadline-first rather than by score: EDF is optimal for meeting
 * deadlines on a single resource, so if any ordering can fit everything, EDF does.
 * Within tier 2, score decides, since nothing there has a hard due date.
 *
 * A topic with a target date inside the window (an exam) is an obligation and
 * ranks in tier 1 — that is the case where study time genuinely is a deadline.
 *
 * Ties break on id so two runs over identical data produce an identical plan.
 */
export function rankCandidates(
  tasks: Task[],
  topics: Topic[],
  now: Date,
  topicMinutesAlready: Map<string, number>,
  windowEnd: Date,
): Candidate[] {
  const candidates = [
    ...tasks.map((task) => scoreTask(task, now)),
    ...topics
      .filter((topic) => topic.active)
      .map((topic) =>
        scoreTopic(topic, now, topicMinutesAlready.get(topic.id) ?? 0),
      ),
  ].filter((candidate) => candidate.minutesWanted > 0);

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
