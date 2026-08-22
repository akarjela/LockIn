/**
 * Environment for the Google Calendar integration.
 *
 * Separate from lib/env.ts on purpose. Those two variables are required — the
 * app cannot start without them, so reading them at module load and throwing is
 * the right failure. These three are *optional*: without them LockIN works
 * exactly as before and only the calendar section is disabled, the same bargain
 * `ANTHROPIC_API_KEY` gets. So they are read lazily, through a check the UI can
 * call to render a setup hint instead of a stack trace.
 */

/** Signals "this feature is not configured", as opposed to "it broke". */
export class CalendarUnavailableError extends Error {}

/** Signals "the Google grant is gone or insufficient" — the user must reconnect. */
export class CalendarAuthError extends Error {}

/**
 * Read-only access to events and to the list of calendars.
 *
 * `calendar.readonly` covers both. The narrower `calendar.events.readonly` would
 * not let us enumerate which calendars exist, and syncing only `primary` would
 * quietly miss the shared calendar most people keep their classes on.
 */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  serviceRoleKey: string;
}

/**
 * What is missing, as a human-readable list. Empty means fully configured.
 *
 * Returned rather than thrown so a page can render "here is what to add to
 * .env.local" without a try/catch around its own layout.
 */
export function missingCalendarConfig(): string[] {
  const missing: string[] = [];
  if (!process.env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  return missing;
}

export function isCalendarConfigured(): boolean {
  return missingCalendarConfig().length === 0;
}

/**
 * @throws CalendarUnavailableError naming exactly which variables are absent,
 *         so the fix is obvious from the message alone.
 */
export function googleConfig(): GoogleConfig {
  const missing = missingCalendarConfig();
  if (missing.length > 0) {
    throw new CalendarUnavailableError(
      `Google Calendar sync needs ${missing.join(", ")} in the environment. ` +
        `The client ID and secret are the same pair you gave Supabase's Google ` +
        `provider; the service role key is under Project Settings → API.`,
    );
  }

  return {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  };
}
