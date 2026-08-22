import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_URL } from "@/lib/env";
import { googleConfig } from "@/lib/google/env";
import { NO_REALTIME } from "@/lib/supabase/no-realtime";

/**
 * Service-role Supabase client. **Bypasses Row Level Security entirely.**
 *
 * It exists for exactly one table: `google_credentials`, which has RLS enabled
 * and no policies, so no other key can touch it. That is deliberate — a Google
 * refresh token is a credential for someone else's system and must not be
 * reachable from the browser even by its owner.
 *
 * Rules for anything written against this client:
 *
 *  1. Every query filters on `user_id` explicitly. There is no `auth.uid()` to
 *     fall back on here; the filter *is* the authorisation.
 *  2. It never handles a value that came from a request body unvalidated.
 *  3. It stays server-side. Importing this from a Client Component would be a
 *     build error (`@supabase/supabase-js` would happily ship), so keep the
 *     import chain inside `lib/db/google.ts` and server actions.
 *
 * No session persistence or token refresh: the service key is not a user
 * session, and leaving those on makes the client stateful for no benefit.
 */
export function createAdminClient() {
  const { serviceRoleKey } = googleConfig();

  return createSupabaseClient(SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Required outside Next.js: `lockin sync` reaches this from a bare Node
    // process, where Realtime's eager WebSocket lookup throws on Node 20.
    realtime: NO_REALTIME,
  });
}
