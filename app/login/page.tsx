import { signInWithGoogle } from "@/app/auth/actions";
import { safeRedirectPath } from "@/lib/origin";

export const metadata = {
  title: "Sign in · LockIN",
};

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const error = searchParams.error?.toString();
  const next = safeRedirectPath(searchParams.next?.toString());

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <main className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">LockIN</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Plans your week around the time you actually have.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        ) : null}

        <form action={signInWithGoogle} className="mt-8">
          <input type="hidden" name="next" value={next} />
          <button
            type="submit"
            className="flex h-11 w-full items-center justify-center rounded-md border border-black/10 bg-white px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            Continue with Google
          </button>
        </form>
      </main>
    </div>
  );
}
