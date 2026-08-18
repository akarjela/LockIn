import { SiteHeader } from "@/components/site-header";
import { rebuildPlan, toggleLock } from "@/app/plan/actions";
import { requireUser } from "@/lib/auth";
import { listAvailability } from "@/lib/db/availability";
import { listBlocks } from "@/lib/db/plan";
import { getSettings } from "@/lib/db/settings";
import { listOpenTasks } from "@/lib/db/tasks";
import { listTopics } from "@/lib/db/topics";
import { remainingMinutes } from "@/lib/db/types";
import {
  formatDayHeading,
  formatDuration,
  formatRelativeDay,
  formatTime,
} from "@/lib/format";
import { planWindow } from "@/lib/plan/generate";
import { toZonedDate, dateKey } from "@/lib/schedule/tz";

export default async function WeekPage() {
  const user = await requireUser();
  const now = new Date();

  const settings = await getSettings(user.id);
  const window = planWindow(now, settings.timezone);

  const [blocks, tasks, topics, template] = await Promise.all([
    listBlocks(user.id, window.from, window.to),
    listOpenTasks(user.id),
    listTopics(user.id, { activeOnly: true }),
    listAvailability(user.id),
  ]);

  const names = new Map<string, string>([
    ...tasks.map((task) => [task.id, task.title] as const),
    ...topics.map((topic) => [topic.id, topic.name] as const),
  ]);

  // Group into local days. Grouping on the rendered heading would merge two
  // different weeks that share a weekday name, so the key is the calendar date.
  const days = new Map<string, typeof blocks>();
  for (const block of blocks) {
    const key = dateKey(toZonedDate(new Date(block.starts_at), settings.timezone));
    days.set(key, [...(days.get(key) ?? []), block]);
  }

  const scheduledIds = new Set(
    blocks.flatMap((block) => [block.task_id, block.topic_id].filter(Boolean)),
  );
  // Derived from what was persisted rather than stored at generation time, so it
  // stays honest if a task is added after the last plan was built.
  const unscheduled = tasks.filter((task) => !scheduledIds.has(task.id));

  const totalMinutes = blocks.reduce(
    (sum, block) =>
      sum +
      (new Date(block.ends_at).getTime() - new Date(block.starts_at).getTime()) /
        60_000,
    0,
  );

  const setUpNeeded = template.length === 0;

  return (
    <>
      <SiteHeader email={user.email ?? "Signed in"} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">This week</h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {blocks.length === 0
                ? "Nothing scheduled yet."
                : `${formatDuration(totalMinutes)} across ${blocks.length} blocks.`}
            </p>
          </div>

          <form action={rebuildPlan}>
            <button
              type="submit"
              disabled={setUpNeeded}
              className="h-10 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {blocks.length === 0 ? "Build plan" : "Rebuild plan"}
            </button>
          </form>
        </div>

        {setUpNeeded ? (
          <p className="mt-8 rounded-lg border border-dashed border-black/15 px-6 py-10 text-center text-sm text-zinc-500 dark:border-white/20">
            The planner has no free time to work with yet. Set your weekly
            windows on{" "}
            <a href="/availability" className="underline underline-offset-4">
              Availability
            </a>{" "}
            first.
          </p>
        ) : days.size === 0 ? (
          <p className="mt-8 rounded-lg border border-dashed border-black/15 px-6 py-10 text-center text-sm text-zinc-500 dark:border-white/20">
            No blocks yet. Add tasks or topics, then build the plan.
          </p>
        ) : (
          <div className="mt-8 space-y-6">
            {[...days.entries()].map(([key, dayBlocks]) => (
              <section key={key}>
                <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  {formatDayHeading(dayBlocks[0].starts_at, settings.timezone)}
                </h2>

                <ul className="mt-2 divide-y divide-black/10 dark:divide-white/10">
                  {dayBlocks.map((block) => {
                    const subjectId = block.task_id ?? block.topic_id ?? "";
                    const minutes =
                      (new Date(block.ends_at).getTime() -
                        new Date(block.starts_at).getTime()) /
                      60_000;

                    return (
                      <li
                        key={block.id}
                        className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5"
                      >
                        <span className="font-mono text-sm tabular-nums text-zinc-500">
                          {formatTime(block.starts_at, settings.timezone)}
                        </span>

                        <span className="flex-1 text-sm">
                          <span
                            aria-hidden
                            className="mr-2 text-zinc-400"
                            title={block.task_id ? "Task" : "Topic"}
                          >
                            {block.task_id ? "●" : "○"}
                          </span>
                          {names.get(subjectId) ?? "Removed item"}
                        </span>

                        <span className="text-xs text-zinc-500">
                          {formatDuration(minutes)}
                        </span>

                        <form action={toggleLock}>
                          <input type="hidden" name="id" value={block.id} />
                          <input
                            type="hidden"
                            name="locked"
                            value={String(!block.locked)}
                          />
                          <button
                            type="submit"
                            title={
                              block.locked
                                ? "Pinned — rebuilding will not move this"
                                : "Pin so rebuilding keeps this in place"
                            }
                            className={
                              block.locked
                                ? "text-xs text-zinc-900 dark:text-zinc-100"
                                : "text-xs text-zinc-400 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
                            }
                          >
                            {block.locked ? "Pinned" : "Pin"}
                          </button>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        {unscheduled.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-sm font-medium text-zinc-500">
              Not scheduled · {unscheduled.length}
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              No room in this week&apos;s free time, or due beyond it.
            </p>
            <ul className="mt-3 divide-y divide-black/10 dark:divide-white/10">
              {unscheduled.map((task) => (
                <li key={task.id} className="flex items-center gap-4 py-2">
                  <span className="flex-1 text-sm">{task.title}</span>
                  <span className="text-xs text-zinc-500">
                    {formatDuration(remainingMinutes(task))}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {formatRelativeDay(task.due_at, now)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}
