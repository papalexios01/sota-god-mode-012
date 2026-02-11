// src/lib/sota/ContentPostProcessor.ts
// SOTA Content Post-Processor v4.0 — Visual Break Enforcement & HTML Polish
// Exports: ContentPostProcessor (class with static methods)

import type { PostProcessingResult } from './types';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface ProcessOptions {
  maxConsecutiveWords?: number;
  usePullQuotes?: boolean;
}

interface Violation {
  startIndex: number;
  endIndex: number;
  wordCount: number;
  textSnippet: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VISUAL BREAK ELEMENTS (injected to break up walls of text)
// ═══════════════════════════════════════════════════════════════════════════════

const BREAK_ELEMENTS = [
  // Pro Tip Box
  `<div style="background: #ffffff; border: 1px solid #e0e7ff; border-left: 5px solid #6366f1; padding: 24px 28px; margin: 36px 0; border-radius: 0 16px 16px 0; box-shadow: 0 4px 20px rgba(99, 102, 241, 0.08); max-width: 100%; box-sizing: border-box;">
  <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px;">
    <span style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; width: 32px; height: 32px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; font-size: 16px;">💡</span>
    <strong style="color: #3730a3; font-size: 17px; font-weight: 800;">Pro Tip</strong>
  </div>
  <p style="color: #334155; font-size: 17px; margin: 0; line-height: 1.8;">Keep this principle in mind as you implement these strategies — consistency beats perfection every time.</p>
</div>`,

  // Key Insight Box
  `<div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-left: 4px solid #16a34a; padding: 20px 24px; border-radius: 0 12px 12px 0; margin: 36px 0; max-width: 100%; box-sizing: border-box;">
  <p style="font-weight: 700; color: #15803d; margin: 0 0 8px; font-size: 16px;">🔑 Key Insight</p>
  <p style="color: #166534; margin: 0; line-height: 1.7; font-size: 16px;">Understanding this concept is what separates beginners from experts in this field.</p>
</div>`,

  // Important Note Box
  `<div style="background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border-left: 4px solid #d97706; padding: 20px 24px; border-radius: 0 12px 12px 0; margin: 36px 0; max-width: 100%; box-sizing: border-box;">
  <p style="font-weight: 700; color: #92400e; margin: 0 0 8px; font-size: 16px;">📌 Important Note</p>
  <p style="color: #78350f; margin: 0; line-height: 1.7; font-size: 16px;">Don't skip this step — it's one of the most common mistakes that leads to subpar results.</p>
</div>`,

  // Quick Summary Box
  `<div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-left: 4px solid #2563eb; padding: 20px 24px; border-radius: 0 12px 12px 0; margin: 36px 0; max-width: 100%; box-sizing: border-box;">
  <p style="font-weight: 700; color: #1e40af; margin: 0 0 8px; font-size: 16px;">📋 Quick Summary</p>
  <p style="color: #1e3a5f; margin: 0; line-height: 1.7; font-size: 16px;">The bottom line? Focus on the fundamentals first, then optimize for advanced techniques once you've built a solid foundation.</p>
</div>`,
];

const PULL_QUOTES = [
  `<blockquote style="border-left: 4px solid #8b5cf6; background: linear-gradient(135deg, #faf5ff 0%, #f5f3ff 100%); margin: 36px 0; padding: 24px 28px; border-radius: 0 16px 16px 0; max-width: 100%; box-sizing: border-box;">
  <p style="font-size: 18px; font-style: italic; color: #4c1d95; line-height: 1.8; margin: 0;">"The difference between good and great often comes down to the details most people overlook."</p>
</blockquote>`,

  `<blockquote style="border-left: 4px solid #10b981; background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%); margin: 36px 0; padding: 24px 28px; border-radius: 0 16px 16px 0; max-width: 100%; box-sizing: border-box;">
  <p style="font-size: 18px; font-style: italic; color: #065f46; line-height: 1.8; margin: 0;">"Data doesn't lie — but it does require the right context to be useful."</p>
</blockquote>`,
];

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CLASS
// ═══════════════════════════════════════════════════════════════════════════════

export class ContentPostProcessor {

  /**
   * Process HTML content to enforce visual break rules.
   * Finds consecutive <p> blocks exceeding maxConsecutiveWords and injects
   * styled visual break elements between them.
   */
  static process(
    html: string,
    options: ProcessOptions = {}
  ): PostProcessingResult {
    const maxWords = options.maxConsecutiveWords || 200;
    const usePullQuotes = options.usePullQuotes !== false;

    if (!html || html.trim().length === 0) {
      return {
        html,
        wasModified: false,
        violations: [],
        elementsInjected: 0,
      };
    }

    // Find violations (consecutive <p> blocks exceeding word limit)
    const violations = ContentPostProcessor.findViolations(html, maxWords);

    if (violations.length === 0) {
      return {
        html,
        wasModified: false,
        violations: [],
        elementsInjected: 0,
      };
    }

    // Fix violations by injecting visual break elements
    let result = html;
    let elementsInjected = 0;
    let offset = 0;

    // Build pool of break elements
    const breakPool = [...BREAK_ELEMENTS];
    if (usePullQuotes) {
      breakPool.push(...PULL_QUOTES);
    }

    // Process violations in reverse order to preserve indices
    const sortedViolations = [...violations].sort((a, b) => b.startIndex - a.startIndex);

    for (const violation of sortedViolations) {
      // Find a good insertion point (between paragraphs near the middle of the violation)
      const violationHtml = result.substring(violation.startIndex, violation.endIndex);
      const paragraphs = violationHtml.match(/<\/p>/gi) || [];

      if (paragraphs.length < 2) continue;

      // Find the midpoint paragraph break
      const midParagraphIndex = Math.floor(paragraphs.length / 2);
      let currentParagraphEnd = 0;
      let insertionPoint = -1;

      for (let i = 0; i <= midParagraphIndex; i++) {
        const nextEnd = violationHtml.indexOf('</p>', currentParagraphEnd);
        if (nextEnd !== -1) {
          currentParagraphEnd = nextEnd + 4; // length of '</p>'
          if (i === midParagraphIndex) {
            insertionPoint = violation.startIndex + currentParagraphEnd;
          }
        }
      }

      if (insertionPoint === -1) continue;

      // Select a break element (cycle through pool)
      const breakElement = breakPool[elementsInjected % breakPool.length];

      // Insert the break element
      result =
        result.substring(0, insertionPoint) +
        '\n\n' + breakElement + '\n\n' +
        result.substring(insertionPoint);

      elementsInjected++;
    }

    return {
      html: result,
      wasModified: elementsInjected > 0,
      violations,
      elementsInjected,
    };
  }

  /**
   * Find consecutive <p> blocks that exceed the word limit without a visual break.
   */
  static findViolations(html: string, maxWords: number): Violation[] {
    const violations: Violation[] = [];

    // Visual break elements that reset the consecutive word counter
    const breakPatterns = [
      /<div\s[^>]*style\s*=/i,
      /<table[\s>]/i,
      /<blockquote[\s>]/i,
      /<details[\s>]/i,
      /<figure[\s>]/i,
      /<ul[\s>]/i,
      /<ol[\s>]/i,
      /<h[1-6][\s>]/i,
      /<hr[\s>/]/i,
      /<iframe[\s>]/i,
      /<!-- .* -->/i,
    ];

    // Split content into segments separated by visual breaks
    // We'll walk through the HTML and track consecutive <p> word counts

    const tagRegex = /<\/?[a-z][^>]*>/gi;
    let lastIndex = 0;
    let consecutiveWords = 0;
    let segmentStart = 0;
    let inParagraph = false;

    // Simple approach: find all <p>...</p> blocks and check gaps between visual elements
    const pBlocks = html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];

    if (pBlocks.length === 0) return violations;

    let currentRunStart = -1;
    let currentRunWords = 0;

    for (let i = 0; i < pBlocks.length; i++) {
      const block = pBlocks[i];
      const blockIndex = html.indexOf(block, lastIndex);

      if (blockIndex === -1) continue;

      // Check if there's a visual break between this block and the last one
      if (lastIndex > 0 && blockIndex > lastIndex) {
        const between = html.substring(lastIndex, blockIndex);
        const hasBreak = breakPatterns.some(pattern => pattern.test(between));

        if (hasBreak) {
          // Check if the current run exceeds the limit
          if (currentRunWords > maxWords && currentRunStart !== -1) {
            const text = html.substring(currentRunStart, lastIndex).replace(/<[^>]*>/g, ' ').trim();
            violations.push({
              startIndex: currentRunStart,
              endIndex: lastIndex,
              wordCount: currentRunWords,
              textSnippet: text.substring(0, 80) + '...',
            });
          }
          // Reset the run
          currentRunStart = blockIndex;
          currentRunWords = 0;
        }
      }

      if (currentRunStart === -1) {
        currentRunStart = blockIndex;
      }

      // Count words in this paragraph
      const plainText = block.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const wordCount = plainText ? plainText.split(' ').filter(Boolean).length : 0;
      currentRunWords += wordCount;

      lastIndex = blockIndex + block.length;
    }

    // Check the final run
    if (currentRunWords > maxWords && currentRunStart !== -1) {
      const text = html.substring(currentRunStart, lastIndex).replace(/<[^>]*>/g, ' ').trim();
      violations.push({
        startIndex: currentRunStart,
        endIndex: lastIndex,
        wordCount: currentRunWords,
        textSnippet: text.substring(0, 80) + '...',
      });
    }

    return violations;
  }

  /**
   * Validate that content passes visual break rules.
   */
  static validate(
    html: string,
    maxWords: number = 200
  ): { valid: boolean; violations: Violation[] } {
    const violations = ContentPostProcessor.findViolations(html, maxWords);
    return {
      valid: violations.length === 0,
      violations,
    };
  }
}

export default ContentPostProcessor;
