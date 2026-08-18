import { createClient } from "@/lib/supabase/server";
import type { ScheduledBlock } from "@/lib/db/types";

export async function listBlocks(
  userId: string,
  from: Date,
  to: Date,
): Promise<ScheduledBlock[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("scheduled_blocks")
    .select("*")
    .eq("user_id", userId)
    .gt("ends_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at", { ascending: true });

  if (error) throw new Error(`Could not load plan: ${error.message}`);
  return (data ?? []) as ScheduledBlock[];
}

/**
 * Replaces the unlocked plan inside a window with a freshly packed one.
 *
 * Locked blocks survive by construction — the delete filters them out, and the
 * packer that produced `blocks` was given them as fixed obstacles. Delete runs
 * before insert so a regeneration cannot transiently double-book a slot.
 *
 * Not a transaction: PostgREST has no multi-statement transaction over the JS
 * client. The failure mode is a window that lost its old blocks and did not gain
 * new ones — recoverable by re-running, and strictly better than the reverse.
 */
export async function replacePlan(
  userId: string,
  from: Date,
  to: Date,
  blocks: Array<
    Pick<ScheduledBlock, "task_id" | "topic_id" | "starts_at" | "ends_at">
  >,
  planRunId: string,
): Promise<ScheduledBlock[]> {
  const supabase = await createClient();

  const { error: deleteError } = await supabase
    .from("scheduled_blocks")
    .delete()
    .eq("user_id", userId)
    .eq("locked", false)
    .gt("ends_at", from.toISOString())
    .lt("starts_at", to.toISOString());

  if (deleteError) {
    throw new Error(`Could not clear old plan: ${deleteError.message}`);
  }

  if (blocks.length === 0) return [];

  const { data, error } = await supabase
    .from("scheduled_blocks")
    .insert(
      blocks.map((block) => ({
        ...block,
        user_id: userId,
        plan_run_id: planRunId,
      })),
    )
    .select();

  if (error) throw new Error(`Could not save plan: ${error.message}`);
  return (data ?? []) as ScheduledBlock[];
}

/** Pins or unpins a block so regeneration schedules around it. */
export async function setBlockLocked(
  userId: string,
  id: string,
  locked: boolean,
): Promise<ScheduledBlock> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("scheduled_blocks")
    .update({ locked })
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw new Error(`Could not update block: ${error.message}`);
  return data as ScheduledBlock;
}
