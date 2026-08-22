#!/usr/bin/env -S npx tsx

import { loadEnvFile } from "./env.mts";

/**
 * `lockin` — the week, from a terminal.
 *
 * The whole point of this file is the import order. `lib/env.ts` reads its
 * variables at module load and throws when they are missing, so `.env.local`
 * has to be in `process.env` before anything that reaches it is imported. A
 * static `import` would be hoisted above the call below and defeat that, which
 * is why every real import here is dynamic.
 *
 * Everything past that boundary is the web app's own code, unchanged:
 * `lib/plan/generate.ts` for a rebuild, `lib/db/*` for storage, `lib/schedule/*`
 * for every decision. The CLI adds a session and some printing, and nothing else.
 */

const HELP = `lockin — plan your week from the terminal

  lockin login              Sign in with Google (opens a browser)
  lockin logout             Forget the saved session
  lockin whoami             Show who is signed in

  lockin week               Print the current plan
  lockin plan               Rebuild the week, then print it
  lockin work [--all]       List work items (--all includes done and paused)

  lockin add <title>        Add an item, then rebuild
      --minutes N             total minutes of work (default 30)
      --weekly N              minutes per week instead — makes it recurring
      --due YYYY-MM-DD[THH:MM]   deadline, in your timezone
      --priority 1|2|3        1 highest, default 2
  lockin done <id>          Mark an item done, then rebuild

  lockin capture <text>     Turn prose into items with Claude, then rebuild
      --yes                   skip the confirmation prompt

  lockin sync               Pull Google Calendar, then rebuild
  lockin calendar           Show cached busy events for the coming week

Reads .env.local from the current directory, so run it from the repo — or export
NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY yourself.`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return 0;
  }

  // Must happen before the imports below, not as a static import at the top.
  loadEnvFile();

  const [{ parseArgs }, commands, session, { red }] = await Promise.all([
    import("./args.mts"),
    import("./commands.mts"),
    import("./session.mts"),
    import("./render.mts"),
  ]);

  const flags = parseArgs(argv.slice(1));

  try {
    switch (command) {
      case "login": {
        const user = await session.login();
        console.log(`Signed in as ${user.email ?? user.id}.`);
        return 0;
      }
      case "logout":
        await session.logout();
        console.log("Signed out.");
        return 0;
      case "whoami": {
        const user = await session.requireUser();
        console.log(user.email ?? user.id);
        return 0;
      }

      case "week":
        await commands.week();
        return 0;
      case "plan":
        await commands.plan();
        return 0;
      case "work":
        await commands.work(flags);
        return 0;
      case "add":
        await commands.add(flags);
        return 0;
      case "done":
        await commands.done(flags);
        return 0;
      case "capture":
        await commands.capture(flags);
        return 0;
      case "sync":
        await commands.sync();
        return 0;
      case "calendar":
        await commands.calendar();
        return 0;

      default:
        console.error(`Unknown command "${command}".\n\n${HELP}`);
        return 2;
    }
  } catch (error) {
    console.error(red(error instanceof Error ? error.message : String(error)));
    return 1;
  }
}

// `process.exit` rather than falling off the end: supabase-js and any open
// keep-alive socket would otherwise hold the process open for several seconds
// after the output is already printed.
process.exit(await main());
