// ============================================================
// SOTA ENTERPRISE TYPES - WP Content Optimizer Pro
// ============================================================

export type AIModel = 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'groq';

export interface APIKeys {
  geminiApiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  openrouterApiKey?: string;
  groqApiKey?: string;
  serperApiKey?: string;
}

export interface GenerationParams {
  prompt: string;
  model: AIModel;
  apiKeys: APIKeys;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface GenerationResult {
  content: string;
  model: AIModel;
  tokensUsed: number;
  duration: number;
  cached: boolean;
}

export interface ConsensusResult {
  finalContent: string;
  models: AIModel[];
  scores: Record<AIModel, number>;
  synthesized: boolean;
  confidence: number;
}

export interface QualityScore {
  overall: number;
  readability: number;
  seo: number;
  eeat: number;
  uniqueness: number;
  factAccuracy: number;
  passed: boolean;
  improvements: string[];
}

export interface SERPResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
  domain: string;
}

export interface SERPAnalysis {
  avgWordCount: number;
  commonHeadings: string[];
  contentGaps: string[];
  userIntent: 'informational' | 'transactional' | 'navigational' | 'commercial';
  semanticEntities: string[];
  topCompetitors: SERPResult[];
  recommendedWordCount: number;
  recommendedHeadings: string[];
}

export interface InternalLink {
  anchor?: string;
  anchorText?: string;
  targetUrl: string;
  url?: string;
  text?: string;
  context: string;
  priority: number;
  relevanceScore: number;
}

export interface SchemaMarkup {
  '@context': string;
  '@graph': SchemaEntity[];
}

export interface SchemaEntity {
  '@type': string;
  [key: string]: unknown;
}

export interface EEATProfile {
  author: {
    name: string;
    credentials: string[];
    publications: string[];
    expertiseAreas: string[];
    socialProfiles: { platform: string; url: string }[];
  };
  citations: { title: string; url: string; type: string }[];
  expertReviews: { reviewer: string; rating: number; comment: string }[];
  methodology: string;
  lastUpdated: Date;
  factChecked: boolean;
}

export interface ContentMetrics {
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  headingCount: number;
  imageCount: number;
  linkCount: number;
  keywordDensity: number;
  readabilityGrade: number;
  estimatedReadTime: number;
}

export interface GeneratedContent {
  id: string;
  title: string;
  content: string;
  metaDescription: string;
  slug: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  metrics: ContentMetrics;
  qualityScore: QualityScore;
  internalLinks: InternalLink[];
  schema: SchemaMarkup;
  eeat: EEATProfile;
  serpAnalysis: SERPAnalysis;
  generatedAt: Date;
  model: AIModel;
  consensusUsed: boolean;
}

export interface YouTubeVideo {
  id: string;
  title: string;
  channelTitle: string;
  description: string;
  thumbnailUrl: string;
  publishedAt: string;
  viewCount?: string;
  duration?: string;
}

export interface Reference {
  title: string;
  url: string;
  type: 'academic' | 'news' | 'industry' | 'government' | 'blog';
  domain: string;
  publishedDate?: string;
  authorityScore: number;
}

export interface ContentPlan {
  pillarTopic: string;
  pillarKeyword: string;
  clusters: {
    keyword: string;
    title: string;
    type: 'how-to' | 'guide' | 'comparison' | 'listicle' | 'deep-dive';
    priority: 'high' | 'medium' | 'low';
  }[];
  totalEstimatedWords: number;
  estimatedTimeToComplete: string;
}

export interface AnalyticsDashboardData {
  totalGenerated: number;
  avgQualityScore: number;
  avgWordCount: number;
  modelUsage: Record<AIModel, number>;
  cacheHitRate: number;
  avgGenerationTime: number;
  topKeywords: { keyword: string; count: number }[];
  qualityTrend: { date: string; score: number }[];
}

export interface WorkerMessage {
  type: 'GENERATE' | 'ANALYZE' | 'VALIDATE' | 'COMPLETE' | 'ERROR' | 'PROGRESS';
  payload: unknown;
  id: string;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}
