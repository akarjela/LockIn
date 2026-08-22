import {
  deletePastCalendarEvents,
  pruneCalendarEvents,
  upsertCalendarEvents,
} from "@/lib/db/availability";
import {
  getCredentials,
  recordSync,
  updateAccessToken,
} from "@/lib/db/google";
import { getSettings } from "@/lib/db/settings";
import type { GoogleCredentials } from "@/lib/db/types";
import {
  listEvents,
  listSyncableCalendars,
  toCalendarEventRow,
  type NewCalendarEvent,
} from "@/lib/google/calendar";
import {
  CALENDAR_SCOPE,
  CalendarAuthError,
  CalendarUnavailableError,
} from "@/lib/google/env";
import { hasScope, needsRefresh, refreshAccessToken } from "@/lib/google/oauth";

/**
 * Pulls Google Calendar into `calendar_events`, which the engine already knows
 * how to subtract from availability.
 *
 * This is the bridge, and like `lib/plan/generate.ts` it makes no scheduling
 * decisions — it moves data and stamps the result. Every judgement about what
 * counts as busy lives in the pure `toCalendarEventRow`.
 */

/**
 * Two weeks, against a seven-day planning window.
 *
 * The margin is what lets a plan built later in the day still see real busy
 * times without a fresh sync. Syncing exactly the plan window would leave the
 * far edge blind the moment the window rolled forward by an hour.
 */
const SYNC_HORIZON_DAYS = 14;

/** How long finished events stay cached before being swept. */
const KEEP_PAST_DAYS = 7;

export interface SyncResult {
  calendars: number;
  events: number;
  busyEvents: number;
  syncedAt: string;
  from: Date;
  to: Date;
}

/**
 * Returns a usable access token, refreshing and persisting it if it is close to
 * expiry.
 *
 * @throws CalendarAuthError when there is nothing left to refresh with — the
 *         grant predates refresh-token storage, or Google revoked it.
 */
async function freshAccessToken(
  credentials: GoogleCredentials,
  now: Date,
): Promise<string> {
  if (!needsRefresh(credentials.expires_at, now)) {
    return credentials.access_token;
  }

  if (!credentials.refresh_token) {
    throw new CalendarAuthError(
      "The Google access token has expired and no refresh token was stored. " +
        "Reconnect Google Calendar.",
    );
  }

  const refreshed = await refreshAccessToken(credentials.refresh_token, now);
  await updateAccessToken(
    credentials.user_id,
    refreshed.accessToken,
    refreshed.expiresAt.toISOString(),
  );
  return refreshed.accessToken;
}

/** The window a sync covers: now until `SYNC_HORIZON_DAYS` out. */
export function syncWindow(now: Date): { from: Date; to: Date } {
  return {
    from: now,
    to: new Date(now.getTime() + SYNC_HORIZON_DAYS * 86_400_000),
  };
}

/**
 * Syncs every selected calendar into the cache.
 *
 * The order is deliberate: upsert everything first, then delete what this run
 * did not write. Doing it the other way round leaves a window where the user has
 * no busy times at all, and a plan regenerated in that window would schedule
 * straight over their meetings.
 *
 * Failures are recorded on the credentials row rather than swallowed, so a
 * connection that quietly stopped working is visible on /availability instead of
 * showing a plan built from month-old data.
 *
 * @throws CalendarUnavailableError when the integration is not configured or the
 *         user has not connected an account.
 */
export async function syncCalendar(
  userId: string,
  now = new Date(),
): Promise<SyncResult> {
  const credentials = await getCredentials(userId);
  if (!credentials) {
    throw new CalendarUnavailableError(
      "No Google Calendar is connected for this account.",
    );
  }

  // Checked before spending any round trips: a grant without the calendar scope
  // fails every request with a 403, and the reason is right here.
  if (credentials.scope && !hasScope(credentials.scope, CALENDAR_SCOPE)) {
    const message =
      "The Google connection does not include calendar access. Reconnect and " +
      "tick the calendar permission on the consent screen.";
    await recordSync(userId, now.toISOString(), message);
    throw new CalendarAuthError(message);
  }

  const settings = await getSettings(userId);
  const { from, to } = syncWindow(now);
  // One stamp for the whole run, so the prune below can say "anything older than
  // this, inside this window, is gone from Google".
  const syncedAt = now.toISOString();

  try {
    const accessToken = await freshAccessToken(credentials, now);
    const calendars = await listSyncableCalendars(accessToken);

    const rows: NewCalendarEvent[] = [];
    // Sequential rather than parallel: Google rate-limits per user, and nobody
    // has enough calendars for the latency to matter.
    for (const calendar of calendars) {
      const events = await listEvents(accessToken, calendar.id, from, to);
      for (const event of events) {
        const row = toCalendarEventRow(event, calendar.id, settings.timezone);
        if (row) rows.push(row);
      }
    }

    // The same event on two calendars maps to two distinct external_ids, but a
    // single calendar can still repeat an id across pages if it changed mid-walk.
    // De-duplicate before the upsert, which would otherwise reject the batch for
    // touching one row twice.
    const byExternalId = new Map(rows.map((row) => [row.external_id, row]));
    const deduped = [...byExternalId.values()];

    await upsertCalendarEvents(userId, deduped, syncedAt);
    await pruneCalendarEvents(userId, from, to, syncedAt);
    await deletePastCalendarEvents(
      userId,
      new Date(now.getTime() - KEEP_PAST_DAYS * 86_400_000),
    );

    await recordSync(userId, syncedAt, null);

    return {
      calendars: calendars.length,
      events: deduped.length,
      busyEvents: deduped.filter((row) => row.is_busy).length,
      syncedAt,
      from,
      to,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Calendar sync failed.";
    // Best-effort: if recording the failure also fails, the original error is
    // the more useful one to surface.
    await recordSync(userId, syncedAt, message).catch(() => {});
    throw error;
  }
}
