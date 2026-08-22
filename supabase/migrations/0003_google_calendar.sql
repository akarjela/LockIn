-- Google Calendar connection.
--
-- `calendar_events` already existed and was already subtracted from availability
-- by the engine — nothing ever filled it. This migration adds the missing half:
-- somewhere to keep the OAuth grant that lets a sync populate it.
--
-- The one interesting decision is access. Every other table in this schema is
-- readable by its owner through the browser's anon key, because RLS makes that
-- safe. A Google refresh token is different: it is a long-lived credential for a
-- *third-party* account, so an XSS on our origin should not be able to walk away
-- with it. RLS is therefore enabled with **no policies at all** — which denies
-- anon and authenticated everything — and the only role that can read the table
-- is `service_role`, which bypasses RLS and never leaves the server.
--
-- Tokens are stored in plaintext. Encrypting them (pgsodium/Vault) would only
-- move the problem while the decryption key sits in the same environment; the
-- boundary that actually matters is the one above.
--
-- Safe to re-run: every statement is guarded.

-- ---------------------------------------------------------------------------
-- google_credentials
-- ---------------------------------------------------------------------------

create table if not exists public.google_credentials (
  user_id        uuid primary key references auth.users(id) on delete cascade,

  -- The Google account that granted access. Not necessarily the address they
  -- sign in with, so it is shown in the UI rather than assumed.
  google_email   text,

  -- Short-lived (about an hour). Refreshed in place as it expires.
  access_token   text        not null,
  expires_at     timestamptz not null,

  -- Long-lived, and the thing worth protecting. Google only issues one on a
  -- consent-screen grant, so a re-connect that skips consent leaves this null —
  -- hence nullable, with the app refusing to overwrite a good one with null.
  refresh_token  text,

  -- Space-separated scopes Google actually granted, as reported by tokeninfo.
  -- The consent screen lets a user untick calendar access while still signing
  -- in, and this is the only way to notice before a sync fails with a 403.
  scope          text,

  -- Sync bookkeeping, shown on /availability so a stale calendar is visible
  -- rather than silently wrong.
  last_synced_at timestamptz,
  last_sync_error text,

  connected_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists google_credentials_touch on public.google_credentials;
create trigger google_credentials_touch
  before update on public.google_credentials
  for each row execute function public.touch_updated_at();

-- Deny-all: RLS on, zero policies. `service_role` bypasses RLS entirely, so the
-- server can still read and write; every client-side key gets nothing.
alter table public.google_credentials enable row level security;

-- Belt and braces — Supabase grants table privileges to these roles by default,
-- and RLS is what stops them. Revoking as well means a policy added here by
-- accident later still does not open the table up.
revoke all on public.google_credentials from anon, authenticated;

-- ---------------------------------------------------------------------------
-- calendar_events — one addition
-- ---------------------------------------------------------------------------

-- A sync stamps every row it writes with the same `synced_at`, then deletes
-- anything older in the window it just covered. That is how events deleted in
-- Google disappear here, without sending a list of every surviving id back to
-- PostgREST as a query string.
create index if not exists calendar_events_user_synced_idx
  on public.calendar_events (user_id, synced_at);
