// ============================================================
// SOTA CONTENT VIEWER PANEL - Enterprise-Grade Content Display
// ============================================================

import { useState, useMemo } from 'react';
import { 
  X, Copy, Check, Download, ExternalLink, Sparkles, 
  FileText, Code, Search, BarChart3, Link2, Shield,
  ChevronLeft, ChevronRight, Maximize2, Minimize2,
  BookOpen, Clock, Target, Zap, Award, Eye, EyeOff,
  TrendingUp, CheckCircle, AlertTriangle, Brain,
  Hash, List, Type, ArrowRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ContentItem } from '@/lib/store';
import type { GeneratedContent, NeuronWriterAnalysis } from '@/lib/sota';

interface ContentViewerPanelProps {
  item: ContentItem | null;
  generatedContent?: GeneratedContent | null;
  neuronData?: NeuronWriterAnalysis | null;
  onClose: () => void;
  onPublish?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
}

type ViewTab = 'preview' | 'html' | 'seo' | 'schema' | 'links' | 'neuron';

export function ContentViewerPanel({ 
  item, 
  generatedContent,
  neuronData,
  onClose, 
  onPublish,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext
}: ContentViewerPanelProps) {
  const [activeTab, setActiveTab] = useState<ViewTab>('preview');
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [showRawHtml, setShowRawHtml] = useState(false);

  if (!item) return null;

  const content = item.content || '';
  const hasContent = content.length > 0;
  const wordCount = item.wordCount || content.split(/\s+/).filter(Boolean).length;

  // Extract headings from content
  const headings = useMemo(() => {
    const h2Matches = content.match(/<h2[^>]*>(.*?)<\/h2>/gi) || [];
    const h3Matches = content.match(/<h3[^>]*>(.*?)<\/h3>/gi) || [];
    return {
      h2: h2Matches.map(h => h.replace(/<[^>]*>/g, '')),
      h3: h3Matches.map(h => h.replace(/<[^>]*>/g, ''))
    };
  }, [content]);

  // Extract internal links from content
  const contentLinks = useMemo(() => {
    const linkMatches = content.match(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi) || [];
    return linkMatches.map(link => {
      const hrefMatch = link.match(/href="([^"]*)"/);
      const textMatch = link.match(/>(.*?)<\/a>/);
      return {
        url: hrefMatch?.[1] || '',
        text: textMatch?.[1]?.replace(/<[^>]*>/g, '') || ''
      };
    }).filter(l => !l.url.startsWith('http') || l.url.includes(item.primaryKeyword?.split(' ')[0] || ''));
  }, [content, item.primaryKeyword]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${item.title.toLowerCase().replace(/\s+/g, '-')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tabs: { id: ViewTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'preview', label: 'Preview', icon: <Eye className="w-4 h-4" /> },
    { id: 'html', label: 'HTML', icon: <Code className="w-4 h-4" /> },
    { id: 'seo', label: 'SEO Analysis', icon: <Search className="w-4 h-4" /> },
    { id: 'links', label: 'Internal Links', icon: <Link2 className="w-4 h-4" />, badge: generatedContent?.internalLinks?.length || contentLinks.length },
    { id: 'schema', label: 'Schema', icon: <Shield className="w-4 h-4" /> },
    { id: 'neuron', label: 'NeuronWriter', icon: <Brain className="w-4 h-4" />, badge: neuronData?.terms?.length }
  ];

  return (
    <div className={cn(
      "fixed bg-background/98 backdrop-blur-xl z-50 flex flex-col",
      isFullscreen ? "inset-0" : "inset-4 rounded-2xl border border-border"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-card/50">
        <div className="flex items-center gap-4">
          {/* Navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={onPrevious}
              disabled={!hasPrevious}
              className="p-2 rounded-lg bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={onNext}
              disabled={!hasNext}
              className="p-2 rounded-lg bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Title */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn(
                "px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider",
                item.type === 'pillar' && "bg-purple-500/20 text-purple-400 border border-purple-500/30",
                item.type === 'cluster' && "bg-blue-500/20 text-blue-400 border border-blue-500/30",
                item.type === 'single' && "bg-primary/20 text-primary border border-primary/30",
                item.type === 'refresh' && "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
              )}>
                {item.type}
              </span>
              <h2 className="text-lg font-bold text-foreground truncate max-w-[500px]">{item.title}</h2>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
              <span className="flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" />
                {wordCount.toLocaleString()} words
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                ~{Math.ceil(wordCount / 200)} min read
              </span>
              <span className="flex items-center gap-1">
                <Target className="w-3.5 h-3.5" />
                {item.primaryKeyword}
              </span>
              {generatedContent && (
                <span className="flex items-center gap-1">
                  <Award className="w-3.5 h-3.5 text-primary" />
                  <span className="text-primary font-medium">{generatedContent.qualityScore.overall}% Quality</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            disabled={!hasContent}
            className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-all disabled:opacity-30"
            title="Copy HTML"
          >
            {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
            <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy'}</span>
          </button>
          <button
            onClick={handleDownload}
            disabled={!hasContent}
            className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-all disabled:opacity-30"
            title="Download HTML"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Download</span>
          </button>
          {onPublish && (
            <button
              onClick={onPublish}
              disabled={!hasContent}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-30"
            >
              <ExternalLink className="w-4 h-4" />
              Publish to WP
            </button>
          )}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50 transition-all"
          >
            {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>
          <button
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50 transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-card/30 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all border-b-2 -mb-px whitespace-nowrap",
              activeTab === tab.id
                ? "text-primary border-primary bg-primary/5"
                : "text-muted-foreground border-transparent hover:text-foreground hover:border-muted-foreground/30"
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-primary/20 text-primary text-xs rounded-full font-bold">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto">
        {!hasContent ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-20 h-20 rounded-full bg-muted/30 flex items-center justify-center mb-6">
              <FileText className="w-10 h-10 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2">Content Not Yet Generated</h3>
            <p className="text-muted-foreground max-w-md mb-6">
              This content item is pending generation. Select it and click "Generate Selected" to create the content.
            </p>
            <div className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-yellow-400 text-sm">
              <Clock className="w-4 h-4" />
              Status: {item.status}
            </div>
          </div>
        ) : (
          <>
            {/* Preview Tab */}
            {activeTab === 'preview' && (
              <div className="p-8 max-w-4xl mx-auto">
                <article 
                  className="prose prose-invert prose-lg max-w-none
                    prose-headings:text-foreground prose-headings:font-bold
                    prose-h1:text-3xl prose-h1:mb-6 prose-h1:mt-8
                    prose-h2:text-2xl prose-h2:mb-4 prose-h2:mt-8 prose-h2:text-primary
                    prose-h3:text-xl prose-h3:mb-3 prose-h3:mt-6
                    prose-p:text-muted-foreground prose-p:leading-relaxed prose-p:mb-4
                    prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                    prose-strong:text-foreground prose-strong:font-semibold
                    prose-ul:my-4 prose-li:text-muted-foreground prose-li:mb-2
                    prose-ol:my-4
                    prose-blockquote:border-l-primary prose-blockquote:bg-muted/30 prose-blockquote:py-2 prose-blockquote:px-4 prose-blockquote:rounded-r-lg
                    prose-code:bg-muted prose-code:px-2 prose-code:py-1 prose-code:rounded prose-code:text-primary
                    prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border
                    prose-img:rounded-xl prose-img:shadow-lg
                    prose-table:border prose-table:border-border
                    prose-th:bg-muted/50 prose-th:p-3 prose-th:text-left
                    prose-td:p-3 prose-td:border-t prose-td:border-border"
                  dangerouslySetInnerHTML={{ __html: content }}
                />
              </div>
            )}

            {/* HTML Tab */}
            {activeTab === 'html' && (
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-foreground">HTML Source</h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowRawHtml(!showRawHtml)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg text-sm text-muted-foreground hover:text-foreground transition-all"
                    >
                      {showRawHtml ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      {showRawHtml ? 'Show Formatted' : 'Show Raw'}
                    </button>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-2 px-3 py-1.5 bg-primary/20 text-primary rounded-lg text-sm hover:bg-primary/30 transition-all"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copied ? 'Copied!' : 'Copy All'}
                    </button>
                  </div>
                </div>
                <div className="bg-muted/20 border border-border rounded-xl overflow-hidden">
                  <div className="bg-muted/30 px-4 py-2 border-b border-border flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/50" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                    <div className="w-3 h-3 rounded-full bg-green-500/50" />
                    <span className="ml-2 text-xs text-muted-foreground font-mono">content.html</span>
                  </div>
                  <pre className="p-4 overflow-auto text-sm text-foreground font-mono max-h-[60vh] leading-relaxed whitespace-pre-wrap">
                    {showRawHtml ? content : formatHtml(content)}
                  </pre>
                </div>
              </div>
            )}

            {/* SEO Tab */}
            {activeTab === 'seo' && (
              <div className="p-6 space-y-6">
                {/* Quality Scores */}
                {generatedContent && (
                  <div className="bg-card/50 border border-border rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-primary" />
                      Quality Score Breakdown
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
                      <QualityMetric label="Overall" value={generatedContent.qualityScore.overall} />
                      <QualityMetric label="Readability" value={generatedContent.qualityScore.readability} />
                      <QualityMetric label="SEO" value={generatedContent.qualityScore.seo} />
                      <QualityMetric label="E-E-A-T" value={generatedContent.qualityScore.eeat} />
                      <QualityMetric label="Uniqueness" value={generatedContent.qualityScore.uniqueness} />
                      <QualityMetric label="Accuracy" value={generatedContent.qualityScore.factAccuracy} />
                    </div>
                  </div>
                )}

                {/* Content Structure */}
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Content Metrics */}
                  <div className="bg-card/50 border border-border rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                      <Zap className="w-5 h-5 text-primary" />
                      Content Metrics
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <MetricCard label="Word Count" value={wordCount.toLocaleString()} target="2,500+" ok={wordCount >= 2500} />
                      <MetricCard label="Reading Time" value={`${Math.ceil(wordCount / 200)} min`} target="10-15 min" ok={wordCount >= 2000} />
                      <MetricCard label="Paragraphs" value={content.split('</p>').length - 1} target="20+" ok={(content.split('</p>').length - 1) >= 20} />
                      <MetricCard label="Headings" value={headings.h2.length + headings.h3.length} target="8-12" ok={headings.h2.length >= 5} />
                    </div>
                  </div>

                  {/* Heading Structure */}
                  <div className="bg-card/50 border border-border rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                      <Type className="w-5 h-5 text-primary" />
                      Heading Structure
                    </h3>
                    <div className="space-y-3 max-h-[300px] overflow-y-auto">
                      {headings.h2.map((h, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <span className="px-2 py-0.5 bg-primary/20 text-primary text-xs font-bold rounded">H2</span>
                          <span className="text-sm text-foreground">{h}</span>
                        </div>
                      ))}
                      {headings.h3.map((h, i) => (
                        <div key={i} className="flex items-start gap-2 ml-4">
                          <span className="px-2 py-0.5 bg-muted text-muted-foreground text-xs font-bold rounded">H3</span>
                          <span className="text-sm text-muted-foreground">{h}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Keywords */}
                <div className="bg-card/50 border border-border rounded-xl p-6">
                  <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Target className="w-5 h-5 text-primary" />
                    Keyword Analysis
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <span className="text-sm text-muted-foreground">Primary Keyword</span>
                      <div className="mt-2 flex items-center gap-3">
                        <span className="px-4 py-2 bg-primary/20 text-primary rounded-lg text-lg font-semibold border border-primary/30">
                          {item.primaryKeyword}
                        </span>
                        <KeywordDensityIndicator content={content} keyword={item.primaryKeyword} />
                      </div>
                    </div>
                    {generatedContent?.secondaryKeywords && generatedContent.secondaryKeywords.length > 0 && (
                      <div>
                        <span className="text-sm text-muted-foreground">Secondary Keywords ({generatedContent.secondaryKeywords.length})</span>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {generatedContent.secondaryKeywords.map((kw, i) => (
                            <span key={i} className="px-3 py-1.5 bg-muted text-muted-foreground rounded-lg text-sm border border-border hover:bg-muted/80 transition-colors">
                              {kw}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Improvements */}
                {generatedContent?.qualityScore.improvements && generatedContent.qualityScore.improvements.length > 0 && (
                  <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-yellow-400 mb-4 flex items-center gap-2">
                      <Sparkles className="w-5 h-5" />
                      Suggested Improvements
                    </h3>
                    <ul className="space-y-2">
                      {generatedContent.qualityScore.improvements.map((improvement, i) => (
                        <li key={i} className="flex items-start gap-3 text-muted-foreground">
                          <span className="w-6 h-6 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          {improvement}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Links Tab */}
            {activeTab === 'links' && (
              <div className="p-6">
                {(generatedContent?.internalLinks?.length || contentLinks.length) > 0 ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                        <Link2 className="w-5 h-5 text-primary" />
                        Internal Links ({generatedContent?.internalLinks?.length || contentLinks.length})
                      </h3>
                      <div className="flex items-center gap-2">
                        {(generatedContent?.internalLinks?.length || contentLinks.length) >= 4 ? (
                          <span className="flex items-center gap-1 px-3 py-1 bg-green-500/20 text-green-400 rounded-lg text-sm">
                            <CheckCircle className="w-4 h-4" />
                            Good Link Density
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-3 py-1 bg-yellow-500/20 text-yellow-400 rounded-lg text-sm">
                            <AlertTriangle className="w-4 h-4" />
                            Add More Links
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="bg-card/50 border border-border rounded-xl overflow-hidden">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-border bg-muted/30">
                            <th className="p-4 text-left text-sm font-medium text-foreground">Anchor Text</th>
                            <th className="p-4 text-left text-sm font-medium text-foreground">Target URL</th>
                            <th className="p-4 text-left text-sm font-medium text-foreground">Relevance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(generatedContent?.internalLinks || contentLinks.map(l => ({ anchorText: l.text, targetUrl: l.url, relevanceScore: 80 }))).map((link, i) => (
                            <tr key={i} className="border-b border-border hover:bg-muted/20">
                              <td className="p-4 text-primary font-medium">{link.anchorText || link.text}</td>
                              <td className="p-4">
                                <a 
                                  href={link.targetUrl || link.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-muted-foreground hover:text-foreground flex items-center gap-1 group"
                                >
                                  <span className="truncate max-w-[300px]">{link.targetUrl || link.url}</span>
                                  <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </a>
                              </td>
                              <td className="p-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                                    <div 
                                      className={cn(
                                        "h-full rounded-full transition-all",
                                        (link.relevanceScore || 80) >= 80 ? "bg-green-500" : 
                                        (link.relevanceScore || 80) >= 60 ? "bg-yellow-500" : "bg-red-500"
                                      )}
                                      style={{ width: `${link.relevanceScore || 80}%` }}
                                    />
                                  </div>
                                  <span className="text-sm text-muted-foreground">{link.relevanceScore || 80}%</span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mb-4">
                      <Link2 className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-2">No Internal Links Found</h3>
                    <p className="text-muted-foreground max-w-md">
                      Internal links help with SEO and user navigation. Make sure to add relevant internal links to your content.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Schema Tab */}
            {activeTab === 'schema' && (
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Shield className="w-5 h-5 text-primary" />
                    JSON-LD Structured Data
                  </h3>
                  <button
                    onClick={() => {
                      const schemaJson = JSON.stringify(generatedContent?.schema || {}, null, 2);
                      navigator.clipboard.writeText(schemaJson);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 bg-primary/20 text-primary rounded-lg text-sm hover:bg-primary/30 transition-all"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied!' : 'Copy Schema'}
                  </button>
                </div>
                {generatedContent?.schema ? (
                  <div className="bg-muted/20 border border-border rounded-xl overflow-hidden">
                    <div className="bg-muted/30 px-4 py-2 border-b border-border flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-green-500/50" />
                        <span className="text-xs text-muted-foreground font-mono">schema.json</span>
                      </div>
                      <span className="text-xs text-green-400">Valid JSON-LD</span>
                    </div>
                    <pre className="p-4 overflow-auto text-sm text-foreground font-mono max-h-[60vh] leading-relaxed">
                      {JSON.stringify(generatedContent.schema, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mb-4">
                      <Shield className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-2">No Schema Generated</h3>
                    <p className="text-muted-foreground max-w-md">
                      Schema markup will be generated when content is created. This helps search engines understand your content.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* NeuronWriter Tab */}
            {activeTab === 'neuron' && (
              <div className="p-6 space-y-6">
                {neuronData ? (
                  <>
                    {/* Score Overview */}
                    <div className="bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 rounded-xl p-6">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                          <Brain className="w-5 h-5 text-primary" />
                          NeuronWriter Content Score
                        </h3>
                        <div className="flex items-center gap-4">
                          <div className="text-center">
                            <div className="text-3xl font-bold text-primary">{neuronData.content_score || 0}%</div>
                            <div className="text-xs text-muted-foreground">Content Score</div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Score Breakdown */}
                      <div className="grid grid-cols-4 gap-4">
                        <ScoreCard label="Terms Used" value={`${countTermsUsed(neuronData.terms, content)}/${neuronData.terms?.length || 0}`} percentage={(countTermsUsed(neuronData.terms, content)) / (neuronData.terms?.length || 1) * 100} />
                        <ScoreCard label="Headings" value={headings.h2.length + headings.h3.length} percentage={Math.min(100, ((headings.h2.length + headings.h3.length) / 10) * 100)} />
                        <ScoreCard label="Word Count" value={wordCount.toLocaleString()} percentage={Math.min(100, (wordCount / (neuronData.recommended_length || 2500)) * 100)} />
                        <ScoreCard label="Target Length" value={neuronData.recommended_length?.toLocaleString() || '2,500'} percentage={100} />
                      </div>
                    </div>

                    {/* Terms Grid */}
                    <div className="grid md:grid-cols-2 gap-6">
                      {/* Required Terms */}
                      <div className="bg-card/50 border border-border rounded-xl p-6">
                        <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                          <Hash className="w-5 h-5 text-blue-400" />
                          Required Terms
                          <span className="ml-auto text-sm text-muted-foreground">
                            {countTermsUsedByType(neuronData.terms, 'required', content)}/{neuronData.terms?.filter(t => t.type === 'required').length || 0} used
                          </span>
                        </h3>
                        <div className="space-y-2 max-h-[400px] overflow-y-auto">
                          {neuronData.terms?.filter(t => t.type === 'required').map((term, i) => (
                            <TermRowNeuron key={i} term={term} content={content} />
                          ))}
                          {(!neuronData.terms || neuronData.terms.filter(t => t.type === 'required').length === 0) && (
                            <p className="text-sm text-muted-foreground text-center py-4">No required terms defined</p>
                          )}
                        </div>
                      </div>

                      {/* Recommended Terms */}
                      <div className="bg-card/50 border border-border rounded-xl p-6">
                        <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                          <List className="w-5 h-5 text-purple-400" />
                          Recommended Terms
                          <span className="ml-auto text-sm text-muted-foreground">
                            {countTermsUsedByType(neuronData.terms, 'recommended', content)}/{neuronData.terms?.filter(t => t.type === 'recommended').length || 0} used
                          </span>
                        </h3>
                        <div className="space-y-2 max-h-[400px] overflow-y-auto">
                          {neuronData.terms?.filter(t => t.type === 'recommended').map((term, i) => (
                            <TermRowNeuron key={i} term={term} content={content} />
                          ))}
                          {(!neuronData.terms || neuronData.terms.filter(t => t.type === 'recommended').length === 0) && (
                            <p className="text-sm text-muted-foreground text-center py-4">No recommended terms defined</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Competitor Analysis */}
                    {neuronData.competitors && neuronData.competitors.length > 0 && (
                      <div className="bg-card/50 border border-border rounded-xl p-6">
                        <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                          <BarChart3 className="w-5 h-5 text-primary" />
                          Top Competitors
                        </h3>
                        <div className="space-y-3">
                          {neuronData.competitors.slice(0, 5).map((comp, i) => (
                            <div key={i} className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg border border-border">
                              <span className="w-6 h-6 bg-primary/20 text-primary rounded-full flex items-center justify-center text-xs font-bold">
                                {comp.rank}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-foreground truncate">{comp.title}</div>
                                <a href={comp.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary truncate block">
                                  {comp.url}
                                </a>
                              </div>
                              {comp.word_count && (
                                <span className="text-xs text-muted-foreground">
                                  {comp.word_count.toLocaleString()} words
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Questions/Ideas */}
                    {neuronData.ideas && (
                      <div className="grid md:grid-cols-2 gap-6">
                        {neuronData.ideas.people_also_ask && neuronData.ideas.people_also_ask.length > 0 && (
                          <div className="bg-card/50 border border-border rounded-xl p-6">
                            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                              <Type className="w-5 h-5 text-primary" />
                              People Also Ask
                            </h3>
                            <div className="space-y-2">
                              {neuronData.ideas.people_also_ask.slice(0, 8).map((q, i) => (
                                <div key={i} className="p-2 bg-muted/30 rounded-lg text-sm text-muted-foreground">
                                  {q.q}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {neuronData.ideas.suggest_questions && neuronData.ideas.suggest_questions.length > 0 && (
                          <div className="bg-card/50 border border-border rounded-xl p-6">
                            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                              <BookOpen className="w-5 h-5 text-primary" />
                              Suggested Questions
                            </h3>
                            <div className="space-y-2">
                              {neuronData.ideas.suggest_questions.slice(0, 8).map((q, i) => (
                                <div key={i} className="p-2 bg-muted/30 rounded-lg text-sm text-muted-foreground">
                                  {q.q}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-20 h-20 rounded-full bg-muted/30 flex items-center justify-center mb-6">
                      <Brain className="w-10 h-10 text-muted-foreground" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground mb-2">NeuronWriter Not Connected</h3>
                    <p className="text-muted-foreground max-w-md mb-6">
                      Connect NeuronWriter in the Setup tab to get detailed keyword analysis, term recommendations, and content scoring.
                    </p>
                    <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 rounded-xl text-primary text-sm">
                      <TrendingUp className="w-4 h-4" />
                      Enable NeuronWriter for advanced SEO insights
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Helper Components
function QualityMetric({ label, value }: { label: string; value: number }) {
  const getColor = (v: number) => {
    if (v >= 80) return 'text-green-400';
    if (v >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="text-center">
      <div className={cn("text-3xl font-bold", getColor(value))}>{value}%</div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function MetricCard({ label, value, target, ok }: { label: string; value: string | number; target: string; ok?: boolean }) {
  return (
    <div className="bg-muted/30 rounded-lg p-4 border border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        {ok !== undefined && (
          ok ? <CheckCircle className="w-4 h-4 text-green-400" /> : <AlertTriangle className="w-4 h-4 text-yellow-400" />
        )}
      </div>
      <div className="text-2xl font-bold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">Target: {target}</div>
    </div>
  );
}

function ScoreCard({ label, value, percentage }: { label: string; value: string | number; percentage: number }) {
  return (
    <div className="bg-card/50 rounded-lg p-4 border border-border">
      <div className="text-sm text-muted-foreground mb-2">{label}</div>
      <div className="text-xl font-bold text-foreground mb-2">{value}</div>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <div 
          className={cn(
            "h-full rounded-full transition-all",
            percentage >= 80 ? "bg-green-500" : percentage >= 50 ? "bg-yellow-500" : "bg-red-500"
          )}
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>
    </div>
  );
}

// Helper functions for NeuronWriter terms
function countTermsUsed(terms: any[] | undefined, content: string): number {
  if (!terms) return 0;
  return terms.filter(t => {
    const regex = new RegExp(t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return content.match(regex);
  }).length;
}

function countTermsUsedByType(terms: any[] | undefined, type: string, content: string): number {
  if (!terms) return 0;
  return terms.filter(t => t.type === type).filter(t => {
    const regex = new RegExp(t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return content.match(regex);
  }).length;
}

function TermRowNeuron({ term, content }: { term: { term: string; type: string; weight: number; frequency: number; usage_pc?: number; sugg_usage?: [number, number] }; content: string }) {
  const regex = new RegExp(term.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const matches = content.match(regex);
  const count = matches?.length || 0;
  const isUsed = count > 0;
  const suggestedMin = term.sugg_usage?.[0] || 1;
  const suggestedMax = term.sugg_usage?.[1] || 3;
  const isOptimal = count >= suggestedMin && count <= suggestedMax;

  return (
    <div className={cn(
      "flex items-center justify-between p-2 rounded-lg transition-colors",
      isOptimal ? "bg-green-500/10" : isUsed ? "bg-yellow-500/10" : "bg-muted/30"
    )}>
      <div className="flex-1 min-w-0">
        <span className={cn(
          "text-sm font-medium",
          isOptimal ? "text-green-400" : isUsed ? "text-yellow-400" : "text-muted-foreground"
        )}>
          {term.term}
        </span>
        {term.usage_pc !== undefined && (
          <span className="ml-2 text-xs text-muted-foreground">
            ({term.usage_pc}% of competitors)
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className={cn(
          "px-2 py-0.5 rounded text-xs font-medium",
          isOptimal ? "bg-green-500/20 text-green-400" : 
          isUsed ? "bg-yellow-500/20 text-yellow-400" : "bg-muted text-muted-foreground"
        )}>
          {count}x / {suggestedMin}-{suggestedMax}
        </span>
        {isOptimal && <CheckCircle className="w-3.5 h-3.5 text-green-400" />}
      </div>
    </div>
  );
}

function KeywordDensityIndicator({ content, keyword }: { content: string; keyword: string }) {
  const words = content.split(/\s+/).length;
  const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const matches = content.match(regex);
  const count = matches?.length || 0;
  const density = words > 0 ? ((count / words) * 100).toFixed(2) : '0';
  const isGood = parseFloat(density) >= 0.5 && parseFloat(density) <= 2.5;

  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm",
      isGood ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"
    )}>
      {isGood ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
      <span>{count}x ({density}%)</span>
    </div>
  );
}

function formatHtml(html: string): string {
  let formatted = html;
  let indent = 0;
  const tab = '  ';

  formatted = formatted.replace(/></g, '>\n<');
  
  const lines = formatted.split('\n');
  const result = lines.map(line => {
    line = line.trim();
    if (!line) return '';
    
    if (line.match(/^<\/\w/)) {
      indent = Math.max(0, indent - 1);
    }
    
    const indented = tab.repeat(indent) + line;
    
    if (line.match(/^<\w[^>]*[^\/]>.*$/) && !line.match(/^<(br|hr|img|input|meta|link)/)) {
      if (!line.match(/<\/\w+>$/)) {
        indent++;
      }
    }
    
    return indented;
  });

  return result.filter(Boolean).join('\n');
}
