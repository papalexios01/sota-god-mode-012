function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const ISO_LASTMOD_SEGMENT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Jina sometimes “flattens” `<loc>.../</loc><lastmod>2025-..</lastmod>` into a single token like:
 *   https://example.com/post-slug/2025-01-01T12:34:56+00:00
 * That URL usually 404s. Strip the trailing ISO timestamp segment when detected.
 */
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
    // Preserve trailing slash if the original had one.
    const hadTrailingSlash = u.pathname.endsWith("/");
    u.pathname = `/${segments.join("/")}${hadTrailingSlash ? "/" : ""}`;
    return u.toString();
  } catch {
    return url;
  }
}

function extractHttpUrls(raw: string, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  // Broad URL matcher; good for Jina “Markdown Content” output.
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

function isIndexLikeSitemapUrl(targetUrl: string): boolean {
  try {
    const path = new URL(targetUrl).pathname.toLowerCase();
    return path === "/sitemap.xml" || path === "/wp-sitemap.xml" || path.endsWith("/sitemap_index.xml");
  } catch {
    return false;
  }
}

/**
 * r.jina.ai often returns a plain-text/markdown listing of URLs instead of XML.
 * This adapter converts that listing into valid sitemap XML so our crawler can parse it.
 */
export function adaptJinaMarkdownToSitemapXml(raw: string, targetUrl: string): string | null {
  // If it already looks like sitemap XML, don’t touch it.
  if (/<\s*(?:[A-Za-z_][\w.-]*:)?(urlset|sitemapindex)\b/i.test(raw)) return null;

  const urls = extractHttpUrls(raw, 50_000);
  if (urls.length === 0) return null;

  const indexLike = isIndexLikeSitemapUrl(targetUrl);
  if (indexLike) {
    const xmlLinks = urls.filter((u) => /(?:^|\/)[^\s?#]+\.xml(?:$|[?#])/i.test(u));
    if (xmlLinks.length > 0) {
      const items = xmlLinks
        .slice(0, 5_000)
        .map((u) => `  <sitemap><loc>${escapeXml(u)}</loc></sitemap>`)
        .join("\n");

      return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        items,
        "</sitemapindex>",
      ].join("\n");
    }
  }

  // Default: treat as a urlset
  const items = urls
    .slice(0, 50_000)
    .map((u) => `  <url><loc>${escapeXml(u)}</loc></url>`)
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    items,
    "</urlset>",
  ].join("\n");
}
