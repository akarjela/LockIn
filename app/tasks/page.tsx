import { SiteHeader } from "@/components/site-header";
import { addTask, completeTask, removeTask, reopenTask } from "@/app/tasks/actions";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/db/settings";
import { listTasks } from "@/lib/db/tasks";
import { remainingMinutes } from "@/lib/db/types";
import { formatDeadline, formatDuration, formatRelativeDay } from "@/lib/format";

export const metadata = { title: "Tasks · LockIN" };

const PRIORITY_LABEL = { 1: "High", 2: "Normal", 3: "Low" } as const;

export default async function TasksPage() {
  const user = await requireUser();
  const [settings, tasks] = await Promise.all([
    getSettings(user.id),
    listTasks(user.id),
  ]);
  const now = new Date();

  const open = tasks.filter((task) => task.status !== "done");
  const done = tasks.filter((task) => task.status === "done");

  return (
    <>
      <SiteHeader email={user.email ?? "Signed in"} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Work with an end state. The planner fits these around your deadlines
          first.
        </p>

        <form
          action={addTask}
          className="mt-8 rounded-lg border border-black/10 p-4 dark:border-white/15"
        >
          {/* The browser knows the user's zone; the server does not. */}
          <input type="hidden" name="timezone" value={settings.timezone} />

          <div className="flex flex-col gap-3">
            <input
              name="title"
              required
              maxLength={200}
              placeholder="What needs doing?"
              className="h-10 rounded-md border border-black/10 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-white/15"
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                Due
                <input
                  type="datetime-local"
                  name="due_at"
                  className="h-10 rounded-md border border-black/10 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-white/15"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                Estimate (minutes)
                <input
                  type="number"
                  name="estimated_minutes"
                  defaultValue={30}
                  min={5}
                  max={1440}
                  step={5}
                  className="h-10 rounded-md border border-black/10 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-white/15"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                Priority
                <select
                  name="priority"
                  defaultValue={2}
                  className="h-10 rounded-md border border-black/10 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-white/15"
                >
                  <option value={1}>High</option>
                  <option value={2}>Normal</option>
                  <option value={3}>Low</option>
                </select>
              </label>
            </div>

            <div className="flex items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-xs text-zinc-500">
                <input type="checkbox" name="splittable" defaultChecked />
                Can be split across sessions
              </label>

              <button
                type="submit"
                className="h-10 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Add task
              </button>
            </div>
          </div>
        </form>

        <section className="mt-10">
          <h2 className="text-sm font-medium text-zinc-500">
            Open · {open.length}
          </h2>

          {open.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-black/15 px-6 py-10 text-center text-sm text-zinc-500 dark:border-white/20">
              Nothing open. Add a task above.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-black/10 dark:divide-white/10">
              {open.map((task) => {
                const overdue =
                  task.due_at !== null && new Date(task.due_at) < now;
                return (
                  <li
                    key={task.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3"
                  >
                    <form action={completeTask}>
                      <input type="hidden" name="id" value={task.id} />
                      <button
                        type="submit"
                        aria-label={`Mark ${task.title} done`}
                        className="flex h-5 w-5 items-center justify-center rounded border border-black/25 text-transparent transition-colors hover:border-zinc-500 hover:text-zinc-400 dark:border-white/30"
                      >
                        ✓
                      </button>
                    </form>

                    <span className="flex-1 text-sm">{task.title}</span>

                    <span className="text-xs text-zinc-500">
                      {formatDuration(remainingMinutes(task))}
                    </span>

                    {task.priority !== 2 ? (
                      <span className="text-xs text-zinc-500">
                        {PRIORITY_LABEL[task.priority]}
                      </span>
                    ) : null}

                    <span
                      className={
                        overdue
                          ? "text-xs font-medium text-red-600 dark:text-red-400"
                          : "text-xs text-zinc-500"
                      }
                      title={
                        task.due_at
                          ? formatDeadline(task.due_at, settings.timezone)
                          : undefined
                      }
                    >
                      {formatRelativeDay(task.due_at, now)}
                    </span>

                    <form action={removeTask}>
                      <input type="hidden" name="id" value={task.id} />
                      <button
                        type="submit"
                        className="text-xs text-zinc-400 transition-colors hover:text-red-600"
                      >
                        Delete
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {done.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-sm font-medium text-zinc-500">
              Done · {done.length}
            </h2>
            <ul className="mt-4 divide-y divide-black/10 dark:divide-white/10">
              {done.map((task) => (
                <li key={task.id} className="flex items-center gap-4 py-2.5">
                  <span className="flex-1 text-sm text-zinc-400 line-through">
                    {task.title}
                  </span>
                  <form action={reopenTask}>
                    <input type="hidden" name="id" value={task.id} />
                    <button
                      type="submit"
                      className="text-xs text-zinc-400 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
                    >
                      Reopen
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}
