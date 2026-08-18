/**
 * Environment variables, read through one place so a missing value fails with a
 * useful message instead of `undefined` surfacing deep inside the Supabase client.
 *
 * These two are `NEXT_PUBLIC_*` because the browser client needs them. That is
 * safe: the anon/publishable key only grants what Row Level Security allows.
 */

/** Values shipped in .env.local.example — present, but not yet filled in. */
const PLACEHOLDERS = new Set([
  "https://your-project-ref.supabase.co",
  "your-anon-or-publishable-key",
]);

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.local.example to .env.local and fill it in.`,
    );
  }
  if (PLACEHOLDERS.has(value)) {
    throw new Error(
      `${name} is still set to the placeholder from .env.local.example. Replace it with the real value from your Supabase dashboard (Project Settings -> API).`,
    );
  }
  return value;
}

/**
 * The Supabase dashboard shows the bare project ref (`abcdefgh`) alongside the
 * full Project URL, and it is easy to copy the wrong one. Catch that here rather
 * than letting it surface later as an opaque `fetch failed`.
 */
function asUrl(name: string, value: string): string {
  if (!/^https?:\/\//.test(value)) {
    throw new Error(
      `${name} must be a full URL, but is "${value}". If that is your project ref, use https://${value}.supabase.co instead.`,
    );
  }
  return value;
}

export const SUPABASE_URL = asUrl(
  "NEXT_PUBLIC_SUPABASE_URL",
  required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
);

export const SUPABASE_ANON_KEY = required(
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
