import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Loads `.env.local` into `process.env`.
 *
 * Order is load-bearing, which is why this is its own module with no other
 * imports. `lib/env.ts` reads `NEXT_PUBLIC_SUPABASE_URL` **at module load** and
 * throws if it is missing — that is the right behaviour for a server that should
 * refuse to start misconfigured, but it means the CLI has to populate the
 * environment before anything else is imported. Hence the dynamic imports in
 * index.mts: a static import would be hoisted above this call.
 *
 * Next.js does this itself in `next dev`. Nothing does it for a plain node
 * process, and adding a dotenv dependency to read ten lines would be silly.
 *
 * Values already in the real environment win, so `SUPABASE_SERVICE_ROLE_KEY=x
 * lockin sync` behaves the way anyone would expect.
 */
export function loadEnvFile(dir = process.cwd()): void {
  let contents: string;
  try {
    contents = readFileSync(resolve(dir, ".env.local"), "utf8");
  } catch {
    // Absent is fine — the variables may come from the real environment.
    return;
  }

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    // Strip one layer of matching quotes, which is all any .env file means by them.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) process.env[key] = value;
  }
}
