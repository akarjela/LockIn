"use server";

import { redirect } from "next/navigation";

import { getOrigin, safeRedirectPath } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";

/**
 * Starts the Google OAuth flow.
 *
 * Supabase returns a consent-screen URL rather than performing the redirect
 * itself, so we redirect to it. Because this runs on the server, the PKCE code
 * verifier is written to an httpOnly cookie that /auth/callback reads back.
 */
export async function signInWithGoogle(formData: FormData) {
  const next = safeRedirectPath(formData.get("next")?.toString());
  const supabase = await createClient();
  const origin = await getOrigin();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  // `redirect` works by throwing, so it must sit outside any try/catch.
  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent(error?.message ?? "Could not reach Google.")}`);
  }

  redirect(data.url);
}

/** Clears the session cookies and returns to the login screen. */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
