import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/** Routes reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = ["/login", "/auth"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * Runs before every matched request. Two jobs:
 *
 *  1. Refresh the Supabase session. Access tokens are short-lived, and Server
 *     Components cannot write cookies, so this is the one place a refreshed
 *     token can be persisted back to the browser.
 *  2. An optimistic redirect for signed-out users, purely to avoid rendering a
 *     page that would immediately bounce. It is *not* the security boundary —
 *     that is `requireUser()` in lib/auth.ts, next to the data access.
 *
 * In Next.js 16 this file replaces `middleware.ts`; the behaviour is the same.
 */
export async function proxy(request: NextRequest) {
  // `response` is reassigned by setAll below, so it must be `let`.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Write to the request so anything downstream in this pass sees the new
        // token, then rebuild the response so the browser receives it too.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Do not remove: this call is what triggers the token refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const loginUrl = new URL("/login", request.url);
    // Remember where they were headed so callback can return them there.
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Returning this exact object matters — a fresh NextResponse here would drop
  // the refreshed cookies and log the user out on the next request.
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Those never need a
     * session, and running the refresh on them wastes an auth round trip.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
