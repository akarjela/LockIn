/**
 * Row shapes for the LockIN schema.
 *
 * Hand-written rather than generated from Supabase, because the scheduler is the
 * primary consumer and it wants narrowed unions (`TaskStatus`, `Priority`) where
 * generated types would only give `string` / `number`. Keep in sync with
 * supabase/migrations/0001_core_schema.sql.
 */

/** 1 = highest. Matches the `priority between 1 and 3` check constraint. */
export type Priority = 1 | 2 | 3;

export type ItemStatus = "todo" | "doing" | "done" | "archived";

/** Self-rated grasp of a topic: 1 shaky .. 5 solid. */
export type Confidence = 1 | 2 | 3 | 4 | 5;

/** 0 = Sunday .. 6 = Saturday, matching JavaScript's `Date#getDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface UserSettings {
  user_id: string;
  /** IANA zone name, e.g. "America/New_York". */
  timezone: string;
  slot_minutes: 5 | 10 | 15 | 30;
  break_minutes: number;
  daily_cap_minutes: number;
  created_at: string;
  updated_at: string;
}

/**
 * One thing you want time for.
 *
 * Tasks and topics used to be separate tables, which forced a categorisation
 * decision that said nothing about the work — "is exam revision a task or a
 * topic?" is a question about the schema, not about your week. Now there is one
 * type, and the difference is expressed as fields:
 *
 *   `estimated_minutes`       finite work that burns down as you do it
 *   `target_minutes_per_week` recurring work that refills every week
 *
 * Exactly one is set, enforced by a database constraint. `due_at` is orthogonal
 * — a deadline on finite work, an exam date on recurring work, absent on either.
 */
export interface Item {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  /** Deadline or target date, as an ISO instant. Null = no fixed date. */
  due_at: string | null;
  /** Total work for finite items. Null exactly when `target_minutes_per_week` is set. */
  estimated_minutes: number | null;
  /** Weekly target for recurring items. Null exactly when `estimated_minutes` is set. */
  target_minutes_per_week: number | null;
  spent_minutes: number;
  priority: Priority;
  /** Self-rated grasp, 1 shaky .. 5 solid. Null when it does not apply. */
  confidence: Confidence | null;
  min_block_minutes: number;
  splittable: boolean;
  /** `archived` doubles as "paused" for recurring work. */
  status: ItemStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Fields a client may set. The server owns ids, timestamps and spent time. */
export type ItemDraft = Pick<Item, "title"> &
  Partial<
    Pick<
      Item,
      | "notes"
      | "due_at"
      | "estimated_minutes"
      | "target_minutes_per_week"
      | "priority"
      | "confidence"
      | "min_block_minutes"
      | "splittable"
    >
  >;

export interface AvailabilityBlock {
  id: string;
  user_id: string;
  weekday: Weekday;
  /** Minutes from local midnight, 0..1439. */
  start_minute: number;
  /** Minutes from local midnight, 1..1440. */
  end_minute: number;
  label: string | null;
  created_at: string;
}

export interface CalendarEvent {
  id: string;
  user_id: string;
  external_id: string;
  calendar_id: string | null;
  title: string | null;
  starts_at: string;
  ends_at: string;
  is_busy: boolean;
  synced_at: string;
}

export interface ScheduledBlock {
  id: string;
  user_id: string;
  item_id: string;
  starts_at: string;
  ends_at: string;
  locked: boolean;
  plan_run_id: string | null;
  created_at: string;
}

/**
 * Whether this item refills weekly rather than burning down.
 *
 * Derived from the data rather than stored, so it cannot disagree with the
 * workload fields the database already constrains.
 */
export function isRecurring(item: Item): boolean {
  return item.target_minutes_per_week !== null;
}

/**
 * Minutes this item still wants scheduled.
 *
 * Finite work burns down against the estimate. Recurring work is measured
 * against the weekly target instead, and `alreadyThisWeek` is what the caller
 * has already committed in the current window — without it, every regeneration
 * would re-request the full target and double-book the week.
 */
export function remainingMinutes(item: Item, alreadyThisWeek = 0): number {
  if (item.target_minutes_per_week !== null) {
    return Math.max(0, item.target_minutes_per_week - alreadyThisWeek);
  }
  return Math.max(0, (item.estimated_minutes ?? 0) - item.spent_minutes);
}
