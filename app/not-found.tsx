import Link from "next/link";

/**
 * Catches any unmatched route. Kept deliberately free of data access — it
 * renders for signed-out visitors too, so calling `requireUser()` here would
 * bounce them to /login and hide the fact that the URL was simply wrong.
 */
export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <main className="w-full max-w-sm text-center">
        <p className="text-sm font-medium text-zinc-500">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          This page doesn&apos;t exist yet
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Tasks, topics and availability are still being built.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-md border border-black/10 px-4 text-sm font-medium transition-colors hover:bg-zinc-50 dark:border-white/15 dark:hover:bg-zinc-800"
        >
          Back to this week
        </Link>
      </main>
    </div>
  );
}
