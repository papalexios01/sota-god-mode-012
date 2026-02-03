import { useRef, useState } from "react";
import { useOptimizerStore } from "@/lib/store";
import { 
  BookOpen, FileText, Target, RefreshCw, FolderOpen, Image,
  Zap, Plus, Upload, Link, Trash2, AlertCircle, ArrowRight,
  BarChart3, Search, Sparkles, Loader2, Bot
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/integrations/supabase/client";
import { crawlSitemapUrls, type SitemapCrawlProgress } from "@/lib/sitemap/crawlSitemap";
import { fetchSitemapTextRaced } from "@/lib/sitemap/fetchSitemapText";
import { discoverWordPressUrls } from "@/lib/sitemap/wordpressDiscovery";
import { GodModeDashboard } from "../GodModeDashboard";

const tabs = [
  { id: "bulk", label: "📚 Bulk Planner", icon: BookOpen },
  { id: "single", label: "📝 Single Article", icon: FileText },
  { id: "godmode", label: "⚡ God Mode 2.0", icon: Bot },
  { id: "gap", label: "🎯 Gap Analysis", icon: Target },
  { id: "refresh", label: "🔄 Quick Refresh", icon: RefreshCw },
  { id: "hub", label: "🗂️ Content Hub", icon: FolderOpen },
  { id: "image", label: "🖼️ Image Gen", icon: Image },
];

export function ContentStrategy() {
  const [activeTab, setActiveTab] = useState("bulk");
  const { 
    godModeEnabled, setGodModeEnabled,
    priorityOnlyMode, setPriorityOnlyMode,
    priorityUrls, addPriorityUrl, removePriorityUrl,
    excludedUrls, setExcludedUrls,
    excludedCategories, setExcludedCategories,
    sitemapUrls, setSitemapUrls,
    addContentItem,
    setCurrentStep
  } = useOptimizerStore();

  const [broadTopic, setBroadTopic] = useState("");
  const [keywords, setKeywords] = useState("");
  const [singleUrl, setSingleUrl] = useState("");
  const [sitemapUrl, setSitemapUrl] = useState("");
  const [newPriorityUrl, setNewPriorityUrl] = useState("");
  const [newPriority, setNewPriority] = useState<'critical' | 'high' | 'medium' | 'low'>('medium');
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageCount, setImageCount] = useState(1);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawledUrls, setCrawledUrls] = useState<string[]>([]);
  const [crawlFoundCount, setCrawlFoundCount] = useState(0);
  const [crawlStatus, setCrawlStatus] = useState<string>("");
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const crawlRunIdRef = useRef(0);
  const crawlAbortRef = useRef<AbortController | null>(null);

  // Filter to keep only blog post URLs (exclude images, feeds, categories, tags, etc.)
  const filterBlogPostUrls = (urls: string[]): string[] => {
    const excludePatterns = [
      /\/wp-content\//i,
      /\/wp-includes\//i,
      /\/wp-admin\//i,
      /\/feed\/?$/i,
      /\/rss\/?$/i,
      /\/atom\/?$/i,
      /\/category\//i,
      /\/tag\//i,
      /\/author\//i,
      /\/page\/\d+/i,
      /\/attachment\//i,
      /\/trackback\/?$/i,
      /\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|mp3|mp4|avi|mov)$/i,
      /\/sitemap[^/]*\.xml/i,
      /\/robots\.txt$/i,
      /\/favicon/i,
      /\/cdn-cgi\//i,
      /\/cart\/?$/i,
      /\/checkout\/?$/i,
      /\/my-account\/?$/i,
      /\/privacy-policy\/?$/i,
      /\/terms/i,
      /\/contact\/?$/i,
      /\/about\/?$/i,
      /\/search\/?/i,
      /\?/,  // exclude URLs with query params
    ];
    
    return urls.filter(url => {
      // Must have a path beyond just the domain
      try {
        const parsed = new URL(url);
        const path = parsed.pathname;
        // Skip homepage
        if (path === '/' || path === '') return false;
        // Skip if matches any exclude pattern
        for (const pattern of excludePatterns) {
          if (pattern.test(url)) return false;
        }
        return true;
      } catch {
        return false;
      }
    });
  };

  /**
   * ✅ ULTRA-FAST Sitemap Fetcher - Parallel Racing Strategy
   * 
   * Instead of sequential fallbacks (slow!), we race multiple strategies in parallel
   * and return the first successful result. This makes the crawl 5-10x faster.
   */
  const fetchSitemapText = async (targetUrl: string, externalSignal?: AbortSignal): Promise<string> => {
    const supabaseUrl = getSupabaseUrl();
    const anonKey = getSupabaseAnonKey();
    return fetchSitemapTextRaced(targetUrl, {
      supabaseUrl,
      supabaseAnonKey: anonKey,
      signal: externalSignal,
      // GearUpToFit's Yoast sitemaps can be slow/cold-start on the server; give the Supabase strategy time.
      perStrategyTimeoutMs: 25000,
      overallTimeoutMs: 35000,
    });
  };

  const handleGenerateContentPlan = () => {
    if (!broadTopic.trim()) return;
    // Add pillar content
    addContentItem({
      title: `Pillar: ${broadTopic}`,
      type: 'pillar',
      status: 'pending',
      primaryKeyword: broadTopic,
    });
    // Add some cluster content
    const clusters = ['Beginner Guide', 'Advanced Tips', 'Common Mistakes', 'Best Practices'];
    clusters.forEach(cluster => {
      addContentItem({
        title: `${broadTopic} - ${cluster}`,
        type: 'cluster',
        status: 'pending',
        primaryKeyword: `${broadTopic} ${cluster.toLowerCase()}`,
      });
    });
    setBroadTopic("");
    setCurrentStep(3);
  };

  const handleAddKeywords = () => {
    if (!keywords.trim()) return;
    const lines = keywords.split('\n').filter(k => k.trim());
    lines.forEach(keyword => {
      addContentItem({
        title: keyword.trim(),
        type: 'single',
        status: 'pending',
        primaryKeyword: keyword.trim(),
      });
    });
    setKeywords("");
  };

  const handleAddPriorityUrl = () => {
    if (!newPriorityUrl.trim()) return;
    addPriorityUrl(newPriorityUrl.trim(), newPriority);
    setNewPriorityUrl("");
  };

  const handleCrawlSitemap = async () => {
    if (!sitemapUrl.trim()) return;

     // Cancel any previous run immediately
     crawlAbortRef.current?.abort();
     const controller = new AbortController();
     crawlAbortRef.current = controller;
     const signal = controller.signal;

    const runId = (crawlRunIdRef.current += 1);
    setIsCrawling(true);
    setCrawledUrls([]);
    setCrawlFoundCount(0);
    setCrawlStatus("Starting…");
    setSelectedUrls(new Set());

    try {
      const input = sitemapUrl.trim();

      // ✅ FASTEST PATH (WordPress): Try server-side WP REST discovery FIRST (even if a sitemap XML was provided).
      // This bypasses giant Yoast post-sitemaps (often slow) and avoids browser CORS.
      try {
        const supabaseUrl = getSupabaseUrl();
        const anonKey = getSupabaseAnonKey();

        const tryWpDiscoverViaSupabase = async (): Promise<string[] | null> => {
          if (!supabaseUrl || !anonKey) return null;

          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort(), 20000);
          if (signal.aborted) throw new Error("Cancelled");
          signal.addEventListener("abort", () => controller.abort(), { once: true });

          try {
            const res = await fetch(`${supabaseUrl}/functions/v1/wp-discover`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: anonKey,
                Authorization: `Bearer ${anonKey}`,
              },
              body: JSON.stringify({ siteUrl: input, perPage: 100, maxPages: 250, maxUrls: 100000 }),
              signal: controller.signal,
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.success || !Array.isArray(data?.urls)) return null;
            return data.urls as string[];
          } finally {
            window.clearTimeout(timeoutId);
          }
        };

        setCrawlStatus("Trying WordPress API…");
        const wpUrls =
          (await tryWpDiscoverViaSupabase()) ??
          (await discoverWordPressUrls(input, {
            signal,
            timeoutMs: 8000,
            perPage: 100,
            maxPages: 50,
            maxUrls: 50000,
            onProgress: (p) => {
              if (crawlRunIdRef.current !== runId) return;
              const total = p.totalPages ? `/${p.totalPages}` : "";
              setCrawlStatus(`WP API • ${p.endpoint} page ${p.page}${total} • ${p.discovered.toLocaleString()} URLs`);
              setCrawlFoundCount(p.discovered);
            },
          }));

        if (wpUrls.length > 0) {
          if (crawlRunIdRef.current !== runId) return;
          const blogPostUrls = filterBlogPostUrls(wpUrls);
          setCrawledUrls(blogPostUrls);
          setSitemapUrls(blogPostUrls);
          setCrawlFoundCount(blogPostUrls.length);
          setCrawlStatus(`Done (WP API) • ${blogPostUrls.length.toLocaleString()} blog posts (filtered from ${wpUrls.length.toLocaleString()} total)`);
          toast.success(`Found ${blogPostUrls.length.toLocaleString()} URLs via WordPress API!`);
          return;
        }
      } catch (e) {
        // WP API is optional; fall back to sitemap crawl
        const msg = e instanceof Error ? e.message : String(e);
        // eslint-disable-next-line no-console
        console.info("[Sitemap] WordPress API discovery skipped/failed:", msg);
      }

      // ✅ Enterprise robustness: if the user provides a heavy/slow sitemap (e.g. post-sitemap.xml),
      // automatically try the common WordPress sitemap entrypoints too.
      const candidates: string[] = (() => {
        const normalize = (u: string) => {
          const t = u.trim();
          if (!t) return t;
          if (t.startsWith("http://") || t.startsWith("https://")) return t;
          return `https://${t}`;
        };
        const primary = normalize(input);
        const out: string[] = [];
        try {
          const url = new URL(primary);
          const origin = url.origin;
          const common = [
            `${origin}/sitemap_index.xml`,
            `${origin}/wp-sitemap.xml`,
            `${origin}/sitemap.xml`,
          ];
          // ✅ Prefer fast index entrypoints first; child sitemaps like post-sitemap.xml can be huge/slow.
          for (const c of common) if (!out.includes(c)) out.push(c);
        } catch {
          // If URL parsing fails, just keep the original input.
        }

        // Always include the user's exact input as a fallback (last).
        if (primary && !out.includes(primary)) out.push(primary);

        return out;
      })();

      const crawlOptions = {
        // ✅ HIGH concurrency for speed - parallel racing handles reliability
        concurrency: 8,
        // ✅ HARD cap per-sitemap fetch+parse time so we never “hang” on one URL
        fetchTimeoutMs: 35000,
        signal,
        onProgress: (p: SitemapCrawlProgress) => {
          if (crawlRunIdRef.current !== runId) return;
          setCrawlFoundCount(p.discoveredUrls);
          const speed = p.processedSitemaps > 0 ? `~${Math.round(p.discoveredUrls / Math.max(1, p.processedSitemaps))} URLs/sitemap` : '';
          setCrawlStatus(
            p.currentSitemap
              ? `⚡ ${p.currentSitemap.split('/').pop()} • ${p.processedSitemaps} done • ${p.queuedSitemaps} queued • ${p.discoveredUrls} URLs ${speed}`
              : `⚡ ${p.processedSitemaps} sitemaps • ${p.discoveredUrls} URLs ${speed}`
          );
        },
        onUrlsBatch: (batch: string[]) => {
          if (crawlRunIdRef.current !== runId) return;
          const filtered = filterBlogPostUrls(batch);
          setCrawledUrls((prev) => {
            const merged = [...prev, ...filtered];
            return Array.from(new Set(merged));
          });
        },
      };

      let allUrls: string[] = [];
      const candidateErrors: string[] = [];
      for (const candidate of candidates) {
        if (crawlRunIdRef.current !== runId) return;
        setCrawlStatus(`Trying sitemap entry: ${candidate}`);
        try {
          allUrls = await crawlSitemapUrls(candidate, fetchSitemapText, crawlOptions);
          if (allUrls.length > 0) break;
          candidateErrors.push(`${candidate}: no URLs found`);
        } catch (e) {
          if (signal.aborted) {
            throw new Error("Crawl cancelled");
          }
          const msg = e instanceof Error ? e.message : "Failed to crawl sitemap";
          candidateErrors.push(`${candidate}: ${msg}`);
        }
      }

      if (allUrls.length === 0) {
        throw new Error(`No URLs found. Attempts: ${candidateErrors.join(" | ")}`);
      }

      if (allUrls.length === 0) {
        throw new Error("No page URLs found in sitemap");
      }

      if (crawlRunIdRef.current !== runId) return;

      // Filter to blog posts only
      const blogPostUrls = filterBlogPostUrls(allUrls);
      setCrawledUrls(blogPostUrls);
      setSitemapUrls(blogPostUrls);
      setCrawlFoundCount(blogPostUrls.length);
      setCrawlStatus(`Done • ${blogPostUrls.length.toLocaleString()} blog posts (filtered from ${allUrls.length.toLocaleString()} total)`);
      toast.success(`Found ${blogPostUrls.length} blog post URLs!`);
    } catch (error) {
      if (signal.aborted || (error instanceof Error && /crawl cancelled/i.test(error.message))) {
        if (crawlRunIdRef.current === runId) {
          setCrawlStatus("Cancelled.");
          toast.info("Crawl cancelled");
        }
        return;
      }
      console.error("[Sitemap] Crawl error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to crawl sitemap");
    } finally {
      if (crawlAbortRef.current === controller) {
        crawlAbortRef.current = null;
      }
      if (crawlRunIdRef.current === runId) {
        setIsCrawling(false);
      }
    }
  };

  const cancelCrawl = () => {
    // Invalidate all callbacks
    crawlRunIdRef.current += 1;
    crawlAbortRef.current?.abort();
    crawlAbortRef.current = null;
    setIsCrawling(false);
    setCrawlStatus("Cancelled.");
  };

  const toggleUrlSelection = (url: string) => {
    setSelectedUrls(prev => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };

  const selectAllUrls = () => {
    setSelectedUrls(new Set(crawledUrls));
  };

  const deselectAllUrls = () => {
    setSelectedUrls(new Set());
  };

  const handleAddSelectedToRewrite = () => {
    if (selectedUrls.size === 0) return;
    
    selectedUrls.forEach(url => {
      // Extract a title from the URL
      const urlPath = new URL(url).pathname;
      const slug = urlPath.split('/').filter(Boolean).pop() || 'untitled';
      const title = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      
      addContentItem({
        title: `Rewrite: ${title}`,
        type: 'refresh',
        status: 'pending',
        primaryKeyword: title.toLowerCase(),
        url: url,
      });
    });
    
    toast.success(`Added ${selectedUrls.size} URLs to rewrite queue!`);
    setSelectedUrls(new Set());
    setCurrentStep(3);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <BarChart3 className="w-7 h-7 text-primary" />
          2. Content Strategy & Planning
        </h1>
        <p className="text-muted-foreground mt-1">
          Plan, generate, and optimize your content with AI-powered tools.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 bg-card border border-border rounded-2xl p-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-card border border-border rounded-2xl p-6">
        {activeTab === "bulk" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center">
                <BookOpen className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Bulk Content Planner</h3>
                <p className="text-sm text-muted-foreground">
                  Enter a broad topic to generate a pillar page and cluster content plan.
                </p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Broad Topic</label>
              <input
                type="text"
                value={broadTopic}
                onChange={(e) => setBroadTopic(e.target.value)}
                placeholder="e.g., 'Sustainable Living' or 'Python Programming'"
                className="w-full px-4 py-3 bg-background border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <button
              onClick={handleGenerateContentPlan}
              disabled={!broadTopic.trim()}
              className="w-full px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Zap className="w-5 h-5" />
              🚀 Generate Content Plan
            </button>
          </div>
        )}

        {activeTab === "single" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center">
                <FileText className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Single Article Generator</h3>
                <p className="text-sm text-muted-foreground">
                  Enter primary keywords (one per line) to generate articles.
                </p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Primary Keywords (one per line)
              </label>
              <textarea
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="best running shoes 2026&#10;how to train for marathon&#10;running injury prevention"
                rows={5}
                className="w-full px-4 py-3 bg-background border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleAddKeywords}
                disabled={!keywords.trim()}
                className="flex-1 px-6 py-3 bg-muted text-foreground font-semibold rounded-xl hover:bg-muted/80 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5" />
                ➕ Add to Queue
              </button>
              <button
                onClick={() => { handleAddKeywords(); setCurrentStep(3); }}
                className="px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 flex items-center gap-2"
              >
                Go to Review <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {activeTab === "godmode" && (
          <GodModeDashboard />
        )}

        {activeTab === "gap" && (
          <div className="space-y-6">
            {/* Priority Only Mode Toggle */}
            <label className="flex items-center gap-3 cursor-pointer p-4 bg-muted/30 rounded-xl border border-border">
              <input
                type="checkbox"
                checked={priorityOnlyMode}
                onChange={(e) => setPriorityOnlyMode(e.target.checked)}
                className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50"
              />
              <div>
                <span className="font-medium text-foreground">🎯 Priority Only Mode</span>
                <p className="text-xs text-muted-foreground">
                  Restricts God Mode to ONLY optimize URLs in your Priority Queue. Ignores sitemap scan.
                </p>
              </div>
            </label>

            {/* Priority URL Queue */}
            <div className="border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-foreground flex items-center gap-2">
                  <Target className="w-5 h-5 text-primary" />
                  PRIORITY URL QUEUE
                </h4>
                <span className="text-sm text-muted-foreground">{priorityUrls.length} Total</span>
              </div>

              <div className="space-y-3">
                <div className="flex gap-2">
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as any)}
                    className="px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground"
                  >
                    <option value="critical">critical</option>
                    <option value="high">high</option>
                    <option value="medium">medium</option>
                    <option value="low">low</option>
                  </select>
                  <input
                    type="url"
                    value={newPriorityUrl}
                    onChange={(e) => setNewPriorityUrl(e.target.value)}
                    placeholder="Enter URL to Optimize"
                    className="flex-1 px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <button
                    onClick={handleAddPriorityUrl}
                    disabled={!newPriorityUrl.trim()}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {priorityUrls.length > 0 && (
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {priorityUrls.map(url => (
                      <div key={url.id} className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-sm">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-xs font-medium",
                          url.priority === 'critical' && "bg-red-500/20 text-red-400",
                          url.priority === 'high' && "bg-orange-500/20 text-orange-400",
                          url.priority === 'medium' && "bg-yellow-500/20 text-yellow-400",
                          url.priority === 'low' && "bg-green-500/20 text-green-400"
                        )}>
                          {url.priority}
                        </span>
                        <span className="flex-1 truncate text-foreground">{url.url}</span>
                        <button 
                          onClick={() => removePriorityUrl(url.id)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  💡 Pro Tip: URLs added here will be prioritized over automatic sitemap scanning.
                </p>
              </div>
            </div>

            {/* Exclusion Controls */}
            <div className="border border-border rounded-xl p-4">
              <h4 className="font-semibold text-foreground mb-3">🚫 Exclusion Controls</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Exclude URLs (one per line)
                  </label>
                  <textarea
                    value={excludedUrls.join('\n')}
                    onChange={(e) => setExcludedUrls(e.target.value.split('\n').filter(u => u.trim()))}
                    rows={4}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground resize-none"
                    placeholder="/privacy-policy&#10;/terms-of-service"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Exclude Categories (one per line)
                  </label>
                  <textarea
                    value={excludedCategories.join('\n')}
                    onChange={(e) => setExcludedCategories(e.target.value.split('\n').filter(c => c.trim()))}
                    rows={4}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground resize-none"
                    placeholder="uncategorized&#10;archive"
                  />
                </div>
              </div>
            </div>

            {sitemapUrls.length === 0 && (
              <div className="flex items-center gap-2 px-4 py-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-yellow-400 text-sm">
                <AlertCircle className="w-5 h-5" />
                Sitemap Required: Please crawl your sitemap in the "Quick Refresh" tab first.
              </div>
            )}
          </div>
        )}

        {activeTab === "refresh" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center">
                <RefreshCw className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Quick Refresh & Validate</h3>
                <p className="text-sm text-muted-foreground">
                  Update existing content with fresh data and improved SEO.
                </p>
              </div>
            </div>

            <div className="flex gap-2 mb-4">
              <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium">
                Single URL
              </button>
              <button className="px-4 py-2 bg-muted text-muted-foreground rounded-lg text-sm font-medium hover:text-foreground">
                Bulk via Sitemap
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Post URL to Refresh</label>
              <input
                type="url"
                value={singleUrl}
                onChange={(e) => setSingleUrl(e.target.value)}
                placeholder="https://your-site.com/post-to-refresh"
                className="w-full px-4 py-3 bg-background border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <button
              disabled={!singleUrl.trim()}
              className="w-full px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-5 h-5" />
              🔄 Refresh & Validate
            </button>
          </div>
        )}

        {activeTab === "hub" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center">
                <FolderOpen className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Content Hub & Rewrite Assistant</h3>
                <p className="text-sm text-muted-foreground">
                  Crawl your sitemap, analyze content health, and generate strategic rewrites.
                </p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Sitemap URL</label>
              <input
                type="url"
                value={sitemapUrl}
                onChange={(e) => setSitemapUrl(e.target.value)}
                placeholder="https://your-site.com/sitemap.xml"
                className="w-full px-4 py-3 bg-background border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <button
              onClick={isCrawling ? cancelCrawl : handleCrawlSitemap}
              disabled={!isCrawling && !sitemapUrl.trim()}
              className="w-full px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isCrawling ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Crawling… ({crawlFoundCount.toLocaleString()} URLs) • Click to stop
                </>
              ) : (
                <>
                  <Search className="w-5 h-5" />
                  🔍 Crawl Sitemap
                </>
              )}
            </button>

            {isCrawling && crawlStatus && (
              <div className="text-xs text-muted-foreground">{crawlStatus}</div>
            )}

            {/* Show crawled URLs with checkboxes */}
            {(crawledUrls.length > 0 || crawlFoundCount > 0) && (
              <div className="mt-4 p-4 bg-muted/50 rounded-xl">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-foreground">
                    ✅ Found {crawledUrls.length.toLocaleString()} Blog Posts
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={selectAllUrls}
                      className="px-3 py-1 text-xs bg-primary/20 text-primary rounded-lg hover:bg-primary/30"
                    >
                      Select All
                    </button>
                    <button
                      onClick={deselectAllUrls}
                      className="px-3 py-1 text-xs bg-muted text-muted-foreground rounded-lg hover:bg-muted/80"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>
                
                {selectedUrls.size > 0 && (
                  <div className="mb-3 flex items-center justify-between bg-primary/10 border border-primary/30 rounded-lg px-3 py-2">
                    <span className="text-sm text-primary font-medium">
                      {selectedUrls.size} URL{selectedUrls.size !== 1 ? 's' : ''} selected
                    </span>
                    <button
                      onClick={handleAddSelectedToRewrite}
                      className="px-4 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Add to Rewrite Queue
                    </button>
                  </div>
                )}
                
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {crawledUrls.map((url, idx) => (
                    <label
                      key={idx}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors",
                        selectedUrls.has(url) ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/50"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedUrls.has(url)}
                        onChange={() => toggleUrlSelection(url)}
                        className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50"
                      />
                      <span className="text-sm text-foreground truncate flex-1">{url}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "image" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center">
                <Image className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">SOTA Image Generator</h3>
                <p className="text-sm text-muted-foreground">
                  Generate high-quality images using DALL-E 3 or Gemini Imagen.
                </p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Image Prompt</label>
              <textarea
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                placeholder="A professional photo of..."
                rows={3}
                className="w-full px-4 py-3 bg-background border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Number of Images</label>
                <select
                  value={imageCount}
                  onChange={(e) => setImageCount(Number(e.target.value))}
                  className="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-foreground"
                >
                  {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Aspect Ratio</label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-foreground"
                >
                  <option value="1:1">1:1 (Square)</option>
                  <option value="16:9">16:9 (Landscape)</option>
                  <option value="9:16">9:16 (Portrait)</option>
                  <option value="4:3">4:3 (Standard)</option>
                </select>
              </div>
            </div>
            <button
              disabled={!imagePrompt.trim()}
              className="w-full px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Sparkles className="w-5 h-5" />
              🎨 Generate Images
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
