import { NextResponse } from "next/server";

import { getUser } from "@/lib/auth";
import { CalendarAuthError, CalendarUnavailableError } from "@/lib/google/env";
import { syncCalendar } from "@/lib/google/sync";
import { regeneratePlan } from "@/lib/plan/generate";

/**
 * `POST /api/calendar/sync` — sync the signed-in user's calendar, then rebuild
 * their week.
 *
 * The UI does this through a server action; this route exists for everything
 * that is not a form submission — a cron job, the planned CLI, a shortcut on a
 * phone. It authenticates from the session cookie exactly like the rest of the
 * app, so there is no second authorisation scheme to get wrong.
 *
 * POST rather than GET because it writes. That also means a prefetch or a link
 * preview cannot trigger a sync.
 */
export async function POST() {
  const user = await getUser();
  // 401 rather than a redirect: this has no browser to send anywhere.
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const result = await syncCalendar(user.id);
    const plan = await regeneratePlan(user.id);

    return NextResponse.json({
      synced_at: result.syncedAt,
      window: { from: result.from.toISOString(), to: result.to.toISOString() },
      calendars: result.calendars,
      events: result.events,
      busy_events: result.busyEvents,
      scheduled_blocks: plan.blocks.length,
      unplaced: plan.unplaced.length,
    });
  } catch (error) {
    // 409 for "your connection needs attention" and 412 for "this deployment
    // was never set up" — both are the caller's to fix, and neither is a bug
    // worth a 500 in the logs.
    if (error instanceof CalendarAuthError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof CalendarUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 412 });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Calendar sync failed.",
      },
      { status: 502 },
    );
  }
}
