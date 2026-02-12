/// <reference types="@cloudflare/workers-types" />

interface Env {}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "[::1]",
  "metadata.google.internal",
  "metadata.internal",
  "instance-data",
]);

function isPublicUrl(input: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) return false;
  if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;

  if (hostname.startsWith("[")) {
    const ipv6 = hostname.slice(1, -1).toLowerCase();
    if (
      ipv6 === "::1" || ipv6 === "::" ||
      ipv6.startsWith("fc") || ipv6.startsWith("fd") ||
      ipv6.startsWith("fe8") || ipv6.startsWith("fe9") ||
      ipv6.startsWith("fea") || ipv6.startsWith("feb") ||
      ipv6.startsWith("::ffff:127.") || ipv6.startsWith("::ffff:10.") ||
      ipv6.startsWith("::ffff:192.168.") || ipv6.startsWith("::ffff:169.254.")
    ) return false;
  }

  const parts = hostname.split(".").map(Number);
  if (parts.length === 4 && parts.every((n) => !isNaN(n) && n >= 0 && n <= 255)) {
    if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) return false;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    if (parts[0] === 192 && parts[1] === 168) return false;
    if (parts[0] === 169 && parts[1] === 254) return false;
  }

  if (/^0x[0-9a-f]+$/i.test(hostname) || /^\d+$/.test(hostname)) return false;

  return true;
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*", // TODO: Replace with your domain in production
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");

  if (!targetUrl) {
    return new Response(JSON.stringify({ success: false, error: "Missing url parameter" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!isPublicUrl(targetUrl)) {
    return new Response(
      JSON.stringify({ success: false, error: "URL must be a public HTTP/HTTPS address" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SOTA-Bot/3.0)",
        Accept: "application/xml, text/xml, text/html, */*",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return new Response(
        JSON.stringify({ success: false, error: `Upstream returned ${response.status}: ${response.statusText}` }),
        {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
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
    const message = error instanceof Error ? error.message : "Failed to fetch upstream URL";
    const isTimeout = message.includes("abort");

    return new Response(
      JSON.stringify({ success: false, error: isTimeout ? "Request timed out" : message }),
      {
        status: isTimeout ? 408 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
};
