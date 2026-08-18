import { createClient } from "@/lib/supabase/server";
import type { Topic, TopicDraft } from "@/lib/db/types";

export async function listTopics(
  userId: string,
  { activeOnly = false }: { activeOnly?: boolean } = {},
): Promise<Topic[]> {
  const supabase = await createClient();

  let query = supabase.from("topics").select("*").eq("user_id", userId);
  if (activeOnly) query = query.eq("active", true);

  const { data, error } = await query
    .order("priority", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw new Error(`Could not load topics: ${error.message}`);
  return (data ?? []) as Topic[];
}

export async function createTopic(
  userId: string,
  draft: TopicDraft,
): Promise<Topic> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("topics")
    .insert({ ...draft, name: draft.name.trim(), user_id: userId })
    .select()
    .single();

  if (error) throw new Error(`Could not create topic: ${error.message}`);
  return data as Topic;
}

export async function updateTopic(
  userId: string,
  id: string,
  patch: Partial<TopicDraft & Pick<Topic, "active">>,
): Promise<Topic> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("topics")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw new Error(`Could not update topic: ${error.message}`);
  return data as Topic;
}

export async function deleteTopic(userId: string, id: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("topics")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new Error(`Could not delete topic: ${error.message}`);
}
