/**
 * A WebSocket that refuses to be one.
 *
 * `createClient` builds a Realtime client eagerly, and Realtime resolves a
 * WebSocket implementation while doing so — throwing outright when it cannot
 * find one. Node 20 has no global `WebSocket`; Node 22 does, and so does the
 * Next.js server runtime, which is why this only bites outside Next: a bare
 * `tsx`/`node` process such as the CLI.
 *
 * Passing `transport` short-circuits that lookup. This is not a shim. Adding
 * `ws` as a dependency to satisfy a connection that is never opened would be
 * worse, and anything that genuinely tried to use Realtime should fail loudly
 * rather than quietly work.
 *
 * It lives here rather than next to one client because there are two — the
 * service-role client in `admin.ts` and the CLI's session client — and the
 * failure mode when one of them forgets is nasty: the code path works under
 * `next dev` and dies only in the CLI, which is exactly how it was first missed.
 *
 * Safe to delete both usages once this project is on Node 22.
 */
class NoRealtimeTransport {
  constructor() {
    throw new Error("LockIN does not use Supabase Realtime.");
  }
}

/**
 * Spread into `createClient` options. Cast because the option is typed for a
 * real WebSocket constructor and this deliberately is not one.
 */
export const NO_REALTIME = {
  transport: NoRealtimeTransport as unknown as typeof WebSocket,
};
