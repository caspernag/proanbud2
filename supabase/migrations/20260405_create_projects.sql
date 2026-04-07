create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null unique,
  title text not null,
  location text,
  project_type text,
  area_sqm integer,
  finish_level text,
  budget_nok integer,
  description text,
  preview_summary jsonb not null default '{}'::jsonb,
  material_list jsonb not null default '[]'::jsonb,
  price_nok integer not null default 390,
  payment_status text not null default 'locked' check (payment_status in ('locked', 'paid')),
  stripe_checkout_session_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.projects enable row level security;

create policy "Users can read own projects"
on public.projects
for select
using (auth.uid() = user_id);

create policy "Users can insert own projects"
on public.projects
for insert
with check (auth.uid() = user_id);

create policy "Users can update own projects"
on public.projects
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.set_project_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;

create trigger projects_set_updated_at
before update on public.projects
for each row
execute procedure public.set_project_updated_at();
