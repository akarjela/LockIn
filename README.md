# LockIN

A weekly planner that scores your tasks and study topics, then packs them into
the time you actually have free.

> Full write-up (scheduling approach, scaling notes) comes in a later step. This
> README currently covers setup and deployment.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · Supabase (Postgres + Google
OAuth) · Vitest · Vercel

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
2. Import it at [vercel.com/new](https://vercel.com/new). **Set the root
   directory to `lockin/`** — the Next app is a subfolder of the repo.
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
