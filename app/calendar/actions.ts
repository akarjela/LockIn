"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { deleteAllCalendarEvents } from "@/lib/db/availability";
import { deleteCredentials } from "@/lib/db/google";
import { CALENDAR_SCOPE, isCalendarConfigured } from "@/lib/google/env";
import { syncCalendar } from "@/lib/google/sync";
import { regeneratePlan } from "@/lib/plan/generate";
import { getOrigin } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";

/** Where the connect flow returns to, and where every status message is shown. */
const RETURN_TO = "/availability";

/**
 * Starts a second Google authorisation, this time asking for calendar access.
 *
 * Deliberately not folded into sign-in. Adding the calendar scope there would
 * make every new user grant access to their whole calendar before they had seen
 * what the app does — and most of LockIN works fine without it.
 *
 * Two query params carry the flow:
 *   `access_type=offline` is what makes Google issue a refresh token at all.
 *   `prompt=consent` forces the consent screen, and therefore a *new* refresh
 *   token. Without it Google fast-paths an account that has already approved
 *   this client and returns an access token alone, so a reconnect meant to fix a
 *   broken grant would hand back nothing to fix it with.
 */
export async function connectCalendar() {
  await requireUser();

  if (!isCalendarConfigured()) {
    redirect(
      `${RETURN_TO}?calendar_error=${encodeURIComponent(
        "Google Calendar sync is not configured on this deployment. See the README.",
      )}`,
    );
  }

  const supabase = await createClient();
  const origin = await getOrigin();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      scopes: CALENDAR_SCOPE,
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(
        RETURN_TO,
      )}&calendar=1`,
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });

  // `redirect` works by throwing, so it must sit outside any try/catch.
  if (error || !data.url) {
    redirect(
      `${RETURN_TO}?calendar_error=${encodeURIComponent(
        error?.message ?? "Could not reach Google.",
      )}`,
    );
  }

  redirect(data.url);
}

/**
 * Pulls the calendar, then rebuilds the week around it.
 *
 * Rebuilding is the point — a sync that only filled a table would leave the user
 * looking at a plan that still ignores the meeting they just added.
 */
export async function syncCalendarNow() {
  const user = await requireUser();

  let message: string;
  try {
    const result = await syncCalendar(user.id);
    await regeneratePlan(user.id);
    message = `Synced ${result.busyEvents} busy ${
      result.busyEvents === 1 ? "event" : "events"
    } from ${result.calendars} ${
      result.calendars === 1 ? "calendar" : "calendars"
    }.`;
  } catch (error) {
    // `syncCalendar` already recorded the failure on the credentials row, so the
    // page would show it anyway; this just avoids an error screen for what is
    // usually "reconnect me".
    const failure =
      error instanceof Error ? error.message : "Calendar sync failed.";
    revalidatePath(RETURN_TO);
    redirect(`${RETURN_TO}?calendar_error=${encodeURIComponent(failure)}`);
  }

  revalidatePath(RETURN_TO);
  revalidatePath("/");
  redirect(`${RETURN_TO}?calendar_message=${encodeURIComponent(message)}`);
}

/**
 * Forgets the grant and everything synced with it, then rebuilds.
 *
 * Clearing the cached events matters: leaving them would keep blocking time
 * against a calendar the app can no longer see, and nothing would ever update
 * or remove them.
 */
export async function disconnectCalendar() {
  const user = await requireUser();

  await deleteAllCalendarEvents(user.id);
  await deleteCredentials(user.id);
  await regeneratePlan(user.id);

  revalidatePath(RETURN_TO);
  revalidatePath("/");
  redirect(
    `${RETURN_TO}?calendar_message=${encodeURIComponent(
      "Google Calendar disconnected.",
    )}`,
  );
}
