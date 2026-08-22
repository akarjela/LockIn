# LockIN — handoff

_Last updated: 2026-08-18. Written at the end of a session that added Google
Calendar sync and the `lockin` CLI — the two things the previous handoff listed
as unbuilt._

## Goal

A personal planning agent. You describe your week in plain English; it turns that
into structured work and packs it into the time you actually have free.

The architectural commitment, which everything else follows from:

> **Claude extracts. A deterministic engine schedules.**

Claude reads prose into typed drafts and never decides when anything happens.
All scheduling is pure functions with `now` passed in as a parameter. That is why
the whole scheduling suite runs with no network and no database, why rebuilding
twice never reshuffles your week, and why a bad parse costs one edit rather than
a wrong week.

## Current state

**Code is complete and locally configured. The one thing not yet done is the
browser half** — nobody has clicked "Connect Google Calendar" or run
`lockin login`, so no real event has been synced.

| | |
| --- | --- |
| Repo | `akarjela/LockIn`, branch `feat/calendar-sync-and-cli`, **not pushed** |
| Tests | 57 passing (`npm test`) |
| Build / lint / typecheck | All clean |
| Database | Migrations 0001, 0002 and 0003 all applied to hosted Supabase |
| Local env | All six variables present and parsed by `@next/env` |
| Dev server | http://localhost:3000 |
| Production | https://lock-in-lake-sigma.vercel.app — **env vars not added yet** |

Routes: `/` (the week), `/work`, `/availability`, `/login`, `/auth/callback`,
`POST /api/calendar/sync`.

**Verified by hand this session**, all without a browser:

- `google_credentials` exists and its isolation works: `service_role` reads it
  (`200 []`), the anon key is refused outright (`401`, Postgres `42501`). That is
  the deny-all RLS plus the explicit `revoke`, both doing their job.
- The Google client id/secret are valid — a refresh with a deliberately bogus
  token returns `invalid_grant`, not `invalid_client`.
- Supabase's Google provider uses the **same** client id as `GOOGLE_CLIENT_ID`.
  A mismatch here is the nastiest possible bug: sign-in keeps working while token
  refresh dies silently an hour after connecting.
- The authorize URL carries `.../auth/calendar.readonly` alongside email/profile.
- `POST /api/calendar/sync` with no session returns `401 {"error":"Not signed
  in."}` rather than an HTML login page — the `proxy.ts` change for API callers.
- The CLI as far as an unauthenticated process reaches: `help`, a clean "not
  signed in" through the full import chain, and `login` producing a correct PKCE
  authorize URL aimed at the loopback port.

### What is left

1. **Connect a calendar** at `/availability`, then confirm a real meeting removes
   time from the week.
2. **`http://127.0.0.1:8765`** must be in Supabase → Authentication → URL
   Configuration → Additional Redirect URLs, or `lockin login` comes back to the
   Site URL instead of the loopback. Unverified — it cannot be checked without
   running the flow.
3. **Vercel needs the three new variables** (`GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) and a redeploy. Until
   then production shows the setup hint and behaves exactly as before.
4. **Push the branch** and merge.

## Files that matter

Nothing is mid-edit. These are the files to read first, in dependency order.

**The engine** — pure, no I/O, the heart of the project.

- `lib/schedule/tz.ts` — the only place wall-clock and instants convert
- `lib/schedule/availability.ts` — weekly template → concrete free slots
- `lib/schedule/score.ts` — scoring and the two-tier ranking
- `lib/schedule/pack.ts` — greedy earliest-fit packer
- `lib/schedule/index.ts` — `generatePlan()`, the entry point

**The bridges** — move data, make no decisions.

- `lib/plan/generate.ts` — loads, runs the engine, persists
- `lib/google/sync.ts` — pulls Google Calendar into `calendar_events`

**Data**

- `lib/db/types.ts` — `Item`, the unified type
- `lib/db/items.ts`, `lib/db/availability.ts`, `lib/db/plan.ts`
- `lib/supabase/current.ts` — which Supabase client `lib/db/*` uses (see below)
- `supabase/migrations/0001…0003`

**Claude**

- `lib/ai/capture.ts` — prose → drafts. Server-only; reads `ANTHROPIC_API_KEY`
- `app/capture/actions.ts` — parse (writes nothing) and commit (writes, rebuilds)
- `components/capture-box.tsx` — the review-before-save UI

**Google Calendar**

- `lib/google/calendar.ts` — `toCalendarEventRow` is the pure core; read it first
- `lib/google/oauth.ts` — token refresh and scope inspection
- `lib/google/connect.ts` — captures the grant at the OAuth callback
- `lib/db/google.ts` — credential storage, service-role only

**CLI**

- `cli/index.mts` — entrypoint; its import order is load-bearing
- `cli/session.mts` — loopback Google sign-in, session file
- `cli/args.mts` — the pure, tested half

**Tests** — `lib/schedule/scenario.test.ts` is still the one to read. It plans a
realistic week end to end and asserts no calendar collisions, no overlaps, and
every deadline met. It has caught two real design flaws.

## What changed this session

Started from: a working planner with two features listed as unbuilt.

1. **Google Calendar sync.** `calendar_events` had existed since 0001 and the
   busy-time subtraction was already written and tested — nothing filled the
   table. Now `/availability` connects an account read-only, `lib/google/sync.ts`
   caches events, and the engine subtracts them exactly as it always would have.
2. **The `lockin` CLI.** `login`, `week`, `plan`, `work`, `add`, `done`,
   `capture`, `sync`, `calendar`. Reuses `lib/plan/` and `lib/schedule/`
   unchanged, which is what the purity was for.

### Decisions worth not re-litigating

Everything from the previous handoff still holds — **two tiers not one score**,
**wall-clock vs instants never share a type**, **greedy on purpose**, **`deadline`
and `latestFinish` are separate**, **one item type**. Added this session:

**Connecting a calendar is separate from signing in.** Folding the calendar scope
into sign-in would make every new user hand over their whole calendar before
seeing what the app does, and most of LockIN works fine without it.

**Busy is not the same as "on the calendar."** All-day events, events marked
free, invitations you declined, and working-location markers are all stored and
none of them block. The all-day rule is the one that looks wrong and is not: the
error is asymmetric. A wrongly-busy all-day event silently deletes a whole day of
availability and the only symptom is that work stops fitting; a wrongly-free one
costs nothing, because a real all-day commitment is something you would also take
out of your availability template.

**The Google refresh token is the one thing its owner cannot read.** Every other
table is reachable by its owner through the browser's anon key, because RLS makes
that safe. `google_credentials` has RLS enabled with **no policies at all**, so
only the service-role key can touch it. A refresh token grants access to a
third-party account, and an XSS on this origin must not be able to walk off with
one.

**Sync upserts, then prunes — never deletes first.** Delete-then-insert leaves a
window with no busy times, and a plan regenerated inside it schedules straight
over your meetings. Every row a run writes carries the same `synced_at`, and the
prune deletes anything older *inside the synced window*. Keying on a list of
surviving ids instead would put a few hundred uuids in a query string.

**The CLI signs in with Google, not a password.** Any other route risks Supabase
minting a second identity, and the symptom is a CLI that works perfectly while
showing an empty week. Loopback + PKCE lands on the same user as the browser.

**`lib/supabase/current.ts` is module-level mutable state, deliberately.** The
alternative was threading a client argument through every query function and
every caller of one. The rule that makes it safe: only a CLI entrypoint calls
`setSupabaseFactory`, and only at startup. The web server never calls it, so
there is no request-scoped state to leak between users.

## Failed attempts

Kept because each one is a trap that looks correct. The first six are from
earlier sessions and still apply.

**1. Scoring tasks and topics on one comparable number.** The scenario test
produced a week where a study goal ate Monday night and pushed a pset due
Wednesday to 21:40 *on Wednesday*. Tuning weights cannot fix it because the two
are not on the same axis. **Do not collapse the tiers back into one score.**

**2. Treating a deadline as a hard packing constraint.** For a *past* deadline
that excludes all remaining time, so overdue work was silently dropped — the more
overdue something was, the more invisible it became. Fixed by splitting
`latestFinish` (null when overdue) from `deadline`.

**3. Detecting the unplaced reason only when a slot was skipped.** Limits usually
*truncate* a placement mid-slot rather than skip it, so everything reported
`no-free-time`.

**4. Migration 0001, first run.** `create extension pgcrypto` (unnecessary and
usually not permitted) and three `create trigger` statements, which have no
`if not exists` in Postgres, so any retry after a partial run died there. All
migrations are now fully idempotent.

**5. Instructing "paste `path/to/file.sql`".** Read literally, and Postgres got
the filename as the query. Migrations are loaded to the clipboard with `pbcopy`
instead. Note copying anything else — an error message, say — silently wipes it.

**6. A too-greedy refactor of `lib/db/types.ts`.** A replacement spanning from
`Task` to `remainingMinutes` also deleted three interfaces in between. Caught by
`tsc`. Anchor edits on both ends.

**7. Backgrounding the dev server with `&`.** It outlived its shell and left a
second server on a second port. Use the harness's background mode.

**8. Assuming `.env.local` is loaded for a plain node process.** It is not —
`next dev` does that, and nothing does it for the CLI. Worse, `lib/env.ts` reads
its variables *at module load* and throws, so a static import anywhere in
`cli/index.mts` gets hoisted above the loader and dies before it runs. Every
import in that file past the env load is dynamic on purpose. Do not "tidy" them.

**9. Node 20 has no global `WebSocket`, and `createClient` wants one.**
supabase-js builds a Realtime client eagerly, which resolves a WebSocket
implementation and throws when it cannot find one — killing every CLI command at
startup over a socket that is never opened. Fixed by passing a `transport` stub
rather than adding `ws` as a dependency. `cli/session.mts` says where to delete it
once the project is on Node 22.

**10. `vitest.config.mts` has an explicit `include`.** New tests outside
`lib/**/*.test.ts` are silently not run — the suite goes green having skipped
them. `cli/**/*.test.mts` is now listed too. Check the file count, not just the
tick.

## Next steps

**Setup, not code.** The three steps under "Before calendar sync works", then
connect an account on `/availability` and confirm a meeting actually removes time
from the week.

**Known rough edges.**

- Calendar sync is manual — a button and a route, no cron. `POST
  /api/calendar/sync` is session-authenticated, so a scheduled job would need a
  different credential.
- The CLI stores a session at `~/.config/lockin/session.json`, mode 600. It is
  not encrypted, and anything running as you can read it.
- `lockin sync` needs the same three Google variables in the shell's environment
  or in `.env.local` — the service-role key included, since it reads credentials.
- `app/not-found.tsx` has a comment explaining it avoids `requireUser()` so a bad
  URL is not mistaken for an auth problem — but `proxy.ts` redirects unknown
  paths to `/login` first, so it never renders for signed-out visitors. Harmless;
  the comment is wrong.
- Local Node is 20.20.2; `@supabase/supabase-js` warns it wants 22+, and Vercel
  defaults to 22. See failed attempt #9.
- Supabase's Site URL and Additional Redirect URLs must list the production
  domain with a `/**` wildcard, or sign-in lands on `/?code=` instead of
  `/auth/callback`.
- Earliest-fit fragments some work — a 90-minute item can become 45+45 across two
  evenings even when a longer contiguous slot exists later. Deliberate (earlier =
  more slack before the deadline). A "prefer contiguous" pass is possible.
- The parent folder `/Users/apple/LockIN/` holds a stray `package-lock.json` and a
  screenshot that are outside the repo. The git root is `lockin/`.

## Running it

```bash
npm install
npm run dev              # http://localhost:3000
npm test                 # 57 tests, no network or database needed
npm run build
npm run lockin -- help   # the CLI
```

`.env.local` needs both `NEXT_PUBLIC_SUPABASE_*` values. `ANTHROPIC_API_KEY`
enables the capture box; `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
`SUPABASE_SERVICE_ROLE_KEY` together enable calendar sync. Each optional group is
absent-tolerant: the feature disables itself with a setup hint rather than
crashing, and no key ever reaches the client bundle.
