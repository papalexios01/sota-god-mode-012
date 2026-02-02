import { useState } from "react";
import { useOptimizerStore } from "@/lib/store";
import { 
  FileText, Check, X, AlertCircle, Trash2, 
  Sparkles, ArrowUpDown, Eye, Brain,
  CheckCircle, Clock, XCircle, Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createOrchestrator, globalPerformanceTracker, type GeneratedContent } from "@/lib/sota";
import { ContentPreviewModal } from "../ContentPreviewModal";
import { GenerationProgressModal } from "../GenerationProgressModal";
import { ContentIntelligenceDashboard } from "../ContentIntelligenceDashboard";

export function ReviewExport() {
  const { 
    contentItems, 
    updateContentItem, 
    removeContentItem,
    config,
    sitemapUrls 
  } = useOptimizerStore();
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [sortField, setSortField] = useState<'title' | 'type' | 'status'>('title');
  const [sortAsc, setSortAsc] = useState(true);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [previewContent, setPreviewContent] = useState<GeneratedContent | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [currentPhase, setCurrentPhase] = useState('');
  const [generationError, setGenerationError] = useState<string | undefined>();

  const toggleSelect = (id: string) => {
    setSelectedItems(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedItems.length === contentItems.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(contentItems.map(i => i.id));
    }
  };

  const handleGenerate = async () => {
    const toGenerate = contentItems.filter(i => selectedItems.includes(i.id) && i.status === 'pending');
    if (toGenerate.length === 0) return;

    setIsGenerating(true);
    setGenerationProgress(0);
    setGenerationError(undefined);

    const orchestrator = createOrchestrator({
      apiKeys: {
        geminiApiKey: config.geminiApiKey,
        openaiApiKey: config.openaiApiKey,
        anthropicApiKey: config.anthropicApiKey,
        openrouterApiKey: config.openrouterApiKey,
        groqApiKey: config.groqApiKey,
        serperApiKey: config.serperApiKey,
        // Pass custom model IDs for OpenRouter and Groq
        openrouterModelId: config.openrouterModelId,
        groqModelId: config.groqModelId,
      },
      organizationName: config.organizationName || 'Content Hub',
      organizationUrl: config.wpUrl || 'https://example.com',
      logoUrl: config.logoUrl,
      authorName: config.authorName || 'Content Team',
      sitePages: sitemapUrls.map(url => ({ url, title: url.split('/').pop() || '' })),
      primaryModel: config.primaryModel,
      useConsensus: false,
    });

    let completed = 0;
    for (const item of toGenerate) {
      updateContentItem(item.id, { status: 'generating' });
      setCurrentPhase(`Generating: ${item.title}`);
      
      try {
        const result = await orchestrator.generateContent({
          keyword: item.primaryKeyword,
          title: item.title,
          onProgress: (msg) => setCurrentPhase(msg),
        });

        updateContentItem(item.id, { 
          status: 'completed', 
          content: result.content,
          wordCount: result.metrics.wordCount,
        });

        globalPerformanceTracker.recordMetrics({
          timestamp: Date.now(),
          contentQualityScore: result.qualityScore.overall,
          aeoScore: result.qualityScore.seo,
          internalLinkDensity: result.internalLinks.length * 10,
          semanticRichness: result.qualityScore.eeat,
          processingSpeed: Date.now(),
          wordCount: result.metrics.wordCount,
          modelUsed: result.model,
          cacheHit: false,
          keyword: item.primaryKeyword,
        });
      } catch (error) {
        updateContentItem(item.id, { status: 'error', error: String(error) });
        setGenerationError(String(error));
      }

      completed++;
      setGenerationProgress(Math.round((completed / toGenerate.length) * 100));
    }

    setIsGenerating(false);
    setSelectedItems([]);
  };

  const sortedItems = [...contentItems].sort((a, b) => {
    const aVal = a[sortField];
    const bVal = b[sortField];
    if (aVal < bVal) return sortAsc ? -1 : 1;
    if (aVal > bVal) return sortAsc ? 1 : -1;
    return 0;
  });

  const stats = {
    total: contentItems.length,
    completed: contentItems.filter(i => i.status === 'completed').length,
    pending: contentItems.filter(i => i.status === 'pending').length,
    errors: contentItems.filter(i => i.status === 'error').length,
  };

  // Check if any AI provider key is configured
  const hasAiProvider = !!(
    config.geminiApiKey || 
    config.openaiApiKey || 
    config.anthropicApiKey ||
    config.openrouterApiKey ||
    config.groqApiKey
  );
  const hasSerper = !!config.serperApiKey;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <FileText className="w-7 h-7 text-primary" />
          3. Review & Export
        </h1>
        <p className="text-muted-foreground mt-1">
          Review generated content and publish to WordPress.
        </p>
      </div>

      {/* Status Indicators */}
      <div className="flex flex-wrap gap-4 text-sm">
        <StatusBadge 
          ok={!!hasAiProvider} 
          label="AI Provider" 
        />
        <StatusBadge 
          ok={!!hasSerper} 
          label="Serper (YouTube/References)" 
        />
        <StatusBadge 
          ok={!!(config.enableNeuronWriter && config.neuronWriterApiKey)} 
          label="NeuronWriter (Optional)"
          optional 
        />
        <StatusBadge 
          ok={sitemapUrls.length > 0}
          label={`Sitemap (${sitemapUrls.length} pages)`}
          optional 
        />
      </div>

      {!hasSerper && (
        <div className="flex items-center gap-2 px-4 py-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-yellow-400 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>
            Missing Serper API Key: YouTube videos and reference citations will NOT be added.{" "}
            <a href="https://serper.dev" target="_blank" rel="noopener noreferrer" className="underline">
              Get your free key at serper.dev
            </a>
          </span>
        </div>
      )}

      {/* Action Bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          <button
            onClick={handleGenerate}
            disabled={selectedItems.length === 0 || !hasAiProvider || isGenerating}
            className="px-6 py-2.5 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
            {isGenerating ? 'Generating...' : `✨ Generate Selected (${selectedItems.length})`}
          </button>
          <button
            onClick={() => setShowAnalytics(!showAnalytics)}
            className={cn(
              "px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 transition-colors",
              showAnalytics 
                ? "bg-primary text-primary-foreground" 
                : "bg-muted text-foreground hover:bg-muted/80"
            )}
          >
            <Brain className="w-5 h-5" />
            Analytics
          </button>
        </div>

        {/* Stats */}
        <div className="flex gap-6 text-sm">
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">{stats.total}</div>
            <div className="text-muted-foreground">Total Items</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-400">{stats.completed}</div>
            <div className="text-muted-foreground">Completed</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-yellow-400">{stats.pending}</div>
            <div className="text-muted-foreground">Pending</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-400">{stats.errors}</div>
            <div className="text-muted-foreground">Errors</div>
          </div>
        </div>
      </div>

      {/* Content Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="p-4 text-left">
                <input
                  type="checkbox"
                  checked={selectedItems.length === contentItems.length && contentItems.length > 0}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50"
                />
              </th>
              <th 
                className="p-4 text-left text-sm font-medium text-foreground cursor-pointer hover:text-primary"
                onClick={() => { setSortField('title'); setSortAsc(!sortAsc); }}
              >
                <span className="flex items-center gap-1">
                  Title <ArrowUpDown className="w-3 h-3" />
                </span>
              </th>
              <th 
                className="p-4 text-left text-sm font-medium text-foreground cursor-pointer hover:text-primary"
                onClick={() => { setSortField('type'); setSortAsc(!sortAsc); }}
              >
                <span className="flex items-center gap-1">
                  Type <ArrowUpDown className="w-3 h-3" />
                </span>
              </th>
              <th 
                className="p-4 text-left text-sm font-medium text-foreground cursor-pointer hover:text-primary"
                onClick={() => { setSortField('status'); setSortAsc(!sortAsc); }}
              >
                <span className="flex items-center gap-1">
                  Status <ArrowUpDown className="w-3 h-3" />
                </span>
              </th>
              <th className="p-4 text-left text-sm font-medium text-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedItems.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted-foreground">
                  No items found. Go to Setup to add content or use Strategy to discover topics.
                </td>
              </tr>
            ) : (
              sortedItems.map(item => (
                <tr key={item.id} className="border-b border-border hover:bg-muted/20">
                  <td className="p-4">
                    <input
                      type="checkbox"
                      checked={selectedItems.includes(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50"
                    />
                  </td>
                  <td className="p-4">
                    <div className="font-medium text-foreground">{item.title}</div>
                    <div className="text-xs text-muted-foreground">{item.primaryKeyword}</div>
                  </td>
                  <td className="p-4">
                    <span className={cn(
                      "px-2 py-1 rounded text-xs font-medium",
                      item.type === 'pillar' && "bg-purple-500/20 text-purple-400",
                      item.type === 'cluster' && "bg-blue-500/20 text-blue-400",
                      item.type === 'single' && "bg-green-500/20 text-green-400",
                      item.type === 'refresh' && "bg-yellow-500/20 text-yellow-400"
                    )}>
                      {item.type}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={cn(
                      "flex items-center gap-1.5 text-sm",
                      item.status === 'pending' && "text-yellow-400",
                      item.status === 'generating' && "text-blue-400",
                      item.status === 'completed' && "text-green-400",
                      item.status === 'error' && "text-red-400"
                    )}>
                      {item.status === 'pending' && <Clock className="w-4 h-4" />}
                      {item.status === 'generating' && <Loader2 className="w-4 h-4 animate-spin" />}
                      {item.status === 'completed' && <CheckCircle className="w-4 h-4" />}
                      {item.status === 'error' && <XCircle className="w-4 h-4" />}
                      {item.status}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <button 
                        className="p-1.5 text-muted-foreground hover:text-foreground rounded"
                        title="Preview"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => removeContentItem(item.id)}
                        className="p-1.5 text-muted-foreground hover:text-destructive rounded"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Analytics Dashboard */}
      {showAnalytics && (
        <div className="bg-card border border-border rounded-2xl p-6">
          <ContentIntelligenceDashboard />
        </div>
      )}

      {/* Generation Progress Modal */}
      <GenerationProgressModal
        isOpen={isGenerating}
        onClose={() => setIsGenerating(false)}
        keyword={contentItems.find(i => i.status === 'generating')?.primaryKeyword || ''}
        steps={[]}
        progress={generationProgress}
        currentPhase={currentPhase}
        error={generationError}
      />

      {/* Content Preview Modal */}
      <ContentPreviewModal
        content={previewContent}
        onClose={() => setPreviewContent(null)}
      />
    </div>
  );
}

function StatusBadge({ ok, label, optional }: { ok: boolean; label: string; optional?: boolean }) {
  if (optional && !ok) {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="w-2 h-2 rounded-full bg-muted-foreground" />
        {label}
      </span>
    );
  }
  
  return (
    <span className={cn(
      "flex items-center gap-1.5",
      ok ? "text-green-400" : "text-red-400"
    )}>
      {ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
      {label}
    </span>
  );
}
