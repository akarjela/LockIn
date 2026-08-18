import { SiteHeader } from "@/components/site-header";
import { addTopic, removeTopic, toggleTopic } from "@/app/topics/actions";
import { requireUser } from "@/lib/auth";
import { listTopics } from "@/lib/db/topics";
import { formatDuration } from "@/lib/format";

export const metadata = { title: "Topics · LockIN" };

const CONFIDENCE_LABEL = {
  1: "Shaky",
  2: "Weak",
  3: "OK",
  4: "Good",
  5: "Solid",
} as const;

export default async function TopicsPage() {
  const user = await requireUser();
  const topics = await listTopics(user.id);

  const active = topics.filter((topic) => topic.active);
  const paused = topics.filter((topic) => !topic.active);

  return (
    <>
      <SiteHeader email={user.email ?? "Signed in"} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Topics</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Ongoing study that never finishes. These fill whatever time your
          deadlines leave behind — the shakier you rate one, the more it gets.
        </p>

        <form
          action={addTopic}
          className="mt-8 rounded-lg border border-black/10 p-4 dark:border-white/15"
        >
          <div className="flex flex-col gap-3">
            <input
              name="name"
              required
              maxLength={120}
              placeholder="Subject or skill"
              className="h-10 rounded-md border border-black/10 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-white/15"
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                Target per week (minutes)
                <input
                  type="number"
                  name="target_minutes_per_week"
                  defaultValue={120}
                  min={15}
                  step={15}
                  className="h-10 rounded-md border border-black/10 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-white/15"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                Confidence
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

            <button
              type="submit"
              className="ml-auto h-10 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Add topic
            </button>
          </div>
        </form>

        {[
          { heading: "Active", items: active, nextActive: false, verb: "Pause" },
          { heading: "Paused", items: paused, nextActive: true, verb: "Resume" },
        ].map(({ heading, items, nextActive, verb }) =>
          items.length === 0 && heading === "Paused" ? null : (
            <section key={heading} className="mt-10">
              <h2 className="text-sm font-medium text-zinc-500">
                {heading} · {items.length}
              </h2>

              {items.length === 0 ? (
                <p className="mt-4 rounded-lg border border-dashed border-black/15 px-6 py-10 text-center text-sm text-zinc-500 dark:border-white/20">
                  No topics yet. Add one above.
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-black/10 dark:divide-white/10">
                  {items.map((topic) => (
                    <li
                      key={topic.id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3"
                    >
                      <span
                        className={
                          topic.active
                            ? "flex-1 text-sm"
                            : "flex-1 text-sm text-zinc-400"
                        }
                      >
                        {topic.name}
                      </span>

                      <span className="text-xs text-zinc-500">
                        {formatDuration(topic.target_minutes_per_week)}/week
                      </span>
                      <span className="text-xs text-zinc-500">
                        {CONFIDENCE_LABEL[topic.confidence]}
                      </span>

                      <form action={toggleTopic}>
                        <input type="hidden" name="id" value={topic.id} />
                        <input
                          type="hidden"
                          name="active"
                          value={String(nextActive)}
                        />
                        <button
                          type="submit"
                          className="text-xs text-zinc-400 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
                        >
                          {verb}
                        </button>
                      </form>

                      <form action={removeTopic}>
                        <input type="hidden" name="id" value={topic.id} />
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
              )}
            </section>
          ),
        )}
      </main>
    </>
  );
}
