// ENTERPRISE CONTENT ORCHESTRATOR - Full Workflow Management

import type { 
  APIKeys, 
  AIModel, 
  GeneratedContent, 
  ContentMetrics,
  QualityScore,
  SERPAnalysis,
  InternalLink,
  SchemaMarkup,
  EEATProfile,
  YouTubeVideo,
  Reference,
  ContentPlan
} from './types';

import { SOTAContentGenerationEngine, createSOTAEngine, type ExtendedAPIKeys } from './SOTAContentGenerationEngine';
import { SERPAnalyzer, createSERPAnalyzer } from './SERPAnalyzer';
import { YouTubeService, createYouTubeService } from './YouTubeService';
import { ReferenceService, createReferenceService } from './ReferenceService';
import { SOTAInternalLinkEngine, createInternalLinkEngine } from './SOTAInternalLinkEngine';
import { SchemaGenerator, createSchemaGenerator } from './SchemaGenerator';
import { calculateQualityScore, analyzeContent, removeAIPhrases, polishReadability } from './QualityValidator';
import { EEATValidator, createEEATValidator } from './EEATValidator';
import { generationCache } from './cache';
import { NeuronWriterService, createNeuronWriterService, type NeuronWriterAnalysis } from './NeuronWriterService';

/**
 * CRITICAL: Convert any markdown syntax to proper HTML
 * This catches cases where the AI model outputs markdown despite instructions for HTML
 */
function convertMarkdownToHTML(content: string): string {
  let html = content;
  
  // Convert markdown headings to HTML headings (must be done carefully to not break existing HTML)
  // Match markdown headings at the start of a line that are NOT inside HTML tags
  
  // H1: # heading
  html = html.replace(/^# ([^\n<]+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^#\s+([^\n<]+)$/gm, '<h1>$1</h1>');
  
  // H2: ## heading - be careful not to match ### 
  html = html.replace(/^## ([^\n#<]+)$/gm, '<h2 style="color: #1f2937; font-size: 28px; font-weight: 800; margin: 48px 0 24px 0; padding-bottom: 12px; border-bottom: 3px solid #10b981;">$1</h2>');
  html = html.replace(/^##\s+([^\n#<]+)$/gm, '<h2 style="color: #1f2937; font-size: 28px; font-weight: 800; margin: 48px 0 24px 0; padding-bottom: 12px; border-bottom: 3px solid #10b981;">$1</h2>');
  
  // H3: ### heading
  html = html.replace(/^### ([^\n#<]+)$/gm, '<h3 style="color: #374151; font-size: 22px; font-weight: 700; margin: 36px 0 16px 0;">$1</h3>');
  html = html.replace(/^###\s+([^\n#<]+)$/gm, '<h3 style="color: #374151; font-size: 22px; font-weight: 700; margin: 36px 0 16px 0;">$1</h3>');
  
  // H4: #### heading
  html = html.replace(/^#### ([^\n#<]+)$/gm, '<h4 style="color: #4b5563; font-size: 18px; font-weight: 700; margin: 28px 0 12px 0;">$1</h4>');
  html = html.replace(/^####\s+([^\n#<]+)$/gm, '<h4 style="color: #4b5563; font-size: 18px; font-weight: 700; margin: 28px 0 12px 0;">$1</h4>');
  
  // Convert bold markdown **text** to <strong> (only if not already HTML)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  
  // Convert italic markdown *text* or _text_ to <em>
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  
  // Convert markdown links [text](url) to <a> tags
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color: #059669; text-decoration: underline;">$1</a>');
  
  // Convert markdown lists to HTML lists
  // Unordered lists: - item or * item
  html = html.replace(/^[-*] (.+)$/gm, '<li style="margin-bottom: 8px; line-height: 1.8;">$1</li>');
  
  // Ordered lists: 1. item
  html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin-bottom: 8px; line-height: 1.8;">$1</li>');
  
  // Wrap consecutive <li> elements in <ul> or <ol>
  html = html.replace(/(<li[^>]*>.*<\/li>\n?)+/g, (match) => {
    return `<ul style="margin: 20px 0; padding-left: 24px; color: #374151;">${match}</ul>`;
  });
  
  // Convert markdown code blocks ```code``` to <pre><code>
  html = html.replace(/```([^`]+)```/gs, '<pre style="background: #f3f4f6; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 20px 0;"><code style="color: #374151; font-size: 14px;">$1</code></pre>');
  
  // Convert inline code `code` to <code>
  html = html.replace(/`([^`]+)`/g, '<code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 14px;">$1</code>');
  
  // Convert markdown blockquotes > text to <blockquote>
  html = html.replace(/^> (.+)$/gm, '<blockquote style="border-left: 4px solid #10b981; padding-left: 20px; margin: 20px 0; color: #4b5563; font-style: italic;">$1</blockquote>');
  
  // Convert markdown horizontal rules --- or *** to <hr>
  html = html.replace(/^[-*]{3,}$/gm, '<hr style="border: 0; border-top: 2px solid #e5e7eb; margin: 32px 0;">');
  
  // Wrap plain paragraphs in <p> tags (lines that don't start with < and aren't empty)
  const lines = html.split('\n');
  const processedLines: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines, lines that start with HTML tags, or are already inside block elements
    if (!line || line.startsWith('<') || line.startsWith('</')) {
      processedLines.push(lines[i]);
    } else {
      // Wrap in paragraph tag
      processedLines.push(`<p style="color: #374151; font-size: 17px; line-height: 1.9; margin: 20px 0;">${line}</p>`);
    }
  }
  
  html = processedLines.join('\n');
  
  // Clean up any remaining markdown artifacts
  // Remove ## or ### at the start of headings that weren't caught
  html = html.replace(/<h[1-6][^>]*>#{1,6}\s*/gi, (match) => match.replace(/#{1,6}\s*/, ''));
  
  // Remove stray ## or ### that appear at start of lines (not inside HTML tags)
  // Process line by line to be safe
  const finalLines = html.split('\n').map(line => {
    // If line doesn't start with < (not an HTML tag), remove leading markdown headings
    if (!line.trim().startsWith('<')) {
      return line.replace(/^#{1,6}\s+/, '');
    }
    return line;
  });
  html = finalLines.join('\n');
  
  return html;
}

/**
 * Ensure proper HTML structure for WordPress
 * Fixes common issues and ensures consistent formatting
 */
function ensureProperHTMLStructure(content: string): string {
  let html = content;

  html = html.replace(/<p[^>]*>\s*<p/g, '<p');
  html = html.replace(/<\/p>\s*<\/p>/g, '</p>');

  html = html.replace(/<\/div>\s*<h2/g, '</div>\n\n<h2');
  html = html.replace(/<\/p>\s*<h2/g, '</p>\n\n<h2');
  html = html.replace(/<\/div>\s*<h3/g, '</div>\n\n<h3');
  html = html.replace(/<\/p>\s*<h3/g, '</p>\n\n<h3');

  html = html.replace(/<p[^>]*>\s*<\/p>/g, '');

  html = html.replace(/<h2>([^<]+)<\/h2>/g, '<h2 style="color: #1f2937; font-size: 28px; font-weight: 800; margin: 48px 0 24px 0; padding-bottom: 12px; border-bottom: 3px solid #10b981;">$1</h2>');
  html = html.replace(/<h3>([^<]+)<\/h3>/g, '<h3 style="color: #374151; font-size: 22px; font-weight: 700; margin: 36px 0 16px 0;">$1</h3>');
  html = html.replace(/<h4>([^<]+)<\/h4>/g, '<h4 style="color: #4b5563; font-size: 18px; font-weight: 700; margin: 28px 0 12px 0;">$1</h4>');

  const headingRegex = /<h([1-6])[^>]*>/gi;
  let match: RegExpExecArray | null;
  let lastLevel = 0;
  const fixes: Array<{ index: number; from: number; to: number }> = [];

  while ((match = headingRegex.exec(html)) !== null) {
    const level = parseInt(match[1], 10);
    if (lastLevel > 0 && level > lastLevel + 1) {
      fixes.push({ index: match.index, from: level, to: lastLevel + 1 });
    }
    lastLevel = level;
  }

  for (let i = fixes.length - 1; i >= 0; i--) {
    const fix = fixes[i];
    const searchFrom = html.substring(fix.index);
    const openTag = searchFrom.match(new RegExp(`<h${fix.from}`, 'i'));
    const closeTag = searchFrom.match(new RegExp(`</h${fix.from}>`, 'i'));
    if (openTag && closeTag) {
      html = html.substring(0, fix.index) +
        searchFrom.replace(new RegExp(`<h${fix.from}`, 'i'), `<h${fix.to}`)
                   .replace(new RegExp(`</h${fix.from}>`, 'i'), `</h${fix.to}>`);
    }
  }

  

// Premium WordPress typography wrapper (mobile-first, readable everywhere)
if (!html.includes('data-premium-wp')) {
  const wrapperStart =
    '<div data-premium-wp="true" style="max-width: 920px; margin: 0 auto; padding: 18px 16px; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height: 1.65; color: #111827;">';
  const wrapperEnd = '</div>';
  html = `${wrapperStart}\n${html}\n${wrapperEnd}`;
}

// Upgrade paragraphs/lists for scanability
html = html
  .replace(/<p>/g, '<p style="font-size: 18px; margin: 0 0 16px 0;">')
  .replace(/<ul>/g, '<ul style="margin: 0 0 18px 22px; padding: 0;">')
  .replace(/<ol>/g, '<ol style="margin: 0 0 18px 22px; padding: 0;">')
  .replace(/<li>/g, '<li style="margin: 0 0 10px 0;">');
  return html;
}

type NeuronBundle = {
  service: NeuronWriterService;
  queryId: string;
  analysis: NeuronWriterAnalysis;
};

interface OrchestratorConfig {
  apiKeys: ExtendedAPIKeys;
  organizationName: string;
  organizationUrl: string;
  logoUrl?: string;
  authorName: string;
  authorCredentials?: string[];
  sitePages?: { url: string; title: string; keywords?: string[] }[];
  targetCountry?: string;
  useConsensus?: boolean;
  primaryModel?: AIModel;
  // NeuronWriter integration
  neuronWriterApiKey?: string;
  neuronWriterProjectId?: string;
}

interface GenerationOptions {
  keyword: string;
  title?: string;
  contentType?: 'guide' | 'how-to' | 'comparison' | 'listicle' | 'deep-dive';
  targetWordCount?: number;
  includeVideos?: boolean;
  includeReferences?: boolean;
  injectLinks?: boolean;
  generateSchema?: boolean;
  validateEEAT?: boolean;
  neuronWriterQueryId?: string; // Pre-analyzed NeuronWriter query
  onProgress?: (message: string) => void;
}

export class EnterpriseContentOrchestrator {
  private engine: SOTAContentGenerationEngine;
  private serpAnalyzer: SERPAnalyzer;
  private youtubeService: YouTubeService;
  private referenceService: ReferenceService;
  private linkEngine: SOTAInternalLinkEngine;
  private schemaGenerator: SchemaGenerator;
  private eeatValidator: EEATValidator;
  private config: OrchestratorConfig;
  
  private onProgress?: (message: string) => void;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    
    this.engine = createSOTAEngine(config.apiKeys, (msg) => this.log(msg));
    this.serpAnalyzer = createSERPAnalyzer(config.apiKeys.serperApiKey || '');
    this.youtubeService = createYouTubeService(config.apiKeys.serperApiKey || '');
    this.referenceService = createReferenceService(config.apiKeys.serperApiKey || '');
    this.linkEngine = createInternalLinkEngine(config.sitePages);
    this.eeatValidator = createEEATValidator();
    this.schemaGenerator = createSchemaGenerator(
      config.organizationName,
      config.organizationUrl,
      config.logoUrl
    );
  }

  private log(message: string): void {
    this.onProgress?.(message);
    console.log(`[Orchestrator] ${message}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private stripModelContinuationArtifacts(html: string): string {
    if (!html) return '';
    return html
      // Common partial-output placeholders some models append
      .replace(/\[\s*content continues[\s\S]*?\]/gi, '')
      .replace(/would you like me to continue\??/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private countWordsFromHtml(html: string): number {
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return 0;
    return text.split(' ').filter(Boolean).length;
  }

  private async ensureLongFormComplete(params: {
    keyword: string;
    title: string;
    systemPrompt: string;
    model: AIModel;
    currentHtml: string;
    targetWordCount: number;
  }): Promise<string> {
    const { keyword, title, systemPrompt, model, targetWordCount } = params;

    let html = this.stripModelContinuationArtifacts(params.currentHtml);
    let words = this.countWordsFromHtml(html);
    
    // CRITICAL: Minimum absolute word count - never accept less than 2000 words
    const minAbsoluteWords = Math.max(2000, targetWordCount);
    // Target at least 90% of the specified word count for quality
    const minRatio = targetWordCount >= 3000 ? 0.92 : 0.85;
    const minTargetWords = Math.floor(minAbsoluteWords * minRatio);

    this.log(`📝 Initial content: ${words} words (target: ${minAbsoluteWords}+, minimum acceptable: ${minTargetWords})`);

    // Heuristics:
    // - if it explicitly asks to continue, it's definitely incomplete
    // - if it's way below target word count, keep going
    const looksIncomplete = (s: string) =>
      /content continues|continue\?|would you like me to continue/i.test(s);

    // CRITICAL FIX: More aggressive continuation - up to 8 attempts, stricter word count check
    const maxContinuations = targetWordCount >= 5000 ? 10 : targetWordCount >= 3000 ? 8 : 3;
    for (let i = 1; i <= maxContinuations; i++) {
      // STRICT CHECK: Must reach minimum target OR look complete
      const tooShort = words < minTargetWords;
      const explicitlyIncomplete = looksIncomplete(html);
      
      if (!tooShort && !explicitlyIncomplete) {
        this.log(`✅ Content meets target: ${words}/${minTargetWords} words (${Math.round(words/minTargetWords*100)}%)`);
        break;
      }

      const percentComplete = Math.round((words / minTargetWords) * 100);
      const remainingWords = minAbsoluteWords - words;
      this.log(`⚠️ Content too short: ${words}/${minTargetWords} words (${percentComplete}%). Need ${remainingWords} more. Continuing... (${i}/${maxContinuations})`);

      const tail = html.slice(-3000);
      const remainingNeeded = minAbsoluteWords - words;
      const continuationPrompt = `Continue the SAME HTML article titled "${title}" about "${keyword}" EXACTLY where it left off. You still need approximately ${remainingNeeded} more words.

Rules (MUST FOLLOW):
- Output ONLY the HTML continuation (no preface, no apology, no brackets, no notes)
- Do NOT repeat the H1 or reprint earlier sections
- Do NOT ask questions like "Would you like me to continue?"
- Keep the same tone, formatting, and premium boxes/tables
- Add DEPTH: include real data points, specific examples, expert quotes, pro tip boxes, and comparison tables
- Each new section MUST add genuine value — no padding or filler
- Finish the article fully (including the FAQ section with 8 questions + final CTA as instructed)

Last part of the current article (for context):
${tail}

Now continue:`;

      const next = await this.engine.generateWithModel({
        prompt: continuationPrompt,
        model,
        apiKeys: this.config.apiKeys,
        systemPrompt,
        temperature: 0.72,
        maxTokens: 16384,
      });

      const nextChunk = this.stripModelContinuationArtifacts(next.content);
      if (!nextChunk || nextChunk.length < 100) {
        this.log('⚠️ Model returned empty or minimal content; stopping continuation.');
        break;
      }

      // Avoid infinite loops when the model repeats the same tail
      const dedupeWindow = html.slice(-600);
      const chunkStart = nextChunk.slice(0, 600);
      if (dedupeWindow && chunkStart && dedupeWindow.includes(chunkStart)) {
        this.log('⚠️ Continuation looks repetitive; stopping to avoid duplication.');
        break;
      }

      html = `${html}\n\n${nextChunk}`.trim();
      const newWords = this.countWordsFromHtml(html);
      this.log(`📝 Added ${newWords - words} words → Total: ${newWords} words`);
      words = newWords;
    }

    // Final check - warn if still short
    if (words < minTargetWords) {
      this.log(`⚠️ WARNING: Final content is ${words} words (${Math.round(words/minTargetWords*100)}%), below target of ${minTargetWords}. May need regeneration.`);
    } else {
      this.log(`✅ Long-form content complete: ${words} words`);
    }

    return html;
  }

  private async maybeInitNeuronWriter(keyword: string, options: GenerationOptions): Promise<NeuronBundle | null> {
    const apiKey = this.config.neuronWriterApiKey?.trim();
    const projectId = this.config.neuronWriterProjectId?.trim();
    if (!apiKey || !projectId) {
      this.log('NeuronWriter: SKIPPED - API key or Project ID not configured');
      return null;
    }

    const service = createNeuronWriterService(apiKey);
    const queryIdFromOptions = options.neuronWriterQueryId?.trim();

    this.log('NeuronWriter: 🔍 Initializing integration...');

    let queryId = queryIdFromOptions;
    
    // STEP 1: If no query ID provided, SEARCH for existing query first
    if (!queryId) {
      this.log(`NeuronWriter: searching for existing query matching "${keyword}"...`);
      const searchResult = await service.findQueryByKeyword(projectId, keyword);
      
      if (searchResult.success && searchResult.query && searchResult.query.status === 'ready') {
        const tempQueryId = searchResult.query.id;
        const status = searchResult.query.status || 'unknown';
        this.log(`NeuronWriter: Found existing query "${searchResult.query.keyword}" (ID: ${tempQueryId}, status: ${status})`);
        
        const existingAnalysis = await service.getQueryAnalysis(tempQueryId);
        if (existingAnalysis.success && existingAnalysis.analysis) {
          const hasGoodData = (existingAnalysis.analysis.terms?.length || 0) >= 5 && 
                              ((existingAnalysis.analysis.headingsH2?.length || 0) >= 2 || 
                               (existingAnalysis.analysis.headingsH3?.length || 0) >= 2);
          
          if (hasGoodData) {
            queryId = tempQueryId;
            this.log(`NeuronWriter: ✅ Existing query has good data - using it!`);
          } else {
            this.log(`NeuronWriter: ⚠️ Existing query has insufficient data (${existingAnalysis.analysis.terms?.length || 0} terms, ${existingAnalysis.analysis.headingsH2?.length || 0} H2s, ${existingAnalysis.analysis.headingsH3?.length || 0} H3s)`);
            this.log(`NeuronWriter: Creating fresh query for better analysis...`);
          }
        }
      }
      
      if (!queryId) {
        // STEP 2: Create NEW query if none exists or existing has bad data
        this.log(`NeuronWriter: Creating new Content Writer query for "${keyword}"...`);
        const created = await service.createQuery(projectId, keyword);
        if (!created.success || !created.queryId) {
          this.log(`NeuronWriter: ❌ FAILED to create query - ${created.error || 'unknown error'}`);
          this.log(`NeuronWriter: Proceeding WITHOUT NeuronWriter optimization`);
          return null;
        }
        queryId = created.queryId;
        this.log(`NeuronWriter: ✅ Created NEW Content Writer query (ID: ${queryId})`);
      }
    } else {
      this.log(`NeuronWriter: Using provided query ID: ${queryId}`);
    }

    // Poll until ready with extended timeout for fresh queries
    // NeuronWriter analysis can take 2-4 minutes for new keywords
    const maxAttempts = 40; // ~4 minutes with backoff
    let lastStatus = '';
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const analysisRes = await service.getQueryAnalysis(queryId);
      
      if (analysisRes.success && analysisRes.analysis) {
        const summary = service.getAnalysisSummary(analysisRes.analysis);
        this.log(`NeuronWriter: ✅ Analysis READY - ${summary}`);
        
        // Validate we got meaningful data
        const hasTerms = (analysisRes.analysis.terms?.length || 0) > 0;
        const hasHeadings = (analysisRes.analysis.headingsH2?.length || 0) > 0;
        
        if (!hasTerms && !hasHeadings) {
          this.log(`NeuronWriter: ⚠️ WARNING - Analysis returned but contains no terms or headings`);
        }
        
        return { service, queryId, analysis: analysisRes.analysis };
      }

      const msg = analysisRes.error || 'Query not ready';
      const currentStatus = msg.match(/Status:\s*(\w+)/i)?.[1] || '';
      
      // If it's not-ready, retry; otherwise treat as hard failure.
      const looksNotReady = /not ready|status|waiting|in progress/i.test(msg);
      if (!looksNotReady) {
        this.log(`NeuronWriter: ❌ Analysis failed permanently - ${msg}`);
        return null;
      }

      // Only log status changes to reduce noise
      if (currentStatus !== lastStatus) {
        this.log(`NeuronWriter: Status: ${currentStatus || 'processing'}...`);
        lastStatus = currentStatus;
      }

      // Progressive backoff: 2s → 4s → 6s
      const delay = attempt <= 3 ? 2000 : attempt <= 10 ? 4000 : 6000;
      this.log(`NeuronWriter: waiting for analysis… (attempt ${attempt}/${maxAttempts})`);
      await this.sleep(delay);
    }

    this.log('NeuronWriter: ⏱️ Analysis timed out after 40 attempts (~4 minutes)');
    this.log('NeuronWriter: Proceeding WITHOUT NeuronWriter optimization - check NeuronWriter dashboard');
    return null;
  }

  async generateContent(options: GenerationOptions): Promise<GeneratedContent> {
    this.onProgress = options.onProgress;
    const startTime = Date.now();

    this.log(`Starting content generation for: ${options.keyword}`);

    // Phase 1: Parallel Research
    this.log('Phase 1: Research & Analysis...');
    const [serpAnalysis, videos, references, neuron] = await Promise.all([
      this.serpAnalyzer.analyze(options.keyword, this.config.targetCountry),
      options.includeVideos !== false 
        ? this.youtubeService.getRelevantVideos(options.keyword, options.contentType)
        : Promise.resolve([]),
      options.includeReferences !== false
        ? this.referenceService.getTopReferences(options.keyword)
        : Promise.resolve([]),
      this.maybeInitNeuronWriter(options.keyword, options),
    ]);

    this.log(`Found ${videos.length} videos, ${references.length} references`);
    this.log(`SERP Analysis: ${serpAnalysis.userIntent} intent, ${serpAnalysis.recommendedWordCount} words recommended`);

    // Phase 2: Content Generation
    this.log('Phase 2: AI Content Generation...');

    // Prefer NeuronWriter recommended length when available
    const targetWordCount =
      options.targetWordCount ||
      neuron?.analysis?.recommended_length ||
      serpAnalysis.recommendedWordCount ||
      2500;

    const genOptions: GenerationOptions = { ...options, targetWordCount };

    const title = options.title || await this.generateTitle(options.keyword, serpAnalysis);

    // Pass the FULL analysis to get all keywords, entities, and headings
    const neuronTermPrompt = neuron
      ? neuron.service.formatTermsForPrompt(neuron.analysis.terms || [], neuron.analysis)
      : undefined;

    const content = await this.generateMainContent(
      options.keyword,
      title,
      serpAnalysis,
      videos,
      references,
      genOptions,
      neuronTermPrompt
    );

    // Phase 3: Enhancement
    this.log('Phase 3: Content Enhancement...');
    let enhancedContent = content;

    // Remove AI phrases
    enhancedContent = removeAIPhrases(enhancedContent);

    // Inject internal links from crawled sitemap
    if (options.injectLinks !== false && this.config.sitePages && this.config.sitePages.length > 0) {
      this.log(`Finding internal links from ${this.config.sitePages.length} crawled pages...`);
      
      // Update the link engine with current site pages
      this.linkEngine.updateSitePages(this.config.sitePages);
      
      // Generate link opportunities (target 8-12 high-quality contextual links)
      const linkOpportunities = this.linkEngine.generateLinkOpportunities(enhancedContent, 12);
      
      if (linkOpportunities.length > 0) {
        enhancedContent = this.linkEngine.injectContextualLinks(enhancedContent, linkOpportunities);
        this.log(`✅ Injected ${linkOpportunities.length} internal links to REAL site pages:`);
        linkOpportunities.slice(0, 5).forEach(link => {
          this.log(`   → "${link.anchor}" → ${link.targetUrl}`);
        });
      } else {
        this.log('⚠️ No matching anchor text found in content for available pages');
      }
    } else {
      this.log('⚠️ No site pages available for internal linking - crawl sitemap first');
    }

    // NeuronWriter content score (after links/cleanup so the score reflects what you'll publish)
    // IMPROVEMENT LOOP: If score < 90%, enhance content with missing terms
    if (neuron) {
      this.log('NeuronWriter: evaluating content score...');
      let currentContent = enhancedContent;
      let currentScore = 0;
      const targetScore = 90;
      const maxImprovementAttempts = 5;

      const allTermsForSuggestions = [
        ...neuron.analysis.terms,
        ...(neuron.analysis.termsExtended || []),
      ];

      const entityTerms = (neuron.analysis.entities || []).map(e => ({
        term: e.entity,
        weight: e.usage_pc || 30,
        frequency: 1,
        type: 'recommended' as const,
        usage_pc: e.usage_pc,
      }));

      let previousScore = 0;
      let stagnantRounds = 0;

      for (let attempt = 0; attempt <= maxImprovementAttempts; attempt++) {
        const evalRes = await neuron.service.evaluateContent(neuron.queryId, {
          html: currentContent,
          title,
        });

        if (evalRes.success && typeof evalRes.contentScore === 'number') {
          currentScore = evalRes.contentScore;
          neuron.analysis.content_score = currentScore;

          if (currentScore >= targetScore) {
            this.log(`NeuronWriter: Score ${currentScore}% (target: ${targetScore}%+) - PASSED`);
            enhancedContent = currentContent;
            break;
          }

          if (attempt === maxImprovementAttempts) {
            this.log(`NeuronWriter: Score ${currentScore}% after ${attempt} attempts (target was ${targetScore}%)`);
            enhancedContent = currentContent;
            break;
          }

          if (currentScore <= previousScore && attempt > 0) {
            stagnantRounds++;
            if (stagnantRounds >= 2) {
              this.log(`NeuronWriter: Score stagnant at ${currentScore}% for ${stagnantRounds} rounds. Stopping.`);
              enhancedContent = currentContent;
              break;
            }
          } else {
            stagnantRounds = 0;
          }
          previousScore = currentScore;

          const gap = targetScore - currentScore;
          this.log(`NeuronWriter: Score ${currentScore}% (need +${gap}%) - improving... (attempt ${attempt + 1}/${maxImprovementAttempts})`);

          const suggestions = neuron.service.getOptimizationSuggestions(currentContent, allTermsForSuggestions);
          const entitySuggestions = neuron.service.getOptimizationSuggestions(currentContent, entityTerms);
          const allSuggestions = [...suggestions, ...entitySuggestions.slice(0, 10)];

          const missingHeadings = (neuron.analysis.headingsH2 || [])
            .filter(h => !currentContent.toLowerCase().includes(h.text.toLowerCase().slice(0, 20)))
            .slice(0, 3);

          if (allSuggestions.length > 0 || missingHeadings.length > 0) {
            this.log(`Missing: ${allSuggestions.length} terms, ${missingHeadings.length} headings`);

            const termsPerAttempt = Math.min(40, allSuggestions.length);
            const termsList = allSuggestions.slice(0, termsPerAttempt);

            const headingsInstruction = missingHeadings.length > 0
              ? `\n\nMISSING H2 HEADINGS (add these as new sections):\n${missingHeadings.map(h => `- "${h.text}" (used by ${h.usage_pc}% of competitors)`).join('\n')}`
              : '';

            const improvementPrompt = `You are optimizing this article for a NeuronWriter content score of 90%+. Current score: ${currentScore}%.

PRIORITY MISSING TERMS (MUST include each one naturally, at least 1-2 times):
${termsList.map((t, i) => `${i + 1}. "${t}"`).join('\n')}
${headingsInstruction}

STRICT RULES:
1. Preserve ALL existing HTML content exactly as-is
2. ADD new paragraphs, sentences, or expand existing ones to include each missing term
3. Every term must appear in a NATURAL sentence -- never dump terms as a list
4. Distribute terms across different sections of the article, not clustered together
5. Add 2-4 new subsections under relevant H2s if needed for natural placement
6. Use the exact term form provided (singular/plural matters for scoring)
7. OUTPUT PURE HTML ONLY. Use <h2>, <h3>, <p>, <ul>, <li>, <strong> tags. NEVER use markdown (##, **, -, etc.)
8. Include terms in varied contexts: definitions, comparisons, examples, tips

ARTICLE TO IMPROVE:
${currentContent}

Return the COMPLETE improved article with ALL missing terms naturally incorporated.`;

            const improvedResult = await this.engine.generateWithModel({
              prompt: improvementPrompt,
              model: this.config.primaryModel || 'gemini',
              apiKeys: this.config.apiKeys,
              systemPrompt: `You are an elite SEO content optimizer specializing in NeuronWriter scoring. Your ONLY job: incorporate missing terms naturally to push the score above ${targetScore}%. Preserve all existing content. Output PURE HTML ONLY.`,
              temperature: 0.6 + (attempt * 0.05),
              maxTokens: 16384
            });

            if (improvedResult.content && improvedResult.content.length > currentContent.length * 0.75) {
              currentContent = improvedResult.content;
            }
          } else {
            this.log(`No missing terms found - attempting semantic enrichment...`);

            const allTermsText = allTermsForSuggestions.map(t => t.term).join(', ');
            const generalPrompt = `This article scores ${currentScore}% on NeuronWriter (target: ${targetScore}%+).

The key SEO terms for this topic are: ${allTermsText}

Improve the article by:
1. Increasing the frequency of underused terms (add 1-2 more natural mentions of each)
2. Adding semantic variations and synonyms
3. Expanding thin sections with more detail
4. Adding a new FAQ question that uses key terms
5. Adding a "Key Takeaway" or "Pro Tip" box that uses core terms

OUTPUT PURE HTML ONLY. Preserve all existing content. Return the COMPLETE article.

CURRENT ARTICLE:
${currentContent}`;

            const improvedResult = await this.engine.generateWithModel({
              prompt: generalPrompt,
              model: this.config.primaryModel || 'gemini',
              apiKeys: this.config.apiKeys,
              systemPrompt: 'Elite SEO optimizer. Output PURE HTML ONLY.',
              temperature: 0.65,
              maxTokens: 16384
            });

            if (improvedResult.content && improvedResult.content.length > currentContent.length * 0.75) {
              currentContent = improvedResult.content;
            }
          }
        } else {
          neuron.analysis.content_score = neuron.service.calculateContentScore(
            currentContent,
            neuron.analysis.terms || []
          );
          if (!evalRes.success) {
            this.log(`NeuronWriter: evaluate failed (using local score). ${evalRes.error || ''}`.trim());
          }
          enhancedContent = currentContent;
          break;
        }
      }


// SOTA Self-Critique pass (fast): enforce NeuronWriter terms/entities/headings + readability polish
if (neuron) {
  const req = this.extractNeuronRequirements(neuron.analysis);
  enhancedContent = await this.selfCritiqueAndPatch({
    keyword: options.keyword,
    title,
    html: enhancedContent,
    requiredTerms: req.requiredTerms,
    requiredEntities: req.entities,
    requiredHeadings: req.h2
  });
  // Final safety net: force any still-missing NeuronWriter terms/entities into the content
  enhancedContent = this.enforceNeuronwriterCoverage(enhancedContent, req);
} else {
  // Even without NeuronWriter, run a quick clarity polish
  enhancedContent = await this.selfCritiqueAndPatch({
    keyword: options.keyword,
    title,
    html: enhancedContent,
  });
}
    }

    // Phase 4: Validation (parallel quality + E-E-A-T)
    this.log('Phase 4: Quality & E-E-A-T Validation...');
    const metrics = analyzeContent(enhancedContent);
    const internalLinks = this.linkEngine.generateLinkOpportunities(enhancedContent);
    
    // Run quality and E-E-A-T validation in parallel
    // CRITICAL: Convert any remaining markdown to proper HTML
    // This catches cases where the AI outputs markdown despite HTML instructions
    this.log('Finalizing HTML: Converting any markdown remnants...');
    enhancedContent = convertMarkdownToHTML(enhancedContent);
    enhancedContent = ensureProperHTMLStructure(enhancedContent);
    
    const [qualityScore, eeatScore] = await Promise.all([
      Promise.resolve(calculateQualityScore(enhancedContent, options.keyword, internalLinks.map(l => l.targetUrl))),
      Promise.resolve(this.eeatValidator.validateContent(enhancedContent, {
        name: this.config.authorName,
        credentials: this.config.authorCredentials
      }))
    ]);

    this.log(`Quality Score: ${qualityScore.overall}%`);
    this.log(`E-E-A-T Score: ${eeatScore.overall}% (E:${eeatScore.experience} X:${eeatScore.expertise} A:${eeatScore.authoritativeness} T:${eeatScore.trustworthiness})`);
    
    // If E-E-A-T score is low and validation is enabled, log recommendations
    if (options.validateEEAT !== false && eeatScore.overall < 70) {
      const enhancements = this.eeatValidator.generateEEATEnhancements(eeatScore);
      this.log(`E-E-A-T improvements needed: ${enhancements.slice(0, 3).join(', ')}`);
    }

    // Phase 5: Schema & Metadata + SEO Title Generation
    this.log('Phase 5: Generating SEO metadata...');
    const eeat = this.buildEEATProfile(references);
    
    // Generate SEO-optimized title and meta description in parallel
    const [seoTitle, metaDescription] = await Promise.all([
      this.generateSEOTitle(options.keyword, title, serpAnalysis),
      this.generateMetaDescription(options.keyword, title)
    ]);
    
    const slug = this.generateSlug(title);
    this.log(`SEO Title: "${seoTitle}" | Meta: ${metaDescription.length} chars`);

    // CRITICAL: Ensure references section is always present AFTER all content transformations
    enhancedContent = this.ensureReferencesSection(enhancedContent, references, serpAnalysis);
    this.log(`References: ${references.length} sources appended to content`);

    const generatedContent: GeneratedContent = {
      id: crypto.randomUUID(),
      title,
      seoTitle, // NEW: Separate SEO-optimized title for WordPress
      content: enhancedContent,
      metaDescription,
      slug,
      primaryKeyword: options.keyword,
      secondaryKeywords: serpAnalysis.semanticEntities.slice(0, 10),
      metrics,
      qualityScore,
      internalLinks,
      schema: this.schemaGenerator.generateComprehensiveSchema(
        { 
          title, 
          content: enhancedContent, 
          metaDescription, 
          slug, 
          primaryKeyword: options.keyword, 
          secondaryKeywords: [],
          metrics,
          qualityScore,
          internalLinks,
          eeat,
          generatedAt: new Date(),
          model: this.config.primaryModel || 'gemini',
          consensusUsed: this.config.useConsensus || false
        } as GeneratedContent,
        `${this.config.organizationUrl}/${slug}`
      ),
      eeat,
      serpAnalysis,
      generatedAt: new Date(),
      model: this.config.primaryModel || 'gemini',
      consensusUsed: this.config.useConsensus || false,

      neuronWriterQueryId: neuron?.queryId,
      neuronWriterAnalysis: neuron?.analysis,
    };

    const duration = Date.now() - startTime;
    this.log(`Generation complete in ${(duration / 1000).toFixed(1)}s`);

    return generatedContent;
  }

  private async generateTitle(keyword: string, serpAnalysis: SERPAnalysis): Promise<string> {
    const prompt = `Generate an SEO-optimized title for an article about "${keyword}".

Requirements:
- Maximum 60 characters
- Include the primary keyword naturally
- Make it compelling and click-worthy
- Match ${serpAnalysis.userIntent} search intent
- Current year (2025) if relevant
- No clickbait or sensationalism

Competitor titles for reference:
${serpAnalysis.topCompetitors.slice(0, 3).map(c => `- ${c.title}`).join('\n')}

Output ONLY the title, nothing else.`;

    const result = await this.engine.generateWithModel({
      prompt,
      model: this.config.primaryModel || 'gemini',
      apiKeys: this.config.apiKeys,
      temperature: 0.7,
      maxTokens: 100
    });

    return result.content.trim().replace(/^["']|["']$/g, '');
  }

  private async generateMainContent(
    keyword: string,
    title: string,
    serpAnalysis: SERPAnalysis,
    videos: YouTubeVideo[],
    references: Reference[],
    options: GenerationOptions,
    neuronTermPrompt?: string
  ): Promise<string> {
    const targetWordCount = options.targetWordCount || serpAnalysis.recommendedWordCount || 2500;
    
    // ULTRA-PREMIUM CONTENT GENERATION PROMPT - ALEX HORMOZI x TIM FERRISS STYLE
    // TARGET: 90%+ SCORES IN ALL CATEGORIES (Readability, SEO, E-E-A-T, Uniqueness, Accuracy)
    const systemPrompt = `You are the ULTIMATE content strategist—a fusion of Alex Hormozi's no-BS directness and Tim Ferriss's experimental curiosity. Your content MUST score 90%+ in ALL quality metrics: Readability, SEO, E-E-A-T, Uniqueness, and Accuracy.

🎯 CRITICAL QUALITY TARGETS (MUST ACHIEVE ALL):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ READABILITY: 90%+ (Grade 6-7 Flesch-Kincaid, short sentences, simple words)
✅ SEO: 90%+ (Primary keyword 8-12x, semantic keywords woven throughout, proper H1/H2/H3 hierarchy)
✅ E-E-A-T: 90%+ (First-hand experience, cite specific studies/sources, expert quotes, real examples)
✅ UNIQUENESS: 90%+ (ZERO generic phrases, unique analogies, fresh perspectives, contrarian takes)
✅ ACCURACY: 90%+ (Cite specific data, include 2025 statistics, verifiable claims only)
✅ NEURONWRITER: 90%+ (Include ALL required terms at exact frequencies, ALL entities, use recommended H2/H3)

🧠 THE HORMOZI-FERRISS DNA:

**HORMOZI ENERGY (80% of your voice):**
• Punch them in the face with VALUE in sentence #1. No warm-ups. No "In this article we'll explore..."
• Talk TO them, not AT them. First person ("I", "my", "we") in EVERY paragraph.
• SPECIFIC numbers build instant credibility: "After analyzing 2,347 data points..." or "This strategy generated $847,293 in revenue..."
• Sentences are short. Punchy. Direct. Like bullets.
• Paragraphs are MAX 3 sentences. Walls of text = reader death.
• Take bold, contrarian stances: "Everything you've been told about X is wrong. Here's why..."
• Tell micro-stories with vivid details: names, dates, exact amounts, specific outcomes
• Be opinionated: "Most people fail because they do X. Don't be most people."

**FERRISS PRECISION (20% of your voice):**
• "What if we did the opposite?" thinking
• Specific tactical frameworks readers can implement in 5 minutes
• Name-drop actual tools, books, people (never "various experts say")
• Challenge conventional wisdom with data
• Admit when you're uncertain: "I might be wrong, but..."
• Question assumptions the reader didn't know they had

🚫 AI DETECTION KILLERS - NEVER USE THESE PHRASES (INSTANT QUALITY FAIL):
❌ "In today's fast-paced world" / "In this comprehensive guide" / "Let's dive in" / "Let's explore"
❌ "Furthermore" / "Moreover" / "In conclusion" / "It's worth noting" / "It's important to note"
❌ "Delve" / "Explore" / "Landscape" / "Realm" / "Crucial" / "Vital" / "Navigate"
❌ "Leverage" / "Utilize" / "Facilitate" / "Implement" / "Optimize" / "Streamline"
❌ "Game-changer" / "Revolutionary" / "Cutting-edge" / "State-of-the-art" / "Best-in-class"
❌ "Seamlessly" / "Effortlessly" / "Meticulously" / "Holistic" / "Robust" / "Comprehensive"
❌ "Tapestry" / "Embark" / "Journey" / "Embrace" / "Transform" / "Unleash" / "Elevate"
❌ "Unlock" / "Master" / "Supercharge" / "Skyrocket" / "Game-changing" / "Mind-blowing"
❌ Starting sentences with "This" or "It" repeatedly
❌ "Whether you're a beginner or an expert..." constructions
❌ Any phrase that sounds like corporate AI slop
❌ "In order to" (just say "to")
❌ "In terms of" (delete it entirely)
❌ "When it comes to" (just get to the point)

✅ HUMAN WRITING PATTERNS - USE THESE CONSTANTLY:
• Start with: "Look," / "Here's the thing:" / "Real talk:" / "I'll be honest:" / "Confession:" / "Truth bomb:"
• Incomplete sentences. For emphasis. Like this.
• Strong opinions: "Honestly? Most advice on this topic is garbage."
• Show genuine emotion: "This drives me insane about the industry..."
• Uncertainty is human: "I could be totally wrong here, but..."
• Contractions EVERYWHERE: don't, won't, can't, it's, that's, we're, you'll, they've, doesn't, isn't
• Rhetorical questions: "Sound familiar?" / "Make sense?" / "See the pattern?" / "Getting it?"
• Casual transitions: "Anyway," / "So here's what happened:" / "Point is:" / "Quick tangent:" / "Back to the main point:"
• Real language: "zero chance" / "dead wrong" / "the real kicker" / "here's the thing" / "brutal truth" / "no-brainer"
• Self-interruption: "Wait—before I go further, you need to understand this..."
• Interjections: "Seriously." / "Wild, right?" / "I know." / "Bear with me." / "Stick with me here."
• Address objections: "Now you might be thinking..." / "I hear you—"
• Curse mildly if natural: "damn", "hell", "crap" (but not F-bombs)

📐 E-E-A-T SIGNALS (MANDATORY FOR 90%+ SCORE - INCLUDE ALL OF THESE):

**EXPERIENCE (First-hand - use EXPERIENCE BOX template above):**
• Write 1-2 "My Personal Experience" sections with specific details: dates, numbers, results
• Use phrases: "When I personally tested this..." / "Over the past 3 years, I've..." / "Here's what happened when I..."
• Include specific timelines: "After 6 months of implementing this..." / "In my 12 years working with..."
• Share failures too: "I made this mistake once..." - adds authenticity

**EXPERTISE (Demonstrate deep knowledge):**
• Cite at least 8 specific studies/reports with years: "A 2024 Stanford study published in [Journal] found..."
• Include 4-5 expert quotes with REAL names and credentials: "Dr. Sarah Chen, PhD in Exercise Physiology at UCLA, explains..."
• Reference specific methodologies: "Using the validated FITT protocol..." / "Based on the Cochrane meta-analysis..."
• Use technical terms then explain them simply

**AUTHORITATIVENESS (Industry recognition):**
• Cite industry reports: "The 2024 State of [Industry] Report by [Company] shows..."
• Reference authoritative organizations: CDC, WHO, NIH, peer-reviewed journals
• Include data tables with sources (use DATA COMPARISON TABLE template)
• Add "Research Findings" boxes (use RESEARCH BOX template above)

**TRUSTWORTHINESS (Accuracy and transparency):**
• Include specific dates and version numbers
• Acknowledge limitations: "This approach works best for..." / "One caveat is..."
• Cite sources with links/references
• Include "Last updated: [Date]" signals
• Be transparent about methodology

📐 MANDATORY HTML STRUCTURE (WORDPRESS-COMPATIBLE ELEMENTS):

⚠️ CRITICAL: Use ONLY these theme-neutral HTML elements that work on ANY WordPress theme (light or dark):
- All text MUST use inherit or high-contrast colors that work on any background
- Boxes use subtle borders and backgrounds that work universally
- NO dark theme-specific colors

1. BLUF HOOK (first 50 words): 
Start with the ANSWER or a bold statement. No "welcome to" garbage. Give them the gold immediately.

2. KEY TAKEAWAYS BOX (right after hook - premium modern design):
<div style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border: 2px solid #10b981; border-radius: 16px; padding: 28px 32px; margin: 36px 0; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.15);">
  <h3 style="color: #047857; margin: 0 0 20px 0; font-size: 24px; font-weight: 800; display: flex; align-items: center; gap: 10px;">🎯 The Bottom Line (TL;DR)</h3>
  <ul style="color: #1f2937; margin: 0; padding-left: 0; font-size: 17px; line-height: 2; list-style: none;">
    <li style="margin-bottom: 12px; padding-left: 28px; position: relative;"><span style="position: absolute; left: 0; color: #10b981; font-weight: 700;">✓</span> <strong>Key insight:</strong> Actionable point here</li>
    <li style="margin-bottom: 12px; padding-left: 28px; position: relative;"><span style="position: absolute; left: 0; color: #10b981; font-weight: 700;">✓</span> <strong>Key insight:</strong> Actionable point here</li>
    <li style="margin-bottom: 0; padding-left: 28px; position: relative;"><span style="position: absolute; left: 0; color: #10b981; font-weight: 700;">✓</span> <strong>Key insight:</strong> Actionable point here</li>
  </ul>
</div>

3. PRO TIP BOXES (4-6 throughout - modern gradient design):
<div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-left: 5px solid #3b82f6; padding: 24px 28px; margin: 32px 0; border-radius: 0 12px 12px 0; box-shadow: 0 2px 10px rgba(59, 130, 246, 0.1);">
  <strong style="color: #1e40af; font-size: 18px; display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">💡 Pro Tip</strong>
  <p style="color: #1f2937; font-size: 17px; margin: 0; line-height: 1.8;">Your actionable insider knowledge here.</p>
</div>

4. WARNING BOXES (when relevant - attention-grabbing design):
<div style="background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border-left: 5px solid #ef4444; padding: 24px 28px; margin: 32px 0; border-radius: 0 12px 12px 0; box-shadow: 0 2px 10px rgba(239, 68, 68, 0.1);">
  <strong style="color: #b91c1c; font-size: 18px; display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">⚠️ Warning</strong>
  <p style="color: #1f2937; font-size: 17px; margin: 0; line-height: 1.8;">Critical warning that saves them from a costly mistake.</p>
</div>

5. DATA COMPARISON TABLE (modern, clean design):
<div style="margin: 36px 0; overflow-x: auto; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.08);">
  <table style="width: 100%; border-collapse: collapse; background: white;">
    <thead>
      <tr style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);">
        <th style="padding: 18px 24px; text-align: left; color: #047857; font-weight: 800; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 3px solid #10b981;">Column 1</th>
        <th style="padding: 18px 24px; text-align: left; color: #047857; font-weight: 800; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 3px solid #10b981;">Column 2</th>
        <th style="padding: 18px 24px; text-align: left; color: #047857; font-weight: 800; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 3px solid #10b981;">Column 3</th>
      </tr>
    </thead>
    <tbody>
      <tr style="background: #ffffff;">
        <td style="padding: 16px 24px; color: #374151; font-size: 16px; border-bottom: 1px solid #e5e7eb;">Data</td>
        <td style="padding: 16px 24px; color: #374151; font-size: 16px; border-bottom: 1px solid #e5e7eb;">Data</td>
        <td style="padding: 16px 24px; color: #059669; font-size: 16px; border-bottom: 1px solid #e5e7eb; font-weight: 700;">Highlight ✓</td>
      </tr>
      <tr style="background: #f9fafb;">
        <td style="padding: 16px 24px; color: #374151; font-size: 16px; border-bottom: 1px solid #e5e7eb;">Data</td>
        <td style="padding: 16px 24px; color: #374151; font-size: 16px; border-bottom: 1px solid #e5e7eb;">Data</td>
        <td style="padding: 16px 24px; color: #374151; font-size: 16px; border-bottom: 1px solid #e5e7eb;">Data</td>
      </tr>
    </tbody>
  </table>
</div>

6. NUMBERED STEP BOXES (modern step-by-step design):
<div style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border: 2px solid #e2e8f0; border-radius: 16px; padding: 28px; margin: 32px 0; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
  <div style="display: flex; align-items: center; gap: 18px; margin-bottom: 16px;">
    <span style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; width: 44px; height: 44px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; font-size: 18px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">1</span>
    <strong style="color: #1f2937; font-size: 20px; font-weight: 800;">Step Title Here</strong>
  </div>
  <p style="color: #4b5563; margin: 0; padding-left: 62px; font-size: 17px; line-height: 1.8;">Step description with actionable details.</p>
</div>

7. EXPERT QUOTE BOXES (premium credibility design):
<blockquote style="background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%); border-left: 5px solid #10b981; padding: 28px 32px; margin: 36px 0; border-radius: 0 16px 16px 0; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.1); position: relative;">
  <p style="color: #1f2937; margin: 0; font-size: 19px; line-height: 1.8; font-style: italic;">"Powerful quote that reinforces your point and adds expert credibility..."</p>
  <footer style="color: #047857; margin-top: 16px; font-size: 15px; font-style: normal; font-weight: 700; display: flex; align-items: center; gap: 8px;">
    <span style="background: #10b981; width: 8px; height: 8px; border-radius: 50%; display: inline-block;"></span>
    Dr. Expert Name, PhD — Harvard Medical School
  </footer>
</blockquote>

8. STAT HIGHLIGHT BOX (eye-catching metric display):
<div style="background: linear-gradient(135deg, #f0fdf4 0%, #d1fae5 100%); border: 2px solid #10b981; border-radius: 16px; padding: 28px; margin: 36px 0; display: flex; align-items: center; gap: 24px; flex-wrap: wrap; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.15);">
  <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 16px; padding: 20px 28px; text-align: center; min-width: 120px; box-shadow: 0 6px 20px rgba(16, 185, 129, 0.3);">
    <span style="color: white; font-size: 38px; font-weight: 900; display: block; text-shadow: 0 2px 4px rgba(0,0,0,0.1);">87%</span>
    <span style="color: rgba(255,255,255,0.95); font-size: 13px; text-transform: uppercase; font-weight: 600; letter-spacing: 1px;">Metric</span>
  </div>
  <p style="color: #1f2937; margin: 0; font-size: 17px; line-height: 1.8; flex: 1; min-width: 220px;">Explanation of what this stat means and why it matters to the reader.</p>
</div>

9. FAQ SECTION (modern accordion-style design):
<div style="background: white; border: 2px solid #e5e7eb; border-radius: 16px; margin: 24px 0; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
  <h4 style="background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%); margin: 0; padding: 20px 28px; color: #1f2937; font-size: 18px; font-weight: 700; border-bottom: 2px solid #e5e7eb; display: flex; align-items: center; gap: 12px;">
    <span style="color: #10b981; font-size: 20px;">❓</span> Question here?
  </h4>
  <div style="padding: 24px 28px;">
    <p style="color: #4b5563; margin: 0; font-size: 17px; line-height: 1.8;">Direct, valuable answer without fluff. Give them exactly what they need.</p>
  </div>
</div>

10. CTA BOX (high-converting premium design):
<div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 20px; padding: 40px; margin: 48px 0; text-align: center; box-shadow: 0 8px 30px rgba(16, 185, 129, 0.35);">
  <h3 style="color: white; margin: 0 0 16px 0; font-size: 28px; font-weight: 900; text-shadow: 0 2px 4px rgba(0,0,0,0.1);">🚀 Ready to Take Action?</h3>
  <p style="color: rgba(255,255,255,0.95); margin: 0; font-size: 18px; line-height: 1.7; max-width: 600px; margin: 0 auto;">Strong call-to-action that tells them exactly what to do next. Make it impossible to ignore.</p>
</div>

11. EXPERIENCE/CASE STUDY BOX (E-E-A-T first-hand experience):
<div style="background: linear-gradient(135deg, #fefce8 0%, #fef9c3 100%); border: 2px solid #eab308; border-radius: 16px; padding: 28px 32px; margin: 36px 0; box-shadow: 0 4px 15px rgba(234, 179, 8, 0.15);">
  <h4 style="color: #854d0e; margin: 0 0 16px 0; font-size: 20px; font-weight: 800; display: flex; align-items: center; gap: 10px;">📋 My Personal Experience</h4>
  <p style="color: #1f2937; margin: 0; font-size: 17px; line-height: 1.8;">Share your first-hand experience, what you tested, results you achieved, and lessons learned. This builds E-E-A-T trust signals.</p>
</div>

12. RESEARCH/DATA BOX (E-E-A-T authority signal):
<div style="background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%); border: 2px solid #8b5cf6; border-radius: 16px; padding: 28px 32px; margin: 36px 0; box-shadow: 0 4px 15px rgba(139, 92, 246, 0.15);">
  <h4 style="color: #5b21b6; margin: 0 0 16px 0; font-size: 20px; font-weight: 800; display: flex; align-items: center; gap: 10px;">📊 Research Findings</h4>
  <p style="color: #1f2937; margin: 0; font-size: 17px; line-height: 1.8;">According to [Study Name, Year], researchers found that [specific finding with numbers]. This was based on [methodology/sample size].</p>
</div>

🎯 OUTPUT REQUIREMENTS - CRITICAL:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• PURE HTML ONLY - ABSOLUTELY NO MARKDOWN SYNTAX
• For headings: Use <h2> and <h3> tags ONLY - NEVER use ## or ### symbols
• For bold: Use <strong> tags ONLY - NEVER use **text** or __text__
• For italic: Use <em> tags ONLY - NEVER use *text* or _text_
• For lists: Use <ul>/<ol> and <li> tags ONLY - NEVER use - or * or 1. at start of lines
• For links: Use <a href="url"> tags ONLY - NEVER use [text](url) format
• For paragraphs: Wrap all text in <p> tags with proper styling
• Proper h2/h3 hierarchy throughout
• Every paragraph MUST deliver VALUE
• All text must be readable on light backgrounds (use dark text colors like #1f2937, #374151, #4b5563)

⚠️ IF YOU OUTPUT ANY MARKDOWN SYNTAX (##, ###, **, *, -, 1., [text](url)), THE CONTENT WILL BE REJECTED!`;

    const prompt = `Write a ${targetWordCount}+ word article about "${keyword}".

TITLE: ${title}

🎯 MANDATORY QUALITY TARGETS (MUST ACHIEVE 90%+ IN ALL):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• READABILITY 90%+: Short sentences (avg 15 words), simple vocabulary, Grade 6-7 level
• SEO 90%+: Primary keyword "${keyword}" used 8-12 times naturally, proper heading hierarchy
• E-E-A-T 90%+: Cite 5+ specific studies/stats with years, include expert quotes, first-hand experience
• UNIQUENESS 90%+: Zero AI phrases, unique analogies, contrarian perspectives
• ACCURACY 90%+: Only verifiable claims, 2025 data, cite specific sources

CONTENT STRUCTURE (follow this order):
${serpAnalysis.recommendedHeadings.map((h, i) => `${i + 1}. ${h}`).join('\n')}

CONTENT GAPS TO FILL (your competitors MISSED these - this is your competitive advantage):
${serpAnalysis.contentGaps.slice(0, 6).join('\n')}

SEMANTIC KEYWORDS TO NATURALLY WEAVE IN (don't force them):
${serpAnalysis.semanticEntities.slice(0, 18).join(', ')}

${neuronTermPrompt ? `
🔴 NEURONWRITER OPTIMIZATION - 90%+ CONTENT SCORE REQUIRED:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${neuronTermPrompt}

⚠️ STRICT NEURONWRITER RULES (CRITICAL FOR 90%+ SCORE):
1. Include EVERY "REQUIRED" term at EXACTLY the suggested frequency range
2. Include at least 80% of "RECOMMENDED" terms naturally throughout
3. Include at least 50% of "EXTENDED" terms for comprehensive coverage
4. MENTION every "NAMED ENTITY" at least once in relevant context
5. USE the "RECOMMENDED H2 HEADINGS" as your actual H2 headings (or very close variations)
6. USE the "RECOMMENDED H3 SUBHEADINGS" as your H3s where appropriate
7. Never dump terms as a list—they MUST flow naturally in sentences
8. Distribute terms evenly across sections (not clustered in one area)
` : ''}

${videos.length > 0 ? `
EMBED THIS VIDEO IN THE MIDDLE OF THE ARTICLE:
<div style="position: relative; padding-bottom: 56.25%; height: 0; margin: 40px 0; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.4);">
  <iframe src="https://www.youtube.com/embed/${videos[0].id}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen title="${videos[0].title}"></iframe>
</div>
<p style="text-align: center; color: #6b7280; font-size: 14px; margin-top: -24px; margin-bottom: 32px;">📺 <strong>${videos[0].title}</strong> by ${videos[0].channelTitle}</p>
` : ''}

📋 MANDATORY STRUCTURE REQUIREMENTS:
1. First 2 sentences MUST hook the reader - give them the answer or a bold claim immediately
2. Key Takeaways box IMMEDIATELY after the intro (5-7 bullets)
3. At least 5 Pro Tip boxes spread throughout (actionable, screenshot-worthy)
4. At least 2 data comparison tables with real data
5. At least 5 step boxes for actionable sections
6. At least 3 stat highlight boxes with real percentages/numbers
7. At least 2 expert quote boxes with real names and credentials
8. FAQ section with 8 questions at the end (optimized for featured snippets)
9. Strong CTA at the very end

📝 E-E-A-T REQUIREMENTS (MANDATORY FOR 90%+ - CRITICAL):
1. Include "According to [specific study/source, year]..." at least 8 times throughout
2. Include at least 4-5 expert quotes with REAL names: "Dr. [Full Name], [PhD/MD/credential] at [Institution], says..."
3. Include 2-3 "My Personal Experience" sections: "When I personally tested this for 6 months..." / "In my 12 years of..."
4. Reference 5+ specific tools/products by name that you've "used" with specific results
5. Include 8+ specific statistics with years: "[X]% of [audience] report that... (Source, 2025)"
6. Add 1-2 RESEARCH FINDINGS boxes using the template above
7. Add 1-2 EXPERIENCE boxes using the template above
8. Cite authoritative organizations: CDC, WHO, NIH, peer-reviewed journals, industry reports
9. Include specific methodologies: "Using the [Protocol Name] methodology..." / "Based on meta-analysis of [X] studies..."
10. Acknowledge limitations: "One caveat is..." / "This works best for..." - builds trust

🎯 HUMAN VOICE REQUIREMENTS (MANDATORY):
1. Use contractions: don't, won't, can't, it's, that's, we're, you'll
2. Start paragraphs with: "Look," "Here's the thing:" "Real talk:" "I'll be honest:"
3. Include rhetorical questions: "Sound familiar?" "See the pattern?"
4. Use incomplete sentences. For emphasis. Like this.
5. Show emotion: "This drives me crazy..." / "I love this because..."
6. Admit uncertainty: "I could be wrong, but..."

Write the complete article now. Make it so valuable that readers bookmark it and share it with friends. REMEMBER: Target 90%+ in ALL metrics!`;

    let result;
    if (this.config.useConsensus && !neuronTermPrompt && this.engine.getAvailableModels().length > 1) { // speed+determinism: disable consensus when NeuronWriter is active
      this.log('Using multi-model consensus generation...');
      const consensusResult = await this.engine.generateWithConsensus(prompt, systemPrompt);
      result = { content: consensusResult.finalContent };
    } else {
      const initialMaxTokens = targetWordCount >= 3000 ? 16384 : 8192;
      result = await this.engine.generateWithModel({
        prompt,
        model: this.config.primaryModel || 'gemini',
        apiKeys: this.config.apiKeys,
        systemPrompt,
        temperature: 0.78,
        maxTokens: initialMaxTokens
      });
    }

    // Ensure we don't publish partial ~250-word outputs.
    // Some models "stop early" and ask to continue; we automatically continue until we hit target length.
    let finalContent = await this.ensureLongFormComplete({
      keyword,
      title,
      systemPrompt,
      model: this.config.primaryModel || 'gemini',
      currentHtml: result.content,
      targetWordCount,
    });

    // Add videos section if available and not already embedded
    if (videos.length > 0 && !finalContent.includes('youtube.com/embed')) {
      const videoSection = this.buildVideoSection(videos);
      finalContent = this.insertBeforeConclusion(finalContent, videoSection);
      this.log('Injected YouTube video section');
    }

    // Add references section
    if (references.length > 0) {
      const referencesSection = this.referenceService.formatReferencesSection(references);
      finalContent += referencesSection;
      this.log(`Added ${references.length} references`);
    }

    return finalContent;
  }

  /**
   * Generate SEO-optimized title for WordPress/meta tags
   * This may differ from the display title - optimized for search rankings
   */
  private async generateSEOTitle(keyword: string, displayTitle: string, serpAnalysis: SERPAnalysis): Promise<string> {
    const prompt = `Generate an SEO-optimized title tag for an article about "${keyword}".

Current display title: "${displayTitle}"

Requirements:
- Maximum 60 characters (CRITICAL - longer titles get truncated in search results)
- Include the EXACT primary keyword "${keyword}" within first 40 characters
- Make it compelling and click-worthy (high CTR potential)
- Match ${serpAnalysis.userIntent} search intent
- Include current year (2025) if naturally fits
- Power words: Ultimate, Complete, Best, Top, Essential, Proven, Expert
- NO clickbait or sensationalism
- NO generic phrases like "A Complete Guide" at the end

Top competitor title formats for reference:
${serpAnalysis.topCompetitors.slice(0, 3).map(c => `- ${c.title}`).join('\n')}

Output ONLY the SEO title, nothing else.`;

    const result = await this.engine.generateWithModel({
      prompt,
      model: this.config.primaryModel || 'gemini',
      apiKeys: this.config.apiKeys,
      temperature: 0.7,
      maxTokens: 100
    });

    let seoTitle = result.content.trim().replace(/^["']|["']$/g, '');
    
    // Ensure it's not too long
    if (seoTitle.length > 60) {
      seoTitle = seoTitle.substring(0, 57) + '...';
    }
    
    return seoTitle;
  }

  private async generateMetaDescription(keyword: string, title: string): Promise<string> {
    const prompt = `Write an SEO meta description for an article titled "${title}" about "${keyword}".

Requirements:
- Exactly 150-160 characters (CRITICAL - this is the optimal length for SERP display)
- Include the EXACT primary keyword "${keyword}" within first 100 characters
- Include a clear call-to-action at the end
- Create urgency or curiosity
- Make it compelling and click-worthy
- NO fluff words: "In this article", "This guide covers", "Learn about"
- Start with action/benefit: "Discover...", "Get the...", "Master..."

Output ONLY the meta description, nothing else.`;

    const result = await this.engine.generateWithModel({
      prompt,
      model: this.config.primaryModel || 'gemini',
      apiKeys: this.config.apiKeys,
      temperature: 0.7,
      maxTokens: 100
    });

    let metaDesc = result.content.trim().replace(/^["']|["']$/g, '');
    
    // Ensure optimal length
    if (metaDesc.length > 160) {
      metaDesc = metaDesc.substring(0, 157) + '...';
    }
    
    return metaDesc;
  }

  private buildVideoSection(videos: YouTubeVideo[]): string {
    return `
<section class="video-resources" style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border-radius: 20px; padding: 32px; margin: 40px 0; border: 2px solid #10b981; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.15);">
  <h2 style="margin-top: 0; display: flex; align-items: center; gap: 12px; color: #1f2937; font-size: 24px; font-weight: 800;">
    Recommended Video Resources
  </h2>
  <p style="color: #4b5563; margin-bottom: 24px; font-size: 16px;">Learn more from these expert video guides:</p>
  ${videos.map(v => this.youtubeService.formatVideoCard(v)).join('')}
</section>
`;
  }

  private insertBeforeConclusion(content: string, section: string): string {
    const conclusionPatterns = [
      /<h2[^>]*>\s*(?:conclusion|final thoughts|wrapping up)/i,
      /<h2[^>]*>\s*(?:faq|frequently asked)/i
    ];

    for (const pattern of conclusionPatterns) {
      const match = content.match(pattern);
      if (match && match.index !== undefined) {
        return content.slice(0, match.index) + section + content.slice(match.index);
      }
    }

    return content + section;
  }

  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 60);
  }

  private buildEEATProfile(references: Reference[]): EEATProfile {
    return {
      author: {
        name: this.config.authorName,
        credentials: this.config.authorCredentials || [],
        publications: [],
        expertiseAreas: [],
        socialProfiles: []
      },
      citations: references.map(r => ({
        title: r.title,
        url: r.url,
        type: r.type
      })),
      expertReviews: [],
      methodology: 'AI-assisted research with human editorial oversight',
      lastUpdated: new Date(),
      factChecked: references.length > 3
    };
  }

  async generateContentPlan(broadTopic: string): Promise<ContentPlan> {
    this.log(`Generating content plan for: ${broadTopic}`);

    const prompt = `Create a comprehensive content cluster plan for the topic: "${broadTopic}"

Generate:
1. A pillar page keyword (main comprehensive topic)
2. 8-12 cluster article keywords that support the pillar

For each cluster, specify:
- Primary keyword (2-4 words)
- Suggested title
- Content type (how-to, guide, comparison, listicle, deep-dive)
- Priority (high, medium, low based on search volume potential)

Output as JSON:
{
  "pillarKeyword": "...",
  "pillarTitle": "...",
  "clusters": [
    {
      "keyword": "...",
      "title": "...",
      "type": "guide",
      "priority": "high"
    }
  ]
}

Output ONLY valid JSON.`;

    const result = await this.engine.generateWithModel({
      prompt,
      model: this.config.primaryModel || 'gemini',
      apiKeys: this.config.apiKeys,
      temperature: 0.7,
      maxTokens: 2000
    });

    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        pillarTopic: broadTopic,
        pillarKeyword: parsed.pillarKeyword,
        clusters: parsed.clusters.map((c: Record<string, unknown>) => ({
          keyword: c.keyword as string,
          title: c.title as string,
          type: (c.type as ContentPlan['clusters'][0]['type']) || 'guide',
          priority: (c.priority as ContentPlan['clusters'][0]['priority']) || 'medium'
        })),
        totalEstimatedWords: (parsed.clusters.length + 1) * 2500,
        estimatedTimeToComplete: `${Math.ceil((parsed.clusters.length + 1) * 15 / 60)} hours`
      };
    } catch (error) {
      this.log(`Error parsing content plan: ${error}`);
      return {
        pillarTopic: broadTopic,
        pillarKeyword: broadTopic,
        clusters: [
          { keyword: `${broadTopic} guide`, title: `Complete ${broadTopic} Guide`, type: 'guide', priority: 'high' },
          { keyword: `${broadTopic} tips`, title: `Top ${broadTopic} Tips`, type: 'listicle', priority: 'high' },
          { keyword: `how to ${broadTopic}`, title: `How to ${broadTopic}`, type: 'how-to', priority: 'medium' },
          { keyword: `${broadTopic} best practices`, title: `${broadTopic} Best Practices`, type: 'deep-dive', priority: 'medium' }
        ],
        totalEstimatedWords: 12500,
        estimatedTimeToComplete: '3 hours'
      };
    }
  }

  getCacheStats(): { size: number; hitRate: number } {
    return generationCache.getStats();
  }

  hasAvailableModels(): boolean {
    return this.engine.hasAvailableModel();
  }

  getAvailableModels(): AIModel[] {
    return this.engine.getAvailableModels();
  }


// ===================== SOTA Self-Critique (Fast, Single Pass) =====================
private async selfCritiqueAndPatch(params: {
  keyword: string;
  title: string;
  html: string;
  requiredTerms?: string[];
  requiredEntities?: string[];
  requiredHeadings?: string[];
}): Promise<string> {
  const requiredTerms = params.requiredTerms || [];
  const requiredEntities = params.requiredEntities || [];
  const requiredHeadings = params.requiredHeadings || [];

  const missingTerms = requiredTerms.filter(t => !new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`, 'i').test(params.html));
  const missingEntities = requiredEntities.filter(e => !new RegExp(`\\b${e.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`, 'i').test(params.html));
  const missingHeadings = requiredHeadings.filter(h => !params.html.toLowerCase().includes(h.toLowerCase().slice(0, 24)));

  // Nothing missing -> still do micro-polish for clarity
  const instruction = [
    "Rewrite ONLY where needed. Keep structure. Output HTML only.",
    "Voice: Alex Hormozi + Tim Ferriss. No fluff. Short paragraphs.",
    "Add concrete steps, checklists, examples. Remove vague filler.",
    missingTerms.length ? `Add these missing NeuronWriter terms naturally: ${missingTerms.slice(0, 40).join(', ')}` : "",
    missingEntities.length ? `Include these entities naturally: ${missingEntities.slice(0, 40).join(', ')}` : "",
    missingHeadings.length ? `Add these missing H2 sections if absent: ${missingHeadings.slice(0, 6).join(' | ')}` : "",
  ].filter(Boolean).join("\n");

  // Keep it fast: single model call, moderate maxTokens
  const contentLength = params.html.length;
  const neededTokens = contentLength > 20000 ? 16384 : 8192;
  const res = await this.engine.generateWithModel({
    prompt: `ARTICLE TITLE: ${params.title}\nPRIMARY KEYWORD: ${params.keyword}\n\nCURRENT HTML (EDIT THIS):\n${params.html}\n\nINSTRUCTIONS:\n${instruction}`,
    model: this.config.primaryModel || 'gemini',
    apiKeys: this.config.apiKeys,
    systemPrompt: "Elite editor. Output PURE HTML ONLY. Do not add markdown.",
    temperature: 0.55,
    maxTokens: neededTokens
  });

  return res.content || params.html;
}


private enforceNeuronwriterCoverage(html: string, req: { requiredTerms: string[]; entities: string[]; h2: string[] }): string {
  const required = (req?.requiredTerms || []).map(t => String(t || "").trim()).filter(Boolean);
  const entities = (req?.entities || []).map(t => String(t || "").trim()).filter(Boolean);

  const missing: string[] = [];
  const hay = (html || "").toLowerCase();

  for (const t of required) if (!hay.includes(t.toLowerCase())) missing.push(t);
  for (const e of entities) if (!hay.includes(e.toLowerCase())) missing.push(e);

  if (missing.length === 0) return html;

  const chunk = missing.slice(0, 40);
  const bullets = chunk.map(t => `<li><strong>${this.escapeHtml(t)}</strong>: included as a core concept/term for completeness.</li>`).join("");

  const block = `<h2>Key Takeaways</h2><ul>${bullets}</ul>`;

  if (/<h2[^>]*>\s*key takeaways\s*<\/h2>/i.test(html || "")) {
    const line = `<p><strong>Coverage note:</strong> ${chunk.map(this.escapeHtml).join(", ")}.</p>`;
    return `${html}\n\n${line}`;
  }

  return `${html}\n\n${block}`;
}
private extractNeuronRequirements(neuron: NeuronWriterAnalysis | null): {
  requiredTerms: string[];
  entities: string[];
  h2: string[];
} {
  if (!neuron) return { requiredTerms: [], entities: [], h2: [] };
  const terms = [...(neuron.terms || []), ...(neuron.termsExtended || [])];
  const requiredTerms = terms
    .filter(t => (t.type === 'required' || t.type === 'recommended') && t.term && t.term.length > 1)
    .map(t => t.term)
    .slice(0, 120);

  const entities = (neuron.entities || []).map(e => e.entity).filter(Boolean).slice(0, 80);
  const h2 = (neuron.headingsH2 || []).map(h => h.text).filter(Boolean).slice(0, 20);
  return { requiredTerms, entities, h2 };
}


// ===================== References (E-E-A-T) =====================
private ensureReferencesSection(html: string, refs: Reference[], serp: SERPAnalysis): string {
  const hasRefsHeading = /<h2[^>]*>\s*(references|sources)\s*<\/h2>/i.test(html) || /References\s*<\/h2>/i.test(html);
  if (hasRefsHeading) return html;

  const items: { title: string; url: string }[] = [];
  for (const r of refs || []) {
    if (r?.title && r?.url) items.push({ title: r.title, url: r.url });
  }
  // Fallback: competitor URLs from SERP if reference picker returned none
  for (const c of serp?.topCompetitors || []) {
    if (c?.title && c?.url) items.push({ title: c.title, url: c.url });
  }

  const dedup = new Map<string, { title: string; url: string }>();
  for (const it of items) {
    const key = (it.url || '').toLowerCase().trim();
    if (!key) continue;
    if (!dedup.has(key)) dedup.set(key, it);
  }

  const finalItems = Array.from(dedup.values()).slice(0, 10);
  if (finalItems.length === 0) return html;

  const block =
    `<h2>References</h2>` +
    `<ol>` +
    finalItems
      .map((it) => `<li><a href="${it.url}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(it.title)}</a></li>`)
      .join('') +
    `</ol>`;

  return `${html}\n\n${block}`;
}

private escapeHtml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
}

export function createOrchestrator(config: OrchestratorConfig): EnterpriseContentOrchestrator {
  return new EnterpriseContentOrchestrator(config);
}
