import { getSupabaseClient, getSupabaseConfig, withSupabase } from '../supabaseClient';
import type { GeneratedContentStore } from '../store';

// =============================================================================
// SOTA Content Persistence with Graceful Supabase Fallback
// =============================================================================
// All operations safely check for Supabase availability.
// When Supabase is not configured, operations return sensible defaults
// and the app continues to work using local storage (via Zustand persist).
// =============================================================================

const TABLE = 'generated_blog_posts';

// Last DB connectivity error (for UI diagnostics)
let lastDbCheckError: { kind: 'missing_table' | 'rls' | 'permission' | 'network' | 'unknown'; code?: string; message: string } | null = null;

export function getLastDbCheckError() {
  return lastDbCheckError;
}


export async function ensureTableExists(): Promise<boolean> {
  // If Supabase is not configured, return false (not an error state)
  if (!getSupabaseConfig().configured || !getSupabaseClient()) {
<<<<<<< HEAD
=======
    lastDbCheckError = null;
>>>>>>> a03bf59 (SOTA: Supabase diagnostics + test connection + correct RLS guidance)
    console.info('[ContentPersistence] Supabase not configured, using local storage only');
    return false;
  }

  try {
    const { error } = await getSupabaseClient()!
      .from(TABLE)
      .select('id')
      .limit(1);

    if (error) {
      const msg = error.message || 'Unknown error';
      const code = (error as any).code as string | undefined;

      // Table missing
      if (code === '42P01' || msg.includes('does not exist')) {
        lastDbCheckError = { kind: 'missing_table', code, message: msg };
        console.warn('[ContentPersistence] Table does not exist:', TABLE);
        return false;
      }

      // Common RLS/permission failures
      if (msg.toLowerCase().includes('row level security') || msg.toLowerCase().includes('rls')) {
        lastDbCheckError = { kind: 'rls', code, message: msg };
        console.error('[ContentPersistence] RLS blocked access:', msg);
        return false;
      }

      if (msg.toLowerCase().includes('permission') || code in ('42501')) {
        lastDbCheckError = { kind: 'permission', code, message: msg };
        console.error('[ContentPersistence] Permission blocked access:', msg);
        return false;
      }

      lastDbCheckError = { kind: 'unknown', code, message: msg };
      console.error('[ContentPersistence] Table check failed:', msg);
      return false;
    }

    lastDbCheckError = null;
    return true;
  } catch (err: any) {
    lastDbCheckError = { kind: 'network', message: err?.message || String(err) };
    console.error('[ContentPersistence] Connection error:', err);
    return false;
  }
}

export async function loadAllBlogPosts(): Promise<GeneratedContentStore> {
  // If Supabase is not configured, return empty (local storage handles persistence)
  if (!getSupabaseConfig().configured || !getSupabaseClient()) {
    console.info('[ContentPersistence] Skipping Supabase load (not configured)');
    return {};
  }

  try {
    const { data, error } = await getSupabaseClient()!
      .from(TABLE)
      .select('*')
      .order('generated_at', { ascending: false });

    if (error) {
      console.error('[ContentPersistence] Load error:', error.message);
      return {};
    }

    const store: GeneratedContentStore = {};
    for (const row of data || []) {
      store[row.item_id] = {
        id: row.id,
        title: row.title,
        seoTitle: row.seo_title,
        content: row.content,
        metaDescription: row.meta_description,
        slug: row.slug,
        primaryKeyword: row.primary_keyword,
        secondaryKeywords: row.secondary_keywords || [],
        wordCount: row.word_count,
        qualityScore: row.quality_score || {
          overall: 0,
          readability: 0,
          seo: 0,
          eeat: 0,
          uniqueness: 0,
          factAccuracy: 0,
        },
        internalLinks: row.internal_links || [],
        schema: row.schema,
        serpAnalysis: row.serp_analysis,
        neuronWriterQueryId: row.neuronwriter_query_id,
        generatedAt: row.generated_at,
        model: row.model,
      };
    }

    console.log(`[ContentPersistence] Loaded ${Object.keys(store).length} blog posts from Supabase`);
    return store;
  } catch (err) {
    console.error('[ContentPersistence] Load exception:', err);
    return {};
  }
}

export async function saveBlogPost(itemId: string, content: GeneratedContentStore[string]): Promise<boolean> {
  // If Supabase is not configured, silently succeed (local storage handles it)
  if (!getSupabaseConfig().configured || !getSupabaseClient()) {
    console.info('[ContentPersistence] Skipping Supabase save (not configured)');
    return true; // Return true so the app doesn't show error states
  }

  try {
    const row = {
      id: content.id,
      item_id: itemId,
      title: content.title,
      seo_title: content.seoTitle,
      content: content.content,
      meta_description: content.metaDescription,
      slug: content.slug,
      primary_keyword: content.primaryKeyword,
      secondary_keywords: content.secondaryKeywords,
      word_count: content.wordCount,
      quality_score: content.qualityScore,
      internal_links: content.internalLinks,
      schema: content.schema,
      serp_analysis: content.serpAnalysis,
      neuronwriter_query_id: content.neuronWriterQueryId,
      generated_at: content.generatedAt || new Date().toISOString(),
      model: content.model,
      user_id: null,
    };

    const { error } = await getSupabaseClient()!
      .from(TABLE)
      .upsert(row, { onConflict: 'item_id' });

    if (error) {
      console.error('[ContentPersistence] Save error:', error.message);
      return false;
    }

    console.log(`[ContentPersistence] Saved blog post: ${content.title}`);
    return true;
  } catch (err) {
    console.error('[ContentPersistence] Save exception:', err);
    return false;
  }
}

export async function deleteBlogPost(itemId: string): Promise<boolean> {
  // If Supabase is not configured, silently succeed
  if (!getSupabaseConfig().configured || !getSupabaseClient()) {
    console.info('[ContentPersistence] Skipping Supabase delete (not configured)');
    return true;
  }

  try {
    const { error } = await getSupabaseClient()!
      .from(TABLE)
      .delete()
      .eq('item_id', itemId);

    if (error) {
      console.error('[ContentPersistence] Delete error:', error.message);
      return false;
    }

    console.log(`[ContentPersistence] Deleted blog post: ${itemId}`);
    return true;
  } catch (err) {
    console.error('[ContentPersistence] Delete exception:', err);
    return false;
  }
}
