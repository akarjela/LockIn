import Link from "next/link";

import { signOut } from "@/app/auth/actions";

const NAV = [
  { href: "/", label: "Week" },
  { href: "/work", label: "Work" },
  { href: "/availability", label: "Availability" },
] as const;

/**
 * Shared header for the signed-in app. `email` is passed in rather than read
 * here so this stays a plain presentational component with no data access.
 */
export function SiteHeader({ email }: { email: string }) {
  return (
    <header className="border-b border-black/10 dark:border-white/15">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4">
        <span className="font-semibold tracking-tight">LockIN</span>

        <nav className="flex items-center gap-4 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-zinc-600 transition-colors hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-zinc-500 dark:text-zinc-500">{email}</span>
          <form action={signOut}>
            <button
              type="submit"
              className="text-zinc-600 underline-offset-4 transition-colors hover:text-zinc-950 hover:underline dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
