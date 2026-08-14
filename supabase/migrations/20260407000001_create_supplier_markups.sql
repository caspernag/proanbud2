CREATE TABLE IF NOT EXISTS public.supplier_markups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_name TEXT NOT NULL UNIQUE,
    markup_percentage NUMERIC DEFAULT 0,
    markup_fixed NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.supplier_markups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to all users" ON public.supplier_markups;
CREATE POLICY "Allow read access to all users" ON public.supplier_markups
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all access to authenticated admins" ON public.supplier_markups;
CREATE POLICY "Allow all access to authenticated admins" ON public.supplier_markups
    FOR ALL USING (auth.role() = 'authenticated');
    
-- Insert default for Byggmakker
INSERT INTO public.supplier_markups (supplier_name, markup_percentage) VALUES ('Byggmakker', 20) ON CONFLICT (supplier_name) DO NOTHING;
