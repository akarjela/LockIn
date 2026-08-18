-- Collapse tasks and topics into one `items` table.
--
-- The split was a schema distinction leaking into the product: it forced a
-- categorisation decision ("is revising for the exam a task or a topic?") that
-- says nothing about the work itself. One type, with the difference expressed as
-- optional fields, asks only questions the user can actually answer:
--
--   Does it have a deadline?          -> due_at
--   Is it a fixed amount of work?     -> estimated_minutes
--   Or does it recur every week?      -> target_minutes_per_week
--
-- The scheduler keeps both behaviours — finite work burns down, recurring work
-- refills weekly — but that is now derived from which field is set rather than
-- from which table a row lives in.
--
-- Safe to re-run: every statement is guarded.

-- ---------------------------------------------------------------------------
-- items
-- ---------------------------------------------------------------------------

create table if not exists public.items (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid        not null references auth.users(id) on delete cascade,
  title                   text        not null check (char_length(trim(title)) between 1 and 200),
  notes                   text        check (char_length(notes) <= 10000),

  -- A deadline, an exam date — anything that makes this urgent by a moment in
  -- time. Optional for both finite and recurring work.
  due_at                  timestamptz,

  -- Exactly one of these two is set, enforced below. Together they answer
  -- "how much time does this want?" — the only question the packer asks.
  estimated_minutes       int         check (estimated_minutes between 5 and 1440),
  target_minutes_per_week int         check (target_minutes_per_week between 15 and 10080),

  -- Only meaningful alongside a weekly target: how much time already went in.
  spent_minutes           int         not null default 0 check (spent_minutes >= 0),

  priority                smallint    not null default 2 check (priority between 1 and 3),
  -- Self-rated grasp, 1 shaky .. 5 solid. Null when it does not apply.
  confidence              smallint    check (confidence between 1 and 5),

  min_block_minutes       smallint    not null default 25
                            check (min_block_minutes between 5 and 480),
  splittable              boolean     not null default true,

  -- 'archived' doubles as "paused" for recurring work — one concept instead of
  -- a separate active flag that meant the same thing.
  status                  text        not null default 'todo'
                            check (status in ('todo', 'doing', 'done', 'archived')),
  completed_at            timestamptz,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint items_completed_at_matches_status check (
    (status = 'done') = (completed_at is not null)
  ),
  -- The heart of the unification: one and only one notion of "how much".
  -- Both set is ambiguous; neither set is unschedulable.
  constraint items_one_workload check (
    num_nonnulls(estimated_minutes, target_minutes_per_week) = 1
  )
);

create index if not exists items_user_status_due_idx
  on public.items (user_id, status, due_at);

drop trigger if exists items_touch on public.items;
create trigger items_touch
  before update on public.items
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Carry existing rows across
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.tasks') is not null then
    insert into public.items (
      id, user_id, title, notes, due_at, estimated_minutes, spent_minutes,
      priority, min_block_minutes, splittable, status, completed_at,
      created_at, updated_at
    )
    select
      id, user_id, title, notes, due_at, estimated_minutes, spent_minutes,
      priority, min_block_minutes, splittable, status, completed_at,
      created_at, updated_at
    from public.tasks
    on conflict (id) do nothing;
  end if;

  if to_regclass('public.topics') is not null then
    insert into public.items (
      id, user_id, title, notes, due_at, target_minutes_per_week, confidence,
      priority, min_block_minutes, splittable, status, created_at, updated_at
    )
    select
      id, user_id, name, notes, target_at, target_minutes_per_week, confidence,
      priority, min_block_minutes,
      true,
      -- A paused topic and an archived task are the same state.
      case when active then 'todo' else 'archived' end,
      created_at, updated_at
    from public.topics
    on conflict (id) do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- scheduled_blocks now points at one column instead of two
-- ---------------------------------------------------------------------------

alter table public.scheduled_blocks
  add column if not exists item_id uuid references public.items(id) on delete cascade;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'scheduled_blocks'
      and column_name = 'task_id'
  ) then
    update public.scheduled_blocks
       set item_id = coalesce(task_id, topic_id)
     where item_id is null;
  end if;
end;
$$;

-- Any block whose subject vanished before the backfill has nothing to point at.
delete from public.scheduled_blocks where item_id is null;

alter table public.scheduled_blocks
  drop constraint if exists scheduled_blocks_one_subject;
alter table public.scheduled_blocks drop column if exists task_id;
alter table public.scheduled_blocks drop column if exists topic_id;
alter table public.scheduled_blocks alter column item_id set not null;

-- ---------------------------------------------------------------------------
-- RLS, then retire the old tables
-- ---------------------------------------------------------------------------

alter table public.items enable row level security;

drop policy if exists items_owner on public.items;
create policy items_owner on public.items
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop table if exists public.tasks;
drop table if exists public.topics;
