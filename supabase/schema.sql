-- ZIP! MARKET v8 — 기존 V5 데이터와 열 이름을 유지하는 비파괴 호환 스키마
-- Supabase > SQL Editor에서 전체를 한 번 실행하세요. 기존 참가자·게임·내역은 삭제하지 않습니다.
create extension if not exists pgcrypto;

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
  image_url text not null default '/assets/game-default.webp?v=8',
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  amount integer not null,
  type text not null check (type in ('grant','payment','adjustment')),
  description text not null default '',
  reference text,
  created_at timestamptz not null default now()
);

create table if not exists public.game_completions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(participant_id, game_id)
);

-- 이전 스키마에 없는 선택 기능 열만 추가합니다.
alter table public.participants add column if not exists updated_at timestamptz not null default now();
alter table public.transactions add column if not exists reference text;
alter table public.games add column if not exists image_url text not null default '/assets/game-default.webp?v=8';
alter table public.games add column if not exists reward integer not null default 100 check (reward >= 0);
alter table public.game_completions add column if not exists rewarded_amount integer not null default 0;

create unique index if not exists transactions_participant_reference_uidx
  on public.transactions(participant_id, reference) where reference is not null;
create index if not exists transactions_participant_created_idx
  on public.transactions(participant_id, created_at desc);
create index if not exists completions_participant_idx
  on public.game_completions(participant_id);

-- 서버 Secret key/service_role만 직접 테이블에 접근합니다.
revoke all on table public.app_settings, public.participants, public.transactions, public.games, public.game_completions from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.app_settings, public.participants, public.transactions, public.games, public.game_completions to service_role;

alter table public.app_settings enable row level security;
alter table public.participants enable row level security;
alter table public.transactions enable row level security;
alter table public.games enable row level security;
alter table public.game_completions enable row level security;

-- 결제: 잔액 변경과 내역 저장을 하나의 트랜잭션으로 처리합니다.
create or replace function public.zip_market_redeem_credit(
  p_participant_id uuid,
  p_amount integer,
  p_description text,
  p_reference text
) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_balance integer;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_reference is null or length(trim(p_reference)) = 0 then raise exception 'INVALID_REFERENCE'; end if;
  if exists(select 1 from transactions where participant_id=p_participant_id and reference=p_reference) then
    raise exception 'DUPLICATE_PAYMENT';
  end if;
  update participants
     set credit_balance=credit_balance-p_amount, updated_at=now()
   where id=p_participant_id and credit_balance>=p_amount
   returning credit_balance into v_balance;
  if v_balance is null then raise exception 'INSUFFICIENT_CREDIT'; end if;
  insert into transactions(participant_id,amount,type,description,reference)
  values(p_participant_id,-p_amount,'payment',coalesce(p_description,'크레딧 결제'),p_reference);
  return v_balance;
end $$;

-- 관리자 크레딧 조정
create or replace function public.zip_market_adjust_credit(
  p_participant_id uuid,
  p_amount integer,
  p_description text,
  p_reference text
) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_balance integer;
begin
  if p_amount is null or p_amount=0 then raise exception 'INVALID_AMOUNT'; end if;
  update participants
     set credit_balance=credit_balance+p_amount, updated_at=now()
   where id=p_participant_id and credit_balance+p_amount>=0
   returning credit_balance into v_balance;
  if v_balance is null then raise exception 'INSUFFICIENT_CREDIT'; end if;
  insert into transactions(participant_id,amount,type,description,reference)
  values(p_participant_id,p_amount,case when p_amount>0 then 'grant' else 'adjustment' end,
         coalesce(p_description,'관리자 크레딧 조정'),p_reference);
  return v_balance;
end $$;

-- 게임 완료: 중복 완료 방지, 보상 및 내역 저장
create or replace function public.zip_market_complete_game(
  p_participant_id uuid,
  p_game_id uuid
) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_reward integer; v_balance integer; v_name text;
begin
  select reward,name into v_reward,v_name from games where id=p_game_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  if exists(select 1 from game_completions where participant_id=p_participant_id and game_id=p_game_id) then
    raise exception 'ALREADY_COMPLETED';
  end if;
  insert into game_completions(participant_id,game_id,rewarded_amount)
  values(p_participant_id,p_game_id,v_reward);
  update participants set credit_balance=credit_balance+v_reward,updated_at=now()
   where id=p_participant_id returning credit_balance into v_balance;
  if v_balance is null then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  if v_reward>0 then
    insert into transactions(participant_id,amount,type,description,reference)
    values(p_participant_id,v_reward,'grant',v_name || ' 완료 보상','game:' || p_game_id::text);
  end if;
  return v_balance;
end $$;

grant execute on function public.zip_market_redeem_credit(uuid,integer,text,text) to service_role;
grant execute on function public.zip_market_adjust_credit(uuid,integer,text,text) to service_role;
grant execute on function public.zip_market_complete_game(uuid,uuid) to service_role;

-- 기존 bcrypt 비밀번호 검증과 참가자 등록. Netlify에는 네이티브 모듈이 필요 없습니다.
create or replace function public.zip_market_initialize_admin(p_initial_password text)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_initial_password is null or length(p_initial_password)=0 then
    raise exception 'INITIAL_ADMIN_PASSWORD_REQUIRED';
  end if;
  insert into app_settings(key,value,updated_at)
  values('admin_password',crypt(p_initial_password,gen_salt('bf',10)),now())
  on conflict(key) do nothing;
  return true;
end $$;

create or replace function public.zip_market_auth_admin(p_password text, p_initial_password text)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_stored text; v_valid boolean := false;
begin
  perform zip_market_initialize_admin(p_initial_password);
  select value into v_stored from app_settings where key='admin_password' for update;
  if v_stored like '$2%' then
    v_valid := crypt(p_password,v_stored)=v_stored;
  else
    v_valid := p_password=v_stored;
  end if;
  if not v_valid and p_password=p_initial_password then
    update app_settings set value=crypt(p_password,gen_salt('bf',10)),updated_at=now()
    where key='admin_password';
    v_valid := true;
  elsif v_valid and v_stored not like '$2%' then
    update app_settings set value=crypt(p_password,gen_salt('bf',10)),updated_at=now()
    where key='admin_password';
  end if;
  return v_valid;
end $$;

create or replace function public.zip_market_set_admin_password(p_password text)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_password is null or length(p_password)<4 then raise exception 'PASSWORD_TOO_SHORT'; end if;
  insert into app_settings(key,value,updated_at)
  values('admin_password',crypt(p_password,gen_salt('bf',10)),now())
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
  return true;
end $$;

create or replace function public.zip_market_auth_participant(p_employee_no text, p_password text)
returns table(id uuid)
language sql security definer set search_path = public, extensions
as $$
  select p.id
  from participants p
  where p.employee_no=p_employee_no
    and ((p.password_hash like '$2%' and crypt(p_password,p.password_hash)=p.password_hash)
         or (p.password_hash not like '$2%' and p.password_hash=p_password))
  limit 1
$$;

create or replace function public.zip_market_create_participants(p_participants jsonb)
returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare v_item jsonb; v_count integer := 0;
begin
  if jsonb_typeof(p_participants)<>'array' then raise exception 'INVALID_PARTICIPANTS'; end if;
  for v_item in select * from jsonb_array_elements(p_participants)
  loop
    insert into participants(employee_no,name,password_hash,credit_balance)
    values(trim(v_item->>'employeeNo'),trim(v_item->>'name'),
           crypt(v_item->>'password',gen_salt('bf',10)),coalesce((v_item->>'credits')::integer,0));
    v_count := v_count+1;
  end loop;
  return v_count;
exception when unique_violation then
  raise exception 'DUPLICATE_EMPLOYEE_ID';
end $$;

grant execute on function public.zip_market_initialize_admin(text) to service_role;
grant execute on function public.zip_market_auth_admin(text,text) to service_role;
grant execute on function public.zip_market_set_admin_password(text) to service_role;
grant execute on function public.zip_market_auth_participant(text,text) to service_role;
grant execute on function public.zip_market_create_participants(jsonb) to service_role;


-- 모든 security definer 함수는 브라우저 역할에서 직접 실행할 수 없게 제한합니다.
revoke all on function public.zip_market_redeem_credit(uuid,integer,text,text) from public, anon, authenticated;
revoke all on function public.zip_market_adjust_credit(uuid,integer,text,text) from public, anon, authenticated;
revoke all on function public.zip_market_complete_game(uuid,uuid) from public, anon, authenticated;
revoke all on function public.zip_market_initialize_admin(text) from public, anon, authenticated;
revoke all on function public.zip_market_auth_admin(text,text) from public, anon, authenticated;
revoke all on function public.zip_market_set_admin_password(text) from public, anon, authenticated;
revoke all on function public.zip_market_auth_participant(text,text) from public, anon, authenticated;
revoke all on function public.zip_market_create_participants(jsonb) from public, anon, authenticated;

grant execute on function public.zip_market_redeem_credit(uuid,integer,text,text) to service_role;
grant execute on function public.zip_market_adjust_credit(uuid,integer,text,text) to service_role;
grant execute on function public.zip_market_complete_game(uuid,uuid) to service_role;
grant execute on function public.zip_market_initialize_admin(text) to service_role;
grant execute on function public.zip_market_auth_admin(text,text) to service_role;
grant execute on function public.zip_market_set_admin_password(text) to service_role;
grant execute on function public.zip_market_auth_participant(text,text) to service_role;
grant execute on function public.zip_market_create_participants(jsonb) to service_role;
