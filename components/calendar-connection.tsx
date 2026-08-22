import {
  connectCalendar,
  disconnectCalendar,
  syncCalendarNow,
} from "@/app/calendar/actions";

/**
 * The Google Calendar panel on /availability.
 *
 * Presentational, like SiteHeader — everything it renders is passed in, so the
 * page owns the data access and this file has no import path to the database.
 */

export interface CalendarConnectionProps {
  /** Null when the deployment has the environment variables but no grant yet. */
  connection: {
    email: string | null;
    lastSyncedAt: string | null;
    lastSyncError: string | null;
  } | null;
  /** Missing environment variables. Non-empty means the feature is unavailable. */
  missingConfig: string[];
  /** Busy events currently cached inside the planning window. */
  busyEventCount: number;
  timezone: string;
  /** Status carried back from a redirect: `?calendar_message` / `?calendar_error`. */
  message: string | null;
  error: string | null;
}

const PANEL =
  "mt-4 rounded-lg border border-black/10 p-4 dark:border-white/15";

function formatSyncedAt(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instant));
}

export function CalendarConnection({
  connection,
  missingConfig,
  busyEventCount,
  timezone,
  message,
  error,
}: CalendarConnectionProps) {
  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium text-zinc-500">Google Calendar</h2>

      {message && (
        <p className="mt-3 rounded-md border border-emerald-600/30 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-md border border-red-600/30 bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}

      {missingConfig.length > 0 ? (
        // Same bargain the capture box makes without an API key: say what is
        // missing, stay out of the way, and leave the rest of the app working.
        <div className={PANEL}>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Calendar sync is not configured on this deployment.
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Add{" "}
            {missingConfig.map((name, index) => (
              <span key={name}>
                {index > 0 && ", "}
                <code className="font-mono">{name}</code>
              </span>
            ))}{" "}
            to the environment. The README has the two-minute version.
          </p>
        </div>
      ) : connection ? (
        <div className={PANEL}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-medium">
              {connection.email ?? "Connected"}
            </span>
            <span className="text-xs text-zinc-500">
              {connection.lastSyncedAt
                ? `last synced ${formatSyncedAt(connection.lastSyncedAt, timezone)}`
                : "never synced"}
            </span>
          </div>

          <p className="mt-2 text-xs text-zinc-500">
            {busyEventCount === 0
              ? "No busy events in the next two weeks — nothing is being subtracted from your free time yet."
              : `${busyEventCount} busy ${
                  busyEventCount === 1 ? "event" : "events"
                } in the next two weeks are subtracted from the windows above.`}
          </p>

          {connection.lastSyncError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              Last sync failed: {connection.lastSyncError}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <form action={syncCalendarNow}>
              <button
                type="submit"
                className="h-10 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Sync now
              </button>
            </form>

            <form action={connectCalendar}>
              <button
                type="submit"
                className="h-10 rounded-md border border-black/10 px-4 text-sm font-medium transition-colors hover:bg-zinc-50 dark:border-white/15 dark:hover:bg-zinc-800"
              >
                Reconnect
              </button>
            </form>

            <form action={disconnectCalendar} className="ml-auto">
              <button
                type="submit"
                className="text-xs text-zinc-400 transition-colors hover:text-red-600"
              >
                Disconnect
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className={PANEL}>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Connect a calendar and its events are subtracted from the windows
            above, so the planner stops scheduling over your meetings.
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Read-only. All-day events are ignored on purpose — a birthday should
            not erase a day — as are events marked free and invitations you
            declined.
          </p>

          <form action={connectCalendar} className="mt-4">
            <button
              type="submit"
              className="h-10 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Connect Google Calendar
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
