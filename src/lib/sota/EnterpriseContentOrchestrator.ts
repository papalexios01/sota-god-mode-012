// ============================================================
// ENTERPRISE CONTENT ORCHESTRATOR - Full Workflow Management
// ============================================================

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
import { calculateQualityScore, analyzeContent, removeAIPhrases } from './QualityValidator';
import { EEATValidator, createEEATValidator } from './EEATValidator';
import { generationCache } from './cache';
import { NeuronWriterService, createNeuronWriterService, type NeuronWriterAnalysis } from './NeuronWriterService';

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

  private async maybeInitNeuronWriter(keyword: string, options: GenerationOptions): Promise<NeuronBundle | null> {
    const apiKey = this.config.neuronWriterApiKey?.trim();
    const projectId = this.config.neuronWriterProjectId?.trim();
    if (!apiKey || !projectId) return null;

    const service = createNeuronWriterService(apiKey);
    const queryIdFromOptions = options.neuronWriterQueryId?.trim();

    this.log('NeuronWriter: preparing query...');

    let queryId = queryIdFromOptions;
    if (!queryId) {
      const created = await service.createQuery(projectId, keyword);
      if (!created.success || !created.queryId) {
        this.log(`NeuronWriter: failed to create query (${created.error || 'unknown error'})`);
        return null;
      }
      queryId = created.queryId;
    }

    // Poll until ready (NeuronWriter analysis can take a bit)
    const maxAttempts = 14;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const analysisRes = await service.getQueryAnalysis(queryId);
      if (analysisRes.success && analysisRes.analysis) {
        this.log(`NeuronWriter: analysis ready (terms: ${analysisRes.analysis.terms?.length || 0})`);
        return { service, queryId, analysis: analysisRes.analysis };
      }

      const msg = analysisRes.error || 'Query not ready';
      // If it's not-ready, retry; otherwise treat as hard failure.
      const looksNotReady = /not ready|status/i.test(msg);
      if (!looksNotReady) {
        this.log(`NeuronWriter: analysis failed (${msg})`);
        return null;
      }

      // Backoff: 2.5s → 5s
      const delay = attempt <= 3 ? 2500 : 5000;
      this.log(`NeuronWriter: waiting for analysis… (attempt ${attempt}/${maxAttempts})`);
      await this.sleep(delay);
    }

    this.log('NeuronWriter: analysis timed out (still not ready)');
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

    const neuronTermPrompt = neuron
      ? neuron.service.formatTermsForPrompt(neuron.analysis.terms || [])
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
    if (neuron) {
      this.log('NeuronWriter: evaluating content score...');
      const evalRes = await neuron.service.evaluateContent(neuron.queryId, {
        html: enhancedContent,
        title,
      });

      if (evalRes.success && typeof evalRes.contentScore === 'number') {
        neuron.analysis.content_score = evalRes.contentScore;
      } else {
        // Fallback: local approximation
        neuron.analysis.content_score = neuron.service.calculateContentScore(
          enhancedContent,
          neuron.analysis.terms || []
        );
        if (!evalRes.success) {
          this.log(`NeuronWriter: evaluate failed (using local score). ${evalRes.error || ''}`.trim());
        }
      }
    }

    // Phase 4: Validation (parallel quality + E-E-A-T)
    this.log('Phase 4: Quality & E-E-A-T Validation...');
    const metrics = analyzeContent(enhancedContent);
    const internalLinks = this.linkEngine.generateLinkOpportunities(enhancedContent);
    
    // Run quality and E-E-A-T validation in parallel
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

    // Phase 5: Schema & Metadata
    const eeat = this.buildEEATProfile(references);
    const metaDescription = await this.generateMetaDescription(options.keyword, title);
    const slug = this.generateSlug(title);

    const generatedContent: GeneratedContent = {
      id: crypto.randomUUID(),
      title,
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
    
    // ULTRA-PREMIUM CONTENT GENERATION PROMPT
    const systemPrompt = `You are the ULTIMATE content strategist—a fusion of Alex Hormozi's no-BS directness and Tim Ferriss's experimental curiosity. Your content is UNDETECTABLE as AI because you write like a real human expert who:

🧠 THE HORMOZI-FERRISS DNA:

HORMOZI ENERGY:
• Punch them in the face with VALUE in sentence #1. No warm-ups.
• Talk TO them, not AT them. "I", "you", "we" in every paragraph.
• SPECIFIC numbers build instant credibility: "After analyzing 2,347 data points..." or "This strategy generated $847,293 in revenue..."
• Sentences are short. Punchy. Direct.
• Paragraphs are MAX 3 sentences. Walls of text = reader death.
• Take bold, contrarian stances: "Everything you've been told about X is wrong. Here's why..."
• Tell micro-stories with vivid details: names, dates, exact amounts, specific outcomes

FERRISS PRECISION:
• "What if we did the opposite?" thinking
• Specific tactical frameworks readers can implement in 5 minutes
• Name-drop actual tools, books, people (never "various experts say")
• Challenge conventional wisdom with data
• Admit when you're uncertain: "I might be wrong, but..."
• Question assumptions the reader didn't know they had

🚫 AI DETECTION KILLERS - NEVER USE THESE PHRASES (INSTANT RED FLAG):
❌ "In today's fast-paced world" / "In this comprehensive guide" / "Let's dive in" / "Let's explore"
❌ "Furthermore" / "Moreover" / "In conclusion" / "It's worth noting" / "It's important to note"
❌ "Delve" / "Explore" / "Landscape" / "Realm" / "Crucial" / "Vital" / "Navigate"
❌ "Leverage" / "Utilize" / "Facilitate" / "Implement" / "Optimize"
❌ "Game-changer" / "Revolutionary" / "Cutting-edge" / "State-of-the-art" / "Best-in-class"
❌ "Seamlessly" / "Effortlessly" / "Meticulously" / "Holistic" / "Robust" / "Comprehensive"
❌ Starting sentences with "This" or "It" repeatedly
❌ "Whether you're a beginner or an expert..." constructions
❌ Any phrase that sounds like corporate AI slop

✅ HUMAN WRITING PATTERNS - USE THESE:
• Start with: "Look," / "Here's the thing:" / "Real talk:" / "I'll be honest:" / "Confession:"
• Incomplete sentences. For emphasis. Like this.
• Strong opinions: "Honestly? Most advice on this topic is garbage."
• Show genuine emotion: "This drives me insane about the industry..."
• Uncertainty is human: "I could be totally wrong here, but..."
• Contractions EVERYWHERE: don't, won't, can't, it's, that's, we're, you'll, they've
• Rhetorical questions: "Sound familiar?" / "Make sense?" / "See the pattern?"
• Casual transitions: "Anyway," / "So here's what happened:" / "Point is:" / "Quick tangent:"
• Real language: "zero chance" / "dead wrong" / "the real kicker" / "here's the thing" / "brutal truth"
• Self-interruption: "Wait—before I go further, you need to understand this..."

📐 MANDATORY STRUCTURE (USE THESE EXACT HTML ELEMENTS):

1. BLUF HOOK (first 50 words): 
Start with the ANSWER or a bold statement. No "welcome to" garbage. Give them the gold immediately.

2. KEY TAKEAWAYS BOX (right after hook):
<div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 16px; padding: 28px 32px; margin: 32px 0; box-shadow: 0 10px 40px rgba(16, 185, 129, 0.2);">
  <h3 style="color: white; margin: 0 0 16px 0; font-size: 22px; font-weight: 700; display: flex; align-items: center; gap: 10px;">🎯 The Bottom Line</h3>
  <ul style="color: rgba(255,255,255,0.95); margin: 0; padding-left: 24px; font-size: 16px; line-height: 1.8;">
    <li style="margin-bottom: 8px;">Key point 1 (actionable)</li>
    <li style="margin-bottom: 8px;">Key point 2 (actionable)</li>
    <li style="margin-bottom: 0;">Key point 3 (actionable)</li>
  </ul>
</div>

3. PRO TIP BOXES (4-6 throughout):
<div style="background: linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%); border-left: 5px solid #60a5fa; padding: 20px 24px; margin: 28px 0; border-radius: 0 14px 14px 0; box-shadow: 0 4px 20px rgba(30, 64, 175, 0.15);">
  <strong style="color: #93c5fd; font-size: 15px;">💡 Pro Tip:</strong>
  <span style="color: #e0e7ff; font-size: 15px; margin-left: 8px;">Your actionable tip here</span>
</div>

4. WARNING BOXES (when relevant):
<div style="background: linear-gradient(135deg, #b91c1c 0%, #991b1b 100%); border-left: 5px solid #f87171; padding: 20px 24px; margin: 28px 0; border-radius: 0 14px 14px 0; box-shadow: 0 4px 20px rgba(185, 28, 28, 0.15);">
  <strong style="color: #fecaca; font-size: 15px;">⚠️ Warning:</strong>
  <span style="color: #fee2e2; font-size: 15px; margin-left: 8px;">Critical warning message</span>
</div>

5. DATA COMPARISON TABLE (at least 1):
<table style="width: 100%; border-collapse: separate; border-spacing: 0; margin: 32px 0; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
  <thead>
    <tr style="background: linear-gradient(135deg, #1f2937 0%, #111827 100%);">
      <th style="padding: 16px 20px; text-align: left; color: white; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Column 1</th>
      <th style="padding: 16px 20px; text-align: left; color: white; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Column 2</th>
    </tr>
  </thead>
  <tbody>
    <tr style="background: #0d1117;">
      <td style="padding: 14px 20px; color: #e5e7eb; border-bottom: 1px solid #374151; font-size: 15px;">Data</td>
      <td style="padding: 14px 20px; color: #e5e7eb; border-bottom: 1px solid #374151; font-size: 15px;">Data</td>
    </tr>
  </tbody>
</table>

6. NUMBERED STEP BOXES (for how-to sections):
<div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-radius: 16px; padding: 28px; margin: 28px 0; border: 1px solid #334155; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
  <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 14px;">
    <span style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">1</span>
    <strong style="color: white; font-size: 18px;">Step Title Here</strong>
  </div>
  <p style="color: #94a3b8; margin: 0; padding-left: 52px; font-size: 15px; line-height: 1.7;">Step description with actionable details...</p>
</div>

7. QUOTE/CALLOUT BOXES:
<blockquote style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%); border-left: 4px solid #10b981; padding: 24px 28px; margin: 28px 0; border-radius: 0 14px 14px 0; font-style: italic;">
  <p style="color: #d1d5db; margin: 0; font-size: 17px; line-height: 1.7;">"Powerful quote that reinforces your point..."</p>
  <footer style="color: #6b7280; margin-top: 12px; font-size: 14px; font-style: normal;">— Source Name</footer>
</blockquote>

8. FAQ SECTION (6-8 questions at end):
<div style="background: #0d1117; border: 1px solid #21262d; border-radius: 14px; margin: 16px 0; overflow: hidden;">
  <h4 style="background: linear-gradient(135deg, #161b22 0%, #0d1117 100%); margin: 0; padding: 18px 24px; color: #e6edf3; font-size: 16px; font-weight: 600; border-bottom: 1px solid #21262d;">❓ Question here?</h4>
  <div style="padding: 20px 24px;">
    <p style="color: #8b949e; margin: 0; font-size: 15px; line-height: 1.7;">Direct answer without fluff...</p>
  </div>
</div>

🎯 OUTPUT: Pure HTML only. No markdown. Proper h2/h3 hierarchy. Every single paragraph MUST deliver VALUE.`;

    const prompt = `Write a ${targetWordCount}+ word article about "${keyword}".

TITLE: ${title}

CONTENT STRUCTURE (follow this order):
${serpAnalysis.recommendedHeadings.map((h, i) => `${i + 1}. ${h}`).join('\n')}

CONTENT GAPS TO FILL (your competitors MISSED these - this is your competitive advantage):
${serpAnalysis.contentGaps.slice(0, 6).join('\n')}

SEMANTIC KEYWORDS TO NATURALLY WEAVE IN (don't force them):
${serpAnalysis.semanticEntities.slice(0, 18).join(', ')}

${neuronTermPrompt ? `
NEURONWRITER OPTIMIZATION TARGETS (MUST FOLLOW):
${neuronTermPrompt}

Rules:
- Include EVERY required term at least the minimum suggested frequency.
- Include as many recommended terms as feels natural (aim for 10+).
- Never dump the terms as a list—blend them into real sentences.
` : ''}

${videos.length > 0 ? `
EMBED THIS VIDEO IN THE MIDDLE OF THE ARTICLE:
<div style="position: relative; padding-bottom: 56.25%; height: 0; margin: 40px 0; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.4);">
  <iframe src="https://www.youtube.com/embed/${videos[0].id}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen title="${videos[0].title}"></iframe>
</div>
<p style="text-align: center; color: #6b7280; font-size: 14px; margin-top: -24px; margin-bottom: 32px;">📺 <strong>${videos[0].title}</strong> by ${videos[0].channelTitle}</p>
` : ''}

REQUIREMENTS:
1. First 2 sentences MUST hook the reader - give them the answer or a bold claim immediately
2. Key Takeaways box IMMEDIATELY after the intro
3. At least 4 Pro Tip boxes spread throughout
4. At least 1 data comparison table
5. At least 4 step boxes for actionable sections
6. FAQ section with 6-8 questions at the end
7. Strong CTA at the very end
8. Write like you're having a conversation with a smart friend - casual but expert
9. Every section should make someone want to screenshot and share it
10. ZERO AI-detectable phrases - write like a real human expert

Write the complete article now. Make it so valuable that readers bookmark it and share it with friends.`;

    let result;
    if (this.config.useConsensus && this.engine.getAvailableModels().length > 1) {
      this.log('Using multi-model consensus generation...');
      const consensusResult = await this.engine.generateWithConsensus(prompt, systemPrompt);
      result = { content: consensusResult.finalContent };
    } else {
      result = await this.engine.generateWithModel({
        prompt,
        model: this.config.primaryModel || 'gemini',
        apiKeys: this.config.apiKeys,
        systemPrompt,
        temperature: 0.78,
        maxTokens: 12000
      });
    }

    // Add videos section if available and not already embedded
    let finalContent = result.content;
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

  private async generateMetaDescription(keyword: string, title: string): Promise<string> {
    const prompt = `Write an SEO meta description for an article titled "${title}" about "${keyword}".

Requirements:
- Exactly 150-160 characters
- Include the primary keyword naturally
- Include a call-to-action
- Compelling and click-worthy
- No fluff or filler words

Output ONLY the meta description.`;

    const result = await this.engine.generateWithModel({
      prompt,
      model: this.config.primaryModel || 'gemini',
      apiKeys: this.config.apiKeys,
      temperature: 0.7,
      maxTokens: 100
    });

    return result.content.trim().replace(/^["']|["']$/g, '');
  }

  private buildVideoSection(videos: YouTubeVideo[]): string {
    return `
<section class="video-resources" style="background: linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, rgba(34, 197, 94, 0.05) 100%); border-radius: 20px; padding: 32px; margin: 40px 0; border: 1px solid rgba(34, 197, 94, 0.2); box-shadow: 0 10px 40px rgba(0,0,0,0.1);">
  <h2 style="margin-top: 0; display: flex; align-items: center; gap: 12px; color: #e5e7eb; font-size: 24px;">
    <span style="font-size: 28px;">📺</span> Recommended Video Resources
  </h2>
  <p style="color: #9ca3af; margin-bottom: 24px; font-size: 16px;">Learn more from these expert video guides:</p>
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
}

export function createOrchestrator(config: OrchestratorConfig): EnterpriseContentOrchestrator {
  return new EnterpriseContentOrchestrator(config);
}
