-- ZIP! MARKET v8.2 — idempotent Supabase schema
-- Safe to run on an existing v5-v8.1 database. No DROP TABLE and no data deletion.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
set local search_path = public, extensions;

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  employee_no text not null unique,
  name text not null,
  password_hash text not null,
  credit_balance integer not null default 0 check (credit_balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_url text not null default '/assets/game-default.svg',
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  amount integer not null,
  type text not null default 'payment',
  description text not null default '',
  balance_after integer,
  created_at timestamptz not null default now()
);

create table if not exists public.game_completions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique (participant_id, game_id)
);

-- Add every column expected by v8.2 when upgrading a partial/older schema.
alter table public.participants add column if not exists employee_no text;
alter table public.participants add column if not exists name text;
alter table public.participants add column if not exists password_hash text;
alter table public.participants add column if not exists credit_balance integer;
alter table public.participants add column if not exists created_at timestamptz default now();
alter table public.participants add column if not exists updated_at timestamptz default now();

alter table public.games add column if not exists name text;
alter table public.games add column if not exists image_url text default '/assets/game-default.svg';
alter table public.games add column if not exists created_at timestamptz default now();

alter table public.transactions add column if not exists participant_id uuid;
alter table public.transactions add column if not exists amount integer;
alter table public.transactions add column if not exists type text default 'payment';
alter table public.transactions add column if not exists description text default '';
alter table public.transactions add column if not exists balance_after integer;
alter table public.transactions add column if not exists created_at timestamptz default now();

alter table public.game_completions add column if not exists participant_id uuid;
alter table public.game_completions add column if not exists game_id uuid;
alter table public.game_completions add column if not exists completed_at timestamptz default now();

-- Copy legacy column values only when those legacy columns exist.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='participants' and column_name='employee_id') then
    execute 'update public.participants set employee_no = coalesce(employee_no, employee_id::text) where employee_no is null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='participants' and column_name='credits') then
    execute 'update public.participants set credit_balance = coalesce(credit_balance, credits::integer) where credit_balance is null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='participants' and column_name='password') then
    execute $migrate$
      update public.participants
      set password_hash = case
        when password::text like '$2%' then password::text
        else crypt(password::text, gen_salt('bf'))
      end
      where password_hash is null and password is not null
    $migrate$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='games' and column_name='title') then
    execute 'update public.games set name = coalesce(name, title::text) where name is null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='games' and column_name='image') then
    execute 'update public.games set image_url = coalesce(nullif(image_url, ''''), image::text) where image is not null';
  end if;
end $$;

update public.participants set credit_balance = 0 where credit_balance is null;
update public.participants set updated_at = now() where updated_at is null;
update public.games set name = 'GAME' where name is null or btrim(name) = '';
update public.games set image_url = '/assets/game-default.svg' where image_url is null or btrim(image_url) = '';
update public.transactions set type = 'payment' where type is null;
update public.transactions set description = '' where description is null;

create unique index if not exists participants_employee_no_uidx on public.participants(employee_no);
create index if not exists transactions_participant_created_idx on public.transactions(participant_id, created_at desc);
create index if not exists game_completions_participant_idx on public.game_completions(participant_id);
create unique index if not exists game_completions_participant_game_uidx on public.game_completions(participant_id, game_id);

create or replace function public.zip_market_initialize_admin(p_initial_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  created_now boolean := false;
  inserted_count integer := 0;
begin
  if nullif(btrim(p_initial_password), '') is null then
    raise exception 'INITIAL_ADMIN_PASSWORD_REQUIRED' using errcode = '22023';
  end if;

  insert into public.app_settings(key, value, updated_at)
  values ('admin_password', crypt(p_initial_password, gen_salt('bf')), now())
  on conflict (key) do nothing;
  get diagnostics inserted_count = row_count;
  created_now := inserted_count > 0;

  return jsonb_build_object('initialized', true, 'createdNow', created_now);
end;
$$;

create or replace function public.zip_market_auth_admin(p_initial_password text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  stored_hash text;
  authenticated boolean := false;
begin
  perform public.zip_market_initialize_admin(p_initial_password);
  select value into stored_hash from public.app_settings where key = 'admin_password';

  authenticated := stored_hash is not null and crypt(p_password, stored_hash) = stored_hash;

  -- Recovery path: the current Netlify INITIAL_ADMIN_PASSWORD can re-synchronize
  -- a stale DB hash, while normal custom passwords remain supported.
  if not authenticated and p_password = p_initial_password then
    update public.app_settings
       set value = crypt(p_initial_password, gen_salt('bf')),
           updated_at = now()
     where key = 'admin_password';
    authenticated := true;
  end if;

  return jsonb_build_object('authenticated', authenticated);
end;
$$;

create or replace function public.zip_market_auth_participant(p_employee_no text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  person public.participants%rowtype;
begin
  select * into person
    from public.participants
   where employee_no = btrim(p_employee_no)
   limit 1;

  if person.id is null or person.password_hash is null
     or crypt(p_password, person.password_hash) <> person.password_hash then
    return jsonb_build_object('authenticated', false);
  end if;

  return jsonb_build_object(
    'authenticated', true,
    'participant', jsonb_build_object(
      'id', person.id,
      'employee_no', person.employee_no,
      'name', person.name,
      'credit_balance', person.credit_balance
    )
  );
end;
$$;

-- v7/v8 compatibility aliases retained intentionally.
create or replace function public.zip_auth_admin(p_initial_password text, p_password text)
returns jsonb language sql security definer set search_path = public
as $$ select public.zip_market_auth_admin(p_initial_password, p_password) $$;

create or replace function public.zip_auth_participant(p_employee_no text, p_password text)
returns jsonb language sql security definer set search_path = public
as $$ select public.zip_market_auth_participant(p_employee_no, p_password) $$;

create or replace function public.zip_market_admin_create_participant(
  p_employee_no text,
  p_name text,
  p_password text,
  p_initial_credit integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  person public.participants%rowtype;
  opening integer := greatest(coalesce(p_initial_credit, 0), 0);
begin
  if nullif(btrim(p_employee_no), '') is null or nullif(btrim(p_name), '') is null
     or nullif(p_password, '') is null then
    raise exception 'PARTICIPANT_FIELDS_REQUIRED' using errcode = '22023';
  end if;

  insert into public.participants(employee_no, name, password_hash, credit_balance, created_at, updated_at)
  values (btrim(p_employee_no), btrim(p_name), crypt(p_password, gen_salt('bf')), opening, now(), now())
  returning * into person;

  if opening <> 0 then
    insert into public.transactions(participant_id, amount, type, description, balance_after)
    values (person.id, opening, 'initial', '초기 크레딧', opening);
  end if;

  return to_jsonb(person) - 'password_hash';
exception
  when unique_violation then
    raise exception 'EMPLOYEE_NO_ALREADY_EXISTS' using errcode = '23505';
end;
$$;

create or replace function public.zip_market_set_admin_password(p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if length(coalesce(p_password, '')) < 4 then
    raise exception 'PASSWORD_TOO_SHORT' using errcode = '22023';
  end if;
  insert into public.app_settings(key, value, updated_at)
  values ('admin_password', crypt(p_password, gen_salt('bf')), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('updated', true);
end;
$$;

create or replace function public.zip_market_grant_credit(p_participant_id uuid, p_amount integer, p_description text default '관리자 지급')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
begin
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = '22023'; end if;
  update public.participants
     set credit_balance = credit_balance + p_amount, updated_at = now()
   where id = p_participant_id
   returning credit_balance into new_balance;
  if new_balance is null then raise exception 'PARTICIPANT_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.transactions(participant_id, amount, type, description, balance_after)
  values (p_participant_id, p_amount, 'grant', coalesce(nullif(p_description,''), '관리자 지급'), new_balance);
  return jsonb_build_object('ok', true, 'balance', new_balance);
end;
$$;

create or replace function public.pay_credit(p_participant_id uuid, p_amount integer, p_description text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
begin
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = '22023'; end if;
  update public.participants
     set credit_balance = credit_balance - p_amount, updated_at = now()
   where id = p_participant_id and credit_balance >= p_amount
   returning credit_balance into new_balance;
  if new_balance is null then raise exception 'INSUFFICIENT_CREDIT' using errcode = 'P0001'; end if;
  insert into public.transactions(participant_id, amount, type, description, balance_after)
  values (p_participant_id, -p_amount, 'payment', coalesce(nullif(p_description,''), '크레딧 결제'), new_balance);
  return jsonb_build_object('ok', true, 'balance', new_balance);
end;
$$;

create or replace function public.zip_market_pay_credit(p_participant_id uuid, p_amount integer, p_description text)
returns jsonb language sql security definer set search_path = public
as $$ select public.pay_credit(p_participant_id, p_amount, p_description) $$;

create or replace function public.complete_game(p_participant_id uuid, p_game_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  parsed_game_id uuid;
begin
  begin parsed_game_id := p_game_id::uuid;
  exception when invalid_text_representation then raise exception 'INVALID_GAME_ID' using errcode = '22023'; end;

  if not exists (select 1 from public.games where id = parsed_game_id) then
    raise exception 'GAME_NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.game_completions(participant_id, game_id)
  values (p_participant_id, parsed_game_id)
  on conflict (participant_id, game_id) do nothing;
  return jsonb_build_object('ok', true, 'gameId', parsed_game_id);
end;
$$;

create or replace function public.zip_market_complete_game(p_participant_id uuid, p_game_id uuid)
returns jsonb language sql security definer set search_path = public
as $$ select public.complete_game(p_participant_id, p_game_id::text) $$;

-- Default games are inserted only when no games exist.
insert into public.games(name, image_url)
select seed.name, seed.image_url
from (values
  ('풍선 게임', '/assets/game-balloon.webp'),
  ('탁구공 게임', '/assets/game-pingpong.webp')
) as seed(name, image_url)
where not exists (select 1 from public.games);

alter table public.app_settings enable row level security;
alter table public.participants enable row level security;
alter table public.transactions enable row level security;
alter table public.games enable row level security;
alter table public.game_completions enable row level security;

revoke all on table public.app_settings, public.participants, public.transactions, public.games, public.game_completions from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.app_settings, public.participants, public.transactions, public.games, public.game_completions to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.zip_market_initialize_admin(text) to service_role;
grant execute on function public.zip_market_auth_admin(text, text) to service_role;
grant execute on function public.zip_market_auth_participant(text, text) to service_role;
grant execute on function public.zip_auth_admin(text, text) to service_role;
grant execute on function public.zip_auth_participant(text, text) to service_role;
grant execute on function public.zip_market_admin_create_participant(text, text, text, integer) to service_role;
grant execute on function public.zip_market_set_admin_password(text) to service_role;
grant execute on function public.zip_market_grant_credit(uuid, integer, text) to service_role;
grant execute on function public.pay_credit(uuid, integer, text) to service_role;
grant execute on function public.zip_market_pay_credit(uuid, integer, text) to service_role;
grant execute on function public.complete_game(uuid, text) to service_role;
grant execute on function public.zip_market_complete_game(uuid, uuid) to service_role;

-- Ask PostgREST to see new/changed RPC signatures immediately.
notify pgrst, 'reload schema';

commit;
