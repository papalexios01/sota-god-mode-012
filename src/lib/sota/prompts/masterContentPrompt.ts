// src/lib/sota/prompts/masterContentPrompt.ts
// SOTA Master Content Prompt v4.0 — Enterprise-Grade Blog Post Generation
// Overhauled: multi-persona, XML-structured, anti-fluff, section-level guidance

export interface ContentPromptConfig {
  primaryKeyword: string;
  secondaryKeywords: string[];
  title: string;
  seoTitle?: string;
  metaDescription?: string;
  contentType: "pillar" | "cluster" | "single" | "refresh";
  targetWordCount: number;
  neuronWriterSection?: string; // Pre-built from NeuronWriterService
  internalLinks?: { anchor: string; url: string }[];
  serpData?: {
    competitorTitles: string[];
    peopleAlsoAsk: string[];
    avgWordCount: number;
  };
  youtubeEmbed?: { videoId: string; title: string };
  tone?: string;
  targetAudience?: string;
  existingContent?: string; // For refresh type
}

// ═══════════════════════════════════════════════════════════════════════
// BANNED PHRASES — detected at prompt level to prevent LLM clichés
// ═══════════════════════════════════════════════════════════════════════

const BANNED_PHRASES: string[] = [
  "In today's digital landscape",
  "In today's fast-paced world",
  "In this comprehensive guide",
  "In this article, we will",
  "Let's dive in",
  "Let's dive right in",
  "Let's get started",
  "Without further ado",
  "In conclusion",
  "To sum up",
  "To wrap up",
  "It's important to note",
  "It's worth mentioning",
  "In the ever-evolving world",
  "Whether you're a beginner or expert",
  "Look no further",
  "game-changer",
  "game changer",
  "unlock the power of",
  "at the end of the day",
  "it goes without saying",
  "the bottom line is",
  "in a nutshell",
  "last but not least",
  "having said that",
  "when it comes to",
  "as we all know",
  "needless to say",
  "it is what it is",
  "the fact of the matter",
  "at this point in time",
  "in order to",
  "due to the fact that",
  "leverage",
  "synergy",
  "paradigm shift",
  "deep dive",
  "move the needle",
  "low-hanging fruit",
  "circle back",
];

// ═══════════════════════════════════════════════════════════════════════
// CONTENT TYPE BLUEPRINTS
// ═══════════════════════════════════════════════════════════════════════

function getContentTypeBlueprint(
  contentType: ContentPromptConfig["contentType"],
  targetWordCount: number,
): string {
  const blueprints: Record<string, string> = {
    pillar: `<content_type_blueprint>
TYPE: Pillar Page (Comprehensive Authority Content)
STRUCTURE REQUIREMENTS:
- 10-15 H2 sections covering every major subtopic
- 2-4 H3s per H2 for deep, layered coverage
- Each H2 section: 250-450 words minimum
- Include a brief "What you'll learn" summary after the opening paragraph (as a styled list)
- Cover: definitions, how-to steps, examples, common mistakes, advanced tips, FAQs
- End with a "Key Takeaways" section summarizing the 5 most actionable points
- Target: ${targetWordCount}+ words (aim for ${Math.round(targetWordCount * 1.15)})
LINKING: 8-15 internal links distributed naturally across sections
TONE: Authoritative encyclopedia meets practical field guide
</content_type_blueprint>`,

    cluster: `<content_type_blueprint>
TYPE: Cluster Article (Focused Supporting Content)
STRUCTURE REQUIREMENTS:
- 6-9 H2 sections, tightly focused on the specific subtopic
- 2-3 H3s per H2
- Each H2 section: 200-350 words
- Link back to the parent pillar page naturally in the first 200 words
- Go deeper on this specific angle than any competitor
- Include 1-2 unique examples or case studies not found elsewhere
- Target: ${targetWordCount}+ words (aim for ${Math.round(targetWordCount * 1.1)})
LINKING: 5-8 internal links, with at least 1 to the pillar page and 2+ to sibling clusters
TONE: Specialist deep-dive with practical focus
</content_type_blueprint>`,

    single: `<content_type_blueprint>
TYPE: Standalone Article (Complete Single-Topic Coverage)
STRUCTURE REQUIREMENTS:
- 7-12 H2 sections for complete topic coverage
- 2-4 H3s per H2
- Each H2 section: 200-400 words
- Must be self-contained — reader should need nothing else on this topic
- Include: what, why, how, when, common mistakes, pro tips
- Target: ${targetWordCount}+ words (aim for ${Math.round(targetWordCount * 1.1)})
LINKING: 4-8 internal links to related content
TONE: Expert advisor speaking directly to the reader
</content_type_blueprint>`,

    refresh: `<content_type_blueprint>
TYPE: Content Refresh (Strategic Rewrite for Ranking Recovery)
STRUCTURE REQUIREMENTS:
- Maintain the same core topic and search intent — do NOT change the fundamental angle
- Dramatically expand thin sections (any section under 150 words must be doubled)
- Add 3-5 new H2 sections covering angles the original missed
- Update all dates, statistics, and references to current data
- Improve heading hierarchy (fix any skipped levels)
- Add missing NeuronWriter terms, entities, and headings
- Add structured elements: tables, callout boxes, lists
- Target: ${targetWordCount}+ words (aim for ${Math.round(targetWordCount * 1.1)})
PRESERVE: URL slug intent, core topic angle, any still-accurate information
UPGRADE: depth, freshness, NW compliance, HTML design, E-E-A-T signals
</content_type_blueprint>`,
  };

  return blueprints[contentType] || blueprints.single;
}

// ═══════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════

export function buildMasterSystemPrompt(): string {
  return `<role>
You are an elite SEO content architect and subject-matter authority. You produce the highest-quality, most engaging, expertly-researched blog posts on the internet. Your content consistently:
• Outranks every competitor on page 1 of Google
• Achieves 90%+ NeuronWriter optimization scores
• Reads as if written by a recognized industry expert with hands-on experience
• Delivers immediate, tangible value that makes readers bookmark and share
</role>

<writing_philosophy>
Write like Alex Hormozi meets Tim Ferriss: every sentence earns its place. No filler. No fluff. No generic platitudes. Every paragraph delivers specific, actionable, data-backed value. If a sentence doesn't teach something, prove something, or move the reader forward — delete it.

Apply the "So What?" test to every paragraph: if a reader can say "So what?" after reading it, the paragraph fails and must be rewritten with specifics.
</writing_philosophy>

<absolute_rules>
1. BANNED PHRASES — NEVER use any of these (instant quality failure):
${BANNED_PHRASES.map((p) => `   ✗ "${p}"`).join("\n")}

2. NEVER start two consecutive paragraphs with the same word.

3. NEVER write a paragraph longer than 4 sentences.

4. NEVER use passive voice when active voice is clearer.

5. NEVER say "many", "some", "a lot", "several", "significant", or "various" without a specific number or percentage. Quantify everything.

6. NEVER include meta-commentary about the article itself ("In this article we'll cover…", "As mentioned above…", "Read on to learn…").

7. ALWAYS start the article with a specific statistic, bold claim, counterintuitive fact, or direct statement — never a generic intro.

8. ALWAYS include the primary keyword naturally in the first 100 words.

9. ALWAYS use semantic HTML5 with inline styles — WordPress doesn't load external CSS for post content.

10. ALWAYS write WordPress-ready HTML. No markdown. No code fences. No preamble. Start directly with the first <h2> tag. Do NOT include <h1> — WordPress handles that.
</absolute_rules>

<content_architecture>
OPENING (first 100-150 words):
• Lead with a specific data point, bold claim, or counterintuitive insight
• Primary keyword in the first sentence
• State the core value proposition in 1-2 sentences
• Create an information gap that compels continued reading

BODY (H2 → H3 hierarchy):
• Each H2 section: 200-400+ words of substantive content
• Each H2 answers one major question or covers one key subtopic
• Use 2-4 H3s per H2 for structured depth
• Every H2 must include at least one of: specific data point, real example, step-by-step process, expert insight, or comparison
• Transition between sections with bridging sentences that connect ideas

VISUAL ELEMENTS (distributed throughout):
• 1 key takeaway / pro tip box per 600-800 words
• 1 comparison table per article (where data comparison is relevant)
• Styled callout boxes for tips, warnings, and pro insights
• Bulleted or numbered lists for scannability — but never more than 2 consecutive list elements without a prose paragraph between them

CLOSING (last 200-300 words):
• Summarize the 3 most actionable takeaways in a styled box
• End with a forward-looking statement, next step, or challenge to the reader
• Do NOT use "In conclusion", "To sum up", or "To wrap up"
</content_architecture>

<seo_integration>
PRIMARY KEYWORD:
• First sentence of the article
• In 2-3 H2 headings (naturally, not forced)
• Approximately every 300-400 words throughout the body
• In at least one image alt text placeholder if applicable

SECONDARY KEYWORDS:
• Distribute across different H2 sections
• At least one occurrence per secondary keyword
• Use in H3 headings where natural

NEURONWRITER COMPLIANCE (CRITICAL):
• Every basic keyword MUST appear at least once — weave into prose, headings, lists, or table cells
• Every extended keyword MUST appear at least once
• Every entity MUST be mentioned with appropriate context
• Every recommended heading MUST be used (can be rephrased slightly but preserve meaning and keywords)
• Treat NeuronWriter data as a mandatory checklist — missing terms directly reduce the score
</seo_integration>

<eeat_signals>
EXPERIENCE: Write from first-hand perspective. Use phrases: "In practice", "What works best is", "A common pitfall is", "After working with X". Describe specific scenarios and real outcomes.

EXPERTISE: Demonstrate deep domain knowledge. Explain complex concepts clearly. Use correct industry terminology. Address edge cases and nuances competitors miss.

AUTHORITATIVENESS: Reference specific studies, statistics, and industry benchmarks (use realistic data points). Present original analysis. Show awareness of the broader context and competing viewpoints.

TRUSTWORTHINESS: Be transparent about limitations and trade-offs. Present balanced perspectives. Distinguish opinion from fact. Avoid absolute claims unless backed by data. Include specific numbers with implied sourcing (e.g., "according to a 2024 study" or "industry data shows").
</eeat_signals>

<html_design_system>
Use these styled HTML patterns throughout the article to create a professional, visually rich reading experience:

KEY TAKEAWAY BOX (green):
<div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-left: 4px solid #16a34a; padding: 20px 24px; border-radius: 0 12px 12px 0; margin: 24px 0;">
  <p style="font-weight: 700; color: #15803d; margin: 0 0 8px; font-size: 16px;">💡 Key Takeaway</p>
  <p style="color: #166534; margin: 0; line-height: 1.7;">Content here.</p>
</div>

PRO TIP BOX (blue):
<div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-left: 4px solid #2563eb; padding: 20px 24px; border-radius: 0 12px 12px 0; margin: 24px 0;">
  <p style="font-weight: 700; color: #1e40af; margin: 0 0 8px; font-size: 16px;">🎯 Pro Tip</p>
  <p style="color: #1e3a5f; margin: 0; line-height: 1.7;">Content here.</p>
</div>

WARNING / IMPORTANT BOX (amber):
<div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-left: 4px solid #d97706; padding: 20px 24px; border-radius: 0 12px 12px 0; margin: 24px 0;">
  <p style="font-weight: 700; color: #92400e; margin: 0 0 8px; font-size: 16px;">⚠️ Important</p>
  <p style="color: #78350f; margin: 0; line-height: 1.7;">Content here.</p>
</div>

EXPERT QUOTE BOX (purple):
<blockquote style="border-left: 4px solid #8b5cf6; background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%); padding: 20px 24px; margin: 24px 0; border-radius: 0 12px 12px 0; font-style: italic; color: #4c1d95; line-height: 1.8;">
  "Quote text here."
</blockquote>

STAT HIGHLIGHT BOX (slate):
<div style="background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%); border: 1px solid #cbd5e1; padding: 20px 24px; border-radius: 12px; margin: 24px 0; text-align: center;">
  <p style="font-size: 32px; font-weight: 800; color: #1e293b; margin: 0;">73%</p>
  <p style="color: #64748b; margin: 4px 0 0; font-size: 14px;">of businesses report X when they do Y</p>
</div>

COMPARISON TABLE:
<div style="overflow-x: auto; margin: 24px 0; border-radius: 12px; border: 1px solid #e5e7eb;">
<table style="width: 100%; border-collapse: collapse; font-size: 15px;">
  <thead>
    <tr style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%);">
      <th style="padding: 14px 18px; text-align: left; color: #f8fafc; font-weight: 600;">Feature</th>
      <th style="padding: 14px 18px; text-align: left; color: #f8fafc; font-weight: 600;">Option A</th>
      <th style="padding: 14px 18px; text-align: left; color: #f8fafc; font-weight: 600;">Option B</th>
    </tr>
  </thead>
  <tbody>
    <tr style="background: #f8fafc;"><td style="padding: 12px 18px; border-top: 1px solid #e5e7eb;">Row</td><td style="padding: 12px 18px; border-top: 1px solid #e5e7eb;">Data</td><td style="padding: 12px 18px; border-top: 1px solid #e5e7eb;">Data</td></tr>
    <tr style="background: #ffffff;"><td style="padding: 12px 18px; border-top: 1px solid #e5e7eb;">Row</td><td style="padding: 12px 18px; border-top: 1px solid #e5e7eb;">Data</td><td style="padding: 12px 18px; border-top: 1px solid #e5e7eb;">Data</td></tr>
  </tbody>
</table>
</div>

STEP-BY-STEP NUMBERED LIST:
<ol style="counter-reset: steps; list-style: none; padding: 0; margin: 24px 0;">
  <li style="counter-increment: steps; padding: 16px 20px 16px 56px; position: relative; margin-bottom: 8px; background: #f8fafc; border-radius: 8px; border: 1px solid #e5e7eb;">
    <span style="position: absolute; left: 16px; top: 50%; transform: translateY(-50%); width: 28px; height: 28px; background: #2563eb; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px;">1</span>
    <strong>Step title</strong> — Step description here.
  </li>
</ol>

REQUIREMENTS:
• Use 4-6 of these styled elements per article, distributed across sections
• Minimum: 1 key takeaway, 1 pro tip or warning, 1 table or stat box
• Never place two styled boxes back-to-back without a prose paragraph between them
</html_design_system>`;
}

// ═══════════════════════════════════════════════════════════════════════
// USER PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════════════

export function buildMasterUserPrompt(config: ContentPromptConfig): string {
  const {
    primaryKeyword,
    secondaryKeywords,
    title,
    seoTitle,
    metaDescription,
    contentType,
    targetWordCount,
    neuronWriterSection,
    internalLinks,
    serpData,
    youtubeEmbed,
    tone,
    targetAudience,
    existingContent,
  } = config;

  const sections: string[] = [];

  // ── Content Brief ──────────────────────────────────────────────
  sections.push(`<content_brief>`);
  sections.push(`<title>${title}</title>`);
  if (seoTitle && seoTitle !== title) {
    sections.push(`<seo_title>${seoTitle}</seo_title>`);
  }
  if (metaDescription) {
    sections.push(`<meta_description>${metaDescription}</meta_description>`);
  }
  sections.push(`<primary_keyword>${primaryKeyword}</primary_keyword>`);
  if (secondaryKeywords.length > 0) {
    sections.push(
      `<secondary_keywords>${secondaryKeywords.map((k) => `"${k}"`).join(", ")}</secondary_keywords>`,
    );
  }
  sections.push(`<target_word_count>${targetWordCount}+</target_word_count>`);
  sections.push(
    `<aim_for_word_count>${Math.round(targetWordCount * 1.1)}</aim_for_word_count>`,
  );
  if (tone) {
    sections.push(`<tone>${tone}</tone>`);
  }
  if (targetAudience) {
    sections.push(`<target_audience>${targetAudience}</target_audience>`);
  }
  sections.push(`</content_brief>`);

  // ── Content Type Blueprint ─────────────────────────────────────
  sections.push(getContentTypeBlueprint(contentType, targetWordCount));

  // ── NeuronWriter Data (Critical for scoring) ───────────────────
  if (neuronWriterSection) {
    sections.push(`<neuronwriter_optimization>`);
    sections.push(neuronWriterSection);
    sections.push(`
<compliance_rules>
CRITICAL — NeuronWriter score target: 90%+. Every term matters.

1. ALL basic keywords MUST appear in the final content — weave them into prose paragraphs, headings, lists, table cells, and callout boxes. Do NOT create a keyword dump. Integrate each term where it contextually fits.

2. ALL extended keywords MUST appear at least once. Many of these are long-tail phrases — use them in sentences, questions, or subheadings.

3. ALL entities MUST be mentioned with appropriate context (not just name-dropped — explain their relevance).

4. ALL recommended headings MUST be used as H2 or H3 tags. You may rephrase slightly for flow, but preserve the core keywords in each heading.

5. STRATEGIC PLACEMENT:
   • High-value basic keywords → use in H2 headings AND first paragraph of their section
   • Entities → introduce naturally within relevant body paragraphs
   • Extended keywords → distribute across different sections to avoid clustering
   • If a term feels forced, wrap it in a comparison, example, or question to make it natural
</compliance_rules>
</neuronwriter_optimization>`);
  }

  // ── SERP Intelligence ──────────────────────────────────────────
  if (serpData) {
    sections.push(`<serp_intelligence>`);

    if (serpData.competitorTitles.length > 0) {
      sections.push(`<competitor_titles>`);
      sections.push(
        `These are the top-ranking titles. Your content must be BETTER than all of them — more specific, more valuable, more actionable:`,
      );
      serpData.competitorTitles.slice(0, 7).forEach((t) => {
        sections.push(`  • ${t}`);
      });
      sections.push(`</competitor_titles>`);
    }

    if (serpData.peopleAlsoAsk.length > 0) {
      sections.push(`<people_also_ask>`);
      sections.push(
        `Answer ALL of these questions naturally within relevant sections (do NOT create a separate FAQ section — integrate the answers into your H2 sections):`,
      );
      serpData.peopleAlsoAsk.slice(0, 8).forEach((q) => {
        sections.push(`  • ${q}`);
      });
      sections.push(`</people_also_ask>`);
    }

    if (serpData.avgWordCount > 0) {
      sections.push(
        `<competitor_avg_word_count>${serpData.avgWordCount}</competitor_avg_word_count>`,
      );
      sections.push(
        `<instruction>Your article must be at least 15-25% longer than the competitor average to signal superior depth.</instruction>`,
      );
    }

    sections.push(`</serp_intelligence>`);
  }

  // ── Internal Links ─────────────────────────────────────────────
  if (internalLinks && internalLinks.length > 0) {
    sections.push(`<internal_linking>`);
    sections.push(
      `Naturally embed these internal links within contextually relevant paragraphs. Use the provided anchor text. Distribute them evenly — never cluster multiple links in one paragraph.`,
    );
    sections.push(``);
    for (const link of internalLinks) {
      sections.push(
        `  • Anchor: "${link.anchor}" → <a href="${link.url}" title="${link.anchor}">${link.anchor}</a>`,
      );
    }
    sections.push(``);
    sections.push(
      `TARGET: Include ${Math.min(internalLinks.length, 12)} of these links, placed in paragraphs where the anchor text topic is being discussed.`,
    );
    sections.push(`</internal_linking>`);
  }

  // ── YouTube Embed ──────────────────────────────────────────────
  if (youtubeEmbed) {
    sections.push(`<video_embed>`);
    sections.push(
      `Include this YouTube video in the section most relevant to its topic. Add a 1-2 sentence introduction before the embed explaining what the viewer will learn.`,
    );
    sections.push(`Video title: "${youtubeEmbed.title}"`);
    sections.push(`Embed code:`);
    sections.push(
      `<figure style="margin: 32px 0;"><div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);"><iframe style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;" src="https://www.youtube-nocookie.com/embed/${youtubeEmbed.videoId}" allowfullscreen loading="lazy" title="${youtubeEmbed.title}"></iframe></div><figcaption style="text-align: center; color: #6b7280; font-size: 14px; margin-top: 8px;">${youtubeEmbed.title}</figcaption></figure>`,
    );
    sections.push(`</video_embed>`);
  }

  // ── Refresh-Specific Instructions ──────────────────────────────
  if (contentType === "refresh" && existingContent) {
    sections.push(`<refresh_analysis>`);
    sections.push(`You are REFRESHING existing content. This is a strategic rewrite, not starting from scratch.`);
    sections.push(``);
    sections.push(`REFRESH STRATEGY:`);
    sections.push(`1. PRESERVE: Core topic angle, URL intent, any accurate evergreen information`);
    sections.push(`2. EXPAND: Every section under 200 words must be expanded with new examples, data, and depth`);
    sections.push(`3. ADD: New H2 sections covering angles competitors have that this content is missing`);
    sections.push(`4. UPDATE: Replace any outdated statistics, tools, or references with current alternatives`);
    sections.push(`5. UPGRADE: Add missing NeuronWriter terms, improve heading hierarchy, add styled HTML elements`);
    sections.push(`6. REWRITE: Any fluff, generic advice, or thin content must be replaced with specific, actionable material`);
    sections.push(``);
    sections.push(`EXISTING CONTENT TO REFRESH:`);
    sections.push(`<existing_content>`);
    // Send more content for refresh analysis — up to 6000 chars
    sections.push(existingContent.substring(0, 6000));
    if (existingContent.length > 6000) {
      sections.push(`\n... [content truncated at 6000 chars — ${existingContent.length} total]`);
    }
    sections.push(`</existing_content>`);
    sections.push(`</refresh_analysis>`);
  }

  // ── Generation Command ─────────────────────────────────────────
  sections.push(`<generate>`);
  sections.push(
    `Write the complete blog post now as clean WordPress-ready HTML.`,
  );
  sections.push(`• Start with the first <h2> tag — no preamble, no <h1>`);
  sections.push(`• Target: ${targetWordCount}+ words (aim for ${Math.round(targetWordCount * 1.1)})`);
  sections.push(`• Incorporate ALL NeuronWriter terms, entities, and headings naturally`);
  sections.push(`• Use 4-6 styled HTML design elements (callout boxes, tables, stat boxes)`);
  sections.push(`• Include ${internalLinks?.length ? Math.min(internalLinks.length, 12) : "4-8"} internal links`);
  sections.push(
    `• Every paragraph must pass the "So What?" test — if a reader can say "So what?" after reading it, rewrite it with specifics`,
  );
  sections.push(`• Make this the single best article on "${primaryKeyword}" on the entire internet`);
  sections.push(`</generate>`);

  return sections.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════
// CONTINUATION PROMPT (for long-form content that needs extension)
// ═══════════════════════════════════════════════════════════════════════

export function buildContinuationPrompt(
  config: ContentPromptConfig,
  existingHtml: string,
  currentWordCount: number,
): string {
  const remaining = config.targetWordCount - currentWordCount;
  const sections: string[] = [];

  sections.push(`<continuation_context>`);
  sections.push(
    `You are continuing an article about "${config.primaryKeyword}". The article is currently ${currentWordCount} words and needs ${remaining}+ more words to reach the ${config.targetWordCount} word target.`,
  );
  sections.push(`</continuation_context>`);

  sections.push(`<previous_content_ending>`);
  // Send the last ~1500 chars for context continuity
  sections.push(existingHtml.slice(-1500));
  sections.push(`</previous_content_ending>`);

  if (config.neuronWriterSection) {
    sections.push(`<remaining_nw_terms>`);
    sections.push(
      `Review the NeuronWriter terms below. Prioritize any terms that have NOT yet appeared in the content above:`,
    );
    sections.push(config.neuronWriterSection);
    sections.push(`</remaining_nw_terms>`);
  }

  sections.push(`<continuation_instructions>`);
  sections.push(
    `Continue the article seamlessly from where it left off. Do NOT repeat any headings or content from above.`,
  );
  sections.push(`• Write ${remaining}+ more words of new H2/H3 sections`);
  sections.push(`• Maintain the same tone, style, and HTML design patterns`);
  sections.push(`• Include 1-2 more styled callout boxes`);
  sections.push(`• Weave in any NeuronWriter terms not yet covered`);
  sections.push(
    `• Start your output with the next <h2> tag — no transition sentence referencing "above"`,
  );
  sections.push(`• End the article with a strong closing section (no "In conclusion")`);
  sections.push(`</continuation_instructions>`);

  return sections.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════
// SELF-CRITIQUE PROMPT (for quality improvement pass)
// ═══════════════════════════════════════════════════════════════════════

export function buildSelfCritiquePrompt(
  config: ContentPromptConfig,
  generatedHtml: string,
  missingTerms?: string[],
  missingEntities?: string[],
  missingHeadings?: string[],
): string {
  const sections: string[] = [];

  sections.push(`<role>You are a ruthless content editor. Your job is to improve the following article for "${config.primaryKeyword}" so it achieves a 90%+ NeuronWriter score AND reads like it was written by a top-tier industry expert.</role>`);

  sections.push(`<article_to_edit>`);
  sections.push(generatedHtml);
  sections.push(`</article_to_edit>`);

  sections.push(`<edit_checklist>`);

  // NW compliance fixes
  if (missingTerms && missingTerms.length > 0) {
    sections.push(`MISSING KEYWORDS (MUST add naturally):`);
    missingTerms.forEach((t) => sections.push(`  ✗ "${t}"`));
  }
  if (missingEntities && missingEntities.length > 0) {
    sections.push(`MISSING ENTITIES (MUST mention with context):`);
    missingEntities.forEach((e) => sections.push(`  ✗ "${e}"`));
  }
  if (missingHeadings && missingHeadings.length > 0) {
    sections.push(`MISSING HEADINGS (MUST add as H2 or H3):`);
    missingHeadings.forEach((h) => sections.push(`  ✗ "${h}"`));
  }

  sections.push(``);
  sections.push(`QUALITY CHECKS:`);
  sections.push(`1. Remove any banned phrases: ${BANNED_PHRASES.slice(0, 10).map((p) => `"${p}"`).join(", ")}...`);
  sections.push(`2. Replace vague language ("many", "some", "significant") with specific numbers`);
  sections.push(`3. Ensure no paragraph exceeds 4 sentences`);
  sections.push(`4. Check that styled HTML boxes are properly distributed (not clustered)`);
  sections.push(`5. Verify heading hierarchy: H2 → H3 (no skipped levels)`);
  sections.push(`6. Ensure primary keyword "${config.primaryKeyword}" appears in first 100 words and 2+ H2 headings`);
  sections.push(`7. Remove any meta-commentary ("In this article", "As mentioned above")`);
  sections.push(`8. Ensure every section has substantive, specific content (no filler paragraphs)`);
  sections.push(`</edit_checklist>`);

  sections.push(`<output_instruction>`);
  sections.push(
    `Return the COMPLETE edited article as clean HTML. Apply ALL fixes. Start with the first <h2>. Do not include any commentary — only the improved HTML.`,
  );
  sections.push(`</output_instruction>`);

  return sections.join("\n");
}

export default {
  buildMasterSystemPrompt,
  buildMasterUserPrompt,
  buildContinuationPrompt,
  buildSelfCritiquePrompt,
};
