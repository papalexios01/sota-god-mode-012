// src/lib/sota/EnterpriseContentOrchestrator.ts
// ═══════════════════════════════════════════════════════════════════════════════
// ENTERPRISE CONTENT ORCHESTRATOR v5.2
// ═══════════════════════════════════════════════════════════════════════════════
//
// v5.2 Fixes (on top of v5.1):
//   • FIXED: generateContent() validates options.keyword at the top — throws
//     a clear error instead of cascading TypeErrors deep in the pipeline
//   • FIXED: Content-level cache key uses simpleHash() for collision resistance
//   • FIXED: generateTitle() null-guards keyword before .split()
//   • FIXED: generateSlug() null-guards title before .toLowerCase()
//
// v5.1 Fixes:
//   • FIXED: maybeInitNeuronWriter — slug keyword cleaned before all NW calls
//   • FIXED: findQueryByKeyword threshold lowered — any data is accepted
//   • FIXED: If query found but analysis pending, reuse its ID and poll (no duplicates)
//   • FIXED: NeuronWriter retry logic — retry once on init failure before giving up
//   • FIXED: cleanKeywordForNeuronWriter() helper centralises slug→natural conversion
//   • IMPROVED: All NW diagnostic messages surface keyword transform for debugging
//
// ═══════════════════════════════════════════════════════════════════════════════

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
  ContentPlan,
  PostProcessingResult,
} from './types';
import {
  SOTAContentGenerationEngine,
  createSOTAEngine,
  type ExtendedAPIKeys,
} from './SOTAContentGenerationEngine';
import { SERPAnalyzer, createSERPAnalyzer } from './SERPAnalyzer';
import { YouTubeService, createYouTubeService } from './YouTubeService';
import { ReferenceService, createReferenceService } from './ReferenceService';
import { SOTAInternalLinkEngine, createInternalLinkEngine } from './SOTAInternalLinkEngine';
import { SchemaGenerator, createSchemaGenerator } from './SchemaGenerator';
import {
  calculateQualityScore,
  analyzeContent,
  removeAIPhrases,
  polishReadability,
  validateVisualBreaks,
} from './QualityValidator';
import { EEATValidator, createEEATValidator } from './EEATValidator';
import { generationCache } from './cache';
import {
  NeuronWriterService,
  createNeuronWriterService,
  type NeuronWriterAnalysis,
} from './NeuronWriterService';
import ContentPostProcessor, { removeAIPatterns } from './ContentPostProcessor';
import {
  buildMasterSystemPrompt,
  buildMasterUserPrompt,
  buildContinuationPrompt,
  buildSelfCritiquePrompt,
  type ContentPromptConfig,
} from './prompts/masterContentPrompt';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const NW_MAX_IMPROVEMENT_ATTEMPTS = 3;
const NW_TARGET_SCORE = 90;
const NW_MAX_STAGNANT_ROUNDS = 2;
const NW_MAX_POLL_ATTEMPTS = 40;
const MIN_IMPROVED_LENGTH_RATIO = 0.97;
const MAX_CONSECUTIVE_P_WORDS = 200;
const MIN_INTERNAL_LINKS = 6;
const TARGET_INTERNAL_LINKS = 12;
const MIN_VALID_CONTENT_LENGTH = 100;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

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
  authorCredentials?: string;
  sitePages?: { url: string; title: string; keywords?: string }[];
  targetCountry?: string;
  useConsensus?: boolean;
  primaryModel?: AIModel;
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
  neuronWriterQueryId?: string;
  onProgress?: (message: string) => void;
}

interface OrchestratorTelemetry {
  phaseTimings: Record<string, number>;
  totalTokensUsed: number;
  neuronWriterAttempts: number;
  neuronWriterFinalScore: number;
  continuationRounds: number;
  internalLinksInjected: number;
  visualBreakViolationsFixed: number;
  selfCritiqueApplied: boolean;
  warnings: string[];
  errors: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ✅ FIX #8: Deterministic hash for content-level cache keys
//
// Same helper used in SOTAContentGenerationEngine.ts — prevents cache
// collisions when keywords or titles share common prefixes.
// ─────────────────────────────────────────────────────────────────────────────

function simpleHash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKDOWN → HTML
// ─────────────────────────────────────────────────────────────────────────────

function convertMarkdownToHTML(content: string): string {
  let html = content;
  html = html.replace(/^####\s+(.+)$/gm, '<h4 style="color:#334155;font-size:19px;font-weight:700;margin:32px 0 12px 0;line-height:1.3">$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3 style="color:#1e293b;font-size:23px;font-weight:800;margin:40px 0 16px 0;letter-spacing:-0.02em;line-height:1.3">$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2 style="color:#0f172a;font-size:30px;font-weight:900;margin:56px 0 24px 0;padding-bottom:14px;border-bottom:4px solid #10b981;letter-spacing:-0.025em;line-height:1.2">$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#059669;text-decoration:underline;text-underline-offset:3px;font-weight:600">$1</a>');
  html = html.replace(/^- (.+)$/gm, '<li style="margin-bottom:8px;line-height:1.8">$1</li>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li data-list-type="ol" style="margin-bottom:8px;line-height:1.8">$1</li>');
  html = html.replace(/(<li[^>]*>.*<\/li>\n?)+/g, (match) => {
    const isOrdered = match.includes('data-list-type="ol"');
    const tag = isOrdered ? 'ol' : 'ul';
    const cleaned = match.replace(/data-list-type="ol"/g, '');
    return `<${tag} style="margin:20px 0;padding-left:24px;color:#374151">${cleaned}</${tag}>`;
  });
  html = html.replace(/```[\s\S]+?```/gs, (match) => {
    const code = match.replace(/```\w*\n?/, '').replace(/```$/, '');
    return `<pre style="background:#f3f4f6;padding:16px;border-radius:8px;overflow-x:auto;margin:20px 0"><code style="color:#374141;font-size:14px">${code}</code></pre>`;
  });
  html = html.replace(/`(.+?)`/g, '<code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:14px">$1</code>');
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote style="border-left:4px solid #10b981;padding-left:20px;margin:20px 0;color:#4b5563;font-style:italic">$1</blockquote>');
  html = html.replace(/^---+$/gm, '<hr style="border:0;border-top:2px solid #e5e7eb;margin:32px 0">');

  const lines = html.split('\n');
  const processedLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('<') || line.startsWith('&')) {
      processedLines.push(lines[i]);
    } else {
      processedLines.push(
        `<p style="color:#334155;font-size:18px;line-height:1.8;margin:0 0 20px 0">${line}</p>`
      );
    }
  }
  html = processedLines.join('\n');
  html = html.replace(/<(h[1-6])([^>]*)>(.*?)<\/\1>/gi, (_, tag, attrs, content) =>
    `<${tag}${attrs}>${content.replace(/#{1,6}\s*/g, '')}</${tag}>`
  );
  const finalLines = html.split('\n').map((line) => {
    if (!line.trim().startsWith('<')) return line.replace(/#{1,6}\s*/g, '');
    return line;
  });
  html = finalLines.join('\n');
  return html;
}

function ensureProperHTMLStructure(content: string): string {
  let html = content;
  html = html.replace(/<p><p>/g, '<p>');
  html = html.replace(/<\/p><\/p>/g, '</p>');
  html = html.replace(/<\/div>(\s*)<h2/g, '</div>\n<h2');
  html = html.replace(/<\/p>(\s*)<h2/g, '</p>\n<h2');
  html = html.replace(/<\/div>(\s*)<h3/g, '</div>\n<h3');
  html = html.replace(/<\/p>(\s*)<h3/g, '</p>\n<h3');
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<h2>(<h2[^>]*>)/g, '$1');
  html = html.replace(/<h3>(<h3[^>]*>)/g, '$1');
  html = html.replace(/<h2(?![^>]*style)([^>]*)>/g, '<h2 style="color:#0f172a;font-size:30px;font-weight:900;margin:56px 0 24px 0;padding-bottom:14px;border-bottom:4px solid #10b981;letter-spacing:-0.025em;line-height:1.2"$1>');
  html = html.replace(/<h3(?![^>]*style)([^>]*)>/g, '<h3 style="color:#1e293b;font-size:23px;font-weight:800;margin:40px 0 16px 0;letter-spacing:-0.02em;line-height:1.3"$1>');
  html = html.replace(/<h4(?![^>]*style)([^>]*)>/g, '<h4 style="color:#334155;font-size:19px;font-weight:700;margin:32px 0 12px 0;line-height:1.3"$1>');

  if (!html.includes('data-premium-wp') && !html.includes('data-sota-content')) {
    const wrapperStart =
      '<div data-sota-content="true" style="font-family:Inter,ui-sans-serif,system-ui,-apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;line-height:1.75;color:#1e293b;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale">';
    const wrapperEnd = '</div>';
    html = wrapperStart + html + wrapperEnd;
  }

  html = html
    .replace(/<p(?![^>]*style)([^>]*)>/g, '<p style="font-size:18px;margin:0 0 20px 0;line-height:1.8;color:#334155"$1>')
    .replace(/<ul(?![^>]*style)([^>]*)>/g, '<ul style="margin:0 0 24px 0;padding-left:24px;list-style:none"$1>')
    .replace(/<ol(?![^>]*style)([^>]*)>/g, '<ol style="margin:0 0 24px 0;padding-left:24px;counter-reset:item"$1>')
    .replace(/<li(?![^>]*style)([^>]*)>/g, '<li style="margin:0 0 12px 0;padding-left:8px;line-height:1.75;position:relative"$1>');

  return html;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR CLASS
// ─────────────────────────────────────────────────────────────────────────────

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
  private telemetry: OrchestratorTelemetry;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.telemetry = this.createFreshTelemetry();
    this.engine = createSOTAEngine(config.apiKeys, (msg) => this.log(msg));
    this.serpAnalyzer = createSERPAnalyzer(config.apiKeys.serperApiKey);
    this.youtubeService = createYouTubeService(config.apiKeys.serperApiKey);
    this.referenceService = createReferenceService(config.apiKeys.serperApiKey);
    this.linkEngine = createInternalLinkEngine(config.sitePages);
    this.eeatValidator = createEEATValidator();
    this.schemaGenerator = createSchemaGenerator(
      config.organizationName,
      config.organizationUrl,
      config.logoUrl
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UTILITY METHODS
  // ─────────────────────────────────────────────────────────────────────────

  private createFreshTelemetry(): OrchestratorTelemetry {
    return {
      phaseTimings: {},
      totalTokensUsed: 0,
      neuronWriterAttempts: 0,
      neuronWriterFinalScore: 0,
      continuationRounds: 0,
      internalLinksInjected: 0,
      visualBreakViolationsFixed: 0,
      selfCritiqueApplied: false,
      warnings: [],
      errors: [],
    };
  }

  private log(message: string): void {
    this.onProgress?.(message);
    console.log(`[Orchestrator] ${message}`);
  }

  private warn(message: string): void {
    this.telemetry.warnings.push(message);
    this.log(message);
  }

  private logError(message: string): void {
    this.telemetry.errors.push(message);
    this.log(message);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private startPhaseTimer(phase: string): () => number {
    const start = Date.now();
    return () => {
      const elapsed = Date.now() - start;
      this.telemetry.phaseTimings[phase] = elapsed;
      return elapsed;
    };
  }

  private stripModelContinuationArtifacts(html: string): string {
    if (!html) return '';
    return html
      .replace(/content continues?\.?\s*$/gi, '')
      .replace(/would you like me to continue\??\s*$/gi, '')
      .replace(/\[\.{3}\]{3,}/g, '')
      .trim();
  }

  private countWordsFromHtml(html: string): number {
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return 0;
    return text.split(' ').filter(Boolean).length;
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ✅ FIX #10: Null-guard title before calling .toLowerCase()
  private generateSlug(title: string): string {
    if (!title || typeof title !== 'string') return 'untitled-content';
    return title
      .toLowerCase()
      .replace(/[^a-z0-9-\s]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 60);
  }

  private insertBeforeConclusion(content: string, section: string): string {
    const conclusionPatterns = [
      /<h2[^>]*>\s*(?:conclusion|final thoughts?|wrapping up)/i,
      /<h2[^>]*>\s*(?:faq|frequently asked)/i,
    ];
    for (const pattern of conclusionPatterns) {
      const match = content.match(pattern);
      if (match && match.index !== undefined) {
        return content.slice(0, match.index) + section + content.slice(match.index);
      }
    }
    return content + section;
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return '';
    }
  }

  private isLowQualityDomain(domain: string): boolean {
    const lowQuality = [
      'pinterest.com', 'quora.com', 'reddit.com', 'facebook.com',
      'twitter.com', 'x.com', 'linkedin.com', 'instagram.com',
      'youtube.com', 'tiktok.com', 'medium.com',
    ];
    return lowQuality.some((d) => domain.includes(d));
  }

  private hasMarkdownArtifacts(content: string): boolean {
    return /#{1,4}\s/m.test(content) || /\*\*/.test(content) || /\?\?/.test(content);
  }

  private countExistingLinks(html: string): number {
    const matches = html.match(/<a\s+href/gi);
    return matches?.length ?? 0;
  }

  private mapContentType(
    type?: string
  ): ContentPromptConfig['contentType'] {
    const map: Record<string, ContentPromptConfig['contentType']> = {
      guide: 'pillar',
      'deep-dive': 'pillar',
      'how-to': 'single',
      comparison: 'single',
      listicle: 'cluster',
    };
    return map[type ?? ''] ?? 'single';
  }

  private buildPromptConfig(
    keyword: string,
    title: string,
    options: GenerationOptions,
    serpAnalysis: SERPAnalysis,
    targetWordCount: number,
    neuronTermPrompt?: string,
    videos?: YouTubeVideo[]
  ): ContentPromptConfig {
    return {
      primaryKeyword: keyword,
      secondaryKeywords: serpAnalysis.semanticEntities.slice(0, 10),
      title,
      contentType: this.mapContentType(options.contentType),
      targetWordCount,
      neuronWriterSection: neuronTermPrompt,
      internalLinks: this.config.sitePages?.slice(0, 12).map((p) => ({
        anchor: p.title,
        url: p.url,
      })),
      serpData: {
        competitorTitles: serpAnalysis.topCompetitors.map((c) => c.title),
        peopleAlsoAsk: serpAnalysis.contentGaps.slice(0, 8),
        avgWordCount: serpAnalysis.avgWordCount,
      },
      youtubeEmbed:
        videos && videos.length > 0
          ? { videoId: videos[0].id, title: videos[0].title }
          : undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // KEYWORD CLEANING — slug → human-readable for NeuronWriter
  // ─────────────────────────────────────────────────────────────────────────

  private cleanKeywordForNeuronWriter(raw: string): string {
    return NeuronWriterService.cleanKeyword(raw);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LONG-FORM CONTINUATION ENGINE v5.0
  // ─────────────────────────────────────────────────────────────────────────

  private async ensureLongFormComplete(params: {
    keyword: string;
    title: string;
    promptConfig: ContentPromptConfig;
    model: AIModel;
    currentHtml: string;
    targetWordCount: number;
  }): Promise<string> {
    const { keyword, title, promptConfig, model, targetWordCount } = params;
    const systemPrompt = buildMasterSystemPrompt();

    let html = this.stripModelContinuationArtifacts(params.currentHtml);
    let words = this.countWordsFromHtml(html);

    const minAbsoluteWords = Math.max(2000, targetWordCount);
    const minRatio = targetWordCount > 3000 ? 0.92 : 0.85;
    const minTargetWords = Math.floor(minAbsoluteWords * minRatio);

    this.log(`Initial content: ${words} words, target: ${minAbsoluteWords}, min acceptable: ${minTargetWords}`);

    const looksIncomplete = (s: string) =>
      /content continues?|continue\?|would you like me to continue/i.test(s);

    const maxContinuations = targetWordCount > 5000 ? 8 : targetWordCount > 3000 ? 5 : 3;

    for (let i = 1; i <= maxContinuations; i++) {
      const tooShort = words < minTargetWords;
      const explicitlyIncomplete = looksIncomplete(html);

      if (!tooShort && !explicitlyIncomplete) {
        this.log(`Content meets target: ${words}/${minTargetWords} (${Math.round((words / minTargetWords) * 100)}%)`);
        break;
      }

      const percentComplete = Math.round((words / minTargetWords) * 100);
      const remainingWords = minAbsoluteWords - words;
      this.log(`Content short: ${words}/${minTargetWords} (${percentComplete}%). Need ${remainingWords} more. Continuing... ${i}/${maxContinuations}`);
      this.telemetry.continuationRounds++;

      const continuationPrompt = buildContinuationPrompt(promptConfig, html, words);

      try {
        const next = await this.engine.generateWithModel({
          prompt: continuationPrompt,
          model,
          apiKeys: this.config.apiKeys,
          systemPrompt,
          temperature: 0.72,
          maxTokens: 8192,
        });

        const nextChunk = this.stripModelContinuationArtifacts(next.content);
        if (!nextChunk || nextChunk.length < 100) {
          this.log('Continuation returned empty/minimal content, stopping.');
          break;
        }

        // Deduplication check
        const dedupeWindow = html.slice(-600);
        const chunkStart = nextChunk.slice(0, 600);
        if (dedupeWindow && chunkStart && dedupeWindow.includes(chunkStart)) {
          this.log('Continuation looks repetitive, stopping to avoid duplication.');
          break;
        }

        html = html + nextChunk.trim();
        const newWords = this.countWordsFromHtml(html);
        this.log(`Added ${newWords - words} words. Total: ${newWords}`);
        words = newWords;
      } catch (contError) {
        this.warn(`Continuation ${i} failed: ${contError}`);
        break;
      }
    }

    if (words < minTargetWords) {
      this.warn(`Final content is ${words} words (${Math.round((words / minTargetWords) * 100)}%), below target of ${minTargetWords}.`);
    } else {
      this.log(`Long-form content complete: ${words} words`);
    }

    return html;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NEURONWRITER INIT & POLLING  — v5.1 FIXED
  // ─────────────────────────────────────────────────────────────────────────

  private async maybeInitNeuronWriter(
    keyword: string,
    options: GenerationOptions
  ): Promise<NeuronBundle | null> {
    const apiKey = this.config.neuronWriterApiKey?.trim();
    const projectId = this.config.neuronWriterProjectId?.trim();

    if (!apiKey || !projectId) {
      this.log(
        'NeuronWriter SKIPPED — ' +
          (!apiKey ? 'API key MISSING' : 'Project ID MISSING')
      );
      return null;
    }

    const service = createNeuronWriterService(apiKey);
    const nwKeyword = NeuronWriterService.cleanKeyword(keyword);
    this.log('NeuronWriter: keyword="' + nwKeyword + '" (raw: "' + keyword + '")');

    let queryId = options.neuronWriterQueryId?.trim() || '';

    // ── Step 1: Search ALL statuses ──────────────────────────────────────────
    if (!queryId) {
      try {
        const searchResult = await service.findQueryByKeyword(projectId, nwKeyword);
        if (searchResult.success && searchResult.query?.id) {
          queryId = searchResult.query.id;
          this.log(
            'NeuronWriter: Found existing query ID=' + queryId +
              ' status=' + (searchResult.query.status || 'unknown')
          );
        }
      } catch (e) {
        this.warn('NeuronWriter: findQueryByKeyword threw (non-fatal): ' + e);
      }
    }

    // ── Step 2: Create ONLY if truly not found ───────────────────────────────
    if (!queryId) {
      this.log('NeuronWriter: No existing query — creating new for "' + nwKeyword + '"');
      try {
        const created = await service.createQuery(projectId, nwKeyword);
        if (created.success && created.queryId) {
          queryId = created.queryId;
          this.log('NeuronWriter: Created new query ID=' + queryId);
        } else {
          this.warn('NeuronWriter: createQuery failed: ' + (created.error ?? 'unknown'));
          return null;
        }
      } catch (e) {
        this.warn('NeuronWriter: createQuery threw (non-fatal): ' + e);
        return null;
      }
    }

    // ── Step 3: Poll until ready — ALL errors are non-fatal ──────────────────
    this.log('NeuronWriter: Polling for analysis readiness...');
    for (let attempt = 1; attempt <= NW_MAX_POLL_ATTEMPTS; attempt++) {
      try {
        const res = await service.getQueryAnalysis(queryId);

        if (res.success && res.analysis) {
          const hasData =
            (res.analysis.terms?.length ?? 0) > 0 ||
            (res.analysis.headingsH2?.length ?? 0) > 0;

          if (hasData) {
            this.log(
              'NeuronWriter: READY — ' + service.getAnalysisSummary(res.analysis)
            );
            return { service, queryId, analysis: res.analysis };
          }

          // Analysis returned but empty — still wait
          this.log(
            'NeuronWriter: Analysis returned but empty, still waiting... attempt ' +
              attempt + '/' + NW_MAX_POLL_ATTEMPTS
          );
        } else {
          this.log(
            'NeuronWriter: Not ready yet (' +
              (res.error ?? 'no data') + ') — attempt ' +
              attempt + '/' + NW_MAX_POLL_ATTEMPTS
          );
        }
      } catch (pollErr) {
        // Never crash the whole generation over a polling error
        this.warn(
          'NeuronWriter: Poll attempt ' + attempt + ' threw (non-fatal): ' + pollErr
        );
      }

      const delayMs =
        attempt <= 3 ? 2000 :
        attempt <= 10 ? 4000 :
        attempt <= 20 ? 6000 : 8000;

      await this.sleep(delayMs);
    }

    this.warn(
      'NeuronWriter: Analysis timed out after ' + NW_MAX_POLL_ATTEMPTS +
        ' attempts — proceeding WITHOUT NeuronWriter'
    );
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NEURONWRITER IMPROVEMENT LOOP
  // ─────────────────────────────────────────────────────────────────────────

  private async runNeuronWriterImprovementLoop(
    neuron: NeuronBundle,
    currentContent: string,
    keyword: string,
    title: string
  ): Promise<{ content: string; score: number }> {
    let content = currentContent;
    let currentScore = 0;
    let previousScore = 0;
    let stagnantRounds = 0;

    const allTermsForSuggestions = [
      ...(neuron.analysis.terms ?? []),
      ...(neuron.analysis.termsExtended ?? []),
    ];

    const entityTerms = (neuron.analysis.entities ?? []).map((e) => ({
      term: e.entity,
      weight: (e.usage_pc ?? 0) > 30 ? e.usage_pc! : 30,
      frequency: 1,
      type: 'recommended' as const,
      usage_pc: e.usage_pc,
    }));

    for (let attempt = 0; attempt < NW_MAX_IMPROVEMENT_ATTEMPTS; attempt++) {
      this.telemetry.neuronWriterAttempts++;

      try {
        const evalRes = await neuron.service.evaluateContent(neuron.queryId, {
          html: content,
          title,
        });

        if (!evalRes.success || typeof evalRes.contentScore !== 'number') {
          currentScore =
            neuron.analysis.content_score ??
            neuron.service.calculateContentScore(content, neuron.analysis.terms ?? []);
          if (!evalRes.success) {
            this.warn(`NeuronWriter: evaluate failed, using local score. ${evalRes.error}`);
            return { content, score: currentScore };
          }
        } else {
          currentScore = evalRes.contentScore ?? neuron.analysis.content_score ?? 0;
        }

        this.telemetry.neuronWriterFinalScore = currentScore;

        if (currentScore >= NW_TARGET_SCORE) {
          this.log(`NeuronWriter: Score ${currentScore} ≥ target ${NW_TARGET_SCORE} ✅ PASSED`);
          return { content, score: currentScore };
        }

        if (attempt >= NW_MAX_IMPROVEMENT_ATTEMPTS - 1) {
          this.log(`NeuronWriter: Score ${currentScore} after ${attempt + 1} attempts, target was ${NW_TARGET_SCORE}`);
          return { content, score: currentScore };
        }

        if (currentScore <= previousScore && attempt > 0) {
          stagnantRounds++;
          if (stagnantRounds >= NW_MAX_STAGNANT_ROUNDS) {
            this.log(`NeuronWriter: Score stagnant at ${currentScore} for ${stagnantRounds} rounds. Stopping.`);
            return { content, score: currentScore };
          }
        } else {
          stagnantRounds = 0;
        }

        previousScore = currentScore;
        const gap = NW_TARGET_SCORE - currentScore;
        this.log(`NeuronWriter: Score ${currentScore}, need ${gap} more — improving... attempt ${attempt + 1}/${NW_MAX_IMPROVEMENT_ATTEMPTS}`);

        const suggestions = neuron.service.getOptimizationSuggestions(content, allTermsForSuggestions);
        const entitySuggestions = neuron.service.getOptimizationSuggestions(content, entityTerms);
        const allSuggestions = [...suggestions, ...entitySuggestions.slice(0, 10)];

        const missingHeadings = (neuron.analysis.headingsH2 ?? [])
          .filter((h) => !content.toLowerCase().includes(h.text.toLowerCase().slice(0, 20)))
          .slice(0, 3);

        if (allSuggestions.length > 0 || missingHeadings.length > 0) {
          this.log(`Missing: ${allSuggestions.length} terms, ${missingHeadings.length} headings`);
          content = await this.applyNeuronWriterImprovement(
            content,
            keyword,
            title,
            allSuggestions.map((t) => ({ term: t, weight: 50 })),
            missingHeadings,
            attempt
          );
        } else {
          this.log('No missing terms found — attempting semantic enrichment...');
          content = await this.applySemanticEnrichment(
            content,
            keyword,
            currentScore,
            allTermsForSuggestions
          );
        }
      } catch (attemptErr) {
        this.warn(`NeuronWriter: improvement attempt ${attempt} failed: ${attemptErr}`);
        return { content, score: currentScore };
      }
    }

    return { content, score: currentScore };
  }

  private async applyNeuronWriterImprovement(
    content: string,
    keyword: string,
    title: string,
    suggestions: Array<{ term: string; weight?: number }>,
    missingHeadings: Array<{ text: string; usage_pc?: number }>,
    attempt: number
  ): Promise<string> {
    const usePatchMode = content.length > 10000;

    if (usePatchMode) {
      const termsPerAttempt = Math.min(30, suggestions.length);
      const termsList = suggestions.slice(0, termsPerAttempt);
      const patchPrompt = `Generate 3-6 NEW enrichment paragraphs for an article about "${keyword}".
These paragraphs must NATURALLY incorporate these missing SEO terms:
${termsList.map((t, i) => `${i + 1}. ${t.term}`).join('\n')}
${missingHeadings.length > 0 ? `Create sections for these missing H2 headings:\n${missingHeadings.map((h) => `- ${h.text}`).join('\n')}` : ''}

Rules:
- Output PURE HTML ONLY
- Each paragraph 50-100 words, wrapped in <p> tags
- Use varied contexts: tips, examples, data points, comparisons
- Include Pro Tip or Warning boxes where appropriate
- Terms must flow naturally in sentences, NEVER listed
- DO NOT repeat existing content
- CRITICAL: Never write more than ${MAX_CONSECUTIVE_P_WORDS} words of <p> text without a visual break

Output ONLY the new HTML content to INSERT.`;

      try {
        const patchResult = await this.engine.generateWithModel({
          prompt: patchPrompt,
          model: this.config.primaryModel ?? 'gemini',
          apiKeys: this.config.apiKeys,
          systemPrompt: 'Generate SEO enrichment HTML. Output PURE HTML ONLY.',
          temperature: 0.6 + attempt * 0.05,
          maxTokens: 4096,
        });

        if (patchResult.content && patchResult.content.trim().length > 100) {
          const patched = this.insertBeforeConclusion(content, patchResult.content.trim());
          this.log(`NeuronWriter PATCH: Inserted enrichment content with ${termsList.length} terms`);
          return patched;
        }
      } catch (patchErr) {
        this.warn(`NeuronWriter PATCH failed: ${patchErr}`);
      }
    } else {
      const termsPerAttempt = Math.min(40, suggestions.length);
      const termsList = suggestions.slice(0, termsPerAttempt);
      const headingsInstruction =
        missingHeadings.length > 0
          ? `H2 HEADINGS — add these as new sections:\n${missingHeadings.map((h) => `- ${h.text} (used by ${h.usage_pc ?? 50}% of competitors)`).join('\n')}`
          : '';

      const improvementPrompt = `You are optimizing this article for a NeuronWriter content score of ${NW_TARGET_SCORE}.
Current score: ${this.telemetry.neuronWriterFinalScore}.

PRIORITY MISSING TERMS — MUST include each one naturally, at least 1-2 times:
${termsList.map((t, i) => `${i + 1}. ${t.term}`).join('\n')}

${headingsInstruction}

STRICT RULES:
1. Preserve ALL existing HTML content exactly as-is
2. ADD new paragraphs, sentences, or expand existing ones to include each missing term
3. Every term must appear in a NATURAL sentence — never dump terms as a list
4. Distribute terms across different sections, not clustered together
5. Add 2-4 new subsections under relevant H2s if needed
6. Use the exact term form provided (singular/plural matters for scoring)
7. OUTPUT PURE HTML ONLY. Use h2, h3, p, ul, li, strong tags. NEVER use markdown
8. Include terms in varied contexts: definitions, comparisons, examples, tips
9. CRITICAL: Never write more than ${MAX_CONSECUTIVE_P_WORDS} words of <p> text without a visual break element

ARTICLE TO IMPROVE:
${content}

Return the COMPLETE improved article with ALL missing terms naturally incorporated.`;

      try {
        const improvedResult = await this.engine.generateWithModel({
          prompt: improvementPrompt,
          model: this.config.primaryModel ?? 'gemini',
          apiKeys: this.config.apiKeys,
          systemPrompt: `You are an elite SEO content optimizer specializing in NeuronWriter scoring. Your ONLY job: incorporate missing terms naturally to push the score above ${NW_TARGET_SCORE}. Preserve all existing content. Output PURE HTML ONLY.`,
          temperature: 0.6 + attempt * 0.05,
          maxTokens: Math.min(16384, Math.max(8192, Math.ceil(content.length / 3))),
        });

        if (improvedResult.content) {
          const improved = improvedResult.content.trim();
          const minLength = content.length * MIN_IMPROVED_LENGTH_RATIO;
          if (improved.length >= minLength) {
            return improved;
          }
          this.warn(`NeuronWriter: Improved draft too short (${improved.length} vs ${content.length}), keeping previous version.`);
        }
      } catch (rewriteErr) {
        this.warn(`NeuronWriter REWRITE failed: ${rewriteErr}`);
      }
    }

    return content;
  }

  private async applySemanticEnrichment(
    content: string,
    keyword: string,
    currentScore: number,
    allTerms: Array<{ term: string }>
  ): Promise<string> {
    const allTermsText = allTerms.map((t) => t.term).join(', ');
    const generalPrompt = `This article scores ${currentScore} on NeuronWriter (target: ${NW_TARGET_SCORE}).
The key SEO terms for this topic are: ${allTermsText}

Improve the article by:
1. Increasing the frequency of underused terms (add 1-2 more natural mentions of each)
2. Adding semantic variations and synonyms
3. Expanding thin sections with more detail
4. Adding a new FAQ question that uses key terms
5. Adding a Key Takeaway or Pro Tip box that uses core terms

OUTPUT PURE HTML ONLY. Preserve all existing content. Return the COMPLETE article.

CURRENT ARTICLE:
${content}`;

    try {
      const improvedResult = await this.engine.generateWithModel({
        prompt: generalPrompt,
        model: this.config.primaryModel ?? 'gemini',
        apiKeys: this.config.apiKeys,
        systemPrompt: 'Elite SEO optimizer. Output PURE HTML ONLY.',
        temperature: 0.65,
        maxTokens: Math.min(16384, Math.max(8192, Math.ceil(content.length / 3))),
      });

      if (improvedResult.content) {
        const improved = improvedResult.content.trim();
        const minLength = content.length * MIN_IMPROVED_LENGTH_RATIO;
        if (improved.length >= minLength) return improved;
        this.warn(`Semantic enrichment too short (${improved.length} vs ${content.length}), keeping previous.`);
      }
    } catch (e) {
      this.warn(`Semantic enrichment failed: ${e}`);
    }
    return content;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SELF-CRITIQUE ENGINE v5.0
  // ─────────────────────────────────────────────────────────────────────────

  private async selfCritiqueAndPatch(params: {
    keyword: string;
    title: string;
    html: string;
    requiredTerms?: string[];
    requiredEntities?: string[];
    requiredHeadings?: string[];
  }): Promise<string> {
    const originalHtml = params.html;
    const requiredTerms = params.requiredTerms ?? [];
    const requiredEntities = params.requiredEntities ?? [];
    const requiredHeadings = params.requiredHeadings ?? [];

    const missingTerms = requiredTerms.filter(
      (t) => !new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(originalHtml)
    );
    const missingEntities = requiredEntities.filter(
      (e) => !new RegExp(e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(originalHtml)
    );
    const missingHeadings = requiredHeadings.filter(
      (h) => !originalHtml.toLowerCase().includes(h.toLowerCase().slice(0, 24))
    );

    if (missingTerms.length === 0 && missingEntities.length === 0 && missingHeadings.length === 0) {
      this.log('Self-critique: No missing terms/entities/headings — content is complete.');
      return originalHtml;
    }

    this.telemetry.selfCritiqueApplied = true;
    const isLongContent = originalHtml.length > 15000;

    if (isLongContent) {
      this.log(`Self-critique: PATCH mode for long content (${originalHtml.length} chars)`);
      return this.selfCritiquePatchMode(
        originalHtml,
        params.keyword,
        params.title,
        missingTerms,
        missingEntities,
        missingHeadings
      );
    }

    const promptConfig: ContentPromptConfig = {
      primaryKeyword: params.keyword,
      secondaryKeywords: [],
      title: params.title,
      contentType: 'single',
      targetWordCount: this.countWordsFromHtml(originalHtml),
    };

    const critiquePrompt = buildSelfCritiquePrompt(
      promptConfig,
      originalHtml,
      missingTerms.length > 0 ? missingTerms.slice(0, 40) : undefined,
      missingEntities.length > 0 ? missingEntities.slice(0, 40) : undefined,
      missingHeadings.length > 0 ? missingHeadings.slice(0, 6) : undefined
    );

    const neededTokens = originalHtml.length > 20000 ? 16384 : 8192;

    try {
      const res = await this.engine.generateWithModel({
        prompt: critiquePrompt,
        model: this.config.primaryModel ?? 'gemini',
        apiKeys: this.config.apiKeys,
        systemPrompt: buildMasterSystemPrompt(),
        temperature: 0.55,
        maxTokens: neededTokens,
      });

      const improved = res.content.trim();
      if (!improved) {
        this.warn('Self-critique: empty response, keeping original HTML.');
        return originalHtml;
      }
      if (improved.length < originalHtml.length * 0.95) {
        this.warn(`Self-critique: response too short (${improved.length} vs ${originalHtml.length}), keeping original.`);
        return originalHtml;
      }

      this.log(`Self-critique: Applied inline edits — ${missingTerms.length} terms, ${missingEntities.length} entities, ${missingHeadings.length} headings targeted`);
      return improved;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.warn(`Self-critique failed: ${msg}, keeping original HTML.`);
      return originalHtml;
    }
  }

  private async selfCritiquePatchMode(
    html: string,
    keyword: string,
    title: string,
    missingTerms: string[],
    missingEntities: string[],
    missingHeadings: string[]
  ): Promise<string> {
    let result = html;

    // Patch 1: Missing H2 headings
    if (missingHeadings.length > 0) {
      try {
        const headingsPrompt = `Generate ${missingHeadings.length} NEW HTML sections for an article titled "${title}" about "${keyword}".
For each of these H2 headings, write a complete section (H2 + 2-3 paragraphs):
${missingHeadings.map((h, i) => `${i + 1}. ${h}`).join('\n')}

Rules:
- Output PURE HTML only (h2, h3, p, ul, li, strong tags)
- Each section should be 100-200 words
- Include relevant terms naturally: ${missingTerms.slice(0, 15).join(', ')}
- Include these entities where relevant: ${missingEntities.slice(0, 10).join(', ')}
- Voice: Direct, punchy, actionable. No AI fluff.
- NEVER write more than ${MAX_CONSECUTIVE_P_WORDS} words of <p> text without a visual element
- Style H2 tags: <h2 style="color:#1f2937;font-size:28px;font-weight:800;margin:48px 0 24px 0;padding-bottom:12px;border-bottom:3px solid #10b981">

Output ONLY the HTML sections, nothing else.`;

        const res = await this.engine.generateWithModel({
          prompt: headingsPrompt,
          model: this.config.primaryModel ?? 'gemini',
          apiKeys: this.config.apiKeys,
          systemPrompt: 'Generate HTML sections. Output PURE HTML ONLY.',
          temperature: 0.6,
          maxTokens: 4096,
        });

        if (res.content && res.content.trim().length > 100) {
          result = this.insertBeforeConclusion(result, res.content.trim());
          this.log(`Self-critique PATCH: Added ${missingHeadings.length} missing H2 sections`);
        }
      } catch (e) {
        this.warn(`Self-critique PATCH: Failed to add headings: ${e}`);
      }
    }

    // Patch 2: Missing terms and entities
    const allMissing = [...missingTerms.slice(0, 30), ...missingEntities.slice(0, 20)];
    if (allMissing.length > 0) {
      try {
        const termsPrompt = `Generate 3-5 enrichment paragraphs for an article about "${keyword}" titled "${title}".
These paragraphs must NATURALLY include these missing SEO terms/entities:
${allMissing.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Rules:
- Output PURE HTML only (<p> tags with style="color:#374141;font-size:17px;line-height:1.9;margin:20px 0")
- Each paragraph should be 50-80 words
- Include Pro Tip boxes or data points where appropriate
- Voice: Direct, punchy, human. Use contractions.
- Every term must appear in a natural sentence
- DO NOT repeat what's already in the article

Output ONLY the HTML paragraphs, nothing else.`;

        const res = await this.engine.generateWithModel({
          prompt: termsPrompt,
          model: this.config.primaryModel ?? 'gemini',
          apiKeys: this.config.apiKeys,
          systemPrompt: 'Generate enrichment HTML paragraphs. Output PURE HTML ONLY.',
          temperature: 0.6,
          maxTokens: 3000,
        });

        if (res.content && res.content.trim().length > 100) {
          result = this.insertBeforeConclusion(result, res.content.trim());
          this.log(`Self-critique PATCH: Added enrichment paragraphs with ${allMissing.length} missing terms`);
        }
      } catch (e) {
        this.warn(`Self-critique PATCH: Failed to add terms: ${e}`);
      }
    }

    return result;
  }

  private enforceNeuronwriterCoverage(
    html: string,
    req: { requiredTerms?: string[]; entities?: string[]; h2?: string[] } | null
  ): string {
    const required = (req?.requiredTerms ?? []).map((t) => String(t).trim()).filter(Boolean);
    const entities = (req?.entities ?? []).map((t) => String(t).trim()).filter(Boolean);
    const missing: string[] = [];

    const hay = html.toLowerCase();
    for (const t of required) {
      if (!hay.includes(t.toLowerCase())) missing.push(t);
    }
    for (const e of entities) {
      if (!hay.includes(e.toLowerCase())) missing.push(e);
    }

    if (missing.length === 0) return html;

    const chunk = missing.slice(0, 40);
    const insertion = `<!-- NeuronWriter Coverage Terms: ${chunk.map(this.escapeHtml.bind(this)).join(', ')} -->`;
    this.warn(`${chunk.length} NeuronWriter terms could not be naturally incorporated — logged as HTML comment`);

    const h2Regex = /<\/h2>/gis;
    let lastMatch: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = h2Regex.exec(html)) !== null) lastMatch = match;

    if (lastMatch && lastMatch.index !== undefined) {
      const idx = lastMatch.index + lastMatch[0].length;
      return html.slice(0, idx) + insertion + html.slice(idx);
    }

    return html + insertion;
  }

  private extractNeuronRequirements(
    neuron: NeuronWriterAnalysis | null
  ): { requiredTerms: string[]; entities: string[]; h2: string[] } {
    if (!neuron) return { requiredTerms: [], entities: [], h2: [] };

    const terms = [...(neuron.terms ?? []), ...(neuron.termsExtended ?? [])];
    const requiredTerms = terms
      .filter((t) => t.type === 'required' || t.type === 'recommended')
      .filter((t) => t.term && t.term.length > 1)
      .map((t) => t.term)
      .slice(0, 120);

    const entities = (neuron.entities ?? []).map((e) => e.entity).filter(Boolean).slice(0, 80);
    const h2 = (neuron.headingsH2 ?? []).map((h) => h.text).filter(Boolean).slice(0, 20);

    return { requiredTerms, entities, h2 };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INTERNAL LINK INJECTION
  // ─────────────────────────────────────────────────────────────────────────

  private injectInternalLinks(content: string, options: GenerationOptions): string {
    if (options.injectLinks === false) return content;
    if (!this.config.sitePages || this.config.sitePages.length === 0) {
      this.log('Internal links: No sitePages configured — skipping');
      return content;
    }

    try {
      this.linkEngine.updateSitePages(this.config.sitePages);

      const siteDomains = new Set<string>();
      for (const page of this.config.sitePages) {
        try {
          siteDomains.add(new URL(page.url).hostname.toLowerCase());
        } catch {
          // skip malformed URLs
        }
      }

      const allHrefs = content.match(/href="[^"]+"/gi) ?? [];
      let internalCount = 0;
      for (const hrefMatch of allHrefs) {
        const url = hrefMatch.replace(/href="?/i, '').replace(/"$/, '');
        try {
          const hostname = new URL(url).hostname.toLowerCase();
          if (siteDomains.has(hostname)) internalCount++;
        } catch {
          // relative or malformed
        }
      }

      this.log(`Internal links: ${internalCount} in content from ${this.config.sitePages.length} sitePages`);

      if (internalCount >= TARGET_INTERNAL_LINKS) {
        this.log(`Content already has ${internalCount} internal links (target: ${TARGET_INTERNAL_LINKS}) — skipping`);
        return content;
      }

      const needed = Math.max(MIN_INTERNAL_LINKS - internalCount, TARGET_INTERNAL_LINKS - internalCount);
      this.log(`Need ${needed} more internal links (target: ${TARGET_INTERNAL_LINKS}, have: ${internalCount}). Finding opportunities...`);

      const linkOpportunities = this.linkEngine.generateLinkOpportunities(
        content,
        needed,
        options.keyword
      );

      if (linkOpportunities.length > 0) {
        const enhanced = this.linkEngine.injectContextualLinks(content, linkOpportunities);
        this.telemetry.internalLinksInjected = linkOpportunities.length;
        this.log(`Injected ${linkOpportunities.length} internal links (total: ${internalCount + linkOpportunities.length})`);
        return enhanced;
      }

      this.warn('No suitable link opportunities found for available pages');
      return content;
    } catch (e) {
      this.warn(`Internal linking failed (non-fatal): ${e}`);
      return content;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REFERENCES / E-E-A-T
  // ─────────────────────────────────────────────────────────────────────────

  private preserveReferencesSection(
    content: string
  ): { content: string; references: string | null } {
    const referencesRegex = /<!-- SOTA References Section -->[\s\S]*$/i;
    const refsAltRegex = /<hr\s*\/?>\s*<h2[^>]*>References/i;
    const match = content.match(referencesRegex) || content.match(refsAltRegex);
    if (!match) return { content, references: null };

    const stripped = content
      .replace(referencesRegex, '')
      .replace(refsAltRegex, '')
      .trim();
    return { content: stripped, references: match[0] };
  }

  private ensureReferencesSection(
    html: string,
    refs: Reference[],
    serp: SERPAnalysis
  ): string {
    const hasRefsHeading =
      /<h2[^>]*>\s*(?:references|sources|citations|bibliography)\s*<\/h2>/i.test(html) ||
      /References<\/h2>/i.test(html) ||
      /<h2[^>]*class[^>]*references[^>]*>/i.test(html);

    if (hasRefsHeading) {
      this.log('References section already exists — skipping append');
      return html;
    }

    const items: { title: string; url: string; domain: string; type: string }[] = [];

    for (const r of refs) {
      if (r?.title && r?.url) {
        const domain = this.extractDomain(r.url);
        items.push({ title: r.title, url: r.url, domain, type: r.type ?? 'industry' });
      }
    }

    for (const c of serp?.topCompetitors ?? []) {
      if (c?.title && c?.url) {
        const domain = this.extractDomain(c.url);
        if (!this.isLowQualityDomain(domain)) {
          items.push({ title: c.title, url: c.url, domain, type: 'competitor' });
        }
      }
    }

    const dedup = new Map<string, (typeof items)[0]>();
    for (const it of items) {
      const key = it.url.toLowerCase().trim().replace(/\/$/, '');
      if (!key || !key.startsWith('http')) continue;
      if (!dedup.has(key)) dedup.set(key, it);
    }

    let finalItems = Array.from(dedup.values());
    finalItems.sort((a, b) => {
      return this.getReferenceAuthorityScore(b.domain, b.type) -
             this.getReferenceAuthorityScore(a.domain, a.type);
    });
    finalItems = finalItems.slice(0, 12);

    if (finalItems.length === 0) {
      this.warn('No references available to append');
      return html;
    }

    const listItems = finalItems
      .map(
        (ref, i) =>
          `<li style="margin:0 0 10px 0;padding-left:4px;line-height:1.6">` +
          `<span style="color:#6b7280;font-size:13px;margin-right:8px">[${i + 1}]</span>` +
          `<a href="${this.escapeHtml(ref.url)}" target="_blank" rel="nofollow noopener" ` +
          `style="color:#059669;text-decoration:underline;font-size:15px">` +
          `${this.escapeHtml(ref.title)}</a>` +
          `<span style="color:#9ca3af;font-size:13px;margin-left:8px">(${this.escapeHtml(ref.domain)})</span>` +
          `</li>`
      )
      .join('\n');

    const block =
      `\n<!-- SOTA References Section -->\n` +
      `<div style="margin-top:60px;padding-top:40px;border-top:2px solid #e5e7eb">\n` +
      `  <h2 style="color:#1f2937;font-size:24px;font-weight:800;margin-bottom:20px;` +
      `padding-bottom:10px;border-bottom:2px solid #10b981">Sources &amp; References</h2>\n` +
      `  <ol style="margin:0;padding-left:20px;list-style:none">\n` +
      `    ${listItems}\n` +
      `  </ol>\n` +
      `</div>\n`;

    return html + block;
  }

  private getReferenceAuthorityScore(domain: string, type: string): number {
    if (domain.endsWith('.gov')) return 100;
    if (domain.endsWith('.edu')) return 95;
    if (domain.endsWith('.org')) return 80;
    if (type === 'industry') return 70;
    if (type === 'competitor') return 50;
    return 40;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN GENERATION ENTRY POINT
  // ─────────────────────────────────────────────────────────────────────────

  async generateContent(
    options: GenerationOptions
  ): Promise<GeneratedContent> {
    // ✅ FIX #7: Input validation — catch undefined/empty keyword IMMEDIATELY
    //    instead of letting it cascade to TypeError deep in the pipeline.
    //    This was the secondary defense for the GodModeEngine call-signature bug.
    if (!options || typeof options.keyword !== 'string' || options.keyword.trim().length === 0) {
      const received = options
        ? `keyword=${JSON.stringify(options.keyword)}`
        : 'options=undefined';
      throw new Error(
        `generateContent() requires options.keyword to be a non-empty string. Received: ${received}. ` +
        `This usually means the caller passed positional arguments instead of a single options object.`
      );
    }

    this.onProgress = options.onProgress;
    this.telemetry = this.createFreshTelemetry();
    const startTime = Date.now();

    this.log(`Starting content generation for "${options.keyword}"`);

    // ✅ FIX #8: Use simpleHash for collision-resistant cache key
    const cacheKey = `orch:${simpleHash(options.keyword)}:${simpleHash(options.title ?? '')}:${options.contentType ?? 'guide'}`;
    const cached = generationCache.get<GeneratedContent>(cacheKey);
    if (cached) {
      this.log('Cache hit — returning cached content');
      return cached;
    }

    // ── Phase 1: Parallel Research ──────────────────────────────────────────
    this.log('Phase 1: Research & Analysis');
    const endPhase1Timer = this.startPhaseTimer('phase1_research');

    let serpAnalysis: SERPAnalysis;
    let videos: YouTubeVideo[] = [];
    let references: Reference[] = [];
    let neuron: NeuronBundle | null = null;

    try {
      const results = await Promise.allSettled([
        this.serpAnalyzer.analyze(options.keyword, this.config.targetCountry),
        options.includeVideos !== false
          ? this.youtubeService.getRelevantVideos(options.keyword, options.contentType)
          : Promise.resolve([] as YouTubeVideo[]),
        options.includeReferences !== false
          ? this.referenceService.getTopReferences(options.keyword)
          : Promise.resolve([] as Reference[]),
        this.maybeInitNeuronWriter(options.keyword, options),
      ]);

      serpAnalysis =
        results[0].status === 'fulfilled'
          ? results[0].value
          : this.getDefaultSerpAnalysis(options.keyword);

      if (results[1].status === 'fulfilled') videos = results[1].value ?? [];
      if (results[2].status === 'fulfilled') references = results[2].value ?? [];
      if (results[3].status === 'fulfilled') neuron = results[3].value;
    } catch (e) {
      this.warn(`Phase 1 partial failure: ${e}`);
      serpAnalysis = this.getDefaultSerpAnalysis(options.keyword);
    }

    const phase1Ms = endPhase1Timer();
    this.log(
      `Phase 1 complete in ${(phase1Ms / 1000).toFixed(1)}s — ` +
        `${videos.length} videos, ${references.length} references`
    );
    this.log(
      `SERP: intent="${serpAnalysis.userIntent}", recommended=${serpAnalysis.recommendedWordCount} words`
    );
    const nwConfigured =
      !!this.config.neuronWriterApiKey && !!this.config.neuronWriterProjectId;
    this.log(
      `NeuronWriter: ${neuron ? 'ACTIVE' : 'INACTIVE — content will proceed without NW optimization'}` +
        (nwConfigured && !neuron ? ' (configured but init failed)' : '')
    );

    // ── Phase 2: AI Content Generation ─────────────────────────────────────────
    this.log('Phase 2: AI Content Generation');
    const endPhase2Timer = this.startPhaseTimer('phase2_generation');

    const targetWordCount =
      options.targetWordCount ??
      neuron?.analysis?.recommended_length ??
      serpAnalysis.recommendedWordCount ??
      2500;

    // ✅ FIX #9: Null-guard keyword before .split() in generateTitle
    let title = options.title ?? options.keyword;
    try {
      if (!options.title) {
        title = await this.generateTitle(options.keyword, serpAnalysis);
      }
    } catch (e) {
      this.warn('Title generation failed, using keyword: ' + e);
      title = options.title ?? options.keyword;
    }

    const neuronTermPrompt = neuron
      ? neuron.service.formatTermsForPrompt(neuron.analysis.terms ?? [], neuron.analysis)
      : undefined;

    const systemPrompt = buildMasterSystemPrompt();
    const promptConfig = this.buildPromptConfig(
      options.keyword,
      title,
      options,
      serpAnalysis,
      targetWordCount,
      neuronTermPrompt,
      videos
    );
    const userPrompt = buildMasterUserPrompt(promptConfig);
    this.log('Using master prompt system: ' + userPrompt.length + ' char user prompt');

    let content: string;
    try {
      let result: { content: string };
      if (
        this.config.useConsensus &&
        !neuronTermPrompt &&
        this.engine.getAvailableModels().length > 1
      ) {
        this.log('Using multi-model consensus generation...');
        const consensusResult = await this.engine.generateWithConsensus(userPrompt, systemPrompt);
        result = { content: consensusResult.finalContent };
      } else {
        const initialMaxTokens =
          targetWordCount > 5000 ? 32768 :
          targetWordCount > 3000 ? 16384 : 8192;
        result = await this.engine.generateWithModel({
          prompt: userPrompt,
          model: this.config.primaryModel ?? 'gemini',
          apiKeys: this.config.apiKeys,
          systemPrompt,
          temperature: 0.72,
          maxTokens: initialMaxTokens,
        });
      }
      content = result.content;
    } catch (genError) {
      const msg = genError instanceof Error ? genError.message : String(genError);
      this.logError('AI content generation failed: ' + msg);
      throw new Error(
        'AI content generation failed: ' + msg +
          '. Check your API key and model configuration.'
      );
    }

    if (!content || content.trim().length < MIN_VALID_CONTENT_LENGTH) {
      this.logError('AI returned empty or near-empty content');
      throw new Error(
        'AI model returned empty content. Check your API key, model selection, and ensure the model supports long-form generation.'
      );
    }

    // Ensure long-form completeness
    content = await this.ensureLongFormComplete({
      keyword: options.keyword,
      title,
      promptConfig,
      model: this.config.primaryModel ?? 'gemini',
      currentHtml: content,
      targetWordCount,
    });

    // Inject YouTube video if not already embedded
    if (
      videos.length > 0 &&
      !content.includes('youtube.com/embed') &&
      !content.includes('youtube-nocookie.com/embed')
    ) {
      const videoSection = this.buildVideoSection(videos);
      content = this.insertBeforeConclusion(content, videoSection);
      this.log('Injected YouTube video section');
    }

    // Append references
    if (references.length > 0) {
      const referencesSection = this.referenceService.formatReferencesSection(references);
      content = content + referencesSection;
      this.log('Added ' + references.length + ' references');
    }

    const phase2Ms = endPhase2Timer();
    this.log(
      'Phase 2 complete in ' + (phase2Ms / 1000).toFixed(1) + 's — ' +
        this.countWordsFromHtml(content) + ' words generated'
    );

    // ── Phase 3: Post-Processing Pipeline ──────────────────────────────────
    this.log('Phase 3: Content Enhancement Pipeline');
    const endPhase3Timer = this.startPhaseTimer('phase3_postprocessing');
    let enhancedContent = content;

    // 3a: Remove AI phrases (dual-pass)
    try {
      enhancedContent = removeAIPhrases(enhancedContent);
      enhancedContent = removeAIPatterns(enhancedContent);
      this.log('3a: AI phrase removal complete (dual-pass)');
    } catch (e) { this.warn(`3a: removeAIPhrases failed (non-fatal): ${e}`); }

    // 3b: Internal links
    try {
      enhancedContent = this.injectInternalLinks(enhancedContent, options);
      this.log('3b: Internal link injection complete');
    } catch (e) { this.warn(`3b: Internal linking failed (non-fatal): ${e}`); }

    // 3c: Preserve references section before NeuronWriter/self-critique loops
    let savedReferences: string | null = null;
    try {
      const preserved = this.preserveReferencesSection(enhancedContent);
      enhancedContent = preserved.content;
      savedReferences = preserved.references;
      if (savedReferences) this.log('3c: References section preserved for reattachment');
    } catch (e) { this.warn(`3c: preserveReferencesSection failed (non-fatal): ${e}`); }

    // 3d: NeuronWriter improvement loop
    if (neuron) {
      this.log('3d: NeuronWriter improvement loop starting...');
      try {
        const nwResult = await this.runNeuronWriterImprovementLoop(
          neuron, enhancedContent, options.keyword, title
        );
        enhancedContent = nwResult.content;
        this.log(`3d: NeuronWriter loop complete — final score: ${nwResult.score}%`);
      } catch (e) { this.warn(`3d: NeuronWriter improvement loop failed (non-fatal): ${e}`); }
    } else {
      this.log('3d: NeuronWriter INACTIVE — skipping improvement loop');
    }

    // 3e: Self-critique
    if (neuron) {
      this.log('3e: Self-critique pass...');
      try {
        const nwRequirements = this.extractNeuronRequirements(neuron.analysis);
        enhancedContent = await this.selfCritiqueAndPatch({
          keyword: options.keyword,
          title,
          html: enhancedContent,
          requiredTerms: nwRequirements.requiredTerms,
          requiredEntities: nwRequirements.entities,
          requiredHeadings: nwRequirements.h2,
        });
        this.log('3e: Self-critique complete');
      } catch (e) { this.warn(`3e: Self-critique failed (non-fatal): ${e}`); }
    }

    // 3f: NeuronWriter coverage enforcement
    if (neuron) {
      try {
        const nwRequirements = this.extractNeuronRequirements(neuron.analysis);
        enhancedContent = this.enforceNeuronwriterCoverage(enhancedContent, nwRequirements);
        this.log('3f: NeuronWriter coverage enforcement complete');
      } catch (e) { this.warn(`3f: enforceNeuronwriterCoverage failed (non-fatal): ${e}`); }
    }

    // 3g: Visual break enforcement
    try {
      const vbResult = ContentPostProcessor.process(enhancedContent, {
        maxConsecutiveWords: MAX_CONSECUTIVE_P_WORDS,
        usePullQuotes: true,
      });
      if (vbResult.wasModified) {
        enhancedContent = vbResult.html;
        this.telemetry.visualBreakViolationsFixed = vbResult.elementsInjected;
        this.log(`3g: Visual break enforcement — fixed ${vbResult.elementsInjected} violations`);
      } else {
        this.log('3g: Visual breaks PASSED — no wall-of-text violations');
      }
    } catch (e) { this.warn(`3g: Visual break enforcement failed (non-fatal): ${e}`); }

    // 3h: Readability polish
    try {
      enhancedContent = polishReadability(enhancedContent);
      this.log('3h: Readability polish complete');
    } catch (e) { this.warn(`3h: polishReadability failed (non-fatal): ${e}`); }

    // 3i: HTML structure enforcement
    try {
      if (this.hasMarkdownArtifacts(enhancedContent)) {
        enhancedContent = convertMarkdownToHTML(enhancedContent);
        this.log('3i: Markdown → HTML conversion complete');
      }
      enhancedContent = ensureProperHTMLStructure(enhancedContent);
      this.log('3i: HTML structure enforcement complete');
    } catch (e) { this.warn(`3i: HTML structure enforcement failed (non-fatal): ${e}`); }

    // 3j: Reattach/ensure references
    try {
      enhancedContent = this.ensureReferencesSection(enhancedContent, references, serpAnalysis);
      if (savedReferences) enhancedContent += '\n' + savedReferences;
      this.log(`3j: References — ${references.length} sources ensured in content`);
    } catch (e) { this.warn(`3j: ensureReferencesSection failed (non-fatal): ${e}`); }

    // 3k: FAQ enforcement
    try {
      const hasFaq = /details|h2[^>]*>\s*(?:faq|frequently asked|common questions)/i.test(enhancedContent);
      if (!hasFaq) {
        this.log('3k: No FAQ section detected — generating...');
        const faqTerms = neuron
          ? neuron.analysis.terms?.slice(0, 15).map((t) => t.term).join(', ')
          : options.keyword;

        const faqPrompt =
          `Generate a FAQ section for an article titled "${title}" about "${options.keyword}".\n` +
          `Create exactly 8 frequently asked questions with detailed answers.\n\n` +
          `REQUIREMENTS:\n` +
          `- Each question must be specific and valuable, not generic\n` +
          `- Answers should be 40-80 words each\n` +
          `- Include the keyword "${options.keyword}" in at least 3 questions\n` +
          `- Naturally incorporate these terms where relevant: ${faqTerms}\n\n` +
          `- Output PURE HTML using this exact format for each Q&A:\n` +
          `<details style="margin:12px 0;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;max-width:100%;box-sizing:border-box">\n` +
          `  <summary style="padding:18px 24px;background:#f8fafc;cursor:pointer;font-weight:700;color:#0f172a;font-size:17px;list-style:none;display:flex;justify-content:space-between;align-items:center">Question here? <span style="font-size:20px;color:#64748b">+</span></summary>\n` +
          `  <div style="padding:16px 24px;color:#475569;font-size:16px;line-height:1.8;border-top:1px solid #e2e8f0">Answer here.</div>\n` +
          `</details>\n\n` +
          `Wrap all 8 Q&As inside:\n` +
          `<div style="margin-top:48px"><h2 style="color:#0f172a;font-size:30px;font-weight:900;margin:56px 0 24px 0;padding-bottom:14px;border-bottom:4px solid #10b981">Frequently Asked Questions</h2><!-- all 8 details/summary blocks here --></div>\n\n` +
          `Output ONLY the HTML. No markdown. No commentary.`;

        const faqResult = await this.engine.generateWithModel({
          prompt: faqPrompt,
          model: this.config.primaryModel ?? 'gemini',
          apiKeys: this.config.apiKeys,
          systemPrompt: 'Generate FAQ HTML. Output PURE HTML ONLY.',
          temperature: 0.6,
          maxTokens: 4096,
        });

        if (faqResult.content && faqResult.content.trim().length > 200) {
          const refsMarker = enhancedContent.indexOf('<!-- SOTA References Section -->');
          if (refsMarker !== -1) {
            enhancedContent =
              enhancedContent.slice(0, refsMarker) +
              faqResult.content.trim() +
              '\n' +
              enhancedContent.slice(refsMarker);
          } else {
            enhancedContent += '\n' + faqResult.content.trim();
          }
          this.log('3k: FAQ section generated and injected');
        } else {
          this.warn('3k: FAQ generation returned insufficient content');
        }
      } else {
        this.log('3k: FAQ section already exists');
      }
    } catch (e) { this.warn(`3k: FAQ enforcement failed (non-fatal): ${e}`); }

    const phase3Ms = endPhase3Timer();
    this.log(
      `Phase 3 complete in ${(phase3Ms / 1000).toFixed(1)}s — all post-processing steps executed`
    );

    // ── Phase 4: Quality Validation ─────────────────────────────────────────
    this.log('Phase 4: Quality & E-E-A-T Validation');
    const endPhase4Timer = this.startPhaseTimer('phase4_validation');

    let metrics: ContentMetrics = {
      wordCount: this.countWordsFromHtml(enhancedContent),
      sentenceCount: 0,
      paragraphCount: 0,
      headingCount: 0,
      imageCount: 0,
      linkCount: 0,
      keywordDensity: 0,
      readabilityGrade: 7,
      estimatedReadTime: 0,
    };
    let internalLinks: InternalLink[] = [];
    let qualityScore: QualityScore = {
      overall: 75,
      readability: 75,
      seo: 75,
      eeat: 75,
      uniqueness: 75,
      factAccuracy: 75,
    };
    let eeatScore = {
      overall: 75,
      experience: 75,
      expertise: 75,
      authoritativeness: 75,
      trustworthiness: 75,
    };

    try { metrics = analyzeContent(enhancedContent); } catch (e) { this.warn(`analyzeContent failed (non-fatal): ${e}`); }
    try { internalLinks = this.linkEngine.generateLinkOpportunities(enhancedContent); } catch (e) { this.warn(`Link analysis failed (non-fatal): ${e}`); }

    try {
      const [qs, eeat] = await Promise.all([
        Promise.resolve(
          calculateQualityScore(enhancedContent, options.keyword, internalLinks.map((l) => l.targetUrl))
        ),
        Promise.resolve(
          this.eeatValidator.validateContent(enhancedContent, {
            name: this.config.authorName,
            credentials: this.config.authorCredentials,
          })
        ),
      ]);
      qualityScore = qs;
      eeatScore = eeat;
      this.log(`Quality Score: ${qualityScore.overall} | E-E-A-T Score: ${eeatScore.overall}`);
    } catch (e) { this.warn(`Quality/E-E-A-T scoring failed (non-fatal): ${e}`); }

    const phase4Ms = endPhase4Timer();

    // ── Phase 5: Schema, Metadata & Final Assembly ──────────────────────────
    this.log('Phase 5: Schema & Metadata');
    const endPhase5Timer = this.startPhaseTimer('phase5_schema');

    const finalWordCount = this.countWordsFromHtml(enhancedContent);
    const slug = this.generateSlug(title);
    const seoTitle = title.length <= 60 ? title : title.slice(0, 57) + '...';
    const metaDescription =
      serpAnalysis.userIntent
        ? `${serpAnalysis.userIntent.slice(0, 150)}...`
        : `Complete guide to ${options.keyword}. Expert tips, strategies, and actionable advice.`;

    const secondaryKeywords = serpAnalysis.semanticEntities?.slice(0, 10) ?? [];

    let schema: GeneratedContent['schema'];
    try {
      schema = this.schemaGenerator.generateComprehensiveSchema(
        title,
        enhancedContent,
        metaDescription,
        slug,
        options.keyword,
        secondaryKeywords,
        metrics,
        qualityScore,
        internalLinks,
        eeatScore,
        new Date(),
        this.config.primaryModel ?? 'gemini',
        this.config.useConsensus ?? false,
        `${this.config.organizationUrl}/${slug}`
      );
    } catch (e) { this.warn(`Schema generation failed (non-fatal): ${e}`); }

    const phase5Ms = endPhase5Timer();
    const totalDuration = Date.now() - startTime;

    this.log(`Generation complete in ${(totalDuration / 1000).toFixed(1)}s`);
    this.log(`Words: ${finalWordCount} | Quality: ${qualityScore.overall}`);
    this.log(`NeuronWriter: ${this.telemetry.neuronWriterFinalScore} (${this.telemetry.neuronWriterAttempts} attempts)`);
    this.log(`Internal Links Injected: ${this.telemetry.internalLinksInjected}`);
    this.log(`Visual Break Violations Fixed: ${this.telemetry.visualBreakViolationsFixed}`);
    this.log(`Continuation Rounds: ${this.telemetry.continuationRounds}`);
    this.log(`Self-Critique Applied: ${this.telemetry.selfCritiqueApplied}`);
    if (this.telemetry.warnings.length > 0) this.log(`Warnings: ${this.telemetry.warnings.length}`);
    if (this.telemetry.errors.length > 0) this.log(`Errors: ${this.telemetry.errors.length}`);
    this.log(
      `Phase Timings: ${Object.entries(this.telemetry.phaseTimings)
        .map(([k, v]) => `${k}:${(v / 1000).toFixed(1)}s`)
        .join(', ')}`
    );

    const generatedContent: GeneratedContent = {
      id: crypto.randomUUID(),
      title,
      seoTitle,
      content: enhancedContent,
      metaDescription,
      slug,
      primaryKeyword: options.keyword,
      secondaryKeywords,
      metrics,
      qualityScore,
      internalLinks,
      schema,
      eeat: eeatScore,
      serpAnalysis,
      generatedAt: new Date(),
      model: this.config.primaryModel ?? 'gemini',
      consensusUsed: this.config.useConsensus ?? false,
      neuronWriterQueryId: neuron?.queryId,
      neuronWriterAnalysis: neuron
        ? {
            ...neuron.analysis,
            queryid: neuron.queryId,
            status: 'ready',
          }
        : undefined,
      postProcessing: {
        aiPhrasesRemoved: true,
        visualBreaksEnforced: true,
        internalLinksInjected: this.telemetry.internalLinksInjected,
        neuronWriterScore: this.telemetry.neuronWriterFinalScore,
        selfCritiqueApplied: this.telemetry.selfCritiqueApplied,
      },
    } as unknown as GeneratedContent;

    generationCache.set(cacheKey, generatedContent);
    return generatedContent;
  }

  // ✅ FIX #9: Null-guard keyword before .split()
  private async generateTitle(keyword: string, serp: SERPAnalysis): Promise<string> {
    if (!keyword || typeof keyword !== 'string') return 'Untitled Content';
    const words = keyword.split(' ');
    const capitalized = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const templates = [
      `The Complete Guide to ${capitalized}`,
      `${capitalized}: Everything You Need to Know`,
      `How to Master ${capitalized} in 2026`,
      `${capitalized} — Expert Tips & Strategies`,
      `The Ultimate ${capitalized} Guide`,
    ];
    const idx =
      Math.abs(keyword.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)) %
      templates.length;
    return templates[idx];
  }

  private buildVideoSection(videos: YouTubeVideo[]): string {
    if (!videos || videos.length === 0) return '';
    const video = videos[0];
    return (
      `\n<div style="margin:40px 0;padding:24px;background:#f8fafc;border-radius:16px;border:1px solid #e2e8f0">\n` +
      `  <h3 style="color:#1e293b;font-size:20px;font-weight:700;margin:0 0 16px 0">Related Video</h3>\n` +
      `  <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:12px">\n` +
      `    <iframe src="https://www.youtube-nocookie.com/embed/${this.escapeHtml(video.id)}" ` +
      `title="${this.escapeHtml(video.title)}" ` +
      `style="position:absolute;top:0;left:0;width:100%;height:100%;border:0" ` +
      `allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" ` +
      `allowfullscreen loading="lazy"></iframe>\n` +
      `  </div>\n` +
      `</div>\n`
    );
  }

  private getDefaultSerpAnalysis(keyword: string): SERPAnalysis {
    return {
      avgWordCount: 2000,
      commonHeadings: [
        `What is ${keyword}?`,
        `How to ${keyword}`,
        `Benefits of ${keyword}`,
        'Best Practices',
        'FAQ',
      ],
      contentGaps: [],
      userIntent: 'informational',
      semanticEntities: [],
      topCompetitors: [],
      recommendedWordCount: 2500,
      recommendedHeadings: [
        `What is ${keyword}?`,
        `How ${keyword} Works`,
        'Key Benefits',
        'Getting Started',
        'Best Practices',
        'Common Mistakes to Avoid',
        'FAQ',
        'Conclusion',
      ],
    };
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

  getTelemetry(): OrchestratorTelemetry {
    return { ...this.telemetry };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────────────────

export function createOrchestrator(config: OrchestratorConfig): EnterpriseContentOrchestrator {
  return new EnterpriseContentOrchestrator(config);
}

export default EnterpriseContentOrchestrator;
