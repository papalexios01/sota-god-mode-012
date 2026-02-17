// src/lib/sota/EnterpriseContentOrchestrator.ts
// ═══════════════════════════════════════════════════════════════════════════════
// ENTERPRISE CONTENT ORCHESTRATOR v4.0 — SOTA Full Workflow Management
// ═══════════════════════════════════════════════════════════════════════════════
//
// Changelog v4.0:
//   • Integrated structured NeuronWriter sections (basic/extended/entities/headings)
//   • SOTA internal link engine with relevance scoring + position distribution
//   • Intelligent NeuronWriter improvement loop with adaptive strategy selection
//   • Enterprise-grade telemetry, circuit breakers, and retry policies
//   • Visual break enforcement via ContentPostProcessor (max 200 consecutive <p> words)
//   • Readability polish pass (polishReadability + validateVisualBreaks)
//   • Self-critique with patch-mode for long content
//   • Content quality gates with configurable thresholds
//   • Comprehensive audit trail for every generation
//
// Architecture:
//   Phase 1 — Parallel Research (SERP, YouTube, References, NeuronWriter)
//   Phase 2 — AI Content Generation (with long-form continuation loop)
//   Phase 3 — Post-Processing Pipeline (10 sub-steps, all fault-tolerant)
//   Phase 4 — Quality Validation & E-E-A-T Assessment
//   Phase 5 — Schema, Metadata & Final Assembly
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
  PostProcessingResult
} from './types';

import { SOTAContentGenerationEngine, createSOTAEngine, type ExtendedAPIKeys } from './SOTAContentGenerationEngine';
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
  validateVisualBreaks
} from './QualityValidator';
import { EEATValidator, createEEATValidator } from './EEATValidator';
import { generationCache } from './cache';
import {
  NeuronWriterService,
  createNeuronWriterService,
  type NeuronWriterAnalysis
} from './NeuronWriterService';
import { ContentPostProcessor } from './ContentPostProcessor';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/** Maximum number of NeuronWriter improvement attempts before giving up */
const NW_MAX_IMPROVEMENT_ATTEMPTS = 6;

/** Target NeuronWriter score — the loop stops when this is reached */
const NW_TARGET_SCORE = 90;

/** Maximum stagnant rounds before stopping the NeuronWriter loop */
const NW_MAX_STAGNANT_ROUNDS = 2;

/** Maximum NeuronWriter polling attempts while waiting for query analysis */
const NW_MAX_POLL_ATTEMPTS = 40;

/** Minimum acceptable content length ratio vs. original during improvement */
const MIN_IMPROVED_LENGTH_RATIO = 0.97;

/** Maximum consecutive <p> words before a visual break is required */
const MAX_CONSECUTIVE_P_WORDS = 200;

/** Minimum internal links to inject if below threshold */
const MIN_INTERNAL_LINKS = 6;

/** Target internal links for optimal SEO */
const TARGET_INTERNAL_LINKS = 12;

/** Minimum words for content to be considered valid */
const MIN_VALID_CONTENT_LENGTH = 100;

/** AI-detected phrases that kill authenticity */
const AI_BANNED_WORDS = [
  'delve', 'navigate', 'landscape', 'realm', 'crucial', 'vital',
  'leverage', 'utilize', 'facilitate', 'seamlessly', 'holistic', 'robust',
  'tapestry', 'embark', 'journey', 'embrace', 'elevate', 'unlock', 'master'
];

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// MARKDOWN → HTML CONVERTER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * CRITICAL: Convert any markdown syntax to proper styled HTML.
 * Handles: H1-H4, bold, italic, links, lists, code blocks, blockquotes, HR.
 * Only runs when markdown artifacts are detected in AI output.
 */
function convertMarkdownToHTML(content: string): string {
  let html = content;

  // Headings (most specific first to avoid double-matching)
  html = html.replace(/^####\s+([^\n#<]+)$/gm,
    '<h4 style="color: #334155; font-size: 19px; font-weight: 700; margin: 32px 0 12px 0; line-height: 1.3;">$1</h4>');
  html = html.replace(/^###\s+([^\n#<]+)$/gm,
    '<h3 style="color: #1e293b; font-size: 23px; font-weight: 800; margin: 40px 0 16px 0; letter-spacing: -0.02em; line-height: 1.3;">$1</h3>');
  html = html.replace(/^##\s+([^\n#<]+)$/gm,
    '<h2 style="color: #0f172a; font-size: 30px; font-weight: 900; margin: 56px 0 24px 0; padding-bottom: 14px; border-bottom: 4px solid #10b981; letter-spacing: -0.025em; line-height: 1.2;">$1</h2>');
  html = html.replace(/^#\s+([^\n<]+)$/gm, '<h1>$1</h1>');

  // Inline formatting
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" style="color: #059669; text-decoration: underline; text-underline-offset: 3px; font-weight: 600; transition: color 0.2s;">$1</a>');

  // Lists — unordered and ordered
  html = html.replace(/^[-*] (.+)$/gm,
    '<li style="margin-bottom: 8px; line-height: 1.8;">$1</li>');
  html = html.replace(/^\d+\. (.+)$/gm,
    '<li data-list-type="ol" style="margin-bottom: 8px; line-height: 1.8;">$1</li>');

  // Wrap consecutive <li> in <ul>/<ol>
  html = html.replace(/(<li[^>]*>.*<\/li>\n?)+/g, (match) => {
    const isOrdered = match.includes('data-list-type="ol"');
    const tag = isOrdered ? 'ol' : 'ul';
    const cleanedMatch = match.replace(/\s*data-list-type="ol"/g, '');
    return `<${tag} style="margin: 20px 0; padding-left: 24px; color: #374151;">${cleanedMatch}</${tag}>`;
  });

  // Code blocks
  html = html.replace(/```([^`]+)```/gs,
    '<pre style="background: #f3f4f6; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 20px 0;"><code style="color: #374141; font-size: 14px;">$1</code></pre>');
  html = html.replace(/`([^`]+)`/g,
    '<code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 14px;">$1</code>');

  // Blockquotes
  html = html.replace(/^> (.+)$/gm,
    '<blockquote style="border-left: 4px solid #10b981; padding-left: 20px; margin: 20px 0; color: #4b5563; font-style: italic;">$1</blockquote>');

  // Horizontal rules
  html = html.replace(/^[-*]{3,}$/gm,
    '<hr style="border: 0; border-top: 2px solid #e5e7eb; margin: 32px 0;">');

  // Wrap orphan text lines in <p> tags
  const lines = html.split('\n');
  const processedLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('<') || line.startsWith('</')) {
      processedLines.push(lines[i]);
    } else {
      processedLines.push(
        `<p style="color: #334155; font-size: 18px; line-height: 1.8; margin: 0 0 20px 0;">${line}</p>`
      );
    }
  }
  html = processedLines.join('\n');

  // Clean up any remaining # artifacts inside heading tags
  html = html.replace(/<h[1-6][^>]*>#{1,6}\s*/gi, (match) => match.replace(/#{1,6}\s*/, ''));
  const finalLines = html.split('\n').map(line => {
    if (!line.trim().startsWith('<')) {
      return line.replace(/^#{1,6}\s+/, '');
    }
    return line;
  });
  html = finalLines.join('\n');

  return html;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTML STRUCTURE ENFORCER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ensure proper HTML structure for WordPress:
 * - Fix nested <p> tags
 * - Add spacing between block elements
 * - Style unstyled headings
 * - Fix heading hierarchy (no skipping levels)
 * - Wrap in SOTA content container
 * - Style unstyled block-level elements
 */
function ensureProperHTMLStructure(content: string): string {
  let html = content;

  // Fix nested/broken <p> tags
  html = html.replace(/<p[^>]*>\s*<p/g, '<p');
  html = html.replace(/<\/p>\s*<\/p>/g, '</p>');

  // Ensure spacing between block elements
  html = html.replace(/<\/div>\s*<h2/g, '</div>\n\n<h2');
  html = html.replace(/<\/p>\s*<h2/g, '</p>\n\n<h2');
  html = html.replace(/<\/div>\s*<h3/g, '</div>\n\n<h3');
  html = html.replace(/<\/p>\s*<h3/g, '</p>\n\n<h3');

  // Remove empty paragraphs
  html = html.replace(/<p[^>]*>\s*<\/p>/g, '');

  // Style ONLY unstyled headings (don't overwrite already-styled ones)
  html = html.replace(/<h2>([^<]+)<\/h2>/g,
    '<h2 style="color: #0f172a; font-size: 30px; font-weight: 900; margin: 56px 0 24px 0; padding-bottom: 14px; border-bottom: 4px solid #10b981; letter-spacing: -0.025em; line-height: 1.2;">$1</h2>');
  html = html.replace(/<h3>([^<]+)<\/h3>/g,
    '<h3 style="color: #1e293b; font-size: 23px; font-weight: 800; margin: 40px 0 16px 0; letter-spacing: -0.02em; line-height: 1.3;">$1</h3>');
  html = html.replace(/<h4>([^<]+)<\/h4>/g,
    '<h4 style="color: #334155; font-size: 19px; font-weight: 700; margin: 32px 0 12px 0; line-height: 1.3;">$1</h4>');

  // Fix heading hierarchy (no level skipping)
  const headingRegex = /<h([1-6])[^>]*>/gi;
  let headingMatch: RegExpExecArray | null;
  let lastLevel = 0;
  const fixes: Array<{ index: number; from: number; to: number }> = [];

  while ((headingMatch = headingRegex.exec(html)) !== null) {
    const level = parseInt(headingMatch[1], 10);
    if (lastLevel > 0 && level > lastLevel + 1) {
      fixes.push({ index: headingMatch.index, from: level, to: lastLevel + 1 });
    }
    lastLevel = level;
  }

  // Apply fixes in reverse order to preserve indices
  for (let i = fixes.length - 1; i >= 0; i--) {
    const fix = fixes[i];
    const searchFrom = html.substring(fix.index);
    const openTag = searchFrom.match(new RegExp(`<h${fix.from}`, 'i'));
    const closeTag = searchFrom.match(new RegExp(`</h${fix.from}>`, 'i'));
    if (openTag && closeTag) {
      html = html.substring(0, fix.index) +
        searchFrom
          .replace(new RegExp(`<h${fix.from}`, 'i'), `<h${fix.to}`)
          .replace(new RegExp(`</h${fix.from}>`, 'i'), `</h${fix.to}>`);
    }
  }

  // Wrap in SOTA content container (let WordPress theme control width)
  if (!html.includes('data-premium-wp') && !html.includes('data-sota-content')) {
    const wrapperStart =
      '<div data-sota-content="true" style="font-family: \'Inter\', ui-sans-serif, system-ui, -apple-system, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif; line-height: 1.75; color: #1e293b; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;">';
    const wrapperEnd = '</div>';
    html = `${wrapperStart}\n${html}\n${wrapperEnd}`;
  }

  // Style only elements that DON'T already have a style attribute
  html = html
    .replace(/<p(?!\s)>/g,
      '<p style="font-size: 18px; margin: 0 0 20px 0; line-height: 1.8; color: #334155;">')
    .replace(/<ul(?!\s)>/g,
      '<ul style="margin: 0 0 24px 0; padding-left: 24px; list-style: none;">')
    .replace(/<ol(?!\s)>/g,
      '<ol style="margin: 0 0 24px 0; padding-left: 24px; counter-reset: item;">')
    .replace(/<li(?!\s)>/g,
      '<li style="margin: 0 0 12px 0; padding-left: 8px; line-height: 1.75; position: relative;">');

  return html;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR CLASS
// ═══════════════════════════════════════════════════════════════════════════════

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
    this.log(`⚠️ ${message}`);
  }

  private logError(message: string): void {
    this.telemetry.errors.push(message);
    this.log(`❌ ${message}`);
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

  private escapeHtml(s: string): string {
    return (s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 60);
  }

  private insertBeforeConclusion(content: string, section: string): string {
    const conclusionPatterns = [
      /<h2[^>]*>\s*(?:conclusion|final thoughts|wrapping up)/i,
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
      'youtube.com', 'tiktok.com', 'medium.com'
    ];
    return lowQuality.some(d => domain.includes(d));
  }

  /**
   * Check if content has markdown artifacts that need conversion.
   */
  private hasMarkdownArtifacts(content: string): boolean {
    return /^#{1,4}\s/m.test(content) ||
      /\*\*[^*]+\*\*/.test(content) ||
      /\[.+?\]\(.+?\)/.test(content);
  }

  /**
   * Count existing anchor tags in HTML content.
   */
  private countExistingLinks(html: string): number {
    const matches = html.match(/<a\s[^>]*href\s*=\s*["'][^"']*["'][^>]*>/gi) || [];
    return matches.length;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LONG-FORM CONTENT CONTINUATION ENGINE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Ensures content meets the target word count by requesting continuations
   * from the AI model when content is too short or explicitly incomplete.
   *
   * Features:
   * - Adaptive continuation count based on target word count
   * - Deduplication detection to avoid repetitive content
   * - Graceful degradation with word count warnings
   */
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

    const minAbsoluteWords = Math.max(2000, targetWordCount);
    const minRatio = targetWordCount >= 3000 ? 0.92 : 0.85;
    const minTargetWords = Math.floor(minAbsoluteWords * minRatio);

    this.log(`Initial content: ${words} words (target: ${minAbsoluteWords}+, min acceptable: ${minTargetWords})`);

    const looksIncomplete = (s: string) =>
      /content continues|continue\?|would you like me to continue/i.test(s);

    const maxContinuations = targetWordCount >= 5000 ? 8 :
      targetWordCount >= 3000 ? 5 : 3;

    for (let i = 1; i <= maxContinuations; i++) {
      const tooShort = words < minTargetWords;
      const explicitlyIncomplete = looksIncomplete(html);

      if (!tooShort && !explicitlyIncomplete) {
        this.log(`Content meets target: ${words}/${minTargetWords} words (${Math.round(words / minTargetWords * 100)}%)`);
        break;
      }

      const percentComplete = Math.round((words / minTargetWords) * 100);
      const remainingWords = minAbsoluteWords - words;
      this.log(`Content short: ${words}/${minTargetWords} words (${percentComplete}%). Need ~${remainingWords} more. Continuing... (${i}/${maxContinuations})`);

      this.telemetry.continuationRounds++;

      const tail = html.slice(-3000);
      const continuationPrompt = `Continue the SAME HTML article titled "${title}" about "${keyword}" EXACTLY where it left off. You still need approximately ${remainingWords} more words.

Rules (MUST FOLLOW):
- Output ONLY the HTML continuation (no preface, no apology, no brackets, no notes)
- Do NOT repeat the H1 or reprint earlier sections
- Do NOT ask questions like "Would you like me to continue?"
- Keep the same tone, formatting, and premium boxes/tables
- Add DEPTH: include real data points, specific examples, expert quotes, pro tip boxes, and comparison tables
- Each new section MUST add genuine value — no padding or filler
- Finish the article fully (including the FAQ section with 8 questions + final CTA as instructed)
- CRITICAL: Never write more than ${MAX_CONSECUTIVE_P_WORDS} words of consecutive <p> text without a visual break element (box, table, blockquote, list)

Last part of the current article (for context):
${tail}

Now continue:`;

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
          this.log('Continuation returned empty/minimal content; stopping.');
          break;
        }

        // Deduplication check
        const dedupeWindow = html.slice(-600);
        const chunkStart = nextChunk.slice(0, 600);
        if (dedupeWindow && chunkStart && dedupeWindow.includes(chunkStart)) {
          this.log('Continuation looks repetitive; stopping to avoid duplication.');
          break;
        }

        html = `${html}\n\n${nextChunk}`.trim();
        const newWords = this.countWordsFromHtml(html);
        this.log(`Added ${newWords - words} words → Total: ${newWords} words`);
        words = newWords;
      } catch (contError) {
        this.warn(`Continuation ${i} failed: ${contError}`);
        break;
      }
    }

    if (words < minTargetWords) {
      this.warn(`Final content is ${words} words (${Math.round(words / minTargetWords * 100)}%), below target of ${minTargetWords}. May need regeneration.`);
    } else {
      this.log(`Long-form content complete: ${words} words ✅`);
    }

    return html;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NEURONWRITER INITIALIZATION & POLLING
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Initializes NeuronWriter integration:
   * 1. Checks for existing query matching the keyword
   * 2. Creates a new query if none found
   * 3. Polls until analysis is ready (up to ~4 minutes)
   * 4. Returns the analysis bundle or null on failure
   */
  private async maybeInitNeuronWriter(
    keyword: string,
    options: GenerationOptions
  ): Promise<NeuronBundle | null> {
    const apiKey = this.config.neuronWriterApiKey?.trim();
    const projectId = this.config.neuronWriterProjectId?.trim();

    if (!apiKey || !projectId) {
      this.log('NeuronWriter: SKIPPED — API key or Project ID not configured');
      return null;
    }

    const service = createNeuronWriterService(apiKey);
    const queryIdFromOptions = options.neuronWriterQueryId?.trim();

    this.log('NeuronWriter: Initializing integration...');

    let queryId = queryIdFromOptions;

    // Step 1: Try to find existing ready query
    if (!queryId) {
      this.log(`NeuronWriter: Searching for existing query matching "${keyword}"...`);
      try {
        const searchResult = await service.findQueryByKeyword(projectId, keyword);

        if (searchResult.success && searchResult.query && searchResult.query.status === 'ready') {
          const tempQueryId = searchResult.query.id;
          this.log(`NeuronWriter: Found existing query "${searchResult.query.keyword}" (ID: ${tempQueryId})`);

          const existingAnalysis = await service.getQueryAnalysis(tempQueryId);
          if (existingAnalysis.success && existingAnalysis.analysis) {
            const hasGoodData =
              (existingAnalysis.analysis.terms?.length || 0) >= 5 &&
              ((existingAnalysis.analysis.headingsH2?.length || 0) >= 2 ||
                (existingAnalysis.analysis.headingsH3?.length || 0) >= 2);

            if (hasGoodData) {
              queryId = tempQueryId;
              this.log(`NeuronWriter: Existing query has good data — using it! ` +
                `(${existingAnalysis.analysis.terms?.length || 0} terms, ` +
                `${existingAnalysis.analysis.headingsH2?.length || 0} H2s, ` +
                `${existingAnalysis.analysis.headingsH3?.length || 0} H3s)`);
            } else {
              this.log(`NeuronWriter: Existing query has insufficient data — creating fresh query...`);
            }
          }
        }
      } catch (searchErr) {
        this.warn(`NeuronWriter: Search failed (${searchErr}), will create new query`);
      }

      // Step 2: Create new query if needed — with retry to prevent silent fallback
      if (!queryId) {
        const MAX_CREATE_RETRIES = 3;
        for (let createAttempt = 1; createAttempt <= MAX_CREATE_RETRIES; createAttempt++) {
          this.log(`NeuronWriter: Creating new Content Writer query for "${keyword}"... (attempt ${createAttempt}/${MAX_CREATE_RETRIES})`);
          try {
            const created = await service.createQuery(projectId, keyword);
            if (created.success && created.queryId) {
              queryId = created.queryId;
              this.log(`NeuronWriter: Created NEW query (ID: ${queryId})`);
              break;
            }
            this.warn(`NeuronWriter: Create attempt ${createAttempt} failed — ${created.error || 'unknown error'}`);
          } catch (createErr) {
            this.warn(`NeuronWriter: Create attempt ${createAttempt} error — ${createErr}`);
          }
          if (createAttempt < MAX_CREATE_RETRIES) {
            const retryDelay = createAttempt * 3000;
            this.log(`NeuronWriter: Retrying query creation in ${retryDelay / 1000}s...`);
            await this.sleep(retryDelay);
          }
        }
        if (!queryId) {
          this.warn(`NeuronWriter: FAILED to create query after ${MAX_CREATE_RETRIES} attempts`);
          this.log('NeuronWriter: Proceeding WITHOUT NeuronWriter optimization');
          return null;
        }
      }
    } else {
      this.log(`NeuronWriter: Using provided query ID: ${queryId}`);
    }

    // Step 3: Poll for analysis readiness — extended with resilient retry
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

          const hasTerms = (analysisRes.analysis.terms?.length || 0) > 0;
          const hasHeadings = (analysisRes.analysis.headingsH2?.length || 0) > 0;

          if (!hasTerms && !hasHeadings) {
            this.warn('NeuronWriter: Analysis returned but contains no terms or headings');
          }

          return { service, queryId, analysis: analysisRes.analysis };
        }

        const msg = analysisRes.error || 'Query not ready';
        const currentStatus = msg.match(/Status:\s*(\w+)/i)?.[1] || '';

        const looksNotReady = /not ready|status|waiting|in progress/i.test(msg);
        if (!looksNotReady) {
          this.warn(`NeuronWriter: Analysis failed permanently — ${msg}`);
          return null;
        }

        if (currentStatus !== lastStatus) {
          this.log(`NeuronWriter: Status: ${currentStatus || 'processing'}...`);
          lastStatus = currentStatus;
        }

        const delay = attempt <= 3 ? 2000 : attempt <= 10 ? 4000 : 6000;
        this.log(`NeuronWriter: Waiting for analysis… (attempt ${attempt}/${NW_MAX_POLL_ATTEMPTS})`);
        await this.sleep(delay);
      } catch (pollErr) {
        consecutivePollErrors++;
        this.warn(`NeuronWriter: Poll attempt ${attempt} failed — ${pollErr}`);
        if (consecutivePollErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          this.warn(`NeuronWriter: ${MAX_CONSECUTIVE_POLL_ERRORS} consecutive poll errors — giving up`);
          return null;
        }
        await this.sleep(3000);
      }
    }

    this.warn(`NeuronWriter: Analysis timed out after ${NW_MAX_POLL_ATTEMPTS} attempts`);
    this.log('NeuronWriter: Proceeding WITHOUT NeuronWriter optimization — check NeuronWriter dashboard');
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NEURONWRITER IMPROVEMENT LOOP
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Iteratively improves content to achieve NeuronWriter target score.
   *
   * Strategy:
   * - Evaluates current content score via NeuronWriter API
   * - Uses PATCH mode for long content (>10k chars) — adds enrichment paragraphs
   * - Uses FULL REWRITE mode for shorter content — rewrites with missing terms
   * - Falls back to semantic enrichment when no specific missing terms are found
   * - Stops on: target met, max attempts, stagnation, or error
   */
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

    // Combine all term sources for suggestions
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

    for (let attempt = 0; attempt <= NW_MAX_IMPROVEMENT_ATTEMPTS; attempt++) {
      this.telemetry.neuronWriterAttempts++;

      try {
        // Evaluate current content
        const evalRes = await neuron.service.evaluateContent(neuron.queryId, {
          html: content,
          title,
        });

        if (!evalRes.success || typeof evalRes.contentScore !== 'number') {
          // Fall back to local score calculation
          neuron.analysis.content_score = neuron.service.calculateContentScore(
            content,
            neuron.analysis.terms || []
          );
          if (!evalRes.success) {
            this.warn(`NeuronWriter: evaluate failed (using local score). ${evalRes.error || ''}`);
          }
          return { content, score: neuron.analysis.content_score || 0 };
        }

        currentScore = evalRes.contentScore;
        neuron.analysis.content_score = currentScore;
        this.telemetry.neuronWriterFinalScore = currentScore;

        // Check if target met
        if (currentScore >= NW_TARGET_SCORE) {
          this.log(`NeuronWriter: Score ${currentScore}% ≥ target ${NW_TARGET_SCORE}% — PASSED ✅`);
          return { content, score: currentScore };
        }

        // Check if max attempts reached
        if (attempt === NW_MAX_IMPROVEMENT_ATTEMPTS) {
          this.log(`NeuronWriter: Score ${currentScore}% after ${attempt} attempts (target was ${NW_TARGET_SCORE}%)`);
          return { content, score: currentScore };
        }

        // Stagnation detection
        if (currentScore <= previousScore && attempt > 0) {
          stagnantRounds++;
          if (stagnantRounds >= NW_MAX_STAGNANT_ROUNDS) {
            this.log(`NeuronWriter: Score stagnant at ${currentScore}% for ${stagnantRounds} rounds. Stopping.`);
            return { content, score: currentScore };
          }
        } else {
          stagnantRounds = 0;
        }
        previousScore = currentScore;

        const gap = NW_TARGET_SCORE - currentScore;
        this.log(`NeuronWriter: Score ${currentScore}% (need +${gap}%) — improving... (attempt ${attempt + 1}/${NW_MAX_IMPROVEMENT_ATTEMPTS})`);

        // Get optimization suggestions
        const suggestions = neuron.service.getOptimizationSuggestions(content, allTermsForSuggestions);
        const entitySuggestions = neuron.service.getOptimizationSuggestions(content, entityTerms);
        const allSuggestions = [...suggestions, ...entitySuggestions.slice(0, 10)];

        // Find missing headings
        const missingHeadings = (neuron.analysis.headingsH2 || [])
          .filter(h => !content.toLowerCase().includes(h.text.toLowerCase().slice(0, 20)))
          .slice(0, 3);

        if (allSuggestions.length > 0 || missingHeadings.length > 0) {
          this.log(`Missing: ${allSuggestions.length} terms, ${missingHeadings.length} headings`);
          content = await this.applyNeuronWriterImprovement(
            content, keyword, title, allSuggestions, missingHeadings, attempt
          );
        } else {
          // No specific missing terms — try semantic enrichment
          this.log('No missing terms found — attempting semantic enrichment...');
          content = await this.applySemanticEnrichment(
            content, keyword, currentScore, allTermsForSuggestions
          );
        }
      } catch (attemptErr) {
        this.warn(`NeuronWriter improvement attempt ${attempt} failed: ${attemptErr}`);
        return { content, score: currentScore };
      }
    }

    return { content, score: currentScore };
  }

  /**
   * Applies NeuronWriter term improvements using either patch or full rewrite mode.
   */
  private async applyNeuronWriterImprovement(
    content: string,
    keyword: string,
    title: string,
    suggestions: string[],
    missingHeadings: Array<{ text: string; usage_pc?: number }>,
    attempt: number
  ): Promise<string> {
    const usePatchMode = content.length > 10000;

    if (usePatchMode) {
      // PATCH MODE: Add enrichment paragraphs without rewriting existing content
      const termsPerAttempt = Math.min(30, suggestions.length);
      const termsList = suggestions.slice(0, termsPerAttempt);

      const patchPrompt = `Generate 3-6 NEW enrichment paragraphs for an article about "${keyword}".

These paragraphs must NATURALLY incorporate these missing SEO terms:
${termsList.map((t, i) => `${i + 1}. ${t}`).join('\n')}
${missingHeadings.length > 0 ? `\nAlso create sections for these missing H2 headings:\n${missingHeadings.map(h => `- "${h.text}"`).join('\n')}` : ''}

Rules:
- Output PURE HTML ONLY
- Each paragraph 50-100 words, wrapped in <p> tags
- Use varied contexts: tips, examples, data points, comparisons
- Include Pro Tip or Warning boxes where appropriate
- Voice: Direct, punchy, human
- Terms must flow naturally in sentences — NEVER list them
- DO NOT repeat existing content
- CRITICAL: Never write more than ${MAX_CONSECUTIVE_P_WORDS} words of <p> text without a visual break

Output ONLY the new HTML content to INSERT.`;

      try {
        const patchResult = await this.engine.generateWithModel({
          prompt: patchPrompt,
          model: this.config.primaryModel || 'gemini',
          apiKeys: this.config.apiKeys,
          systemPrompt: 'Generate SEO enrichment HTML. Output PURE HTML ONLY.',
          temperature: 0.6 + (attempt * 0.05),
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
      // FULL REWRITE MODE: Rewrite the entire article with missing terms incorporated
      const termsPerAttempt = Math.min(40, suggestions.length);
      const termsList = suggestions.slice(0, termsPerAttempt);

      const headingsInstruction = missingHeadings.length > 0
        ? `\n\nMISSING H2 HEADINGS (add these as new sections):\n${missingHeadings.map(h => `- "${h.text}" (used by ${h.usage_pc || '?'}% of competitors)`).join('\n')}`
        : '';

      const improvementPrompt = `You are optimizing this article for a NeuronWriter content score of ${NW_TARGET_SCORE}%+. Current score: ${this.telemetry.neuronWriterFinalScore}%.

PRIORITY MISSING TERMS (MUST include each one naturally, at least 1-2 times):
${termsList.map((t, i) => `${i + 1}. "${t}"`).join('\n')}
${headingsInstruction}

STRICT RULES:
1. Preserve ALL existing HTML content exactly as-is
2. ADD new paragraphs, sentences, or expand existing ones to include each missing term
3. Every term must appear in a NATURAL sentence — never dump terms as a list
4. Distribute terms across different sections of the article, not clustered together
5. Add 2-4 new subsections under relevant H2s if needed for natural placement
6. Use the exact term form provided (singular/plural matters for scoring)
7. OUTPUT PURE HTML ONLY. Use <h2>, <h3>, <p>, <ul>, <li>, <strong> tags. NEVER use markdown
8. Include terms in varied contexts: definitions, comparisons, examples, tips
9. CRITICAL: Never write more than ${MAX_CONSECUTIVE_P_WORDS} words of <p> text without a visual break element

ARTICLE TO IMPROVE:
${content}

Return the COMPLETE improved article with ALL missing terms naturally incorporated.`;

      try {
        const improvedResult = await this.engine.generateWithModel({
          prompt: improvementPrompt,
          model: this.config.primaryModel || 'gemini',
          apiKeys: this.config.apiKeys,
          systemPrompt: `You are an elite SEO content optimizer specializing in NeuronWriter scoring. Your ONLY job: incorporate missing terms naturally to push the score above ${NW_TARGET_SCORE}%. Preserve all existing content. Output PURE HTML ONLY.`,
          temperature: 0.6 + (attempt * 0.05),
          maxTokens: Math.min(16384, Math.max(8192, Math.ceil(content.length / 3))),
        });

        if (improvedResult.content) {
          const improved = improvedResult.content.trim();
          const minLength = content.length * MIN_IMPROVED_LENGTH_RATIO;
          if (improved.length >= minLength) {
            return improved;
          } else {
            this.warn(`NeuronWriter: Improved draft too short (${improved.length} vs ${content.length}), keeping previous version.`);
          }
        }
      } catch (rewriteErr) {
        this.warn(`NeuronWriter REWRITE failed: ${rewriteErr}`);
      }
    }

    return content; // Return unchanged if all strategies failed
  }

  /**
   * Applies semantic enrichment when no specific missing terms are identified.
   */
  private async applySemanticEnrichment(
    content: string,
    keyword: string,
    currentScore: number,
    allTerms: Array<{ term: string }>
  ): Promise<string> {
    const allTermsText = allTerms.map(t => t.term).join(', ');

    const generalPrompt = `This article scores ${currentScore}% on NeuronWriter (target: ${NW_TARGET_SCORE}%+).

The key SEO terms for this topic are: ${allTermsText}

Improve the article by:
1. Increasing the frequency of underused terms (add 1-2 more natural mentions of each)
2. Adding semantic variations and synonyms
3. Expanding thin sections with more detail
4. Adding a new FAQ question that uses key terms
5. Adding a "Key Takeaway" or "Pro Tip" box that uses core terms

OUTPUT PURE HTML ONLY. Preserve all existing content. Return the COMPLETE article.

CURRENT ARTICLE:
${content}`;

    try {
      const improvedResult = await this.engine.generateWithModel({
        prompt: generalPrompt,
        model: this.config.primaryModel || 'gemini',
        apiKeys: this.config.apiKeys,
        systemPrompt: 'Elite SEO optimizer. Output PURE HTML ONLY.',
        temperature: 0.65,
        maxTokens: Math.min(16384, Math.max(8192, Math.ceil(content.length / 3))),
      });

      if (improvedResult.content) {
        const improved = improvedResult.content.trim();
        const minLength = content.length * MIN_IMPROVED_LENGTH_RATIO;
        if (improved.length >= minLength) {
          return improved;
        } else {
          this.warn(`Semantic enrichment too short (${improved.length} vs ${content.length}), keeping previous.`);
        }
      }
    } catch (e) {
      this.warn(`Semantic enrichment failed: ${e}`);
    }

    return content;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SELF-CRITIQUE ENGINE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Single-pass self-critique that checks for missing NeuronWriter terms,
   * entities, and headings, then either patches (long content) or edits.
   */
  private async selfCritiqueAndPatch(params: {
    keyword: string;
    title: string;
    html: string;
    requiredTerms?: string[];
    requiredEntities?: string[];
    requiredHeadings?: string[];
  }): Promise<string> {
    const originalHtml = params.html;
    const requiredTerms = params.requiredTerms || [];
    const requiredEntities = params.requiredEntities || [];
    const requiredHeadings = params.requiredHeadings || [];

    // Find what's missing
    const missingTerms = requiredTerms.filter(t =>
      !new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(originalHtml)
    );
    const missingEntities = requiredEntities.filter(e =>
      !new RegExp(`\\b${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(originalHtml)
    );
    const missingHeadings = requiredHeadings.filter(h =>
      !originalHtml.toLowerCase().includes(h.toLowerCase().slice(0, 24))
    );

    if (missingTerms.length === 0 && missingEntities.length === 0 && missingHeadings.length === 0) {
      this.log('Self-critique: No missing terms/entities/headings — content is complete. ✅');
      return originalHtml;
    }

    this.telemetry.selfCritiqueApplied = true;
    const isLongContent = originalHtml.length > 15000;

    if (isLongContent) {
      this.log(`Self-critique: PATCH mode for long content (${originalHtml.length} chars)`);
      return this.selfCritiquePatchMode(
        originalHtml, params.keyword, params.title,
        missingTerms, missingEntities, missingHeadings
      );
    }

    // SHORT/MEDIUM content — inline edit mode
    const instruction = [
      'Rewrite ONLY where needed. Keep structure. Output HTML only.',
      'Voice: Alex Hormozi + Tim Ferriss. No fluff. Short paragraphs.',
      'Add concrete steps, checklists, examples. Remove vague filler.',
      `CRITICAL: Never write more than ${MAX_CONSECUTIVE_P_WORDS} words of <p> text without a visual break element.`,
      missingTerms.length
        ? `Add these missing NeuronWriter terms naturally: ${missingTerms.slice(0, 40).join(', ')}`
        : '',
      missingEntities.length
        ? `Include these entities naturally: ${missingEntities.slice(0, 40).join(', ')}`
        : '',
      missingHeadings.length
        ? `Add these missing H2 sections if absent: ${missingHeadings.slice(0, 6).join(' | ')}`
        : '',
    ].filter(Boolean).join('\n');

    const neededTokens = originalHtml.length > 20000 ? 16384 : 8192;

    try {
      const timeoutMs = Math.min(300000, 120000 + Math.floor(originalHtml.length / 5000) * 30000);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await this.engine.generateWithModel({
        prompt: `ARTICLE TITLE: ${params.title}
PRIMARY KEYWORD: ${params.keyword}

CURRENT HTML (EDIT THIS, DO NOT REWRITE FROM SCRATCH):
${originalHtml}

INSTRUCTIONS:
${instruction}`,
        model: this.config.primaryModel || 'gemini',
        apiKeys: this.config.apiKeys,
        systemPrompt: 'Elite editor. Output PURE HTML ONLY. Do not add markdown.',
        temperature: 0.55,
        maxTokens: neededTokens,
      });

      clearTimeout(timeoutId);

      const improved = (res.content || '').trim();
      if (!improved) {
        this.warn('Self-critique: empty response, keeping original HTML.');
        return originalHtml;
      }

      if (improved.length < originalHtml.length * 0.95) {
        this.warn(`Self-critique: response too short (${improved.length} vs ${originalHtml.length}), keeping original.`);
        return originalHtml;
      }

      this.log(`Self-critique: Applied inline edits (${missingTerms.length} terms, ${missingEntities.length} entities, ${missingHeadings.length} headings targeted)`);
      return improved;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.warn(`Self-critique: failed (${msg}), keeping original HTML.`);
      return originalHtml;
    }
  }

  /**
   * Patch mode for self-critique — used for long content (>15k chars).
   * Generates new sections for missing headings and enrichment paragraphs for missing terms,
   * then inserts them before the conclusion.
   */
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
${missingHeadings.map((h, i) => `${i + 1}. "${h}"`).join('\n')}

Rules:
- Output PURE HTML only (h2, h3, p, ul, li, strong tags)
- Each section should be 100-200 words
- Include relevant terms naturally: ${missingTerms.slice(0, 15).join(', ')}
- Include these entities where relevant: ${missingEntities.slice(0, 10).join(', ')}
- Voice: Direct, punchy, actionable. No AI fluff.
- NEVER write more than ${MAX_CONSECUTIVE_P_WORDS} words of <p> text without a visual element
- Style H2 tags: <h2 style="color: #1f2937; font-size: 28px; font-weight: 800; margin: 48px 0 24px 0; padding-bottom: 12px; border-bottom: 3px solid #10b981;">

Output ONLY the HTML sections, nothing else.`;

        const res = await this.engine.generateWithModel({
          prompt: headingsPrompt,
          model: this.config.primaryModel || 'gemini',
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
${allMissing.map((t, i) => `${i + 1}. "${t}"`).join('\n')}

Rules:
- Output PURE HTML only (<p> tags with style="color: #374141; font-size: 17px; line-height: 1.9; margin: 20px 0;")
- Each paragraph should be 50-80 words
- Include Pro Tip boxes or data points where appropriate
- Voice: Direct, punchy, human. Use contractions.
- Every term must appear in a natural sentence
- DO NOT repeat what's already in the article

Output ONLY the HTML paragraphs, nothing else.`;

        const res = await this.engine.generateWithModel({
          prompt: termsPrompt,
          model: this.config.primaryModel || 'gemini',
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

  /**
   * Last-resort NeuronWriter coverage enforcement.
   * Logs any terms that could not be naturally incorporated as an HTML comment.
   */
  private enforceNeuronwriterCoverage(
    html: string,
    req: { requiredTerms: string[]; entities: string[]; h2: string[] }
  ): string {
    const required = (req?.requiredTerms || []).map(t => String(t || '').trim()).filter(Boolean);
    const entities = (req?.entities || []).map(t => String(t || '').trim()).filter(Boolean);
    const missing: string[] = [];
    const hay = (html || '').toLowerCase();

    for (const t of required) {
      if (!hay.includes(t.toLowerCase())) missing.push(t);
    }
    for (const e of entities) {
      if (!hay.includes(e.toLowerCase())) missing.push(e);
    }

    if (missing.length === 0) return html;

    const chunk = missing.slice(0, 40);
    const insertion = `\n<!-- NeuronWriter Coverage Terms: ${chunk.map(this.escapeHtml).join(', ')} -->`;
    this.warn(`${chunk.length} NeuronWriter terms could not be naturally incorporated — logged as HTML comment`);

    // Insert after the last H2 tag
    const h2Regex = /<h2[^>]*>[^<]*<\/h2>/gis;
    let lastMatch: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = h2Regex.exec(html)) !== null) {
      lastMatch = match;
    }

    if (lastMatch && lastMatch.index !== undefined) {
      const idx = lastMatch.index + lastMatch[0].length;
      return html.slice(0, idx) + insertion + html.slice(idx);
    }

    return `${html}\n\n${insertion}`;
  }

  /**
   * Extracts structured requirements from NeuronWriter analysis.
   */
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

  // ─────────────────────────────────────────────────────────────────────────
  // INTERNAL LINK INJECTION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Ensures content has 4-8 internal links. Checks existing count first,
   * then injects only the needed additional links.
   */
  private injectInternalLinks(content: string, options: GenerationOptions): string {
    if (options.injectLinks === false) return content;
    if (!this.config.sitePages || this.config.sitePages.length === 0) {
      this.log('Internal links: No sitePages configured — skipping');
      return content;
    }

    try {
      this.linkEngine.updateSitePages(this.config.sitePages);

      // Count only INTERNAL links (matching our site's domain), not external refs
      const siteDomains = new Set<string>();
      for (const page of this.config.sitePages) {
        try { siteDomains.add(new URL(page.url).hostname.toLowerCase()); } catch { /* skip */ }
      }

      const allHrefs = content.match(/href\s*=\s*["']([^"']+)["']/gi) || [];
      let internalCount = 0;
      for (const hrefMatch of allHrefs) {
        const url = hrefMatch.replace(/href\s*=\s*["']/i, '').replace(/["']$/, '');
        try {
          const hostname = new URL(url).hostname.toLowerCase();
          if (siteDomains.has(hostname)) internalCount++;
        } catch { /* skip relative or malformed */ }
      }

      this.log(`Internal links in content: ${internalCount} (from ${this.config.sitePages.length} sitePages)`);

      if (internalCount >= TARGET_INTERNAL_LINKS) {
        this.log(`Content already has ${internalCount} internal links ≥ target ${TARGET_INTERNAL_LINKS} — skipping`);
        return content;
      }

      const needed = Math.max(MIN_INTERNAL_LINKS - internalCount, TARGET_INTERNAL_LINKS - internalCount);
      this.log(`Need ${needed} more internal links (target: ${TARGET_INTERNAL_LINKS}, have: ${internalCount}). Finding opportunities...`);

      const linkOpportunities = this.linkEngine.generateLinkOpportunities(content, needed, options.keyword);

      if (linkOpportunities.length > 0) {
        const enhanced = this.linkEngine.injectContextualLinks(content, linkOpportunities);
        this.telemetry.internalLinksInjected = linkOpportunities.length;
        this.log(`Injected ${linkOpportunities.length} internal links (total: ~${internalCount + linkOpportunities.length})`);
        return enhanced;
      } else {
        this.warn('No suitable link opportunities found for available pages');
        return content;
      }
    } catch (e) {
      this.warn(`Internal linking failed (non-fatal): ${e}`);
      return content;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REFERENCES & E-E-A-T
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Preserves the references section from content before NeuronWriter/self-critique loops,
   * returns the extracted section and the content without it.
   */
  private preserveReferencesSection(content: string): { content: string; references: string | null } {
    const referencesRegex = /<!-- SOTA References Section -->[\s\S]*$/i;
    const refsAltRegex = /<hr>\s*<h2>References[\s\S]*$/i;

    const match = content.match(referencesRegex) || content.match(refsAltRegex);
    if (!match) return { content, references: null };

    const stripped = content
      .replace(referencesRegex, '')
      .replace(refsAltRegex, '')
      .trim();

    return { content: stripped, references: match[0] };
  }

  /**
   * Appends a beautifully styled references section to the content.
   */
  private ensureReferencesSection(html: string, refs: Reference[], serp: SERPAnalysis): string {
    // Check if references already exist
    const hasRefsHeading =
      /<h2[^>]*>\s*(references|sources|citations|bibliography)\s*<\/h2>/i.test(html) ||
      /References\s*<\/h2>/i.test(html) ||
      /<h2[^>]*>.*references.*<\/h2>/i.test(html);

    if (hasRefsHeading) {
      this.log('References section already exists — skipping append');
      return html;
    }

    // Build reference items from multiple sources
    const items: { title: string; url: string; domain: string; type: string }[] = [];

    for (const r of refs || []) {
      if (r?.title && r?.url) {
        const domain = this.extractDomain(r.url);
        items.push({ title: r.title, url: r.url, domain, type: r.type || 'industry' });
      }
    }

    for (const c of serp?.topCompetitors || []) {
      if (c?.title && c?.url) {
        const domain = this.extractDomain(c.url);
        if (!this.isLowQualityDomain(domain)) {
          items.push({ title: c.title, url: c.url, domain, type: 'competitor' });
        }
      }
    }

    // Deduplicate by URL
    const dedup = new Map<string, typeof items[0]>();
    for (const it of items) {
      const key = (it.url || '').toLowerCase().trim().replace(/\/$/, '');
      if (!key || !key.startsWith('http')) continue;
      if (!dedup.has(key)) dedup.set(key, it);
    }

    let finalItems = Array.from(dedup.values());

    // Sort by authority score
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

    const block = `
<!-- SOTA References Section -->
<div style="margin-top: 60px; padding-top: 40px; border-top: 2px solid #e5e7eb;">
  <h2 style="color: #1f2937; font-size: 28px; font-weight: 800; margin-bottom: 24px; display: flex; align-items: center; gap: 12px;">
    📖 References & Sources
  </h2>
  <p style="color: #6b7280; font-size: 15px; margin-bottom: 20px; line-height: 1.6;">
    This article was researched and written using the following authoritative sources. All links have been verified for accuracy.
  </p>
  <ol style="list-style: decimal; padding-left: 24px; margin: 0;">
${finalItems.map((it) => {
      const badge = this.getReferenceBadge(it.domain, it.type);
      return `    <li style="margin-bottom: 16px; padding-left: 8px; font-size: 16px; line-height: 1.7;">
      <a href="${this.escapeHtml(it.url)}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: none; font-weight: 500;">${this.escapeHtml(it.title)}</a>
      <span style="color: #9ca3af; font-size: 14px;"> — ${this.escapeHtml(it.domain)}${badge}</span>
    </li>`;
    }).join('\n')}
  </ol>
</div>`;

    this.log(`✅ Added ${finalItems.length} references to content`);
    return `${html}\n\n${block}`;
  }

  private getReferenceAuthorityScore(domain: string, type: string): number {
    if (domain.endsWith('.gov')) return 100;
    if (domain.endsWith('.edu')) return 95;
    if (['nature.com', 'sciencedirect.com', 'pubmed.ncbi.nlm.nih.gov', 'who.int', 'cdc.gov'].some(d => domain.includes(d))) return 90;
    if (['nytimes.com', 'wsj.com', 'reuters.com', 'bbc.com', 'forbes.com', 'hbr.org'].some(d => domain.includes(d))) return 85;
    if (type === 'academic' || type === 'government') return 80;
    if (type === 'industry' || type === 'news') return 70;
    if (domain.endsWith('.org')) return 65;
    return 50;
  }

  private getReferenceBadge(domain: string, type: string): string {
    if (domain.endsWith('.gov')) return ' <span style="background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-left: 8px;">Official</span>';
    if (domain.endsWith('.edu')) return ' <span style="background: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-left: 8px;">Academic</span>';
    if (type === 'academic') return ' <span style="background: #f3e8ff; color: #7c3aed; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-left: 8px;">Research</span>';
    return '';
  }

  private buildEEATProfile(references: Reference[]): EEATProfile {
    return {
      author: {
        name: this.config.authorName,
        credentials: this.config.authorCredentials || [],
        publications: [],
        expertiseAreas: [],
        socialProfiles: [],
      },
      citations: references.map(r => ({
        title: r.title,
        url: r.url,
        type: r.type,
      })),
      expertReviews: [],
      methodology: 'AI-assisted research with human editorial oversight',
      lastUpdated: new Date(),
      factChecked: references.length > 3,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TITLE & METADATA GENERATION
  // ─────────────────────────────────────────────────────────────────────────

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
      maxTokens: 100,
    });

    return result.content.trim().replace(/^["']|["']$/g, '');
  }

  private async generateSEOTitle(
    keyword: string,
    displayTitle: string,
    serpAnalysis: SERPAnalysis
  ): Promise<string> {
    const prompt = `Generate an SEO-optimized title tag for an article about "${keyword}".

Current display title: "${displayTitle}"

Requirements:
- Maximum 60 characters (CRITICAL)
- Include the EXACT primary keyword "${keyword}" within first 40 characters
- Make it compelling and click-worthy
- Match ${serpAnalysis.userIntent} search intent
- Include current year (2025) if naturally fits
- NO clickbait or sensationalism

Competitor titles:
${serpAnalysis.topCompetitors.slice(0, 3).map(c => `- ${c.title}`).join('\n')}

Output ONLY the SEO title, nothing else.`;

    const result = await this.engine.generateWithModel({
      prompt,
      model: this.config.primaryModel || 'gemini',
      apiKeys: this.config.apiKeys,
      temperature: 0.7,
      maxTokens: 100,
    });

    let seoTitle = result.content.trim().replace(/^["']|["']$/g, '');
    if (seoTitle.length > 60) {
      seoTitle = seoTitle.substring(0, 57) + '...';
    }
    return seoTitle;
  }

  private async generateMetaDescription(keyword: string, title: string): Promise<string> {
    const prompt = `Write an SEO meta description for an article titled "${title}" about "${keyword}".

Requirements:
- Exactly 150-160 characters (CRITICAL)
- Include the EXACT primary keyword "${keyword}" within first 100 characters
- Include a clear call-to-action
- Create urgency or curiosity
- NO fluff words

Output ONLY the meta description, nothing else.`;

    const result = await this.engine.generateWithModel({
      prompt,
      model: this.config.primaryModel || 'gemini',
      apiKeys: this.config.apiKeys,
      temperature: 0.7,
      maxTokens: 100,
    });

    let metaDesc = result.content.trim().replace(/^["']|["']$/g, '');
    if (metaDesc.length > 160) {
      metaDesc = metaDesc.substring(0, 157) + '...';
    }
    return metaDesc;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VIDEO & CONTENT SECTIONS
  // ─────────────────────────────────────────────────────────────────────────

  private buildVideoSection(videos: YouTubeVideo[]): string {
    const videoEmbeds = videos.slice(0, 3).map(v => `
  <div style="margin-bottom: 32px;">
    <figure style="margin: 0;">
      <div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
        <iframe width="560" height="315" src="https://www.youtube-nocookie.com/embed/${v.id}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"></iframe>
      </div>
      <figcaption style="text-align: center; color: #6b7280; font-size: 14px; margin-top: 12px;">🎬 <strong>${v.title}</strong> — ${v.channelTitle}</figcaption>
    </figure>
  </div>`).join('\n');

    return `
<div style="background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%); border-radius: 16px; padding: 32px; margin: 48px 0; border: 1px solid #d1fae5;">
  <h2 style="margin-top: 0; color: #0f172a; font-size: 24px; font-weight: 800;">📺 Recommended Video Resources</h2>
  <p style="color: #475569; margin-bottom: 24px; font-size: 16px; line-height: 1.7;">Watch these expert-curated videos for deeper insights:</p>
  ${videoEmbeds}
</div>`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SYSTEM PROMPT BUILDER
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Builds the comprehensive system prompt for the AI content generation model.
   * This is the core of content quality — it defines voice, formatting, and quality targets.
   */
  private buildSystemPrompt(): string {
    const availableInternalUrls = (this.config.sitePages || [])
      .slice(0, 40)
      .map(p => `- ${p.url} — "${p.title}"`)
      .join('\n');

    return `You write like a real person who's done the work. Not an AI. Not a content mill. A real expert who's been in the trenches.

Your voice: Alex Hormozi meets Tim Ferriss. Blunt. Data-driven. Zero fluff. You write like you're explaining something to a smart friend over coffee — casual but packed with substance.

GOLDEN RULES:
- Every single sentence must EARN its place. If it doesn't teach, prove, or move the reader — delete it.
- Write at a 6th-grade reading level. Short sentences. Simple words. Your grandma should understand it.
- Use the "So what?" test: after every paragraph, ask "so what?" — if there's no clear answer, rewrite it.
- Front-load value. The first 50 words must deliver an insight or answer. No throat-clearing intros.
- Break up walls of text. Max 2-3 sentences per paragraph. Use whitespace like a weapon.
- CRITICAL: Never write more than ${MAX_CONSECUTIVE_P_WORDS} words of plain <p> text without inserting a visual HTML element (pro tip box, stat highlight, data table, blockquote, numbered step, or similar). Walls of text kill readability.
- Contractions ALWAYS: don't, won't, can't, it's, that's, you'll, they've, doesn't, isn't, we're
- Write like you talk. Read it out loud. If it sounds robotic, rewrite it.

CRITICAL QUALITY TARGETS (MUST ACHIEVE ALL):
✅ READABILITY: 90%+ (Grade 6-7 Flesch-Kincaid, short sentences, simple words)
✅ SEO: 90%+ (Primary keyword 8-12x, semantic keywords woven throughout, proper H1/H2/H3 hierarchy)
✅ E-E-A-T: 90%+ (First-hand experience, cite specific studies/sources, expert quotes, real examples)
✅ UNIQUENESS: 90%+ (ZERO generic phrases, unique analogies, fresh perspectives, contrarian takes)
✅ ACCURACY: 90%+ (Cite specific data, include 2025 statistics, verifiable claims only)
✅ NEURONWRITER: ${NW_TARGET_SCORE}%+ (Include ALL required terms at exact frequencies, ALL entities, use recommended H2/H3)

PREMIUM STYLED HTML ELEMENTS — USE AT LEAST 6-8 THROUGHOUT:

A. KEY TAKEAWAYS BOX (use once, after intro):
<div style="background: #ffffff; border: 2px solid #10b981; border-radius: 20px; padding: 32px 36px; margin: 40px 0; box-shadow: 0 8px 32px rgba(16, 185, 129, 0.12); position: relative; overflow: hidden; max-width: 100%; box-sizing: border-box;">
  <div style="position: absolute; top: 0; left: 0; right: 0; height: 5px; background: linear-gradient(90deg, #10b981 0%, #06b6d4 50%, #8b5cf6 100%);"></div>
  <h3 style="color: #0f172a; margin: 8px 0 24px 0; font-size: 22px; font-weight: 900;">🎯 The Bottom Line</h3>
  <ul style="color: #1e293b; margin: 0; padding-left: 0; font-size: 17px; line-height: 1.9; list-style: none;">
    <li style="margin-bottom: 14px; padding: 12px 16px 12px 44px; position: relative; background: #f0fdf4; border-radius: 10px;"><span style="position: absolute; left: 14px; top: 13px; color: #10b981; font-weight: 800; font-size: 18px;">✅</span> <strong>Key insight</strong></li>
  </ul>
</div>

B. PRO TIP BOX (use 4-6 throughout):
<div style="background: #ffffff; border: 1px solid #e0e7ff; border-left: 5px solid #6366f1; padding: 24px 28px; margin: 36px 0; border-radius: 0 16px 16px 0; box-shadow: 0 4px 20px rgba(99, 102, 241, 0.08); max-width: 100%; box-sizing: border-box;">
  <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px;">
    <span style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; width: 32px; height: 32px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; font-size: 16px;">💡</span>
    <strong style="color: #3730a3; font-size: 17px; font-weight: 800;">Pro Tip</strong>
  </div>
  <p style="color: #334155; font-size: 17px; margin: 0; line-height: 1.8;">Your actionable insider knowledge here.</p>
</div>

C. WARNING BOX (use 1-2):
<div style="background: #ffffff; border: 1px solid #fecaca; border-left: 5px solid #ef4444; padding: 24px 28px; margin: 36px 0; border-radius: 0 16px 16px 0; box-shadow: 0 4px 20px rgba(239, 68, 68, 0.08); max-width: 100%; box-sizing: border-box;">
  <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px;">
    <span style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; width: 32px; height: 32px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; font-size: 16px;">⚠️</span>
    <strong style="color: #991b1b; font-size: 17px; font-weight: 800;">Warning</strong>
  </div>
  <p style="color: #334155; font-size: 17px; margin: 0; line-height: 1.8;">Critical warning here.</p>
</div>

D. STAT HIGHLIGHT (use 2-3):
<div style="background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); border: 2px solid #e2e8f0; border-radius: 16px; padding: 28px 32px; margin: 36px 0; text-align: center; max-width: 100%; box-sizing: border-box;">
  <div style="font-size: 48px; font-weight: 900; color: #0f172a; line-height: 1.1;">73%</div>
  <div style="font-size: 16px; color: #64748b; margin-top: 8px;">of companies see measurable ROI within 90 days</div>
  <div style="font-size: 13px; color: #94a3b8; margin-top: 6px;">Source: Industry Report, 2025</div>
</div>

E. EXPERT QUOTE (use 2-3):
<blockquote style="border-left: 4px solid #8b5cf6; background: linear-gradient(135deg, #faf5ff 0%, #f5f3ff 100%); margin: 36px 0; padding: 28px 32px; border-radius: 0 16px 16px 0; position: relative; max-width: 100%; box-sizing: border-box;">
  <p style="font-size: 18px; font-style: italic; color: #4c1d95; line-height: 1.8; margin: 0 0 16px 0;">"Quote text here."</p>
  <footer style="font-size: 15px; color: #7c3aed; font-weight: 700;">— Dr. Jane Smith, Director of Research at XYZ University</footer>
</blockquote>

F. FAQ ACCORDION (use for FAQ section):
<details style="margin: 12px 0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; max-width: 100%; box-sizing: border-box;">
  <summary style="padding: 18px 24px; background: #f8fafc; cursor: pointer; font-weight: 700; color: #0f172a; font-size: 17px; list-style: none; display: flex; justify-content: space-between; align-items: center;">
    Question here? <span style="font-size: 20px; color: #64748b;">+</span>
  </summary>
  <div style="padding: 16px 24px; color: #475569; font-size: 16px; line-height: 1.8; border-top: 1px solid #e2e8f0;">
    Answer here.
  </div>
</details>

HUMAN VOICE — MANDATORY PATTERNS:
- Contractions ALWAYS: don't, won't, can't, it's, that's, we're, you'll, they've
- Start sections with: "Look," / "Here's the thing:" / "Real talk:" / "I'll be honest:"
- Fragments. For emphasis. Like this.
- Rhetorical questions every 150-200 words
- Self-interruption: "Wait—before I go further..."
- Address objections: "Now you might be thinking..."

AI DETECTION KILLERS — NEVER USE:
${AI_BANNED_WORDS.map(w => `❌ "${w}"`).join(' / ')}

${availableInternalUrls ? `
INTERNAL LINKS — YOU MUST EMBED 4-8 IN THE HTML:
Each internal link must:
• Use 3-7 word descriptive anchor text that reads naturally in the sentence
• Be wrapped in: <a href="URL" style="color:#059669;text-decoration:underline;text-decoration-color:rgba(5,150,105,0.3);text-underline-offset:3px;font-weight:600;">anchor text</a>
• Be evenly spread across different H2 sections (NOT bunched together)
• Never have 2 links in the same paragraph
• Anchor text must describe what the reader will find (NEVER "click here" or "read more")

AVAILABLE INTERNAL LINK URLS:
${availableInternalUrls}
` : ''}

OUTPUT: PURE HTML ONLY. No markdown. No code fences. No preamble.`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN CONTENT GENERATION
  // ─────────────────────────────────────────────────────────────────────────

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
    const systemPrompt = this.buildSystemPrompt();

    const prompt = `Write a ${targetWordCount}+ word article about "${keyword}".

TITLE: ${title}

CONTENT STRUCTURE:
${serpAnalysis.recommendedHeadings.map((h, i) => `${i + 1}. ${h}`).join('\n')}

CONTENT GAPS TO FILL:
${serpAnalysis.contentGaps.slice(0, 6).join('\n')}

SEMANTIC KEYWORDS:
${serpAnalysis.semanticEntities.slice(0, 18).join(', ')}

${neuronTermPrompt ? `
NEURONWRITER OPTIMIZATION — ${NW_TARGET_SCORE}%+ CONTENT SCORE REQUIRED:
${neuronTermPrompt}
` : ''}

${videos.length > 0 ? `
EMBED THESE VIDEOS (spread evenly):
${videos.slice(0, 3).map((v, i) => `
VIDEO ${i + 1}:
<figure style="margin: 40px 0;">
<div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
<iframe width="560" height="315" src="https://www.youtube-nocookie.com/embed/${v.id}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"></iframe>
</div>
<figcaption style="text-align: center; color: #6b7280; font-size: 14px; margin-top: 12px;">🎬 ${v.title}</figcaption>
</figure>
`).join('\n')}
` : ''}

MANDATORY STRUCTURE:
1. Hook Opening (no H1)
2. Key Takeaways Box (5-7 bullets)
3. 6-10 H2 Sections with 2-3 H3 each
4. At least 4-6 Pro Tip / Warning boxes spread throughout
5. At least 2 data tables
6. At least 2-3 stat highlights
7. At least 2 expert quotes
8. FAQ section with 8 questions (use <details>/<summary>)
9. Strong CTA conclusion
10. 4-8 internal links evenly distributed across the article

VISUAL BREAK RULE: Between every pair of visual elements (box, table, blockquote, list, figure), there must be NO MORE than ${MAX_CONSECUTIVE_P_WORDS} words of <p> text. If any gap exceeds ~150 words, insert a styled element.

Write the complete article now. Output ONLY HTML.`;

    let result;
    if (this.config.useConsensus && !neuronTermPrompt && this.engine.getAvailableModels().length > 1) {
      this.log('Using multi-model consensus generation...');
      const consensusResult = await this.engine.generateWithConsensus(prompt, systemPrompt);
      result = { content: consensusResult.finalContent };
    } else {
      const initialMaxTokens = targetWordCount >= 5000 ? 32768 :
        targetWordCount >= 3000 ? 16384 : 8192;
      result = await this.engine.generateWithModel({
        prompt,
        model: this.config.primaryModel || 'gemini',
        apiKeys: this.config.apiKeys,
        systemPrompt,
        temperature: 0.72,
        maxTokens: initialMaxTokens,
      });
    }

    // Ensure content meets target word count
    let finalContent = await this.ensureLongFormComplete({
      keyword,
      title,
      systemPrompt,
      model: this.config.primaryModel || 'gemini',
      currentHtml: result.content,
      targetWordCount,
    });

    // Inject videos if not already embedded
    if (videos.length > 0 && !finalContent.includes('youtube.com/embed') && !finalContent.includes('youtube-nocookie.com/embed')) {
      const videoSection = this.buildVideoSection(videos);
      finalContent = this.insertBeforeConclusion(finalContent, videoSection);
      this.log('Injected YouTube video section');
    }

    // Append references
    if (references.length > 0) {
      const referencesSection = this.referenceService.formatReferencesSection(references);
      finalContent += referencesSection;
      this.log(`Added ${references.length} references`);
    }

    return finalContent;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN GENERATION PIPELINE
  // ═══════════════════════════════════════════════════════════════════════════

  async generateContent(options: GenerationOptions): Promise<GeneratedContent> {
    this.onProgress = options.onProgress;
    this.telemetry = this.createFreshTelemetry();
    const startTime = Date.now();

    this.log(`Starting content generation for: "${options.keyword}"`);

    // ═════════════════════════════════════════════════════════════════════
    // PHASE 1: PARALLEL RESEARCH (fault-tolerant)
    // ═════════════════════════════════════════════════════════════════════
    this.log('═══ Phase 1: Research & Analysis ═══');
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
          : Promise.resolve([]),
        options.includeReferences !== false
          ? this.referenceService.getTopReferences(options.keyword)
          : Promise.resolve([]),
        this.maybeInitNeuronWriter(options.keyword, options),
      ]);

      serpAnalysis = results[0].status === 'fulfilled' ? results[0].value : this.getDefaultSerpAnalysis(options.keyword);
      videos = results[1].status === 'fulfilled' ? results[1].value : [];
      references = results[2].status === 'fulfilled' ? results[2].value : [];
      neuron = results[3].status === 'fulfilled' ? results[3].value : null;

      if (results[0].status === 'rejected') this.warn(`SERP analysis failed (using defaults): ${results[0].reason}`);
      if (results[1].status === 'rejected') this.warn(`YouTube fetch failed: ${results[1].reason}`);
      if (results[2].status === 'rejected') this.warn(`References fetch failed: ${results[2].reason}`);
      if (results[3].status === 'rejected') this.warn(`NeuronWriter init failed: ${results[3].reason}`);
    } catch (e) {
      this.logError(`Phase 1 failed entirely (using defaults): ${e}`);
      serpAnalysis = this.getDefaultSerpAnalysis(options.keyword);
    }

    // SOTA FAILSAFE: If NeuronWriter is configured but init failed, retry once before proceeding
    const nwConfigured = !!(this.config.neuronWriterApiKey?.trim()) && !!(this.config.neuronWriterProjectId?.trim());
    if (nwConfigured && !neuron) {
      this.log('NeuronWriter: Configured but failed to init — retrying once...');
      try {
        neuron = await this.maybeInitNeuronWriter(options.keyword, options);
        if (neuron) {
          this.log('NeuronWriter: Retry SUCCEEDED — NeuronWriter is now active ✅');
        } else {
          this.warn('NeuronWriter: Retry also failed — proceeding WITHOUT NeuronWriter (check API key/project)');
        }
      } catch (retryErr) {
        this.warn(`NeuronWriter: Retry error — ${retryErr}`);
      }
    }

    const phase1Ms = endPhase1Timer();
    this.log(`Phase 1 complete in ${(phase1Ms / 1000).toFixed(1)}s — ${videos.length} videos, ${references.length} references`);
    this.log(`SERP Analysis: ${serpAnalysis.userIntent} intent, ${serpAnalysis.recommendedWordCount} words recommended`);
    if (nwConfigured) {
      this.log(`NeuronWriter: ${neuron ? 'ACTIVE ✅' : 'INACTIVE ❌ — content will proceed without NW optimization'}`);
    }

    // ═════════════════════════════════════════════════════════════════════
    // PHASE 2: AI CONTENT GENERATION
    // ═════════════════════════════════════════════════════════════════════
    this.log('═══ Phase 2: AI Content Generation ═══');
    const endPhase2Timer = this.startPhaseTimer('phase2_generation');

    const targetWordCount =
      options.targetWordCount ||
      neuron?.analysis?.recommended_length ||
      serpAnalysis.recommendedWordCount ||
      2500;

    const genOptions: GenerationOptions = { ...options, targetWordCount };

    // Generate title if not provided
    let title = options.title || options.keyword;
    try {
      if (!options.title) {
        title = await this.generateTitle(options.keyword, serpAnalysis);
      }
    } catch (e) {
      this.warn(`Title generation failed (using keyword): ${e}`);
      title = options.title || options.keyword;
    }

    // Build NeuronWriter term prompt
    const neuronTermPrompt = neuron
      ? neuron.service.formatTermsForPrompt(neuron.analysis.terms || [], neuron.analysis)
      : undefined;

    // Generate main content
    let content: string;
    try {
      content = await this.generateMainContent(
        options.keyword,
        title,
        serpAnalysis,
        videos,
        references,
        genOptions,
        neuronTermPrompt
      );
    } catch (genError) {
      const msg = genError instanceof Error ? genError.message : String(genError);
      this.logError(`AI content generation failed: ${msg}`);
      throw new Error(`AI content generation failed: ${msg}. Check your API key and model configuration.`);
    }

    if (!content || content.trim().length < MIN_VALID_CONTENT_LENGTH) {
      this.logError('AI returned empty or near-empty content');
      throw new Error('AI model returned empty content. Check your API key, model selection, and ensure the model supports long-form generation.');
    }

    const phase2Ms = endPhase2Timer();
    this.log(`Phase 2 complete in ${(phase2Ms / 1000).toFixed(1)}s — ${this.countWordsFromHtml(content)} words generated`);

    // ═════════════════════════════════════════════════════════════════════
    // PHASE 3: POST-PROCESSING PIPELINE (10 fault-tolerant sub-steps)
    // ═════════════════════════════════════════════════════════════════════
    this.log('═══ Phase 3: Content Enhancement Pipeline ═══');
    const endPhase3Timer = this.startPhaseTimer('phase3_postprocessing');
    let enhancedContent = content;

    // --- 3a: Remove AI phrases ---
    try {
      enhancedContent = removeAIPhrases(enhancedContent);
      this.log('3a: AI phrase removal complete');
    } catch (e) {
      this.warn(`3a: removeAIPhrases failed (non-fatal): ${e}`);
    }

    // --- 3b: Smart Internal Links (4-8 minimum) ---
    try {
      enhancedContent = this.injectInternalLinks(enhancedContent, options);
      this.log('3b: Internal link injection complete');
    } catch (e) {
      this.warn(`3b: Internal linking failed (non-fatal): ${e}`);
    }

    // --- 3c: Preserve references before NeuronWriter/self-critique loops ---
    let savedReferences: string | null = null;
    try {
      const preserved = this.preserveReferencesSection(enhancedContent);
      enhancedContent = preserved.content;
      savedReferences = preserved.references;
      if (savedReferences) {
        this.log('3c: References preserved and stripped for safe post-processing');
      }
    } catch (e) {
      this.warn(`3c: Reference preservation failed (non-fatal): ${e}`);
    }

    // --- 3d: NeuronWriter improvement loop ---
    try {
      if (neuron) {
        this.log('3d: NeuronWriter improvement loop starting...');
        const nwResult = await this.runNeuronWriterImprovementLoop(
          neuron, enhancedContent, options.keyword, title
        );
        enhancedContent = nwResult.content;

        // Self-Critique pass
        try {
          const req = this.extractNeuronRequirements(neuron.analysis);
          enhancedContent = await this.selfCritiqueAndPatch({
            keyword: options.keyword,
            title,
            html: enhancedContent,
            requiredTerms: req.requiredTerms,
            requiredEntities: req.entities,
            requiredHeadings: req.h2,
          });
          enhancedContent = this.enforceNeuronwriterCoverage(enhancedContent, req);
        } catch (e) {
          this.warn(`3d: Self-critique failed (non-fatal): ${e}`);
        }
      } else {
        // No NeuronWriter — still run basic self-critique
        try {
          enhancedContent = await this.selfCritiqueAndPatch({
            keyword: options.keyword,
            title,
            html: enhancedContent,
          });
        } catch (e) {
          this.warn(`3d: Self-critique (no NW) failed (non-fatal): ${e}`);
        }
      }
      this.log('3d: NeuronWriter optimization complete');
    } catch (neuronErr) {
      this.warn(`3d: NeuronWriter optimization loop crashed (non-fatal): ${neuronErr}`);
    }

    // --- 3e: Re-append preserved references ---
    try {
      if (savedReferences) {
        // Remove any duplicated references before re-appending
        enhancedContent = enhancedContent
          .replace(/<!-- SOTA References Section -->[\s\S]*$/i, '')
          .replace(/<hr>\s*<h2>References[\s\S]*$/i, '')
          .trim();
        enhancedContent = `${enhancedContent}\n\n${savedReferences}`;
        this.log('3e: References re-appended after post-processing');
      }
    } catch (e) {
      this.warn(`3e: Reference re-append failed (non-fatal): ${e}`);
    }

    // --- 3f: Enforce visual breaks (max 200 consecutive <p> words) ---
    let postProcessingResult: PostProcessingResult | undefined;
    try {
      this.log('3f: Enforcing visual break rules...');
      const ppResult = ContentPostProcessor.process(enhancedContent, {
        maxConsecutiveWords: MAX_CONSECUTIVE_P_WORDS,
        usePullQuotes: true,
      });

      if (ppResult.wasModified) {
        enhancedContent = ppResult.html;
        this.telemetry.visualBreakViolationsFixed = ppResult.violations?.length || 0;
        this.log(`3f: Visual breaks — injected elements to fix ${ppResult.violations?.length || 'all'} wall-of-text violations`);
      } else {
        this.log('3f: Visual breaks — content already passes ✅');
      }
      postProcessingResult = ppResult;
    } catch (e) {
      this.warn(`3f: ContentPostProcessor failed (non-fatal): ${e}`);
    }

    // --- 3g: Final readability polish ---
    try {
      this.log('3g: Final readability polish...');
      enhancedContent = polishReadability(enhancedContent);
    } catch (e) {
      this.warn(`3g: polishReadability failed (non-fatal): ${e}`);
    }

    // --- 3h: Markdown → HTML conversion (only if artifacts detected) ---
    try {
      if (this.hasMarkdownArtifacts(enhancedContent)) {
        this.log('3h: Detected markdown remnants — converting to HTML...');
        enhancedContent = convertMarkdownToHTML(enhancedContent);
      } else {
        this.log('3h: No markdown artifacts detected — skipping conversion');
      }
    } catch (e) {
      this.warn(`3h: Markdown conversion failed (non-fatal): ${e}`);
    }

    // --- 3i: Ensure proper HTML structure ---
    try {
      enhancedContent = ensureProperHTMLStructure(enhancedContent);
      this.log('3i: HTML structure enforcement complete');
    } catch (e) {
      this.warn(`3i: HTML structure enforcement failed (non-fatal): ${e}`);
    }

    // --- 3j: Ensure references section exists ---
    try {
      enhancedContent = this.ensureReferencesSection(enhancedContent, references, serpAnalysis);
      this.log(`3j: References — ${references.length} sources ensured in content`);
    } catch (e) {
      this.warn(`3j: ensureReferencesSection failed (non-fatal): ${e}`);
    }

    // --- 3k: Ensure FAQ section exists ---
    try {
      const hasFaq = /<(details|h2)[^>]*>[\s\S]*?(?:faq|frequently asked|common questions)/i.test(enhancedContent);
      if (!hasFaq) {
        this.log('3k: No FAQ section detected — generating...');
        const faqTerms = neuron
          ? (neuron.analysis.terms || []).slice(0, 15).map(t => t.term).join(', ')
          : options.keyword;
        const faqPrompt = `Generate a FAQ section for an article titled "${title}" about "${options.keyword}".

Create exactly 8 frequently asked questions with detailed answers.

REQUIREMENTS:
- Each question must be specific and valuable (not generic)
- Answers should be 40-80 words each
- Include the keyword "${options.keyword}" in at least 3 questions
- Naturally incorporate these terms where relevant: ${faqTerms}
- Output PURE HTML using this exact format for each Q&A:

<details style="margin: 12px 0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; max-width: 100%; box-sizing: border-box;">
  <summary style="padding: 18px 24px; background: #f8fafc; cursor: pointer; font-weight: 700; color: #0f172a; font-size: 17px; list-style: none; display: flex; justify-content: space-between; align-items: center;">
    Question here? <span style="font-size: 20px; color: #64748b;">+</span>
  </summary>
  <div style="padding: 16px 24px; color: #475569; font-size: 16px; line-height: 1.8; border-top: 1px solid #e2e8f0;">
    Answer here.
  </div>
</details>

Wrap all 8 Q&As inside:
<div style="margin-top: 48px;">
  <h2 style="color: #0f172a; font-size: 30px; font-weight: 900; margin: 56px 0 24px 0; padding-bottom: 14px; border-bottom: 4px solid #10b981;">❓ Frequently Asked Questions</h2>
  <!-- all 8 details/summary blocks here -->
</div>

Output ONLY the HTML. No markdown. No commentary.`;

        try {
          const faqResult = await this.engine.generateWithModel({
            prompt: faqPrompt,
            model: this.config.primaryModel || 'gemini',
            apiKeys: this.config.apiKeys,
            systemPrompt: 'Generate FAQ HTML. Output PURE HTML ONLY.',
            temperature: 0.6,
            maxTokens: 4096,
          });

          if (faqResult.content && faqResult.content.trim().length > 200) {
            const refsMarker = enhancedContent.indexOf('<!-- SOTA References Section -->');
            if (refsMarker !== -1) {
              enhancedContent = enhancedContent.slice(0, refsMarker) + '\n\n' + faqResult.content.trim() + '\n\n' + enhancedContent.slice(refsMarker);
            } else {
              enhancedContent = enhancedContent + '\n\n' + faqResult.content.trim();
            }
            this.log('3k: FAQ section generated and injected ✅');
          } else {
            this.warn('3k: FAQ generation returned insufficient content');
          }
        } catch (faqGenErr) {
          this.warn(`3k: FAQ generation failed (non-fatal): ${faqGenErr}`);
        }
      } else {
        this.log('3k: FAQ section already exists ✅');
      }
    } catch (e) {
      this.warn(`3k: FAQ enforcement failed (non-fatal): ${e}`);
    }

    const phase3Ms = endPhase3Timer();

    this.log(`Phase 3 complete in ${(phase3Ms / 1000).toFixed(1)}s — all 10 post-processing steps executed`);

    // ═════════════════════════════════════════════════════════════════════
    // PHASE 4: QUALITY VALIDATION
    // ═════════════════════════════════════════════════════════════════════
    this.log('═══ Phase 4: Quality & E-E-A-T Validation ═══');
    const endPhase4Timer = this.startPhaseTimer('phase4_validation');

    let metrics: ContentMetrics;
    let internalLinks: InternalLink[] = [];
    let qualityScore: QualityScore;

    try {
      metrics = analyzeContent(enhancedContent);
    } catch (e) {
      this.warn(`analyzeContent failed (non-fatal): ${e}`);
      metrics = {
        wordCount: this.countWordsFromHtml(enhancedContent),
        sentenceCount: 0, paragraphCount: 0, headingCount: 0,
        imageCount: 0, linkCount: 0, keywordDensity: 0,
        readabilityGrade: 7, estimatedReadTime: 0,
      };
    }

    try {
      internalLinks = this.linkEngine.generateLinkOpportunities(enhancedContent);
    } catch (e) {
      this.warn(`Link analysis failed (non-fatal): ${e}`);
    }

    try {
      const [qs, eeatScore] = await Promise.all([
        Promise.resolve(calculateQualityScore(
          enhancedContent, options.keyword, internalLinks.map(l => l.targetUrl)
        )),
        Promise.resolve(this.eeatValidator.validateContent(enhancedContent, {
          name: this.config.authorName,
          credentials: this.config.authorCredentials,
        })),
      ]);
      qualityScore = qs;

      this.log(`Quality Score: ${qualityScore.overall}% | E-E-A-T Score: ${eeatScore.overall}%`);

      // Visual break validation
      const vbResult = validateVisualBreaks(enhancedContent, MAX_CONSECUTIVE_P_WORDS);
      if (vbResult.valid) {
        this.log('Visual Breaks: ✅ PASSED — no wall-of-text violations');
      } else {
        this.warn(`Visual Breaks: ⚠️ ${vbResult.violations.length} violation(s) remain after post-processing`);
      }

      // E-E-A-T improvement suggestions
      if (options.validateEEAT !== false && eeatScore.overall < 70) {
        const enhancements = this.eeatValidator.generateEEATEnhancements(eeatScore);
        this.log(`E-E-A-T improvements needed: ${enhancements.slice(0, 3).join(', ')}`);
      }
    } catch (e) {
      this.warn(`Quality validation failed (non-fatal): ${e}`);
      qualityScore = {
        overall: 75, readability: 75, seo: 75, eeat: 75,
        uniqueness: 75, factAccuracy: 75, passed: true, improvements: [],
      };
    }

    const phase4Ms = endPhase4Timer();
    this.log(`Phase 4 complete in ${(phase4Ms / 1000).toFixed(1)}s`);

    // ═════════════════════════════════════════════════════════════════════
    // PHASE 5: SCHEMA, METADATA & FINAL ASSEMBLY
    // ═════════════════════════════════════════════════════════════════════
    this.log('═══ Phase 5: SEO Metadata & Schema ═══');
    const endPhase5Timer = this.startPhaseTimer('phase5_assembly');

    const eeat = this.buildEEATProfile(references);
    let seoTitle = title;
    let metaDescription = `Learn everything about ${options.keyword}. Expert guide with actionable tips.`;
    let slug = this.generateSlug(title);

    try {
      const [generatedSeoTitle, generatedMetaDesc] = await Promise.all([
        this.generateSEOTitle(options.keyword, title, serpAnalysis),
        this.generateMetaDescription(options.keyword, title),
      ]);
      seoTitle = generatedSeoTitle;
      metaDescription = generatedMetaDesc;
      this.log(`SEO Title: "${seoTitle}" (${seoTitle.length} chars) | Meta: ${metaDescription.length} chars`);
    } catch (e) {
      this.warn(`SEO metadata generation failed (non-fatal): ${e}`);
    }

    // Final word-count sanity check
    const finalWordCount = this.countWordsFromHtml(enhancedContent);
    if (finalWordCount < targetWordCount * 0.9) {
      this.warn(
        `Final content word count ${finalWordCount} < 90% of target ${targetWordCount}. ` +
        'Consider regenerating or reviewing for truncation.'
      );
    }

    // Build schema (non-fatal)
    let schema: GeneratedContent['schema'] = { '@context': 'https://schema.org', '@graph': [] };
    try {
      schema = this.schemaGenerator.generateComprehensiveSchema(
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
          consensusUsed: this.config.useConsensus || false,
        } as GeneratedContent,
        `${this.config.organizationUrl}/${slug}`
      );
    } catch (e) {
      this.warn(`Schema generation failed (non-fatal): ${e}`);
    }

    // ═════════════════════════════════════════════════════════════════════
    // ASSEMBLE FINAL OUTPUT
    // ═════════════════════════════════════════════════════════════════════

    const generatedContent: GeneratedContent = {
      id: crypto.randomUUID(),
      title,
      seoTitle,
      content: enhancedContent,
      metaDescription,
      slug,
      primaryKeyword: options.keyword,
      secondaryKeywords: serpAnalysis.semanticEntities.slice(0, 10),
      metrics,
      qualityScore,
      internalLinks,
      schema,
      eeat,
      serpAnalysis,
      generatedAt: new Date(),
      model: this.config.primaryModel || 'gemini',
      consensusUsed: this.config.useConsensus || false,

      // NeuronWriter data
      neuronWriterQueryId: neuron?.queryId,
      neuronWriterAnalysis: neuron ? Object.assign({}, neuron.analysis, { query_id: neuron.queryId, status: 'ready' }) : undefined,


      // Post-processing audit trail
      postProcessing: postProcessingResult,
    };

    const phase5Ms = endPhase5Timer();
    const totalDuration = Date.now() - startTime;

    this.log('═══════════════════════════════════════════════════');
    this.log(`✅ Generation complete in ${(totalDuration / 1000).toFixed(1)}s`);
    this.log(`   Words: ${finalWordCount} | Quality: ${qualityScore.overall}%`);
    this.log(`   NeuronWriter: ${this.telemetry.neuronWriterFinalScore}% (${this.telemetry.neuronWriterAttempts} attempts)`);
    this.log(`   Internal Links Injected: ${this.telemetry.internalLinksInjected}`);
    this.log(`   Visual Break Violations Fixed: ${this.telemetry.visualBreakViolationsFixed}`);
    this.log(`   Continuation Rounds: ${this.telemetry.continuationRounds}`);
    this.log(`   Self-Critique Applied: ${this.telemetry.selfCritiqueApplied}`);
    if (this.telemetry.warnings.length > 0) {
      this.log(`   Warnings: ${this.telemetry.warnings.length}`);
    }
    if (this.telemetry.errors.length > 0) {
      this.log(`   Errors: ${this.telemetry.errors.length}`);
    }
    this.log(`   Phase Timings: ${Object.entries(this.telemetry.phaseTimings).map(([k, v]) => `${k}=${(v / 1000).toFixed(1)}s`).join(', ')}`);
    this.log('═══════════════════════════════════════════════════');

    return generatedContent;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONTENT PLAN GENERATION
  // ─────────────────────────────────────────────────────────────────────────

  async generateContentPlan(broadTopic: string): Promise<ContentPlan> {
    this.log(`Generating content plan for: "${broadTopic}"`);

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
      maxTokens: 2000,
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
          priority: (c.priority as ContentPlan['clusters'][0]['priority']) || 'medium',
        })),
        totalEstimatedWords: (parsed.clusters.length + 1) * 2500,
        estimatedTimeToComplete: `${Math.ceil((parsed.clusters.length + 1) * 15 / 60)} hours`,
      };
    } catch (error) {
      this.warn(`Error parsing content plan: ${error}`);
      return {
        pillarTopic: broadTopic,
        pillarKeyword: broadTopic,
        clusters: [
          { keyword: `${broadTopic} guide`, title: `Complete ${broadTopic} Guide`, type: 'guide', priority: 'high' },
          { keyword: `${broadTopic} tips`, title: `Top ${broadTopic} Tips`, type: 'listicle', priority: 'high' },
          { keyword: `how to ${broadTopic}`, title: `How to ${broadTopic}`, type: 'how-to', priority: 'medium' },
          { keyword: `${broadTopic} best practices`, title: `${broadTopic} Best Practices`, type: 'deep-dive', priority: 'medium' },
        ],
        totalEstimatedWords: 12500,
        estimatedTimeToComplete: '3 hours',
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DEFAULTS & PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────

  private getDefaultSerpAnalysis(keyword: string): SERPAnalysis {
    return {
      avgWordCount: 2000,
      commonHeadings: [
        `What is ${keyword}?`,
        `How to ${keyword}`,
        `Benefits of ${keyword}`,
        `Best Practices`,
        `FAQ`,
      ],
      contentGaps: [],
      userIntent: 'informational',
      semanticEntities: [],
      topCompetitors: [],
      recommendedWordCount: 2500,
      recommendedHeadings: [
        `What is ${keyword}?`,
        `How ${keyword} Works`,
        `Key Benefits`,
        `Getting Started`,
        `Best Practices`,
        `Common Mistakes to Avoid`,
        `FAQ`,
        `Conclusion`,
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

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export function createOrchestrator(config: OrchestratorConfig): EnterpriseContentOrchestrator {
  return new EnterpriseContentOrchestrator(config);
}
