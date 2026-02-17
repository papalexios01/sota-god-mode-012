// src/lib/sota/ContentPostProcessor.ts
// SOTA Content Post-Processor v5.0 — Anti-AI Detection, Visual Break Enforcement, FAQ Builder
// Exports: ContentPostProcessor (class), enhanceHtmlDesign, injectMissingTerms, addFaqSection,
//          postProcessContent, removeAIPatterns

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
// AI PHRASE REMOVAL
// ═══════════════════════════════════════════════════════════════════════════════

const AI_PHRASE_PATTERNS: RegExp[] = [
  /\bin today's (?:fast-paced|digital|modern|ever-changing|ever-evolving|competitive|dynamic) (?:world|landscape|era|environment|age)\b/gi,
  /\bin the ever-(?:evolving|changing|expanding|growing)\b/gi,
  /\bin this comprehensive guide\b/gi,
  /\bin this article,? we (?:will|shall|are going to)\b/gi,
  /\bin conclusion\b/gi,
  /\bto (?:sum up|summarize|wrap up|recap)\b/gi,
  /\bwithout further ado\b/gi,
  /\bit'?s (?:important|worth|crucial|vital|essential) to (?:note|mention|remember|understand|recognize|highlight) that\b/gi,
  /\bit should be noted that\b/gi,
  /\bin the realm of\b/gi,
  /\bdelve(?:s|d)? (?:into|deeper)\b/gi,
  /\ba testament to\b/gi,
  /\bundeniably\b/gi,
  /\bit goes without saying\b/gi,
  /\blet'?s (?:dive|explore|delve|get started|begin|take a look)\b/gi,
  /\bwhether you'?re a (?:beginner|seasoned|novice|expert)\b[^.]*[.]/gi,
  /\blook no further\b/gi,
  /\byou'?re not alone\b/gi,
  /\brest assured\b/gi,
  /\ba (?:plethora|myriad|wealth|wide array|vast array) of\b/gi,
  /\bcannot be overstated\b/gi,
  /\bplays a (?:crucial|vital|pivotal|key|important) role\b/gi,
  /\bstands as a testament\b/gi,
  /\bunlock the (?:power|potential|secrets?)\b/gi,
  /\btake [\w\s]+ to the next level\b/gi,
  /\bare you looking to\b/gi,
  /\bhave you ever wondered\b/gi,
  /\bas we all know\b/gi,
  /\bneedless to say\b/gi,
  /\bgame.?changer\b/gi,
  /\bseamless(?:ly)?\b/gi,
  /\brobust\b/gi,
  /\bleverage(?:s|d)?\b/gi,
  /\butilize(?:s|d)?\b/gi,
  /\bfacilitate(?:s|d)?\b/gi,
  /\bholistic\b/gi,
  /\btapestry\b/gi,
  /\bembark(?:s|ed)? on\b/gi,
  /\bparamount\b/gi,
  /\bpivotal\b/gi,
  /\bencompass(?:es|ed|ing)?\b/gi,
  /\bgroundbreaking\b/gi,
  /\bcutting-edge\b/gi,
  /\bstate-of-the-art\b/gi,
  /\bsynergy\b/gi,
  /\bparadigm\b/gi,
  /\bendeavou?r(?:s|ed)?\b/gi,
  /\bcommence(?:s|d)?\b/gi,
  /\bharness(?:es|ed|ing)?\b/gi,
  /\bbolster(?:s|ed)?\b/gi,
  /\bgarner(?:s|ed)?\b/gi,
  /\bpropel(?:s|led)?\b/gi,
  /\bunderscore(?:s|d)?\b/gi,
  /\bepitomize(?:s|d)?\b/gi,
  /\btransformative\b/gi,
  /\brevolutionize(?:s|d)?\b/gi,
  /\bmoreover,?\s/gi,
  /\bfurthermore,?\s/gi,
  /\badditionally,?\s/gi,
  /\bconsequently,?\s/gi,
  /\bsubsequently,?\s/gi,
  /\bnevertheless,?\s/gi,
  /\bnotwithstanding,?\s/gi,
];

/**
 * Remove known AI-detectable phrases and replace banned words.
 * Exported for use in post-processing pipelines.
 */
export function removeAIPatterns(html: string): string {
  if (!html) return '';
  let cleaned = html;

  for (const pattern of AI_PHRASE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Clean up leftover artifacts
  cleaned = cleaned.replace(/<p[^>]*>\s*<\/p>/g, '');
  cleaned = cleaned.replace(/\.\s*\./g, '.');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/\s{2,}/g, ' ');

  return cleaned;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VISUAL BREAK ELEMENT FACTORIES (dynamic, not static canned text)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generates a contextual break element based on surrounding content.
 * Extracts a short phrase from the preceding paragraph to make the element feel organic.
 */
function buildContextualBreakElement(
  precedingParagraphText: string,
  elementIndex: number,
): string {
  // Extract a short theme phrase from the preceding paragraph
  const words = precedingParagraphText.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean);
  const themeSlice = words.slice(0, Math.min(6, words.length)).join(' ');

  const templates = [
    // Pro Tip (indigo)
    (theme: string) =>
      `<div style="background: #ffffff; border: 1px solid #e0e7ff; border-left: 5px solid #6366f1; padding: 24px 28px; margin: 36px 0; border-radius: 0 16px 16px 0; box-shadow: 0 4px 20px rgba(99, 102, 241, 0.08); max-width: 100%; box-sizing: border-box;">
  <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px;">
    <span style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; width: 32px; height: 32px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; font-size: 16px;">💡</span>
    <strong style="color: #3730a3; font-size: 17px; font-weight: 800;">Pro Tip</strong>
  </div>
  <p style="color: #334155; font-size: 17px; margin: 0; line-height: 1.8;">If you're applying what we just covered about ${theme}, start small — test it on one page first, measure for 2 weeks, then scale.</p>
</div>`,
    // Key Insight (green)
    (theme: string) =>
      `<div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-left: 4px solid #16a34a; padding: 20px 24px; border-radius: 0 12px 12px 0; margin: 36px 0; max-width: 100%; box-sizing: border-box;">
  <p style="font-weight: 700; color: #15803d; margin: 0 0 8px; font-size: 16px;">🔑 Key Insight</p>
  <p style="color: #166534; margin: 0; line-height: 1.7;">The section above about ${theme} is where 80% of the value sits. Don't skip past it — re-read it if you need to.</p>
</div>`,
    // Important Note (amber)
    (theme: string) =>
      `<div style="background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border-left: 4px solid #d97706; padding: 20px 24px; border-radius: 0 12px 12px 0; margin: 36px 0; max-width: 100%; box-sizing: border-box;">
  <p style="font-weight: 700; color: #92400e; margin: 0 0 8px; font-size: 16px;">📌 Don't Skip This</p>
  <p style="color: #78350f; margin: 0; line-height: 1.7;">What we just covered about ${theme} trips up even experienced practitioners. Bookmark this section.</p>
</div>`,
    // Quick Summary (blue)
    (theme: string) =>
      `<div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-left: 4px solid #2563eb; padding: 20px 24px; border-radius: 0 12px 12px 0; margin: 36px 0; max-width: 100%; box-sizing: border-box;">
  <p style="font-weight: 700; color: #1e40af; margin: 0 0 8px; font-size: 16px;">📋 Quick Recap</p>
  <p style="color: #1e3a5f; margin: 0; line-height: 1.7;">Get the fundamentals of ${theme} right first. Advanced tactics won't save a weak foundation.</p>
</div>`,
  ];

  const template = templates[elementIndex % templates.length];
  return template(themeSlice || 'this concept');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CLASS — Visual Break Enforcement
// ═══════════════════════════════════════════════════════════════════════════════

export class ContentPostProcessor {
  static process(html: string, options: ProcessOptions = {}): PostProcessingResult {
    const maxWords = options.maxConsecutiveWords || 200;

    if (!html || html.trim().length === 0) {
      return { html, wasModified: false, violations: [], elementsInjected: 0 };
    }

    const violations = ContentPostProcessor.findViolations(html, maxWords);

    if (violations.length === 0) {
      return { html, wasModified: false, violations: [], elementsInjected: 0 };
    }

    let result = html;
    let elementsInjected = 0;

    const sortedViolations = [...violations].sort((a, b) => b.startIndex - a.startIndex);

    for (const violation of sortedViolations) {
      const violationHtml = result.substring(violation.startIndex, violation.endIndex);
      const paragraphs = violationHtml.match(/<\/p>/gi) || [];
      if (paragraphs.length < 2) continue;

      const midParagraphIndex = Math.floor(paragraphs.length / 2);
      let currentParagraphEnd = 0;
      let insertionPoint = -1;

      for (let i = 0; i <= midParagraphIndex; i++) {
        const nextEnd = violationHtml.indexOf('</p>', currentParagraphEnd);
        if (nextEnd !== -1) {
          currentParagraphEnd = nextEnd + 4;
          if (i === midParagraphIndex) {
            insertionPoint = violation.startIndex + currentParagraphEnd;
          }
        }
      }

      if (insertionPoint === -1) continue;

      // Extract preceding paragraph text for contextual element generation
      const precedingChunk = result.substring(
        Math.max(0, insertionPoint - 500),
        insertionPoint,
      );
      const breakElement = buildContextualBreakElement(precedingChunk, elementsInjected);

      result =
        result.substring(0, insertionPoint) +
        '\n\n' + breakElement + '\n\n' +
        result.substring(insertionPoint);
      elementsInjected++;
    }

    return { html: result, wasModified: elementsInjected > 0, violations, elementsInjected };
  }

  static findViolations(html: string, maxWords: number): Violation[] {
    const violations: Violation[] = [];

    const breakPatterns = [
      /<div\s[^>]*style\s*=/i, /<table[\s>]/i, /<blockquote[\s>]/i,
      /<details[\s>]/i, /<figure[\s>]/i, /<ul[\s>]/i, /<ol[\s>]/i,
      /<h[1-6][\s>]/i, /<hr[\s>/]/i, /<iframe[\s>]/i, /<!-- .* -->/i,
    ];

    const pBlocks = html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
    if (pBlocks.length === 0) return violations;

    let lastIndex = 0;
    let currentRunStart = -1;
    let currentRunWords = 0;

    for (let i = 0; i < pBlocks.length; i++) {
      const block = pBlocks[i];
      const blockIndex = html.indexOf(block, lastIndex);
      if (blockIndex === -1) continue;

      if (lastIndex > 0 && blockIndex > lastIndex) {
        const between = html.substring(lastIndex, blockIndex);
        const hasBreak = breakPatterns.some(pattern => pattern.test(between));

        if (hasBreak) {
          if (currentRunWords > maxWords && currentRunStart !== -1) {
            const text = html.substring(currentRunStart, lastIndex).replace(/<[^>]*>/g, ' ').trim();
            violations.push({
              startIndex: currentRunStart, endIndex: lastIndex,
              wordCount: currentRunWords, textSnippet: text.substring(0, 80) + '...',
            });
          }
          currentRunStart = blockIndex;
          currentRunWords = 0;
        }
      }

      if (currentRunStart === -1) currentRunStart = blockIndex;

      const plainText = block.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      currentRunWords += plainText ? plainText.split(' ').filter(Boolean).length : 0;
      lastIndex = blockIndex + block.length;
    }

    if (currentRunWords > maxWords && currentRunStart !== -1) {
      const text = html.substring(currentRunStart, lastIndex).replace(/<[^>]*>/g, ' ').trim();
      violations.push({
        startIndex: currentRunStart, endIndex: lastIndex,
        wordCount: currentRunWords, textSnippet: text.substring(0, 80) + '...',
      });
    }

    return violations;
  }

  static validate(html: string, maxWords: number = 200): { valid: boolean; violations: Violation[] } {
    const violations = ContentPostProcessor.findViolations(html, maxWords);
    return { valid: violations.length === 0, violations };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STANDALONE EXPORTED FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Enhance HTML with styled headings, spacing, and typography.
 * Only styles elements that don't already have inline styles.
 */
export function enhanceHtmlDesign(html: string): string {
  if (!html) return '';
  let result = html;

  // Style ONLY unstyled elements (check for existing style attribute)
  result = result.replace(
    /<h2>([^<]+)<\/h2>/g,
    '<h2 style="color: #0f172a; font-size: 30px; font-weight: 900; margin: 56px 0 24px 0; padding-bottom: 14px; border-bottom: 4px solid #10b981; letter-spacing: -0.025em; line-height: 1.2;">$1</h2>',
  );
  result = result.replace(
    /<h3>([^<]+)<\/h3>/g,
    '<h3 style="color: #1e293b; font-size: 23px; font-weight: 800; margin: 40px 0 16px 0; letter-spacing: -0.02em; line-height: 1.3;">$1</h3>',
  );
  result = result.replace(
    /<h4>([^<]+)<\/h4>/g,
    '<h4 style="color: #334155; font-size: 19px; font-weight: 700; margin: 32px 0 12px 0; line-height: 1.3;">$1</h4>',
  );
  result = result.replace(
    /<p(?!\s)>/g,
    '<p style="font-size: 18px; margin: 0 0 20px 0; line-height: 1.8; color: #334155;">',
  );
  result = result.replace(/<ul(?!\s)>/g, '<ul style="margin: 0 0 24px 0; padding-left: 24px;">');
  result = result.replace(/<ol(?!\s)>/g, '<ol style="margin: 0 0 24px 0; padding-left: 24px;">');
  result = result.replace(/<li(?!\s)>/g, '<li style="margin: 0 0 12px 0; line-height: 1.75;">');

  // Spacing between block elements
  result = result.replace(/<\/div>\s*<h2/g, '</div>\n\n<h2');
  result = result.replace(/<\/p>\s*<h2/g, '</p>\n\n<h2');

  // Remove empty paragraphs
  result = result.replace(/<p[^>]*>\s*<\/p>/g, '');

  return result;
}

/**
 * Inject missing NeuronWriter terms naturally into existing paragraphs.
 *
 * v5.0: Uses 14 varied sentence templates, contextual paragraph matching,
 * and no-repeat logic to avoid AI-detectable patterns.
 */
export function injectMissingTerms(
  html: string,
  missingTerms: string[],
): string {
  if (!html || !missingTerms || missingTerms.length === 0) return html;

  // Sentence templates — each produces a different syntactic structure.
  // The term is lowercased if it appears mid-sentence.
  const TEMPLATES: Array<(term: string) => string> = [
    (t) => ` That's especially true when you factor in ${t}.`,
    (t) => ` Smart practitioners pay close attention to ${t} at this stage.`,
    (t) => ` The same logic applies to ${t} — don't overlook it.`,
    (t) => ` ${capitalize(t)} fits directly into this approach, and skipping it costs you.`,
    (t) => ` You'll also want to think about how ${t} affects your results here.`,
    (t) => ` One thing most guides miss? The connection between this and ${t}.`,
    (t) => ` And yes — ${t} matters more than most people realize at this point.`,
    (t) => ` If you're ignoring ${t}, you're leaving value on the table.`,
    (t) => ` Here's the kicker: ${t} changes the equation entirely.`,
    (t) => ` Real-world data shows ${t} has a measurable impact on outcomes here.`,
    (t) => ` For what it's worth, ${t} is something the top performers always nail.`,
    (t) => ` Quick note: ${t} deserves more attention than it usually gets.`,
    (t) => ` Factor in ${t} and the picture starts to look different.`,
    (t) => ` Don't sleep on ${t} — it compounds over time.`,
  ];

  let result = html;
  const termsToInject = missingTerms.slice(0, 30);

  // Find all substantial paragraphs (50+ chars of text content)
  const paragraphRegex = /<p[^>]*>([^<]{50,})<\/p>/gi;
  const paragraphPositions: Array<{ index: number; text: string; endIndex: number }> = [];
  let pMatch: RegExpExecArray | null;

  while ((pMatch = paragraphRegex.exec(result)) !== null) {
    paragraphPositions.push({
      index: pMatch.index,
      text: pMatch[1],
      endIndex: pMatch.index + pMatch[0].length,
    });
  }

  if (paragraphPositions.length === 0) return result;

  // Distribute terms across paragraphs evenly, avoiding same-paragraph clustering
  const interval = Math.max(1, Math.floor(paragraphPositions.length / termsToInject.length));
  let lastTemplateIndex = -1;
  let injectedCount = 0;

  for (let i = 0; i < termsToInject.length; i++) {
    const term = termsToInject[i];
    const targetIdx = Math.min(i * interval, paragraphPositions.length - 1);
    const para = paragraphPositions[targetIdx];

    // Skip if term already exists in this paragraph
    if (para.text.toLowerCase().includes(term.toLowerCase())) continue;

    // Pick a template that's different from the last one used
    let templateIdx = (i * 3 + 7) % TEMPLATES.length; // deterministic spread
    if (templateIdx === lastTemplateIndex) {
      templateIdx = (templateIdx + 1) % TEMPLATES.length;
    }
    lastTemplateIndex = templateIdx;

    const sentence = TEMPLATES[templateIdx](term);

    // Find the </p> closing tag for this paragraph and insert before it
    // Account for offset from previous injections
    const closingTag = '</p>';
    const searchStart = para.index + (injectedCount * 80); // rough offset estimate
    const closingPos = result.indexOf(closingTag, searchStart);
    if (closingPos === -1) continue;

    result = result.substring(0, closingPos) + sentence + result.substring(closingPos);
    injectedCount++;
  }

  return result;
}

/**
 * Build and append a styled FAQ section from question/answer pairs.
 */
export function addFaqSection(
  html: string,
  faqs: Array<{ question: string; answer: string }>,
): string {
  if (!html || !faqs || faqs.length === 0) return html;

  const hasFaq = /<(details|h2)[^>]*>[\s\S]*?(?:faq|frequently asked|common questions)/i.test(html);
  if (hasFaq) return html;

  const faqItems = faqs.map(faq =>
    `<details style="margin: 12px 0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; max-width: 100%; box-sizing: border-box;">
  <summary style="padding: 18px 24px; background: #f8fafc; cursor: pointer; font-weight: 700; color: #0f172a; font-size: 17px; list-style: none; display: flex; justify-content: space-between; align-items: center;">
    ${escapeHtmlStr(faq.question)} <span style="font-size: 20px; color: #64748b;">+</span>
  </summary>
  <div style="padding: 16px 24px; color: #475569; font-size: 16px; line-height: 1.8; border-top: 1px solid #e2e8f0;">
    ${faq.answer}
  </div>
</details>`,
  ).join('\n');

  const faqSection = `
<div style="margin-top: 48px;">
  <h2 style="color: #0f172a; font-size: 30px; font-weight: 900; margin: 56px 0 24px 0; padding-bottom: 14px; border-bottom: 4px solid #10b981;">❓ Frequently Asked Questions</h2>
  ${faqItems}
</div>`;

  const refsMarker = html.indexOf('<!-- SOTA References Section -->');
  if (refsMarker !== -1) {
    return html.slice(0, refsMarker) + '\n\n' + faqSection + '\n\n' + html.slice(refsMarker);
  }

  return html + '\n\n' + faqSection;
}

/**
 * Comprehensive post-processing: AI removal + visual breaks + HTML enhancement.
 */
export function postProcessContent(
  html: string,
  options?: {
    maxConsecutiveWords?: number;
    usePullQuotes?: boolean;
    enhanceDesign?: boolean;
    removeAI?: boolean;
  },
): PostProcessingResult {
  if (!html) return { html: '', wasModified: false, violations: [], elementsInjected: 0 };

  let processed = html;

  // Step 0: Remove AI-detectable patterns (default: true)
  if (options?.removeAI !== false) {
    processed = removeAIPatterns(processed);
  }

  // Step 1: Enforce visual breaks
  const result = ContentPostProcessor.process(processed, {
    maxConsecutiveWords: options?.maxConsecutiveWords || 200,
    usePullQuotes: options?.usePullQuotes !== false,
  });

  // Step 2: Enhance HTML design (default: true)
  if (options?.enhanceDesign !== false) {
    result.html = enhanceHtmlDesign(result.html);
    result.wasModified = true;
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function escapeHtmlStr(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function capitalize(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default ContentPostProcessor;
