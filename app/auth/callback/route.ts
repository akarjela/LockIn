import { NextResponse, type NextRequest } from "next/server";

import { getOrigin, safeRedirectPath } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth callback. Google sends the user back here with a short-lived `code`,
 * which we trade for a session. The exchange writes the session cookies through
 * the server client, so the redirect that follows is already authenticated.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"));
  const origin = await getOrigin();

  // Google reports a declined consent screen as an error param, not a code.
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(oauthError)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("No sign-in code was returned.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
