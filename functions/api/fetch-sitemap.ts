/// <reference types="@cloudflare/workers-types" />

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

async function fetchWithTimeout(
  url: string,
  timeout: number = 90000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ContentOptimizer/1.0)",
        "Accept": "application/xml, text/xml, text/html, */*",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export const onRequest: PagesFunction = async (context) => {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    let targetUrl: string | null = null;

    if (request.method === "GET") {
      const url = new URL(request.url);
      targetUrl = url.searchParams.get("url");
    } else if (request.method === "POST") {
      const body = await request.json();
      targetUrl = body.url;
    }

    if (!targetUrl) {
      return new Response(
        JSON.stringify({ error: "Missing 'url' parameter" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[Sitemap Fetch] Fetching: ${targetUrl}`);

    const response = await fetchWithTimeout(targetUrl, 90000);

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: `Upstream returned ${response.status}: ${response.statusText}`,
        }),
        {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const contentType = response.headers.get("content-type") || "text/plain";
    const text = await response.text();

    return new Response(text, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const isTimeout = errorMessage.includes("abort");

    console.error("[Sitemap Fetch Error]", errorMessage);

    return new Response(
      JSON.stringify({
        error: isTimeout ? "Request timed out" : errorMessage,
      }),
      {
        status: isTimeout ? 408 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};
