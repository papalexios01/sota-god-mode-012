-- If you are using anon key (client-side), you must allow anon role to access this table.
-- OPTION A (simplest for single-user): disable RLS
-- ALTER TABLE public.generated_blog_posts DISABLE ROW LEVEL SECURITY;

-- OPTION B (recommended if RLS enabled): allow anon + authenticated CRUD
ALTER TABLE public.generated_blog_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public CRUD" ON public.generated_blog_posts;

CREATE POLICY "Public CRUD"
ON public.generated_blog_posts
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);
