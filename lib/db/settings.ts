import { createClient } from "@/lib/supabase/server";
import type { UserSettings } from "@/lib/db/types";

/** Applied when a user has no settings row yet. Mirrors the SQL defaults. */
const DEFAULTS = {
  timezone: "UTC",
  slot_minutes: 15,
  break_minutes: 10,
  daily_cap_minutes: 480,
} as const;

/**
 * Settings for the current user, creating the row on first read.
 *
 * Lazy creation rather than a signup trigger keeps auth decoupled from app
 * tables — a user can exist in `auth.users` before this schema is deployed.
 */
export async function getSettings(userId: string): Promise<UserSettings> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not load settings: ${error.message}`);
  if (data) return data as UserSettings;

  const { data: created, error: insertError } = await supabase
    .from("user_settings")
    .insert({ user_id: userId, ...DEFAULTS })
    .select()
    .single();

  if (insertError) {
    throw new Error(`Could not create settings: ${insertError.message}`);
  }
  return created as UserSettings;
}

export async function updateSettings(
  userId: string,
  patch: Partial<Omit<UserSettings, "user_id" | "created_at" | "updated_at">>,
): Promise<UserSettings> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("user_settings")
    .update(patch)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw new Error(`Could not update settings: ${error.message}`);
  return data as UserSettings;
}
