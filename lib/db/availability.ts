import { currentSupabase } from "@/lib/supabase/current";
import type { AvailabilityBlock, CalendarEvent, Weekday } from "@/lib/db/types";
import type { NewCalendarEvent } from "@/lib/google/calendar";

export async function listAvailability(
  userId: string,
): Promise<AvailabilityBlock[]> {
  const supabase = await currentSupabase();

  const { data, error } = await supabase
    .from("availability_blocks")
    .select("*")
    .eq("user_id", userId)
    .order("weekday", { ascending: true })
    .order("start_minute", { ascending: true });

  if (error) throw new Error(`Could not load availability: ${error.message}`);
  return (data ?? []) as AvailabilityBlock[];
}

export async function createAvailability(
  userId: string,
  block: {
    weekday: Weekday;
    start_minute: number;
    end_minute: number;
    label?: string | null;
  },
): Promise<AvailabilityBlock> {
  const supabase = await currentSupabase();

  const { data, error } = await supabase
    .from("availability_blocks")
    .insert({ ...block, user_id: userId })
    .select()
    .single();

  if (error) {
    throw new Error(`Could not add availability block: ${error.message}`);
  }
  return data as AvailabilityBlock;
}

export async function deleteAvailability(
  userId: string,
  id: string,
): Promise<void> {
  const supabase = await currentSupabase();

  const { error } = await supabase
    .from("availability_blocks")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Could not delete availability block: ${error.message}`);
  }
}

/**
 * Busy calendar events overlapping [from, to).
 *
 * The bounds are deliberately asymmetric: an event that *starts* before the
 * window but runs into it still blocks time, so the filter is on `ends_at > from`
 * rather than `starts_at >= from`.
 */
export async function listBusyEvents(
  userId: string,
  from: Date,
  to: Date,
): Promise<CalendarEvent[]> {
  const supabase = await currentSupabase();

  const { data, error } = await supabase
    .from("calendar_events")
    .select("*")
    .eq("user_id", userId)
    .eq("is_busy", true)
    .gt("ends_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at", { ascending: true });

  if (error) {
    throw new Error(`Could not load calendar events: ${error.message}`);
  }
  return (data ?? []) as CalendarEvent[];
}

/** PostgREST sends the whole batch in one request body; keep it a sane size. */
const UPSERT_CHUNK = 250;

/**
 * Writes synced events, updating any that already existed.
 *
 * Upsert rather than delete-then-insert so the cache never has a moment where it
 * is empty. A regeneration that landed in that gap would see a wide-open week
 * and schedule straight through the user's meetings.
 *
 * Every row carries the same `synced_at`, which is what {@link pruneCalendarEvents}
 * keys off afterwards.
 */
export async function upsertCalendarEvents(
  userId: string,
  events: NewCalendarEvent[],
  syncedAt: string,
): Promise<void> {
  if (events.length === 0) return;
  const supabase = await currentSupabase();

  for (let i = 0; i < events.length; i += UPSERT_CHUNK) {
    const { error } = await supabase.from("calendar_events").upsert(
      events.slice(i, i + UPSERT_CHUNK).map((event) => ({
        ...event,
        user_id: userId,
        synced_at: syncedAt,
      })),
      { onConflict: "user_id,external_id" },
    );

    if (error) {
      throw new Error(`Could not store calendar events: ${error.message}`);
    }
  }
}

/**
 * Deletes cached events the sync just *didn't* see.
 *
 * This is how an event deleted or moved in Google disappears here. Keying on
 * `synced_at` rather than on a list of surviving ids matters: a few hundred ids
 * in a `not.in.(...)` filter is a URL long enough to be rejected, and it grows
 * with the user's calendar.
 *
 * Scoped to the window that was actually synced. Pruning on `synced_at` alone
 * would delete every event outside it, since nothing re-stamped those.
 */
export async function pruneCalendarEvents(
  userId: string,
  from: Date,
  to: Date,
  syncedAt: string,
): Promise<void> {
  const supabase = await currentSupabase();

  const { error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("user_id", userId)
    .gt("ends_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .lt("synced_at", syncedAt);

  if (error) {
    throw new Error(`Could not prune calendar events: ${error.message}`);
  }
}

/**
 * Drops events that ended before `before`.
 *
 * Without this the cache only grows: pruning is scoped to the synced window, and
 * yesterday's meetings never appear in one again.
 */
export async function deletePastCalendarEvents(
  userId: string,
  before: Date,
): Promise<void> {
  const supabase = await currentSupabase();

  const { error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("user_id", userId)
    .lt("ends_at", before.toISOString());

  if (error) {
    throw new Error(`Could not clear old calendar events: ${error.message}`);
  }
}

/** Clears the whole cache, for disconnecting. */
export async function deleteAllCalendarEvents(userId: string): Promise<void> {
  const supabase = await currentSupabase();

  const { error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Could not clear calendar events: ${error.message}`);
  }
}
