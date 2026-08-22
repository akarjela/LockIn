import type { Session } from "@supabase/supabase-js";

import { saveCredentials } from "@/lib/db/google";
import { CALENDAR_SCOPE, isCalendarConfigured } from "@/lib/google/env";
import { expiryFromNow, fetchTokenInfo, hasScope } from "@/lib/google/oauth";

/**
 * Captures the Google grant out of a freshly exchanged Supabase session.
 *
 * Supabase performs the code exchange and hands back `provider_token` and
 * `provider_refresh_token` — once, at the callback, and then never again. It
 * does not store them, does not refresh them, and does not say what scopes were
 * granted. So this is the only moment the tokens exist, and it has to be where
 * they are persisted.
 *
 * Returns a message instead of throwing: this runs inside a redirect handler,
 * where the right response to "the calendar part failed" is still to complete
 * the sign-in and say so on the next page.
 */
export async function storeGoogleGrant(
  userId: string,
  session: Session | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isCalendarConfigured()) {
    return {
      ok: false,
      message:
        "Google Calendar sync is not configured on this deployment. See the README.",
    };
  }

  const accessToken = session?.provider_token;
  if (!accessToken) {
    return {
      ok: false,
      message:
        "Google did not return an access token. Try connecting again, and " +
        "allow the calendar permission when asked.",
    };
  }

  // One extra round trip, and worth it: the consent screen lets someone untick
  // calendar access while still completing sign-in, and this is the only way to
  // notice now rather than as an unexplained 403 during a later sync.
  const info = await fetchTokenInfo(accessToken);

  if (info.scope && !hasScope(info.scope, CALENDAR_SCOPE)) {
    return {
      ok: false,
      message:
        "Calendar access was not granted — the permission was unticked on the " +
        "Google consent screen. Connect again and leave it ticked.",
    };
  }

  await saveCredentials(userId, {
    access_token: accessToken,
    // Google's own expiry when tokeninfo gave one, otherwise its documented
    // default. Erring short only costs an extra refresh.
    expires_at: (info.expiresAt ?? expiryFromNow(3600)).toISOString(),
    refresh_token: session?.provider_refresh_token ?? null,
    scope: info.scope,
    google_email: info.email,
  });

  return { ok: true };
}
