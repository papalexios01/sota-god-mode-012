/**
 * SEO Health Scorer - Enterprise Page Analysis Engine
 * Analyzes pages and generates 0-100 health scores for prioritization
 */

import type { SEOHealthAnalysis } from './GodModeTypes';

export class SEOHealthScorer {
  private proxyUrl: string;

  constructor(proxyUrl?: string) {
    this.proxyUrl = proxyUrl || '';
  }

  /**
   * Analyze a page and return comprehensive SEO health metrics
   */
  async analyzePage(url: string): Promise<SEOHealthAnalysis> {
    const startTime = Date.now();
    
    try {
      const html = await this.fetchPageContent(url);
      const analysis = this.analyzeHtml(url, html);
      
      console.log(`[SEOHealthScorer] Analyzed ${url} in ${Date.now() - startTime}ms - Score: ${analysis.score}`);
      
      return analysis;
    } catch (error) {
      console.error(`[SEOHealthScorer] Error analyzing ${url}:`, error);
      
      // Return a low score on error to flag for manual review
      return {
        url,
        score: 0,
        wordCount: 0,
        headingStructure: { h1Count: 0, h2Count: 0, h3Count: 0, isValid: false },
        freshness: { lastModified: null, daysSinceUpdate: 999, isStale: true },
        links: { internalCount: 0, externalCount: 0, brokenCount: 0 },
        schema: { hasSchema: false, types: [] },
        issues: [`Failed to analyze: ${error instanceof Error ? error.message : 'Unknown error'}`],
        recommendations: ['Manual review required'],
      };
    }
  }

  /**
   * Fetch page content via Jina Reader or direct fetch
   */
  private async fetchPageContent(url: string): Promise<string> {
    // Try Jina Reader first for better content extraction
    try {
      const jinaUrl = `https://r.jina.ai/${url}`;
      const response = await fetch(jinaUrl, {
        headers: { 'Accept': 'text/html' },
        signal: AbortSignal.timeout(15000),
      });
      
      if (response.ok) {
        return await response.text();
      }
    } catch {
      console.log('[SEOHealthScorer] Jina Reader failed, trying direct fetch');
    }
    
    // Fallback to direct fetch
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SEOHealthBot/1.0)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(15000),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return await response.text();
  }

  /**
   * Analyze HTML content and generate health metrics
   */
  private analyzeHtml(url: string, html: string): SEOHealthAnalysis {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 100; // Start at 100, deduct for issues
    
    // Parse basic content
    const textContent = this.extractTextContent(html);
    const wordCount = this.countWords(textContent);
    
    // ===== WORD COUNT SCORING =====
    if (wordCount < 500) {
      score -= 30;
      issues.push(`Very thin content: ${wordCount} words (target: 2500+)`);
      recommendations.push('Expand content significantly with in-depth coverage');
    } else if (wordCount < 1000) {
      score -= 20;
      issues.push(`Thin content: ${wordCount} words`);
      recommendations.push('Add more comprehensive content sections');
    } else if (wordCount < 1500) {
      score -= 10;
      issues.push(`Below optimal word count: ${wordCount} words`);
      recommendations.push('Consider expanding with more details and examples');
    } else if (wordCount < 2500) {
      score -= 5;
    }
    
    // ===== HEADING STRUCTURE =====
    const headingStructure = this.analyzeHeadings(html);
    
    if (headingStructure.h1Count === 0) {
      score -= 15;
      issues.push('Missing H1 tag');
      recommendations.push('Add a single, descriptive H1 tag');
    } else if (headingStructure.h1Count > 1) {
      score -= 10;
      issues.push(`Multiple H1 tags: ${headingStructure.h1Count}`);
      recommendations.push('Use only one H1 tag per page');
    }
    
    if (headingStructure.h2Count === 0) {
      score -= 10;
      issues.push('No H2 subheadings');
      recommendations.push('Add H2 headings to structure content');
    } else if (headingStructure.h2Count < 3 && wordCount > 1000) {
      score -= 5;
      issues.push(`Few H2 headings for content length`);
      recommendations.push('Add more H2 subheadings for better structure');
    }
    
    // ===== FRESHNESS =====
    const freshness = this.analyzeFreshness(html);
    
    if (freshness.daysSinceUpdate > 365) {
      score -= 20;
      issues.push(`Content is ${freshness.daysSinceUpdate} days old`);
      recommendations.push('Update with fresh information and current year references');
    } else if (freshness.daysSinceUpdate > 180) {
      score -= 10;
      issues.push(`Content hasn't been updated in ${freshness.daysSinceUpdate} days`);
      recommendations.push('Consider refreshing with recent data');
    } else if (freshness.daysSinceUpdate > 90) {
      score -= 5;
    }
    
    // ===== INTERNAL/EXTERNAL LINKS =====
    const links = this.analyzeLinks(html, url);
    
    if (links.internalCount === 0) {
      score -= 15;
      issues.push('No internal links');
      recommendations.push('Add relevant internal links to related content');
    } else if (links.internalCount < 3) {
      score -= 5;
      issues.push('Few internal links');
      recommendations.push('Add more internal links for better site structure');
    }
    
    if (links.externalCount === 0) {
      score -= 5;
      issues.push('No external authority links');
      recommendations.push('Add citations to authoritative sources');
    }
    
    // ===== SCHEMA MARKUP =====
    const schema = this.analyzeSchema(html);
    
    if (!schema.hasSchema) {
      score -= 10;
      issues.push('No structured data/schema markup');
      recommendations.push('Add JSON-LD schema (Article, FAQ, HowTo, etc.)');
    }
    
    // ===== CONTENT QUALITY SIGNALS =====
    const hasImages = /<img\s/i.test(html);
    if (!hasImages) {
      score -= 5;
      issues.push('No images detected');
      recommendations.push('Add relevant images with alt text');
    }
    
    const hasMetaDescription = /<meta\s+name=["']description["']/i.test(html);
    if (!hasMetaDescription) {
      score -= 10;
      issues.push('Missing meta description');
      recommendations.push('Add a compelling meta description');
    }
    
    // Ensure score stays in bounds
    score = Math.max(0, Math.min(100, score));
    
    return {
      url,
      score,
      wordCount,
      headingStructure,
      freshness,
      links,
      schema,
      issues,
      recommendations,
    };
  }

  /**
   * Extract text content from HTML
   */
  private extractTextContent(html: string): string {
    // Remove scripts, styles, and HTML tags
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Analyze heading structure
   */
  private analyzeHeadings(html: string): SEOHealthAnalysis['headingStructure'] {
    const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
    const h2Count = (html.match(/<h2[\s>]/gi) || []).length;
    const h3Count = (html.match(/<h3[\s>]/gi) || []).length;
    
    const isValid = h1Count === 1 && h2Count >= 2;
    
    return { h1Count, h2Count, h3Count, isValid };
  }

  /**
   * Analyze content freshness
   */
  private analyzeFreshness(html: string): SEOHealthAnalysis['freshness'] {
    let lastModified: Date | null = null;
    
    // Try to find published/modified dates in common formats
    const datePatterns = [
      /dateModified["']\s*:\s*["']([^"']+)["']/i,
      /datePublished["']\s*:\s*["']([^"']+)["']/i,
      /article:modified_time["']\s*content=["']([^"']+)["']/i,
      /article:published_time["']\s*content=["']([^"']+)["']/i,
      /(\d{4}-\d{2}-\d{2})/,
    ];
    
    for (const pattern of datePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        try {
          const parsed = new Date(match[1]);
          if (!isNaN(parsed.getTime())) {
            lastModified = parsed;
            break;
          }
        } catch {
          // Continue to next pattern
        }
      }
    }
    
    const now = new Date();
    const daysSinceUpdate = lastModified
      ? Math.floor((now.getTime() - lastModified.getTime()) / (1000 * 60 * 60 * 24))
      : 999; // Assume very old if no date found
    
    return {
      lastModified,
      daysSinceUpdate,
      isStale: daysSinceUpdate > 90,
    };
  }

  /**
   * Analyze internal and external links
   */
  private analyzeLinks(html: string, pageUrl: string): SEOHealthAnalysis['links'] {
    const linkMatches = html.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi) || [];
    
    let internalCount = 0;
    let externalCount = 0;
    
    try {
      const pageOrigin = new URL(pageUrl).origin;
      
      for (const link of linkMatches) {
        const hrefMatch = link.match(/href=["']([^"']+)["']/i);
        if (!hrefMatch) continue;
        
        const href = hrefMatch[1];
        
        // Skip anchors, mailto, tel, javascript
        if (href.startsWith('#') || href.startsWith('mailto:') || 
            href.startsWith('tel:') || href.startsWith('javascript:')) {
          continue;
        }
        
        try {
          const absoluteUrl = href.startsWith('http') ? href : new URL(href, pageUrl).href;
          const linkOrigin = new URL(absoluteUrl).origin;
          
          if (linkOrigin === pageOrigin) {
            internalCount++;
          } else {
            externalCount++;
          }
        } catch {
          // Relative link that couldn't be parsed
          internalCount++;
        }
      }
    } catch {
      // URL parsing failed
    }
    
    return { internalCount, externalCount, brokenCount: 0 };
  }

  /**
   * Analyze schema markup
   */
  private analyzeSchema(html: string): SEOHealthAnalysis['schema'] {
    const schemaTypes: string[] = [];
    
    // Find JSON-LD scripts
    const jsonLdMatches = html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
    
    for (const match of jsonLdMatches) {
      try {
        const jsonContent = match.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
        const parsed = JSON.parse(jsonContent);
        
        if (parsed['@type']) {
          if (Array.isArray(parsed['@type'])) {
            schemaTypes.push(...parsed['@type']);
          } else {
            schemaTypes.push(parsed['@type']);
          }
        }
      } catch {
        // JSON parsing failed
      }
    }
    
    return {
      hasSchema: schemaTypes.length > 0,
      types: [...new Set(schemaTypes)],
    };
  }

  /**
   * Batch analyze multiple pages with throttling
   */
  async batchAnalyze(
    urls: string[],
    options: {
      concurrency?: number;
      onProgress?: (completed: number, total: number) => void;
      signal?: AbortSignal;
    } = {}
  ): Promise<SEOHealthAnalysis[]> {
    const { concurrency = 2, onProgress, signal } = options;
    const results: SEOHealthAnalysis[] = [];
    let completed = 0;
    
    // Process in batches
    for (let i = 0; i < urls.length; i += concurrency) {
      if (signal?.aborted) break;
      
      const batch = urls.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(url => this.analyzePage(url))
      );
      
      results.push(...batchResults);
      completed += batch.length;
      
      onProgress?.(completed, urls.length);
      
      // Throttle between batches
      if (i + concurrency < urls.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }
}

export const seoHealthScorer = new SEOHealthScorer();
