import { NextResponse, type NextRequest } from "next/server";

import { storeGoogleGrant } from "@/lib/google/connect";
import { getOrigin, safeRedirectPath } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth callback. Google sends the user back here with a short-lived `code`,
 * which we trade for a session. The exchange writes the session cookies through
 * the server client, so the redirect that follows is already authenticated.
 *
 * It serves two flows. Plain sign-in is the common one. `?calendar=1` marks the
 * other: the same Google account, re-authorised with the calendar scope, coming
 * back from "Connect Google Calendar". The flag travels out in `redirectTo` and
 * survives the round trip, which is how we know to look for provider tokens in
 * the exchanged session — they are only readable here, and only this once.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"));
  const isCalendarConnect = searchParams.get("calendar") === "1";
  const origin = await getOrigin();

  /** `next` with a status param attached, without assuming it carries no query. */
  const backTo = (param: string, value: string): string => {
    const url = new URL(next, origin);
    url.searchParams.set(param, value);
    return url.toString();
  };

  // Google reports a declined consent screen as an error param, not a code.
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");
  if (oauthError) {
    // A failed *calendar* connect must not dump a signed-in user back at the
    // login screen — their session is fine; only the extra grant fell through.
    if (isCalendarConnect) {
      return NextResponse.redirect(backTo("calendar_error", oauthError));
    }
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(oauthError)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("No sign-in code was returned.")}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  if (isCalendarConnect && data.session) {
    // Stored through the service-role client, which reads no cookies — so this
    // does not depend on the session cookies written moments ago being readable
    // back within the same request.
    try {
      const stored = await storeGoogleGrant(data.session.user.id, data.session);
      if (!stored.ok) {
        return NextResponse.redirect(backTo("calendar_error", stored.message));
      }
    } catch (storeError) {
      return NextResponse.redirect(
        backTo(
          "calendar_error",
          storeError instanceof Error
            ? storeError.message
            : "Could not save the Google connection.",
        ),
      );
    }
    return NextResponse.redirect(backTo("calendar", "connected"));
  }

  return NextResponse.redirect(`${origin}${next}`);
}
