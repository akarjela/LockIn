"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { createTask, deleteTask, updateTask } from "@/lib/db/tasks";
import type { Priority } from "@/lib/db/types";
import { zonedTimeToInstant } from "@/lib/schedule/tz";

/**
 * Parses a `datetime-local` value into an instant.
 *
 * The browser sends wall-clock text with no zone ("2026-08-19T23:59"). Passing
 * that straight to `new Date()` would interpret it in the *server's* zone, which
 * on Vercel is UTC — silently shifting every deadline. The offset is resolved
 * against the user's zone instead.
 */
function parseLocalDateTime(value: string, timezone: string): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match.map(Number) as unknown as [
    string, number, number, number, number, number,
  ];
  // Reuses the scheduler's zone arithmetic rather than duplicating it here.
  return zonedTimeToInstant(
    { year, month, day },
    hour * 60 + minute,
    timezone,
  ).toISOString();
}

function readPriority(value: FormDataEntryValue | null): Priority {
  const parsed = Number(value);
  return parsed === 1 || parsed === 3 ? parsed : 2;
}

export async function addTask(formData: FormData) {
  const user = await requireUser();
  const title = formData.get("title")?.toString().trim();
  if (!title) return;

  const timezone = formData.get("timezone")?.toString() || "UTC";
  const estimate = Number(formData.get("estimated_minutes"));

  await createTask(user.id, {
    title,
    due_at: parseLocalDateTime(formData.get("due_at")?.toString() ?? "", timezone),
    estimated_minutes: Number.isFinite(estimate) && estimate >= 5 ? estimate : 30,
    priority: readPriority(formData.get("priority")),
    splittable: formData.get("splittable") !== null,
  });

  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function completeTask(formData: FormData) {
  const user = await requireUser();
  const id = formData.get("id")?.toString();
  if (!id) return;

  await updateTask(user.id, id, { status: "done" });
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function reopenTask(formData: FormData) {
  const user = await requireUser();
  const id = formData.get("id")?.toString();
  if (!id) return;

  await updateTask(user.id, id, { status: "todo" });
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function removeTask(formData: FormData) {
  const user = await requireUser();
  const id = formData.get("id")?.toString();
  if (!id) return;

  await deleteTask(user.id, id);
  revalidatePath("/tasks");
  revalidatePath("/");
}
