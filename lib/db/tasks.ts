import { createClient } from "@/lib/supabase/server";
import type { Task, TaskDraft, TaskStatus } from "@/lib/db/types";

/**
 * Tasks the scheduler should consider: not finished, not archived.
 *
 * Ordered by deadline with nulls last so that a caller which truncates the list
 * keeps the urgent end of it.
 */
export async function listOpenTasks(userId: string): Promise<Task[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["todo", "doing"])
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: true });

  if (error) throw new Error(`Could not load tasks: ${error.message}`);
  return (data ?? []) as Task[];
}

export async function listTasks(
  userId: string,
  statuses: TaskStatus[] = ["todo", "doing", "done"],
): Promise<Task[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", userId)
    .in("status", statuses)
    .order("due_at", { ascending: true, nullsFirst: false });

  if (error) throw new Error(`Could not load tasks: ${error.message}`);
  return (data ?? []) as Task[];
}

export async function createTask(
  userId: string,
  draft: TaskDraft,
): Promise<Task> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tasks")
    .insert({ ...draft, title: draft.title.trim(), user_id: userId })
    .select()
    .single();

  if (error) throw new Error(`Could not create task: ${error.message}`);
  return data as Task;
}

export async function updateTask(
  userId: string,
  id: string,
  patch: Partial<TaskDraft & Pick<Task, "status" | "spent_minutes">>,
): Promise<Task> {
  const supabase = await createClient();

  // `completed_at` is not caller-supplied: a DB check constraint requires it to
  // agree with `status`, so it is derived here in the one place status changes.
  const withCompletion =
    patch.status === undefined
      ? patch
      : {
          ...patch,
          completed_at:
            patch.status === "done" ? new Date().toISOString() : null,
        };

  const { data, error } = await supabase
    .from("tasks")
    .update(withCompletion)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw new Error(`Could not update task: ${error.message}`);
  return data as Task;
}

export async function deleteTask(userId: string, id: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new Error(`Could not delete task: ${error.message}`);
}
