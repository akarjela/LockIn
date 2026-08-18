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

export type TaskStatus = "todo" | "doing" | "done" | "archived";

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

export interface Task {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  /** ISO instant, or null for "no deadline". */
  due_at: string | null;
  estimated_minutes: number;
  spent_minutes: number;
  priority: Priority;
  status: TaskStatus;
  min_block_minutes: number;
  splittable: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Topic {
  id: string;
  user_id: string;
  name: string;
  notes: string | null;
  target_at: string | null;
  target_minutes_per_week: number;
  confidence: Confidence;
  priority: Priority;
  min_block_minutes: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

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
  /** Exactly one of `task_id` / `topic_id` is non-null. */
  task_id: string | null;
  topic_id: string | null;
  starts_at: string;
  ends_at: string;
  locked: boolean;
  plan_run_id: string | null;
  created_at: string;
}

/** Fields a client may set when creating a task. Server owns the rest. */
export type TaskDraft = Pick<Task, "title"> &
  Partial<
    Pick<
      Task,
      | "notes"
      | "due_at"
      | "estimated_minutes"
      | "priority"
      | "min_block_minutes"
      | "splittable"
    >
  >;

export type TopicDraft = Pick<Topic, "name"> &
  Partial<
    Pick<
      Topic,
      | "notes"
      | "target_at"
      | "target_minutes_per_week"
      | "confidence"
      | "priority"
      | "min_block_minutes"
    >
  >;

/** Minutes of work still owed on a task. Never negative. */
export function remainingMinutes(task: Task): number {
  return Math.max(0, task.estimated_minutes - task.spent_minutes);
}
