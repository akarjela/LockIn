import { headers } from "next/headers";

/**
 * The public origin of the current request, e.g. `https://lockin.vercel.app`.
 *
 * `request.url` is not reliable for this on Vercel: the app runs behind a proxy,
 * so the inbound URL can carry an internal host. The forwarded headers carry the
 * host the browser actually used, which is what an OAuth `redirectTo` needs.
 */
export async function getOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const protocol =
    headerList.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");

  if (!host) throw new Error("Could not determine request host.");
  return `${protocol}://${host}`;
}

/**
 * Guards a user-supplied post-login redirect target.
 *
 * The `next` param travels through an external redirect chain, so treating it as
 * trusted would let `?next=https://evil.example` turn our login into an open
 * redirect. Only same-site absolute paths are allowed through.
 */
export function safeRedirectPath(
  next: string | null | undefined,
  fallback = "/",
): string {
  if (!next) return fallback;
  // Reject protocol-relative (`//evil.com`) and absolute URLs; require a rooted path.
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}
