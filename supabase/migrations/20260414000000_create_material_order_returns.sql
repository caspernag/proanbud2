insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'material-return-docs',
  'material-return-docs',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'text/plain'
  ]
)
on conflict (id) do nothing;

create table if not exists public.material_order_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.material_orders(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  return_type text not null check (return_type in ('return', 'complaint')),
  reason_code text not null check (
    reason_code in (
      'wrong_item',
      'changed_mind',
      'damaged_in_transit',
      'defective',
      'missing_parts',
      'not_as_described',
      'other'
    )
  ),
  status text not null default 'submitted' check (
    status in (
      'submitted',
      'documents_received',
      'supplier_notified',
      'label_ready',
      'in_transit',
      'received',
      'reviewing',
      'resolved',
      'rejected'
    )
  ),
  preferred_resolution text not null default 'refund' check (
    preferred_resolution in ('refund', 'replacement', 'repair', 'other')
  ),
  resolution_type text check (resolution_type in ('refund', 'replacement', 'repair', 'other')),
  legal_basis text not null default 'forbrukerkjopsloven',
  supplier_key text check (supplier_key in ('byggmakker', 'monter_optimera', 'byggmax', 'xl_bygg')),
  supplier_label text,
  title text not null default '',
  description text not null default '',
  return_label_url text,
  carrier text,
  tracking_number text,
  supplier_case_reference text,
  refund_amount_nok integer,
  replacement_order_id uuid references public.material_orders(id) on delete set null,
  requested_at timestamptz not null default timezone('utc', now()),
  approved_at timestamptz,
  shipped_at timestamptz,
  received_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists material_order_returns_user_id_idx
on public.material_order_returns(user_id);

create index if not exists material_order_returns_order_id_idx
on public.material_order_returns(order_id);

create index if not exists material_order_returns_project_id_idx
on public.material_order_returns(project_id);

create index if not exists material_order_returns_status_idx
on public.material_order_returns(status);

create table if not exists public.material_order_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.material_order_returns(id) on delete cascade,
  order_item_id uuid references public.material_order_items(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_name text not null,
  quantity_value numeric(12, 3) not null default 1,
  quantity_unit text not null default 'stk',
  supplier_key text not null check (supplier_key in ('byggmakker', 'monter_optimera', 'byggmax', 'xl_bygg')),
  supplier_label text not null,
  supplier_sku text,
  reason_note text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists material_order_return_items_return_id_idx
on public.material_order_return_items(return_id);

create index if not exists material_order_return_items_user_id_idx
on public.material_order_return_items(user_id);

create table if not exists public.material_order_return_attachments (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.material_order_returns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  file_path text not null unique,
  file_name text not null,
  mime_type text not null,
  file_size_bytes integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists material_order_return_attachments_return_id_idx
on public.material_order_return_attachments(return_id);

create index if not exists material_order_return_attachments_user_id_idx
on public.material_order_return_attachments(user_id);

create table if not exists public.material_order_return_events (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.material_order_returns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists material_order_return_events_return_id_idx
on public.material_order_return_events(return_id);

create index if not exists material_order_return_events_user_id_idx
on public.material_order_return_events(user_id);

alter table public.material_order_returns enable row level security;
alter table public.material_order_return_items enable row level security;
alter table public.material_order_return_attachments enable row level security;
alter table public.material_order_return_events enable row level security;

drop policy if exists "Users can read own material order returns" on public.material_order_returns;
create policy "Users can read own material order returns"
on public.material_order_returns
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own material order returns" on public.material_order_returns;
create policy "Users can insert own material order returns"
on public.material_order_returns
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own material order returns" on public.material_order_returns;
create policy "Users can update own material order returns"
on public.material_order_returns
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can read own material order return items" on public.material_order_return_items;
create policy "Users can read own material order return items"
on public.material_order_return_items
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own material order return items" on public.material_order_return_items;
create policy "Users can insert own material order return items"
on public.material_order_return_items
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own material order return items" on public.material_order_return_items;
create policy "Users can update own material order return items"
on public.material_order_return_items
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can read own material order return attachments" on public.material_order_return_attachments;
create policy "Users can read own material order return attachments"
on public.material_order_return_attachments
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own material order return attachments" on public.material_order_return_attachments;
create policy "Users can insert own material order return attachments"
on public.material_order_return_attachments
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can read own material order return events" on public.material_order_return_events;
create policy "Users can read own material order return events"
on public.material_order_return_events
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own material order return events" on public.material_order_return_events;
create policy "Users can insert own material order return events"
on public.material_order_return_events
for insert
with check (auth.uid() = user_id);

drop trigger if exists material_order_returns_set_updated_at on public.material_order_returns;
create trigger material_order_returns_set_updated_at
before update on public.material_order_returns
for each row
execute procedure public.set_material_order_updated_at();

drop trigger if exists material_order_return_items_set_updated_at on public.material_order_return_items;
create trigger material_order_return_items_set_updated_at
before update on public.material_order_return_items
for each row
execute procedure public.set_material_order_updated_at();
