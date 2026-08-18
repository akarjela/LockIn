import { createBrowserClient } from "@supabase/ssr";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Supabase client for Client Components.
 *
 * `createBrowserClient` memoises internally, so calling this per render is fine.
 * Anything that reads user data should still prefer the server client — this is
 * for interactive/realtime needs only.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
