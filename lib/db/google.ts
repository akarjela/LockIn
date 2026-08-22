import { createAdminClient } from "@/lib/supabase/admin";
import type { GoogleCredentials } from "@/lib/db/types";

/**
 * The stored Google grant.
 *
 * Every function here goes through the service-role client, because
 * `google_credentials` denies every other role. See lib/supabase/admin.ts for
 * why, and note the rule that follows from it: `user_id` is filtered explicitly
 * on every call, since there is no `auth.uid()` doing it for us.
 *
 * Callers pass a `userId` that came from `requireUser()`, never from a request
 * body — that is the whole authorisation story for this table.
 */

export async function getCredentials(
  userId: string,
): Promise<GoogleCredentials | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("google_credentials")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load Google connection: ${error.message}`);
  }
  return (data as GoogleCredentials | null) ?? null;
}

/**
 * Records a fresh grant from the OAuth callback.
 *
 * `refresh_token` is deliberately not overwritten with null. Google only issues
 * one when the consent screen is actually shown, so a re-authorisation that
 * Google decides to fast-path returns an access token alone — and clobbering the
 * stored refresh token with that would silently turn a working connection into
 * one that dies in an hour.
 */
export async function saveCredentials(
  userId: string,
  grant: {
    access_token: string;
    expires_at: string;
    refresh_token: string | null;
    scope: string | null;
    google_email: string | null;
  },
): Promise<void> {
  const supabase = createAdminClient();

  const { refresh_token, ...rest } = grant;

  const { error } = await supabase.from("google_credentials").upsert(
    {
      user_id: userId,
      ...rest,
      ...(refresh_token ? { refresh_token } : {}),
      // A successful re-connect clears whatever the last failure was, so the UI
      // does not keep showing an error the user has already fixed.
      last_sync_error: null,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw new Error(`Could not save Google connection: ${error.message}`);
  }
}

/** Persists a refreshed access token without touching anything else. */
export async function updateAccessToken(
  userId: string,
  accessToken: string,
  expiresAt: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("google_credentials")
    .update({ access_token: accessToken, expires_at: expiresAt })
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Could not store refreshed token: ${error.message}`);
  }
}

/** Stamps the outcome of a sync. `error` null means it succeeded. */
export async function recordSync(
  userId: string,
  syncedAt: string,
  error: string | null,
): Promise<void> {
  const supabase = createAdminClient();

  const { error: updateError } = await supabase
    .from("google_credentials")
    .update({
      // A failed sync must not advance the timestamp, or "synced 2 minutes ago"
      // would be shown next to an error.
      ...(error ? {} : { last_synced_at: syncedAt }),
      last_sync_error: error,
    })
    .eq("user_id", userId);

  if (updateError) {
    throw new Error(`Could not record sync result: ${updateError.message}`);
  }
}

/** Forgets the grant. The cached events are cleared separately by the caller. */
export async function deleteCredentials(userId: string): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("google_credentials")
    .delete()
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Could not disconnect Google Calendar: ${error.message}`);
  }
}
