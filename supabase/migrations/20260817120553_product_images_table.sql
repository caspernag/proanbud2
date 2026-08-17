-- ============================================================
-- product_images — én autoritativ tabell for produktbilder
-- Opprettet: 2026-08-17
--
-- Bakgrunn: bildeidentitet lå spredd på tre steder:
--   * nobb_images.storage_path   — den egentlige cachen
--   * storefront_products.image_path — denormalisert kopi
--   * storefront_products.image_url  — ekstern URL (0 rader i bruk)
-- To skrivere mot samme sannhet, og fordi nøkkelen var nobb_number som
-- primærnøkkel kunne et produkt aldri ha mer enn ett bilde — ingen galleri.
--
-- Etter denne migrasjonen:
--   * product_images er eneste skriver av bildeidentitet
--   * storefront_products.image_path er AVLEDET (trigger holder den i sync)
--   * nobb_images beholdes som ren negativ-cache (null_until) for
--     warmup-jobben, ikke som bildekilde
-- ============================================================

create table if not exists public.product_images (
  id            uuid primary key default gen_random_uuid(),
  nobb_number   text        not null,
  storage_path  text        not null,
  -- 0 = primærbilde. Resten er galleri, vist i stigende rekkefølge.
  sort_order    integer     not null default 0,
  role          text        not null default 'gallery',
  alt_text      text,
  width         integer,
  height        integer,
  byte_size     integer,
  -- Hvor bildet kom fra: nobb-export | optimera | byggmakker | manual
  source        text        not null default 'manual',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint product_images_role_check
    check (role in ('primary', 'gallery', 'lifestyle', 'datasheet')),
  constraint product_images_sort_order_check
    check (sort_order >= 0)
);

-- Ett bilde per (produkt, posisjon).
create unique index if not exists product_images_nobb_sort_idx
  on public.product_images (nobb_number, sort_order);

-- Nøyaktig ett primærbilde per produkt.
create unique index if not exists product_images_one_primary_idx
  on public.product_images (nobb_number)
  where role = 'primary';

-- Oppslag på filnavn (brukes av opprydding og bulk-verktøy).
create index if not exists product_images_storage_path_idx
  on public.product_images (storage_path);

-- Katalogen er offentlig lesbar; bildene er en del av den.
alter table public.product_images enable row level security;
drop policy if exists "Public read product images" on public.product_images;
create policy "Public read product images"
  on public.product_images
  for select
  to anon, authenticated
  using (true);

grant select (id, nobb_number, storage_path, sort_order, role, alt_text, width, height)
  on public.product_images to anon, authenticated;


-- ============================================================
-- Trigger: hold storefront_products.image_path i sync med primærbildet.
--
-- Dette er det som gjør image_path til en avledet kolonne. Prisimporten
-- rører den ikke (den er ikke med i upsert-payloaden), så etter dette har
-- bildeidentitet nøyaktig én skriver.
-- ============================================================

create or replace function public.sync_storefront_primary_image()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  target_nobb text;
  next_path   text;
begin
  target_nobb := coalesce(new.nobb_number, old.nobb_number);

  -- Primærbildet er det med role='primary', ellers laveste sort_order.
  select pi.storage_path
    into next_path
    from public.product_images pi
   where pi.nobb_number = target_nobb
   order by (pi.role = 'primary') desc, pi.sort_order asc
   limit 1;

  update public.storefront_products
     set image_path = next_path,
         updated_at = now()
   where nobb_number = target_nobb
     and image_path is distinct from next_path;

  return null;
end;
$$;

drop trigger if exists product_images_sync_primary on public.product_images;
create trigger product_images_sync_primary
  after insert or update or delete on public.product_images
  for each row
  execute function public.sync_storefront_primary_image();


-- ============================================================
-- Backfill fra nobb_images. Alt som allerede er cachet blir primærbilde.
-- ============================================================

insert into public.product_images (nobb_number, storage_path, sort_order, role, source)
select
  ni.nobb_number,
  ni.storage_path,
  0,
  'primary',
  'nobb-export'
from public.nobb_images ni
where ni.storage_path is not null
  and exists (
    select 1 from public.storefront_products sp where sp.nobb_number = ni.nobb_number
  )
on conflict (nobb_number, sort_order) do nothing;

-- Produkter som hadde image_path uten tilsvarende rad i nobb_images.
insert into public.product_images (nobb_number, storage_path, sort_order, role, source)
select distinct on (sp.nobb_number)
  sp.nobb_number,
  sp.image_path,
  0,
  'primary',
  'nobb-export'
from public.storefront_products sp
where sp.image_path is not null
  and not exists (
    select 1 from public.product_images pi where pi.nobb_number = sp.nobb_number
  )
on conflict (nobb_number, sort_order) do nothing;
