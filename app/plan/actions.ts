"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { setBlockLocked } from "@/lib/db/plan";
import { regeneratePlan } from "@/lib/plan/generate";

export async function rebuildPlan() {
  const user = await requireUser();
  await regeneratePlan(user.id);
  revalidatePath("/");
}

export async function toggleLock(formData: FormData) {
  const user = await requireUser();
  const id = formData.get("id")?.toString();
  if (!id) return;

  await setBlockLocked(user.id, id, formData.get("locked") === "true");
  revalidatePath("/");
}
