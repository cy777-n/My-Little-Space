create extension if not exists "pgcrypto";

create table if not exists public.food (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null,
  mrt text, exit text, walk_minutes integer, maps_url text, note text,
  created_at timestamptz default now()
);

create table if not exists public.wishlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  country text not null,
  purchase_place text, note text,
  created_at timestamptz default now()
);

create table if not exists public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null,
  created_at timestamptz default now()
);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  note text,
  event_type text not null default '提醒事項',
  event_date date,
  start_date date,
  end_date date,
  event_time time,
  location text,
  done boolean not null default false,
  created_at timestamptz default now()
);

-- Compatibility columns for every field used by the current website.
alter table public.food add column if not exists name text;
alter table public.food add column if not exists category text;
alter table public.food add column if not exists mrt text;
alter table public.food add column if not exists exit text;
alter table public.food add column if not exists walk_minutes integer;
alter table public.food add column if not exists maps_url text;
alter table public.food add column if not exists note text;
alter table public.food add column if not exists created_at timestamptz default now();

alter table public.wishlist add column if not exists name text;
alter table public.wishlist add column if not exists country text;
alter table public.wishlist add column if not exists purchase_place text;
alter table public.wishlist add column if not exists note text;
alter table public.wishlist add column if not exists created_at timestamptz default now();

alter table public.watchlist add column if not exists name text;
alter table public.watchlist add column if not exists category text;
alter table public.watchlist add column if not exists created_at timestamptz default now();

alter table public.todos add column if not exists title text;
alter table public.todos add column if not exists note text;
alter table public.todos add column if not exists event_type text default '提醒事項';
alter table public.todos add column if not exists event_date date;
alter table public.todos add column if not exists start_date date;
alter table public.todos add column if not exists end_date date;
alter table public.todos add column if not exists event_time time;
alter table public.todos add column if not exists location text;
alter table public.todos add column if not exists done boolean default false;
alter table public.todos add column if not exists created_at timestamptz default now();

-- Old versions can have a required legacy "type" column.
alter table public.todos alter column type drop not null;

-- Preserve old single-date data.
update public.todos
set start_date = event_date
where start_date is null and event_date is not null;

-- Empty optional fields must not block inserts.
alter table public.food alter column mrt drop not null;
alter table public.food alter column exit drop not null;
alter table public.food alter column walk_minutes drop not null;
alter table public.food alter column maps_url drop not null;
alter table public.food alter column note drop not null;

alter table public.wishlist alter column purchase_place drop not null;
alter table public.wishlist alter column note drop not null;

alter table public.todos alter column note drop not null;
alter table public.todos alter column event_date drop not null;
alter table public.todos alter column start_date drop not null;
alter table public.todos alter column end_date drop not null;
alter table public.todos alter column event_time drop not null;
alter table public.todos alter column location drop not null;

alter table public.food enable row level security;
alter table public.wishlist enable row level security;
alter table public.watchlist enable row level security;
alter table public.todos enable row level security;

-- Remove all old policies on these four app tables so this script can be rerun safely.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('food','wishlist','watchlist','todos')
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

create policy food_own on public.food
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy wishlist_own on public.wishlist
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy watchlist_own on public.watchlist
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy todos_own on public.todos
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists food_user_created_idx on public.food(user_id, created_at desc);
create index if not exists wishlist_user_created_idx on public.wishlist(user_id, created_at desc);
create index if not exists watchlist_user_created_idx on public.watchlist(user_id, created_at desc);
create index if not exists todos_user_created_idx on public.todos(user_id, created_at desc);

notify pgrst, 'reload schema';
