import { TTLCache } from "./cache";
import type { Express, Request, Response } from "express";

const sitemapCache = new TTLCache<any>(5 * 60_000);
import { db } from "./db";
import { generatedBlogPosts } from "../shared/schema";
import { eq, desc } from "drizzle-orm";

const NEURON_API_BASE = "https://app.neuronwriter.com/neuron-api/0.5/writer";

function isPublicUrl(input: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '[::1]') return false;
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return false;
  const parts = hostname.split('.').map(Number);
  if (parts.length === 4 && parts.every(n => !isNaN(n))) {
    if (parts[0] === 127) return false;
    if (parts[0] === 10) return false;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    if (parts[0] === 192 && parts[1] === 168) return false;
    if (parts[0] === 169 && parts[1] === 254) return false;
    if (parts[0] === 0) return false;
  }
  return true;
}

export function registerRoutes(app: Express): void {
  if (db) {
    app.get("/api/blog-posts", async (_req: Request, res: Response) => {
      try {
        const posts = await db!
          .select()
          .from(generatedBlogPosts)
          .orderBy(desc(generatedBlogPosts.generatedAt));

        const store: Record<string, unknown> = {};
        for (const row of posts) {
          store[row.itemId] = {
            id: row.id,
            title: row.title,
            seoTitle: row.seoTitle,
            content: row.content,
            metaDescription: row.metaDescription,
            slug: row.slug,
            primaryKeyword: row.primaryKeyword,
            secondaryKeywords: row.secondaryKeywords || [],
            wordCount: row.wordCount,
            qualityScore: row.qualityScore || {
              overall: 0,
              readability: 0,
              seo: 0,
              eeat: 0,
              uniqueness: 0,
              factAccuracy: 0,
            },
            internalLinks: row.internalLinks || [],
            schema: row.schema,
            serpAnalysis: row.serpAnalysis,
            neuronWriterQueryId: row.neuronwriterQueryId,
            generatedAt: row.generatedAt?.toISOString(),
            model: row.model,
          };
        }

        res.json({ success: true, data: store });
      } catch (error) {
        console.error("[API] Load blog posts error:", error);
        res.status(500).json({ success: false, error: "Failed to load blog posts" });
      }
    });

    app.post("/api/blog-posts", async (req: Request, res: Response) => {
      try {
        const { itemId, content } = req.body;
        if (!itemId || !content) {
          return res.status(400).json({ success: false, error: "Missing itemId or content" });
        }

        await db!
          .insert(generatedBlogPosts)
          .values({
            id: content.id,
            itemId,
            title: content.title,
            seoTitle: content.seoTitle,
            content: content.content,
            metaDescription: content.metaDescription,
            slug: content.slug,
            primaryKeyword: content.primaryKeyword,
            secondaryKeywords: content.secondaryKeywords,
            wordCount: content.wordCount,
            qualityScore: content.qualityScore,
            internalLinks: content.internalLinks,
            schema: content.schema,
            serpAnalysis: content.serpAnalysis,
            neuronwriterQueryId: content.neuronWriterQueryId,
            generatedAt: content.generatedAt ? new Date(content.generatedAt) : new Date(),
            model: content.model,
          })
          .onConflictDoUpdate({
            target: generatedBlogPosts.itemId,
            set: {
              title: content.title,
              seoTitle: content.seoTitle,
              content: content.content,
              metaDescription: content.metaDescription,
              slug: content.slug,
              primaryKeyword: content.primaryKeyword,
              secondaryKeywords: content.secondaryKeywords,
              wordCount: content.wordCount,
              qualityScore: content.qualityScore,
              internalLinks: content.internalLinks,
              schema: content.schema,
              serpAnalysis: content.serpAnalysis,
              neuronwriterQueryId: content.neuronWriterQueryId,
              generatedAt: content.generatedAt ? new Date(content.generatedAt) : new Date(),
              model: content.model,
              updatedAt: new Date(),
            },
          });

        res.json({ success: true });
      } catch (error) {
        console.error("[API] Save blog post error:", error);
        res.status(500).json({ success: false, error: "Failed to save blog post" });
      }
    });

    app.delete("/api/blog-posts/:itemId", async (req: Request, res: Response) => {
      try {
        const { itemId } = req.params;
        await db!.delete(generatedBlogPosts).where(eq(generatedBlogPosts.itemId, itemId));
        res.json({ success: true });
      } catch (error) {
        console.error("[API] Delete blog post error:", error);
        res.status(500).json({ success: false, error: "Failed to delete blog post" });
      }
    });
  }

  app.post("/api/neuronwriter-proxy", async (req: Request, res: Response) => {
    try {
      const { endpoint, method = "POST", apiKey, body: requestBody } = req.body;
      const apiKeyFromHeader = req.headers["x-neuronwriter-key"] as string;
      const finalApiKey = apiKey || apiKeyFromHeader;

      if (!endpoint || !finalApiKey) {
        return res.status(400).json({ success: false, error: "Missing endpoint or apiKey" });
      }

      const cleanApiKey = finalApiKey.trim();
      const url = `${NEURON_API_BASE}${endpoint}`;

      let timeoutMs = 45000;
      if (endpoint === "/list-projects" || endpoint === "/list-queries") {
        timeoutMs = 20000;
      } else if (endpoint === "/new-query") {
        timeoutMs = 60000;
      } else if (endpoint === "/get-query") {
        timeoutMs = 30000;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const fetchOptions: RequestInit = {
        method,
        headers: {
          "X-API-KEY": cleanApiKey,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "ContentOptimizer/1.0",
        },
        signal: controller.signal,
      };

      if (requestBody && (method === "POST" || method === "PUT")) {
        fetchOptions.body = JSON.stringify(requestBody);
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      const responseText = await response.text();
      let responseData: unknown;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { raw: responseText };
      }

      res.json({
        success: response.ok,
        status: response.status,
        data: responseData,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const isTimeout = errorMessage.includes("abort");
      res.json({
        success: false,
        status: isTimeout ? 408 : 500,
        error: isTimeout ? "Request timed out. The NeuronWriter API may be slow - try again." : errorMessage,
        type: isTimeout ? "timeout" : "network_error",
      });
    }
  });

  app.all("/api/fetch-sitemap", async (req: Request, res: Response) => {
    const startTime = Date.now();
    try {
      let targetUrl: string | null = null;

      if (req.method === "GET") {
        targetUrl = req.query.url as string;
      } else if (req.method === "POST") {
        targetUrl = req.body.url;
      }

      if (!targetUrl) {
        return res.status(400).json({ error: "URL parameter is required" });
      }

      if (!isPublicUrl(targetUrl)) {
        return res.status(400).json({ error: "URL must be a public HTTP/HTTPS address" });
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);

      const response = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
          "Accept": "application/xml, text/xml, text/html, */*",
          "Accept-Encoding": "gzip, deflate",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeoutId);
      const elapsed = Date.now() - startTime;

      if (!response.ok) {
        return res.status(response.status).json({
          error: `Failed to fetch: HTTP ${response.status}`,
          status: response.status,
          elapsed,
        });
      }

      const content = await response.text();
      const contentType = response.headers.get("content-type") || "text/plain";
      const isXml = contentType.includes("xml") || content.trim().startsWith("<?xml") || content.includes("<urlset") || content.includes("<sitemapindex");

      if (req.method === "GET" && isXml) {
        res.setHeader("Content-Type", contentType);
        res.setHeader("X-Fetch-Time", `${elapsed}ms`);
        return res.send(content);
      }

      res.json({
        content,
        contentType,
        url: targetUrl,
        size: content.length,
        isXml,
        elapsed,
      });
    } catch (error: unknown) {
      const elapsed = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const isTimeout = errorMessage.includes("abort") || errorMessage.includes("timeout");
      res.status(isTimeout ? 408 : 500).json({
        error: isTimeout ? `Request timed out after ${Math.round(elapsed / 1000)}s` : errorMessage,
        type: isTimeout ? "timeout" : "fetch_error",
        elapsed,
      });
    }
  });

  app.post("/api/wordpress-publish", async (req: Request, res: Response) => {
    try {
      const {
        wpUrl,
        username,
        appPassword,
        title,
        content,
        excerpt,
        status = "draft",
        categories,
        tags,
        slug,
        metaDescription,
        seoTitle,
        sourceUrl,
        existingPostId,
      } = req.body;

      if (!wpUrl || !username || !appPassword || !title || !content) {
        res.status(400).json({
          success: false,
          error: "Missing required fields: wpUrl, username, appPassword, title, content",
        });
        return;
      }

      let baseUrl = wpUrl.trim().replace(/\/+$/, "");
      if (!baseUrl.startsWith("http")) {
        baseUrl = `https://${baseUrl}`;
      }

      if (!isPublicUrl(baseUrl)) {
        res.status(400).json({ success: false, error: "WordPress URL must be a public HTTP/HTTPS address" });
        return;
      }

      const apiUrl = `${baseUrl}/wp-json/wp/v2/posts`;
      const authString = `${username}:${appPassword}`;
      const authBase64 = Buffer.from(authString).toString("base64");

      const authHeaders: Record<string, string> = {
        Authorization: `Basic ${authBase64}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      const wpFetch = async (url: string, options: RequestInit = {}): Promise<globalThis.Response> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);
        try {
          return await fetch(url, { ...options, signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }
      };

      let targetPostId: number | null = existingPostId ? parseInt(String(existingPostId), 10) : null;
      if (targetPostId !== null && isNaN(targetPostId)) targetPostId = null;

      if (!targetPostId && slug) {
        try {
          const cleanSlug = slug.replace(/^\/+|\/+$/g, "").split("/").pop() || slug;
          console.log(`[WordPress] Searching for existing post with slug: ${cleanSlug}`);
          const searchUrl = `${apiUrl}?slug=${encodeURIComponent(cleanSlug)}&status=any`;
          const searchRes = await wpFetch(searchUrl, { headers: authHeaders });
          if (searchRes.ok) {
            const posts = await searchRes.json();
            if (Array.isArray(posts) && posts.length > 0) {
              targetPostId = posts[0].id;
              console.log(`[WordPress] Found existing post ID: ${targetPostId}`);
            }
          }
        } catch (err) {
          console.log(`[WordPress] Could not search for existing post:`, err);
        }
      }

      if (!targetPostId && sourceUrl) {
        try {
          const pathMatch = sourceUrl.match(/\/([^\/]+)\/?$/);
          if (pathMatch) {
            const sourceSlug = pathMatch[1].replace(/\/$/, "");
            console.log(`[WordPress] Searching for existing post with source slug: ${sourceSlug}`);
            const searchUrl = `${apiUrl}?slug=${encodeURIComponent(sourceSlug)}&status=any`;
            const searchRes = await wpFetch(searchUrl, { headers: authHeaders });
            if (searchRes.ok) {
              const posts = await searchRes.json();
              if (Array.isArray(posts) && posts.length > 0) {
                targetPostId = posts[0].id;
                console.log(`[WordPress] Found existing post ID from sourceUrl: ${targetPostId}`);
              }
            }
          }
        } catch (err) {
          console.log(`[WordPress] Could not search by sourceUrl:`, err);
        }
      }

      // Transform YouTube iframes to WordPress-native embed format
      // WordPress strips iframes but natively supports YouTube via oEmbed
      let processedContent = content;
      
      // Convert iframe embeds to WordPress [embed] shortcodes
      processedContent = processedContent.replace(
        /<iframe[^>]*src=["']https?:\/\/(?:www\.)?(?:youtube\.com\/embed|youtube-nocookie\.com\/embed)\/([a-zA-Z0-9_-]+)[^"']*["'][^>]*>[\s\S]*?<\/iframe>/gi,
        (match, videoId) => {
          return `[embed]https://www.youtube.com/watch?v=${videoId}[/embed]`;
        }
      );
      
      // Also handle any remaining figure-wrapped iframes
      processedContent = processedContent.replace(
        /<figure[^>]*>\s*<div[^>]*>\s*<iframe[^>]*src=["']https?:\/\/(?:www\.)?(?:youtube\.com\/embed|youtube-nocookie\.com\/embed)\/([a-zA-Z0-9_-]+)[^"']*["'][^>]*>[\s\S]*?<\/iframe>\s*<\/div>\s*<figcaption[^>]*>([\s\S]*?)<\/figcaption>\s*<\/figure>/gi,
        (match, videoId, caption) => {
          const cleanCaption = caption.replace(/<[^>]*>/g, '').trim();
          return `[embed]https://www.youtube.com/watch?v=${videoId}[/embed]\n<p style="text-align: center; color: #6b7280; font-size: 14px;">${cleanCaption}</p>`;
        }
      );

      const postData: Record<string, unknown> = {
        title,
        content: processedContent,
        status,
      };

      if (excerpt) postData.excerpt = excerpt;
      if (slug) {
        const cleanSlug = slug.replace(/^\/+|\/+$/g, "").split("/").pop() || slug;
        postData.slug = cleanSlug;
      }
      if (categories && categories.length > 0) postData.categories = categories;
      if (tags && tags.length > 0) postData.tags = tags;

      if (metaDescription || seoTitle) {
        postData.meta = {
          _yoast_wpseo_metadesc: metaDescription || "",
          _yoast_wpseo_title: seoTitle || title,
          rank_math_description: metaDescription || "",
          rank_math_title: seoTitle || title,
          _aioseo_description: metaDescription || "",
          _aioseo_title: seoTitle || title,
        };
      }

      const targetUrl = targetPostId ? `${apiUrl}/${targetPostId}` : apiUrl;
      const method = targetPostId ? "PUT" : "POST";

      console.log(`[WordPress] ${method} to ${targetUrl}`);

      let response: globalThis.Response;
      try {
        response = await wpFetch(targetUrl, {
          method,
          headers: authHeaders,
          body: JSON.stringify(postData),
        });
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        const isTimeout = msg.includes("abort") || msg.includes("timeout");
        console.error(`[WordPress] Fetch failed: ${msg}`);
        res.status(isTimeout ? 504 : 502).json({
          success: false,
          error: isTimeout
            ? "Connection to WordPress timed out after 60 seconds. Check that the URL is correct and the site is reachable."
            : `Could not connect to WordPress: ${msg}`,
          status: isTimeout ? 504 : 502,
        });
        return;
      }

      const responseText = await response.text();

      if (!response.ok) {
        let errorMessage = `WordPress API error: ${response.status}`;
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch {}

        if (response.status === 401) {
          errorMessage = "Authentication failed. Check your username and application password.";
        } else if (response.status === 403) {
          errorMessage = "Permission denied. Ensure the user has publish capabilities.";
        } else if (response.status === 404) {
          errorMessage = "WordPress REST API not found. Ensure permalinks are enabled and REST API is accessible.";
        }

        res.json({ success: false, error: errorMessage, status: response.status });
        return;
      }

      let post: { id: number; link: string; status: string; title?: { rendered: string }; slug: string };
      try {
        post = JSON.parse(responseText);
      } catch {
        res.json({ success: false, error: "Invalid response from WordPress" });
        return;
      }

      res.json({
        success: true,
        updated: !!targetPostId,
        post: {
          id: post.id,
          url: post.link,
          status: post.status,
          title: post.title?.rendered || title,
          slug: post.slug,
        },
      });
    } catch (error) {
      console.error("[WordPress] Unexpected error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : "Unknown server error",
        });
      }
    }
  });

  app.post("/api/wp-discover", async (req: Request, res: Response) => {
    try {
      const siteUrl = req.body?.siteUrl;
      if (!siteUrl || typeof siteUrl !== "string") {
        return res.status(400).json({ success: false, error: "siteUrl is required" });
      }

      const normalizeOrigin = (input: string): string => {
        const t = input.trim();
        const withProto = t.startsWith("http://") || t.startsWith("https://") ? t : `https://${t}`;
        if (!isPublicUrl(withProto)) {
          throw new Error("URL must be a public HTTP/HTTPS address");
        }
        const url = new URL(withProto);
        return url.origin;
      };

      const origin = normalizeOrigin(siteUrl);
      const perPage = Number(req.body?.perPage ?? 100);
      const maxPages = Number(req.body?.maxPages ?? 250);
      const maxUrls = Number(req.body?.maxUrls ?? 100000);
      const includePages = req.body?.includePages !== false;

      const fetchWpLinks = async (
        origin: string,
        endpoint: "posts" | "pages",
        opts: { perPage: number; maxPages: number; maxUrls: number }
      ): Promise<string[]> => {
        const perPageClamped = Math.min(100, Math.max(1, opts.perPage));
        const maxPagesClamped = Math.max(1, opts.maxPages);
        const maxUrlsClamped = Math.max(1, opts.maxUrls);

        const out = new Set<string>();
        const mkUrl = (page: number) =>
          `${origin}/wp-json/wp/v2/${endpoint}?per_page=${perPageClamped}&page=${page}&_fields=link`;

        const fetchPage = async (page: number) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 12000);
          try {
            const res = await fetch(mkUrl(page), {
              method: "GET",
              headers: {
                Accept: "application/json",
                "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
              },
              signal: controller.signal,
            });
            const json = await res.json().catch(() => null);
            const totalPagesHeader = res.headers.get("x-wp-totalpages") || res.headers.get("X-WP-TotalPages");
            const totalPages = totalPagesHeader ? Number(totalPagesHeader) : undefined;

            if (!res.ok || !Array.isArray(json)) {
              return { links: [] as string[], totalPages };
            }

            const links: string[] = [];
            for (const item of json) {
              const link = (item as Record<string, unknown>)?.link;
              if (typeof link === "string" && link.startsWith("http")) links.push(link);
            }
            return { links, totalPages };
          } finally {
            clearTimeout(timeoutId);
          }
        };

        const first = await fetchPage(1);
        for (const l of first.links) {
          if (out.size >= maxUrlsClamped) break;
          out.add(l);
        }

        const totalPages = first.totalPages;
        const finalPage = totalPages ? Math.min(totalPages, maxPagesClamped) : maxPagesClamped;

        const concurrency = 4;
        let page = 2;
        while (page <= finalPage && out.size < maxUrlsClamped) {
          const batch = Array.from({ length: concurrency }, (_, i) => page + i).filter((p) => p <= finalPage);
          page += batch.length;

          const results = await Promise.all(batch.map((p) => fetchPage(p)));
          for (const r of results) {
            for (const l of r.links) {
              if (out.size >= maxUrlsClamped) break;
              out.add(l);
            }
            if (!totalPages && r.links.length === 0) {
              page = finalPage + 1;
              break;
            }
          }
        }

        return Array.from(out);
      };

      const urls = new Set<string>();

      const postLinks = await fetchWpLinks(origin, "posts", { perPage, maxPages, maxUrls });
      postLinks.forEach((u) => urls.add(u));

      if (includePages && urls.size < maxUrls) {
        const pageLinks = await fetchWpLinks(origin, "pages", { perPage, maxPages, maxUrls: maxUrls - urls.size });
        pageLinks.forEach((u) => urls.add(u));
      }

      res.json({ success: true, urls: Array.from(urls) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[wp-discover] Error:", msg);
      res.status(500).json({ success: false, error: msg });
    }
  });
}
