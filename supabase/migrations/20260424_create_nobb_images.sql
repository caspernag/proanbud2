-- Lookup table so the image API route can find a NOBB image with a single
-- DB query instead of up to 4 HEAD requests to Supabase Storage.
--
-- storage_path: the file path inside the "material-images" bucket,
--               e.g. "12345678.jpg"
-- null_until:   when set, skip upstream re-fetch until this timestamp

create table if not exists public.nobb_images (
  nobb_number   text        primary key,
  storage_path  text,
  null_until    timestamptz,
  updated_at    timestamptz not null default now()
);

-- No RLS needed — accessed only via service role key in the API route.
-- Index on null_until for null-marker queries (small table, mostly for clarity).
create index if not exists nobb_images_null_until_idx
  on public.nobb_images (null_until)
  where null_until is not null;
