-- ZIP! MARKET v8.6.0 — FULL IDEMPOTENT SUPABASE SCHEMA + EVENT STABILITY REPAIR
-- Run this entire file once in Supabase > SQL Editor > New query.
-- It preserves rows. It never drops tables and never deletes participant, game,
-- transaction, completion, or setting data. It only replaces ZIP! MARKET RPCs.

set search_path = public, extensions, pg_catalog;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Tables and non-destructive compatibility columns
-- ---------------------------------------------------------------------------
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
  credit_balance integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_url text not null default '/assets/game-default.svg',
  reward integer not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  amount integer not null,
  kind text not null default 'payment',
  type text not null default 'payment',
  label text not null default '',
  description text not null default '',
  balance_after integer,
  reference text,
  created_at timestamptz not null default now()
);

create table if not exists public.game_completions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  rewarded_amount integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  unique (participant_id, game_id)
);

-- Canonical v5/v8 columns and v7 compatibility columns are both retained.
alter table public.participants add column if not exists employee_no text;
alter table public.participants add column if not exists employee_id text;
alter table public.participants add column if not exists name text;
alter table public.participants add column if not exists password_hash text;
alter table public.participants add column if not exists password text;
alter table public.participants add column if not exists credit_balance integer;
alter table public.participants add column if not exists credits integer;
alter table public.participants add column if not exists created_at timestamptz default now();
alter table public.participants add column if not exists updated_at timestamptz default now();

alter table public.games add column if not exists name text;
alter table public.games add column if not exists image_url text;
alter table public.games add column if not exists reward integer;
alter table public.games add column if not exists created_at timestamptz default now();

alter table public.transactions add column if not exists participant_id uuid;
alter table public.transactions add column if not exists amount integer;
alter table public.transactions add column if not exists kind text;
alter table public.transactions add column if not exists type text;
alter table public.transactions add column if not exists label text;
alter table public.transactions add column if not exists description text;
alter table public.transactions add column if not exists balance_after integer;
alter table public.transactions add column if not exists reference text;
alter table public.transactions add column if not exists created_at timestamptz default now();

alter table public.game_completions add column if not exists participant_id uuid;
alter table public.game_completions add column if not exists game_id uuid;
alter table public.game_completions add column if not exists rewarded_amount integer;
alter table public.game_completions add column if not exists created_at timestamptz default now();
alter table public.game_completions add column if not exists completed_at timestamptz default now();

-- Migrate values without overwriting populated canonical values.
update public.participants
   set employee_no = coalesce(nullif(btrim(employee_no), ''), nullif(btrim(employee_id), ''))
 where employee_no is null or btrim(employee_no) = '';
update public.participants
   set employee_id = coalesce(nullif(btrim(employee_id), ''), employee_no)
 where employee_id is null or btrim(employee_id) = '';
update public.participants
   set credit_balance = coalesce(credit_balance, credits, 0)
 where credit_balance is null;
update public.participants
   set credits = coalesce(credits, credit_balance, 0)
 where credits is null;
update public.participants
   set password_hash = case
     when password is null then null
     when password like '$2%' then password
     else crypt(password, gen_salt('bf', 10))
   end
 where password_hash is null;
update public.participants
   set password = password_hash
 where password is null and password_hash is not null;
update public.participants set credit_balance = 0 where credit_balance is null;
update public.participants set credits = credit_balance where credits is null;
update public.participants set created_at = now() where created_at is null;
update public.participants set updated_at = now() where updated_at is null;

update public.games set name = 'GAME' where name is null or btrim(name) = '';
update public.games set image_url = '/assets/game-default.svg' where image_url is null or btrim(image_url) = '';
update public.games set reward = 100 where reward is null or reward < 0;
update public.games set created_at = now() where created_at is null;

update public.transactions
   set kind = case
     when coalesce(reference, '') like 'initial:%' then 'initial'
     when coalesce(reference, '') like 'game:%' or coalesce(type, '') = 'game_reward' then 'game'
     when coalesce(type, '') in ('grant','award','initial') then 'credit'
     when coalesce(type, '') = 'adjustment' and amount >= 0 then 'credit'
     when coalesce(type, '') = 'adjustment' and amount < 0 then 'payment'
     else coalesce(nullif(btrim(type), ''), case when amount >= 0 then 'credit' else 'payment' end)
   end
 where kind is null or btrim(kind) = '';
update public.transactions set type = coalesce(nullif(btrim(type), ''), kind, case when amount >= 0 then 'grant' else 'payment' end) where type is null or btrim(type) = '';
update public.transactions set description = coalesce(description, label, '') where description is null;
update public.transactions set label = coalesce(label, description, '') where label is null;
update public.transactions set balance_after = 0 where balance_after is null;
update public.transactions set created_at = now() where created_at is null;
update public.game_completions set rewarded_amount = 0 where rewarded_amount is null;
update public.game_completions set created_at = coalesce(created_at, completed_at, now()) where created_at is null;
update public.game_completions set completed_at = coalesce(completed_at, created_at, now()) where completed_at is null;

alter table public.participants alter column credit_balance set default 0;
alter table public.participants alter column credits set default 0;
alter table public.games alter column image_url set default '/assets/game-default.svg';
alter table public.games alter column reward set default 100;
alter table public.transactions alter column type set default 'payment';
alter table public.transactions alter column kind set default 'payment';
alter table public.transactions alter column label set default '';
alter table public.transactions alter column description set default '';
alter table public.transactions alter column balance_after set default 0;
alter table public.transactions alter column kind set not null;
alter table public.transactions alter column type set not null;
alter table public.transactions alter column label set not null;
alter table public.transactions alter column description set not null;
alter table public.transactions alter column balance_after set not null;
alter table public.transactions alter column created_at set not null;
alter table public.game_completions alter column rewarded_amount set default 0;
alter table public.game_completions alter column completed_at set default now();

create unique index if not exists participants_employee_no_uidx on public.participants(employee_no);
create unique index if not exists participants_employee_id_uidx on public.participants(employee_id);
create index if not exists transactions_participant_created_idx on public.transactions(participant_id, created_at desc);
create unique index if not exists transactions_participant_reference_uidx on public.transactions(participant_id, reference) where reference is not null;
create index if not exists game_completions_participant_idx on public.game_completions(participant_id);
create unique index if not exists game_completions_participant_game_uidx on public.game_completions(participant_id, game_id);

-- Synchronize all known transaction column generations. This trigger protects
-- old Functions and future direct inserts as well as the v8.6 RPCs.
create or replace function public.zip_market_sync_transaction_compat()
returns trigger
language plpgsql
set search_path = public, extensions, pg_catalog
as $$
begin
  new.kind := coalesce(nullif(btrim(new.kind), ''), nullif(btrim(new.type), ''), case when new.amount >= 0 then 'credit' else 'payment' end);
  new.type := coalesce(nullif(btrim(new.type), ''), new.kind);
  new.description := coalesce(new.description, new.label, '');
  new.label := coalesce(new.label, new.description, '');
  new.balance_after := coalesce(new.balance_after, 0);
  new.created_at := coalesce(new.created_at, now());
  return new;
end;
$$;

drop trigger if exists zip_market_transaction_compat_trg on public.transactions;
create trigger zip_market_transaction_compat_trg
before insert or update on public.transactions
for each row execute function public.zip_market_sync_transaction_compat();

-- Keep v5/v8 and v7 participant columns synchronized.
create or replace function public.zip_market_sync_participant_compat()
returns trigger
language plpgsql
set search_path = public, extensions, pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and new.employee_id is distinct from old.employee_id
     and new.employee_no is not distinct from old.employee_no then
    new.employee_no := new.employee_id;
  elsif tg_op = 'UPDATE' and new.employee_no is distinct from old.employee_no then
    new.employee_id := new.employee_no;
  else
    new.employee_no := coalesce(nullif(btrim(new.employee_no), ''), nullif(btrim(new.employee_id), ''));
    new.employee_id := coalesce(nullif(btrim(new.employee_id), ''), new.employee_no);
  end if;

  if tg_op = 'UPDATE' and new.credits is distinct from old.credits
     and new.credit_balance is not distinct from old.credit_balance then
    new.credit_balance := new.credits;
  elsif tg_op = 'UPDATE' and new.credit_balance is distinct from old.credit_balance then
    new.credits := new.credit_balance;
  else
    new.credit_balance := coalesce(new.credit_balance, new.credits, 0);
    new.credits := new.credit_balance;
  end if;

  if new.password_hash is null and new.password is not null then
    new.password_hash := case when new.password like '$2%' then new.password else crypt(new.password, gen_salt('bf', 10)) end;
  end if;
  if new.password is null then new.password := new.password_hash; end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists zip_market_participant_compat_trg on public.participants;
create trigger zip_market_participant_compat_trg
before insert or update on public.participants
for each row execute function public.zip_market_sync_participant_compat();

-- ---------------------------------------------------------------------------
-- 2. Remove only old ZIP! MARKET overloads whose argument names/return types
--    may conflict with PostgREST. No tables or rows are dropped.
-- ---------------------------------------------------------------------------
drop function if exists public.zip_auth_admin(text, text);
drop function if exists public.zip_auth_participant(text, text);
drop function if exists public.zip_market_initialize_admin(text);
drop function if exists public.zip_market_auth_admin(text, text);
drop function if exists public.zip_market_auth_participant(text, text);
drop function if exists public.zip_market_admin_create_participant(text, text, text, integer);
drop function if exists public.zip_market_admin_create_participants(jsonb);
drop function if exists public.zip_market_set_admin_password(text);
drop function if exists public.zip_market_grant_credit(uuid, integer, text);
drop function if exists public.zip_market_pay_credit(uuid, integer, text);
drop function if exists public.zip_market_pay_credit(uuid, integer, text, text);
drop function if exists public.zip_market_complete_game(uuid, uuid);
drop function if exists public.zip_market_complete_game(uuid, text);

-- ---------------------------------------------------------------------------
-- 3. Canonical RPC contract. Names, parameter names, types, and JSON shapes
--    match netlify/functions/api.mjs exactly.
-- ---------------------------------------------------------------------------
create function public.zip_market_initialize_admin(p_initial_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_created boolean := false;
begin
  if nullif(btrim(p_initial_password), '') is null then
    raise exception 'INITIAL_ADMIN_PASSWORD_REQUIRED' using errcode = '22023';
  end if;

  insert into public.app_settings(key, value, updated_at)
  values ('admin_password', crypt(p_initial_password, gen_salt('bf', 10)), now())
  on conflict (key) do nothing;
  v_created := found;

  return jsonb_build_object('initialized', true, 'createdNow', v_created);
end;
$$;

create function public.zip_market_auth_admin(p_initial_password text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_stored text;
  v_valid boolean := false;
begin
  perform public.zip_market_initialize_admin(p_initial_password);
  select value into v_stored
    from public.app_settings
   where key = 'admin_password'
   for update;

  if v_stored is not null then
    if v_stored like '$2%' then
      v_valid := crypt(coalesce(p_password, ''), v_stored) = v_stored;
    else
      v_valid := coalesce(p_password, '') = v_stored;
    end if;
  end if;

  -- INITIAL_ADMIN_PASSWORD is bootstrap-only. Never use it as a permanent
  -- recovery password: doing so would undo a password changed in the admin UI.
  if v_valid and v_stored not like '$2%' then
    update public.app_settings
       set value = crypt(p_password, gen_salt('bf', 10)), updated_at = now()
     where key = 'admin_password';
  end if;

  return jsonb_build_object('authenticated', v_valid);
end;
$$;

create function public.zip_market_auth_participant(p_employee_no text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_person public.participants%rowtype;
  v_valid boolean := false;
begin
  select * into v_person
    from public.participants
   where employee_no = btrim(p_employee_no)
   limit 1;

  if v_person.id is not null and v_person.password_hash is not null then
    if v_person.password_hash like '$2%' then
      v_valid := crypt(coalesce(p_password, ''), v_person.password_hash) = v_person.password_hash;
    else
      v_valid := coalesce(p_password, '') = v_person.password_hash;
    end if;
  end if;

  if not v_valid then
    return jsonb_build_object('authenticated', false);
  end if;

  return jsonb_build_object(
    'authenticated', true,
    'participant', jsonb_build_object(
      'id', v_person.id,
      'employee_no', v_person.employee_no,
      'name', v_person.name,
      'credit_balance', v_person.credit_balance
    )
  );
end;
$$;

create function public.zip_market_admin_create_participant(
  p_employee_no text,
  p_name text,
  p_password text,
  p_initial_credit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_person public.participants%rowtype;
  v_opening integer := greatest(coalesce(p_initial_credit, 0), 0);
  v_hash text;
begin
  if nullif(btrim(p_employee_no), '') is null
     or nullif(btrim(p_name), '') is null
     or nullif(p_password, '') is null then
    raise exception 'PARTICIPANT_FIELDS_REQUIRED' using errcode = '22023';
  end if;

  v_hash := crypt(p_password, gen_salt('bf', 10));
  insert into public.participants(
    employee_no, employee_id, name, password_hash, password,
    credit_balance, credits, created_at, updated_at
  ) values (
    btrim(p_employee_no), btrim(p_employee_no), btrim(p_name), v_hash, v_hash,
    v_opening, v_opening, now(), now()
  ) returning * into v_person;

  if v_opening > 0 then
    insert into public.transactions(
      participant_id, amount, kind, type, label, description,
      balance_after, reference, created_at
    ) values (
      v_person.id, v_opening, 'initial', 'adjustment', '초기 크레딧', '초기 크레딧',
      v_opening, 'initial:' || v_person.id::text, now()
    );
  end if;

  return to_jsonb(v_person) - 'password_hash' - 'password';
exception
  when unique_violation then
    raise exception 'EMPLOYEE_NO_ALREADY_EXISTS' using errcode = '23505';
end;
$$;

-- Atomic Excel/bulk registration. Every row is validated before the first
-- insert. Any duplicate/race/database error aborts the whole RPC transaction,
-- so no partial participant set is left behind.
create function public.zip_market_admin_create_participants(p_participants jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_item jsonb;
  v_row integer := 0;
  v_employee_no text;
  v_name text;
  v_password text;
  v_initial_credit integer;
  v_seen text[] := array[]::text[];
  v_created jsonb := '[]'::jsonb;
  v_person jsonb;
begin
  if p_participants is null or jsonb_typeof(p_participants) <> 'array'
     or jsonb_array_length(p_participants) = 0
     or jsonb_array_length(p_participants) > 500 then
    raise exception 'BULK_DATA_REQUIRED' using errcode = '22023';
  end if;

  -- Pass 1: validate every row and all duplicates before writing anything.
  for v_item in select value from jsonb_array_elements(p_participants)
  loop
    v_row := v_row + 1;
    v_employee_no := btrim(coalesce(v_item->>'employeeNo', ''));
    v_name := btrim(coalesce(v_item->>'name', ''));
    v_password := coalesce(v_item->>'password', '');
    begin
      v_initial_credit := coalesce(nullif(v_item->>'initialCredit', '')::integer, 0);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'ROW_%: INVALID_INITIAL_CREDIT', v_row using errcode = '22023';
    end;

    if v_employee_no = '' then raise exception 'ROW_%: EMPLOYEE_NO_REQUIRED', v_row using errcode = '22023'; end if;
    if v_name = '' then raise exception 'ROW_%: NAME_REQUIRED', v_row using errcode = '22023'; end if;
    if v_password = '' then raise exception 'ROW_%: PASSWORD_REQUIRED', v_row using errcode = '22023'; end if;
    if v_initial_credit < 0 then raise exception 'ROW_%: INVALID_INITIAL_CREDIT', v_row using errcode = '22023'; end if;
    if v_employee_no = any(v_seen) then raise exception 'ROW_%: DUPLICATE_EMPLOYEE_NO_IN_FILE (%)', v_row, v_employee_no using errcode = '23505'; end if;
    if exists (select 1 from public.participants where employee_no = v_employee_no or employee_id = v_employee_no) then
      raise exception 'ROW_%: EMPLOYEE_NO_ALREADY_EXISTS (%)', v_row, v_employee_no using errcode = '23505';
    end if;
    v_seen := array_append(v_seen, v_employee_no);
  end loop;

  -- Pass 2: all rows are valid; create them in one database transaction.
  v_row := 0;
  for v_item in select value from jsonb_array_elements(p_participants)
  loop
    v_row := v_row + 1;
    begin
      v_person := public.zip_market_admin_create_participant(
        btrim(v_item->>'employeeNo'),
        btrim(v_item->>'name'),
        v_item->>'password',
        coalesce(nullif(v_item->>'initialCredit', '')::integer, 0)
      );
    exception when unique_violation then
      raise exception 'ROW_%: EMPLOYEE_NO_ALREADY_EXISTS (%)', v_row, v_item->>'employeeNo' using errcode = '23505';
    end;
    v_created := v_created || jsonb_build_array(jsonb_build_object(
      'row', v_row,
      'employeeNo', v_item->>'employeeNo',
      'participant', v_person
    ));
  end loop;

  return jsonb_build_object('createdCount', v_row, 'results', v_created);
exception
  when unique_violation then
    if sqlerrm like 'ROW_%' then raise; end if;
    raise exception 'EMPLOYEE_NO_ALREADY_EXISTS' using errcode = '23505';
end;
$$;

create function public.zip_market_set_admin_password(p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  if length(coalesce(p_password, '')) < 4 then
    raise exception 'PASSWORD_TOO_SHORT' using errcode = '22023';
  end if;
  insert into public.app_settings(key, value, updated_at)
  values ('admin_password', crypt(p_password, gen_salt('bf', 10)), now())
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at;
  return jsonb_build_object('updated', true);
end;
$$;

create function public.zip_market_grant_credit(
  p_participant_id uuid,
  p_amount integer,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_balance integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;

  update public.participants
     set credit_balance = credit_balance + p_amount,
         credits = credit_balance + p_amount,
         updated_at = now()
   where id = p_participant_id
   returning credit_balance into v_balance;
  if v_balance is null then raise exception 'PARTICIPANT_NOT_FOUND' using errcode = 'P0002'; end if;

  insert into public.transactions(participant_id, amount, kind, type, label, description, balance_after, reference, created_at)
  values (p_participant_id, p_amount, 'credit', 'adjustment', coalesce(nullif(p_description, ''), '관리자 지급'), coalesce(nullif(p_description, ''), '관리자 지급'), v_balance, 'grant:' || gen_random_uuid()::text, now());
  return jsonb_build_object('ok', true, 'balance', v_balance);
end;
$$;

create function public.zip_market_pay_credit(
  p_participant_id uuid,
  p_amount integer,
  p_description text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_balance integer;
  v_reference text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;

  -- Serialize payments for a participant and make each browser confirmation
  -- idempotent. A timeout/retry can no longer charge the same request twice.
  perform 1 from public.participants where id = p_participant_id for update;
  if not found then raise exception 'PARTICIPANT_NOT_FOUND' using errcode = 'P0002'; end if;

  v_reference := 'pay:' || coalesce(nullif(btrim(p_request_id), ''), gen_random_uuid()::text);
  select credit_balance into v_balance from public.participants where id = p_participant_id;
  if exists (
    select 1 from public.transactions
     where participant_id = p_participant_id and reference = v_reference
  ) then
    return jsonb_build_object('ok', true, 'idempotent', true, 'balance', v_balance);
  end if;

  update public.participants
     set credit_balance = credit_balance - p_amount,
         credits = credit_balance - p_amount,
         updated_at = now()
   where id = p_participant_id and credit_balance >= p_amount
   returning credit_balance into v_balance;
  if v_balance is null then raise exception 'INSUFFICIENT_CREDIT' using errcode = 'P0001'; end if;

  insert into public.transactions(participant_id, amount, kind, type, label, description, balance_after, reference, created_at)
  values (p_participant_id, -p_amount, 'payment', 'payment', coalesce(nullif(p_description, ''), '크레딧 결제'), coalesce(nullif(p_description, ''), '크레딧 결제'), v_balance, v_reference, now());
  return jsonb_build_object('ok', true, 'idempotent', false, 'balance', v_balance);
end;
$$;

create function public.zip_market_complete_game(
  p_participant_id uuid,
  p_game_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_game public.games%rowtype;
  v_reward integer;
  v_balance integer;
  v_inserted integer;
begin
  -- Legacy installations use readable text IDs such as "balloon", while new
  -- installations use UUIDs. Comparing as text and inserting v_game.id keeps
  -- both schemas valid without converting or deleting existing game rows.
  select * into v_game
    from public.games where id::text = btrim(p_game_id)
    limit 1;
  if not found then raise exception 'GAME_NOT_FOUND' using errcode = 'P0002'; end if;
  v_reward := greatest(coalesce(v_game.reward, 0), 0);

  perform 1 from public.participants where id = p_participant_id for update;
  if not found then raise exception 'PARTICIPANT_NOT_FOUND' using errcode = 'P0002'; end if;

  insert into public.game_completions(
    participant_id, game_id, rewarded_amount, created_at, completed_at
  ) values (
    p_participant_id, v_game.id, v_reward, now(), now()
  ) on conflict (participant_id, game_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then raise exception 'ALREADY_COMPLETED' using errcode = '23505'; end if;

  update public.participants
     set credit_balance = credit_balance + v_reward,
         credits = credit_balance + v_reward,
         updated_at = now()
   where id = p_participant_id
   returning credit_balance into v_balance;

  if v_reward > 0 then
    insert into public.transactions(participant_id, amount, kind, type, label, description, balance_after, reference, created_at)
    values (p_participant_id, v_reward, 'game', 'adjustment', v_game.name || ' 완료 보상', v_game.name || ' 완료 보상', v_balance, 'game:' || v_game.id::text, now());
  end if;

  return jsonb_build_object('ok', true, 'gameId', v_game.id::text, 'reward', v_reward, 'balance', v_balance);
end;
$$;

-- Compatibility aliases retained for older deployed Functions.
create function public.zip_auth_admin(p_initial_password text, p_password text)
returns jsonb
language sql
security definer
set search_path = public, extensions, pg_catalog
as $$ select public.zip_market_auth_admin(p_initial_password, p_password) $$;

create function public.zip_auth_participant(p_employee_no text, p_password text)
returns jsonb
language sql
security definer
set search_path = public, extensions, pg_catalog
as $$ select public.zip_market_auth_participant(p_employee_no, p_password) $$;

-- ---------------------------------------------------------------------------
-- 4. RLS and least-privilege grants
-- ---------------------------------------------------------------------------
alter table public.app_settings enable row level security;
alter table public.participants enable row level security;
alter table public.transactions enable row level security;
alter table public.games enable row level security;
alter table public.game_completions enable row level security;

revoke all on table public.app_settings, public.participants, public.transactions, public.games, public.game_completions from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.app_settings, public.participants, public.transactions, public.games, public.game_completions to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.zip_market_initialize_admin(text) from public, anon, authenticated;
revoke all on function public.zip_market_auth_admin(text, text) from public, anon, authenticated;
revoke all on function public.zip_market_auth_participant(text, text) from public, anon, authenticated;
revoke all on function public.zip_market_admin_create_participant(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.zip_market_admin_create_participants(jsonb) from public, anon, authenticated;
revoke all on function public.zip_market_set_admin_password(text) from public, anon, authenticated;
revoke all on function public.zip_market_grant_credit(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.zip_market_pay_credit(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.zip_market_complete_game(uuid, text) from public, anon, authenticated;
revoke all on function public.zip_auth_admin(text, text) from public, anon, authenticated;
revoke all on function public.zip_auth_participant(text, text) from public, anon, authenticated;

grant execute on function public.zip_market_initialize_admin(text) to service_role;
grant execute on function public.zip_market_auth_admin(text, text) to service_role;
grant execute on function public.zip_market_auth_participant(text, text) to service_role;
grant execute on function public.zip_market_admin_create_participant(text, text, text, integer) to service_role;
grant execute on function public.zip_market_admin_create_participants(jsonb) to service_role;
grant execute on function public.zip_market_set_admin_password(text) to service_role;
grant execute on function public.zip_market_grant_credit(uuid, integer, text) to service_role;
grant execute on function public.zip_market_pay_credit(uuid, integer, text, text) to service_role;
grant execute on function public.zip_market_complete_game(uuid, text) to service_role;
grant execute on function public.zip_auth_admin(text, text) to service_role;
grant execute on function public.zip_auth_participant(text, text) to service_role;

insert into public.app_settings(key, value, updated_at)
values ('schema_version', '8.6.0', now())
on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

-- ---------------------------------------------------------------------------
-- 5. Fail-fast installation verification before refreshing PostgREST
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text[];
  v_bad_return text[];
  v_bad_grant text[];
begin
  select array_agg(signature) into v_missing
  from (values
    ('public.zip_market_initialize_admin(text)'),
    ('public.zip_market_auth_admin(text,text)'),
    ('public.zip_market_auth_participant(text,text)'),
    ('public.zip_market_admin_create_participant(text,text,text,integer)'),
    ('public.zip_market_admin_create_participants(jsonb)'),
    ('public.zip_market_set_admin_password(text)'),
    ('public.zip_market_grant_credit(uuid,integer,text)'),
    ('public.zip_market_pay_credit(uuid,integer,text,text)'),
    ('public.zip_market_complete_game(uuid,text)')
  ) expected(signature)
  where to_regprocedure(signature) is null;
  if v_missing is not null then raise exception 'ZIP_MARKET_RPC_MISSING: %', v_missing; end if;

  select array_agg(signature) into v_bad_return
  from (values
    ('public.zip_market_initialize_admin(text)'),
    ('public.zip_market_auth_admin(text,text)'),
    ('public.zip_market_auth_participant(text,text)'),
    ('public.zip_market_admin_create_participant(text,text,text,integer)'),
    ('public.zip_market_admin_create_participants(jsonb)'),
    ('public.zip_market_set_admin_password(text)'),
    ('public.zip_market_grant_credit(uuid,integer,text)'),
    ('public.zip_market_pay_credit(uuid,integer,text,text)'),
    ('public.zip_market_complete_game(uuid,text)')
  ) expected(signature)
  where pg_get_function_result(to_regprocedure(signature)) <> 'jsonb';
  if v_bad_return is not null then raise exception 'ZIP_MARKET_RPC_RETURN_MISMATCH: %', v_bad_return; end if;

  select array_agg(signature) into v_bad_grant
  from (values
    ('public.zip_market_initialize_admin(text)'),
    ('public.zip_market_auth_admin(text,text)'),
    ('public.zip_market_auth_participant(text,text)'),
    ('public.zip_market_admin_create_participant(text,text,text,integer)'),
    ('public.zip_market_admin_create_participants(jsonb)'),
    ('public.zip_market_set_admin_password(text)'),
    ('public.zip_market_grant_credit(uuid,integer,text)'),
    ('public.zip_market_pay_credit(uuid,integer,text,text)'),
    ('public.zip_market_complete_game(uuid,text)')
  ) expected(signature)
  where not has_function_privilege('service_role', to_regprocedure(signature), 'EXECUTE')
     or has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE')
     or has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE');
  if v_bad_grant is not null then raise exception 'ZIP_MARKET_RPC_PRIVILEGE_MISMATCH: %', v_bad_grant; end if;
end;
$$;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

select key, value, updated_at
from public.app_settings
where key = 'schema_version';

select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as returns,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'zip_market_initialize_admin',
    'zip_market_auth_admin',
    'zip_market_auth_participant',
    'zip_market_admin_create_participant',
    'zip_market_admin_create_participants',
    'zip_market_set_admin_password',
    'zip_market_grant_credit',
    'zip_market_pay_credit',
    'zip_market_complete_game'
  )
order by p.proname;
