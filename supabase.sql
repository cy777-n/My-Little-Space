create extension if not exists "pgcrypto";

create table if not exists public.food(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, category text not null,
  mrt text, exit text, walk_minutes integer, maps_url text, note text,
  created_at timestamptz default now()
);
create table if not exists public.wishlist(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, country text not null,
  purchase_place text, note text,
  created_at timestamptz default now()
);
create table if not exists public.watchlist(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, category text not null,
  created_at timestamptz default now()
);
create table if not exists public.todos(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, note text,
  event_type text not null default '提醒事項',
  event_date date, start_date date, end_date date,
  event_time time, location text,
  done boolean not null default false,
  created_at timestamptz default now()
);

-- Compatibility for older versions / existing projects
alter table public.food add column if not exists mrt text;
alter table public.food add column if not exists exit text;
alter table public.food add column if not exists walk_minutes integer;
alter table public.food add column if not exists maps_url text;
alter table public.food add column if not exists note text;
alter table public.wishlist add column if not exists purchase_place text;
alter table public.wishlist add column if not exists note text;
alter table public.todos add column if not exists event_type text not null default '提醒事項';
alter table public.todos add column if not exists event_date date;
alter table public.todos add column if not exists start_date date;
alter table public.todos add column if not exists end_date date;
alter table public.todos add column if not exists event_time time;
alter table public.todos add column if not exists location text;
alter table public.todos add column if not exists note text;
alter table public.todos add column if not exists done boolean not null default false;

-- Preserve old single-date records by copying their date into start_date once.
update public.todos set start_date=event_date where start_date is null and event_date is not null;

alter table public.food enable row level security;
alter table public.wishlist enable row level security;
alter table public.watchlist enable row level security;
alter table public.todos enable row level security;

drop policy if exists food_own on public.food;
create policy food_own on public.food for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists wishlist_own on public.wishlist;
create policy wishlist_own on public.wishlist for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists watchlist_own on public.watchlist;
create policy watchlist_own on public.watchlist for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists todos_own on public.todos;
create policy todos_own on public.todos for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);

create index if not exists food_user_created_idx on public.food(user_id, created_at desc);
create index if not exists wishlist_user_created_idx on public.wishlist(user_id, created_at desc);
create index if not exists watchlist_user_created_idx on public.watchlist(user_id, created_at desc);
create index if not exists todos_user_created_idx on public.todos(user_id, created_at desc);

-- Refresh PostgREST schema cache so new columns are immediately visible to the website.
notify pgrst, 'reload schema';
