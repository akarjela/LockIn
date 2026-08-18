"use client";

import { useState, useTransition } from "react";

import { commitDrafts, parseNotes, type ParseState } from "@/app/capture/actions";
import type { TaskDraftPreview, TopicDraftPreview } from "@/lib/ai/capture";
import { formatDuration } from "@/lib/format";

const PLACEHOLDER = `Type your week the way you'd say it out loud, e.g.

6.006 pset due Thursday, probably 3 hours. Essay draft for Friday.
I'm shaky on dynamic programming and want ~3h a week on it.
Need to renew my passport at some point.`;

/**
 * Brain-dump box: parse, review, confirm.
 *
 * A client component because the review step needs local state — the drafts
 * exist only in the browser until confirmed, so a bad parse is discarded by
 * navigating away rather than by deleting rows.
 */
export function CaptureBox({ timezone }: { timezone: string }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<ParseState>({ status: "idle" });
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const key = (kind: string, index: number) => `${kind}-${index}`;

  function toggle(id: string) {
    setDropped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleParse() {
    startTransition(async () => {
      setState(await parseNotes(text));
      setDropped(new Set());
    });
  }

  function handleConfirm(tasks: TaskDraftPreview[], topics: TopicDraftPreview[]) {
    startTransition(async () => {
      await commitDrafts({
        tasks: tasks.filter((_, i) => !dropped.has(key("task", i))),
        topics: topics.filter((_, i) => !dropped.has(key("topic", i))),
      });
      setText("");
      setState({ status: "idle" });
      setDropped(new Set());
    });
  }

  const parsed = state.status === "parsed" ? state.result : null;
  const keptCount = parsed
    ? parsed.tasks.length +
      parsed.topics.length -
      dropped.size
    : 0;

  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <label htmlFor="capture" className="text-sm font-medium">
        Describe your week
      </label>
      <p className="mt-1 text-xs text-zinc-500">
        Claude turns this into tasks and topics. It never decides your schedule —
        the planner does that, the same way every time.
      </p>

      <textarea
        id="capture"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={6}
        placeholder={PLACEHOLDER}
        className="mt-3 w-full resize-y rounded-md border border-black/10 bg-transparent p-3 text-sm outline-none focus:border-zinc-400 dark:border-white/15"
      />

      <div className="mt-3 flex items-center justify-between gap-4">
        <span className="text-xs text-zinc-500">
          Times read in {timezone}
        </span>
        <button
          type="button"
          onClick={handleParse}
          disabled={pending || text.trim().length === 0}
          className="h-10 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {pending ? "Reading…" : "Read my notes"}
        </button>
      </div>

      {state.status === "error" ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {state.message}
        </p>
      ) : null}

      {parsed ? (
        <div className="mt-6 border-t border-black/10 pt-4 dark:border-white/10">
          <h3 className="text-sm font-medium">
            Found {parsed.tasks.length} task
            {parsed.tasks.length === 1 ? "" : "s"} and {parsed.topics.length}{" "}
            topic{parsed.topics.length === 1 ? "" : "s"}
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Untick anything wrong. Nothing is saved until you confirm.
          </p>

          <ul className="mt-3 space-y-2">
            {parsed.tasks.map((task, index) => {
              const id = key("task", index);
              return (
                <li key={id} className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={!dropped.has(id)}
                    onChange={() => toggle(id)}
                    className="mt-1"
                    aria-label={`Include ${task.title}`}
                  />
                  <span className="flex-1">
                    <span className="mr-2 text-zinc-400" aria-hidden>●</span>
                    {task.title}
                    <span className="ml-2 text-xs text-zinc-500">
                      {formatDuration(task.estimated_minutes)}
                      {task.due_at
                        ? ` · due ${new Date(task.due_at).toLocaleString("en-US", {
                            timeZone: timezone,
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}`
                        : " · no deadline"}
                      {task.splittable ? "" : " · one sitting"}
                    </span>
                    {task.assumption ? (
                      <span className="block text-xs italic text-amber-700 dark:text-amber-500">
                        assumed: {task.assumption}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}

            {parsed.topics.map((topic, index) => {
              const id = key("topic", index);
              return (
                <li key={id} className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={!dropped.has(id)}
                    onChange={() => toggle(id)}
                    className="mt-1"
                    aria-label={`Include ${topic.name}`}
                  />
                  <span className="flex-1">
                    <span className="mr-2 text-zinc-400" aria-hidden>○</span>
                    {topic.name}
                    <span className="ml-2 text-xs text-zinc-500">
                      {formatDuration(topic.target_minutes_per_week)}/week ·
                      confidence {topic.confidence}/5
                    </span>
                    {topic.assumption ? (
                      <span className="block text-xs italic text-amber-700 dark:text-amber-500">
                        assumed: {topic.assumption}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>

          {parsed.unclear.length > 0 ? (
            <div className="mt-4 rounded-md border border-black/10 px-3 py-2 dark:border-white/15">
              <p className="text-xs font-medium text-zinc-500">
                Not sure what to do with
              </p>
              <ul className="mt-1 space-y-0.5">
                {parsed.unclear.map((line) => (
                  <li key={line} className="text-xs text-zinc-500">
                    “{line}”
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => handleConfirm(parsed.tasks, parsed.topics)}
            disabled={pending || keptCount === 0}
            className="mt-4 h-10 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {pending
              ? "Saving…"
              : `Add ${keptCount} item${keptCount === 1 ? "" : "s"} and rebuild plan`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
