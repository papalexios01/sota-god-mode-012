/// <reference types="@cloudflare/workers-types" />

interface Env {}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8",
};

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

    const wordpressUrl = String(body.wordpressUrl || body.wpUrl || "").replace(/\/+$/, "");
    const username = String(body.username || body.wpUsername || "");
    const appPassword = String(body.appPassword || body.wpPassword || body.wpAppPassword || "");

    if (!wordpressUrl || !username || !appPassword) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing WordPress URL, username, or app password." }),
        { status: 400, headers: corsHeaders }
      );
    }

    const title = body.title || "";
    const content = body.content || "";
    const excerpt = body.excerpt ?? "";
    const slug = body.slug ?? undefined;
    const status = body.status ?? "publish";
    const categories = Array.isArray(body.categories) ? body.categories : undefined;
    const tags = Array.isArray(body.tags) ? body.tags : undefined;
    const seoTitle = body.seoTitle || "";
    const metaDescription = body.metaDescription || "";
    const sourceUrl = body.sourceUrl || "";
    const existingPostId = body.existingPostId;

    const apiUrl = `${wordpressUrl}/wp-json/wp/v2/posts`;
    const auth = btoa(`${username}:${appPassword}`);
    const authHeaders: Record<string, string> = {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    let targetPostId: number | null = existingPostId || null;

    if (!targetPostId && slug) {
      try {
        const searchRes = await fetch(`${apiUrl}?slug=${encodeURIComponent(slug)}&status=any`, {
          headers: authHeaders,
        });
        if (searchRes.ok) {
          const posts: any[] = await searchRes.json();
          if (posts.length > 0) targetPostId = posts[0].id;
        }
      } catch {}
    }

    if (!targetPostId && sourceUrl) {
      try {
        const pathMatch = sourceUrl.match(/\/([^/]+)\/?$/);
        if (pathMatch) {
          const sourceSlug = pathMatch[1].replace(/\/$/, "");
          const searchRes = await fetch(`${apiUrl}?slug=${encodeURIComponent(sourceSlug)}&status=any`, {
            headers: authHeaders,
          });
          if (searchRes.ok) {
            const posts: any[] = await searchRes.json();
            if (posts.length > 0) targetPostId = posts[0].id;
          }
        }
      } catch {}
    }

    const postData: Record<string, unknown> = { title, content, status };
    if (excerpt) postData.excerpt = excerpt;
    if (slug) {
      const cleanSlug = slug.replace(/^\/+|\/+$/g, "").split("/").pop() || slug;
      postData.slug = cleanSlug;
    }
    if (categories) postData.categories = categories;
    if (tags) postData.tags = tags;

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

    const wpRes = await fetch(targetUrl, {
      method,
      headers: authHeaders,
      body: JSON.stringify(postData),
    });

    const txt = await wpRes.text();
    let json: any = null;
    try {
      json = JSON.parse(txt);
    } catch {
      json = { raw: txt };
    }

    if (!wpRes.ok) {
      let errorMessage = json?.message || `WordPress error (${wpRes.status})`;
      if (wpRes.status === 401) errorMessage = "Authentication failed. Check username and application password.";
      if (wpRes.status === 403) errorMessage = "Permission denied. Ensure the user has publish capabilities.";
      if (wpRes.status === 404) errorMessage = "WordPress REST API not found. Ensure permalinks are enabled.";

      return new Response(
        JSON.stringify({ success: false, error: errorMessage, status: wpRes.status }),
        { status: 200, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        updated: !!targetPostId,
        post: {
          id: json.id,
          url: json.link,
          link: json.link,
          status: json.status,
          title: json.title?.rendered || title,
          slug: json.slug,
        },
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (e: any) {
    const msg = e?.message || String(e);
    const isTimeout = msg.includes("abort") || msg.includes("timeout");

    return new Response(
      JSON.stringify({
        success: false,
        error: isTimeout
          ? "Connection to WordPress timed out. Check URL and site availability."
          : msg,
      }),
      { status: 200, headers: corsHeaders }
    );
  }
};
