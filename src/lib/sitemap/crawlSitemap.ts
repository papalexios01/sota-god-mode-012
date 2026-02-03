export type SitemapCrawlProgress = {
  processedSitemaps: number;
  queuedSitemaps: number;
  discoveredUrls: number;
  currentSitemap?: string;
};

export type CrawlSitemapOptions = {
  concurrency?: number;
  maxSitemaps?: number;
  maxUrls?: number;
  /** Hard cap per-sitemap fetch+parse time (ms). Prevents a single slow sitemap from stalling the whole crawl. */
  fetchTimeoutMs?: number;
  /** Optional cancellation signal (e.g., user pressed “Stop”). */
  signal?: AbortSignal;
  onProgress?: (p: SitemapCrawlProgress) => void;
  onUrlsBatch?: (newUrls: string[]) => void;
};

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
}

const ISO_LASTMOD_SEGMENT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function stripFlattenedLastmodSuffix(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return url;

    const last = segments[segments.length - 1] ?? "";
    let decoded = last;
    try {
      decoded = decodeURIComponent(last);
    } catch {
      // ignore
    }

    if (!ISO_LASTMOD_SEGMENT_RE.test(decoded)) return url;
    segments.pop();
    const hadTrailingSlash = u.pathname.endsWith("/");
    u.pathname = `/${segments.join("/")}${hadTrailingSlash ? "/" : ""}`;
    return u.toString();
  } catch {
    return url;
  }
}

/** Extracts http(s) URLs from arbitrary text (e.g. Jina markdown or HTML shells). */
function extractHttpUrlsFromText(raw: string, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /https?:\/\/[^\s<>()\[\]"']+/gi;
  for (const m of raw.matchAll(re)) {
    const rawUrl = (m[0] || "").trim().replace(/[),.;]+$/g, "");
    const u = stripFlattenedLastmodSuffix(rawUrl);
    if (!u) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

function extractSitemapXmlPayload(raw: string): string {
  // Some WordPress setups serve the sitemap XML inside an HTML shell:
  // <html><body><urlset ...>...</urlset></body></html>
  // DOMParser in XML mode can behave inconsistently depending on the wrapper,
  // so we extract the real sitemap root when possible.

  const candidates: Array<{ open: string; close: string }> = [
    { open: "<sitemapindex", close: "</sitemapindex>" },
    { open: "<urlset", close: "</urlset>" },
  ];

  for (const c of candidates) {
    const start = raw.indexOf(c.open);
    if (start === -1) continue;
    const end = raw.indexOf(c.close, start);
    if (end === -1) continue;
    return raw.slice(start, end + c.close.length);
  }

  return raw;
}

function safeParseXml(xmlText: string): XMLDocument {
  // Some sitemaps contain bare '&' which breaks DOMParser.
  const payload = extractSitemapXmlPayload(xmlText);
  const sanitized = payload.replace(
    /&(?!amp;|lt;|gt;|apos;|quot;|#\d+;|#x[a-fA-F0-9]+;)/g,
    "&amp;"
  );

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(sanitized, "text/xml");
  const parseError = xmlDoc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid XML format in sitemap");
  }
  return xmlDoc;
}

function extractLocs(xmlDoc: XMLDocument, rawXml: string): string[] {
  const out: string[] = [];

  // 1) Standard sitemaps: <loc>…</loc>
  // 2) Namespaced sitemaps: <ns:loc>…</ns:loc>
  const byNs = xmlDoc.getElementsByTagNameNS("*", "loc");
  for (const el of Array.from(byNs)) {
    const url = el.textContent?.trim();
    if (!url) continue;
    if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
    out.push(url);
  }

  if (out.length > 0) return out;

  // Fallback: regex extract (handles prefixes and avoids DOM quirks)
  const regex = /<\s*(?:[A-Za-z_][\w.-]*:)?loc\s*>([\s\S]*?)<\s*\/\s*(?:[A-Za-z_][\w.-]*:)?loc\s*>/gi;
  for (const match of rawXml.matchAll(regex)) {
    const url = (match[1] || "").trim();
    if (!url) continue;
    if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
    out.push(url);
  }

  return out;
}

function getSitemapKind(xmlDoc: XMLDocument): "index" | "urlset" | "unknown" {
  const root = xmlDoc.documentElement?.localName?.toLowerCase();
  if (root === "sitemapindex") return "index";
  if (root === "urlset") return "urlset";

  // Namespace/prefix-safe fallbacks
  if (xmlDoc.getElementsByTagNameNS("*", "sitemap").length > 0) return "index";
  if (xmlDoc.getElementsByTagNameNS("*", "url").length > 0) return "urlset";
  return "unknown";
}

/**
 * Crawls a sitemap URL. Supports:
 * - urlset (returns page URLs)
 * - sitemapindex (recursively fetches child sitemaps and returns all page URLs)
 */
export async function crawlSitemapUrls(
  entrySitemapUrl: string,
  fetchSitemapXml: (url: string, signal?: AbortSignal) => Promise<string>,
  options: CrawlSitemapOptions = {}
): Promise<string[]> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 10, 25));
  const maxSitemaps = options.maxSitemaps ?? 5000;
  const maxUrls = options.maxUrls ?? 500000;
  const fetchTimeoutMs = Math.max(5000, options.fetchTimeoutMs ?? 30000);

  // ✅ Fast path: never waste time fetching obviously irrelevant sitemaps.
  // Some WP installs generate these very slowly (video/image/news) and they often contain no <loc> anyway.
  const isLowValueSitemap = (url: string) =>
    /(?:^|\/)(?:video|image|news|author|tag|category|attachment|media)[\w.-]*sitemap\.xml\b/i.test(url);

  const withHardTimeout = async <T>(
    promise: Promise<T>,
    ms: number,
    label: string,
    onTimeout?: () => void
  ): Promise<T> => {
    let timeoutId: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        try {
          onTimeout?.();
        } catch {
          // ignore
        }
        reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
      }, ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  };

  const pending: string[] = [normalizeUrl(entrySitemapUrl)];
  const visitedSitemaps = new Set<string>();
  const discoveredUrls = new Set<string>();

  let processedSitemaps = 0;

  const emitProgress = (currentSitemap?: string) => {
    options.onProgress?.({
      processedSitemaps,
      queuedSitemaps: pending.length,
      discoveredUrls: discoveredUrls.size,
      currentSitemap,
    });
  };

  emitProgress();

  while (pending.length > 0) {
    if (options.signal?.aborted) {
      throw new Error("Crawl cancelled");
    }
    if (visitedSitemaps.size >= maxSitemaps) break;
    if (discoveredUrls.size >= maxUrls) break;

    const batch: string[] = [];
    while (batch.length < concurrency && pending.length > 0) {
      const next = pending.shift();
      if (!next) break;
      if (visitedSitemaps.has(next)) continue;
      visitedSitemaps.add(next);
      batch.push(next);
    }

    if (batch.length === 0) continue;

    await Promise.all(
      batch.map(async (sitemap) => {
        emitProgress(sitemap);

        const globalSignal = options.signal;
        const perFetchController = new AbortController();
        let onGlobalAbort: (() => void) | null = null;

        try {
          if (globalSignal?.aborted) {
            perFetchController.abort();
            throw new Error("Crawl cancelled");
          }

          if (globalSignal) {
            onGlobalAbort = () => perFetchController.abort();
            globalSignal.addEventListener("abort", onGlobalAbort, { once: true });
          }

          if (isLowValueSitemap(sitemap)) {
            // eslint-disable-next-line no-console
            console.info("[Sitemap Crawl] Skipped low-value sitemap:", sitemap);
            return;
          }

          const rawText = await withHardTimeout(
            fetchSitemapXml(sitemap, perFetchController.signal),
            fetchTimeoutMs,
            "Sitemap fetch",
            () => perFetchController.abort()
          );
          let xmlDoc: XMLDocument | null = null;
          let kind: "index" | "urlset" | "unknown" = "unknown";
          let locs: string[] = [];

          try {
            xmlDoc = safeParseXml(rawText);
            kind = getSitemapKind(xmlDoc);
            locs = extractLocs(xmlDoc, rawText);
          } catch {
            // Fallback for non-XML “sitemaps” (e.g. Jina markdown, HTML wrappers, WAF blocks).
            // This prevents false “0 URLs found” when URLs are actually present.
            locs = extractHttpUrlsFromText(rawText, 200_000);

            // If we still have nothing, rethrow so this sitemap is treated as failed.
            if (locs.length === 0) throw new Error("Invalid XML format in sitemap");

            // Heuristic: if this looks like an index sitemap, queue discovered .xml links.
            const indexLike = (() => {
              try {
                const path = new URL(sitemap).pathname.toLowerCase();
                return (
                  path === "/sitemap.xml" ||
                  path === "/wp-sitemap.xml" ||
                  path.endsWith("/sitemap_index.xml") ||
                  path.endsWith("sitemap_index.xml")
                );
              } catch {
                return /sitemap/i.test(sitemap);
              }
            })();

            const xmlLinks = locs.filter((u) => /(?:^|\/)[^\s?#]+\.xml(?:$|[?#])/i.test(u));
            if (indexLike && xmlLinks.length > 0) {
              for (const loc of xmlLinks) {
                if (visitedSitemaps.has(loc)) continue;
                if (isLowValueSitemap(loc)) continue;
                pending.push(loc);
              }
              return;
            }

            // Default: treat as a urlset.
            const newlyAdded: string[] = [];
            for (const loc of locs) {
              if (discoveredUrls.size >= maxUrls) break;
              if (!loc.startsWith("http://") && !loc.startsWith("https://")) continue;
              if (discoveredUrls.has(loc)) continue;
              discoveredUrls.add(loc);
              newlyAdded.push(loc);
            }
            if (newlyAdded.length) options.onUrlsBatch?.(newlyAdded);
            return;
          }

          // If XML parsed but loc extraction produced nothing (rare), fall back to broad URL extraction.
          if (locs.length === 0) {
            locs = extractHttpUrlsFromText(rawText, 200_000);
          }

          if (kind === "index") {
            // ✅ Enterprise performance: prioritize likely post/blog sitemaps and skip obviously irrelevant ones
            // (e.g., video/image/news) to avoid spending minutes crawling giant media sitemaps.
            const hasPostLike = locs.some((u) => /(?:^|\/)(?:post|posts|blog)[-_]?sitemap\.xml\b/i.test(u));
            const preferred = hasPostLike
              ? locs.filter((u) => /(?:^|\/)(?:post|posts|blog)[-_]?sitemap\.xml\b/i.test(u))
              : locs;

            const filtered = preferred.filter(
              (u) => !/(?:^|\/)(?:video|image|news|author|tag|category|attachment|media)[\w.-]*sitemap\.xml\b/i.test(u)
            );
            const toQueue = filtered.length > 0 ? filtered : preferred;

            for (const loc of toQueue) {
              if (visitedSitemaps.has(loc)) continue;
              pending.push(loc);
            }
          } else {
            const newlyAdded: string[] = [];
            for (const loc of locs) {
              if (discoveredUrls.size >= maxUrls) break;
              if (discoveredUrls.has(loc)) continue;
              discoveredUrls.add(loc);
              newlyAdded.push(loc);
            }
            if (newlyAdded.length) {
              options.onUrlsBatch?.(newlyAdded);
            }
          }
        } catch (err) {
          if (globalSignal?.aborted) {
            throw err;
          }
          // ✅ Enterprise robustness: one failing sitemap should not crash the entire crawl.
          // We mark it processed and continue with the rest of the queue.
          const msg = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.warn("[Sitemap Crawl] Failed sitemap:", sitemap, msg);
        } finally {
          if (globalSignal && onGlobalAbort) {
            globalSignal.removeEventListener("abort", onGlobalAbort);
          }
          processedSitemaps += 1;
          emitProgress();
        }
      })
    );
  }

  return Array.from(discoveredUrls);
}
