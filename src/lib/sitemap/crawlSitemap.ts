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
  onProgress?: (p: SitemapCrawlProgress) => void;
  onUrlsBatch?: (newUrls: string[]) => void;
};

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
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

  if (out.length > 0) return out;

  // Last resort: if the response is HTML/text (blocked page, rendered sitemap, etc.)
  // extract *any* URLs so we still return something usable.
  const urlRegex = /https?:\/\/[^\s"'<>]+/g;
  const urlMatches = rawXml.match(urlRegex) || [];
  for (const u of urlMatches) {
    const url = u.trim();
    if (!url) continue;
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
  fetchSitemapXml: (url: string) => Promise<string>,
  options: CrawlSitemapOptions = {}
): Promise<string[]> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 8, 20));
  const maxSitemaps = options.maxSitemaps ?? 5000;
  const maxUrls = options.maxUrls ?? 500000;

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

        const rawText = await fetchSitemapXml(sitemap);
        const xmlDoc = safeParseXml(rawText);
        const kind = getSitemapKind(xmlDoc);
        const locs = extractLocs(xmlDoc, rawText);

        if (kind === "index") {
          for (const loc of locs) {
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

        processedSitemaps += 1;
        emitProgress();
      })
    );
  }

  return Array.from(discoveredUrls);
}
