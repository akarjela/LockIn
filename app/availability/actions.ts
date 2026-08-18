"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { createAvailability, deleteAvailability } from "@/lib/db/availability";
import { updateSettings } from "@/lib/db/settings";
import type { Weekday } from "@/lib/db/types";

/** `18:30` -> 1110. Returns null for anything the form should have prevented. */
function toMinuteOfDay(value: string | undefined): number | null {
  const match = value?.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 1440 ? minutes : null;
}

export async function addAvailability(formData: FormData) {
  const user = await requireUser();

  const start = toMinuteOfDay(formData.get("start")?.toString());
  // Midnight as an end time means "end of day", which is 1440 rather than 0.
  const rawEnd = toMinuteOfDay(formData.get("end")?.toString());
  const end = rawEnd === 0 ? 1440 : rawEnd;

  if (start === null || end === null || end <= start) return;

  // A block may be applied to several days at once — most people's free evenings
  // repeat, and adding them one weekday at a time is tedious.
  const weekdays = formData
    .getAll("weekday")
    .map((value) => Number(value))
    .filter((day): day is Weekday => Number.isInteger(day) && day >= 0 && day <= 6);

  for (const weekday of weekdays) {
    await createAvailability(user.id, {
      weekday,
      start_minute: start,
      end_minute: end,
      label: formData.get("label")?.toString().trim() || null,
    });
  }

  revalidatePath("/availability");
  revalidatePath("/");
}

export async function removeAvailability(formData: FormData) {
  const user = await requireUser();
  const id = formData.get("id")?.toString();
  if (!id) return;

  await deleteAvailability(user.id, id);
  revalidatePath("/availability");
  revalidatePath("/");
}

export async function saveSettings(formData: FormData) {
  const user = await requireUser();

  const timezone = formData.get("timezone")?.toString();
  const dailyCap = Number(formData.get("daily_cap_minutes"));
  const breakMinutes = Number(formData.get("break_minutes"));

  // A bad IANA name would make every date conversion throw, so it is validated
  // here rather than trusted from the form.
  let validTimezone: string | undefined;
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      validTimezone = timezone;
    } catch {
      validTimezone = undefined;
    }
  }

  await updateSettings(user.id, {
    ...(validTimezone ? { timezone: validTimezone } : {}),
    ...(Number.isFinite(dailyCap) && dailyCap >= 30 && dailyCap <= 1440
      ? { daily_cap_minutes: dailyCap }
      : {}),
    ...(Number.isFinite(breakMinutes) && breakMinutes >= 0 && breakMinutes <= 60
      ? { break_minutes: breakMinutes }
      : {}),
  });

  revalidatePath("/availability");
  revalidatePath("/");
}
