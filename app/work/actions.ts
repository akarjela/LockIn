"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { createItem, deleteItem, updateItem } from "@/lib/db/items";
import type { Confidence, Priority } from "@/lib/db/types";
import { zonedTimeToInstant } from "@/lib/schedule/tz";

/**
 * Parses a `datetime-local` value into an instant.
 *
 * The browser sends wall-clock text with no zone ("2026-08-19T23:59"). Passing
 * that to `new Date()` would interpret it in the *server's* zone, which on Vercel
 * is UTC — silently shifting every deadline. It is resolved against the user's
 * zone instead, reusing the scheduler's own arithmetic.
 */
function parseLocalDateTime(value: string, timezone: string): string | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match.map(Number);
  return zonedTimeToInstant(
    { year, month, day },
    hour * 60 + minute,
    timezone,
  ).toISOString();
}

function clampToRange<T extends number>(
  value: FormDataEntryValue | null,
  allowed: readonly T[],
  fallback: T,
): T {
  const parsed = Number(value);
  return (allowed as readonly number[]).includes(parsed) ? (parsed as T) : fallback;
}

function readMinutes(
  value: FormDataEntryValue | null,
  min: number,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min ? Math.round(parsed) : fallback;
}

export async function addItem(formData: FormData) {
  const user = await requireUser();
  const title = formData.get("title")?.toString().trim();
  if (!title) return;

  const timezone = formData.get("timezone")?.toString() || "UTC";
  const dueRaw = formData.get("due_at")?.toString() ?? "";
  const due_at = dueRaw ? parseLocalDateTime(dueRaw, timezone) : null;

  // The one branch the form still needs: a fixed amount of work, or a weekly
  // target. Everything else is shared.
  const repeats = formData.get("repeats") === "weekly";

  await createItem(user.id, {
    title,
    due_at,
    priority: clampToRange<Priority>(formData.get("priority"), [1, 2, 3], 2),
    ...(repeats
      ? {
          target_minutes_per_week: readMinutes(
            formData.get("weekly_minutes"),
            15,
            120,
          ),
          confidence: clampToRange<Confidence>(
            formData.get("confidence"),
            [1, 2, 3, 4, 5],
            3,
          ),
        }
      : {
          estimated_minutes: readMinutes(formData.get("estimated_minutes"), 5, 30),
          splittable: formData.get("splittable") !== null,
        }),
  });

  revalidatePath("/work");
  revalidatePath("/");
}

export async function setItemStatus(formData: FormData) {
  const user = await requireUser();
  const id = formData.get("id")?.toString();
  const status = formData.get("status")?.toString();
  if (!id || !status) return;

  if (status !== "todo" && status !== "doing" && status !== "done" && status !== "archived") {
    return;
  }

  await updateItem(user.id, id, { status });
  revalidatePath("/work");
  revalidatePath("/");
}

export async function removeItem(formData: FormData) {
  const user = await requireUser();
  const id = formData.get("id")?.toString();
  if (!id) return;

  await deleteItem(user.id, id);
  revalidatePath("/work");
  revalidatePath("/");
}
