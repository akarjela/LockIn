"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/db/settings";
import { createItem } from "@/lib/db/items";
import {
  CaptureUnavailableError,
  parseCapture,
  type CaptureResult,
  type ItemDraftPreview,
} from "@/lib/ai/capture";
import { regeneratePlan } from "@/lib/plan/generate";

export type ParseState =
  | { status: "idle" }
  | { status: "parsed"; result: CaptureResult }
  | { status: "error"; message: string };

/**
 * Reads the notes and returns drafts. Deliberately writes nothing.
 *
 * The confirm step exists because extraction is the one place a plausible
 * misreading is cheap to catch — "two hours" heard as "two days" is one edit
 * here and a ruined week if it goes straight in.
 */
export async function parseNotes(text: string): Promise<ParseState> {
  const user = await requireUser();
  const trimmed = text.trim();
  if (!trimmed) return { status: "idle" };

  const settings = await getSettings(user.id);

  try {
    const result = await parseCapture(trimmed, { timezone: settings.timezone });
    return { status: "parsed", result };
  } catch (error) {
    if (error instanceof CaptureUnavailableError) {
      return { status: "error", message: error.message };
    }
    // Anything else is a genuine failure — surface its own message rather than a
    // generic one, since the SDK's errors say something useful (rate limit, bad
    // key, network).
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Could not parse those notes.",
    };
  }
}

/** Writes confirmed drafts, then rebuilds the week around them. */
export async function commitDrafts(drafts: {
  items: ItemDraftPreview[];
}): Promise<{ created: number }> {
  const user = await requireUser();

  for (const item of drafts.items) {
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

  // Rebuilding here is the point of the feature: you type a sentence and get a
  // week back, rather than typing a sentence and then having to press Build.
  await regeneratePlan(user.id);

  revalidatePath("/");
  revalidatePath("/work");

  return { created: drafts.items.length };
}
