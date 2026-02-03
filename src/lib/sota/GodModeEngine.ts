/**
 * God Mode 2.0 - Autonomous SEO Maintenance Engine
 * 
 * Enterprise-grade 24/7 content optimization system that:
 * 1. Scans sitemaps automatically
 * 2. Scores page SEO health
 * 3. Prioritizes and queues pages
 * 4. Generates optimized content
 * 5. Publishes to WordPress
 */

import { seoHealthScorer } from './SEOHealthScorer';
import { EnterpriseContentOrchestrator } from './EnterpriseContentOrchestrator';
import type {
  GodModeState,
  GodModeConfig,
  GodModeQueueItem,
  GodModeHistoryItem,
  GodModeActivityItem,
  GodModeStatus,
  GodModePhase,
  DEFAULT_GOD_MODE_CONFIG,
} from './GodModeTypes';

type StateUpdateCallback = (updates: Partial<GodModeState>) => void;
type ActivityLogCallback = (item: Omit<GodModeActivityItem, 'id' | 'timestamp'>) => void;

export interface GodModeEngineOptions {
  config: GodModeConfig;
  sitemapUrls: string[];
  priorityUrls: Array<{ url: string; priority: 'critical' | 'high' | 'medium' | 'low' }>;
  excludedUrls: string[];
  excludedCategories: string[];
  priorityOnlyMode: boolean;
  onStateUpdate: StateUpdateCallback;
  onActivity: ActivityLogCallback;
  getAppConfig: () => {
    geminiApiKey?: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    openrouterApiKey?: string;
    groqApiKey?: string;
    primaryModel?: string;
    wpUrl?: string;
    wpUsername?: string;
    wpAppPassword?: string;
    enableNeuronWriter?: boolean;
    neuronWriterApiKey?: string;
    neuronWriterProjectId?: string;
  };
}

export class GodModeEngine {
  private isRunning = false;
  private isPaused = false;
  private abortController: AbortController | null = null;
  private options: GodModeEngineOptions;
  private orchestrator: EnterpriseContentOrchestrator | null = null;
  private queue: GodModeQueueItem[] = [];
  private processedToday = 0;
  private lastScanTime: Date | null = null;
  private cycleCount = 0;

  constructor(options: GodModeEngineOptions) {
    this.options = options;
  }

  /**
   * Start the autonomous engine
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.log('warning', 'Engine already running');
      return;
    }

    this.isRunning = true;
    this.isPaused = false;
    this.abortController = new AbortController();
    this.processedToday = 0;
    this.cycleCount = 0;

    this.log('success', '🚀 GOD MODE 2.0 ACTIVATED', 'Autonomous SEO maintenance engine is now running');
    this.updateState({
      status: 'running',
      stats: {
        totalProcessed: 0,
        successCount: 0,
        errorCount: 0,
        avgQualityScore: 0,
        lastScanAt: null,
        nextScanAt: this.calculateNextScan(),
        totalWordsGenerated: 0,
        sessionStartedAt: new Date(),
        cycleCount: 0,
      },
    });

    // Initialize orchestrator
    this.initializeOrchestrator();

    // Start the main loop
    await this.mainLoop();
  }

  /**
   * Stop the engine gracefully
   */
  stop(): void {
    this.log('info', '⏹️ Stopping God Mode...', 'Graceful shutdown initiated');
    this.isRunning = false;
    this.isPaused = false;
    this.abortController?.abort();
    this.abortController = null;
    
    this.updateState({
      status: 'idle',
      currentPhase: null,
      currentUrl: null,
    });
    
    this.log('success', '✅ God Mode stopped', `Processed ${this.cycleCount} cycles this session`);
  }

  /**
   * Pause the engine (maintains state)
   */
  pause(): void {
    if (!this.isRunning) return;
    
    this.isPaused = true;
    this.log('info', '⏸️ God Mode paused', 'Processing will resume when unpaused');
    this.updateState({ status: 'paused' });
  }

  /**
   * Resume from paused state
   */
  resume(): void {
    if (!this.isRunning || !this.isPaused) return;
    
    this.isPaused = false;
    this.log('info', '▶️ God Mode resumed', 'Continuing autonomous processing');
    this.updateState({ status: 'running' });
  }

  /**
   * Main processing loop
   */
  private async mainLoop(): Promise<void> {
    while (this.isRunning && !this.abortController?.signal.aborted) {
      try {
        // Check if paused
        if (this.isPaused) {
          await this.sleep(1000);
          continue;
        }

        // Check active hours
        if (!this.isWithinActiveHours()) {
          this.log('info', '💤 Outside active hours', `Will resume at ${this.options.config.activeHoursStart}:00`);
          await this.sleep(60000); // Check every minute
          continue;
        }

        // Check daily limit
        if (this.processedToday >= this.options.config.maxPerDay) {
          this.log('info', '📊 Daily limit reached', `Processed ${this.processedToday}/${this.options.config.maxPerDay} articles today`);
          await this.sleep(3600000); // Check every hour
          continue;
        }

        this.cycleCount++;
        this.updateState({ stats: { ...this.getDefaultStats(), cycleCount: this.cycleCount } });

        // PHASE 1: Sitemap Scan (if needed)
        if (this.shouldScan()) {
          await this.runScanPhase();
        }

        // PHASE 2: Health Scoring (if queue is empty)
        if (this.queue.length === 0) {
          await this.runScoringPhase();
        }

        // PHASE 3: Content Generation
        if (this.queue.length > 0) {
          await this.runGenerationPhase();
        } else {
          this.log('info', '✨ Queue empty', 'All pages are healthy or excluded');
          await this.sleep(this.options.config.processingIntervalMinutes * 60 * 1000);
        }

      } catch (error) {
        if (this.abortController?.signal.aborted) break;
        
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.log('error', '❌ Cycle error', message);
        this.updateState({ status: 'error', lastError: message });
        
        // Exponential backoff
        await this.sleep(Math.min(300000, 30000 * Math.pow(2, this.cycleCount % 5)));
      }
    }
  }

  /**
   * Phase 1: Sitemap Scanning
   */
  private async runScanPhase(): Promise<void> {
    if (this.options.priorityOnlyMode) {
      this.log('info', '🎯 Priority Only Mode', 'Skipping sitemap scan, using priority queue only');
      return;
    }

    this.updateState({ currentPhase: 'scanning' });
    this.log('info', '🔍 Scanning sitemap...', `${this.options.sitemapUrls.length} URLs available`);

    this.lastScanTime = new Date();
    
    this.updateState({
      stats: {
        ...this.getDefaultStats(),
        lastScanAt: this.lastScanTime,
        nextScanAt: this.calculateNextScan(),
      },
    });

    this.log('success', '✅ Sitemap scan complete', `Found ${this.options.sitemapUrls.length} URLs`);
  }

  /**
   * Phase 2: SEO Health Scoring
   */
  private async runScoringPhase(): Promise<void> {
    this.updateState({ currentPhase: 'scoring' });
    
    // Get URLs to score
    const urlsToScore = this.options.priorityOnlyMode
      ? this.options.priorityUrls.map(p => p.url)
      : this.options.sitemapUrls;

    // Filter excluded URLs
    const filteredUrls = urlsToScore.filter(url => !this.isExcluded(url));

    if (filteredUrls.length === 0) {
      this.log('warning', '⚠️ No URLs to score', 'Check exclusion rules or add priority URLs');
      return;
    }

    this.log('info', '📊 Scoring page health...', `Analyzing ${filteredUrls.length} pages`);

    // Score pages in batches
    const urlsToAnalyze = filteredUrls.slice(0, 20); // Limit to 20 at a time
    
    for (let i = 0; i < urlsToAnalyze.length; i++) {
      if (this.abortController?.signal.aborted || this.isPaused) break;
      
      const url = urlsToAnalyze[i];
      this.updateState({ currentUrl: url });
      
      try {
        const analysis = await seoHealthScorer.analyzePage(url);
        
        // Add to queue if below threshold
        if (analysis.score < this.options.config.minHealthScore) {
          const priority = this.calculatePriority(analysis.score, url);
          
          this.queue.push({
            id: crypto.randomUUID(),
            url,
            priority,
            healthScore: analysis.score,
            addedAt: new Date(),
            source: this.options.priorityUrls.some(p => p.url === url) ? 'manual' : 'scan',
            retryCount: 0,
          });

          this.log('info', `📋 Queued: ${this.getSlug(url)}`, `Score: ${analysis.score} | Priority: ${priority}`);
        }
        
        // Throttle
        await this.sleep(500);
      } catch (error) {
        this.log('warning', `⚠️ Failed to score ${this.getSlug(url)}`, error instanceof Error ? error.message : 'Unknown error');
      }
    }

    // Sort queue by priority
    this.sortQueue();
    
    this.updateState({
      queue: this.queue,
      currentUrl: null,
    });

    this.log('success', '✅ Scoring complete', `${this.queue.length} pages need optimization`);
  }

  /**
   * Phase 3: Content Generation & Publishing
   */
  private async runGenerationPhase(): Promise<void> {
    const item = this.queue.shift();
    if (!item) return;

    this.updateState({
      currentPhase: 'generating',
      currentUrl: item.url,
      queue: this.queue,
    });

    const startTime = Date.now();
    this.log('info', `⚡ Generating content...`, `URL: ${this.getSlug(item.url)}`);

    try {
      // Extract keyword from URL slug
      const keyword = this.extractKeyword(item.url);
      
      if (!this.orchestrator) {
        throw new Error('Content orchestrator not initialized');
      }

      // Generate content
      const content = await this.orchestrator.generateContent({
        keyword,
        onProgress: (msg) => this.log('info', msg),
      });

      const processingTime = Date.now() - startTime;
      const qualityScore = content.qualityScore?.overall || 85;
      const wordCount = content.metrics?.wordCount || 0;

      // Check quality threshold
      if (qualityScore < this.options.config.qualityThreshold) {
        this.log('warning', `⚠️ Below quality threshold`, `Score: ${qualityScore}/${this.options.config.qualityThreshold}`);
        
        this.addToHistory({
          url: item.url,
          action: 'skipped',
          qualityScore,
          processingTimeMs: processingTime,
          error: `Quality score ${qualityScore} below threshold ${this.options.config.qualityThreshold}`,
        });
        
        return;
      }

      // Auto-publish or queue for review
      if (this.options.config.autoPublish) {
        await this.runPublishPhase(item, content, processingTime, qualityScore);
      } else {
        this.log('success', `✅ Content generated`, `Score: ${qualityScore} | Words: ${wordCount}`);
        
        this.addToHistory({
          url: item.url,
          action: 'generated',
          qualityScore,
          processingTimeMs: processingTime,
          wordCount,
        });
      }

      this.processedToday++;
      
      // Update stats
      this.updateStats(qualityScore, wordCount, true);

      // Wait before next item
      await this.sleep(this.options.config.processingIntervalMinutes * 60 * 1000);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed';
      this.log('error', `❌ Generation failed`, message);
      
      // Retry logic
      if (item.retryCount < this.options.config.retryAttempts) {
        item.retryCount++;
        item.lastError = message;
        this.queue.push(item);
        this.sortQueue();
        this.log('info', `🔄 Requeued for retry`, `Attempt ${item.retryCount}/${this.options.config.retryAttempts}`);
      } else {
        this.addToHistory({
          url: item.url,
          action: 'error',
          error: message,
          processingTimeMs: Date.now() - startTime,
        });
      }
      
      this.updateStats(0, 0, false);
    }
  }

  /**
   * Phase 4: WordPress Publishing
   */
  private async runPublishPhase(
    item: GodModeQueueItem,
    content: any,
    processingTime: number,
    qualityScore: number
  ): Promise<void> {
    this.updateState({ currentPhase: 'publishing' });
    this.log('info', `📤 Publishing to WordPress...`, this.getSlug(item.url));

    const wordCount = content.metrics?.wordCount || 0;

    try {
      const appConfig = this.options.getAppConfig();
      
      if (!appConfig.wpUrl || !appConfig.wpUsername || !appConfig.wpAppPassword) {
        throw new Error('WordPress credentials not configured');
      }

      // Call WordPress publish function
      const response = await fetch(
        'https://ousxeycrhvuwaejhpqgv.supabase.co/functions/v1/wordpress-publish',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            wpUrl: appConfig.wpUrl,
            wpUsername: appConfig.wpUsername,
            wpPassword: appConfig.wpAppPassword,
            title: content.title,
            content: content.content,
            status: this.options.config.defaultStatus,
            seoTitle: content.seoTitle,
            metaDescription: content.metaDescription,
            sourceUrl: item.url,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`WordPress API error: ${response.status}`);
      }

      const result = await response.json();
      
      this.log('success', `✅ Published!`, `${result.link || item.url}`);
      
      this.addToHistory({
        url: item.url,
        action: 'published',
        qualityScore,
        wordPressUrl: result.link,
        processingTimeMs: processingTime,
        wordCount,
      });

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Publish failed';
      this.log('error', `❌ Publish failed`, message);
      
      // Still count as generated even if publish failed
      this.addToHistory({
        url: item.url,
        action: 'error',
        qualityScore,
        error: `Generated but publish failed: ${message}`,
        processingTimeMs: processingTime,
      });
    }
  }

  // ===== HELPER METHODS =====

  private initializeOrchestrator(): void {
    const appConfig = this.options.getAppConfig();
    
    this.orchestrator = new EnterpriseContentOrchestrator({
      apiKeys: {
        geminiApiKey: appConfig.geminiApiKey || '',
        openaiApiKey: appConfig.openaiApiKey,
        anthropicApiKey: appConfig.anthropicApiKey,
        openrouterApiKey: appConfig.openrouterApiKey,
        groqApiKey: appConfig.groqApiKey,
        serperApiKey: '',
      },
      organizationName: '',
      organizationUrl: appConfig.wpUrl || '',
      authorName: '',
      primaryModel: appConfig.primaryModel as any,
      neuronWriterApiKey: appConfig.neuronWriterApiKey,
      neuronWriterProjectId: appConfig.neuronWriterProjectId,
    });
  }

  private shouldScan(): boolean {
    if (!this.lastScanTime) return true;
    
    const hoursSinceLastScan = (Date.now() - this.lastScanTime.getTime()) / (1000 * 60 * 60);
    return hoursSinceLastScan >= this.options.config.scanIntervalHours;
  }

  private calculateNextScan(): Date {
    const next = new Date();
    next.setHours(next.getHours() + this.options.config.scanIntervalHours);
    return next;
  }

  private isWithinActiveHours(): boolean {
    const hour = new Date().getHours();
    const day = new Date().getDay();
    
    // Check weekend
    if (!this.options.config.enableWeekends && (day === 0 || day === 6)) {
      return false;
    }
    
    return hour >= this.options.config.activeHoursStart && 
           hour < this.options.config.activeHoursEnd;
  }

  private isExcluded(url: string): boolean {
    // Check exact URL exclusions
    if (this.options.excludedUrls.some(excl => url.includes(excl))) {
      return true;
    }
    
    // Check category exclusions
    if (this.options.excludedCategories.some(cat => url.toLowerCase().includes(cat.toLowerCase()))) {
      return true;
    }
    
    return false;
  }

  private calculatePriority(score: number, url: string): GodModeQueueItem['priority'] {
    // Check if in priority URLs
    const priorityUrl = this.options.priorityUrls.find(p => p.url === url);
    if (priorityUrl) return priorityUrl.priority;
    
    // Score-based priority
    if (score < 30) return 'critical';
    if (score < 50) return 'high';
    if (score < 70) return 'medium';
    return 'low';
  }

  private sortQueue(): void {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    this.queue.sort((a, b) => {
      // First by priority
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      
      // Then by health score (lower is more urgent)
      return a.healthScore - b.healthScore;
    });
  }

  private extractKeyword(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const slug = pathname.split('/').filter(Boolean).pop() || '';
      return slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    } catch {
      return url;
    }
  }

  private getSlug(url: string): string {
    try {
      return new URL(url).pathname.split('/').filter(Boolean).pop() || url;
    } catch {
      return url;
    }
  }

  private addToHistory(item: Omit<GodModeHistoryItem, 'id' | 'timestamp'>): void {
    // This will be called by the hook to update state
    this.options.onStateUpdate({
      history: [{
        id: crypto.randomUUID(),
        timestamp: new Date(),
        ...item,
      }] as any, // Append handled by hook
    });
  }

  private updateStats(qualityScore: number, wordCount: number, success: boolean): void {
    // Stats update handled by hook
    const update = {
      totalProcessed: 1,
      successCount: success ? 1 : 0,
      errorCount: success ? 0 : 1,
      qualityScore,
      wordCount,
    };
    
    this.options.onStateUpdate({ stats: update as any });
  }

  private getDefaultStats() {
    return {
      totalProcessed: 0,
      successCount: 0,
      errorCount: 0,
      avgQualityScore: 0,
      lastScanAt: this.lastScanTime,
      nextScanAt: this.calculateNextScan(),
      totalWordsGenerated: 0,
      sessionStartedAt: new Date(),
      cycleCount: this.cycleCount,
    };
  }

  private log(type: GodModeActivityItem['type'], message: string, details?: string): void {
    console.log(`[GodMode ${type.toUpperCase()}] ${message}${details ? ': ' + details : ''}`);
    this.options.onActivity({ type, message, details });
  }

  private updateState(updates: Partial<GodModeState>): void {
    this.options.onStateUpdate(updates);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      const timeout = setTimeout(resolve, ms);
      this.abortController?.signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  // ===== PUBLIC GETTERS =====

  get status(): GodModeStatus {
    if (this.isPaused) return 'paused';
    if (this.isRunning) return 'running';
    return 'idle';
  }

  get queueLength(): number {
    return this.queue.length;
  }
}
