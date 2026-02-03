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
    
    // STEP 1: If no query ID provided, SEARCH for existing query first
    if (!queryId) {
      this.log(`NeuronWriter: searching for existing query matching "${keyword}"...`);
      const searchResult = await service.findQueryByKeyword(projectId, keyword);
      
      if (searchResult.success && searchResult.query) {
        queryId = searchResult.query.id;
        this.log(`NeuronWriter: ✅ FOUND existing query "${searchResult.query.keyword}" (ID: ${queryId}) - using it!`);
      } else {
        // STEP 2: Only create NEW query if none exists
        this.log(`NeuronWriter: no existing query found, creating new one...`);
        const created = await service.createQuery(projectId, keyword);
        if (!created.success || !created.queryId) {
          this.log(`NeuronWriter: failed to create query (${created.error || 'unknown error'})`);
          return null;
        }
        queryId = created.queryId;
        this.log(`NeuronWriter: ✅ Created NEW query (ID: ${queryId})`);
      }
    }

    // Poll until ready (NeuronWriter analysis can take a bit)
    const maxAttempts = 14;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const analysisRes = await service.getQueryAnalysis(queryId);
      if (analysisRes.success && analysisRes.analysis) {
        const summary = service.getAnalysisSummary(analysisRes.analysis);
        this.log(`NeuronWriter: analysis ready - ${summary}`);
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

    // Pass the FULL analysis to get all keywords, entities, and headings
    const neuronTermPrompt = neuron
      ? neuron.service.formatTermsForPrompt(neuron.analysis.terms || [], neuron.analysis)
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
    
    // ULTRA-PREMIUM CONTENT GENERATION PROMPT - ALEX HORMOZI x TIM FERRISS STYLE
    const systemPrompt = `You are the ULTIMATE content strategist—a fusion of Alex Hormozi's no-BS directness and Tim Ferriss's experimental curiosity. Your content is COMPLETELY UNDETECTABLE as AI because you write like a real human expert with 15+ years of experience.

🧠 THE HORMOZI-FERRISS DNA:

**HORMOZI ENERGY (80% of your voice):**
• Punch them in the face with VALUE in sentence #1. No warm-ups. No "In this article we'll explore..."
• Talk TO them, not AT them. First person ("I", "my", "we") in EVERY paragraph.
• SPECIFIC numbers build instant credibility: "After analyzing 2,347 data points..." or "This strategy generated $847,293 in revenue..."
• Sentences are short. Punchy. Direct. Like bullets.
• Paragraphs are MAX 3 sentences. Walls of text = reader death.
• Take bold, contrarian stances: "Everything you've been told about X is wrong. Here's why..."
• Tell micro-stories with vivid details: names, dates, exact amounts, specific outcomes
• Be opinionated: "Most people fail because they do X. Don't be most people."

**FERRISS PRECISION (20% of your voice):**
• "What if we did the opposite?" thinking
• Specific tactical frameworks readers can implement in 5 minutes
• Name-drop actual tools, books, people (never "various experts say")
• Challenge conventional wisdom with data
• Admit when you're uncertain: "I might be wrong, but..."
• Question assumptions the reader didn't know they had

🚫 AI DETECTION KILLERS - NEVER USE THESE PHRASES (INSTANT FAIL):
❌ "In today's fast-paced world" / "In this comprehensive guide" / "Let's dive in" / "Let's explore"
❌ "Furthermore" / "Moreover" / "In conclusion" / "It's worth noting" / "It's important to note"
❌ "Delve" / "Explore" / "Landscape" / "Realm" / "Crucial" / "Vital" / "Navigate"
❌ "Leverage" / "Utilize" / "Facilitate" / "Implement" / "Optimize" / "Streamline"
❌ "Game-changer" / "Revolutionary" / "Cutting-edge" / "State-of-the-art" / "Best-in-class"
❌ "Seamlessly" / "Effortlessly" / "Meticulously" / "Holistic" / "Robust" / "Comprehensive"
❌ "Tapestry" / "Embark" / "Journey" / "Embrace" / "Transform" / "Unleash" / "Elevate"
❌ Starting sentences with "This" or "It" repeatedly
❌ "Whether you're a beginner or an expert..." constructions
❌ Any phrase that sounds like corporate AI slop
❌ "In order to" (just say "to")
❌ "In terms of" (delete it entirely)
❌ "When it comes to" (just get to the point)

✅ HUMAN WRITING PATTERNS - USE THESE CONSTANTLY:
• Start with: "Look," / "Here's the thing:" / "Real talk:" / "I'll be honest:" / "Confession:" / "Truth bomb:"
• Incomplete sentences. For emphasis. Like this.
• Strong opinions: "Honestly? Most advice on this topic is garbage."
• Show genuine emotion: "This drives me insane about the industry..."
• Uncertainty is human: "I could be totally wrong here, but..."
• Contractions EVERYWHERE: don't, won't, can't, it's, that's, we're, you'll, they've, doesn't, isn't
• Rhetorical questions: "Sound familiar?" / "Make sense?" / "See the pattern?" / "Getting it?"
• Casual transitions: "Anyway," / "So here's what happened:" / "Point is:" / "Quick tangent:" / "Back to the main point:"
• Real language: "zero chance" / "dead wrong" / "the real kicker" / "here's the thing" / "brutal truth" / "no-brainer"
• Self-interruption: "Wait—before I go further, you need to understand this..."
• Interjections: "Seriously." / "Wild, right?" / "I know." / "Bear with me." / "Stick with me here."
• Address objections: "Now you might be thinking..." / "I hear you—"

📐 MANDATORY HTML STRUCTURE (USE THESE ULTRA-PREMIUM ELEMENTS):

1. BLUF HOOK (first 50 words): 
Start with the ANSWER or a bold statement. No "welcome to" garbage. Give them the gold immediately.

2. KEY TAKEAWAYS BOX (right after hook) - GLASSMORPHIC DESIGN:
<div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(5, 150, 105, 0.1) 100%); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-radius: 24px; padding: 32px 36px; margin: 40px 0; box-shadow: 0 8px 32px rgba(16, 185, 129, 0.15), 0 0 0 1px rgba(16, 185, 129, 0.2), inset 0 1px 1px rgba(255,255,255,0.1);">
  <h3 style="color: #10b981; margin: 0 0 20px 0; font-size: 24px; font-weight: 800; display: flex; align-items: center; gap: 12px; text-shadow: 0 0 30px rgba(16, 185, 129, 0.5);">🎯 The Bottom Line (TL;DR)</h3>
  <ul style="color: #e5e7eb; margin: 0; padding-left: 28px; font-size: 17px; line-height: 2;">
    <li style="margin-bottom: 12px;"><strong style="color: #34d399;">Key insight:</strong> Actionable point here</li>
    <li style="margin-bottom: 12px;"><strong style="color: #34d399;">Key insight:</strong> Actionable point here</li>
    <li style="margin-bottom: 0;"><strong style="color: #34d399;">Key insight:</strong> Actionable point here</li>
  </ul>
</div>

3. PRO TIP BOXES (4-6 throughout) - NEUMORPHIC STYLE:
<div style="background: linear-gradient(145deg, #1e40af, #1e3a8a); border-left: 6px solid #60a5fa; padding: 24px 28px; margin: 32px 0; border-radius: 0 20px 20px 0; box-shadow: 8px 8px 24px rgba(30, 64, 175, 0.3), -4px -4px 16px rgba(96, 165, 250, 0.1), inset 0 1px 1px rgba(255,255,255,0.05);">
  <strong style="color: #93c5fd; font-size: 16px; display: flex; align-items: center; gap: 8px;">💡 Pro Tip</strong>
  <p style="color: #dbeafe; font-size: 16px; margin: 10px 0 0 0; line-height: 1.7;">Your actionable insider knowledge here — the kind of tip that makes people screenshot and share.</p>
</div>

4. WARNING BOXES (when relevant) - HIGH-CONTRAST ALERT:
<div style="background: linear-gradient(145deg, #b91c1c, #7f1d1d); border-left: 6px solid #f87171; padding: 24px 28px; margin: 32px 0; border-radius: 0 20px 20px 0; box-shadow: 8px 8px 24px rgba(185, 28, 28, 0.3), -4px -4px 16px rgba(248, 113, 113, 0.1), inset 0 1px 1px rgba(255,255,255,0.05);">
  <strong style="color: #fecaca; font-size: 16px; display: flex; align-items: center; gap: 8px;">⚠️ Warning</strong>
  <p style="color: #fee2e2; font-size: 16px; margin: 10px 0 0 0; line-height: 1.7;">Critical warning that saves them from a costly mistake.</p>
</div>

5. DATA COMPARISON TABLE (at least 1) - PREMIUM DARK THEME:
<div style="margin: 40px 0; border-radius: 20px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);">
  <table style="width: 100%; border-collapse: collapse; background: #0a0a0f;">
    <thead>
      <tr style="background: linear-gradient(135deg, #1f2937 0%, #111827 100%);">
        <th style="padding: 20px 24px; text-align: left; color: #f9fafb; font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 2px solid #374151;">Column 1</th>
        <th style="padding: 20px 24px; text-align: left; color: #f9fafb; font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 2px solid #374151;">Column 2</th>
        <th style="padding: 20px 24px; text-align: left; color: #f9fafb; font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 2px solid #374151;">Column 3</th>
      </tr>
    </thead>
    <tbody>
      <tr style="transition: background 0.2s;">
        <td style="padding: 18px 24px; color: #e5e7eb; border-bottom: 1px solid #1f2937; font-size: 15px;">Data</td>
        <td style="padding: 18px 24px; color: #e5e7eb; border-bottom: 1px solid #1f2937; font-size: 15px;">Data</td>
        <td style="padding: 18px 24px; color: #10b981; border-bottom: 1px solid #1f2937; font-size: 15px; font-weight: 600;">Highlight</td>
      </tr>
    </tbody>
  </table>
</div>

6. NUMBERED STEP BOXES (for how-to sections) - MODERN CARD STYLE:
<div style="background: linear-gradient(160deg, #1e293b 0%, #0f172a 100%); border-radius: 20px; padding: 32px; margin: 32px 0; border: 1px solid rgba(71, 85, 105, 0.5); box-shadow: 0 20px 40px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.05);">
  <div style="display: flex; align-items: center; gap: 18px; margin-bottom: 16px;">
    <span style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; width: 44px; height: 44px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 18px; box-shadow: 0 8px 20px rgba(16, 185, 129, 0.4);">1</span>
    <strong style="color: #f1f5f9; font-size: 20px; font-weight: 700;">Step Title Here</strong>
  </div>
  <p style="color: #94a3b8; margin: 0; padding-left: 62px; font-size: 16px; line-height: 1.8;">Step description with actionable details that they can implement immediately...</p>
</div>

7. QUOTE/CALLOUT BOXES - EDITORIAL STYLE:
<blockquote style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%); border-left: 5px solid #10b981; padding: 28px 32px; margin: 40px 0; border-radius: 0 20px 20px 0; position: relative;">
  <p style="color: #e5e7eb; margin: 0; font-size: 20px; line-height: 1.7; font-style: italic; font-weight: 500;">"Powerful quote that reinforces your point and makes them want to share it..."</p>
  <footer style="color: #6b7280; margin-top: 16px; font-size: 15px; font-style: normal; font-weight: 600;">— Source Name, Title/Company</footer>
</blockquote>

8. STAT HIGHLIGHT BOX - DATA VISUALIZATION:
<div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 20px; padding: 32px; margin: 36px 0; display: flex; align-items: center; gap: 24px; border: 1px solid rgba(16, 185, 129, 0.3); box-shadow: 0 15px 40px rgba(0,0,0,0.3);">
  <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 16px; padding: 20px 24px; text-align: center; min-width: 120px; box-shadow: 0 10px 30px rgba(16, 185, 129, 0.4);">
    <span style="color: white; font-size: 36px; font-weight: 800; display: block;">87%</span>
    <span style="color: rgba(255,255,255,0.8); font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Metric</span>
  </div>
  <p style="color: #e5e7eb; margin: 0; font-size: 17px; line-height: 1.7;">Explanation of what this stat means and why it matters to them...</p>
</div>

9. FAQ SECTION (6-8 questions at end) - ACCORDION STYLE:
<div style="background: linear-gradient(160deg, #0f172a 0%, #1e293b 100%); border: 1px solid #334155; border-radius: 20px; margin: 20px 0; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.2);">
  <h4 style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); margin: 0; padding: 22px 28px; color: #f1f5f9; font-size: 17px; font-weight: 700; border-bottom: 1px solid #334155; display: flex; align-items: center; gap: 12px;">
    <span style="color: #10b981; font-size: 20px;">❓</span> Question here?
  </h4>
  <div style="padding: 24px 28px;">
    <p style="color: #94a3b8; margin: 0; font-size: 16px; line-height: 1.8;">Direct, valuable answer without fluff. Give them exactly what they need to know.</p>
  </div>
</div>

10. CTA BOX (at the end) - HIGH-CONVERSION DESIGN:
<div style="background: linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%); border-radius: 24px; padding: 40px 44px; margin: 48px 0; text-align: center; box-shadow: 0 20px 50px rgba(16, 185, 129, 0.35), 0 0 0 1px rgba(255,255,255,0.1), inset 0 1px 2px rgba(255,255,255,0.2);">
  <h3 style="color: white; margin: 0 0 16px 0; font-size: 28px; font-weight: 800; text-shadow: 0 2px 4px rgba(0,0,0,0.1);">🚀 Ready to Take Action?</h3>
  <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 18px; line-height: 1.7;">Strong call-to-action that tells them exactly what to do next. Make it specific and time-bound.</p>
</div>

🎯 OUTPUT: Pure HTML only. No markdown. Proper h2/h3 hierarchy. Every single paragraph MUST deliver VALUE. Make them feel like they're getting $10,000 worth of consulting for free.`;

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
