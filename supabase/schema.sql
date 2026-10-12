-- LG 트윈스 AI 제구 예측 플랫폼 — Supabase(PostgreSQL) 스키마
-- 실행: Supabase Dashboard → SQL Editor 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
-- 원칙: DEMO(합성)와 REAL(실데이터)은 별도 테이블 + CHECK 제약으로 물리적으로 분리한다.
--       RLS 활성화 + 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(service_role)만 접근한다.

create table if not exists public.pitches_demo (
  pitch_id      text primary key,
  pitcher_id    text not null,
  game_id       text not null,
  game_date     date not null,
  pitch_type    text not null check (pitch_type in ('FF','SL','CB','CH','FK')),
  velocity      real not null check (velocity between 60 and 170),
  pitch_count   int  not null check (pitch_count between 1 and 200),
  fatigue       real not null check (fatigue between 0 and 1.5),
  target_zone   int  check (target_zone between 1 and 9),
  target_x      real not null,
  target_y      real not null,
  actual_x      real not null,
  actual_y      real not null,
  balls         int  not null check (balls between 0 and 3),
  strikes       int  not null check (strikes between 0 and 2),
  batter_hand   text not null check (batter_hand in ('L','R')),
  pitcher_hand  text check (pitcher_hand in ('L','R')),
  miss_distance real not null,
  success       boolean not null,
  in_zone       boolean,
  data_source   text not null default 'DEMO' check (data_source = 'DEMO'),
  is_demo       boolean not null default true check (is_demo = true)
);
create index if not exists pitches_demo_pitcher_idx on public.pitches_demo (pitcher_id, game_date);

create table if not exists public.upload_batches (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  filename      text,
  data_source   text not null default 'REAL' check (data_source = 'REAL'),
  rows_in       int,
  rows_ok       int,
  rows_rejected int,
  mapping       jsonb
);

create table if not exists public.pitches_real (
  pitch_id      text primary key,
  batch_id      bigint references public.upload_batches(id) on delete set null,
  pitcher_id    text not null,
  game_id       text not null,
  game_date     date not null,
  pitch_type    text not null check (pitch_type in ('FF','SL','CB','CH','FK')),
  velocity      real not null check (velocity between 60 and 170),
  pitch_count   int  not null check (pitch_count between 1 and 200),
  fatigue       real not null check (fatigue between 0 and 1.5),
  target_x      real not null,
  target_y      real not null,
  actual_x      real not null,
  actual_y      real not null,
  balls         int  not null check (balls between 0 and 3),
  strikes       int  not null check (strikes between 0 and 2),
  batter_hand   text not null check (batter_hand in ('L','R')),
  pitcher_hand  text check (pitcher_hand in ('L','R')),
  miss_distance real not null,
  success       boolean not null,
  data_source   text not null default 'REAL' check (data_source = 'REAL')
);
create index if not exists pitches_real_pitcher_idx on public.pitches_real (pitcher_id, game_date);

create table if not exists public.training_runs (
  id            bigint generated always as identity primary key,
  version       text unique not null,
  trained_at    timestamptz not null,
  data_source   text not null check (data_source in ('DEMO','REAL','MIXED')),
  n_train       int, n_test int,
  roc_auc       real, brier real, ece real,
  notes         text
);

create table if not exists public.prediction_logs (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  pitcher_id    text, pitch_type text,
  inputs        jsonb, probability real,
  model_version text, data_source text
);

-- RLS: 정책을 만들지 않으므로 anon/authenticated 는 모든 접근이 차단된다. service_role 은 RLS 를 우회한다.
alter table public.pitches_demo     enable row level security;
alter table public.pitches_real     enable row level security;
alter table public.upload_batches   enable row level security;
alter table public.training_runs    enable row level security;
alter table public.prediction_logs  enable row level security;
