-- LockIN core schema.
--
-- Conventions used throughout:
--   * Every user-owned table carries `user_id` and is protected by RLS scoped to
--     `auth.uid()`. This is the last line of defence described in the README —
--     a missed check in application code still cannot leak another user's rows.
--   * Durations are stored as integer minutes, not intervals. The scheduler does
--     arithmetic on them constantly and minutes keep that code boring.
--   * Wall-clock times (availability) are stored as minutes-from-midnight in the
--     user's timezone. Instants (deadlines, scheduled blocks) are timestamptz.
--     Mixing those two up is the classic planner bug, so they never share a type.

-- No extension needed: gen_random_uuid() has been core Postgres since 13, and
-- Supabase's SQL editor role cannot always create extensions anyway.

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- user_settings
-- ---------------------------------------------------------------------------

-- One row per user. Created lazily on first sign-in rather than by trigger, so
-- that auth stays decoupled from app tables.
create table if not exists public.user_settings (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  -- IANA name, e.g. "America/New_York". Every wall-clock <-> instant conversion
  -- in the scheduler resolves through this, so it is not nullable.
  timezone          text        not null default 'UTC',
  -- Default granularity the packer snaps blocks to.
  slot_minutes      smallint    not null default 15 check (slot_minutes in (5, 10, 15, 30)),
  -- Gap left between two consecutive scheduled blocks.
  break_minutes     smallint    not null default 10 check (break_minutes between 0 and 60),
  -- Hard ceiling on scheduled work per day, regardless of how free the day is.
  daily_cap_minutes int         not null default 480 check (daily_cap_minutes between 30 and 1440),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch
  before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- tasks — discrete work with an end state
-- ---------------------------------------------------------------------------

create table if not exists public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users(id) on delete cascade,
  title              text        not null check (char_length(trim(title)) between 1 and 200),
  notes              text        check (char_length(notes) <= 10000),
  due_at             timestamptz,
  estimated_minutes  int         not null default 30
                       check (estimated_minutes between 5 and 1440),
  -- How much is already done. The packer schedules the remainder.
  spent_minutes      int         not null default 0 check (spent_minutes >= 0),
  -- 1 = highest. Small fixed scale keeps scoring weights interpretable.
  priority           smallint    not null default 2 check (priority between 1 and 3),
  status             text        not null default 'todo'
                       check (status in ('todo', 'doing', 'done', 'archived')),
  -- Never split this task into a block shorter than this; some work has a
  -- fixed cost to pick up again.
  min_block_minutes  smallint    not null default 25
                       check (min_block_minutes between 5 and 480),
  -- Allow the packer to split across several blocks at all.
  splittable         boolean     not null default true,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- `completed_at` and `status` must agree, or "what did I finish this week?"
  -- silently returns the wrong set.
  constraint tasks_completed_at_matches_status check (
    (status = 'done') = (completed_at is not null)
  )
);

create index if not exists tasks_user_status_due_idx
  on public.tasks (user_id, status, due_at);

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch
  before update on public.tasks
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- topics — ongoing study that recurs instead of completing
-- ---------------------------------------------------------------------------

create table if not exists public.topics (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid        not null references auth.users(id) on delete cascade,
  name                    text        not null check (char_length(trim(name)) between 1 and 120),
  notes                   text        check (char_length(notes) <= 10000),
  -- Optional target date (exam, interview). Drives urgency the same way a task
  -- deadline does, but the topic is never "done" — it just stops being urgent.
  target_at               timestamptz,
  target_minutes_per_week int         not null default 120
                            check (target_minutes_per_week between 15 and 10080),
  -- Self-rated 1 (shaky) .. 5 (solid). Low confidence pulls time toward it.
  confidence              smallint    not null default 3 check (confidence between 1 and 5),
  priority                smallint    not null default 2 check (priority between 1 and 3),
  min_block_minutes       smallint    not null default 30
                            check (min_block_minutes between 5 and 480),
  active                  boolean     not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists topics_user_active_idx
  on public.topics (user_id, active);

drop trigger if exists topics_touch on public.topics;
create trigger topics_touch
  before update on public.topics
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- availability_blocks — the recurring weekly template
-- ---------------------------------------------------------------------------

create table if not exists public.availability_blocks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid     not null references auth.users(id) on delete cascade,
  -- 0 = Sunday .. 6 = Saturday, matching JavaScript's Date#getDay so the web and
  -- CLI clients never have to remap.
  weekday      smallint not null check (weekday between 0 and 6),
  -- Minutes from local midnight. 1440 is a valid end (midnight next day).
  start_minute int      not null check (start_minute between 0 and 1439),
  end_minute   int      not null check (end_minute between 1 and 1440),
  label        text     check (char_length(label) <= 60),
  created_at   timestamptz not null default now(),

  constraint availability_blocks_ordered check (end_minute > start_minute)
);

create index if not exists availability_blocks_user_weekday_idx
  on public.availability_blocks (user_id, weekday, start_minute);

-- ---------------------------------------------------------------------------
-- calendar_events — cached Google busy times that subtract from the template
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  -- Google's event id. Unique per user so a re-sync upserts instead of duplicating.
  external_id text        not null,
  calendar_id text,
  title       text,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  -- transparent ("free") events still show on a calendar but must not block.
  is_busy     boolean     not null default true,
  synced_at   timestamptz not null default now(),

  constraint calendar_events_ordered check (ends_at > starts_at),
  constraint calendar_events_unique_per_user unique (user_id, external_id)
);

create index if not exists calendar_events_user_window_idx
  on public.calendar_events (user_id, starts_at, ends_at);

-- ---------------------------------------------------------------------------
-- scheduled_blocks — the generated plan
-- ---------------------------------------------------------------------------

create table if not exists public.scheduled_blocks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  task_id     uuid        references public.tasks(id)  on delete cascade,
  topic_id    uuid        references public.topics(id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  -- A block the user pinned. Regeneration schedules around it instead of moving it.
  locked      boolean     not null default false,
  -- Groups every block produced by one run of the packer, so a regeneration can
  -- replace exactly the previous unlocked set.
  plan_run_id uuid,
  created_at  timestamptz not null default now(),

  constraint scheduled_blocks_ordered check (ends_at > starts_at),
  -- Exactly one of task/topic. A block with neither schedules nothing; a block
  -- with both is ambiguous to render and to credit time against.
  constraint scheduled_blocks_one_subject check (num_nonnulls(task_id, topic_id) = 1)
);

create index if not exists scheduled_blocks_user_window_idx
  on public.scheduled_blocks (user_id, starts_at);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.user_settings       enable row level security;
alter table public.tasks               enable row level security;
alter table public.topics              enable row level security;
alter table public.availability_blocks enable row level security;
alter table public.calendar_events     enable row level security;
alter table public.scheduled_blocks    enable row level security;

-- One policy per table covering all four verbs. `with check` matters as much as
-- `using`: without it a user could INSERT a row owned by someone else.
do $$
declare
  t text;
begin
  foreach t in array array[
    'user_settings', 'tasks', 'topics',
    'availability_blocks', 'calendar_events', 'scheduled_blocks'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I
         for all
         to authenticated
         using ((select auth.uid()) = user_id)
         with check ((select auth.uid()) = user_id)',
      t || '_owner', t
    );
  end loop;
end;
$$;
