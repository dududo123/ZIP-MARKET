-- ZIP! MARKET 5.0 database schema
-- Supabase > SQL Editor에서 한 번 실행하세요. 기존 데이터는 삭제하지 않습니다.
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

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  amount integer not null,
  type text not null check (type in ('grant','payment','adjustment')),
  description text not null default '',
  reference text,
  created_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_url text not null default '/assets/game-default.webp',
  created_at timestamptz not null default now()
);

create table if not exists public.game_completions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(participant_id, game_id)
);

-- 이미 이전 ZIP! MARKET 스키마를 사용 중인 경우 새 버전에 필요한 열만 보강합니다.
alter table public.participants add column if not exists updated_at timestamptz not null default now();
alter table public.transactions add column if not exists reference text;
alter table public.games add column if not exists image_url text not null default '/assets/game-default.webp';

create index if not exists transactions_participant_created_idx on public.transactions(participant_id, created_at desc);
create index if not exists completions_participant_idx on public.game_completions(participant_id);

-- 서버의 Secret key/service_role만 데이터에 접근합니다.
revoke all on table public.app_settings, public.participants, public.transactions, public.games, public.game_completions from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.app_settings, public.participants, public.transactions, public.games, public.game_completions to service_role;

alter table public.app_settings enable row level security;
alter table public.participants enable row level security;
alter table public.transactions enable row level security;
alter table public.games enable row level security;
alter table public.game_completions enable row level security;

-- 크레딧 차감과 거래내역 기록을 하나의 트랜잭션으로 처리합니다.
create or replace function public.zip_market_redeem_credit(
  p_participant_id uuid,
  p_amount integer,
  p_description text,
  p_reference text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_balance integer;
begin
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  update public.participants
     set credit_balance = credit_balance - p_amount, updated_at = now()
   where id = p_participant_id and credit_balance >= p_amount
   returning credit_balance into v_balance;
  if v_balance is null then raise exception 'INSUFFICIENT_CREDIT'; end if;
  insert into public.transactions(participant_id, amount, type, description, reference)
  values (p_participant_id, -p_amount, 'payment', coalesce(p_description,'크레딧 결제'), p_reference);
  return v_balance;
end; $$;

grant execute on function public.zip_market_redeem_credit(uuid,integer,text,text) to service_role;
