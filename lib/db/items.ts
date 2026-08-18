import { createClient } from "@/lib/supabase/server";
import type { Item, ItemDraft, ItemStatus } from "@/lib/db/types";

/**
 * Everything the scheduler should consider: not finished, not paused.
 *
 * One query where there used to be two, which is the practical payoff of the
 * unification — the planner no longer has to fetch two shapes and reconcile them.
 */
export async function listOpenItems(userId: string): Promise<Item[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["todo", "doing"])
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: true });

  if (error) throw new Error(`Could not load items: ${error.message}`);
  return (data ?? []) as Item[];
}

export async function listItems(
  userId: string,
  statuses: ItemStatus[] = ["todo", "doing", "done", "archived"],
): Promise<Item[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("user_id", userId)
    .in("status", statuses)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Could not load items: ${error.message}`);
  return (data ?? []) as Item[];
}

export async function createItem(
  userId: string,
  draft: ItemDraft,
): Promise<Item> {
  const supabase = await createClient();

  // Exactly one workload field, or the database rejects the row. Defaulting here
  // rather than letting the constraint fire keeps the failure legible: an item
  // with neither field is almost always a caller that forgot, not a user intent.
  const workload =
    draft.target_minutes_per_week != null
      ? { target_minutes_per_week: draft.target_minutes_per_week, estimated_minutes: null }
      : { estimated_minutes: draft.estimated_minutes ?? 30, target_minutes_per_week: null };

  const { data, error } = await supabase
    .from("items")
    .insert({
      ...draft,
      ...workload,
      title: draft.title.trim(),
      user_id: userId,
    })
    .select()
    .single();

  if (error) throw new Error(`Could not create item: ${error.message}`);
  return data as Item;
}

export async function updateItem(
  userId: string,
  id: string,
  patch: Partial<ItemDraft & Pick<Item, "status" | "spent_minutes">>,
): Promise<Item> {
  const supabase = await createClient();

  // `completed_at` is derived, never caller-supplied: a check constraint requires
  // it to agree with `status`, so it is set in the one place status changes.
  const withCompletion =
    patch.status === undefined
      ? patch
      : {
          ...patch,
          completed_at:
            patch.status === "done" ? new Date().toISOString() : null,
        };

  const { data, error } = await supabase
    .from("items")
    .update(withCompletion)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw new Error(`Could not update item: ${error.message}`);
  return data as Item;
}

export async function deleteItem(userId: string, id: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("items")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new Error(`Could not delete item: ${error.message}`);
}
