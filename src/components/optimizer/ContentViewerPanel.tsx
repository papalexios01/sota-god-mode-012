// SOTA CONTENT VIEWER PANEL - Enterprise-Grade Content Display

import { useState, useMemo, useCallback, useEffect } from 'react';
import { 
  X, Copy, Check, Download, ExternalLink, Sparkles, 
  FileText, Code, Search, BarChart3, Link2, Shield,
  ChevronLeft, ChevronRight, Maximize2, Minimize2,
  BookOpen, Clock, Target, Zap, Award, Eye, EyeOff,
  TrendingUp, CheckCircle, AlertTriangle, Brain, Globe,
  Hash, List, Type, ArrowRight, Upload, Loader2,
  Edit3, Save, RotateCcw, Bold, Italic, Heading1, Heading2, Heading3, 
  ListOrdered, Quote, Table, Image as ImageIcon, Undo, Redo
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ContentItem } from '@/lib/store';
import type { GeneratedContent, NeuronWriterAnalysis } from '@/lib/sota';
import { useWordPressPublish } from '@/hooks/useWordPressPublish';
import { getPathnameFromUrl, getWordPressPostSlugFromUrl, toSafeWpSlug } from '@/lib/wordpress/slug';
import { toast } from 'sonner';

function sanitizeHtml(html: string): string {
  let sanitized = html;
  // Remove scripts
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // Remove ONLY non-YouTube/Vimeo iframes (preserve video embeds)
  sanitized = sanitized.replace(/<iframe\b[^>]*>/gi, (match) => {
    // Allow YouTube and Vimeo embeds
    if (/src\s*=\s*["'][^"']*(?:youtube\.com\/embed|youtube-nocookie\.com\/embed|player\.vimeo\.com)/i.test(match)) {
      return match;
    }
    return '';
  });
  // Only strip closing iframe tags for non-video iframes (keep matching pairs)
  // We handle this by keeping all closing tags - orphaned ones are harmless
  sanitized = sanitized.replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '');
  sanitized = sanitized.replace(/<embed\b[^>]*>/gi, '');
  // Remove event handlers
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');
  // Remove javascript: URLs
  sanitized = sanitized.replace(/href\s*=\s*["']?\s*javascript\s*:/gi, 'href="');
  sanitized = sanitized.replace(/src\s*=\s*["']?\s*javascript\s*:/gi, 'src="');
  return sanitized;
}

interface ContentViewerPanelProps {
  item: ContentItem | null;
  generatedContent?: GeneratedContent | null;
  neuronData?: NeuronWriterAnalysis | null;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  onSaveContent?: (itemId: string, newContent: string) => void;
}

type ViewTab = 'preview' | 'editor' | 'html' | 'seo' | 'schema' | 'links' | 'neuron';

export function ContentViewerPanel({ 
  item, 
  generatedContent,
  neuronData,
  onClose, 
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
  onSaveContent
}: ContentViewerPanelProps) {
  const [activeTab, setActiveTab] = useState<ViewTab>('preview');
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [showRawHtml, setShowRawHtml] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishStatus, setPublishStatus] = useState<'draft' | 'publish'>('draft');
  
  const { publish, isPublishing, publishResult, clearResult, isConfigured } = useWordPressPublish();

  if (!item) return null;

  const content = item.content || '';
  const hasContent = content.length > 0;
  const wordCount = item.wordCount || content.split(/\s+/).filter(Boolean).length;

  const sourcePathname = useMemo(() => getPathnameFromUrl(item.url), [item.url]);
  const sourceSlug = useMemo(() => getWordPressPostSlugFromUrl(item.url), [item.url]);

  const effectivePublishSlug = useMemo(() => {
    if (sourceSlug) return sourceSlug;
    if (generatedContent?.slug) return toSafeWpSlug(generatedContent.slug);
    // Fallback: make the title safe and avoid the "Rewrite:" prefix leaking into the slug
    const title = item.title.replace(/^\s*rewrite\s*:\s*/i, '').trim();
    return toSafeWpSlug(title);
  }, [generatedContent?.slug, item.title, sourceSlug]);

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

  const handlePublishToWordPress = async () => {
    if (!item || !content) return;
    
    // Clean title: strip any "Rewrite:" prefix and prefer the SEO-optimized title
    const cleanTitle = item.title.replace(/^\s*rewrite\s*:\s*/i, '').trim();
    const effectiveSeoTitle = generatedContent?.seoTitle || cleanTitle;
    const wpTitle = generatedContent?.seoTitle || generatedContent?.title || cleanTitle;
    
    const result = await publish(
      wpTitle,
      content,
      {
        status: publishStatus,
        slug: effectivePublishSlug,
        metaDescription: generatedContent?.metaDescription,
        excerpt: generatedContent?.metaDescription,
        seoTitle: effectiveSeoTitle,
        sourceUrl: item.url,
      }
    );

    if (result.success) {
      toast.success(
        `Published to WordPress as ${publishStatus}!`,
        {
          description: result.postUrl ? `Post ID: ${result.postId}` : undefined,
          action: result.postUrl ? {
            label: 'View Post',
            onClick: () => window.open(result.postUrl, '_blank'),
          } : undefined,
        }
      );
      setShowPublishModal(false);
    } else {
      toast.error('Failed to publish', {
        description: result.error,
      });
    }
  };

  // Editor state
  const [editedContent, setEditedContent] = useState<string>('');
  const [isEditorDirty, setIsEditorDirty] = useState(false);
  const [editorHistory, setEditorHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Initialize editor content when item changes
  useEffect(() => {
    if (content) {
      setEditedContent(content);
      setEditorHistory([content]);
      setHistoryIndex(0);
      setIsEditorDirty(false);
    }
  }, [content, item?.id]);

  // Editor actions
  const handleEditorChange = useCallback((newContent: string) => {
    setEditedContent(newContent);
    setIsEditorDirty(newContent !== content);
    // Add to history (max 50 entries)
    setEditorHistory(prev => {
      const newHistory = [...prev.slice(0, historyIndex + 1), newContent].slice(-50);
      setHistoryIndex(newHistory.length - 1);
      return newHistory;
    });
  }, [content, historyIndex]);

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setEditedContent(editorHistory[newIndex]);
      setIsEditorDirty(editorHistory[newIndex] !== content);
    }
  }, [historyIndex, editorHistory, content]);

  const handleRedo = useCallback(() => {
    if (historyIndex < editorHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setEditedContent(editorHistory[newIndex]);
      setIsEditorDirty(editorHistory[newIndex] !== content);
    }
  }, [historyIndex, editorHistory, content]);

  const handleResetEditor = useCallback(() => {
    setEditedContent(content);
    setIsEditorDirty(false);
    setEditorHistory([content]);
    setHistoryIndex(0);
    toast.info('Editor reset to original content');
  }, [content]);

  const handleSaveContent = useCallback(() => {
    if (!item || !onSaveContent || !isEditorDirty) return;
    onSaveContent(item.id, editedContent);
    setIsEditorDirty(false);
    toast.success('Content saved successfully!');
  }, [item, onSaveContent, isEditorDirty, editedContent]);

  const insertHtmlTag = useCallback((tag: string, attributes: string = '') => {
    const selection = window.getSelection();
    const selectedText = selection?.toString() || 'Your text here';
    
    let insertion = '';
    if (['h1', 'h2', 'h3', 'p', 'strong', 'em', 'blockquote'].includes(tag)) {
      insertion = `<${tag}${attributes}>${selectedText}</${tag}>`;
    } else if (tag === 'ul' || tag === 'ol') {
      insertion = `<${tag}>\n  <li>${selectedText}</li>\n</${tag}>`;
    } else if (tag === 'table') {
      insertion = `<table style="width: 100%; border-collapse: collapse;">\n  <thead>\n    <tr>\n      <th style="padding: 12px; border: 1px solid #374151; background: #1f2937;">Header 1</th>\n      <th style="padding: 12px; border: 1px solid #374151; background: #1f2937;">Header 2</th>\n    </tr>\n  </thead>\n  <tbody>\n    <tr>\n      <td style="padding: 12px; border: 1px solid #374151;">Data 1</td>\n      <td style="padding: 12px; border: 1px solid #374151;">Data 2</td>\n    </tr>\n  </tbody>\n</table>`;
    } else if (tag === 'img') {
      insertion = `<img src="https://example.com/image.jpg" alt="${selectedText}" style="max-width: 100%; border-radius: 12px;" />`;
    }
    
    handleEditorChange(editedContent + '\n\n' + insertion);
  }, [editedContent, handleEditorChange]);

  const tabs: { id: ViewTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'preview', label: 'Preview', icon: <Eye className="w-4 h-4" /> },
    { id: 'editor', label: 'Editor', icon: <Edit3 className="w-4 h-4" />, badge: isEditorDirty ? 1 : undefined },
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
          <button
            onClick={() => setShowPublishModal(true)}
            disabled={!hasContent}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-30"
            title={isConfigured ? 'Publish to WordPress' : 'Configure WordPress in Setup first'}
          >
            <Upload className="w-4 h-4" />
            Publish to WP
          </button>
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
              <div className="p-6">
                <div className="flex items-center gap-2 mb-4 px-2">
                  <Globe className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">WordPress Preview — This is how your content will appear on your website</span>
                </div>
                <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden max-w-4xl mx-auto">
                  <div className="bg-gray-100 px-4 py-2.5 border-b border-gray-200 flex items-center gap-3">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-400" />
                      <div className="w-3 h-3 rounded-full bg-yellow-400" />
                      <div className="w-3 h-3 rounded-full bg-green-400" />
                    </div>
                    <div className="flex-1 bg-white rounded-lg px-3 py-1 text-xs text-gray-500 font-mono truncate border border-gray-200">
                      {item.url || `yoursite.com/${effectivePublishSlug}`}
                    </div>
                  </div>
                  <style dangerouslySetInnerHTML={{ __html: `
                    .wp-preview-content h1 { font-size: 32px; font-weight: 800; color: #0f172a; margin: 32px 0 16px; line-height: 1.3; letter-spacing: -0.02em; }
                    .wp-preview-content h2 { font-size: 26px; font-weight: 700; color: #0f172a; margin: 40px 0 16px; line-height: 1.35; letter-spacing: -0.01em; border-bottom: 2px solid #f1f5f9; padding-bottom: 12px; }
                    .wp-preview-content h3 { font-size: 21px; font-weight: 700; color: #1e293b; margin: 32px 0 12px; line-height: 1.4; }
                    .wp-preview-content p { margin: 0 0 20px; color: #374151; line-height: 1.85; font-size: 17px; }
                    .wp-preview-content a { color: #2563eb; text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 0.2s; }
                    .wp-preview-content a:hover { border-bottom-color: #2563eb; }
                    .wp-preview-content strong { color: #0f172a; font-weight: 700; }
                    .wp-preview-content ul, .wp-preview-content ol { margin: 16px 0 24px; padding-left: 28px; color: #374151; }
                    .wp-preview-content li { margin-bottom: 10px; line-height: 1.8; }
                    .wp-preview-content blockquote { border-left: 4px solid #10b981; margin: 24px 0; padding: 16px 24px; background: #f8fafc; border-radius: 0 12px 12px 0; }
                    .wp-preview-content img { max-width: 100%; height: auto; border-radius: 12px; margin: 24px 0; }
                    .wp-preview-content table { width: 100%; border-collapse: collapse; margin: 24px 0; }
                    .wp-preview-content th { background: #f8fafc; padding: 14px 18px; text-align: left; font-weight: 700; color: #0f172a; border: 1px solid #e2e8f0; }
                    .wp-preview-content td { padding: 14px 18px; border: 1px solid #e2e8f0; color: #374151; }
                    .wp-preview-content iframe { max-width: 100%; }
                    .wp-preview-content hr { border: none; border-top: 2px solid #f1f5f9; margin: 40px 0; }
                  `}} />
                  <article 
                    className="wp-preview-content"
                    style={{
                      padding: '48px 56px',
                      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                      color: '#1a1a1a',
                      lineHeight: 1.8,
                      fontSize: '17px',
                      backgroundColor: '#ffffff',
                      maxWidth: '100%',
                      overflowWrap: 'break-word' as const,
                    }}
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}
                  />
                </div>
              </div>
            )}

            {/* Editor Tab - SOTA Rich Text Editor */}
            {activeTab === 'editor' && (
              <div className="p-6 h-full flex flex-col">
                {/* Editor Toolbar */}
                <div className="bg-card/50 border border-border rounded-xl p-3 mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                      <Edit3 className="w-5 h-5 text-primary" />
                      Content Editor
                      {isEditorDirty && (
                        <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded-full font-medium">
                          Unsaved Changes
                        </span>
                      )}
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleUndo}
                        disabled={historyIndex <= 0}
                        className="p-2 bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all disabled:opacity-30"
                        title="Undo (Ctrl+Z)"
                      >
                        <Undo className="w-4 h-4" />
                      </button>
                      <button
                        onClick={handleRedo}
                        disabled={historyIndex >= editorHistory.length - 1}
                        className="p-2 bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all disabled:opacity-30"
                        title="Redo (Ctrl+Y)"
                      >
                        <Redo className="w-4 h-4" />
                      </button>
                      <div className="w-px h-6 bg-border mx-1" />
                      <button
                        onClick={handleResetEditor}
                        disabled={!isEditorDirty}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg text-sm transition-all disabled:opacity-30"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Reset
                      </button>
                      <button
                        onClick={async () => {
                          await navigator.clipboard.writeText(editedContent);
                          toast.success('Content copied to clipboard!');
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/20 text-primary hover:bg-primary/30 rounded-lg text-sm transition-all"
                      >
                        <Copy className="w-4 h-4" />
                        Copy
                      </button>
                      {onSaveContent && (
                        <button
                          onClick={handleSaveContent}
                          disabled={!isEditorDirty}
                          className="flex items-center gap-1.5 px-4 py-1.5 bg-green-600 text-white hover:bg-green-700 rounded-lg text-sm font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
                        >
                          <Save className="w-4 h-4" />
                          Save Changes
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {/* Formatting Toolbar */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <div className="flex items-center gap-0.5 bg-muted/30 rounded-lg p-1">
                      <button
                        onClick={() => insertHtmlTag('h2')}
                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-all"
                        title="Heading 2"
                      >
                        <Heading2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => insertHtmlTag('h3')}
                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-all"
                        title="Heading 3"
                      >
                        <Heading3 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="w-px h-6 bg-border mx-1" />
                    <div className="flex items-center gap-0.5 bg-muted/30 rounded-lg p-1">
                      <button
                        onClick={() => insertHtmlTag('strong')}
                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-all"
                        title="Bold"
                      >
                        <Bold className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => insertHtmlTag('em')}
                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-all"
                        title="Italic"
                      >
                        <Italic className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="w-px h-6 bg-border mx-1" />
                    <div className="flex items-center gap-0.5 bg-muted/30 rounded-lg p-1">
                      <button
                        onClick={() => insertHtmlTag('ul')}
                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-all"
                        title="Bullet List"
                      >
                        <List className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => insertHtmlTag('ol')}
                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-all"
                        title="Numbered List"
                      >
                        <ListOrdered className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="w-px h-6 bg-border mx-1" />
                    <div className="flex items-center gap-0.5 bg-muted/30 rounded-lg p-1">
                      <button
                        onClick={() => insertHtmlTag('blockquote')}
                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-all"
                        title="Quote"
                      >
                        <Quote className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => insertHtmlTag('table')}
                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-all"
                        title="Table"
                      >
                        <Table className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => insertHtmlTag('img')}
                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-all"
                        title="Image"
                      >
                        <ImageIcon className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="ml-auto text-xs text-muted-foreground">
                      {editedContent.split(/\s+/).filter(Boolean).length.toLocaleString()} words
                    </div>
                  </div>
                </div>

                {/* Split View: Editor + Live Preview */}
                <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
                  {/* HTML Editor */}
                  <div className="flex flex-col bg-muted/20 border border-border rounded-xl overflow-hidden">
                    <div className="bg-muted/30 px-4 py-2 border-b border-border flex items-center gap-2">
                      <Code className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">HTML Source</span>
                    </div>
                    <textarea
                      value={editedContent}
                      onChange={(e) => handleEditorChange(e.target.value)}
                      className="flex-1 p-4 bg-transparent text-foreground font-mono text-sm resize-none focus:outline-none placeholder:text-muted-foreground leading-relaxed"
                      placeholder="Paste or type your HTML content here..."
                      spellCheck={false}
                    />
                  </div>

                  {/* Live Preview */}
                  <div className="flex flex-col bg-muted/20 border border-border rounded-xl overflow-hidden">
                    <div className="bg-muted/30 px-4 py-2 border-b border-border flex items-center gap-2">
                      <Eye className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">Live Preview</span>
                    </div>
                    <div className="flex-1 overflow-auto p-4">
                      <article 
                        className="prose prose-invert prose-sm max-w-none
                          prose-headings:text-foreground prose-headings:font-bold
                          prose-h2:text-xl prose-h2:mb-3 prose-h2:mt-6 prose-h2:text-primary
                          prose-h3:text-lg prose-h3:mb-2 prose-h3:mt-4
                          prose-p:text-muted-foreground prose-p:leading-relaxed prose-p:mb-3
                          prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                          prose-strong:text-foreground
                          prose-ul:my-3 prose-li:text-muted-foreground prose-li:mb-1
                          prose-blockquote:border-l-primary prose-blockquote:bg-muted/30 prose-blockquote:py-2 prose-blockquote:px-3 prose-blockquote:rounded-r-lg
                          prose-table:border prose-table:border-border
                          prose-th:bg-muted/50 prose-th:p-2 prose-th:text-left prose-th:text-sm
                          prose-td:p-2 prose-td:border-t prose-td:border-border prose-td:text-sm"
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(editedContent) }}
                      />
                    </div>
                  </div>
                </div>

                {/* Editor Tips */}
                <div className="mt-4 p-3 bg-primary/5 border border-primary/20 rounded-xl">
                  <div className="flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-muted-foreground">
                      <p className="font-medium text-foreground mb-1">💡 Pro Tips:</p>
                      <ul className="list-disc list-inside space-y-1">
                        <li>Use the toolbar buttons to insert formatted HTML elements</li>
                        <li>Changes are saved to your clipboard - click "Copy" when done</li>
                        <li>The live preview updates as you type</li>
                        <li>Click "Reset" to restore the original generated content</li>
                      </ul>
                    </div>
                  </div>
                </div>
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

                    {/* Extended Terms & Entities Row */}
                    <div className="grid md:grid-cols-2 gap-6">
                      {/* Extended Terms */}
                      {neuronData.termsExtended && neuronData.termsExtended.length > 0 && (
                        <div className="bg-card/50 border border-border rounded-xl p-6">
                          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-green-400" />
                            Extended Terms
                            <span className="ml-auto text-sm text-muted-foreground">
                              {countTermsUsed(neuronData.termsExtended, content)}/{neuronData.termsExtended.length} used
                            </span>
                          </h3>
                          <div className="space-y-2 max-h-[400px] overflow-y-auto">
                            {neuronData.termsExtended.slice(0, 50).map((term, i) => (
                              <TermRowNeuron key={i} term={term} content={content} />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Entities */}
                      {neuronData.entities && neuronData.entities.length > 0 && (
                        <div className="bg-card/50 border border-border rounded-xl p-6">
                          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                            <Globe className="w-5 h-5 text-orange-400" />
                            Named Entities
                            <span className="ml-auto text-sm text-muted-foreground">
                              {neuronData.entities.filter(e => content.toLowerCase().includes(e.entity.toLowerCase())).length}/{neuronData.entities.length} used
                            </span>
                          </h3>
                          <div className="space-y-2 max-h-[400px] overflow-y-auto">
                            {neuronData.entities.map((entity, i) => {
                              const isUsed = content.toLowerCase().includes(entity.entity.toLowerCase());
                              return (
                                <div key={i} className={`flex items-center justify-between p-2 rounded-lg border ${isUsed ? 'bg-green-500/10 border-green-500/30' : 'bg-muted/30 border-border'}`}>
                                  <span className={`text-sm ${isUsed ? 'text-green-400' : 'text-muted-foreground'}`}>
                                    {isUsed && <CheckCircle className="w-3 h-3 inline mr-1" />}
                                    {entity.entity}
                                    {entity.type && <span className="ml-1 text-xs opacity-60">[{entity.type}]</span>}
                                  </span>
                                  <span className="text-xs text-muted-foreground">{entity.usage_pc || 30}%</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* H2/H3 Headings Suggestions */}
                    {((neuronData.headingsH2 && neuronData.headingsH2.length > 0) || (neuronData.headingsH3 && neuronData.headingsH3.length > 0)) && (
                      <div className="grid md:grid-cols-2 gap-6">
                        {/* H2 Headings */}
                        {neuronData.headingsH2 && neuronData.headingsH2.length > 0 && (
                          <div className="bg-card/50 border border-border rounded-xl p-6">
                            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                              <Type className="w-5 h-5 text-blue-400" />
                              Recommended H2 Headings
                              <span className="ml-auto text-sm text-muted-foreground">
                                {neuronData.headingsH2.filter(h => content.toLowerCase().includes(h.text.toLowerCase().slice(0, 20))).length}/{neuronData.headingsH2.length}
                              </span>
                            </h3>
                            <div className="space-y-2 max-h-[300px] overflow-y-auto">
                              {neuronData.headingsH2.map((heading, i) => {
                                const isUsed = content.toLowerCase().includes(heading.text.toLowerCase().slice(0, 20));
                                return (
                                  <div key={i} className={`flex items-start justify-between p-2 rounded-lg border ${isUsed ? 'bg-green-500/10 border-green-500/30' : 'bg-muted/30 border-border'}`}>
                                    <span className={`text-sm ${isUsed ? 'text-green-400' : 'text-muted-foreground'}`}>
                                      {isUsed && <CheckCircle className="w-3 h-3 inline mr-1" />}
                                      {heading.text}
                                    </span>
                                    <span className="text-xs text-muted-foreground ml-2 shrink-0">{heading.usage_pc || 50}%</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* H3 Headings */}
                        {neuronData.headingsH3 && neuronData.headingsH3.length > 0 && (
                          <div className="bg-card/50 border border-border rounded-xl p-6">
                            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                              <List className="w-5 h-5 text-cyan-400" />
                              Recommended H3 Subheadings
                              <span className="ml-auto text-sm text-muted-foreground">
                                {neuronData.headingsH3.filter(h => content.toLowerCase().includes(h.text.toLowerCase().slice(0, 15))).length}/{neuronData.headingsH3.length}
                              </span>
                            </h3>
                            <div className="space-y-2 max-h-[300px] overflow-y-auto">
                              {neuronData.headingsH3.map((heading, i) => {
                                const isUsed = content.toLowerCase().includes(heading.text.toLowerCase().slice(0, 15));
                                return (
                                  <div key={i} className={`flex items-start justify-between p-2 rounded-lg border ${isUsed ? 'bg-green-500/10 border-green-500/30' : 'bg-muted/30 border-border'}`}>
                                    <span className={`text-sm ${isUsed ? 'text-green-400' : 'text-muted-foreground'}`}>
                                      {isUsed && <CheckCircle className="w-3 h-3 inline mr-1" />}
                                      {heading.text}
                                    </span>
                                    <span className="text-xs text-muted-foreground ml-2 shrink-0">{heading.usage_pc || 30}%</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

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

      {/* WordPress Publish Modal */}
      {showPublishModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
                <Upload className="w-5 h-5 text-primary" />
                Publish to WordPress
              </h3>
              <button
                onClick={() => setShowPublishModal(false)}
                className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!isConfigured ? (
              <div className="text-center py-8">
                <AlertTriangle className="w-12 h-12 text-yellow-400 mx-auto mb-4" />
                <h4 className="text-lg font-semibold text-foreground mb-2">WordPress Not Configured</h4>
                <p className="text-muted-foreground mb-4">
                  Add your WordPress URL, username, and application password in the Setup tab to enable publishing.
                </p>
                <button
                  onClick={() => setShowPublishModal(false)}
                  className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80"
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Post Title
                    </label>
                    <div className="px-4 py-3 bg-muted/30 border border-border rounded-xl text-foreground">
                      {item.title}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Publish Status
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPublishStatus('draft')}
                        className={cn(
                          "flex-1 px-4 py-3 rounded-xl font-medium transition-all border",
                          publishStatus === 'draft'
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"
                        )}
                      >
                        📝 Draft
                      </button>
                      <button
                        onClick={() => setPublishStatus('publish')}
                        className={cn(
                          "flex-1 px-4 py-3 rounded-xl font-medium transition-all border",
                          publishStatus === 'publish'
                            ? "bg-green-600 text-white border-green-600"
                            : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"
                        )}
                      >
                        🚀 Publish
                      </button>
                    </div>
                  </div>

                  <div className="p-4 bg-muted/20 border border-border rounded-xl">
                    <h4 className="text-sm font-medium text-foreground mb-3">What will be published:</h4>
                    <ul className="text-sm text-muted-foreground space-y-2">
                      <li className="flex items-start gap-2">
                        <span className="text-primary">•</span>
                        <span>Full HTML content ({wordCount.toLocaleString()} words)</span>
                      </li>
                      {generatedContent?.seoTitle && (
                        <li className="flex items-start gap-2">
                          <span className="text-green-400">•</span>
                          <span>SEO Title: <span className="font-medium text-foreground">"{generatedContent.seoTitle}"</span></span>
                        </li>
                      )}
                      {generatedContent?.metaDescription && (
                        <li className="flex items-start gap-2">
                          <span className="text-green-400">•</span>
                          <span>Meta Description ({generatedContent.metaDescription.length} chars)</span>
                        </li>
                      )}
                      {sourcePathname && (
                        <li className="flex items-start gap-2">
                          <span className="text-blue-400">•</span>
                          <span>Source URL: <span className="font-mono text-xs">{sourcePathname}</span></span>
                        </li>
                      )}
                      <li className="flex items-start gap-2">
                        <span className="text-yellow-400">•</span>
                        <span>WordPress Slug: <span className="font-mono text-foreground">/{effectivePublishSlug}</span></span>
                      </li>
                    </ul>
                    <div className="mt-3 pt-3 border-t border-border">
                      <p className="text-xs text-muted-foreground">
                        ✨ SEO title and meta description will be set in Yoast SEO, RankMath, or All-in-One SEO
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowPublishModal(false)}
                    className="flex-1 px-4 py-3 bg-muted text-foreground rounded-xl font-medium hover:bg-muted/80 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handlePublishToWordPress}
                    disabled={isPublishing}
                    className="flex-1 px-4 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isPublishing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Publishing...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        {publishStatus === 'draft' ? 'Save as Draft' : 'Publish Now'}
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
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

  // Format to 1 decimal place
  const formattedValue = Number.isInteger(value) ? value : value.toFixed(1);

  return (
    <div className="text-center">
      <div className={cn("text-3xl font-bold", getColor(value))}>{formattedValue}%</div>
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
  // Format to 1 decimal place for cleaner display
  const density = words > 0 ? ((count / words) * 100).toFixed(1) : '0';
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
