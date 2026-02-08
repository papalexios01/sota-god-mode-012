import { useState, useCallback } from 'react';
import { useOptimizerStore } from '@/lib/store';
import { getSupabaseClient, getSupabaseConfig } from '@/lib/supabaseClient';

interface PublishResult {
  success: boolean;
  postId?: number;
  postUrl?: string;
  error?: string;
}

export function useWordPressPublish() {
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const { config } = useOptimizerStore();

  const publish = useCallback(async (
    title: string,
    content: string,
    options?: {
      excerpt?: string;
      status?: 'draft' | 'publish' | 'pending' | 'private';
      slug?: string;
      metaDescription?: string;
      seoTitle?: string;
      sourceUrl?: string;
      existingPostId?: number;
    }
  ): Promise<PublishResult> => {
    setIsPublishing(true);
    setPublishResult(null);

    try {
      if (!config.wpUrl || !config.wpUsername || !config.wpAppPassword) {
        throw new Error('WordPress not configured. Add WordPress URL, username, and application password in Setup.');
      }

      try {
        const parsed = new URL(config.wpUrl.startsWith('http') ? config.wpUrl : `https://${config.wpUrl}`);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new Error('WordPress URL must use HTTP or HTTPS');
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('HTTP')) throw e;
        throw new Error('Invalid WordPress URL format');
      }

      const safeSlug = options?.slug ? options.slug.replace(/^\/+/, '').split('/').pop() : undefined;

      const body = {
        wpUrl: config.wpUrl,
        username: config.wpUsername,
        appPassword: config.wpAppPassword,
        title,
        content,
        excerpt: options?.excerpt,
        status: options?.status || 'draft',
        slug: safeSlug,
        metaDescription: options?.metaDescription,
        seoTitle: options?.seoTitle,
        sourceUrl: options?.sourceUrl,
        existingPostId: options?.existingPostId,
      };

      // ===== Strategy 1: Express server proxy (handles CORS, works in dev + production) =====
      try {
        const res = await fetch('/api/wordpress-publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const json = await res.json().catch(() => null);

        if (res.ok && json?.success) {
          const post = json.post as Record<string, unknown> | undefined;
          const result: PublishResult = {
            success: true,
            postId: post?.id as number | undefined,
            postUrl: (post?.url || post?.link) as string | undefined,
          };
          setPublishResult(result);
          return result;
        }

        if (json?.error) {
          const errorMsg = String(json.error);
          if (res.status === 401 || errorMsg.includes('Authentication') || errorMsg.includes('authentication')) {
            throw new Error('WordPress authentication failed. Check your username and application password in Setup.');
          }
          if (res.status === 403) {
            throw new Error('Permission denied. Ensure the WordPress user has publishing capabilities.');
          }
          if (res.status === 404 && errorMsg.includes('REST API')) {
            throw new Error('WordPress REST API not found. Ensure permalinks are enabled.');
          }
          throw new Error(errorMsg);
        }

        console.warn('[WordPressPublish] Server proxy returned non-OK without error, trying Supabase fallback');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('authentication') || msg.includes('Permission') || msg.includes('REST API') || msg.includes('not configured')) {
          throw e;
        }
        console.warn('[WordPressPublish] Server proxy failed, falling back to Supabase:', msg);
      }

      // ===== Strategy 2: Supabase Edge Function fallback =====
      const { configured } = getSupabaseConfig();

      if (!configured) {
        throw new Error(
          'Publishing failed. The server proxy is not available and Supabase is not configured. ' +
          'Ensure the Express dev server is running (npm run dev:server) or configure Supabase in Setup.'
        );
      }

      const client = getSupabaseClient();
      if (!client) {
        throw new Error('Supabase client not available. Save & Reload your Supabase config.');
      }

      const maxAttempts = 3;
      let lastError: Error | null = null;
      let data: Record<string, unknown> | null = null;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const { data: fnData, error } = await client.functions.invoke('wordpress-publish', {
            body,
          });

          if (error) {
            throw new Error(error.message || 'Supabase function error');
          }

          data = (fnData as any) || null;
          break;
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
          const msg = lastError.message || '';
          const isRetryable =
            !msg.toLowerCase().includes('not configured') &&
            !msg.toLowerCase().includes('invalid wordpress url') &&
            !msg.toLowerCase().includes('authentication');

          if (attempt < maxAttempts - 1 && isRetryable) {
            await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
            continue;
          }

          if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('network')) {
            throw new Error(
              'Failed to publish: Network/CORS blocked the request. Ensure the Express server is running or deploy the Supabase Edge Function.'
            );
          }

          throw lastError;
        }
      }

      if (!data?.success) {
        const serverError = (data?.error as string) || '';
        const statusCode = data?.status as number;
        let errorMsg = serverError || lastError?.message || 'Failed to publish to WordPress';

        if (statusCode === 401 || serverError.includes('Authentication')) {
          errorMsg = 'WordPress authentication failed. Check your username and application password in Setup.';
        } else if (statusCode === 403) {
          errorMsg = 'Permission denied. Ensure the WordPress user has publishing capabilities.';
        } else if (statusCode === 404) {
          errorMsg = 'WordPress REST API not found. Ensure permalinks are enabled.';
        }

        throw new Error(errorMsg);
      }

      const post = data.post as Record<string, unknown> | undefined;
      const result: PublishResult = {
        success: true,
        postId: post?.id as number | undefined,
        postUrl: (post?.url || post?.link) as string | undefined,
      };

      setPublishResult(result);
      return result;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const result: PublishResult = {
        success: false,
        error: errorMsg,
      };
      setPublishResult(result);
      return result;
    } finally {
      setIsPublishing(false);
    }
  }, [config]);

  const clearResult = useCallback(() => {
    setPublishResult(null);
  }, []);

  return {
    publish,
    isPublishing,
    publishResult,
    clearResult,
    isConfigured: !!(config.wpUrl && config.wpUsername && config.wpAppPassword),
  };
}
