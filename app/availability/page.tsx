import { SiteHeader } from "@/components/site-header";
import {
  addAvailability,
  removeAvailability,
  saveSettings,
} from "@/app/availability/actions";
import { requireUser } from "@/lib/auth";
import { listAvailability } from "@/lib/db/availability";
import { getSettings } from "@/lib/db/settings";
import {
  WEEKDAY_NAMES,
  formatDuration,
  formatMinuteOfDay,
} from "@/lib/format";

export const metadata = { title: "Availability · LockIN" };

/** Monday-first for display; the stored `weekday` stays 0 = Sunday. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export default async function AvailabilityPage() {
  const user = await requireUser();
  const [settings, blocks] = await Promise.all([
    getSettings(user.id),
    listAvailability(user.id),
  ]);

  const weeklyMinutes = blocks.reduce(
    (sum, block) => sum + (block.end_minute - block.start_minute),
    0,
  );

  return (
    <>
      <SiteHeader email={user.email ?? "Signed in"} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Availability</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Your recurring free time. The planner only ever schedules inside these
          windows — {formatDuration(weeklyMinutes)} a week right now.
        </p>

        <form
          action={addAvailability}
          className="mt-8 rounded-lg border border-black/10 p-4 dark:border-white/15"
        >
          <fieldset>
            <legend className="text-xs text-zinc-500">Days</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {DISPLAY_ORDER.map((day) => (
                <label
                  key={day}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-black/10 px-3 py-1.5 text-sm has-[:checked]:border-zinc-900 has-[:checked]:bg-zinc-900 has-[:checked]:text-white dark:border-white/15 dark:has-[:checked]:border-zinc-50 dark:has-[:checked]:bg-zinc-50 dark:has-[:checked]:text-zinc-900"
                >
                  <input
                    type="checkbox"
                    name="weekday"
                    value={day}
                    className="sr-only"
                  />
                  {WEEKDAY_NAMES[day].slice(0, 3)}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              From
              <input
                type="time"
                name="start"
                required
                defaultValue="18:00"
                step={900}
                className="h-10 rounded-md border border-black/10 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-white/15"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Until
              <input
                type="time"
                name="end"
                required
                defaultValue="22:00"
                step={900}
                className="h-10 rounded-md border border-black/10 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-white/15"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Label (optional)
              <input
                name="label"
                maxLength={60}
                placeholder="Weeknights"
                className="h-10 rounded-md border border-black/10 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-white/15"
              />
            </label>
          </div>

          <button
            type="submit"
            className="mt-4 ml-auto flex h-10 items-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Add window
          </button>
        </form>

        <section className="mt-10">
          <h2 className="text-sm font-medium text-zinc-500">Weekly template</h2>

          {blocks.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-black/15 px-6 py-10 text-center text-sm text-zinc-500 dark:border-white/20">
              No free time defined yet — so the planner has nowhere to put
              anything. Add at least one window above.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {DISPLAY_ORDER.map((day) => {
                const dayBlocks = blocks.filter(
                  (block) => block.weekday === day,
                );
                if (dayBlocks.length === 0) return null;

                return (
                  <div key={day}>
                    <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                      {WEEKDAY_NAMES[day]}
                    </h3>
                    <ul className="mt-1 divide-y divide-black/10 dark:divide-white/10">
                      {dayBlocks.map((block) => (
                        <li
                          key={block.id}
                          className="flex items-center gap-4 py-2"
                        >
                          <span className="font-mono text-sm">
                            {formatMinuteOfDay(block.start_minute)} –{" "}
                            {formatMinuteOfDay(block.end_minute)}
                          </span>
                          <span className="flex-1 text-xs text-zinc-500">
                            {block.label ??
                              formatDuration(
                                block.end_minute - block.start_minute,
                              )}
                          </span>
                          <form action={removeAvailability}>
                            <input type="hidden" name="id" value={block.id} />
                            <button
                              type="submit"
                              className="text-xs text-zinc-400 transition-colors hover:text-red-600"
                            >
                              Remove
                            </button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-medium text-zinc-500">Planner settings</h2>

          <form
            action={saveSettings}
            className="mt-4 grid gap-3 rounded-lg border border-black/10 p-4 sm:grid-cols-3 dark:border-white/15"
          >
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Timezone
              <input
                name="timezone"
                defaultValue={settings.timezone}
                placeholder="America/New_York"
                className="h-10 rounded-md border border-black/10 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-white/15"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Max per day (minutes)
              <input
                type="number"
                name="daily_cap_minutes"
                defaultValue={settings.daily_cap_minutes}
                min={30}
                max={1440}
                step={15}
                className="h-10 rounded-md border border-black/10 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-white/15"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Break between blocks
              <input
                type="number"
                name="break_minutes"
                defaultValue={settings.break_minutes}
                min={0}
                max={60}
                step={5}
                className="h-10 rounded-md border border-black/10 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-white/15"
              />
            </label>

            <button
              type="submit"
              className="h-10 rounded-md border border-black/10 px-4 text-sm font-medium transition-colors hover:bg-zinc-50 sm:col-start-3 dark:border-white/15 dark:hover:bg-zinc-800"
            >
              Save settings
            </button>
          </form>

          <p className="mt-2 text-xs text-zinc-500">
            Timezone must be an IANA name such as{" "}
            <code className="font-mono">America/New_York</code>. Everything else
            is stored as an instant, so changing this moves your windows, not
            your deadlines.
          </p>
        </section>
      </main>
    </>
  );
}
