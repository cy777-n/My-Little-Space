-- My Little Space v14
-- Safe to run on the existing Supabase project.
-- Adds the optional memo area, image attachments, URLs and tables,
-- while keeping the existing food/wishlist/watchlist/todos data.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  content text,
  urls text,
  table_data jsonb,
  created_at timestamptz default now()
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null,
  item_id text not null,
  file_name text not null,
  storage_path text not null,
  public_url text not null,
  created_at timestamptz default now()
);

-- Existing tables: ensure current columns exist.
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

-- Shared groups: private content remains private unless share_group_id is set.
create table if not exists public.share_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  passcode_hash text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

create table if not exists public.share_group_members (
  group_id uuid not null references public.share_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz default now(),
  primary key(group_id,user_id)
);

alter table public.food add column if not exists share_group_id uuid;
alter table public.wishlist add column if not exists share_group_id uuid;
alter table public.watchlist add column if not exists share_group_id uuid;
alter table public.todos add column if not exists share_group_id uuid;
alter table public.memos add column if not exists share_group_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='food_share_group_fk') then
    alter table public.food add constraint food_share_group_fk foreign key (share_group_id) references public.share_groups(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='wishlist_share_group_fk') then
    alter table public.wishlist add constraint wishlist_share_group_fk foreign key (share_group_id) references public.share_groups(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='watchlist_share_group_fk') then
    alter table public.watchlist add constraint watchlist_share_group_fk foreign key (share_group_id) references public.share_groups(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='todos_share_group_fk') then
    alter table public.todos add constraint todos_share_group_fk foreign key (share_group_id) references public.share_groups(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='memos_share_group_fk') then
    alter table public.memos add constraint memos_share_group_fk foreign key (share_group_id) references public.share_groups(id) on delete set null;
  end if;
end $$;

-- Old-version compatibility: these legacy fields must not block current inserts.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='food' and column_name='exit_no') then
    execute 'alter table public.food alter column exit_no drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='food' and column_name='station') then
    execute 'alter table public.food alter column station drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='food' and column_name='map_url') then
    execute 'alter table public.food alter column map_url drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='watchlist' and column_name='title') then
    execute 'alter table public.watchlist alter column title drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='todos' and column_name='type') then
    execute 'alter table public.todos alter column type drop not null';
  end if;
end $$;

alter table public.food alter column mrt drop not null;
alter table public.food alter column exit drop not null;
alter table public.food alter column walk_minutes drop not null;
alter table public.food alter column maps_url drop not null;
alter table public.food alter column note drop not null;

alter table public.wishlist alter column purchase_place drop not null;
alter table public.wishlist alter column note drop not null;

alter table public.watchlist alter column name drop not null;
alter table public.watchlist alter column category drop not null;

alter table public.todos alter column note drop not null;
alter table public.todos alter column event_date drop not null;
alter table public.todos alter column start_date drop not null;
alter table public.todos alter column end_date drop not null;
alter table public.todos alter column event_time drop not null;
alter table public.todos alter column location drop not null;

alter table public.memos alter column title drop not null;
alter table public.memos alter column content drop not null;
alter table public.memos alter column urls drop not null;
alter table public.memos alter column table_data drop not null;

-- Preserve old single-date todo data.
update public.todos
set start_date = event_date
where start_date is null and event_date is not null;

-- Shared-group functions. Passcodes are stored as hashes, not plaintext.
create or replace function public.create_share_group(p_name text, p_passcode text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  gid uuid;
  uid uuid := auth.uid();
  crypto_schema text;
  pass_hash text;
begin
  if uid is null then raise exception '請先登入'; end if;
  if length(trim(p_name)) < 1 or length(p_passcode) < 1 then raise exception '請輸入群組名稱與密碼'; end if;

  select n.nspname into crypto_schema
  from pg_extension e
  join pg_namespace n on n.oid=e.extnamespace
  where e.extname='pgcrypto'
  limit 1;
  if crypto_schema is null then raise exception '尚未啟用 pgcrypto 擴充功能'; end if;

  execute format('select %I.crypt($1, %I.gen_salt(''bf''))', crypto_schema, crypto_schema)
    into pass_hash using p_passcode;

  insert into public.share_groups(name,passcode_hash,owner_id)
  values(trim(p_name),pass_hash,uid)
  returning id into gid;
  insert into public.share_group_members(group_id,user_id,role) values(gid,uid,'owner');
  return gid;
end $$;

create or replace function public.join_share_group(p_name text, p_passcode text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  gid uuid;
  uid uuid := auth.uid();
  crypto_schema text;
begin
  if uid is null then raise exception '請先登入'; end if;
  if length(trim(p_name)) < 1 or length(p_passcode) < 1 then raise exception '請輸入群組名稱與密碼'; end if;

  select n.nspname into crypto_schema
  from pg_extension e
  join pg_namespace n on n.oid=e.extnamespace
  where e.extname='pgcrypto'
  limit 1;
  if crypto_schema is null then raise exception '尚未啟用 pgcrypto 擴充功能'; end if;

  execute format('select id from public.share_groups where name=$1 and passcode_hash=%I.crypt($2,passcode_hash) limit 1', crypto_schema)
    into gid using trim(p_name), p_passcode;
  if gid is null then raise exception '群組名稱或密碼不正確'; end if;
  insert into public.share_group_members(group_id,user_id,role) values(gid,uid,'member') on conflict do nothing;
  return gid;
end $$;

revoke execute on function public.create_share_group(text,text) from public;
grant execute on function public.create_share_group(text,text) to authenticated;
revoke execute on function public.join_share_group(text,text) from public;
grant execute on function public.join_share_group(text,text) to authenticated;

create or replace function public.is_share_group_member(p_group_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.share_group_members where group_id=p_group_id and user_id=p_user_id);
$$;

-- RLS for the app tables.
alter table public.food enable row level security;
alter table public.wishlist enable row level security;
alter table public.watchlist enable row level security;
alter table public.todos enable row level security;
alter table public.memos enable row level security;
alter table public.attachments enable row level security;
alter table public.share_groups enable row level security;
alter table public.share_group_members enable row level security;

-- Remove old policies on app tables so this script can be run repeatedly.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname='public'
      and tablename in ('food','wishlist','watchlist','todos','memos','attachments','share_groups','share_group_members')
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

create policy food_own on public.food for all to authenticated
using (auth.uid()=user_id or public.is_share_group_member(food.share_group_id))
with check ((share_group_id is null and user_id=auth.uid()) or (share_group_id is not null and public.is_share_group_member(share_group_id)));

create policy wishlist_own on public.wishlist for all to authenticated
using (auth.uid()=user_id or public.is_share_group_member(wishlist.share_group_id))
with check ((share_group_id is null and user_id=auth.uid()) or (share_group_id is not null and public.is_share_group_member(share_group_id)));

create policy watchlist_own on public.watchlist for all to authenticated
using (auth.uid()=user_id or public.is_share_group_member(watchlist.share_group_id))
with check ((share_group_id is null and user_id=auth.uid()) or (share_group_id is not null and public.is_share_group_member(share_group_id)));

create policy todos_own on public.todos for all to authenticated
using (auth.uid()=user_id or public.is_share_group_member(todos.share_group_id))
with check ((share_group_id is null and user_id=auth.uid()) or (share_group_id is not null and public.is_share_group_member(share_group_id)));

create policy memos_own on public.memos for all to authenticated
using (auth.uid()=user_id or public.is_share_group_member(memos.share_group_id))
with check ((share_group_id is null and user_id=auth.uid()) or (share_group_id is not null and public.is_share_group_member(share_group_id)));

create policy share_groups_select on public.share_groups for select to authenticated
using (public.is_share_group_member(share_groups.id) or owner_id=auth.uid());

create policy share_group_members_select on public.share_group_members for select to authenticated
using (user_id=auth.uid() or public.is_share_group_member(group_id));

create policy attachments_own on public.attachments for all to authenticated
using (auth.uid()=user_id
  or exists (select 1 from public.food f where f.id::text=attachments.item_id and attachments.item_type='food' and public.is_share_group_member(f.share_group_id))
  or exists (select 1 from public.wishlist w where w.id::text=attachments.item_id and attachments.item_type='wishlist' and public.is_share_group_member(w.share_group_id))
  or exists (select 1 from public.watchlist w where w.id::text=attachments.item_id and attachments.item_type='watchlist' and public.is_share_group_member(w.share_group_id))
  or exists (select 1 from public.todos t where t.id::text=attachments.item_id and attachments.item_type='todo' and public.is_share_group_member(t.share_group_id))
  or exists (select 1 from public.memos m where m.id::text=attachments.item_id and attachments.item_type='memo' and public.is_share_group_member(m.share_group_id)))
with check (auth.uid()=user_id);

-- Image storage bucket. The bucket is public so image previews can use stable URLs.
insert into storage.buckets (id,name,public)
values ('attachments','attachments',true)
on conflict (id) do update set public=true;

drop policy if exists attachments_storage_select on storage.objects;
drop policy if exists attachments_storage_insert on storage.objects;
drop policy if exists attachments_storage_delete on storage.objects;

create policy attachments_storage_select on storage.objects
for select to public
using (bucket_id='attachments');

create policy attachments_storage_insert on storage.objects
for insert to authenticated
with check (bucket_id='attachments' and (storage.foldername(name))[1]=auth.uid()::text);

create policy attachments_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id='attachments'
  and (
    (storage.foldername(name))[1]=auth.uid()::text
    or exists (
      select 1
      from public.attachments a
      where a.storage_path=name
        and (
          a.user_id=auth.uid()
          or exists (select 1 from public.food f where a.item_type='food' and f.id::text=a.item_id and public.is_share_group_member(f.share_group_id))
          or exists (select 1 from public.wishlist w where a.item_type='wishlist' and w.id::text=a.item_id and public.is_share_group_member(w.share_group_id))
          or exists (select 1 from public.watchlist w where a.item_type='watchlist' and w.id::text=a.item_id and public.is_share_group_member(w.share_group_id))
          or exists (select 1 from public.todos t where a.item_type='todo' and t.id::text=a.item_id and public.is_share_group_member(t.share_group_id))
          or exists (select 1 from public.memos m where a.item_type='memo' and m.id::text=a.item_id and public.is_share_group_member(m.share_group_id))
        )
    )
  )
);

create index if not exists food_user_created_idx on public.food(user_id,created_at desc);
create index if not exists food_share_group_idx on public.food(share_group_id);
create index if not exists wishlist_user_created_idx on public.wishlist(user_id,created_at desc);
create index if not exists wishlist_share_group_idx on public.wishlist(share_group_id);
create index if not exists watchlist_user_created_idx on public.watchlist(user_id,created_at desc);
create index if not exists watchlist_share_group_idx on public.watchlist(share_group_id);
create index if not exists todos_user_created_idx on public.todos(user_id,created_at desc);
create index if not exists memos_user_created_idx on public.memos(user_id,created_at desc);
create index if not exists attachments_item_idx on public.attachments(user_id,item_type,item_id);
create index if not exists todos_share_group_idx on public.todos(share_group_id);
create index if not exists memos_share_group_idx on public.memos(share_group_id);
create index if not exists share_group_members_user_idx on public.share_group_members(user_id);

notify pgrst,'reload schema';

-- v24: custom categories for every area + leaving groups.
alter table public.memos add column if not exists category text;

create table if not exists public.space_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  share_group_id uuid references public.share_groups(id) on delete cascade,
  area text not null,
  label text not null,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

create unique index if not exists space_categories_private_unique
  on public.space_categories(user_id,area,label)
  where share_group_id is null;
create unique index if not exists space_categories_group_unique
  on public.space_categories(share_group_id,area,label)
  where share_group_id is not null;
create index if not exists space_categories_private_idx
  on public.space_categories(user_id,area,sort_order);
create index if not exists space_categories_group_idx
  on public.space_categories(share_group_id,area,sort_order);

alter table public.space_categories enable row level security;
drop policy if exists space_categories_all on public.space_categories;
create policy space_categories_all on public.space_categories for all to authenticated
using (
  (share_group_id is null and user_id=auth.uid())
  or (share_group_id is not null and public.is_share_group_member(share_group_id))
)
with check (
  (share_group_id is null and user_id=auth.uid())
  or (share_group_id is not null and public.is_share_group_member(share_group_id))
);

create or replace function public.leave_share_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  delete from public.share_group_members
  where group_id=p_group_id and user_id=auth.uid();
end;
$$;
revoke execute on function public.leave_share_group(uuid) from public;
grant execute on function public.leave_share_group(uuid) to authenticated;

-- Existing memo rows remain visible under 「全部」; new memo rows can use custom categories.

-- v25: remember whether a space has been initialized so built-in categories
-- can be deleted permanently without being recreated on the next load.
create table if not exists public.space_category_scopes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  share_group_id uuid references public.share_groups(id) on delete cascade,
  area text not null,
  created_at timestamptz default now(),
  constraint space_category_scope_one_owner check (
    (share_group_id is null and user_id is not null) or share_group_id is not null
  )
);
create unique index if not exists space_category_scopes_private_unique
  on public.space_category_scopes(user_id,area)
  where share_group_id is null;
create unique index if not exists space_category_scopes_group_unique
  on public.space_category_scopes(share_group_id,area)
  where share_group_id is not null;
create index if not exists space_category_scopes_private_idx
  on public.space_category_scopes(user_id,area);
create index if not exists space_category_scopes_group_idx
  on public.space_category_scopes(share_group_id,area);


-- v26: one-time restoration of the original built-in categories for scopes
-- created by v25. After migration, users may freely delete/reorder them and
-- they will not be recreated.
alter table public.space_category_scopes
  add column if not exists defaults_migrated boolean not null default false;
alter table public.space_category_scopes
  add column if not exists defaults_restored_v27 boolean not null default false;

alter table public.space_category_scopes enable row level security;
drop policy if exists space_category_scopes_all on public.space_category_scopes;
create policy space_category_scopes_all on public.space_category_scopes for all to authenticated
using (
  (share_group_id is null and user_id=auth.uid())
  or (share_group_id is not null and public.is_share_group_member(share_group_id))
)
with check (
  (share_group_id is null and user_id=auth.uid())
  or (share_group_id is not null and public.is_share_group_member(share_group_id))
);

notify pgrst,'reload schema';
