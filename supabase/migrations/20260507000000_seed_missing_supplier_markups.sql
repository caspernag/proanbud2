-- Seed markup rows for suppliers that were missing from the initial migration.
-- Values can be adjusted directly in the Supabase dashboard.
INSERT INTO public.supplier_markups (supplier_name, markup_percentage, markup_fixed)
VALUES
  ('Monter/Optimera', 20, 0),
  ('Byggmax',         20, 0),
  ('XL-Bygg',        20, 0)
ON CONFLICT (supplier_name) DO NOTHING;
