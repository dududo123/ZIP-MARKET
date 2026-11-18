create extension if not exists pgcrypto;

create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  employee_no text unique not null,
  name text not null,
  password_hash text not null,
  balance integer not null default 0 check (balance >= 0),
  spent integer not null default 0 check (spent >= 0),
  created_at timestamptz not null default now()
);

create table if not exists games (
  id text primary key,
  name text not null,
  reward integer not null check (reward > 0),
  image_url text,
  active boolean not null default true,
  builtin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  amount integer not null,
  kind text not null check (kind in ('initial','payment','game','admin','refund')),
  label text not null,
  ref_id text,
  created_at timestamptz not null default now()
);

create table if not exists game_completions (
  participant_id uuid not null references participants(id) on delete cascade,
  game_id text not null references games(id) on delete cascade,
  reward integer not null,
  completed_at timestamptz not null default now(),
  primary key (participant_id, game_id)
);

create or replace function pay_credit(p_user uuid, p_amount integer, p_label text)
returns table(balance integer, spent integer) language plpgsql security definer as $$
begin
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  update participants set balance=participants.balance-p_amount, spent=participants.spent+p_amount
  where id=p_user and participants.balance>=p_amount
  returning participants.balance, participants.spent into balance, spent;
  if not found then raise exception 'INSUFFICIENT_CREDIT'; end if;
  insert into transactions(participant_id,amount,kind,label) values(p_user,-p_amount,'payment',p_label);
  return next;
end $$;

create or replace function complete_game(p_user uuid, p_game text)
returns table(balance integer, reward integer, game_name text) language plpgsql security definer as $$
declare g games%rowtype;
begin
  select * into g from games where id=p_game and active=true;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  insert into game_completions(participant_id,game_id,reward) values(p_user,g.id,g.reward)
  on conflict do nothing;
  if not found then raise exception 'ALREADY_COMPLETED'; end if;
  update participants set balance=participants.balance+g.reward where id=p_user returning participants.balance into balance;
  insert into transactions(participant_id,amount,kind,label,ref_id) values(p_user,g.reward,'game',g.name||' 완료 보상',g.id);
  reward:=g.reward; game_name:=g.name; return next;
end $$;

insert into games(id,name,reward,image_url,builtin) values
('pingpong','탁구공 넣기',100,'/assets/game-pingpong.webp',true),
('balloon','풍선 튕기기',100,'/assets/game-balloon.webp',true),
('quiz','과제별 퀴즈',200,'/assets/game-quiz.webp',true)
on conflict(id) do nothing;
