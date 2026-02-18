// src/lib/sota/EnterpriseContentOrchestrator.ts
// ═══════════════════════════════════════════════════════════════════════════════
// ENTERPRISE CONTENT ORCHESTRATOR v5.1
// ═══════════════════════════════════════════════════════════════════════════════
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

  private generateSlug(title: string): string {
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
        `NeuronWriter SKIPPED — API key: ${apiKey ? `present (${apiKey.length} chars)` : 'MISSING'}, ` +
          `Project ID: ${projectId ? 'present' : 'MISSING'}`
      );
      return null;
    }

    const service = createNeuronWriterService(apiKey);

    // FIX: Always use clean human-readable keyword for NeuronWriter
    const nwKeyword = this.cleanKeywordForNeuronWriter(keyword);
    this.log(`NeuronWriter: Initializing... keyword="${nwKeyword}" (original slug: "${keyword}")`);

    const queryIdFromOptions = options.neuronWriterQueryId?.trim();
    let queryId = queryIdFromOptions;

    // ── Step 1: Find existing ready query ──────────────────────────────────
    if (!queryId) {
      this.log('NeuronWriter: Searching for existing query matching keyword...');
      try {
        // FIX: use nwKeyword (clean), not raw keyword (slug)
        const searchResult = await service.findQueryByKeyword(projectId, nwKeyword);

        if (searchResult.success && searchResult.query) {
          const tempQueryId = searchResult.query.id;
          this.log(
            `NeuronWriter: Found existing query "${searchResult.query.keyword}" ID=${tempQueryId}`
          );

          const existingAnalysis = await service.getQueryAnalysis(tempQueryId);

          if (existingAnalysis.success && existingAnalysis.analysis) {
            // FIX: Accept any data (terms > 0 OR headings > 0), not strict threshold
            const hasAnyData =
              (existingAnalysis.analysis.terms?.length ?? 0) > 0 ||
              (existingAnalysis.analysis.headingsH2?.length ?? 0) > 0;

            if (hasAnyData) {
              queryId = tempQueryId;
              this.log(
                `NeuronWriter: ✅ Existing query accepted — ` +
                  `${existingAnalysis.analysis.terms?.length ?? 0} terms, ` +
                  `${existingAnalysis.analysis.headingsH2?.length ?? 0} H2s`
              );
            } else {
              this.log(
                'NeuronWriter: Existing query has no data yet — will create fresh query.'
              );
            }
          } else if (!existingAnalysis.success) {
            // Analysis not ready but query exists — reuse ID and poll (no duplicate creation)
            const errMsg = existingAnalysis.error || '';
            const isStillProcessing =
              /not ready|processing|pending|waiting/i.test(errMsg);

            if (isStillProcessing) {
              queryId = tempQueryId;
              this.log(
                `NeuronWriter: Query found but analysis still processing — reusing ID ${tempQueryId} for polling.`
              );
            } else {
              this.log(
                `NeuronWriter: Analysis fetch failed (${errMsg}) — will create new query.`
              );
            }
          }
        }
      } catch (searchErr) {
        this.warn(`NeuronWriter: Search failed: ${searchErr}, will create new query`);
      }
    }

    // ── Step 2: Create new query if needed ─────────────────────────────────
    if (!queryId) {
      const MAX_CREATE_RETRIES = 3;
      for (let createAttempt = 1; createAttempt <= MAX_CREATE_RETRIES; createAttempt++) {
        this.log(
          `NeuronWriter: Creating new query for "${nwKeyword}"... attempt ${createAttempt}/${MAX_CREATE_RETRIES}`
        );
        try {
          // FIX: createQuery also receives nwKeyword (clean), not slug
          const created = await service.createQuery(projectId, nwKeyword);
          if (created.success && created.queryId) {
            queryId = created.queryId;
            this.log(`NeuronWriter: Created NEW query ID=${queryId}`);
            break;
          }
          this.warn(`NeuronWriter: Create attempt ${createAttempt} failed: ${created.error ?? 'unknown error'}`);
        } catch (createErr) {
          this.warn(`NeuronWriter: Create attempt ${createAttempt} error: ${createErr}`);
        }

        if (createAttempt < MAX_CREATE_RETRIES) {
          const retryDelay = createAttempt * 3000;
          this.log(`NeuronWriter: Retrying query creation in ${retryDelay / 1000}s...`);
          await this.sleep(retryDelay);
        }
      }
    }

    if (!queryId) {
      this.warn('NeuronWriter: FAILED to obtain query ID. Proceeding WITHOUT NeuronWriter optimization.');
      return null;
    }

    // ── Step 3: Poll for analysis readiness ────────────────────────────────
    if (queryIdFromOptions) {
      this.log(`NeuronWriter: Using provided query ID=${queryId}`);
    }

    let lastStatus = '';
    let consecutivePollErrors = 0;
    const MAX_CONSECUTIVE_POLL_ERRORS = 5;

    for (let attempt = 1; attempt <= NW_MAX_POLL_ATTEMPTS; attempt++) {
      try {
        const analysisRes = await service.getQueryAnalysis(queryId);
        consecutivePollErrors = 0;

        if (analysisRes.success && analysisRes.analysis) {
          const summary = service.getAnalysisSummary(analysisRes.analysis);
          this.log(`NeuronWriter: Analysis READY — ${summary}`);

          const hasTerms = (analysisRes.analysis.terms?.length ?? 0) > 0;
          const hasHeadings = (analysisRes.analysis.headingsH2?.length ?? 0) > 0;

          if (!hasTerms && !hasHeadings) {
            this.warn(
              'NeuronWriter: Analysis returned but contains no terms or headings. ' +
                'Proceeding without NW optimization.'
            );
            return null;
          }

          return { service, queryId, analysis: analysisRes.analysis };
        }

        const msg = analysisRes.error ?? 'Query not ready';
        const currentStatusMatch = msg.match(/status="?([^"]+)"?/i);
        const currentStatus = currentStatusMatch?.[1] ?? '';
        const looksNotReady = /not ready|status|waiting|in progress/i.test(msg);

        if (!looksNotReady) {
          this.warn(`NeuronWriter: Analysis failed permanently: ${msg}`);
          return null;
        }

        if (currentStatus !== lastStatus) {
          this.log(`NeuronWriter: Status "${currentStatus}" — processing...`);
          lastStatus = currentStatus;
        }

        const delay = attempt <= 3 ? 2000 : attempt <= 10 ? 4000 : 6000;
        this.log(`NeuronWriter: Waiting for analysis... attempt ${attempt}/${NW_MAX_POLL_ATTEMPTS}`);
        await this.sleep(delay);
      } catch (pollErr) {
        consecutivePollErrors++;
        this.warn(`NeuronWriter: Poll attempt ${attempt} failed: ${pollErr}`);

        if (consecutivePollErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          this.warn(`NeuronWriter: ${MAX_CONSECUTIVE_POLL_ERRORS} consecutive poll errors — giving up.`);
          return null;
        }
        await this.sleep(3000);
      }
    }

    this.warn(`NeuronWriter: Analysis timed out after ${NW_MAX_POLL_ATTEMPTS} attempts. Check NeuronWriter dashboard.`);
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
      const scoreA = this.getReferenceAuthorityScore(a.domain, a.type);
      const scoreB = this.getReferenceAuthorityScore(b.domain, b.type);
      return scoreB - scoreA;
    });
    finalItems = finalItems.slice(0, 12);

    if (finalItems.length === 0) {
      this.warn('No references available to append');
      return html;
    }
    if (finalItems.length < 8) {
      this.warn(`Only ${finalItems.length} references available (target: 8-12)`);
    }

    const block = `<!-- SOTA References Section -->
<div style="margin-top:60px;padding-top:40px;border-top:2px solid #e5e7eb">
<h2 style="color:#1f2937;font-size:28px;font-weight:800;margin-bottom:24px;padding-bottom:12px;border-bottom:3px solid #10b981">

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
    keyword: string,
    title: string,
    options: GenerationOptions = { keyword }
  ): Promise<GeneratedContent> {
    this.telemetry = this.createFreshTelemetry();
    this.onProgress = options.onProgress;

    const cacheKey = `${keyword}-${title}-${options.contentType ?? 'guide'}`;
    const cached = generationCache.get(cacheKey);
    if (cached) {
      this.log('Cache hit — returning cached content');
      return cached;
    }

    // ── Phase 1: Parallel Research ─────────────────────────────────────────
    const endPhase1 = this.startPhaseTimer('phase1_research');
    this.log('Phase 1: Parallel research — SERP, YouTube, References, NeuronWriter...');

    const targetWordCount = options.targetWordCount ?? 3000;

    const [serpAnalysis, videos, references, neuronBundle] = await Promise.all([
      (async () => {
        this.log('SERP Analysis: Analyzing top-ranking content...');
        try {
          const result = await this.serpAnalyzer.analyze(keyword);
          this.log(`SERP Analysis: Complete — ${result.topCompetitors.length} competitors, avg ${result.avgWordCount} words`);
          return result;
        } catch (e) {
          this.warn(`SERP Analysis failed: ${e}`);
          return this.getFallbackSERPAnalysis(keyword);
        }
      })(),
      (async () => {
        if (options.includeVideos === false) return [] as YouTubeVideo[];
        this.log('YouTube: Searching for relevant videos...');
        try {
          const vids = await this.youtubeService.findVideos(keyword, 3);
          this.log(`YouTube: Found ${vids.length} videos`);
          return vids;
        } catch (e) {
          this.warn(`YouTube search failed: ${e}`);
          return [] as YouTubeVideo[];
        }
      })(),
      (async () => {
        if (options.includeReferences === false) return [] as Reference[];
        this.log('References: Gathering authoritative sources...');
        try {
          const refs = await this.referenceService.findReferences(keyword, 12);
          this.log(`References: Found ${refs.length} sources`);
          return refs;
        } catch (e) {
          this.warn(`Reference gathering failed: ${e}`);
          return [] as Reference[];
        }
      })(),
      (async () => {
        this.log('NeuronWriter: Initializing integration...');
        const bundle = await this.maybeInitNeuronWriter(keyword, options);
        if (bundle) {
          this.log(`NeuronWriter: ✅ Active — ${bundle.analysis.terms?.length ?? 0} terms loaded`);
        } else {
          this.log('NeuronWriter: INACTIVE — content will proceed without NW optimization');
        }
        return bundle;
      })(),
    ]);

    endPhase1();
    this.log(`Phase 1 complete in ${this.telemetry.phaseTimings['phase1_research']}ms`);

    // ── Phase 2: AI Content Generation ─────────────────────────────────────
    const endPhase2 = this.startPhaseTimer('phase2_generation');
    this.log('Phase 2: AI Content Generation...');

    // Build NeuronWriter term prompt if available
    let neuronTermPrompt: string | undefined;
    if (neuronBundle) {
      neuronTermPrompt = neuronBundle.service.formatTermsForPrompt(
        neuronBundle.analysis.terms ?? [],
        neuronBundle.analysis
      );
    }

    const promptConfig = this.buildPromptConfig(
      keyword,
      title,
      options,
      serpAnalysis,
      targetWordCount,
      neuronTermPrompt,
      videos
    );

    const model: AIModel = this.config.primaryModel ?? 'gemini';
    const systemPrompt = buildMasterSystemPrompt();
    const userPrompt = buildMasterUserPrompt(promptConfig);

    let rawContent: string;
    try {
      const genResult = await this.engine.generateWithModel({
        prompt: userPrompt,
        model,
        apiKeys: this.config.apiKeys,
        systemPrompt,
        temperature: 0.75,
        maxTokens: 8192,
      });
      rawContent = genResult.content;

      if (!rawContent || rawContent.length < MIN_VALID_CONTENT_LENGTH) {
        throw new Error('AI returned empty or too-short content. Try switching models.');
      }
    } catch (genError) {
      const msg = genError instanceof Error ? genError.message : String(genError);
      throw new Error(msg);
    }

    // Convert markdown to HTML if needed
    if (this.hasMarkdownArtifacts(rawContent)) {
      this.log('Content has Markdown — converting to HTML...');
      rawContent = convertMarkdownToHTML(rawContent);
    }

    // Ensure long-form completion
    rawContent = await this.ensureLongFormComplete({
      keyword,
      title,
      promptConfig,
      model,
      currentHtml: rawContent,
      targetWordCount,
    });

    endPhase2();
    this.log(`Phase 2 complete — ${this.countWordsFromHtml(rawContent)} words in ${this.telemetry.phaseTimings['phase2_generation']}ms`);

    // ── Phase 3: Post-Processing Pipeline ──────────────────────────────────
    const endPhase3 = this.startPhaseTimer('phase3_postprocess');
    this.log('Phase 3: Post-Processing Pipeline...');

    // Step 3.1: Preserve references section before any rewrites
    const { content: contentWithoutRefs, references: preservedRefs } =
      this.preserveReferencesSection(rawContent);
    let html = contentWithoutRefs;

    // Step 3.2: Remove AI phrases (dual pass)
    this.log('Content Enhancement: Removing AI patterns...');
    html = removeAIPatterns(html);
    html = removeAIPhrases(html);

    // Step 3.3: NeuronWriter improvement loop
    if (neuronBundle) {
      this.log('NeuronWriter: Starting improvement loop...');
      const nwResult = await this.runNeuronWriterImprovementLoop(
        neuronBundle,
        html,
        keyword,
        title
      );
      html = nwResult.content;
      this.log(`NeuronWriter: Final score — ${nwResult.score}%`);

      // Step 3.4: Self-critique pass for any remaining gaps
      const nwRequirements = this.extractNeuronRequirements(neuronBundle.analysis);
      html = await this.selfCritiqueAndPatch({
        keyword,
        title,
        html,
        requiredTerms: nwRequirements.requiredTerms,
        requiredEntities: nwRequirements.entities,
        requiredHeadings: nwRequirements.h2,
      });

      // Step 3.5: Last-resort coverage enforcement (HTML comment fallback)
      html = this.enforceNeuronwriterCoverage(html, nwRequirements);
    } else {
      this.log('NeuronWriter Retry also failed — skipping NW improvement loop');
    }

    // Step 3.6: Internal linking
    this.log('Internal Linking: Adding strategic links...');
    html = this.injectInternalLinks(html, options);

    // Step 3.7: Visual break enforcement
    this.log('Quality Validation: Enforcing visual breaks...');
    const vbResult = ContentPostProcessor.process(html, {
      maxConsecutiveWords: MAX_CONSECUTIVE_P_WORDS,
      usePullQuotes: true,
    });
    if (vbResult.wasModified) {
      html = vbResult.html;
      this.telemetry.visualBreakViolationsFixed = vbResult.elementsInjected;
      this.log(`Visual breaks: Fixed ${vbResult.elementsInjected} violations`);
    }

    // Step 3.8: Readability polish
    html = polishReadability(html);

    // Step 3.9: Ensure proper HTML structure & styling
    html = ensureProperHTMLStructure(html);

    // Step 3.10: Append references
    html = this.ensureReferencesSection(html, references, serpAnalysis);
    if (preservedRefs) html = html + '\n' + preservedRefs;

    endPhase3();
    this.log(`Phase 3 complete in ${this.telemetry.phaseTimings['phase3_postprocess']}ms`);

    // ── Phase 4: Quality Validation & E-E-A-T ──────────────────────────────
    const endPhase4 = this.startPhaseTimer('phase4_quality');
    this.log('Phase 4: Quality Validation & E-E-A-T Assessment...');

    const wordCount = this.countWordsFromHtml(html);
    const qualityScore = calculateQualityScore(html, keyword, serpAnalysis);
    const contentAnalysis = analyzeContent(html, keyword);

    let eeatScore: EEATProfile | undefined;
    if (options.validateEEAT !== false) {
      const eeatResult = this.eeatValidator.validateContent(html, {
        name: this.config.authorName,
        credentials: this.config.authorCredentials ? [this.config.authorCredentials] : [],
      });
      eeatScore = {
        overall: eeatResult.overall,
        experience: eeatResult.experience,
        expertise: eeatResult.expertise,
        authoritativeness: eeatResult.authoritativeness,
        trustworthiness: eeatResult.trustworthiness,
      };
      this.log(`E-E-A-T: ${eeatResult.overall}% overall`);
    }

    endPhase4();
    this.log(`Phase 4 complete in ${this.telemetry.phaseTimings['phase4_quality']}ms`);

    // ── Phase 5: Schema, Metadata & Final Assembly ─────────────────────────
    const endPhase5 = this.startPhaseTimer('phase5_schema');
    this.log('Phase 5: Schema & Metadata generation...');

    let schema: SchemaMarkup | undefined;
    if (options.generateSchema !== false) {
      try {
        schema = this.schemaGenerator.generate({
          type: options.contentType === 'how-to' ? 'HowTo' : 'Article',
          title,
          description: serpAnalysis.userIntent ?? `Complete guide to ${keyword}`,
          keywords: [keyword, ...(serpAnalysis.semanticEntities?.slice(0, 5) ?? [])],
          authorName: this.config.authorName,
          organizationName: this.config.organizationName,
          organizationUrl: this.config.organizationUrl,
          wordCount,
        });
        this.log('Schema: ✅ Generated');
      } catch (e) {
        this.warn(`Schema generation failed (non-fatal): ${e}`);
      }
    }

    // Build SEO title & meta description
    const seoTitle =
      title.length <= 60
        ? title
        : title.slice(0, 57) + '...';

    const metaDescription =
      serpAnalysis.userIntent
        ? `${serpAnalysis.userIntent.slice(0, 150)}...`
        : `Complete guide to ${keyword}. Expert tips, strategies, and actionable advice.`;

    const slug = this.generateSlug(title);

    // Internal links for audit
    const internalLinks: InternalLink[] = (html.match(/<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi) ?? [])
      .slice(0, 20)
      .map((match) => {
        const hrefMatch = match.match(/href="([^"]+)"/i);
        const anchorMatch = match.match(/>([^<]+)<\/a>/i);
        return {
          anchorText: anchorMatch?.[1] ?? '',
          anchor: anchorMatch?.[1] ?? '',
          targetUrl: hrefMatch?.[1] ?? '',
          context: '',
        };
      })
      .filter((l) => l.targetUrl);

    endPhase5();
    this.log(`Phase 5 complete in ${this.telemetry.phaseTimings['phase5_schema']}ms`);

    // ── Final Assembly ─────────────────────────────────────────────────────
    const totalTime = Object.values(this.telemetry.phaseTimings).reduce((a, b) => a + b, 0);
    this.log(`✅ Generation complete — ${wordCount} words in ${Math.round(totalTime / 1000)}s`);
    this.log(`Telemetry: NW attempts=${this.telemetry.neuronWriterAttempts}, NW score=${this.telemetry.neuronWriterFinalScore}, continuations=${this.telemetry.continuationRounds}, links=${this.telemetry.internalLinksInjected}, VB fixes=${this.telemetry.visualBreakViolationsFixed}`);

    if (this.telemetry.warnings.length > 0) {
      this.log(`Warnings (${this.telemetry.warnings.length}): ${this.telemetry.warnings.slice(0, 5).join(' | ')}`);
    }

    const result: GeneratedContent = {
      id: crypto.randomUUID(),
      title,
      seoTitle,
      content: html,
      metaDescription,
      slug,
      primaryKeyword: keyword,
      secondaryKeywords: serpAnalysis.semanticEntities?.slice(0, 10) ?? [],
      metrics: {
        wordCount,
        readabilityScore: contentAnalysis.readabilityScore ?? 75,
        keywordDensity: contentAnalysis.keywordDensity ?? 1.5,
        headingCount: contentAnalysis.headingCount ?? 0,
        paragraphCount: contentAnalysis.paragraphCount ?? 0,
        sentenceCount: contentAnalysis.sentenceCount ?? 0,
      } as ContentMetrics,
      qualityScore: {
        overall: qualityScore.overall,
        readability: qualityScore.readability,
        seo: qualityScore.seo,
        eeat: eeatScore?.overall ?? qualityScore.eeat,
        uniqueness: qualityScore.uniqueness,
        factAccuracy: qualityScore.factAccuracy,
      } as QualityScore,
      internalLinks,
      schema,
      serpAnalysis,
      neuronWriterAnalysis: neuronBundle?.analysis
        ? {
            queryid: neuronBundle.queryId,
            keyword: neuronBundle.analysis.keyword ?? keyword,
            status: neuronBundle.analysis.status ?? 'ready',
            terms: neuronBundle.analysis.terms ?? [],
            termsExtended: neuronBundle.analysis.termsExtended ?? [],
            entities: neuronBundle.analysis.entities as any,
            headingsH2: neuronBundle.analysis.headingsH2 as any,
            headingsH3: neuronBundle.analysis.headingsH3 as any,
            recommendedlength: neuronBundle.analysis.recommended_length ?? 2500,
            contentscore: this.telemetry.neuronWriterFinalScore,
          }
        : undefined,
      neuronWriterQueryId: neuronBundle?.queryId,
      generatedAt: new Date(),
      model,
      telemetry: this.telemetry,
    };

    generationCache.set(cacheKey, result);
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FALLBACK SERP ANALYSIS
  // ─────────────────────────────────────────────────────────────────────────

  private getFallbackSERPAnalysis(keyword: string): SERPAnalysis {
    return {
      keyword,
      topCompetitors: [],
      avgWordCount: 2500,
      recommendedWordCount: 3000,
      contentGaps: [],
      semanticEntities: [],
      userIntent: `Complete guide to ${keyword}`,
      topQuestions: [],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────────────────

export function createOrchestrator(config: OrchestratorConfig): EnterpriseContentOrchestrator {
  return new EnterpriseContentOrchestrator(config);
}

export default EnterpriseContentOrchestrator;

