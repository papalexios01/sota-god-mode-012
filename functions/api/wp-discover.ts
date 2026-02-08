/// <reference types="@cloudflare/workers-types" />

interface Env {}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

function isPublicUrl(input: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "[::1]") return false;
  if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;
  const parts = hostname.split(".").map(Number);
  if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
    if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) return false;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    if (parts[0] === 192 && parts[1] === 168) return false;
    if (parts[0] === 169 && parts[1] === 254) return false;
  }
  return true;
}

async function fetchWpLinks(
  origin: string,
  endpoint: "posts" | "pages",
  opts: { perPage: number; maxPages: number; maxUrls: number }
): Promise<string[]> {
  const perPage = Math.min(100, Math.max(1, opts.perPage));
  const maxPages = Math.max(1, opts.maxPages);
  const maxUrls = Math.max(1, opts.maxUrls);
  const out = new Set<string>();

  const mkUrl = (page: number) =>
    `${origin}/wp-json/wp/v2/${endpoint}?per_page=${perPage}&page=${page}&_fields=link`;

  const fetchPage = async (page: number) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(mkUrl(page), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)",
        },
        signal: controller.signal,
      });
      const json: any = await res.json().catch(() => null);
      const totalPages = Number(res.headers.get("x-wp-totalpages")) || undefined;
      if (!res.ok || !Array.isArray(json)) return { links: [] as string[], totalPages };
      const links = json.filter((i: any) => typeof i?.link === "string" && i.link.startsWith("http")).map((i: any) => i.link);
      return { links, totalPages };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const first = await fetchPage(1);
  for (const l of first.links) {
    if (out.size >= maxUrls) break;
    out.add(l);
  }

  const finalPage = first.totalPages ? Math.min(first.totalPages, maxPages) : maxPages;
  const concurrency = 4;
  let page = 2;

  while (page <= finalPage && out.size < maxUrls) {
    const batch = Array.from({ length: concurrency }, (_, i) => page + i).filter((p) => p <= finalPage);
    page += batch.length;
    const results = await Promise.all(batch.map((p) => fetchPage(p)));
    for (const r of results) {
      for (const l of r.links) {
        if (out.size >= maxUrls) break;
        out.add(l);
      }
      if (!first.totalPages && r.links.length === 0) {
        page = finalPage + 1;
        break;
      }
    }
  }

  return Array.from(out);
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: corsHeaders }
    );
  }

  try {
    const body = await request.json<any>();
    const siteUrl = body?.siteUrl;

    if (!siteUrl || typeof siteUrl !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "siteUrl is required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const t = siteUrl.trim();
    const withProto = t.startsWith("http://") || t.startsWith("https://") ? t : `https://${t}`;
    if (!isPublicUrl(withProto)) {
      return new Response(
        JSON.stringify({ success: false, error: "URL must be a public HTTP/HTTPS address" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const origin = new URL(withProto).origin;
    const perPage = Number(body?.perPage ?? 100);
    const maxPages = Number(body?.maxPages ?? 250);
    const maxUrls = Number(body?.maxUrls ?? 100000);
    const includePages = body?.includePages !== false;

    const urls = new Set<string>();
    const postLinks = await fetchWpLinks(origin, "posts", { perPage, maxPages, maxUrls });
    postLinks.forEach((u) => urls.add(u));

    if (includePages && urls.size < maxUrls) {
      const pageLinks = await fetchWpLinks(origin, "pages", { perPage, maxPages, maxUrls: maxUrls - urls.size });
      pageLinks.forEach((u) => urls.add(u));
    }

    return new Response(
      JSON.stringify({ success: true, urls: Array.from(urls) }),
      { status: 200, headers: corsHeaders }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: e?.message || String(e) }),
      { status: 500, headers: corsHeaders }
    );
  }
};
