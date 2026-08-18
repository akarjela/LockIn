# LockIN

A weekly planner that scores everything you want time for, then packs it into
the time you actually have free.

It has two halves: a pure scheduling engine that makes every decision, and a
thin Next.js app that stores data and renders the result.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · Supabase (Postgres + Google
OAuth) · Vitest · Vercel

## Describing your week

With `ANTHROPIC_API_KEY` set, the box on `/work` turns prose into items:

> *6.006 pset due Thursday, probably 3 hours. I'm shaky on dynamic programming
> and want about 3h a week on it.*

Claude only extracts; it never schedules. The deterministic engine still decides
every block, which is what keeps plans reproducible and lets the whole scheduling
suite run with no network. Drafts are shown for confirmation before anything is
written, with an `assumed: ...` note wherever a field was inferred rather than
stated. Without the key the rest of the app is unaffected.

## Local setup

```bash
npm install
cp .env.local.example .env.local   # then fill in the two values
npm run dev
```

Both values come from your Supabase project under **Project Settings → API**.
They are `NEXT_PUBLIC_*` on purpose — the anon/publishable key only grants what
Row Level Security permits.

## Supabase auth setup

1. **Google Cloud Console** → create an OAuth 2.0 Client ID (Web application).
   Authorized redirect URI:
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
2. **Supabase** → Authentication → Providers → Google: enable it and paste the
   client ID and secret from step 1.
3. **Supabase** → Authentication → URL Configuration:
   - Site URL: your production URL (e.g. `https://lockin.vercel.app`)
   - Additional redirect URLs: `http://localhost:3000/**` for local dev, plus
     `https://*-<your-vercel-scope>.vercel.app/**` if you want preview
     deployments to sign in.

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import it at [vercel.com/new](https://vercel.com/new). Leave the root
   directory as `./` — this repo's root *is* the Next app.
3. Add both environment variables from `.env.local.example` to the Vercel
   project (Production, Preview, and Development).
4. Deploy, then add the resulting URL to the Supabase URL configuration above.

## Auth architecture

Three pieces, deliberately separated:

- **`proxy.ts`** (Next 16's rename of `middleware.ts`) refreshes the Supabase
  session on every request. Server Components cannot write cookies, so this is
  the only place a rotated token can be persisted. It also does an *optimistic*
  redirect for signed-out users.
- **`lib/auth.ts`** is the real security boundary: `requireUser()` calls
  `supabase.auth.getUser()`, which validates the JWT against the Auth server
  rather than trusting a cookie. It is `React.cache`d per request.
- **RLS in Postgres** is the last line — every table is scoped to `auth.uid()`,
  so a missed check in application code still cannot leak another user's rows.

## Scripts

| Command         | Does                                  |
| --------------- | ------------------------------------- |
| `npm run dev`   | Dev server on http://localhost:3000   |
| `npm run build` | Production build (what Vercel runs)   |
| `npm run lint`  | ESLint                                |
| `npm test`      | Vitest, once                          |
| `npm run test:watch` | Vitest in watch mode             |

## How scheduling works

Two inputs: **availability** (recurring free windows) and **work items**.

An item is anything you want time for. Two optional fields carry the whole
model:

| Field | Meaning |
| --- | --- |
| `due_at` | A deadline or exam date. Absent for open-ended work. |
| `estimated_minutes` *or* `target_minutes_per_week` | A fixed amount that burns down, or a weekly target that refills. Exactly one, enforced in the database. |

These used to be two tables, `tasks` and `topics`. That split forced a
categorisation decision that said nothing about the work — "is exam revision a
task or a topic?" is a question about the schema, not about your week.

```
weekly template  ->  expanded into real dates in your timezone
                 ->  minus calendar events and pinned blocks
                 ->  minus fragments too short to use        = free slots

work items       ->  scored and ranked                       = candidates

free slots + candidates  ->  greedy earliest-fit packer      = the week
```

### Wall-clock vs instants

Availability is wall-clock — "Tuesdays 18:00–21:00" means 18:00 local whatever
the UTC offset happens to be that week. Deadlines and scheduled blocks are
instants. These never share a type, and `lib/schedule/tz.ts` is the only place
they convert. A test pins 18:00 either side of the March DST change, where the
two instants are 23 hours apart rather than 24.

### Two tiers, not one score

Finite and recurring scores are not comparable, and no choice of weights makes
them so. Recurring work starts every week at full deficit — worth 0.35 before
anything else is considered — while finite urgency only approaches 1 as the
deadline arrives. Ranked on score alone, a routine weekly target reliably
outranks a paper due in two days.

So ranking happens in two tiers. **Obligations** are anything with a due date
inside the planning window; they claim time first, earliest-deadline-first (EDF
is optimal for meeting deadlines on a single resource — if any order fits
everything, EDF does). **Goals** are weekly targets and work due beyond the
window; they fill what is left, ordered by score.

Note this is orthogonal to finite/recurring: a weekly item with an exam date
inside the window is an obligation, which is exactly the case where study time
genuinely is a deadline.

### Why greedy

Optimal packing is NP-hard and, worse, unstable: a small edit could reshuffle the
whole week and destroy any sense of where things are. Greedy earliest-fit changes
only where the input changed, and every placement has a one-line explanation.

Work that will not fit is reported with the limit that blocked it — `daily-cap`,
`past-deadline`, `below-min-block`, `no-free-time` — rather than dropped.

### Purity

`lib/schedule/` performs no I/O and takes `now` as a parameter. Same input, same
plan, always. `lib/plan/generate.ts` is the only bridge to the database and makes
no decisions itself, which is what keeps the entire scheduling behaviour testable
without a database.
