import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The Supabase client `lib/db/*` should use right now.
 *
 * The web app has exactly one answer: a per-request client built from the
 * request's cookies. The CLI has a different one: a client holding a session
 * loaded from `~/.config/lockin/`. Rather than thread a client argument through
 * every query function — and every caller of every query function — the process
 * declares once, at startup, how to get one.
 *
 * That makes this module-level mutable state, which is only safe because of a
 * rule: **only a CLI entrypoint ever calls `setSupabaseFactory`, and only before
 * doing any work.** The Next.js server never calls it, so there is no per-request
 * state here to leak between users; `currentSupabase()` falls through to the
 * cookie-based client and behaves exactly as it did before this existed.
 *
 * The import of the cookie client is dynamic on purpose. It reaches
 * `next/headers`, which does not exist outside a Next.js runtime — a static
 * import would break the CLI at load time even though it never calls this path.
 */

type SupabaseFactory = () => Promise<SupabaseClient>;

let factory: SupabaseFactory | null = null;

/** Called once by a CLI entrypoint. Never by the web app. */
export function setSupabaseFactory(next: SupabaseFactory): void {
  factory = next;
}

export async function currentSupabase(): Promise<SupabaseClient> {
  if (factory) return factory();

  const { createClient } = await import("@/lib/supabase/server");
  return createClient();
}
