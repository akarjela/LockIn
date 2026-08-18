import { CaptureBox } from "@/components/capture-box";
import { SiteHeader } from "@/components/site-header";
import { addItem, removeItem, setItemStatus } from "@/app/work/actions";
import { requireUser } from "@/lib/auth";
import { listItems } from "@/lib/db/items";
import { getSettings } from "@/lib/db/settings";
import { isRecurring, remainingMinutes } from "@/lib/db/types";
import { formatDeadline, formatDuration, formatRelativeDay } from "@/lib/format";

export const metadata = { title: "Work · LockIN" };

const PRIORITY_LABEL = { 1: "High", 2: "Normal", 3: "Low" } as const;

export default async function WorkPage() {
  const user = await requireUser();
  const [settings, items] = await Promise.all([
    getSettings(user.id),
    listItems(user.id),
  ]);
  const now = new Date();

  const open = items.filter(
    (item) => item.status === "todo" || item.status === "doing",
  );
  const closed = items.filter(
    (item) => item.status === "done" || item.status === "archived",
  );

  return (
    <>
      <SiteHeader email={user.email ?? "Signed in"} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Work</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Everything you want time for. Give it a deadline if it has one, and a
          weekly target if it repeats — the planner does the rest.
        </p>

        <div className="mt-8">
          <CaptureBox timezone={settings.timezone} />
        </div>

        <details className="mt-6">
          <summary className="cursor-pointer text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            Or add one by hand
          </summary>

          <form
            action={addItem}
            className="mt-4 rounded-lg border border-black/10 p-4 dark:border-white/15"
          >
            {/* The browser knows the user's zone; the server does not. */}
            <input type="hidden" name="timezone" value={settings.timezone} />

            <input
              name="title"
              required
              maxLength={200}
              placeholder="What do you want time for?"
              className="h-10 w-full rounded-md border border-black/10 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-white/15"
            />

            <fieldset className="mt-3">
              <legend className="text-xs text-zinc-500">How much work</legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="flex items-start gap-2 rounded-md border border-black/10 p-3 text-sm has-[:checked]:border-zinc-900 dark:border-white/15 dark:has-[:checked]:border-zinc-50">
                  <input
                    type="radio"
                    name="repeats"
                    value="once"
                    defaultChecked
                    className="mt-1"
                  />
                  <span>
                    A fixed amount
                    <span className="block text-xs text-zinc-500">
                      Burns down as you do it
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2 rounded-md border border-black/10 p-3 text-sm has-[:checked]:border-zinc-900 dark:border-white/15 dark:has-[:checked]:border-zinc-50">
                  <input type="radio" name="repeats" value="weekly" className="mt-1" />
                  <span>
                    Every week
                    <span className="block text-xs text-zinc-500">
                      Refills each week
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                Total minutes (fixed amount)
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
                Minutes per week (every week)
                <input
                  type="number"
                  name="weekly_minutes"
                  defaultValue={120}
                  min={15}
                  step={15}
                  className="h-10 rounded-md border border-black/10 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-white/15"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                Due / target date (optional)
                <input
                  type="datetime-local"
                  name="due_at"
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

              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                Confidence (every week)
                <select
                  name="confidence"
                  defaultValue={3}
                  className="h-10 rounded-md border border-black/10 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-white/15"
                >
                  <option value={1}>1 — shaky</option>
                  <option value={2}>2 — weak</option>
                  <option value={3}>3 — OK</option>
                  <option value={4}>4 — good</option>
                  <option value={5}>5 — solid</option>
                </select>
              </label>

              <label className="flex items-center gap-2 self-end text-xs text-zinc-500">
                <input type="checkbox" name="splittable" defaultChecked />
                Can be split across sessions
              </label>
            </div>

            <button
              type="submit"
              className="mt-4 ml-auto flex h-10 items-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Add
            </button>
          </form>
        </details>

        <section className="mt-10">
          <h2 className="text-sm font-medium text-zinc-500">
            Open · {open.length}
          </h2>

          {open.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-black/15 px-6 py-10 text-center text-sm text-zinc-500 dark:border-white/20">
              Nothing here yet. Describe your week above.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-black/10 dark:divide-white/10">
              {open.map((item) => {
                const recurring = isRecurring(item);
                const overdue =
                  item.due_at !== null && new Date(item.due_at) < now;

                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3"
                  >
                    <form action={setItemStatus}>
                      <input type="hidden" name="id" value={item.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={recurring ? "archived" : "done"}
                      />
                      <button
                        type="submit"
                        aria-label={
                          recurring ? `Pause ${item.title}` : `Mark ${item.title} done`
                        }
                        title={recurring ? "Pause" : "Mark done"}
                        className="flex h-5 w-5 items-center justify-center rounded border border-black/25 text-transparent transition-colors hover:border-zinc-500 hover:text-zinc-400 dark:border-white/30"
                      >
                        ✓
                      </button>
                    </form>

                    <span className="flex-1 text-sm">
                      <span
                        aria-hidden
                        className="mr-2 text-zinc-400"
                        title={recurring ? "Every week" : "Fixed amount"}
                      >
                        {recurring ? "○" : "●"}
                      </span>
                      {item.title}
                    </span>

                    <span className="text-xs text-zinc-500">
                      {recurring
                        ? `${formatDuration(item.target_minutes_per_week!)}/week`
                        : formatDuration(remainingMinutes(item))}
                    </span>

                    {recurring && item.confidence !== null ? (
                      <span className="text-xs text-zinc-500">
                        confidence {item.confidence}/5
                      </span>
                    ) : null}

                    {item.priority !== 2 ? (
                      <span className="text-xs text-zinc-500">
                        {PRIORITY_LABEL[item.priority]}
                      </span>
                    ) : null}

                    <span
                      className={
                        overdue
                          ? "text-xs font-medium text-red-600 dark:text-red-400"
                          : "text-xs text-zinc-500"
                      }
                      title={
                        item.due_at
                          ? formatDeadline(item.due_at, settings.timezone)
                          : undefined
                      }
                    >
                      {formatRelativeDay(item.due_at, now)}
                    </span>

                    <form action={removeItem}>
                      <input type="hidden" name="id" value={item.id} />
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

        {closed.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-sm font-medium text-zinc-500">
              Done and paused · {closed.length}
            </h2>
            <ul className="mt-4 divide-y divide-black/10 dark:divide-white/10">
              {closed.map((item) => (
                <li key={item.id} className="flex items-center gap-4 py-2.5">
                  <span
                    className={
                      item.status === "done"
                        ? "flex-1 text-sm text-zinc-400 line-through"
                        : "flex-1 text-sm text-zinc-400"
                    }
                  >
                    {item.title}
                    {item.status === "archived" ? (
                      <span className="ml-2 text-xs">paused</span>
                    ) : null}
                  </span>
                  <form action={setItemStatus}>
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="status" value="todo" />
                    <button
                      type="submit"
                      className="text-xs text-zinc-400 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
                    >
                      {item.status === "done" ? "Reopen" : "Resume"}
                    </button>
                  </form>
                  <form action={removeItem}>
                    <input type="hidden" name="id" value={item.id} />
                    <button
                      type="submit"
                      className="text-xs text-zinc-400 transition-colors hover:text-red-600"
                    >
                      Delete
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
