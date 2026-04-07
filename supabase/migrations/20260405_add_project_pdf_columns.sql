alter table public.projects
add column if not exists pdf_file_name text,
add column if not exists pdf_generated_at timestamptz,
add column if not exists pdf_document_base64 text;