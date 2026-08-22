import { zonedTimeToInstant } from "@/lib/schedule/tz";

/**
 * Argument parsing, kept apart from the commands that use it.
 *
 * Same reason `lib/schedule/` is kept apart from `lib/plan/`: this module has no
 * I/O and no environment, so it can be tested directly. `cli/commands.mts`
 * reaches the database, which reaches `lib/env.ts`, which throws at import time
 * without configuration — a test importing that would be testing the wrong thing.
 */

export interface Flags {
  positional: string[];
  options: Map<string, string | true>;
}

/** `--due 2026-08-20 --weekly` -> options {due: "2026-08-20", weekly: true}. */
export function parseArgs(argv: string[]): Flags {
  const positional: string[] = [];
  const options = new Map<string, string | true>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    // Split on the first `=` only: `--label=a=b` is one value, not a parse error.
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    const name = eq >= 0 ? body.slice(0, eq) : body;
    const inline = eq >= 0 ? body.slice(eq + 1) : undefined;

    if (inline !== undefined) {
      options.set(name, inline);
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      // `--minutes 90`. A flag followed by another flag is a boolean.
      options.set(name, argv[++i]);
    } else {
      options.set(name, true);
    }
  }

  return { positional, options };
}

/** A numeric option, or undefined if it was absent or not a number. */
export function optionalNumber(
  value: string | true | undefined,
): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * `2026-08-20` or `2026-08-20T17:00` in the user's zone -> an instant.
 *
 * Deliberately not `new Date(value)`, which reads a bare date as UTC midnight —
 * "due Thursday" would land on Wednesday evening for anyone in the Americas.
 * This resolves through the same converter the scheduler uses, so a deadline
 * typed at a terminal and one typed in the browser mean the same moment.
 */
export function parseDue(value: string, timezone: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  // A date with no time means the end of that day: "due Thursday" is not "due
  // Thursday at midnight", which would be Wednesday night.
  const minutes =
    hour !== undefined ? Number(hour) * 60 + Number(minute) : 23 * 60 + 59;

  return zonedTimeToInstant(
    { year: Number(year), month: Number(month), day: Number(day) },
    minutes,
    timezone,
  );
}
