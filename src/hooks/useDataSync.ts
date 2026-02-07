import { useEffect, useState, useCallback } from 'react';
import { useOptimizerStore, type GeneratedContentStore } from '@/lib/store';
import { getSupabaseConfig } from '@/lib/supabaseClient';
<<<<<<< HEAD
import { loadAllBlogPosts, saveBlogPost, deleteBlogPost, ensureTableExists } from '@/lib/api/contentPersistence';
=======
import { loadAllBlogPosts, saveBlogPost, deleteBlogPost, ensureTableExists, getLastDbCheckError } from '@/lib/api/contentPersistence';
>>>>>>> a03bf59 (SOTA: Supabase diagnostics + test connection + correct RLS guidance)
import { toast } from 'sonner';

// =============================================================================
// SOTA Data Sync Hook with Graceful Degradation
// =============================================================================
// This hook manages synchronization between local state and Supabase.
// When Supabase is not configured, the hook operates in "offline mode"
// using only localStorage (via Zustand persist middleware).
// =============================================================================

export function useDataSync() {
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tableMissing, setTableMissing] = useState(false);

  const {
    generatedContentsStore,
    setGeneratedContent,
    contentItems,
    addContentItemWithId,
  } = useOptimizerStore();

  const loadFromDatabase = useCallback(async () => {
    // Early exit if Supabase isn't configured - this is expected and not an error
    if (!getSupabaseConfig().configured) {
      console.info('[DataSync] Running in offline mode (Supabase not configured)');
      setIsLoading(false);
      setIsConnected(false);
      setError(null); // No error - this is expected behavior
      setTableMissing(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const tableExists = await ensureTableExists();
      if (!tableExists) {
        const detail = getLastDbCheckError();
        if (detail?.kind === 'missing_table') {
          setError('Supabase is reachable but the table generated_blog_posts is missing. Create it in Supabase SQL Editor.');
        } else if (detail?.kind === 'rls') {
          setError('Supabase is reachable but RLS is blocking access. Fix RLS policy for anon/authenticated.');
        } else if (detail?.kind === 'permission') {
          setError('Supabase is reachable but permissions are blocking access. Check API settings and table grants.');
        } else if (detail?.kind === 'network') {
          setError(`Network / CORS issue connecting to Supabase: ${detail.message}`);
        } else {
          setError(detail?.message || 'Database connection failed.');
        }
        setTableMissing(true);
        setIsConnected(false);
        setIsLoading(false);
        return;
      }
      setTableMissing(false);

      const loadedContent = await loadAllBlogPosts();
      const loadedCount = Object.keys(loadedContent).length;

      if (loadedCount > 0) {
        for (const [itemId, content] of Object.entries(loadedContent)) {
          setGeneratedContent(itemId, content);

          const existingItem = contentItems.find(item => item.id === itemId);
          if (!existingItem) {
            addContentItemWithId({
              id: itemId,
              title: content.title,
              type: 'single',
              status: 'completed',
              primaryKeyword: content.primaryKeyword,
              content: content.content,
              wordCount: content.wordCount,
              createdAt: new Date(content.generatedAt),
              updatedAt: new Date(content.generatedAt),
              generatedContentId: content.id,
            });
          }
        }

        toast.success(`Loaded ${loadedCount} blog posts from database`);
      }

      setIsConnected(true);
      setLastSyncTime(new Date());
      console.log(`[DataSync] Successfully loaded ${loadedCount} blog posts`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setIsConnected(false);
      console.error('[DataSync] Load error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [setGeneratedContent, contentItems, addContentItemWithId]);

  const saveToDatabase = useCallback(async (itemId: string, contentOverride?: GeneratedContentStore[string]) => {
    // In offline mode, return true (localStorage handles persistence)
    if (!getSupabaseConfig().configured) {
      return true;
    }

    const content = contentOverride || generatedContentsStore[itemId];
    if (!content) {
      console.warn('[DataSync] No content found for item:', itemId);
      return false;
    }

    try {
      const success = await saveBlogPost(itemId, content);
      if (success) {
        setLastSyncTime(new Date());
        setTableMissing(false);
      } else {
        setTableMissing(true);
      }
      return success;
    } catch (err) {
      console.error('[DataSync] Save error:', err);
      setTableMissing(true);
      return false;
    }
  }, [generatedContentsStore]);

  const deleteFromDatabase = useCallback(async (itemId: string) => {
    // In offline mode, return true (localStorage handles persistence)
    if (!getSupabaseConfig().configured) {
      return true;
    }

    try {
      return await deleteBlogPost(itemId);
    } catch (err) {
      console.error('[DataSync] Delete error:', err);
      return false;
    }
  }, []);

  const syncAllToDatabase = useCallback(async () => {
    // In offline mode, skip sync silently
    if (!getSupabaseConfig().configured) {
      toast.info('Running in offline mode - data saved locally');
      return;
    }

    setIsLoading(true);
    let successCount = 0;
    let errorCount = 0;

    for (const [itemId, content] of Object.entries(generatedContentsStore)) {
      try {
        const success = await saveBlogPost(itemId, content);
        if (success) successCount++;
        else errorCount++;
      } catch {
        errorCount++;
      }
    }

    setIsLoading(false);
    setLastSyncTime(new Date());

    if (successCount > 0) {
      toast.success(`Synced ${successCount} blog posts to database`);
    }
    if (errorCount > 0) {
      toast.error(`Failed to sync ${errorCount} blog posts`);
    }
  }, [generatedContentsStore]);

  // Initial load on mount - wrapped in try/catch for safety
  useEffect(() => {
    // Don't attempt load if Supabase isn't configured
    if (!getSupabaseConfig().configured) {
      console.info('[DataSync] Supabase not configured - skipping initial load');
      setIsLoading(false);
      return;
    }

    loadFromDatabase().catch(err => {
      console.error('[DataSync] Initial load failed:', err);
      setIsConnected(false);
      setIsLoading(false);
    });
  }, []);

  return {
    isLoading,
    isConnected,
    lastSyncTime,
    error,
    tableMissing,
    isOfflineMode: !isSupabaseConfigured,
    loadFromDatabase,
    saveToDatabase,
    deleteFromDatabase,
    syncAllToDatabase,
    // Aliases for backward compatibility
    loadFromSupabase: loadFromDatabase,
    saveToSupabase: saveToDatabase,
    deleteFromSupabase: deleteFromDatabase,
    syncAllToSupabase: syncAllToDatabase,
  };
}

export { useDataSync as useSupabaseSync };
