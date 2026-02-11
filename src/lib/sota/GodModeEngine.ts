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
    organizationName?: string;
    authorName?: string;
    serperApiKey?: string;
    openrouterModelId?: string;
    groqModelId?: string;
  };
}

const ENTERPRISE_CONSTANTS = {
  MIN_QUALITY_SCORE: 90,
  MAX_QUALITY_IMPROVEMENT_PASSES: 3,
  EXPONENTIAL_BACKOFF_BASE_MS: 5000,
  EXPONENTIAL_BACKOFF_MAX_MS: 300000,
  CIRCUIT_BREAKER_THRESHOLD: 5,
  CIRCUIT_BREAKER_RESET_MS: 600000,
  ADAPTIVE_THROTTLE_MIN_MS: 2000,
  ADAPTIVE_THROTTLE_MAX_MS: 10000,
  SCORING_BATCH_SIZE: 50,
  SCORING_CONCURRENCY: 3,
};

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

  private consecutiveFailures = 0;
  private circuitBrokenUntil: Date | null = null;
  private qualityScoreHistory: number[] = [];
  private processingTimeHistory: number[] = [];
  private adaptiveThrottleMs = ENTERPRISE_CONSTANTS.ADAPTIVE_THROTTLE_MIN_MS;

  constructor(options: GodModeEngineOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.log('warning', 'Engine already running');
      return;
    }

    if (this.options.priorityOnlyMode) {
      if (this.options.priorityUrls.length === 0) {
        throw new Error('Priority Only Mode requires at least one URL in the Priority Queue. Add URLs to your priority queue first.');
      }
      this.log('info', 'PRIORITY ONLY MODE ENABLED',
        `Processing ONLY ${this.options.priorityUrls.length} priority URLs. Sitemap scanning is DISABLED.`);
    }

    this.isRunning = true;
    this.isPaused = false;
    this.abortController = new AbortController();
    this.processedToday = 0;
    this.cycleCount = 0;
    this.adaptiveThrottleMs = ENTERPRISE_CONSTANTS.ADAPTIVE_THROTTLE_MIN_MS;

    const modeLabel = this.options.priorityOnlyMode ? 'PRIORITY ONLY' : 'FULL SITEMAP';
    this.log('success', 'GOD MODE 2.0 ACTIVATED', `Mode: ${modeLabel} | Autonomous SEO engine is now running`);

    this.updateState({
      status: 'running',
      stats: {
        totalProcessed: 0,
        successCount: 0,
        errorCount: 0,
        avgQualityScore: 0,
        lastScanAt: null,
        nextScanAt: this.options.priorityOnlyMode ? null : this.calculateNextScan(),
        totalWordsGenerated: 0,
        sessionStartedAt: new Date(),
        cycleCount: 0,
      },
    });

    this.initializeOrchestrator();

    if (this.options.priorityOnlyMode) {
      this.initializePriorityQueue();
    } else {
      this.restoreQueue(); // ← NEW: restore persisted queue from localStorage
    }

    await this.mainLoop();
  }

  private initializePriorityQueue(): void {
    this.queue = [];

    const appConfig = this.options.getAppConfig();
    const hasNeuronWriter = !!(appConfig.neuronWriterApiKey && appConfig.neuronWriterProjectId);

    this.log('info', '=== PRIORITY ONLY MODE - INITIALIZATION ===', '');

    this.log('info', 'Pre-flight Checks', '');
    this.log('info', `  Total Priority URLs: ${this.options.priorityUrls.length}`, '');
    this.log('info', `  NeuronWriter: ${hasNeuronWriter ? 'ENABLED' : 'DISABLED (basic scoring)'}`, '');
    this.log('info', `  Quality Threshold: ${this.options.config.qualityThreshold}%`, '');
    this.log('info', `  Multi-pass Quality: ${ENTERPRISE_CONSTANTS.MAX_QUALITY_IMPROVEMENT_PASSES} passes max`, '');
    this.log('info', `  Retry Attempts: ${this.options.config.retryAttempts} with exponential backoff`, '');

    const priorityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    let excludedCount = 0;

    for (const priorityUrl of this.options.priorityUrls) {
      if (this.isExcluded(priorityUrl.url)) {
        this.log('info', `  Excluded: ${this.getSlug(priorityUrl.url)}`);
        excludedCount++;
        continue;
      }

      if (this.queue.some(q => q.url === priorityUrl.url)) {
        continue;
      }

      priorityCounts[priorityUrl.priority]++;

      this.queue.push({
        id: crypto.randomUUID(),
        url: priorityUrl.url,
        priority: priorityUrl.priority,
        healthScore: 0,
        addedAt: new Date(),
        source: 'manual',
        retryCount: 0,
      });
    }

    this.sortQueue();
    this.updateState({ queue: this.queue });

    this.log('info', 'Queue Summary', '');
    this.log('info', `  Critical: ${priorityCounts.critical}`, '');
    this.log('info', `  High: ${priorityCounts.high}`, '');
    this.log('info', `  Medium: ${priorityCounts.medium}`, '');
    this.log('info', `  Low: ${priorityCounts.low}`, '');
    this.log('info', `  Excluded: ${excludedCount}`, '');

    const avgTimePerUrl = hasNeuronWriter ? 180 : 120;
    const estimatedMinutes = Math.ceil((this.queue.length * avgTimePerUrl) / 60);
    this.log('info', `  Estimated Time: ~${estimatedMinutes} minutes`, '');

    this.log('success', 'Priority Queue Ready',
      `${this.queue.length} URLs queued | NeuronWriter: ${hasNeuronWriter ? 'ON' : 'OFF'} | ETA: ~${estimatedMinutes}min`);
  }

  stop(): void {
    this.log('info', 'Stopping God Mode...', 'Graceful shutdown initiated');
    this.isRunning = false;
    this.isPaused = false;
    this.abortController?.abort();
    this.abortController = null;

    this.updateState({
      status: 'idle',
      currentPhase: null,
      currentUrl: null,
    });

    this.log('success', 'God Mode stopped', `Processed ${this.cycleCount} cycles this session`);
  }

  pause(): void {
    if (!this.isRunning) return;

    this.isPaused = true;
    this.log('info', 'God Mode paused', 'Processing will resume when unpaused');
    this.updateState({ status: 'paused' });
  }

  resume(): void {
    if (!this.isRunning || !this.isPaused) return;

    this.isPaused = false;
    this.log('info', 'God Mode resumed', 'Continuing autonomous processing');
    this.updateState({ status: 'running' });
  }

  private async mainLoop(): Promise<void> {
    while (this.isRunning && !this.abortController?.signal.aborted) {
      try {
        if (this.isPaused) {
          await this.sleep(1000);
          continue;
        }

        if (!this.isWithinActiveHours()) {
          this.log('info', 'Outside active hours', `Will resume at ${this.options.config.activeHoursStart}:00`);
          await this.sleep(60000);
          continue;
        }

        if (this.processedToday >= this.options.config.maxPerDay) {
          this.log('info', 'Daily limit reached', `Processed ${this.processedToday}/${this.options.config.maxPerDay} articles today`);
          await this.sleep(3600000);
          continue;
        }

        this.cycleCount++;
        this.updateState({ stats: { ...this.getDefaultStats(), cycleCount: this.cycleCount } });

        if (this.options.priorityOnlyMode) {
          if (this.queue.length > 0) {
            await this.runGenerationPhase();
          } else {
            this.log('success', 'Priority Queue Complete',
              'All priority URLs have been processed. Add more URLs to continue or disable Priority Only Mode.');
            this.updateState({ status: 'idle', currentPhase: null });
            this.stop();
            return;
          }
        } else {
          if (this.shouldScan()) {
            await this.runScanPhase();
          }

          if (this.queue.length === 0) {
            await this.runScoringPhase();
          }

          if (this.queue.length > 0) {
            await this.runGenerationPhase();
          } else {
            this.log('info', 'Queue empty', 'All pages are healthy or excluded. Waiting for next scan cycle...');
            await this.sleep(this.options.config.processingIntervalMinutes * 60 * 1000);
          }
        }

      } catch (error) {
        if (this.abortController?.signal.aborted) break;

        const message = error instanceof Error ? error.message : 'Unknown error';
        this.log('error', 'Cycle error', message);
        this.updateState({ status: 'error', lastError: message });

        await this.sleep(Math.min(300000, 30000 * Math.pow(2, this.cycleCount % 5)));
      }
    }
  }

  private async runScanPhase(): Promise<void> {
    if (this.options.priorityOnlyMode) {
      this.log('warning', 'Priority Only Mode Active', 'Sitemap scan phase was unexpectedly called - skipping');
      return;
    }

    this.updateState({ currentPhase: 'scanning' });
    this.log('info', 'Scanning sitemap...', `${this.options.sitemapUrls.length} URLs available`);

    const validUrls: string[] = [];
    const invalidUrls: string[] = [];

    for (const url of this.options.sitemapUrls) {
      if (this.abortController?.signal.aborted || this.isPaused) break;

      if (this.isExcluded(url)) continue;

      try {
        new URL(url);
        validUrls.push(url);
      } catch {
        invalidUrls.push(url);
      }
    }

    if (invalidUrls.length > 0) {
      this.log('warning', `${invalidUrls.length} invalid URLs skipped during scan`);
    }

    this.lastScanTime = new Date();

    this.updateState({
      stats: {
        ...this.getDefaultStats(),
        lastScanAt: this.lastScanTime,
        nextScanAt: this.calculateNextScan(),
      },
    });

    this.log('success', 'Sitemap scan complete', `${validUrls.length} valid URLs found, ${invalidUrls.length} invalid`);
  }

  private async runScoringPhase(): Promise<void> {
    this.updateState({ currentPhase: 'scoring' });

    const urlsToScore = this.options.priorityOnlyMode
      ? this.options.priorityUrls.map(p => p.url)
      : this.options.sitemapUrls;

    const filteredUrls = urlsToScore.filter(url => !this.isExcluded(url));

    if (filteredUrls.length === 0) {
      this.log('warning', 'No URLs to score', 'Check exclusion rules or add priority URLs');
      return;
    }

    const batchSize = Math.min(filteredUrls.length, ENTERPRISE_CONSTANTS.SCORING_BATCH_SIZE);
    this.log('info', 'Scoring page health...', `Analyzing ${batchSize} of ${filteredUrls.length} pages`);

    const urlsToAnalyze = filteredUrls.slice(0, batchSize);
    let scored = 0;

    for (let i = 0; i < urlsToAnalyze.length; i += ENTERPRISE_CONSTANTS.SCORING_CONCURRENCY) {
      if (this.abortController?.signal.aborted || this.isPaused) break;

      const batch = urlsToAnalyze.slice(i, i + ENTERPRISE_CONSTANTS.SCORING_CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map(async (url) => {
          this.updateState({ currentUrl: url });
          return { url, analysis: await seoHealthScorer.analyzePage(url) };
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { url, analysis } = result.value;
          scored++;

          if (analysis.score < this.options.config.minHealthScore && !this.queue.some(q => q.url === url)) {
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

            this.log('info', `Queued: ${this.getSlug(url)}`, `Score: ${analysis.score} | Priority: ${priority}`);
          }
        } else {
          this.log('warning', `Failed to score URL`, result.reason instanceof Error ? result.reason.message : 'Unknown error');
        }
      }

      this.log('info', `Scoring progress: ${scored}/${urlsToAnalyze.length}`, '');

      await this.sleep(this.adaptiveThrottleMs);
    }

    this.sortQueue();

    this.updateState({
      queue: this.queue,
      currentUrl: null,
    });

    this.log('success', 'Scoring complete', `${this.queue.length} pages need optimization (scored ${scored} pages)`);
  }

  private isCircuitBroken(): boolean {
    if (!this.circuitBrokenUntil) return false;
    if (new Date() >= this.circuitBrokenUntil) {
      this.circuitBrokenUntil = null;
      this.consecutiveFailures = 0;
      this.log('info', 'Circuit breaker reset', 'Resuming normal operations');
      return false;
    }
    return true;
  }

  private calculateBackoffDelay(retryCount: number): number {
    const delay = Math.min(
      ENTERPRISE_CONSTANTS.EXPONENTIAL_BACKOFF_BASE_MS * Math.pow(2, retryCount),
      ENTERPRISE_CONSTANTS.EXPONENTIAL_BACKOFF_MAX_MS
    );
    const jitter = delay * 0.2 * (Math.random() - 0.5);
    return Math.floor(delay + jitter);
  }

  private recordSuccess(qualityScore: number, processingTime: number): void {
    this.consecutiveFailures = 0;
    this.qualityScoreHistory.push(qualityScore);
    this.processingTimeHistory.push(processingTime);

    if (this.qualityScoreHistory.length > 50) this.qualityScoreHistory.shift();
    if (this.processingTimeHistory.length > 50) this.processingTimeHistory.shift();

    this.adjustAdaptiveThrottle(processingTime, true);
  }

  private recordFailure(): void {
    this.consecutiveFailures++;

    this.adjustAdaptiveThrottle(0, false);

    if (this.consecutiveFailures >= ENTERPRISE_CONSTANTS.CIRCUIT_BREAKER_THRESHOLD) {
      this.circuitBrokenUntil = new Date(Date.now() + ENTERPRISE_CONSTANTS.CIRCUIT_BREAKER_RESET_MS);
      this.log('warning', 'Circuit breaker activated',
        `Too many consecutive failures (${this.consecutiveFailures}). Pausing for ${ENTERPRISE_CONSTANTS.CIRCUIT_BREAKER_RESET_MS / 60000} minutes.`);
    }
  }

  private adjustAdaptiveThrottle(processingTimeMs: number, success: boolean): void {
    if (success) {
      if (processingTimeMs < 30000) {
        this.adaptiveThrottleMs = Math.max(
          ENTERPRISE_CONSTANTS.ADAPTIVE_THROTTLE_MIN_MS,
          this.adaptiveThrottleMs * 0.85
        );
      } else {
        this.adaptiveThrottleMs = Math.min(
          ENTERPRISE_CONSTANTS.ADAPTIVE_THROTTLE_MAX_MS,
          this.adaptiveThrottleMs * 1.1
        );
      }
    } else {
      this.adaptiveThrottleMs = Math.min(
        ENTERPRISE_CONSTANTS.ADAPTIVE_THROTTLE_MAX_MS,
        this.adaptiveThrottleMs * 1.5
      );
    }
  }

  getQualityTrend(): { avg: number; trend: 'improving' | 'declining' | 'stable' } {
    if (this.qualityScoreHistory.length < 2) {
      return { avg: 0, trend: 'stable' };
    }

    const avg = this.qualityScoreHistory.reduce((a, b) => a + b, 0) / this.qualityScoreHistory.length;
    const recentAvg = this.qualityScoreHistory.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, this.qualityScoreHistory.length);
    const olderAvg = this.qualityScoreHistory.slice(0, -5).reduce((a, b) => a + b, 0) / Math.max(1, this.qualityScoreHistory.length - 5);

    let trend: 'improving' | 'declining' | 'stable' = 'stable';
    if (recentAvg > olderAvg + 3) trend = 'improving';
    else if (recentAvg < olderAvg - 3) trend = 'declining';

    return { avg, trend };
  }

  private async runGenerationPhase(): Promise<void> {
    if (this.isCircuitBroken()) {
      const waitTime = this.circuitBrokenUntil ? Math.ceil((this.circuitBrokenUntil.getTime() - Date.now()) / 60000) : 0;
      this.log('warning', 'Circuit breaker active', `Waiting ${waitTime} more minutes before retry`);
      await this.sleep(60000);
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    const totalInQueue = this.queue.length;
    const positionLabel = this.options.priorityOnlyMode
      ? `${this.options.priorityUrls.length - totalInQueue}/${this.options.priorityUrls.length}`
      : '';

    this.updateState({
      currentPhase: 'generating',
      currentUrl: item.url,
      queue: this.queue,
    });

    const startTime = Date.now();
    const isPriorityItem = this.options.priorityOnlyMode || item.source === 'manual';

    this.log('info', `${isPriorityItem ? '[PRIORITY] ' : ''}Generating content ${positionLabel}`,
      `URL: ${this.getSlug(item.url)} | Retry: ${item.retryCount}/${this.options.config.retryAttempts}`);

    try {
      const keyword = this.extractKeyword(item.url);

      if (!this.orchestrator) {
        throw new Error('Content orchestrator not initialized');
      }

      this.log('info', `Starting content generation`, 'Single-pass pipeline with built-in quality optimization');

      const content = await this.orchestrator.generateContent({
        keyword,
        onProgress: (msg) => this.log('info', msg),
      });

      const qualityScore = content.qualityScore?.overall || 0;

      if (qualityScore >= ENTERPRISE_CONSTANTS.MIN_QUALITY_SCORE) {
        this.log('success', `Quality target achieved!`, `Score: ${qualityScore}%`);
      } else {
        this.log('info', `Quality: ${qualityScore}%`, `Below ${ENTERPRISE_CONSTANTS.MIN_QUALITY_SCORE}% target - content saved for review`);
      }

      const processingTime = Date.now() - startTime;
      const wordCount = content?.metrics?.wordCount || 0;

      this.recordSuccess(qualityScore, processingTime);

      const generatedContent = {
        title: content?.title || '',
        content: content?.content || '',
        seoTitle: content?.seoTitle || '',
        metaDescription: content?.metaDescription || '',
        slug: this.getSlug(item.url),
      };

      if (qualityScore < this.options.config.qualityThreshold) {
        this.log('warning', `Below quality threshold`,
          `Score: ${qualityScore}/${this.options.config.qualityThreshold}`);

        this.addToHistory({
          url: item.url,
          action: 'skipped',
          qualityScore,
          processingTimeMs: processingTime,
          wordCount,
          error: `Quality score ${qualityScore}% below threshold ${this.options.config.qualityThreshold}%`,
          generatedContent,
        });

        this.log('info', `Content saved for review`, `Click "View" in history to access and manually publish`);

        this.updateStats(qualityScore, wordCount, true);
        this.processedToday++;

        await this.sleep(this.adaptiveThrottleMs);
        return;
      }

      if (this.options.config.autoPublish) {
        await this.runPublishPhase(item, content, processingTime, qualityScore);
      } else {
        this.log('success', `Content Generated`,
          `Score: ${qualityScore}% | Words: ${wordCount.toLocaleString()} | Time: ${Math.round(processingTime / 1000)}s`);

        this.addToHistory({
          url: item.url,
          action: 'generated',
          qualityScore,
          processingTimeMs: processingTime,
          wordCount,
          generatedContent,
        });
      }

      this.processedToday++;
      this.updateStats(qualityScore, wordCount, true);

      const waitTime = this.options.config.processingIntervalMinutes * 60 * 1000;
      if (this.queue.length > 0) {
        this.log('info', `Next item in ${this.options.config.processingIntervalMinutes} minutes (${this.queue.length} remaining)`);
      }
      await this.sleep(waitTime);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed';
      this.log('error', `Generation failed`, message);

      this.recordFailure();

      if (item.retryCount < this.options.config.retryAttempts) {
        item.retryCount++;
        item.lastError = message;

        const backoffDelay = this.calculateBackoffDelay(item.retryCount);
        const backoffSeconds = Math.round(backoffDelay / 1000);

        this.log('info', `Retry scheduled`,
          `Attempt ${item.retryCount}/${this.options.config.retryAttempts} after ${backoffSeconds}s backoff`);

        await this.sleep(backoffDelay);

        this.queue.push(item);
        this.sortQueue();
        this.updateState({ queue: this.queue });
      } else {
        this.log('error', `Max retries exceeded`,
          `Giving up on ${this.getSlug(item.url)} after ${item.retryCount} attempts`);

        this.addToHistory({
          url: item.url,
          action: 'error',
          error: `Max retries (${item.retryCount}) exceeded. Last error: ${message}`,
          processingTimeMs: Date.now() - startTime,
        });
      }

      this.updateStats(0, 0, false);
    }
  }

  private async runPublishPhase(
    item: GodModeQueueItem,
    content: any,
    processingTime: number,
    qualityScore: number
  ): Promise<void> {
    this.updateState({ currentPhase: 'publishing' });
    this.log('info', `Publishing to WordPress...`, this.getSlug(item.url));

    const wordCount = content.metrics?.wordCount || 0;

    try {
      const appConfig = this.options.getAppConfig();

      if (!appConfig.wpUrl || !appConfig.wpUsername || !appConfig.wpAppPassword) {
        throw new Error('WordPress credentials not configured');
      }

      const response = await fetch('/api/wordpress-publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wpUrl: appConfig.wpUrl.startsWith('http') ? appConfig.wpUrl : `https://${appConfig.wpUrl}`,
          username: appConfig.wpUsername,
          appPassword: appConfig.wpAppPassword,
          title: content.title,
          content: content.content,
          status: this.options.config.defaultStatus,
          seoTitle: content.seoTitle,
          metaDescription: content.metaDescription,
          sourceUrl: item.url,
        }),
      });

      if (!response.ok) {
        throw new Error(`WordPress API error: ${response.status}`);
      }

      const result = await response.json();

      this.log('success', `Published!`, `${result.link || item.url}`);

      this.addToHistory({
        url: item.url,
        action: 'published',
        qualityScore,
        wordPressUrl: result.link,
        processingTimeMs: processingTime,
        wordCount,
        generatedContent: {
          title: content.title || '',
          content: content.content || '',
          seoTitle: content.seoTitle || '',
          metaDescription: content.metaDescription || '',
          slug: this.getSlug(item.url),
        },
      });

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Publish failed';
      this.log('error', `Publish failed`, message);

      this.addToHistory({
        url: item.url,
        action: 'error',
        qualityScore,
        error: `Generated but publish failed: ${message}`,
        processingTimeMs: processingTime,
        generatedContent: {
          title: content.title || '',
          content: content.content || '',
          seoTitle: content.seoTitle || '',
          metaDescription: content.metaDescription || '',
          slug: this.getSlug(item.url),
        },
      });
    }
  }

  private initializeOrchestrator(): void {
    const appConfig = this.options.getAppConfig();

    this.orchestrator = new EnterpriseContentOrchestrator({
      apiKeys: {
        geminiApiKey: appConfig.geminiApiKey || '',
        openaiApiKey: appConfig.openaiApiKey,
        anthropicApiKey: appConfig.anthropicApiKey,
        openrouterApiKey: appConfig.openrouterApiKey,
        groqApiKey: appConfig.groqApiKey,
        serperApiKey: appConfig.serperApiKey || '',
        openrouterModelId: appConfig.openrouterModelId,
        groqModelId: appConfig.groqModelId,
      },
      organizationName: appConfig.organizationName || '',
      organizationUrl: appConfig.wpUrl || '',
      authorName: appConfig.authorName || '',
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

    if (!this.options.config.enableWeekends && (day === 0 || day === 6)) {
      return false;
    }

    return hour >= this.options.config.activeHoursStart &&
           hour < this.options.config.activeHoursEnd;
  }

  private isExcluded(url: string): boolean {
    let pathname: string;
    try {
      pathname = new URL(url).pathname.toLowerCase();
    } catch {
      pathname = url.toLowerCase();
    }

    if (this.options.excludedUrls.some(excl => {
      try {
        return new URL(excl).pathname.toLowerCase() === pathname || url === excl;
      } catch {
        return url.includes(excl);
      }
    })) {
      return true;
    }

    if (this.options.excludedCategories.some(cat => {
      const catLower = cat.toLowerCase();
      return pathname.split('/').some(segment => segment === catLower);
    })) {
      return true;
    }

    return false;
  }

  private calculatePriority(score: number, url: string): GodModeQueueItem['priority'] {
    const priorityUrl = this.options.priorityUrls.find(p => p.url === url);
    if (priorityUrl) return priorityUrl.priority;

    if (score < 30) return 'critical';
    if (score < 50) return 'high';
    if (score < 70) return 'medium';
    return 'low';
  }

  private sortQueue(): void {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    this.queue.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.healthScore - b.healthScore;
    });
    this.persistQueue(); // ← NEW: persist after every sort
  }

  // ← NEW: Queue persistence to survive page refreshes
  private persistQueue(): void {
    try {
      const serializable = this.queue.map(item => ({
        ...item,
        addedAt: item.addedAt instanceof Date ? item.addedAt.toISOString() : item.addedAt,
      }));
      localStorage.setItem('god_mode_queue', JSON.stringify(serializable));
    } catch (e) {
      console.warn('[GodMode] Failed to persist queue:', e);
    }
  }

  // ← NEW: Restore queue from localStorage after page refresh
  private restoreQueue(): void {
    try {
      const stored = localStorage.getItem('god_mode_queue');
      if (!stored) return;
      const items = JSON.parse(stored) as any[];
      if (!Array.isArray(items) || items.length === 0) return;
      this.queue = items.map(item => ({
        ...item,
        addedAt: new Date(item.addedAt),
      }));
      this.sortQueue();
      this.updateState({ queue: this.queue });
      this.log('info', `Restored ${this.queue.length} items from persisted queue`);
    } catch (e) {
      console.warn('[GodMode] Failed to restore queue:', e);
    }
  }

  // ← CHANGED: Robustness for non-semantic slugs (e.g., /p/12345, /a1b2c3)
  private extractKeyword(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const slug = pathname.split('/').filter(Boolean).pop() || '';

      const decoded = slug.replace(/-/g, ' ').trim();
      if (!decoded || /^[a-f0-9]{6,}$/i.test(slug) || /^\d+$/.test(slug)) {
        const segments = pathname.split('/').filter(Boolean);
        if (segments.length >= 2) {
          return segments[segments.length - 2]
            .replace(/-/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
        }
        return new URL(url).hostname.replace('www.', '');
      }

      return decoded.replace(/\b\w/g, l => l.toUpperCase());
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
    this.options.onStateUpdate({
      history: [{
        id: crypto.randomUUID(),
        timestamp: new Date(),
        ...item,
      }] as any,
    });
  }

  private updateStats(qualityScore: number, wordCount: number, success: boolean): void {
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

  get status(): GodModeStatus {
    if (this.isPaused) return 'paused';
    if (this.isRunning) return 'running';
    return 'idle';
  }

  get queueLength(): number {
    return this.queue.length;
  }
}
