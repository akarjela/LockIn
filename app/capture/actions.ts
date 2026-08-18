"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/db/settings";
import { createTask } from "@/lib/db/tasks";
import { createTopic } from "@/lib/db/topics";
import {
  CaptureUnavailableError,
  parseCapture,
  type CaptureResult,
  type TaskDraftPreview,
  type TopicDraftPreview,
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
  tasks: TaskDraftPreview[];
  topics: TopicDraftPreview[];
}): Promise<{ created: number }> {
  const user = await requireUser();

  for (const task of drafts.tasks) {
    await createTask(user.id, {
      title: task.title,
      due_at: task.due_at,
      estimated_minutes: task.estimated_minutes,
      priority: task.priority,
      splittable: task.splittable,
    });
  }

  for (const topic of drafts.topics) {
    await createTopic(user.id, {
      name: topic.name,
      target_at: topic.target_at,
      target_minutes_per_week: topic.target_minutes_per_week,
      confidence: topic.confidence,
      priority: topic.priority,
    });
  }

  // Rebuilding here is the point of the feature: you type a sentence and get a
  // week back, rather than typing a sentence and then having to press Build.
  await regeneratePlan(user.id);

  revalidatePath("/");
  revalidatePath("/tasks");
  revalidatePath("/topics");

  return { created: drafts.tasks.length + drafts.topics.length };
}
