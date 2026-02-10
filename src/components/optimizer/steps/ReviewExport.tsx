import { useState, useCallback, useMemo } from "react";
import { useOptimizerStore, type ContentItem, type GeneratedContentStore, type NeuronWriterDataStore } from "@/lib/store";
import {
  FileText, Check, X, AlertCircle, Trash2,
  Sparkles, ArrowUpDown, Eye, Brain,
  CheckCircle, Clock, XCircle, Loader2, Database, Upload
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createOrchestrator, globalPerformanceTracker, type GeneratedContent, type NeuronWriterAnalysis } from "@/lib/sota";
import { ContentViewerPanel } from "../ContentViewerPanel";
import { EnhancedGenerationModal, type GenerationStep } from "../EnhancedGenerationModal";
import { ContentIntelligenceDashboard } from "../ContentIntelligenceDashboard";
import { useSupabaseSyncContext } from "@/providers/SupabaseSyncProvider";
import { useWordPressPublish } from "@/hooks/useWordPressPublish";
import { toast } from "sonner";

// Helper to reconstruct GeneratedContent from persisted store (minimal shape for viewer)
function reconstructGeneratedContent(stored: GeneratedContentStore[string] | undefined): GeneratedContent | null {
  if (!stored) return null;
  return {
    id: stored.id,
    title: stored.title,
    seoTitle: stored.seoTitle,
    content: stored.content,
    metaDescription: stored.metaDescription,
    slug: stored.slug,
    primaryKeyword: stored.primaryKeyword,
    secondaryKeywords: stored.secondaryKeywords,
    metrics: {
      wordCount: stored.wordCount,
      sentenceCount: Math.round(stored.wordCount / 15),
      paragraphCount: Math.round(stored.wordCount / 100),
      headingCount: 10,
      imageCount: 0,
      linkCount: stored.internalLinks?.length || 0,
      keywordDensity: 1.5,
      readabilityGrade: 7,
      estimatedReadTime: Math.ceil(stored.wordCount / 200),
    },
    qualityScore: {
      ...stored.qualityScore,
      passed: stored.qualityScore.overall >= 85,
      improvements: [],
    },
    internalLinks: (stored.internalLinks || []).map(l => ({
      ...l,
      priority: 1,
      relevanceScore: 0.8,
    })),
    schema: (stored.schema as GeneratedContent['schema']) || { '@context': 'https://schema.org', '@graph': [] },
    eeat: {
      author: { name: '', credentials: [], publications: [], expertiseAreas: [], socialProfiles: [] },
      citations: [],
      expertReviews: [],
      methodology: '',
      lastUpdated: new Date(),
      factChecked: false,
    },
    serpAnalysis: stored.serpAnalysis ? {
      avgWordCount: stored.serpAnalysis.avgWordCount,
      recommendedWordCount: stored.serpAnalysis.recommendedWordCount,
      userIntent: stored.serpAnalysis.userIntent as 'informational' | 'transactional' | 'navigational' | 'commercial',
      commonHeadings: [],
      contentGaps: [],
      semanticEntities: [],
      topCompetitors: [],
      recommendedHeadings: [],
    } : {
      avgWordCount: stored.wordCount,
      recommendedWordCount: 2500,
      userIntent: 'informational' as const,
      commonHeadings: [],
      contentGaps: [],
      semanticEntities: [],
      topCompetitors: [],
      recommendedHeadings: [],
    },
    generatedAt: new Date(stored.generatedAt),
    model: stored.model as GeneratedContent['model'],
    consensusUsed: false,
    neuronWriterQueryId: stored.neuronWriterQueryId,
  };
}

// Helper to reconstruct NeuronWriterAnalysis from persisted store
function reconstructNeuronData(stored: NeuronWriterDataStore[string] | undefined): NeuronWriterAnalysis | null {
  if (!stored) return null;
  return {
    query_id: stored.query_id,
    keyword: stored.keyword,
    status: stored.status,
    terms: stored.terms.map(t => ({ ...t, type: t.type as 'required' | 'recommended' | 'optional' })),
    termsExtended: stored.termsExtended?.map(t => ({ ...t, type: t.type as 'required' | 'recommended' | 'optional' })) || [],
    entities: stored.entities?.map(e => ({ entity: e.entity, type: e.type, usage_pc: e.usage_pc })) || [],
    headingsH2: stored.headingsH2?.map(h => ({ text: h.text, level: 'h2' as const, usage_pc: h.usage_pc })) || [],
    headingsH3: stored.headingsH3?.map(h => ({ text: h.text, level: 'h3' as const, usage_pc: h.usage_pc })) || [],
    recommended_length: stored.recommended_length,
    content_score: stored.content_score,
    competitors: [],
  };
}

export function ReviewExport() {
  const {
    contentItems,
    updateContentItem,
    removeContentItem,
    config,
    sitemapUrls,
    // Persisted stores - survives navigation!
    generatedContentsStore,
    setGeneratedContent,
    removeGeneratedContent,
    neuronWriterDataStore,
    setNeuronWriterData,
    removeNeuronWriterData,
  } = useOptimizerStore();

  // Supabase sync for database persistence
  const { saveToSupabase, isConnected: dbConnected, isLoading: dbLoading, tableMissing, error: dbError, isOfflineMode } = useSupabaseSyncContext();
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [sortField, setSortField] = useState<'title' | 'type' | 'status'>('title');
  const [sortAsc, setSortAsc] = useState(true);
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Content Viewer State - now uses persisted store
  const [viewingItem, setViewingItem] = useState<ContentItem | null>(null);

  // Generation State
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [generationSteps, setGenerationSteps] = useState<GenerationStep[]>([]);
  const [generationError, setGenerationError] = useState<string | undefined>();
  const [generatingItems, setGeneratingItems] = useState<Array<{
    id: string;
    title: string;
    keyword: string;
    status: 'pending' | 'generating' | 'completed' | 'error';
    progress: number;
    currentStep?: string;
    error?: string;
  }>>([]);

  // ── Bulk Publish State ──
  const { publish, isConfigured: wpConfigured } = useWordPressPublish();
  const [isBulkPublishing, setIsBulkPublishing] = useState(false);
  const [showBulkPublishModal, setShowBulkPublishModal] = useState(false);
  const [bulkPublishStatus, setBulkPublishStatus] = useState<'idle' | 'draft' | 'publish'>('draft');
  const [bulkPublishItems, setBulkPublishItems] = useState<Array<{
    id: string;
    title: string;
    status: 'pending' | 'publishing' | 'published' | 'error';
    error?: string;
    postUrl?: string;
  }>>([]);

  // Count selected completed items that can be published
  const publishableSelected = useMemo(() => {
    return contentItems.filter(
      i => selectedItems.includes(i.id) && i.status === 'completed' && generatedContentsStore[i.id]
    );
  }, [contentItems, selectedItems, generatedContentsStore]);

  const allPublishable = useMemo(() => {
    return contentItems.filter(
      i => i.status === 'completed' && generatedContentsStore[i.id]
    );
  }, [contentItems, generatedContentsStore]);

  const handleBulkPublish = useCallback(async () => {
    const itemsToPublish = publishableSelected.length > 0 ? publishableSelected : allPublishable;
    if (itemsToPublish.length === 0 || !wpConfigured) return;

    setIsBulkPublishing(true);
    const items = itemsToPublish.map(item => ({
      id: item.id,
      title: item.title,
      status: 'pending' as const,
    }));
    setBulkPublishItems(items);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < itemsToPublish.length; i++) {
      const item = itemsToPublish[i];
      const stored = generatedContentsStore[item.id];
      if (!stored) continue;

      setBulkPublishItems(prev =>
        prev.map((p, idx) => idx === i ? { ...p, status: 'publishing' } : p)
      );

      try {
        const cleanTitle = (stored.seoTitle || stored.title || item.title)
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .trim();

        const result = await publish(cleanTitle, stored.content, {
          status: bulkPublishStatus === 'publish' ? 'publish' : 'draft',
          slug: stored.slug,
          metaDescription: stored.metaDescription,
          seoTitle: stored.seoTitle,
          sourceUrl: item.url,
        });

        if (result.success) {
          successCount++;
          setBulkPublishItems(prev =>
            prev.map((p, idx) => idx === i ? { ...p, status: 'published', postUrl: result.postUrl } : p)
          );
        } else {
          errorCount++;
          setBulkPublishItems(prev =>
            prev.map((p, idx) => idx === i ? { ...p, status: 'error', error: result.error } : p)
          );
        }
      } catch (err) {
        errorCount++;
        setBulkPublishItems(prev =>
          prev.map((p, idx) => idx === i ? {
            ...p,
            status: 'error',
            error: err instanceof Error ? err.message : 'Unknown error',
          } : p)
        );
      }

      // Small delay between publishes to avoid overwhelming the API
      if (i < itemsToPublish.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    setIsBulkPublishing(false);

    if (successCount > 0 && errorCount === 0) {
      toast.success(`✅ All ${successCount} posts published successfully!`);
    } else if (successCount > 0) {
      toast.warning(`Published ${successCount} posts, ${errorCount} failed`);
    } else {
      toast.error(`Failed to publish all ${errorCount} posts`);
    }
  }, [publishableSelected, allPublishable, wpConfigured, generatedContentsStore, publish, bulkPublishStatus]);

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

  // Create default steps
  const createDefaultSteps = (): GenerationStep[] => [
    { id: 'research', label: 'SERP Analysis', description: 'Analyzing top-ranking content', status: 'pending', icon: null },
    { id: 'videos', label: 'YouTube Discovery', description: 'Finding relevant video content', status: 'pending', icon: null },
    { id: 'references', label: 'Reference Gathering', description: 'Collecting authoritative sources', status: 'pending', icon: null },
    { id: 'outline', label: 'Content Outline', description: 'Structuring the article', status: 'pending', icon: null },
    { id: 'content', label: 'AI Generation', description: 'Creating comprehensive content', status: 'pending', icon: null },
    { id: 'enhance', label: 'Content Enhancement', description: 'Optimizing for readability', status: 'pending', icon: null },
    { id: 'links', label: 'Internal Linking', description: 'Adding strategic links', status: 'pending', icon: null },
    { id: 'validate', label: 'Quality Validation', description: 'Ensuring content standards', status: 'pending', icon: null },
    { id: 'schema', label: 'Schema Generation', description: 'Creating structured data', status: 'pending', icon: null },
  ];

  const updateStep = useCallback((stepId: string, status: GenerationStep['status'], message?: string) => {
    setGenerationSteps(prev => prev.map(s =>
      s.id === stepId ? { ...s, status, message } : s
    ));
  }, []);

  const handleGenerate = async () => {
    const toGenerate = contentItems.filter(i => selectedItems.includes(i.id) && (i.status === 'pending' || i.status === 'error'));
    if (toGenerate.length === 0) return;

    // Initialize generation state
    setIsGenerating(true);
    setGenerationProgress(0);
    setCurrentItemIndex(0);
    setGenerationError(undefined);
    setGenerationSteps(createDefaultSteps());
    setGeneratingItems(toGenerate.map(item => ({
      id: item.id,
      title: item.title,
      keyword: item.primaryKeyword,
      status: 'pending',
      progress: 0,
    })));

    // Build site pages with proper titles extracted from URLs
    const sitePages = sitemapUrls.map(url => {
      try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        // Extract slug and convert to title
        const slug = pathname.split('/').filter(Boolean).pop() || '';
        const title = slug
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase())
          .trim() || urlObj.hostname;
        return { url, title, keywords: slug.split('-').filter(w => w.length > 2) };
      } catch {
        return { url, title: url, keywords: [] };
      }
    });

    console.log(`[ReviewExport] Creating orchestrator with ${sitePages.length} site pages for internal linking`);

    const orchestrator = createOrchestrator({
      apiKeys: {
        geminiApiKey: config.geminiApiKey,
        openaiApiKey: config.openaiApiKey,
        anthropicApiKey: config.anthropicApiKey,
        openrouterApiKey: config.openrouterApiKey,
        groqApiKey: config.groqApiKey,
        serperApiKey: config.serperApiKey,
        openrouterModelId: config.openrouterModelId,
        groqModelId: config.groqModelId,
      },
      organizationName: config.organizationName || 'Content Hub',
      organizationUrl: config.wpUrl || 'https://example.com',
      logoUrl: config.logoUrl,
      authorName: config.authorName || 'Content Team',
      sitePages,
      primaryModel: config.primaryModel,
      useConsensus: false,
      // NeuronWriter integration
      neuronWriterApiKey: config.enableNeuronWriter ? config.neuronWriterApiKey : undefined,
      neuronWriterProjectId: config.enableNeuronWriter ? config.neuronWriterProjectId : undefined,
    });

    if (config.enableNeuronWriter && config.neuronWriterApiKey) {
      console.log(`[ReviewExport] NeuronWriter enabled with project: ${config.neuronWriterProjectName}`);
    }

    let completed = 0;
    for (let i = 0; i < toGenerate.length; i++) {
      const item = toGenerate[i];
      setCurrentItemIndex(i);

      // Reset steps for new item
      setGenerationSteps(createDefaultSteps());

      updateContentItem(item.id, { status: 'generating' });
      setGeneratingItems(prev => prev.map(gi =>
        gi.id === item.id ? { ...gi, status: 'generating', progress: 0 } : gi
      ));
      const generationStartTime = Date.now();

      try {
        let currentStepIdx = 0;
        const stepIds = ['research', 'videos', 'references', 'outline', 'content', 'enhance', 'links', 'validate', 'schema'];

        const result = await orchestrator.generateContent({
          keyword: item.primaryKeyword,
          title: item.title,
          onProgress: (msg) => {
            const lowerMsg = msg.toLowerCase();
            let detectedStep = -1;

            if (lowerMsg.includes('serp') || lowerMsg.includes('research') || lowerMsg.includes('analyzing')) {
              updateStep('research', 'running', msg);
              detectedStep = 0;
            } else if (lowerMsg.includes('youtube') || lowerMsg.includes('video')) {
              updateStep('research', 'completed');
              updateStep('videos', 'running', msg);
              detectedStep = 1;
            } else if (lowerMsg.includes('reference') || lowerMsg.includes('source') || lowerMsg.includes('citation')) {
              updateStep('videos', 'completed');
              updateStep('references', 'running', msg);
              detectedStep = 2;
            } else if (lowerMsg.includes('outline') || lowerMsg.includes('structure')) {
              updateStep('references', 'completed');
              updateStep('outline', 'running', msg);
              detectedStep = 3;
            } else if (lowerMsg.includes('generat') || lowerMsg.includes('writing') || lowerMsg.includes('creating')) {
              updateStep('outline', 'completed');
              updateStep('content', 'running', msg);
              detectedStep = 4;
            } else if (lowerMsg.includes('enhance') || lowerMsg.includes('optimi')) {
              updateStep('content', 'completed');
              updateStep('enhance', 'running', msg);
              detectedStep = 5;
            } else if (lowerMsg.includes('link') || lowerMsg.includes('internal')) {
              updateStep('enhance', 'completed');
              updateStep('links', 'running', msg);
              detectedStep = 6;
            } else if (lowerMsg.includes('valid') || lowerMsg.includes('quality') || lowerMsg.includes('check')) {
              updateStep('links', 'completed');
              updateStep('validate', 'running', msg);
              detectedStep = 7;
            } else if (lowerMsg.includes('schema') || lowerMsg.includes('structured')) {
              updateStep('validate', 'completed');
              updateStep('schema', 'running', msg);
              detectedStep = 8;
            }

            if (detectedStep >= 0) {
              currentStepIdx = Math.max(currentStepIdx, detectedStep);
            }
            const itemProgress = Math.round(((currentStepIdx + 1) / stepIds.length) * 100);
            setGeneratingItems(prev => prev.map(gi =>
              gi.id === item.id ? { ...gi, progress: itemProgress, currentStep: msg } : gi
            ));
          },
        });

        // Mark all steps complete
        setGenerationSteps(prev => prev.map(s => ({ ...s, status: 'completed' })));

        // Build content object for storage and database
        const contentToStore = {
          id: result.id,
          title: result.title,
          seoTitle: result.seoTitle,
          content: result.content,
          metaDescription: result.metaDescription,
          slug: result.slug,
          primaryKeyword: result.primaryKeyword,
          secondaryKeywords: result.secondaryKeywords,
          wordCount: result.metrics.wordCount,
          qualityScore: {
            overall: result.qualityScore.overall,
            readability: result.qualityScore.readability,
            seo: result.qualityScore.seo,
            eeat: result.qualityScore.eeat,
            uniqueness: result.qualityScore.uniqueness,
            factAccuracy: result.qualityScore.factAccuracy,
          },
          internalLinks: result.internalLinks.map(l => ({
            anchorText: l.anchorText,
            anchor: l.anchor,
            targetUrl: l.targetUrl,
            context: l.context,
          })),
          schema: result.schema,
          serpAnalysis: result.serpAnalysis ? {
            avgWordCount: result.serpAnalysis.avgWordCount,
            recommendedWordCount: result.serpAnalysis.recommendedWordCount,
            userIntent: result.serpAnalysis.userIntent,
          } : undefined,
          neuronWriterQueryId: result.neuronWriterQueryId,
          generatedAt: result.generatedAt.toISOString(),
          model: result.model,
        };

        // Store the generated content in persisted store (survives navigation)
        setGeneratedContent(item.id, contentToStore);

        // Store NeuronWriter analysis (if available) in persisted store
        if (result.neuronWriterAnalysis) {
          setNeuronWriterData(item.id, {
            query_id: result.neuronWriterAnalysis.query_id,
            keyword: result.neuronWriterAnalysis.keyword,
            status: result.neuronWriterAnalysis.status,
            terms: result.neuronWriterAnalysis.terms || [],
            termsExtended: result.neuronWriterAnalysis.termsExtended,
            entities: result.neuronWriterAnalysis.entities,
            headingsH2: result.neuronWriterAnalysis.headingsH2,
            headingsH3: result.neuronWriterAnalysis.headingsH3,
            recommended_length: result.neuronWriterAnalysis.recommended_length,
            content_score: result.neuronWriterAnalysis.content_score,
          });
        }

        updateContentItem(item.id, {
          status: 'completed',
          content: result.content,
          wordCount: result.metrics.wordCount,
        });

        setGeneratingItems(prev => prev.map(gi =>
          gi.id === item.id ? { ...gi, status: 'completed', progress: 100 } : gi
        ));

        saveToSupabase(item.id, contentToStore).catch(err => {
          console.warn('[ReviewExport] Failed to save to Supabase:', err);
          toast.error(`Database save failed for "${item.title}". Content is preserved locally.`);
        });

        globalPerformanceTracker.recordMetrics({
          timestamp: Date.now(),
          contentQualityScore: result.qualityScore.overall,
          aeoScore: result.qualityScore.seo,
          internalLinkDensity: result.internalLinks.length * 10,
          semanticRichness: result.qualityScore.eeat,
          processingSpeed: Date.now() - generationStartTime,
          wordCount: result.metrics.wordCount,
          modelUsed: result.model,
          cacheHit: false,
          keyword: item.primaryKeyword,
        });
      } catch (error) {
        const errorMsg = error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error) || 'Unknown generation error';
        console.error(`[ReviewExport] Generation failed for "${item.title}":`, error);
        updateContentItem(item.id, { status: 'error', error: errorMsg });
        setGeneratingItems(prev => prev.map(gi =>
          gi.id === item.id ? { ...gi, status: 'error', error: errorMsg } : gi
        ));
        setGenerationError(errorMsg);
        toast.error(`Generation failed: ${errorMsg.slice(0, 200)}`);
      }

      completed++;
      setGenerationProgress(Math.round((completed / toGenerate.length) * 100));
    }

    setIsGenerating(false);
    setSelectedItems([]);
  };

  const sortedItems = useMemo(() => [...contentItems].sort((a, b) => {
    const aVal = a[sortField];
    const bVal = b[sortField];
    if (aVal < bVal) return sortAsc ? -1 : 1;
    if (aVal > bVal) return sortAsc ? 1 : -1;
    return 0;
  }), [contentItems, sortField, sortAsc]);

  // Content viewer navigation
  const viewingIndex = viewingItem ? sortedItems.findIndex(i => i.id === viewingItem.id) : -1;
  const handlePreviousItem = () => {
    if (viewingIndex > 0) {
      setViewingItem(sortedItems[viewingIndex - 1]);
    }
  };
  const handleNextItem = () => {
    if (viewingIndex < sortedItems.length - 1) {
      setViewingItem(sortedItems[viewingIndex + 1]);
    }
  };

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
        <div className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-lg border",
          dbLoading ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400" :
            dbConnected ? "bg-green-500/10 border-green-500/30 text-green-400" :
              isOfflineMode ? "bg-green-500/10 border-green-500/30 text-green-400" :
                tableMissing ? "bg-red-500/10 border-red-500/30 text-red-400" :
                  dbError ? "bg-red-500/10 border-red-500/30 text-red-400" :
                    "bg-green-500/10 border-green-500/30 text-green-400"
        )}>
          <Database className="w-4 h-4" />
          <span>
            {dbLoading ? 'Syncing...' :
              dbConnected ? '✓ Database Connected' :
                isOfflineMode ? '✓ Auto-Save Active (Local)' :
                  tableMissing ? '⚠ Database Setup Required' :
                    dbError ? '⚠ Database Error' :
                      '✓ Auto-Save Active'}
          </span>
        </div>
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

      {tableMissing && (
        <div className="flex items-start gap-3 px-4 py-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
          <Database className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-2">Database Table Missing</p>
            <p className="mb-2">Your generated blog posts cannot be saved to Supabase. To enable persistence:</p>
            <ol className="list-decimal list-inside space-y-1 text-red-300">
              <li>Open your Supabase Dashboard</li>
              <li>Go to SQL Editor</li>
              <li>Run the migration from: <code className="bg-red-500/20 px-1.5 py-0.5 rounded">supabase/migrations/001_create_blog_posts_table.sql</code></li>
              <li>Refresh this page</li>
            </ol>
          </div>
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
          {(publishableSelected.length > 0 || allPublishable.length > 0) && (
            <button
              onClick={() => setShowBulkPublishModal(true)}
              disabled={isBulkPublishing}
              className="px-5 py-2.5 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50 flex items-center gap-2 transition-all shadow-lg shadow-green-600/20"
            >
              {isBulkPublishing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
              {isBulkPublishing ? 'Publishing...' : publishableSelected.length > 0
                ? `🚀 Bulk Publish Selected (${publishableSelected.length})`
                : `🚀 Bulk Publish All (${allPublishable.length})`
              }
            </button>
          )}
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
                        onClick={() => setViewingItem(item)}
                        className={cn(
                          "p-1.5 rounded transition-all",
                          item.status === 'completed'
                            ? "text-primary hover:text-primary hover:bg-primary/20"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        )}
                        title={item.status === 'completed' ? "View Content" : "Preview (content not generated yet)"}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => removeContentItem(item.id)}
                        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-all"
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

      {/* Enhanced Generation Modal */}
      <EnhancedGenerationModal
        isOpen={isGenerating}
        onClose={() => setIsGenerating(false)}
        items={generatingItems}
        currentItemIndex={currentItemIndex}
        overallProgress={generationProgress}
        steps={generationSteps}
        error={generationError}
      />

      {/* Content Viewer Panel */}
      {viewingItem && (
        <ContentViewerPanel
          item={viewingItem}
          generatedContent={reconstructGeneratedContent(generatedContentsStore[viewingItem.id])}
          neuronData={reconstructNeuronData(neuronWriterDataStore[viewingItem.id])}
          onClose={() => setViewingItem(null)}
          onPrevious={handlePreviousItem}
          onNext={handleNextItem}
          hasPrevious={viewingIndex > 0}
          hasNext={viewingIndex < sortedItems.length - 1}
          onSaveContent={(itemId, newContent) => {
            updateContentItem(itemId, { content: newContent, wordCount: newContent.split(/\s+/).filter(Boolean).length });
            const existing = generatedContentsStore[itemId];
            if (existing) {
              setGeneratedContent(itemId, { ...existing, content: newContent, wordCount: newContent.split(/\s+/).filter(Boolean).length });
            }
          }}
        />
      )}

      {/* ── Bulk Publish Modal ── */}
      {showBulkPublishModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
                <Upload className="w-5 h-5 text-green-400" />
                Bulk Publish to WordPress
              </h3>
              <button
                onClick={() => { setShowBulkPublishModal(false); setBulkPublishItems([]); }}
                className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!wpConfigured ? (
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 text-yellow-400 mx-auto mb-4" />
                <h4 className="text-lg font-semibold text-foreground mb-2">WordPress Not Configured</h4>
                <p className="text-muted-foreground mb-4">
                  Add your WordPress URL, username, and application password in the Setup tab to enable publishing.
                </p>
                <button
                  onClick={() => setShowBulkPublishModal(false)}
                  className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80"
                >
                  Close
                </button>
              </div>
            ) : bulkPublishItems.length === 0 ? (
              /* Pre-publish confirmation */
              <>
                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Publish Status for All Posts
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setBulkPublishStatus('draft')}
                        className={cn(
                          "flex-1 px-4 py-3 rounded-xl font-medium transition-all border",
                          bulkPublishStatus === 'draft'
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"
                        )}
                      >
                        📝 Draft
                      </button>
                      <button
                        onClick={() => setBulkPublishStatus('publish')}
                        className={cn(
                          "flex-1 px-4 py-3 rounded-xl font-medium transition-all border",
                          bulkPublishStatus === 'publish'
                            ? "bg-green-600 text-white border-green-600"
                            : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"
                        )}
                      >
                        🚀 Publish
                      </button>
                    </div>
                  </div>

                  <div className="p-4 bg-muted/20 border border-border rounded-xl">
                    <h4 className="text-sm font-medium text-foreground mb-3">Posts to publish:</h4>
                    <ul className="text-sm text-muted-foreground space-y-2 max-h-48 overflow-y-auto">
                      {(publishableSelected.length > 0 ? publishableSelected : allPublishable).map((item, i) => {
                        const stored = generatedContentsStore[item.id];
                        return (
                          <li key={item.id} className="flex items-start gap-2">
                            <span className="text-green-400 font-mono text-xs mt-0.5">{i + 1}.</span>
                            <div>
                              <span className="text-foreground font-medium">{item.title}</span>
                              {stored && (
                                <span className="text-muted-foreground text-xs ml-2">
                                  ({stored.wordCount?.toLocaleString() || '—'} words)
                                </span>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                      ✨ SEO titles, meta descriptions, and slugs will be set for each post
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowBulkPublishModal(false)}
                    className="flex-1 px-4 py-3 bg-muted text-foreground rounded-xl font-medium hover:bg-muted/80 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { handleBulkPublish(); }}
                    className="flex-1 px-4 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-all flex items-center justify-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Publish {(publishableSelected.length > 0 ? publishableSelected : allPublishable).length} Posts
                  </button>
                </div>
              </>
            ) : (
              /* Publishing progress */
              <>
                <div className="space-y-3 max-h-72 overflow-y-auto mb-6">
                  {bulkPublishItems.map((item, i) => (
                    <div
                      key={item.id}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-xl border transition-all",
                        item.status === 'published' && "bg-green-500/10 border-green-500/30",
                        item.status === 'publishing' && "bg-blue-500/10 border-blue-500/30",
                        item.status === 'error' && "bg-red-500/10 border-red-500/30",
                        item.status === 'pending' && "bg-muted/20 border-border"
                      )}
                    >
                      <div className="flex-shrink-0">
                        {item.status === 'pending' && <Clock className="w-4 h-4 text-muted-foreground" />}
                        {item.status === 'publishing' && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
                        {item.status === 'published' && <CheckCircle className="w-4 h-4 text-green-400" />}
                        {item.status === 'error' && <XCircle className="w-4 h-4 text-red-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{item.title}</div>
                        {item.status === 'published' && item.postUrl && (
                          <a
                            href={item.postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-green-400 hover:underline"
                          >
                            View post →
                          </a>
                        )}
                        {item.status === 'error' && item.error && (
                          <div className="text-xs text-red-400 truncate">{item.error}</div>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground font-mono">{i + 1}/{bulkPublishItems.length}</span>
                    </div>
                  ))}
                </div>

                {!isBulkPublishing && (
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setShowBulkPublishModal(false); setBulkPublishItems([]); }}
                      className="flex-1 px-4 py-3 bg-muted text-foreground rounded-xl font-medium hover:bg-muted/80 transition-all"
                    >
                      Close
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
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
