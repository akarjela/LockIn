import { createInterface } from "node:readline/promises";

import { optionalNumber, parseDue, type Flags } from "./args.mts";
import { requireUser } from "./session.mts";
import {
  bold,
  dim,
  green,
  renderItems,
  renderUnplaced,
  renderWeek,
  shortId,
  yellow,
} from "./render.mts";
import { listBusyEvents } from "@/lib/db/availability";
import { createItem, listItems, listOpenItems, updateItem } from "@/lib/db/items";
import { listBlocks } from "@/lib/db/plan";
import { getSettings } from "@/lib/db/settings";
import type { ItemDraft, Priority } from "@/lib/db/types";
import { formatDuration } from "@/lib/format";
import { planWindow, regeneratePlan } from "@/lib/plan/generate";

/**
 * The commands.
 *
 * Every one of these is a thin wrapper: load the user, call the same
 * `lib/plan/` and `lib/db/` functions the web app calls, print the result. There
 * is no scheduling logic here and there must never be, or the CLI and the
 * browser would start disagreeing about what your week is.
 *
 * That reuse is what `lib/schedule/`'s purity bought — the engine takes `now` as
 * a parameter and touches no I/O, so it runs identically in a request handler
 * and in a terminal.
 */

export async function week(): Promise<void> {
  const user = await requireUser();
  const settings = await getSettings(user.id);
  const horizon = planWindow(new Date(), settings.timezone);

  const [blocks, items] = await Promise.all([
    listBlocks(user.id, horizon.from, horizon.to),
    listItems(user.id),
  ]);

  console.log(renderWeek(blocks, items, settings.timezone, new Date()));
}

export async function plan(): Promise<void> {
  const user = await requireUser();

  const result = await regeneratePlan(user.id);
  const [settings, items] = await Promise.all([
    getSettings(user.id),
    listItems(user.id),
  ]);
  const blocks = await listBlocks(user.id, result.window.from, result.window.to);

  console.log(renderWeek(blocks, items, settings.timezone, new Date()));
  console.log(
    `\n${green(formatDuration(result.minutesPlaced))} scheduled · ${dim(
      `${formatDuration(result.minutesFree)} still free`,
    )}`,
  );

  const unplaced = renderUnplaced(result.unplaced);
  if (unplaced) console.log(`\n${unplaced}`);
}

export async function work(flags: Flags): Promise<void> {
  const user = await requireUser();
  const settings = await getSettings(user.id);

  const items = flags.options.has("all")
    ? await listItems(user.id)
    : await listOpenItems(user.id);

  console.log(renderItems(items, settings.timezone, new Date()));
}

export async function add(flags: Flags): Promise<void> {
  const title = flags.positional.join(" ").trim();
  if (!title) {
    throw new Error('Give the item a title: lockin add "finish the pset"');
  }

  const user = await requireUser();
  const settings = await getSettings(user.id);

  const weekly = optionalNumber(flags.options.get("weekly"));
  const due = flags.options.get("due");

  if (typeof due === "string" && !parseDue(due, settings.timezone)) {
    throw new Error(
      `Could not read "${due}" as a date. Use YYYY-MM-DD or YYYY-MM-DDTHH:MM.`,
    );
  }

  const draft: ItemDraft = {
    title,
    // Exactly one workload field, mirroring the database constraint: --weekly
    // makes it recurring, anything else is finite.
    ...(weekly !== undefined
      ? { target_minutes_per_week: weekly }
      : { estimated_minutes: optionalNumber(flags.options.get("minutes")) ?? 30 }),
    ...(typeof due === "string"
      ? { due_at: parseDue(due, settings.timezone)!.toISOString() }
      : {}),
    ...(optionalNumber(flags.options.get("priority"))
      ? { priority: optionalNumber(flags.options.get("priority")) as Priority }
      : {}),
  };

  const item = await createItem(user.id, draft);
  console.log(`${green("Added")} ${item.title} ${dim(shortId(item.id))}`);

  // Rebuilding straight away is the same bargain the capture box makes: you said
  // what you wanted, so you get a week back rather than a to-do list.
  await plan();
}

export async function done(flags: Flags): Promise<void> {
  const prefix = flags.positional[0];
  if (!prefix) throw new Error("Which one? lockin done <id>");

  const user = await requireUser();
  const items = await listOpenItems(user.id);

  const matches = items.filter((item) => item.id.startsWith(prefix));
  if (matches.length === 0) {
    throw new Error(`No open item starts with "${prefix}".`);
  }
  // Refusing an ambiguous prefix rather than picking one: marking the wrong
  // thing done is silent, and the fix is to type two more characters.
  if (matches.length > 1) {
    throw new Error(
      `"${prefix}" matches ${matches.length} items. Use more of the id:\n` +
        matches.map((item) => `  ${shortId(item.id)}  ${item.title}`).join("\n"),
    );
  }

  await updateItem(user.id, matches[0].id, { status: "done" });
  console.log(`${green("Done")} ${matches[0].title}`);
  await plan();
}

export async function sync(): Promise<void> {
  const user = await requireUser();
  // Imported here rather than at the top so `lockin week` does not need the
  // Google environment variables just to load this module.
  const { syncCalendar } = await import("@/lib/google/sync");

  const result = await syncCalendar(user.id);
  console.log(
    `${green("Synced")} ${result.busyEvents} busy of ${result.events} events ` +
      `across ${result.calendars} ${result.calendars === 1 ? "calendar" : "calendars"}.`,
  );
  await plan();
}

export async function calendar(): Promise<void> {
  const user = await requireUser();
  const settings = await getSettings(user.id);
  const horizon = planWindow(new Date(), settings.timezone);

  const events = await listBusyEvents(user.id, horizon.from, horizon.to);
  if (events.length === 0) {
    console.log(dim("No busy events cached for the next week."));
    return;
  }

  const { formatDeadline } = await import("@/lib/format");
  for (const event of events) {
    console.log(
      `${dim(formatDeadline(event.starts_at, settings.timezone).padEnd(20))} ${
        event.title ?? dim("(untitled)")
      }`,
    );
  }
}

/**
 * Prose in, items out — the same `lib/ai/capture.ts` the web app uses, including
 * the confirmation step. Claude never schedules; it only turns English into
 * drafts, and you approve them before anything is written.
 */
export async function capture(flags: Flags): Promise<void> {
  const text = flags.positional.join(" ").trim();
  if (!text) {
    throw new Error('Say something: lockin capture "pset due Thursday, ~3h"');
  }

  const user = await requireUser();
  const settings = await getSettings(user.id);

  const { parseCapture } = await import("@/lib/ai/capture");
  const result = await parseCapture(text, { timezone: settings.timezone });

  if (result.items.length === 0) {
    console.log(yellow("Nothing could be read out of that."));
    for (const line of result.unclear) console.log(`  ${dim(line)}`);
    return;
  }

  console.log(bold("Drafts:"));
  for (const item of result.items) {
    const workload =
      item.target_minutes_per_week !== null
        ? `${formatDuration(item.target_minutes_per_week)}/week`
        : formatDuration(item.estimated_minutes ?? 0);

    console.log(
      `  ${item.title.padEnd(34)} ${workload.padEnd(12)} ${dim(
        item.due_at
          ? new Date(item.due_at).toLocaleString("en-US", {
              timeZone: settings.timezone,
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })
          : "no deadline",
      )}`,
    );
    if (item.assumption) console.log(`    ${yellow(`assumed: ${item.assumption}`)}`);
  }

  for (const line of result.unclear) {
    console.log(`  ${yellow("unclear:")} ${dim(line)}`);
  }

  if (!flags.options.has("yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("\nSave these? [y/N] ");
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log(dim("Nothing saved."));
      return;
    }
  }

  for (const item of result.items) {
    await createItem(user.id, {
      title: item.title,
      due_at: item.due_at,
      estimated_minutes: item.estimated_minutes ?? undefined,
      target_minutes_per_week: item.target_minutes_per_week ?? undefined,
      confidence: item.confidence ?? undefined,
      priority: item.priority,
      splittable: item.splittable,
    });
  }

  console.log(`${green("Saved")} ${result.items.length} items.`);
  await plan();
}
