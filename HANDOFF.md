# LockIN — handoff

_Last updated: 2026-08-18. Written at the end of a session that took the project
from an auth-only scaffold to a working planner._

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

**Working and verified.**

| | |
| --- | --- |
| Repo | `akarjela/LockIn`, branch `main`, everything pushed |
| Working tree | Clean — nothing uncommitted |
| Tests | 33 passing (`npm test`) |
| Build / lint / typecheck | All clean |
| Database | Migrations 0001 and 0002 both applied to hosted Supabase |
| RLS | Verified: an anonymous request with the public anon key returns `[]` |
| Dev server | http://localhost:3000 |
| Production | https://lock-in-lake-sigma.vercel.app — sign-in and planning verified |

Routes: `/` (the week), `/work` (everything you want time for), `/availability`,
`/login`, `/auth/callback`.

**Verified by hand this session:** Google sign-in, the auth redirect chain, one
live Claude parse (against the pre-unification schema), and a full realistic-week
plan through the engine.

## Files that matter

Nothing is mid-edit. These are the files to read first, in dependency order.

**The engine** — pure, no I/O, the heart of the project.

- `lib/schedule/tz.ts` — the only place wall-clock and instants convert
- `lib/schedule/availability.ts` — weekly template → concrete free slots
- `lib/schedule/score.ts` — scoring and the two-tier ranking
- `lib/schedule/pack.ts` — greedy earliest-fit packer
- `lib/schedule/index.ts` — `generatePlan()`, the entry point

**The bridge** — moves data, makes no decisions.

- `lib/plan/generate.ts` — loads, runs the engine, persists

**Data**

- `lib/db/types.ts` — `Item`, the unified type
- `lib/db/items.ts` — queries
- `supabase/migrations/0001_core_schema.sql`, `0002_unify_items.sql`

**Claude**

- `lib/ai/capture.ts` — prose → drafts. Server-only; reads `ANTHROPIC_API_KEY`
- `app/capture/actions.ts` — parse (writes nothing) and commit (writes, rebuilds)
- `components/capture-box.tsx` — the review-before-save UI

**Tests** — `lib/schedule/scenario.test.ts` is the one to read. It plans a
realistic week end to end and asserts no calendar collisions, no overlaps, and
every deadline met. It has caught two real design flaws.

## What changed this session

Started from: Next.js scaffold plus Supabase Google auth. No data model, no
scheduling, four dead nav links.

1. **Schema** — six tables, all under RLS scoped to `auth.uid()` with `with check`
   as well as `using`, so the browser-side key cannot write rows it does not own.
2. **The engine** — timezone-correct availability expansion, scoring, packing.
3. **The app** — `/work`, `/availability`, and a week view with per-block pinning.
   Pinned blocks become obstacles the packer routes around rather than moves.
4. **Natural-language capture** — the "describe your week" box.
5. **Unification** — `tasks` and `topics` collapsed into one `items` table.

### Decisions worth not re-litigating

**Wall-clock vs instants never share a type.** Availability is wall-clock
("Tuesdays 18:00–21:00"); deadlines and blocks are instants. `tz.ts` is the only
converter. A test pins 18:00 either side of the March DST change, where the
instants are 23 hours apart rather than 24.

**Ranking is two-tier, not one score.** Finite and recurring scores are not
comparable and no weighting makes them so — recurring work starts each week at
full deficit (0.35 before anything else), while finite urgency only nears 1 at
the deadline. Obligations (a due date inside the window) claim time first,
earliest-deadline-first. Goals fill the rest, by score. This is orthogonal to
finite/recurring: a weekly item with an exam date inside the window is an
obligation.

**The packer is greedy on purpose.** Optimal packing is NP-hard and, worse,
unstable — a small edit would reshuffle the whole week. Greedy changes only where
the input changed.

**`deadline` and `latestFinish` are separate fields.** One drives urgency and
ordering; the other is the hard packing constraint. See failed attempt #2.

**One item type.** `estimated_minutes` XOR `target_minutes_per_week`, enforced by
a check constraint. `archived` doubles as "paused".

## Failed attempts

Kept because each one is a trap that looks correct.

**1. Scoring tasks and topics on one comparable number.** The code claimed they
were "comparable by construction". They were not. The scenario test produced a
week where a study goal ate Monday night and pushed a pset due Wednesday to 21:40
*on Wednesday* — Algorithms scored 0.813 against the pset's 0.489. Tuning weights
cannot fix it because the two are not on the same axis. Fixed by tiering on
obligation-vs-goal. **Do not collapse the tiers back into one score.**

**2. Treating a deadline as a hard packing constraint.** For a *past* deadline
that excludes all remaining time, so overdue work was silently dropped — the more
overdue something was, the more invisible it became. Fixed by splitting
`latestFinish` (null when overdue) from `deadline`.

**3. Detecting the unplaced reason only when a slot was skipped.** Limits usually
*truncate* a placement mid-slot rather than skip it, so everything reported
`no-free-time`. Flags now record truncation too.

**4. Migration 0001, first run.** Two failures: `create extension pgcrypto`
(unnecessary — `gen_random_uuid()` is core Postgres 13+ — and the SQL Editor role
often cannot create extensions), and three `create trigger` statements, which have
no `if not exists` in Postgres, so any retry after a partial run died there. Both
migrations are now fully idempotent.

**5. Instructing "paste `path/to/file.sql`".** Read literally, and Postgres got
the filename as the query. Migrations are now loaded to the clipboard with
`pbcopy` instead. Note copying anything else — an error message, say — silently
wipes it.

**6. A too-greedy refactor of `lib/db/types.ts`.** A replacement spanning from
`Task` to `remainingMinutes` also deleted `AvailabilityBlock`, `CalendarEvent`,
and `ScheduledBlock` in between. Caught by `tsc`. Anchor edits on both ends.

**7. Backgrounding the dev server with `&`.** It outlived its shell in a way that
left a second server on a second port and a confusing "port in use" error. Use
the harness's background mode.

## Next steps

**Unbuilt, from the original plan.**

- **Google Calendar sync.** The `calendar_events` table exists and the busy-time
  subtraction is written and tested — but nothing populates the table, so it is
  inert. Needs calendar OAuth scopes, provider-token storage, and a sync route.
- **The `lockin` CLI.** Would reuse `lib/schedule/` and `lib/plan/` unchanged,
  which is what the purity was for.

**Known rough edges.**

- `app/not-found.tsx` has a comment explaining it avoids `requireUser()` so a bad
  URL is not mistaken for an auth problem — but `proxy.ts` redirects unknown paths
  to `/login` first, so it never renders for signed-out visitors. Harmless; the
  comment is wrong.
- Local Node is 20.20.2; `@supabase/supabase-js` warns it wants 22+, and Vercel
  defaults to 22. Local and production runtimes differ.
- Deployed at https://lock-in-lake-sigma.vercel.app (root directory `./`, since
  this repo's root *is* the Next app). Supabase's Site URL and Additional
  Redirect URLs must list that domain with a `/**` wildcard, or sign-in falls
  back to Site URL and lands on `/?code=` instead of `/auth/callback`.
- Earliest-fit fragments some work — a 90-minute item can become 45+45 across two
  evenings even when a longer contiguous slot exists later. Deliberate (earlier =
  more slack before the deadline). A "prefer contiguous" pass is possible.
- The parent folder `/Users/apple/LockIN/` holds a stray `package-lock.json` and a
  screenshot that are outside the repo. The git root is `lockin/`.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 33 tests, no network or database needed
npm run build
```

`.env.local` needs both `NEXT_PUBLIC_SUPABASE_*` values and, for the capture box,
`ANTHROPIC_API_KEY`. Without the key the app works normally and only that box is
disabled, with a setup hint rather than a crash. The key is server-side only —
verified absent from the client bundle, along with the SDK and the system prompt.
