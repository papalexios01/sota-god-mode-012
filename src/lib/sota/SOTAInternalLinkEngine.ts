// ============================================================
// SOTA INTERNAL LINK ENGINE v3.0 - ENTERPRISE CONTEXTUAL LINKING
// 100% real URLs from crawled sitemap with 3-7 word rich anchors
// ============================================================

import type { InternalLink } from './types';

export interface SitePage {
  url: string;
  title: string;
  keywords?: string[];
  category?: string;
}

interface AnchorCandidate {
  anchor: string;
  page: SitePage;
  startIndex: number;
  endIndex: number;
  score: number;
  context: string;
}

interface PageTopic {
  page: SitePage;
  /** Normalized tokens describing this page (unordered). */
  tokenSet: Set<string>;
  /** Normalized, ordered tokens from the page title. */
  titleTokens: string[];
}

export class SOTAInternalLinkEngine {
  private sitePages: SitePage[];
  private stopWords: Set<string>;

  // Precomputed index for fast, high-quality matching
  private pageTopics: PageTopic[] = [];
  private tokenToPages: Map<string, number[]> = new Map();
  private tokenDf: Map<string, number> = new Map();
  private tokenIdf: Map<string, number> = new Map();

  constructor(sitePages: SitePage[] = []) {
    this.stopWords = new Set([
      'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'this', 'that',
      'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what',
      'which', 'who', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
      'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
      'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there', 'then'
    ]);

    this.sitePages = sitePages;
    this.rebuildIndex();
  }

  updateSitePages(pages: SitePage[]): void {
    this.sitePages = pages;
    this.rebuildIndex();
    console.log(`[InternalLinkEngine] Updated with ${pages.length} site pages`);
  }

  /**
   * Generate HIGH-QUALITY internal link opportunities
   * Only returns links with 3-7 word contextual anchor text
   */
  generateLinkOpportunities(content: string, maxLinks: number = 10): InternalLink[] {
    if (this.sitePages.length === 0) {
      console.log('[InternalLinkEngine] No site pages available - skipping internal links');
      return [];
    }

    console.log(`[InternalLinkEngine] Scanning content for links to ${this.sitePages.length} pages`);
    
    // Strip existing links to avoid re-linking
    const contentWithoutLinks = content.replace(/<a[^>]*>.*?<\/a>/gi, '');
    const plainText = this.stripHtml(contentWithoutLinks);

    const allCandidates = this.findBestAnchorsAcrossPages(plainText);

    // Greedy select: highest score first, no overlaps, unique URLs
    const usedUrls = new Set<string>();
    const usedRanges: Array<[number, number]> = [];
    const links: InternalLink[] = [];

    for (const c of allCandidates.sort((a, b) => b.score - a.score)) {
      if (links.length >= maxLinks) break;
      if (usedUrls.has(c.page.url)) continue;
      const overlaps = usedRanges.some(([start, end]) =>
        (c.startIndex < end && c.endIndex > start)
      );
      if (overlaps) continue;

      usedUrls.add(c.page.url);
      usedRanges.push([c.startIndex, c.endIndex]);
      links.push({
        anchor: c.anchor,
        targetUrl: c.page.url,
        context: c.context,
        priority: Math.min(100, c.score),
        relevanceScore: Math.min(100, c.score)
      });
    }

    console.log(`[InternalLinkEngine] Found ${links.length} high-quality link opportunities`);
    links.forEach(l => console.log(`  → "${l.anchor}" → ${l.targetUrl}`));
    
    return links;
  }

  /**
   * Find the best (topic-tight) anchors for ALL pages in one pass.
   *
   * Strategy:
   * - Enumerate 3–7 word n-grams in each sentence
   * - Score each n-gram against candidate pages using an IDF-weighted overlap + title-phrase match
   * - Keep only the BEST candidate per page
   */
  private findBestAnchorsAcrossPages(text: string): AnchorCandidate[] {
    if (this.sitePages.length === 0 || this.pageTopics.length === 0) return [];

    type Best = { score: number; candidate: AnchorCandidate };
    const bestByPage = new Map<number, Best>();

    const sentences = this.splitSentencesWithOffsets(text)
      .filter(s => s.text.trim().length >= 40);

    for (const s of sentences) {
      const tokenMatches = this.tokenizeWithPositions(s.text, s.startIndex);
      if (tokenMatches.length < 3) continue;

      for (let i = 0; i <= tokenMatches.length - 3; i++) {
        for (let len = 3; len <= 7; len++) {
          const j = i + len - 1;
          if (j >= tokenMatches.length) break;

          const span = tokenMatches.slice(i, j + 1);
          const anchor = this.cleanAnchorText(span.map(t => t.raw).join(' '));
          if (!anchor) continue;
          if (!this.isValidAnchor(anchor)) continue;

          // Only consider pages that share at least one non-generic token with the anchor
          const anchorTokens = span.map(t => t.token);
          const pageHitCounts = this.getCandidatePageHitCounts(anchorTokens);
          if (pageHitCounts.size === 0) continue;

          for (const [pageIdx, overlapCount] of pageHitCounts) {
            const topic = this.pageTopics[pageIdx];
            if (!topic) continue;

            const titleRun = this.longestContiguousRun(anchorTokens, topic.titleTokens);
            const hasSpecificToken = anchorTokens.some(t => (this.tokenIdf.get(t) ?? 0) >= 1.55);

            // Quality gates: avoid "best" matching everything.
            if (overlapCount < 2 && titleRun < 2 && !hasSpecificToken) continue;

            const score = this.scoreAnchorForTopic(anchorTokens, topic, overlapCount, titleRun);
            if (score < 70) continue;

            const startIndex = span[0].startIndex;
            const endIndex = span[span.length - 1].endIndex;

            const candidate: AnchorCandidate = {
              anchor,
              page: topic.page,
              startIndex,
              endIndex,
              score,
              context: s.text.trim().slice(0, 180)
            };

            const existing = bestByPage.get(pageIdx);
            if (!existing || score > existing.score) {
              bestByPage.set(pageIdx, { score, candidate });
            }
          }
        }
      }
    }

    return Array.from(bestByPage.values()).map(v => v.candidate);
  }

  /**
   * Clean and normalize anchor text
   */
  private cleanAnchorText(text: string): string {
    return text
      .replace(/^[^a-zA-Z0-9]+/, '') // Remove leading punctuation
      .replace(/[^a-zA-Z0-9]+$/, '') // Remove trailing punctuation
      .replace(/\s+/g, ' ')          // Normalize whitespace
      .trim();
  }

  /**
   * Validate that anchor text is high quality
   */
  private isValidAnchor(text: string): boolean {
    const words = text.split(/\s+/);
    
    // Must be 3-7 words
    if (words.length < 3 || words.length > 7) return false;
    
    // Must not start/end with a stop word (anchors should be self-contained concepts)
    const first = words[0]?.toLowerCase();
    const last = words[words.length - 1]?.toLowerCase();
    if (!first || !last) return false;
    if (this.stopWords.has(first) || this.stopWords.has(last)) return false;

    // At least 3 meaningful words (not stop words)
    const meaningfulWords = words.filter(w => w.length > 2 && !this.stopWords.has(w.toLowerCase()));
    if (meaningfulWords.length < 3) return false;

    // Ban obvious junk anchors
    const lower = text.toLowerCase();
    const banned = [
      'click here', 'learn more', 'read more', 'this article', 'this guide',
      'in this post', 'in this guide', 'in this article'
    ];
    if (banned.some(b => lower.includes(b))) return false;
    
    // No weird characters
    if (/[<>{}[\]|\\^]/.test(text)) return false;
    
    // Not too short or too long
    if (text.length < 15 || text.length > 70) return false;
    
    return true;
  }

  private scoreAnchorForTopic(
    anchorTokens: string[],
    topic: PageTopic,
    overlapCount: number,
    titleRun: number
  ): number {
    let score = 0;

    // Token overlap (IDF-weighted) = relevance
    const overlap = anchorTokens.filter(t => topic.tokenSet.has(t));
    const overlapScore = overlap.reduce((sum, t) => sum + ((this.tokenIdf.get(t) ?? 0) * 22), 0);
    score += overlapScore;

    // Title phrase match = strong intent alignment
    score += Math.min(60, titleRun * 18 + Math.max(0, titleRun - 1) * 10);

    // Multi-token overlap bonus
    if (overlapCount >= 3) score += 18;
    if (overlapCount >= 4) score += 10;

    // 4–5 words tends to read like a natural anchor
    const wc = anchorTokens.length;
    if (wc === 4 || wc === 5) score += 8;

    // Penalize anchors full of generic filler/pronouns
    const badTokens = new Set(['this', 'that', 'these', 'those', 'your', 'you', 'we', 'they', 'it', 'our', 'my']);
    const badCount = anchorTokens.filter(t => badTokens.has(t)).length;
    score -= badCount * 14;

    // Penalize if anchor begins/ends with generic words (even if valid)
    const generic = new Set(['best', 'top', 'guide', 'tips', 'review', 'reviews', 'comparison', 'comparisons', 'ultimate', 'complete']);
    const first = anchorTokens[0];
    const last = anchorTokens[anchorTokens.length - 1];
    if (generic.has(first) || generic.has(last)) score -= 12;

    // Normalize to 0..100
    score = Math.max(0, Math.min(100, score));
    return score;
  }

  /**
   * Extract meaningful keywords from page title
   */
  private extractKeywordsFromTitle(title: string): string[] {
    return title
      .toLowerCase()
      .split(/[\s\-_:,|]+/)
      .filter(w => w.length > 3 && !this.stopWords.has(w))
      .slice(0, 12);
  }

  /**
   * Extract keywords from URL slug
   */
  private extractKeywordsFromSlug(url: string): string[] {
    try {
      const pathname = new URL(url).pathname;
      const segments = pathname.split('/').filter(Boolean);
      const words = segments.flatMap(seg => seg.split(/[\-_]+/));
      return words
        .map(w => w.toLowerCase())
        .filter(w => w.length > 3 && !this.stopWords.has(w));
    } catch {
      return [];
    }
  }

  /**
   * Strip HTML tags from content
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Inject internal links into HTML content
   * Uses exact matching to find and replace anchor text
   */
  injectContextualLinks(content: string, links: InternalLink[]): string {
    if (links.length === 0) return content;
    
    const injectedAnchors = new Set<string>();
    let injectedCount = 0;

    // Split around existing links so we NEVER inject inside them (avoids fragile lookbehind regex)
    const parts = content.split(/(<a\b[^>]*>[\s\S]*?<\/a>)/gi);

    // Sort by anchor length (longer first) to avoid partial matches
    const sortedLinks = [...links].sort((a, b) => (b.anchor?.length || 0) - (a.anchor?.length || 0));

    for (const link of sortedLinks) {
      const anchor = (link.anchor || '').trim();
      if (!anchor || !link.targetUrl) continue;
      if (injectedAnchors.has(anchor.toLowerCase())) continue;

      const regex = this.buildFlexibleAnchorRegex(anchor);
      let didInject = false;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;
        // Keep existing <a>...</a> segments untouched
        if (/^<a\b/i.test(part)) continue;

        const match = part.match(regex);
        if (!match) continue;

        const actualText = match[0];
        const linkHtml = `<a href="${link.targetUrl}" title="Learn more about ${anchor}">${actualText}</a>`;
        parts[i] = part.replace(regex, linkHtml);
        didInject = true;
        break;
      }

      if (didInject) {
        injectedAnchors.add(anchor.toLowerCase());
        injectedCount++;
        console.log(`[InternalLinkEngine] ✅ Linked: "${anchor}" → ${link.targetUrl}`);
      }
    }

    console.log(`[InternalLinkEngine] Successfully injected ${injectedCount}/${links.length} links`);
    return parts.join('');
  }

  private buildFlexibleAnchorRegex(anchor: string): RegExp {
    const words = anchor
      .split(/\s+/)
      .map(w => w.trim())
      .filter(Boolean)
      .map(w => this.escapeRegex(w));

    // Match the same words even if the HTML contains newlines/non-breaking spaces
    const pattern = words.map(w => `\\b${w}\\b`).join('(?:\\s|&nbsp;|\\u00A0)+');
    return new RegExp(pattern, 'i');
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private rebuildIndex(): void {
    this.pageTopics = [];
    this.tokenToPages = new Map();
    this.tokenDf = new Map();
    this.tokenIdf = new Map();

    const total = this.sitePages.length;
    if (total === 0) return;

    // Build per-page topics and document frequency
    const pageTokens: Array<{ titleTokens: string[]; tokens: string[] }> = this.sitePages.map(p => {
      const titleTokens = this.tokenizeSimple(p.title)
        .map(t => t.toLowerCase())
        .filter(t => t.length > 2 && !this.stopWords.has(t));

      const tokens = this.extractTopicTokens(p);
      return { titleTokens, tokens };
    });

    for (const pt of pageTokens) {
      const unique = new Set(pt.tokens);
      for (const t of unique) {
        this.tokenDf.set(t, (this.tokenDf.get(t) ?? 0) + 1);
      }
    }

    // Compute IDF (higher = more specific)
    for (const [t, df] of this.tokenDf) {
      const idf = Math.log((total + 1) / (df + 1)) + 1;
      this.tokenIdf.set(t, idf);
    }

    // Build token -> pages inverted index
    for (let idx = 0; idx < this.sitePages.length; idx++) {
      const { tokens, titleTokens } = pageTokens[idx];
      const tokenSet = new Set(tokens);
      this.pageTopics[idx] = { page: this.sitePages[idx], tokenSet, titleTokens };

      for (const t of tokenSet) {
        const arr = this.tokenToPages.get(t);
        if (arr) arr.push(idx);
        else this.tokenToPages.set(t, [idx]);
      }
    }
  }

  private extractTopicTokens(page: SitePage): string[] {
    // Build a robust topic token set from title + URL path + provided keywords
    const fromTitle = this.tokenizeSimple(page.title);
    const fromSlug = this.extractKeywordsFromSlug(page.url);
    const fromKeywords = (page.keywords || []).flatMap(k => this.tokenizeSimple(k));

    const combined = [...fromTitle, ...fromSlug, ...fromKeywords]
      .map(t => t.toLowerCase())
      .map(t => t.replace(/[^a-z0-9']+/gi, ''))
      .filter(Boolean)
      .filter(t => t.length > 2)
      .filter(t => !this.stopWords.has(t));

    return Array.from(new Set(combined));
  }

  private tokenizeSimple(text: string): string[] {
    return (text.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)*/g) || []);
  }

  private splitSentencesWithOffsets(text: string): Array<{ text: string; startIndex: number }> {
    const out: Array<{ text: string; startIndex: number }> = [];

    // Sentence-ish chunks: split on . ! ? or newlines, while preserving offsets
    const regex = /[^.!?\n]+[.!?]?/g;
    for (const match of text.matchAll(regex)) {
      const raw = match[0] ?? '';
      const startIndex = match.index ?? -1;
      const trimmed = raw.trim();
      if (startIndex >= 0 && trimmed.length) {
        out.push({ text: trimmed, startIndex: startIndex + (raw.indexOf(trimmed) >= 0 ? raw.indexOf(trimmed) : 0) });
      }
    }
    return out;
  }

  private tokenizeWithPositions(sentence: string, globalOffset: number): Array<{ raw: string; token: string; startIndex: number; endIndex: number }> {
    const out: Array<{ raw: string; token: string; startIndex: number; endIndex: number }> = [];
    const regex = /[A-Za-z0-9]+(?:'[A-Za-z0-9]+)*/g;
    for (const m of sentence.matchAll(regex)) {
      const raw = m[0];
      const localStart = m.index ?? -1;
      if (localStart < 0) continue;
      const startIndex = globalOffset + localStart;
      const endIndex = startIndex + raw.length;
      out.push({ raw, token: raw.toLowerCase(), startIndex, endIndex });
    }
    return out;
  }

  private getCandidatePageHitCounts(anchorTokens: string[]): Map<number, number> {
    const hitCounts = new Map<number, number>();
    const totalPages = this.sitePages.length || 1;

    // Only use reasonably-specific tokens to seed candidates (prevents "best" from matching everything)
    const seedTokens = anchorTokens.filter(t => {
      if (this.stopWords.has(t)) return false;
      const df = this.tokenDf.get(t) ?? 0;
      const ratio = df / totalPages;
      return (this.tokenIdf.get(t) ?? 0) >= 1.25 && ratio <= 0.22;
    });

    const tokensToUse = seedTokens.length > 0 ? seedTokens : anchorTokens.filter(t => !this.stopWords.has(t));
    if (tokensToUse.length === 0) return hitCounts;

    for (const t of tokensToUse) {
      const pages = this.tokenToPages.get(t);
      if (!pages) continue;
      for (const idx of pages) {
        hitCounts.set(idx, (hitCounts.get(idx) ?? 0) + 1);
      }
    }

    return hitCounts;
  }

  private longestContiguousRun(anchorTokens: string[], titleTokens: string[]): number {
    if (anchorTokens.length === 0 || titleTokens.length === 0) return 0;
    let best = 0;
    for (let i = 0; i < anchorTokens.length; i++) {
      for (let j = 0; j < titleTokens.length; j++) {
        let k = 0;
        while (
          i + k < anchorTokens.length &&
          j + k < titleTokens.length &&
          anchorTokens[i + k] === titleTokens[j + k]
        ) {
          k++;
        }
        if (k > best) best = k;
      }
    }
    return best;
  }

  /**
   * Get topic clusters from site pages
   */
  identifyTopicClusters(): Map<string, SitePage[]> {
    const clusters = new Map<string, SitePage[]>();

    for (const page of this.sitePages) {
      const category = page.category || 'general';
      if (!clusters.has(category)) {
        clusters.set(category, []);
      }
      clusters.get(category)!.push(page);
    }

    return clusters;
  }

  /**
   * Get suggested internal links for a specific page
   */
  getSuggestedLinksForPage(currentUrl: string): SitePage[] {
    const current = this.sitePages.find(p => p.url === currentUrl);
    if (!current) return [];

    return this.sitePages
      .filter(p => p.url !== currentUrl)
      .map(page => ({
        page,
        score: this.calculatePageSimilarity(current, page)
      }))
      .filter(item => item.score > 30)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(item => item.page);
  }

  private calculatePageSimilarity(page1: SitePage, page2: SitePage): number {
    let score = 0;

    // Same category
    if (page1.category && page1.category === page2.category) {
      score += 40;
    }

    // Keyword overlap
    if (page1.keywords && page2.keywords) {
      const overlap = page1.keywords.filter(k => page2.keywords!.includes(k)).length;
      score += overlap * 15;
    }

    // Title word overlap
    const words1 = new Set(page1.title.toLowerCase().split(' '));
    const words2 = new Set(page2.title.toLowerCase().split(' '));
    const titleOverlap = [...words1].filter(w => words2.has(w) && !this.stopWords.has(w)).length;
    score += titleOverlap * 10;

    return score;
  }
}

export function createInternalLinkEngine(sitePages?: SitePage[]): SOTAInternalLinkEngine {
  return new SOTAInternalLinkEngine(sitePages || []);
}
