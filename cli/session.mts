import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  createClient,
  type SupabaseClient,
  type SupportedStorage,
  type User,
} from "@supabase/supabase-js";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";
import { setSupabaseFactory } from "@/lib/supabase/current";
import { NO_REALTIME } from "@/lib/supabase/no-realtime";

/**
 * Signing the CLI in, and keeping it signed in.
 *
 * The web app signs in with Google through Supabase. The CLI does the same
 * thing, and that is the point: it lands on the *same* Supabase user, so
 * `lockin week` shows the week the browser shows. Any other login route — a
 * password, an emailed code — risks Supabase minting a second identity and the
 * CLI quietly reading an empty account.
 *
 * The flow is the standard loopback one: start a server on 127.0.0.1, send the
 * browser through Google with that as the redirect target, and catch the `code`
 * when it comes back. PKCE makes this safe without a client secret — the
 * verifier never leaves this process.
 */

/**
 * Fixed, because it has to be allowlisted in Supabase's URL configuration and a
 * random port could not be. Bound to 127.0.0.1 rather than every interface: the
 * server exists for seconds, but it exists to receive an authorisation code.
 */
const CALLBACK_PORT = 8765;
const CALLBACK_URL = `http://127.0.0.1:${CALLBACK_PORT}`;

/** Long enough to find the browser window and pick an account. */
const LOGIN_TIMEOUT_MS = 180_000;

function configDir(): string {
  const base =
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "lockin");
}

function sessionPath(): string {
  return join(configDir(), "session.json");
}

/**
 * Supabase's session store, backed by one file.
 *
 * Implementing `SupportedStorage` rather than persisting the session by hand
 * means supabase-js writes back every token it refreshes, so a rotated refresh
 * token is never lost — the failure mode there is being silently logged out a
 * day later with no idea why.
 *
 * Written 0600: this file holds a refresh token for the account.
 */
const fileStorage: SupportedStorage = {
  getItem(key) {
    try {
      const store = JSON.parse(readFileSync(sessionPath(), "utf8"));
      return store[key] ?? null;
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    let store: Record<string, string> = {};
    try {
      store = JSON.parse(readFileSync(sessionPath(), "utf8"));
    } catch {
      // First write; start from an empty store.
    }
    store[key] = value;

    const path = sessionPath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(store), { mode: 0o600 });
    // `writeFileSync`'s mode only applies when it creates the file, so an
    // existing one keeps whatever permissions it had.
    chmodSync(path, 0o600);
  },
  removeItem(key) {
    try {
      const store = JSON.parse(readFileSync(sessionPath(), "utf8"));
      delete store[key];
      writeFileSync(sessionPath(), JSON.stringify(store), { mode: 0o600 });
    } catch {
      // Nothing stored; nothing to remove.
    }
  },
};

let client: SupabaseClient | null = null;

/**
 * The CLI's Supabase client.
 *
 * `autoRefreshToken` is off deliberately: it schedules a timer that would keep a
 * one-shot process alive after its work is done. {@link requireUser} refreshes
 * explicitly instead, which is all a short-lived command needs.
 */
export function cliClient(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage: fileStorage,
      },
      realtime: NO_REALTIME,
    });

    // Every `lib/db/*` query now resolves to this client rather than to the
    // cookie-based one. Declared once, here, before any command runs — which is
    // the rule that makes the module-level factory safe.
    setSupabaseFactory(async () => cliClient());
  }
  return client;
}

export class NotSignedInError extends Error {}

/**
 * The signed-in user, refreshing the session first if it is close to expiring.
 *
 * `getUser()` at the end is not redundant: it validates the token against the
 * Auth server rather than trusting what is on disk, exactly as `lib/auth.ts`
 * does for the web app.
 */
export async function requireUser(): Promise<User> {
  const supabase = cliClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new NotSignedInError("Not signed in. Run `lockin login` first.");
  }

  const expiresAt = (session.expires_at ?? 0) * 1000;
  if (expiresAt - Date.now() < 60_000) {
    const { error } = await supabase.auth.refreshSession();
    if (error) {
      throw new NotSignedInError(
        `Your saved session could not be refreshed (${error.message}). Run \`lockin login\` again.`,
      );
    }
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new NotSignedInError(
      "Your saved session is no longer valid. Run `lockin login` again.",
    );
  }
  return user;
}

/** Best-effort: a failure here only means the user opens the URL themselves. */
function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    spawn(command, [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // The URL is printed regardless.
  }
}

const DONE_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>LockIN</title>
<body style="font-family:system-ui;padding:3rem;max-width:32rem">
<h1 style="font-size:1.25rem">Signed in to the LockIN CLI.</h1>
<p style="color:#666">You can close this tab and go back to the terminal.</p>
`;

/** Waits for Google to send the browser back here with a code. */
function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", CALLBACK_URL);
      const code = url.searchParams.get("code");
      const error =
        url.searchParams.get("error_description") ?? url.searchParams.get("error");

      // The browser asks for /favicon.ico too; ignore anything without an answer.
      if (!code && !error) {
        response.writeHead(204).end();
        return;
      }

      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(DONE_PAGE);
      server.close();
      clearTimeout(timer);

      if (error) reject(new Error(`Google returned an error: ${error}`));
      else resolve(code!);
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for the browser to come back."));
    }, LOGIN_TIMEOUT_MS);

    server.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              `Port ${CALLBACK_PORT} is already in use, and the sign-in redirect ` +
                `has to land on exactly that port. Close whatever is using it and retry.`,
            )
          : error,
      );
    });

    server.listen(CALLBACK_PORT, "127.0.0.1");
  });
}

/** Runs the whole browser sign-in and stores the resulting session. */
export async function login(): Promise<User> {
  const supabase = cliClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: CALLBACK_URL, skipBrowserRedirect: true },
  });

  if (error || !data.url) {
    throw new Error(error?.message ?? "Could not start the Google sign-in.");
  }

  // The listener starts before the browser does, so a fast redirect cannot
  // arrive at a port nothing is listening on yet.
  const codePromise = waitForCode();

  console.log("Opening your browser to sign in with Google…");
  console.log(`If it does not open, paste this in yourself:\n\n${data.url}\n`);
  openBrowser(data.url);

  const code = await codePromise;

  const { data: exchanged, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !exchanged.user) {
    throw new Error(
      exchangeError?.message ?? "Could not complete the sign-in exchange.",
    );
  }
  return exchanged.user;
}

/** Forgets the stored session, both in Supabase and on disk. */
export async function logout(): Promise<void> {
  await cliClient().auth.signOut().catch(() => {});
  try {
    rmSync(sessionPath());
  } catch {
    // Already gone.
  }
}

export { CALLBACK_URL, sessionPath };
