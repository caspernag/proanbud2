-- ============================================================
-- Make the material-images bucket public
-- Created: 2026-06-23
--
-- Product images were served through /api/storefront-images/[nobb], which on
-- every request ran storage.list({search}) + an objects download and streamed
-- the bytes through the serverless function (large Supabase egress + the single
-- biggest source of database query load: storage.search ~21% of total time).
--
-- With the bucket public, cached images are served directly from the Supabase
-- CDN via their public URL (see buildPublicStorefrontImageUrl). The proxy route
-- is kept only for resolving/warming images that aren't cached yet.
-- ============================================================

update storage.buckets
set public = true
where id = 'material-images';
