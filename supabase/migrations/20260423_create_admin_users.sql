-- Admin users table
-- An "admin" is a regular Supabase auth user whose user_id exists in this table.
-- Only the service-role key (server-side) can read/write this table.
-- To add an admin: INSERT INTO public.admin_users (user_id, email) VALUES ('<auth.users.id>', '<email>');

create table if not exists public.admin_users (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  email       text not null,
  created_at  timestamptz not null default timezone('utc', now())
);

alter table public.admin_users enable row level security;

-- No public policies — only service-role key can access this table.
-- This prevents regular users from ever seeing or modifying admin_users.
