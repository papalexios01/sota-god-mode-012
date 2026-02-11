// SOTA INTERNAL LINK ENGINE v2.0.0
// Enterprise-grade internal linking with TF-IDF relevance scoring,
// contextual anchor text extraction, link density caps, and diversity enforcement.
//
// Exports:
//   - SOTAInternalLinkEngine (class)
//   - createInternalLinkEngine (factory function — required by EnterpriseContentOrchestrator)

import type { InternalLink } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SitePage {
  url: string;
  title: string;
  keywords?: string[];
  slug?: string;
  description?: string;
  content?: string;
}

interface LinkCandidate {
  anchor: string;
  targetUrl: string;
  context: string;
  relevanceScore: number;
  priority: number;
  paragraphIndex: number;
  cumulativeWordCount: number;
}

interface ParagraphBlock {
  html: string;
  text: string;
  tokens: string[];
  wordCount: number;
  index: number;
  cumulativeWordCount: number;
  hasExistingLink: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have',
  'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'this', 'that',
  'these', 'those', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'you',
  'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its',
  'they', 'them', 'their', 'theirs', 'what', 'which', 'who', 'whom', 'how',
  'when', 'where', 'why', 'not', 'no', 'nor', 'so', 'if', 'then', 'than',
  'too', 'very', 'just', 'about', 'above', 'after', 'again', 'all', 'also',
  'any', 'because', 'before', 'below', 'between', 'both', 'each', 'few',
  'more', 'most', 'other', 'over', 'same', 'some', 'such', 'through',
  'under', 'until', 'up', 'while', 'into', 'out', 'only', 'own', 'here',
  'there', 'once', 'during', 'now', 'even', 'new', 'way', 'many', 'much',
]);

const MAX_LINKS_PER_ARTICLE = 12;
const MAX_LINKS_PER_PARAGRAPH = 1;
const MIN_WORDS_BETWEEN_LINKS = 200;
const MIN_RELEVANCE_SCORE = 25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function countWords(text: string): number {
  return text.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean).length;
}

function calculateRelevance(
  paragraphTokens: string[],
  targetTokens: string[],
  corpusDocCount: number,
  documentFrequency: Map<string, number>,
): number {
  if (paragraphTokens.length === 0 || targetTokens.length === 0) return 0;

  const targetSet = new Set(targetTokens);
  let score = 0;
  let matchedTerms = 0;

  for (const token of paragraphTokens) {
    if (targetSet.has(token)) {
      matchedTerms++;
      const df = documentFrequency.get(token) || 1;
      const idf = Math.log(corpusDocCount / df) + 1;
      score += idf;
    }
  }

  if (matchedTerms === 0) return 0;

  const normalizedScore = (score / Math.sqrt(paragraphTokens.length)) * 10;
  const matchRatio = matchedTerms / Math.min(paragraphTokens.length, targetTokens.length);
  const bonus = matchRatio * 20;

  return Math.min(100, Math.round(normalizedScore + bonus));
}

function extractAnchorText(
  paragraphText: string,
  targetTokens: Set<string>,
  targetTitle: string,
): string | null {
  const text = paragraphText.replace(/<[^>]*>/g, '').trim();
  const words = text.split(/\s+/);

  if (words.length < 4) return null;

  let bestPhrase = '';
  let bestScore = 0;

  for (let len = 2; len <= Math.min(6, words.length); len++) {
    for (let i = 0; i <= words.length - len; i++) {
      const phrase = words.slice(i, i + len).join(' ');
      const cleanPhrase = phrase.toLowerCase().replace(/[^a-z0-9\s'-]/g, '');
      const phraseTokens = cleanPhrase.split(/\s+/).filter((w) => w.length > 2);

      if (phraseTokens.length === 0) continue;
      if (STOP_WORDS.has(phraseTokens[0]) || STOP_WORDS.has(phraseTokens[phraseTokens.length - 1])) continue;

      let overlap = 0;
      for (const t of phraseTokens) {
        if (targetTokens.has(t)) overlap++;
      }

      if (overlap === 0) continue;

      const overlapRatio = overlap / phraseTokens.length;
      const lengthBonus = len >= 3 && len <= 5 ? 5 : 0;
      const score = overlapRatio * 50 + overlap * 10 + lengthBonus;

      if (score > bestScore) {
        bestScore = score;
        bestPhrase = phrase;
      }
    }
  }

  if (!bestPhrase && targetTitle) {
    const titleWords = targetTitle.split(/\s+/).slice(0, 5);
    if (titleWords.length >= 2) {
      const textLower = text.toLowerCase();
      for (let len = Math.min(5, titleWords.length); len >= 2; len--) {
        const snippet = titleWords.slice(0, len).join(' ').toLowerCase();
        if (textLower.includes(snippet)) {
          return titleWords.slice(0, len).join(' ');
        }
      }
    }
  }

  return bestPhrase || null;
}

function extractParagraphs(html: string): ParagraphBlock[] {
  const paragraphs: ParagraphBlock[] = [];
  const regex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  let cumulative = 0;
  let index = 0;

  while ((match = regex.exec(html)) !== null) {
    const pHtml = match[0];
    const text = pHtml.replace(/<[^>]*>/g, '').trim();
    const wc = text.split(/\s+/).filter(Boolean).length;
    cumulative += wc;
    const hasExistingLink = /<a\s/i.test(pHtml);

    paragraphs.push({
      html: pHtml,
      text,
      tokens: tokenize(text),
      wordCount: wc,
      index,
      cumulativeWordCount: cumulative,
      hasExistingLink,
    });
    index++;
  }

  return paragraphs;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class SOTAInternalLinkEngine {
  private sitePages: SitePage[];
  private allTargetTokens: string[][] = [];
  private documentFrequency: Map<string, number> = new Map();

  constructor(sitePages?: SitePage[]) {
    this.sitePages = sitePages || [];
    if (this.sitePages.length > 0) {
      this.buildIndex();
    }
  }

  /**
   * Update the set of available site pages and rebuild the relevance index.
   * Called by EnterpriseContentOrchestrator before link generation.
   */
  updateSitePages(pages: SitePage[] | undefined): void {
    this.sitePages = pages || [];
    this.buildIndex();
  }

  /**
   * Build TF-IDF index from site pages.
   */
  private buildIndex(): void {
    this.allTargetTokens = this.sitePages.map((page) => {
      const combined = [
        page.title || '',
        page.description || '',
        page.slug?.replace(/[-_]/g, ' ') || '',
        ...(page.keywords || []),
        page.content?.substring(0, 500) || '',
      ].join(' ');
      return tokenize(combined);
    });

    this.documentFrequency = new Map();
    for (const tokens of this.allTargetTokens) {
      const unique = new Set(tokens);
      for (const token of unique) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) || 0) + 1);
      }
    }
  }

  /**
   * Analyze content and generate link opportunity objects.
   * Returns InternalLink[] sorted by relevance score (descending).
   *
   * @param html     - The HTML content to analyze
   * @param maxLinks - Maximum links to return (default: MAX_LINKS_PER_ARTICLE)
   */
  generateLinkOpportunities(html: string, maxLinks?: number): InternalLink[] {
    const limit = maxLinks ?? MAX_LINKS_PER_ARTICLE;

    if (this.sitePages.length === 0) return [];

    const corpusSize = this.sitePages.length;
    const paragraphs = extractParagraphs(html);

    // Score every (paragraph, target) pair
    const candidates: LinkCandidate[] = [];

    for (const para of paragraphs) {
      if (para.hasExistingLink) continue;
      if (para.wordCount < 10) continue;

      for (let ti = 0; ti < this.sitePages.length; ti++) {
        const target = this.sitePages[ti];
        const tTokens = this.allTargetTokens[ti];
        const relevance = calculateRelevance(para.tokens, tTokens, corpusSize, this.documentFrequency);

        if (relevance < MIN_RELEVANCE_SCORE) continue;

        const anchor = extractAnchorText(
          para.html,
          new Set(tTokens),
          target.title || '',
        );

        if (!anchor) continue;

        candidates.push({
          anchor,
          targetUrl: target.url,
          context: para.text.substring(0, 150),
          relevanceScore: relevance,
          priority: relevance,
          paragraphIndex: para.index,
          cumulativeWordCount: para.cumulativeWordCount,
        });
      }
    }

    // Sort by relevance descending
    candidates.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Greedy selection with constraints
    const selected: InternalLink[] = [];
    const usedTargetUrls = new Set<string>();
    const usedParagraphIndices = new Map<number, number>();
    let lastLinkedCumulativeWordCount = 0;

    for (const candidate of candidates) {
      if (selected.length >= limit) break;

      // No duplicate targets
      if (usedTargetUrls.has(candidate.targetUrl)) continue;

      // Per-paragraph limit
      const paraLinkCount = usedParagraphIndices.get(candidate.paragraphIndex) || 0;
      if (paraLinkCount >= MAX_LINKS_PER_PARAGRAPH) continue;

      // Minimum word distance
      if (
        lastLinkedCumulativeWordCount > 0 &&
        candidate.cumulativeWordCount - lastLinkedCumulativeWordCount < MIN_WORDS_BETWEEN_LINKS
      ) {
        continue;
      }

      selected.push({
        anchor: candidate.anchor,
        anchorText: candidate.anchor,
        targetUrl: candidate.targetUrl,
        url: candidate.targetUrl,
        text: candidate.anchor,
        context: candidate.context,
        priority: candidate.priority,
        relevanceScore: candidate.relevanceScore,
      });

      usedTargetUrls.add(candidate.targetUrl);
      usedParagraphIndices.set(candidate.paragraphIndex, paraLinkCount + 1);
      lastLinkedCumulativeWordCount = candidate.cumulativeWordCount;
    }

    return selected;
  }

  /**
   * Inject the given internal links into the HTML content.
   * Replaces the first occurrence of the anchor text within the matching paragraph.
   *
   * @param html  - The HTML content
   * @param links - Array of InternalLink objects to inject
   * @returns Modified HTML with links injected
   */
  injectContextualLinks(html: string, links: InternalLink[]): string {
    if (links.length === 0) return html;

    let result = html;

    // Process links from bottom to top to preserve string indices
    const sortedLinks = [...links].reverse();

    for (const link of sortedLinks) {
      const anchorText = link.anchor || link.anchorText || link.text || '';
      const targetUrl = link.targetUrl || link.url || '';

      if (!anchorText || !targetUrl) continue;

      // Escape for regex
      const escapedAnchor = anchorText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Find the anchor text in a <p> block that doesn't already contain an <a> to this URL
      const anchorRegex = new RegExp(
        `(<p[^>]*>(?:(?!<\\/p>)[\\s\\S])*?)\\b(${escapedAnchor})\\b((?:(?!<\\/p>)[\\s\\S])*?<\\/p>)`,
        'i'
      );

      const match = anchorRegex.exec(result);

      if (match && match.index !== undefined) {
        const before = match[1];
        const matchedText = match[2];
        const after = match[3];

        // Skip if this paragraph already has a link
        const paragraphHtml = before + matchedText + after;
        if (/<a\s/i.test(paragraphHtml)) continue;

        const replacement =
          before +
          `<a href="${targetUrl}" title="${matchedText}">${matchedText}</a>` +
          after;

        result =
          result.substring(0, match.index) +
          replacement +
          result.substring(match.index + match[0].length);
      }
    }

    return result;
  }
}

// ---------------------------------------------------------------------------
// Factory function — REQUIRED by EnterpriseContentOrchestrator
// ---------------------------------------------------------------------------

/**
 * Create a new SOTAInternalLinkEngine instance.
 *
 * @param sitePages - Optional array of site pages for link targeting
 * @returns Configured SOTAInternalLinkEngine instance
 */
export function createInternalLinkEngine(
  sitePages?: SitePage[],
): SOTAInternalLinkEngine {
  return new SOTAInternalLinkEngine(sitePages);
}

export default SOTAInternalLinkEngine;
