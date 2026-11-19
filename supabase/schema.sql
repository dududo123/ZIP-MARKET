-- ZIP! MARKET v7 — 기존 데이터를 지우지 않는 멱등 스키마
create extension if not exists pgcrypto;

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null unique,
  name text not null,
  password_hash text not null,
  credits integer not null default 0 check (credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_url text,
  reward integer not null default 100 check (reward >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  type text not null check (type in ('payment','award','game_reward','adjustment')),
  amount integer not null,
  balance_after integer not null check (balance_after >= 0),
  description text not null default '',
  reference text,
  created_at timestamptz not null default now()
);

create table if not exists public.game_completions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  rewarded_amount integer not null default 0,
  created_at timestamptz not null default now(),
  unique (participant_id, game_id)
);

create unique index if not exists transactions_participant_reference_uidx
  on public.transactions(participant_id, reference) where reference is not null;
create index if not exists transactions_participant_created_idx
  on public.transactions(participant_id, created_at desc);
create index if not exists completions_participant_idx
  on public.game_completions(participant_id);

alter table public.app_settings enable row level security;
alter table public.participants enable row level security;
alter table public.games enable row level security;
alter table public.transactions enable row level security;
alter table public.game_completions enable row level security;

create or replace function public.zip_process_payment(
  p_participant_id uuid,
  p_amount integer,
  p_reference text,
  p_description text default '크레딧 결제'
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_balance integer;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_reference is null or length(trim(p_reference)) = 0 then raise exception 'INVALID_REFERENCE'; end if;
  if exists(select 1 from transactions where participant_id=p_participant_id and reference=p_reference) then
    raise exception 'DUPLICATE_PAYMENT';
  end if;
  select credits into v_balance from participants where id=p_participant_id for update;
  if not found then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  if v_balance < p_amount then raise exception 'INSUFFICIENT_CREDIT'; end if;
  v_balance := v_balance - p_amount;
  update participants set credits=v_balance, updated_at=now() where id=p_participant_id;
  insert into transactions(participant_id,type,amount,balance_after,description,reference)
    values(p_participant_id,'payment',-p_amount,v_balance,coalesce(p_description,'크레딧 결제'),p_reference);
  return jsonb_build_object('balance',v_balance);
end $$;

create or replace function public.zip_complete_game(
  p_participant_id uuid,
  p_game_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_balance integer; v_reward integer; v_name text;
begin
  select reward,name into v_reward,v_name from games where id=p_game_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  perform 1 from participants where id=p_participant_id for update;
  if not found then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  if exists(select 1 from game_completions where participant_id=p_participant_id and game_id=p_game_id) then
    raise exception 'ALREADY_COMPLETED';
  end if;
  update participants set credits=credits+v_reward, updated_at=now() where id=p_participant_id returning credits into v_balance;
  insert into game_completions(participant_id,game_id,rewarded_amount) values(p_participant_id,p_game_id,v_reward);
  insert into transactions(participant_id,type,amount,balance_after,description,reference)
    values(p_participant_id,'game_reward',v_reward,v_balance,v_name || ' 완료 보상','game:' || p_game_id::text);
  return jsonb_build_object('balance',v_balance,'reward',v_reward,'game',v_name);
end $$;

create or replace function public.zip_adjust_credit(
  p_participant_id uuid,
  p_amount integer,
  p_description text default '관리자 크레딧 지급',
  p_reference text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_balance integer; v_ref text;
begin
  if p_amount is null or p_amount = 0 then raise exception 'INVALID_AMOUNT'; end if;
  select credits into v_balance from participants where id=p_participant_id for update;
  if not found then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  if v_balance + p_amount < 0 then raise exception 'INSUFFICIENT_CREDIT'; end if;
  v_balance := v_balance + p_amount;
  v_ref := coalesce(p_reference,'adjust:' || gen_random_uuid()::text);
  update participants set credits=v_balance, updated_at=now() where id=p_participant_id;
  insert into transactions(participant_id,type,amount,balance_after,description,reference)
    values(p_participant_id,case when p_amount > 0 then 'award' else 'adjustment' end,p_amount,v_balance,coalesce(p_description,'관리자 크레딧 조정'),v_ref);
  return jsonb_build_object('balance',v_balance);
end $$;

-- 비밀번호 검증과 해시는 DB의 pgcrypto에서 처리합니다. 따라서 Netlify Function에는
-- bcrypt나 Supabase JS SDK가 필요 없고, 기존 $2a/$2b bcrypt 해시도 그대로 호환됩니다.
create or replace function public.zip_initialize_admin(p_initial_password text)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_initial_password is null or length(p_initial_password) = 0 then
    raise exception 'INITIAL_ADMIN_PASSWORD_REQUIRED';
  end if;
  insert into app_settings(key,value,updated_at)
    values('admin_password', crypt(p_initial_password, gen_salt('bf', 10)), now())
    on conflict (key) do nothing;
  return true;
end $$;

create or replace function public.zip_auth_admin(p_password text, p_initial_password text)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_stored text; v_valid boolean := false;
begin
  perform zip_initialize_admin(p_initial_password);
  select value into v_stored from app_settings where key='admin_password' for update;
  if v_stored like '$2%' then
    v_valid := crypt(p_password, v_stored) = v_stored;
  else
    v_valid := p_password = v_stored;
    if v_valid then
      update app_settings set value=crypt(p_password,gen_salt('bf',10)),updated_at=now() where key='admin_password';
    end if;
  end if;
  -- 과거 DB 해시와 현재 Netlify 환경변수가 어긋나도 현재 초기 암호로 자동 복구합니다.
  if not v_valid and p_password = p_initial_password then
    update app_settings set value=crypt(p_password,gen_salt('bf',10)),updated_at=now() where key='admin_password';
    v_valid := true;
  end if;
  return v_valid;
end $$;

create or replace function public.zip_set_admin_password(p_password text)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_password is null or length(p_password) < 4 then raise exception 'PASSWORD_TOO_SHORT'; end if;
  insert into app_settings(key,value,updated_at)
    values('admin_password',crypt(p_password,gen_salt('bf',10)),now())
    on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
  return true;
end $$;

create or replace function public.zip_auth_participant(p_employee_id text, p_password text)
returns table(id uuid)
language sql security definer set search_path = public, extensions
as $$
  select p.id
  from participants p
  where p.employee_id = p_employee_id
    and (
      (p.password_hash like '$2%' and crypt(p_password,p.password_hash)=p.password_hash)
      or (p.password_hash not like '$2%' and p.password_hash=p_password)
    )
  limit 1
$$;

create or replace function public.zip_create_participants(p_participants jsonb)
returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare v_item jsonb; v_count integer := 0;
begin
  if jsonb_typeof(p_participants) <> 'array' then raise exception 'INVALID_PARTICIPANTS'; end if;
  for v_item in select * from jsonb_array_elements(p_participants)
  loop
    insert into participants(employee_id,name,password_hash,credits)
      values(
        trim(v_item->>'employeeId'),
        trim(v_item->>'name'),
        crypt(v_item->>'password',gen_salt('bf',10)),
        coalesce((v_item->>'credits')::integer,0)
      );
    v_count := v_count + 1;
  end loop;
  return v_count;
exception when unique_violation then
  raise exception 'DUPLICATE_EMPLOYEE_ID';
end $$;

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to service_role;
grant select,insert,update,delete on public.app_settings, public.participants, public.games, public.transactions, public.game_completions to service_role;
grant execute on function public.zip_process_payment(uuid,integer,text,text) to service_role;
grant execute on function public.zip_complete_game(uuid,uuid) to service_role;
grant execute on function public.zip_adjust_credit(uuid,integer,text,text) to service_role;
grant execute on function public.zip_initialize_admin(text) to service_role;
grant execute on function public.zip_auth_admin(text,text) to service_role;
grant execute on function public.zip_set_admin_password(text) to service_role;
grant execute on function public.zip_auth_participant(text,text) to service_role;
grant execute on function public.zip_create_participants(jsonb) to service_role;
