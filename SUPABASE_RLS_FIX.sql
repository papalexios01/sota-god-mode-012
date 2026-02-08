ALTER TABLE public.generated_blog_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public CRUD" ON public.generated_blog_posts;
CREATE POLICY "Public CRUD"
ON public.generated_blog_posts
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);
