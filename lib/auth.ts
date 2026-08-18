import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

/**
 * Data Access Layer for the current user.
 *
 * Every server-side read of "who is this?" goes through here rather than
 * through a layout or page prop. Two reasons:
 *
 *  1. `getUser()` re-validates the JWT with the Supabase Auth server. Reading
 *     `getSession()` instead would trust a cookie the client can edit.
 *  2. Auth checks belong next to the data access, not in a layout. Layouts do
 *     not re-run on every navigation, so a check there can be stale or skipped.
 *
 * `cache` dedupes the call within a single request, so several components can
 * ask independently without extra network round trips.
 */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Same as {@link getUser}, but redirects to /login instead of returning null.
 * Use this at the top of any page or Server Action that requires a session.
 */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
