create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.material_orders
add column if not exists partner_id uuid references public.partners(id) on delete set null,
add column if not exists partner_status text not null default 'pending' check (
  partner_status in ('pending', 'processing', 'out_for_delivery', 'delivered', 'cancelled')
);

create index if not exists material_orders_partner_id_idx on public.material_orders(partner_id);

alter table public.partners enable row level security;

drop policy if exists "Partners are viewable by everyone" on public.partners;
create policy "Partners are viewable by everyone"
on public.partners for select using (true);

-- Insert Trebygg Strand AS as initial partner
insert into public.partners (name, slug)
values ('Trebygg Strand AS', 'trebygg-strand-as')
on conflict (slug) do nothing;
