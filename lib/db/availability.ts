import { createClient } from "@/lib/supabase/server";
import type { AvailabilityBlock, CalendarEvent, Weekday } from "@/lib/db/types";

export async function listAvailability(
  userId: string,
): Promise<AvailabilityBlock[]> {
  const supabase = await createClient();

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
  const supabase = await createClient();

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
  const supabase = await createClient();

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
  const supabase = await createClient();

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
