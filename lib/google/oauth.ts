import { CalendarAuthError, googleConfig } from "@/lib/google/env";

/**
 * Google's OAuth endpoints, used for exactly two things: turning a refresh token
 * into a live access token, and asking what a token is actually good for.
 *
 * Supabase performs the initial code exchange — it owns the client secret in its
 * own configuration and hands us `provider_token` / `provider_refresh_token` at
 * the callback. It does not refresh those for us, though, and it never tells us
 * which scopes the user granted. Both gaps are filled here.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const TOKENINFO_ENDPOINT = "https://oauth2.googleapis.com/tokeninfo";

/**
 * Refresh a little before the token actually dies.
 *
 * A sync can take several seconds across a few calendars, so a token with 30
 * seconds left would expire mid-run and fail half the pages.
 */
const EXPIRY_MARGIN_MS = 120_000;

export interface RefreshedToken {
  accessToken: string;
  expiresAt: Date;
}

/** True when the token is expired, or close enough that it will be mid-request. */
export function needsRefresh(expiresAt: string | Date, now = new Date()): boolean {
  const expiry = new Date(expiresAt).getTime();
  return expiry - now.getTime() <= EXPIRY_MARGIN_MS;
}

/** Google returns a lifetime in seconds; the database stores an instant. */
export function expiryFromNow(expiresInSeconds: number, now = new Date()): Date {
  // Guard against a missing or nonsensical value: an hour is Google's documented
  // default, and a wrong-but-short guess only costs one extra refresh.
  const seconds =
    Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? expiresInSeconds
      : 3600;
  return new Date(now.getTime() + seconds * 1000);
}

/**
 * Exchanges a refresh token for a new access token.
 *
 * @throws CalendarAuthError when Google rejects the refresh token itself —
 *         revoked in the Google account, or expired after six months unused.
 *         That is unrecoverable without the user re-consenting, so it is a
 *         distinct type from a transient network failure.
 */
export async function refreshAccessToken(
  refreshToken: string,
  now = new Date(),
): Promise<RefreshedToken> {
  const { clientId, clientSecret } = googleConfig();

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    // `invalid_grant` is the specific "this refresh token is dead" answer.
    if (payload.error === "invalid_grant") {
      throw new CalendarAuthError(
        "Google no longer accepts the stored authorisation — it was revoked or " +
          "expired. Reconnect Google Calendar to fix it.",
      );
    }
    throw new Error(
      `Could not refresh the Google token: ${
        payload.error_description ?? payload.error ?? response.status
      }`,
    );
  }

  return {
    accessToken: payload.access_token,
    expiresAt: expiryFromNow(payload.expires_in ?? 3600, now),
  };
}

export interface TokenInfo {
  /** Space-separated scopes actually granted. */
  scope: string | null;
  email: string | null;
  expiresAt: Date | null;
}

/**
 * Asks Google what an access token is good for.
 *
 * Worth one extra call at connect time: the consent screen lets someone untick
 * calendar access while still completing sign-in, and without this the failure
 * surfaces much later as an opaque 403 from a sync they did not initiate.
 *
 * Returns nulls rather than throwing on a bad response — a connection whose
 * scope we could not confirm is still worth storing and trying.
 */
export async function fetchTokenInfo(accessToken: string): Promise<TokenInfo> {
  try {
    const response = await fetch(
      `${TOKENINFO_ENDPOINT}?access_token=${encodeURIComponent(accessToken)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return { scope: null, email: null, expiresAt: null };

    const payload = (await response.json()) as {
      scope?: string;
      email?: string;
      expires_in?: number | string;
    };

    const expiresIn = Number(payload.expires_in);

    return {
      scope: payload.scope ?? null,
      email: payload.email ?? null,
      expiresAt: Number.isFinite(expiresIn) ? expiryFromNow(expiresIn) : null,
    };
  } catch {
    return { scope: null, email: null, expiresAt: null };
  }
}

/** Whether a space-separated scope string includes `scope`. */
export function hasScope(granted: string | null, scope: string): boolean {
  if (!granted) return false;
  return granted.split(/\s+/).includes(scope);
}
