import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import type { Confidence, Priority } from "@/lib/db/types";
import { toZonedDate, zonedTimeToInstant } from "@/lib/schedule/tz";

/**
 * Turns a brain-dump into structured drafts.
 *
 * Server-only — it reads ANTHROPIC_API_KEY, which must never reach the browser.
 *
 * The division of labour is the point of the whole design: Claude reads English
 * and produces *drafts*, and the deterministic engine does every bit of the
 * actual scheduling. Nothing here decides when work happens. That keeps plans
 * reproducible and testable, and means a bad parse costs you an edit rather than
 * a wrong week.
 *
 * Drafts are never written straight to the database — the caller shows them to
 * the user first. An extraction step is exactly where a confident-sounding
 * mistake ("2 hours" read as "2 days") is cheap to catch and expensive to miss.
 */

/**
 * Claude returns *local wall-clock* strings, not instants.
 *
 * Asking a model to do timezone arithmetic is asking for an off-by-an-hour bug
 * twice a year. It writes "2026-08-20T23:59" and `zonedTimeToInstant` — the same
 * function the scheduler uses — resolves it against the user's zone here.
 */
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const CaptureSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      /** "YYYY-MM-DDTHH:MM" in the user's local time, or null if none was given. */
      due_local: z.string().nullable(),
      /** True for ongoing practice, false for a fixed amount of work. */
      repeats_weekly: z.boolean(),
      /** Total minutes when one-off; minutes *per week* when it repeats. */
      minutes: z.number(),
      /** 1 shaky .. 5 solid. Only meaningful for repeating work. */
      confidence: z.number().nullable(),
      /** 1 high, 2 normal, 3 low. */
      priority: z.number(),
      splittable: z.boolean(),
      /** What was assumed rather than stated, so the user can check it. */
      assumption: z.string().nullable(),
    }),
  ),
  /** Anything that could not be turned into an item. */
  unclear: z.array(z.string()),
});

export interface ItemDraftPreview {
  title: string;
  due_at: string | null;
  /** Exactly one of these is set, mirroring the database constraint. */
  estimated_minutes: number | null;
  target_minutes_per_week: number | null;
  confidence: Confidence | null;
  priority: Priority;
  splittable: boolean;
  assumption: string | null;
}

export interface CaptureResult {
  items: ItemDraftPreview[];
  unclear: string[];
}

export class CaptureUnavailableError extends Error {}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Local wall-clock text -> instant, via the scheduler's own zone arithmetic. */
function toInstant(local: string | null, timezone: string): string | null {
  const match = local?.match(LOCAL_DATETIME);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match.map(Number);
  return zonedTimeToInstant(
    { year, month, day },
    hour * 60 + minute,
    timezone,
  ).toISOString();
}

function systemPrompt(now: Date, timezone: string): string {
  const today = toZonedDate(now, timezone);
  const weekdays = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
  ];

  return `You extract work items from a person's notes about their week.

Today is ${weekdays[today.weekday]}, ${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")} in timezone ${timezone}.

You are NOT scheduling anything. A separate deterministic planner decides when
work happens. Your only job is to turn prose into structured items, faithfully.

ONE-OFF vs REPEATING
- Set repeats_weekly=false for a fixed amount of work with an end state:
  "finish the pset", "email the registrar", "read chapter 12".
- Set repeats_weekly=true for ongoing practice that never completes:
  "dynamic programming", "Spanish", "gym".
- If it is phrased as recurring practice, revision, or a habit, it repeats.

DATES
- Write local wall-clock times as "YYYY-MM-DDTHH:MM". Never include a timezone
  or offset; never convert to UTC.
- Resolve relative dates against today's date above. "Thursday" means the next
  Thursday that has not yet passed. "Next week" means seven days out.
- A date with no time of day means 23:59 for a deadline, 09:00 for an exam.
- If no date is stated or implied, use null. Do not invent one.
- Repeating work can still have a date — an exam it is building toward.

MINUTES
- "minutes" means the TOTAL for one-off work, and minutes PER WEEK for repeating
  work. Read "3 hours a week on DP" as repeats_weekly=true, minutes=180.
- Use a stated duration when there is one ("about 3 hours" -> 180).
- Otherwise infer something plausible and record it in "assumption".
- One-off minutes must be 5..1440. Weekly minutes must be 15..10080.

OTHER FIELDS
- priority: 1 high, 2 normal, 3 low. Default 2 unless urgency or importance is
  expressed. A deadline alone is not high priority — the planner already handles
  deadlines.
- splittable: false only if the work must happen in one sitting (an exam, a
  practice test, a call). Default true.
- confidence: 1 shaky .. 5 solid, for repeating work only; null otherwise. Map
  "I'm terrible at" to 1-2 and "just keeping it warm" to 4-5. Default 3.

ASSUMPTIONS
- "assumption" must say what you inferred that the person did not state, in one
  short phrase — e.g. "estimated 2h; no duration given". Use null when every
  field came from what they actually wrote.

UNCLEAR
- Put anything you could not confidently turn into an item into "unclear",
  quoting their words. Do not guess just to empty this list.`;
}

/**
 * Parses free text into drafts.
 *
 * @throws CaptureUnavailableError when no API key is configured, so the caller
 *         can show a setup hint rather than a stack trace.
 */
export async function parseCapture(
  text: string,
  { now = new Date(), timezone }: { now?: Date; timezone: string },
): Promise<CaptureResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new CaptureUnavailableError(
      "ANTHROPIC_API_KEY is not set, so notes cannot be parsed. Add it to .env.local.",
    );
  }

  const client = new Anthropic();

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    // Extraction is not hard reasoning, but resolving "Thursday" against today
    // is where a careless answer would be wrong rather than merely vague.
    output_config: {
      effort: "medium",
      format: zodOutputFormat(CaptureSchema),
    },
    system: systemPrompt(now, timezone),
    messages: [{ role: "user", content: text }],
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("Could not read a plan out of that. Try rephrasing it.");
  }

  // Ranges are re-clamped here rather than trusted: the schema says "number",
  // and a value outside these bounds would be rejected by a database check
  // constraint further down with a far less helpful message.
  return {
    items: parsed.items.map((item) => {
      const repeats = item.repeats_weekly;
      return {
        title: item.title.trim().slice(0, 200),
        due_at: toInstant(item.due_local, timezone),
        // Exactly one workload field, mirroring the database constraint. Setting
        // both would be rejected downstream with a far less helpful message.
        estimated_minutes: repeats ? null : clamp(item.minutes, 5, 1440, 30),
        target_minutes_per_week: repeats
          ? clamp(item.minutes, 15, 10080, 120)
          : null,
        confidence: repeats
          ? (clamp(item.confidence ?? 3, 1, 5, 3) as Confidence)
          : null,
        priority: clamp(item.priority, 1, 3, 2) as Priority,
        splittable: repeats ? true : item.splittable,
        assumption: item.assumption,
      };
    }),
    unclear: parsed.unclear,
  };
}
