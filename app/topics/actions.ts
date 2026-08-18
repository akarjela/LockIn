"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { createTopic, deleteTopic, updateTopic } from "@/lib/db/topics";
import type { Confidence, Priority } from "@/lib/db/types";

function clampToRange<T extends number>(
  value: FormDataEntryValue | null,
  allowed: readonly T[],
  fallback: T,
): T {
  const parsed = Number(value);
  return (allowed as readonly number[]).includes(parsed) ? (parsed as T) : fallback;
}

export async function addTopic(formData: FormData) {
  const user = await requireUser();
  const name = formData.get("name")?.toString().trim();
  if (!name) return;

  const weekly = Number(formData.get("target_minutes_per_week"));

  await createTopic(user.id, {
    name,
    target_minutes_per_week:
      Number.isFinite(weekly) && weekly >= 15 ? weekly : 120,
    confidence: clampToRange<Confidence>(
      formData.get("confidence"),
      [1, 2, 3, 4, 5],
      3,
    ),
    priority: clampToRange<Priority>(formData.get("priority"), [1, 2, 3], 2),
  });

  revalidatePath("/topics");
  revalidatePath("/");
}

export async function toggleTopic(formData: FormData) {
  const user = await requireUser();
  const id = formData.get("id")?.toString();
  if (!id) return;

  await updateTopic(user.id, id, {
    active: formData.get("active") === "true",
  });
  revalidatePath("/topics");
  revalidatePath("/");
}

export async function removeTopic(formData: FormData) {
  const user = await requireUser();
  const id = formData.get("id")?.toString();
  if (!id) return;

  await deleteTopic(user.id, id);
  revalidatePath("/topics");
  revalidatePath("/");
}
