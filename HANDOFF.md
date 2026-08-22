# LockIN — handoff

_Last updated: 2026-08-21. Google Calendar sync and the `lockin` CLI were built
on 2026-08-18; this session connected a real Google account, audited the whole
thing for data leakage, and fixed the one real bug that audit turned up._

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

**Everything works, locally, against a real Google account.** The remaining
items are deployment and one account-configuration problem that makes the app
look broken when it is not — read "The account is empty" below before concluding
anything is wrong.

| | |
| --- | --- |
| Repo | `akarjela/LockIn`, branch `feat/calendar-sync-and-cli`, pushed, **not merged** |
| Tests | 57 passing (`npm test`) |
| Build / lint / typecheck | All clean |
| Database | Migrations 0001, 0002 and 0003 all applied to hosted Supabase |
| Local env | All six variables present and parsed by `@next/env` |
| Google Calendar | Connected and synced. Grant has a refresh token; scope correct |
| Dev server | http://localhost:3000 |
| Production | https://lock-in-lake-sigma.vercel.app — **env vars not added yet** |

Routes: `/` (the week), `/work`, `/availability`, `/login`, `/auth/callback`,
`POST /api/calendar/sync`.

### The account is empty, and that is not a bug

Two settings make the app do nothing visible, and both look like defects:

- **Zero availability windows.** All open items come back `no-free-time`. The
  planner is behaving perfectly and has nowhere to put anything. Add a window on
  `/availability`.
- **`timezone` is still the `UTC` default** while the calendar is US Eastern. A
  window typed as 18:00–22:00 currently means 2pm–6pm locally. Fix the timezone
  *before* adding windows, or every block lands four hours off.

Also: the 5 synced events are all-day events that **Google itself marks free**,
from a subscribed calendar. Zero busy events is the correct answer for that data
— not the all-day rule being over-eager.

### What is left

1. **Set the timezone and add availability windows** (above). Nothing else about
   this project is observable until that is done.
2. **`http://127.0.0.1:8765`** must be in Supabase → Authentication → URL
   Configuration → Additional Redirect URLs, or `lockin login` comes back to the
   Site URL instead of the loopback. Still unverified — it cannot be checked
   without running the flow, and nobody has run `lockin login` yet.
3. **Vercel needs the three new variables** (`GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) and a redeploy. Do this
   *before* merging, or `main` ships calendar code onto a deployment that cannot
   use it. Until then production shows the setup hint and is otherwise unchanged.
4. **Merge the branch.**

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
- `lib/supabase/no-realtime.ts` — the Node 20 WebSocket stub, shared by the two
  clients that build themselves outside a Next.js runtime
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

## What was built (2026-08-18)

Started from: a working planner with two features listed as unbuilt.

1. **Google Calendar sync.** `calendar_events` had existed since 0001 and the
   busy-time subtraction was already written and tested — nothing filled the
   table. Now `/availability` connects an account read-only, `lib/google/sync.ts`
   caches events, and the engine subtracts them exactly as it always would have.
2. **The `lockin` CLI.** `login`, `week`, `plan`, `work`, `add`, `done`,
   `capture`, `sync`, `calendar`. Reuses `lib/plan/` and `lib/schedule/`
   unchanged, which is what the purity was for.

## What this session did (2026-08-21)

Connected a real account and tried hard to break it. Three commits, on the
branch, pushed:

| | |
| --- | --- |
| `e68fd3c` | Google Calendar sync and the CLI |
| `a46329c` | Handoff: 0003 applied, config verified |
| `7ccd49d` | **Fix:** admin client crashed outside Next.js on Node 20 |

### The bug that was found

`createAdminClient` built a Supabase client without the Realtime transport stub,
so its eager WebSocket lookup threw on Node 20. **Next.js polyfills a global
`WebSocket`, which is exactly why the browser connect flow worked and hid this**
— but `lockin sync` reaches the same client from a bare node process and died at
`getCredentials`, before doing anything at all.

The stub already existed in `cli/session.mts`. Having two copies is what let one
be forgotten, so it now lives in `lib/supabase/no-realtime.ts` and both import
it. See failed attempt #11.

The general lesson: **anything reached from both Next.js and a bare node process
must be exercised from both.** The Next runtime is more forgiving than plain
Node, so testing only through the browser proves less than it appears to.

### Leak audit — nothing escapes

A throwaway second user was created through the admin API, signed in, used to
attack this account's data, and deleted afterwards. Every attempt failed
correctly:

| As a *different* signed-in user (`authenticated`) | Result |
| --- | --- |
| read `google_credentials` | `403` — refused outright |
| read the victim's `calendar_events`, `items`, `scheduled_blocks`, `availability_blocks`, `user_settings` | `200`, **0 rows** — including when filtering explicitly by the victim's `user_id` |
| `INSERT` an item owned by the victim | `403` — `with check` did its job |

As `anon`: `401` on `google_credentials`, 0 rows everywhere else.

Also confirmed absent from `.next/static`, `.next/dev/static` and `.next/server`:
the service-role key, the Google client secret, the Anthropic key, and the
account's **live access and refresh tokens**. None appear in any commit;
`.env.local` is untracked; no tokens in the dev server logs; only the two
intended `NEXT_PUBLIC_` variables exist.

The design goal — a Google refresh token that not even its owner's browser can
read — is now demonstrated rather than assumed.

### Functional verification, against real data

- **Token refresh works.** The classic "dies an hour after connecting" failure is
  not present: the grant has a refresh token and Google accepts it.
- **Sync is idempotent.** Run twice: same event count, table row count matches
  exactly, no orphans, no duplicates. Upsert-then-prune behaves.
- **Busy subtraction, proven end to end** on a realistic weeknight template — a
  90-minute event removes exactly 90 minutes, splits that evening into two slots,
  and the packer routes around it rather than over it. Deadlines respected.
- **Rebuilding twice gives a byte-identical plan.** The stability the greedy
  packer exists for.
- The Google client id/secret are valid (`invalid_grant`, not `invalid_client`),
  and Supabase's Google provider uses the **same** client id as
  `GOOGLE_CLIENT_ID`. A mismatch there is the nastiest possible bug: sign-in
  keeps working while token refresh dies silently an hour after connecting.
- `POST /api/calendar/sync` with no session returns `401 {"error":"Not signed
  in."}` rather than an HTML login page — the `proxy.ts` change for API callers.

**Still unexercised:** `lockin login` and everything behind it. It needs a
browser and a Google consent screen, so no automated check reaches it.

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

Kept because each one is a trap that looks correct. #1–7 are from earlier
sessions, #8–10 from building the calendar and CLI, #11–12 from verifying them.
All still apply.

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
implementation and throws when it cannot find one — killing the process at
startup over a socket that is never opened. Fixed by passing a `transport` stub
rather than adding `ws` as a dependency. It lives in
`lib/supabase/no-realtime.ts`; delete both usages once this is on Node 22.

**10. `vitest.config.mts` has an explicit `include`.** New tests outside
`lib/**/*.test.ts` are silently not run — the suite goes green having skipped
them. `cli/**/*.test.mts` is now listed too. Check the file count, not just the
tick.

**11. Fixing #9 in only one of the two places that needed it.** The stub went
into `cli/session.mts` and not into `lib/supabase/admin.ts`, and the gap survived
a clean build, a clean lint, 57 passing tests and a successful browser connect —
because **Next.js polyfills `WebSocket` and plain Node 20 does not**. Only
running a sync outside Next exposed it. Two lessons: a workaround duplicated is a
workaround half-applied, and green-under-Next proves nothing about the CLI.

**12. A scripted edit anchored on only one end — again.** Removing the old stub
from `cli/session.mts` with a `start…end` slice also deleted `cliClient()`, which
happened to sit between the two anchors. This is failed attempt #6 recurring
almost exactly, with a different file. `tsc` caught it both times. **Anchor on
both ends, and re-read what a scripted edit actually removed.**

## Next steps

**Nothing is blocked on code.** Do the four items under "What is left" — set the
timezone, add availability windows, add the Vercel variables, merge. The first
two take a minute and are what turn this from a correct-but-invisible system into
a usable one.

**Worth building next, in rough order of value.**

- **Scheduled sync.** It is manual today: a button and a route. `POST
  /api/calendar/sync` authenticates from the session cookie, so a cron job would
  need a different credential — a per-user token, or a service-role job that
  loops over `google_credentials`. The latter is straightforward now that the
  table exists.
- **Surface busy events in the week view.** They already exist in
  `calendar_events` and are already subtracted; showing them would answer "why is
  Tuesday empty?" without a trip to Google Calendar.
- **A "prefer contiguous" packing pass.** See the rough edge below.

**Known rough edges.**

- The CLI stores a session at `~/.config/lockin/session.json`, mode 600. It is
  not encrypted, and anything running as you can read it.
- Google access tokens are stored in `google_credentials` in plaintext. The
  boundary that matters is who can reach the table, not the encoding — see the
  migration's header comment for why encrypting it would mostly move the problem.
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
