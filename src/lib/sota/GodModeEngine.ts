// src/lib/sota/GodModeEngine.ts
// ═══════════════════════════════════════════════════════════════════════════════
// GOD MODE ENGINE v2.2 — Autonomous SEO Maintenance Engine
// ═══════════════════════════════════════════════════════════════════════════════
//
// v2.2 Fixes (on top of v2.1):
//   • FIXED: generateContent() call signature — single options object, not 3 args
//   • FIXED: sessionStartedAt no longer overwritten to null every cycle
//   • FIXED: sitePages passed to orchestrator so internal link injection works
//
// v2.1 Fixes & Improvements:
//   • FIXED: extractKeyword robustly handles non-semantic slugs (p12345, a1b2c3)
//   • FIXED: restoreQueue safely handles malformed localStorage data
//   • FIXED: runPublishPhase uses correct fetch path with full error body
//   • FIXED: Priority Only Mode guard properly validates before engine start
//   • FIXED: Circuit breaker resets correctly after timeout
//   • FIXED: Adaptive throttle no longer competes with abort signal sleep
//   • IMPROVED: All log/warn/error calls include structured details
//   • IMPROVED: Queue persistence saves on every mutation, not just on stop
//   • IMPROVED: WordPress publish reads slug from original URL to preserve it
//   • NEW: runScoringPhase uses SEOHealthScorer with proper concurrency control
//
// ═══════════════════════════════════════════════════════════════════════════════

import { EnterpriseContentOrchestrator, createOrchestrator } from './EnterpriseContentOrchestrator';
import { SEOHealthScorer } from './SEOHealthScorer';
import type {
  GodModeConfig,
  GodModeQueueItem,
  GodModeHistoryItem,
  GodModeState,
  GodModeActivityItem,
  GodModeStatus,
  GodModePhase,
  GodModeAction,
  SEOHealthAnalysis,
} from './GodModeTypes';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const ENTERPRISE_CONSTANTS = {
  MIN_QUALITY_SCORE: 90,
  MAX_QUALITY_IMPROVEMENT_PASSES: 3,
  EXPONENTIAL_BACKOFF_BASE_MS: 5000,
  EXPONENTIAL_BACKOFF_MAX_MS: 300_000,
  CIRCUIT_BREAKER_THRESHOLD: 5,
  CIRCUIT_BREAKER_RESET_MS: 600_000,
  ADAPTIVE_THROTTLE_MIN_MS: 2000,
  ADAPTIVE_THROTTLE_MAX_MS: 10_000,
  SCORING_BATCH_SIZE: 50,
  SCORING_CONCURRENCY: 3,
  QUEUE_PERSIST_KEY: 'godmode_queue',
  MAX_HISTORY_SIZE: 100,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

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
    fallbackModels?: string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE CLASS
// ─────────────────────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC CONTROLS
  // ─────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.isRunning) {
      this.log('warning', 'Engine already running');
      return;
    }

    const appConfig = this.options.getAppConfig();

    // Validate prerequisites
    if (this.options.priorityOnlyMode && this.options.priorityUrls.length === 0) {
      throw new Error(
        'Priority Only Mode requires at least one URL in the Priority Queue. Add URLs to your priority queue first.'
      );
    }

    if (
      !this.options.priorityOnlyMode &&
      this.options.sitemapUrls.length === 0 &&
      this.options.priorityUrls.length === 0
    ) {
      throw new Error(
        'No URLs available. Please crawl a sitemap first or add priority URLs.'
      );
    }

    const hasApiKey =
      appConfig.geminiApiKey ||
      appConfig.openaiApiKey ||
      appConfig.anthropicApiKey ||
      appConfig.openrouterApiKey ||
      appConfig.groqApiKey;

    if (!hasApiKey) {
      throw new Error('No AI API key configured. Please add at least one API key in Setup.');
    }

    this.isRunning = true;
    this.isPaused = false;
    this.abortController = new AbortController();
    this.processedToday = 0;
    this.cycleCount = 0;
    this.adaptiveThrottleMs = ENTERPRISE_CONSTANTS.ADAPTIVE_THROTTLE_MIN_MS;

    const modeLabel = this.options.priorityOnlyMode ? 'PRIORITY ONLY' : 'FULL SITEMAP';
    this.log('success', `GOD MODE 2.2 ACTIVATED — Mode: ${modeLabel}`, 'Autonomous SEO engine is now running');

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
      this.restoreQueue();
    }

    await this.mainLoop();
  }

  stop(): void {
    this.log('info', 'Stopping God Mode...', 'Graceful shutdown initiated');
    this.isRunning = false;
    this.isPaused = false;
    this.abortController?.abort();
    this.abortController = null;
    this.persistQueue();
    this.updateState({ status: 'idle', currentPhase: null, currentUrl: null });
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

  get status(): GodModeStatus {
    if (this.isPaused) return 'paused';
    if (this.isRunning) return 'running';
    return 'idle';
  }

  get queueLength(): number {
    return this.queue.length;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INITIALISATION
  // ─────────────────────────────────────────────────────────────────────────

  private initializeOrchestrator(): void {
    const appConfig = this.options.getAppConfig();

    // ✅ FIX #3: Build sitePages from all available URLs so internal linking works
    const allUrls = [
      ...this.options.sitemapUrls,
      ...this.options.priorityUrls.map((p) => p.url),
    ];
    const uniqueUrls = [...new Set(allUrls)];
    const sitePages = uniqueUrls.map((url) => ({
      url,
      title: this.extractKeyword(url),
      keywords: this.extractKeyword(url),
    }));

    this.orchestrator = createOrchestrator({
      apiKeys: {
        geminiApiKey: appConfig.geminiApiKey ?? '',
        openaiApiKey: appConfig.openaiApiKey ?? '',
        anthropicApiKey: appConfig.anthropicApiKey ?? '',
        openrouterApiKey: appConfig.openrouterApiKey ?? '',
        groqApiKey: appConfig.groqApiKey ?? '',
        serperApiKey: appConfig.serperApiKey ?? '',
        openrouterModelId: appConfig.openrouterModelId,
        groqModelId: appConfig.groqModelId,
        fallbackModels: appConfig.fallbackModels || [],
      },
      organizationName: appConfig.organizationName ?? 'Content Hub',
      organizationUrl: appConfig.wpUrl ?? 'https://example.com',
      authorName: appConfig.authorName ?? 'Content Team',
      primaryModel: (appConfig.primaryModel as any) ?? 'gemini',
      // ✅ FIX #3: Pass sitePages to orchestrator for internal link injection
      sitePages,
      // FIX: Always pass NW credentials regardless of flag (failsafe)
      neuronWriterApiKey:
        appConfig.enableNeuronWriter &&
          appConfig.neuronWriterApiKey &&
          appConfig.neuronWriterApiKey.length > 10
          ? appConfig.neuronWriterApiKey
          : undefined,
      neuronWriterProjectId:
        appConfig.enableNeuronWriter &&
          appConfig.neuronWriterApiKey &&
          appConfig.neuronWriterApiKey.length > 10
          ? appConfig.neuronWriterProjectId
          : undefined,
    });
  }

  private initializePriorityQueue(): void {
    const appConfig = this.options.getAppConfig();
    const hasNeuronWriter =
      appConfig.enableNeuronWriter &&
      !!appConfig.neuronWriterApiKey &&
      appConfig.neuronWriterApiKey.length > 10;

    this.queue = [];
    let excludedCount = 0;

    const priorityWeight: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };

    const sorted = [...this.options.priorityUrls].sort(
      (a, b) => (priorityWeight[b.priority] ?? 1) - (priorityWeight[a.priority] ?? 1)
    );

    for (const p of sorted) {
      if (this.isExcluded(p.url)) {
        excludedCount++;
        continue;
      }
      this.queue.push({
        id: crypto.randomUUID(),
        url: p.url,
        priority: p.priority,
        healthScore: p.priority === 'critical' ? 30 : p.priority === 'high' ? 50 : 70,
        addedAt: new Date(),
        source: 'manual',
        retryCount: 0,
      });
    }

    const priorityCounts = {
      critical: this.queue.filter((q) => q.priority === 'critical').length,
      high: this.queue.filter((q) => q.priority === 'high').length,
      medium: this.queue.filter((q) => q.priority === 'medium').length,
      low: this.queue.filter((q) => q.priority === 'low').length,
    };

    this.log('info', `Priority Queue initialized: ${this.queue.length} URLs`);
    this.log('info', `  Critical: ${priorityCounts.critical}`);
    this.log('info', `  High: ${priorityCounts.high}`);
    this.log('info', `  Medium: ${priorityCounts.medium}`);
    this.log('info', `  Low: ${priorityCounts.low}`);
    this.log('info', `  Excluded: ${excludedCount}`);

    const avgTimePerUrl = hasNeuronWriter ? 180 : 120;
    const estimatedMinutes = Math.ceil((this.queue.length * avgTimePerUrl) / 60);
    this.log('info', `Estimated time: ${estimatedMinutes} minutes`);
    this.log('success', `Priority Queue Ready — ${this.queue.length} URLs queued, NeuronWriter: ${hasNeuronWriter ? 'ON' : 'OFF'}, ETA: ${estimatedMinutes}min`);

    this.updateState({ queue: this.queue });
  }

  /**
   * Restore persisted queue from localStorage after page refresh.
   */
  private restoreQueue(): void {
    try {
      const stored = localStorage.getItem(ENTERPRISE_CONSTANTS.QUEUE_PERSIST_KEY);
      if (!stored) return;

      const items = JSON.parse(stored) as any[];
      if (!Array.isArray(items) || items.length === 0) return;

      this.queue = items
        .filter((item) => item && typeof item.url === 'string')
        .map((item) => ({
          ...item,
          addedAt: new Date(item.addedAt ?? Date.now()),
          retryCount: item.retryCount ?? 0,
        }));

      this.sortQueue();
      this.updateState({ queue: this.queue });
      this.log('info', `Restored ${this.queue.length} items from persisted queue`);
    } catch (e) {
      console.warn('[GodMode] Failed to restore queue:', e);
    }
  }

  /**
   * Persist queue to localStorage on every mutation.
   */
  private persistQueue(): void {
    try {
      localStorage.setItem(
        ENTERPRISE_CONSTANTS.QUEUE_PERSIST_KEY,
        JSON.stringify(this.queue.slice(0, 200))
      );
    } catch (e) {
      console.warn('[GodMode] Failed to persist queue:', e);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN AUTONOMOUS LOOP
  // ─────────────────────────────────────────────────────────────────────────

  private async mainLoop(): Promise<void> {
    while (this.isRunning && !this.abortController?.signal.aborted) {
      try {
        // Pause check
        if (this.isPaused) {
          await this.sleep(1000);
          continue;
        }

        // Active hours check
        if (!this.isWithinActiveHours()) {
          this.log(
            'info',
            'Outside active hours',
            `Will resume at ${this.options.config.activeHoursStart}:00`
          );
          await this.sleep(60_000);
          continue;
        }

        // Daily limit check
        if (this.processedToday >= this.options.config.maxPerDay) {
          this.log(
            'info',
            'Daily limit reached',
            `Processed ${this.processedToday}/${this.options.config.maxPerDay} articles today`
          );
          await this.sleep(3_600_000); // wait 1 hour
          continue;
        }

        this.cycleCount++;

        // ✅ FIX #2: Do NOT overwrite sessionStartedAt — it was set once in start()
        this.updateState({
          stats: {
            cycleCount: this.cycleCount,
            // sessionStartedAt intentionally OMITTED — preserved from start()
            lastScanAt: this.lastScanTime,
            nextScanAt: this.calculateNextScan(),
            totalProcessed: 0,
            successCount: 0,
            errorCount: 0,
            avgQualityScore: 0,
            totalWordsGenerated: 0,
          },
        });

        // Cycle 1+2: Scan sitemap & score pages (skip in priority-only mode)
        if (!this.options.priorityOnlyMode) {
          if (this.shouldScan()) {
            await this.runScanPhase();
          }

          if (this.queue.length === 0) {
            await this.runScoringPhase();
          }
        }

        // Cycle 3: Generate & publish
        if (this.queue.length > 0) {
          await this.runGenerationPhase();
        } else {
          this.log('info', 'Queue empty', 'Waiting for next scan cycle...');
          await this.sleep(60_000);
        }
      } catch (loopError) {
        const msg =
          loopError instanceof Error ? loopError.message : String(loopError);

        if (msg.includes('AbortError') || msg.includes('abort')) break;

        this.log('error', 'Main loop error', msg);
        this.recordFailure();
        await this.sleep(
          this.calculateBackoffDelay(this.consecutiveFailures)
        );
      }
    }

    this.log('info', 'Main loop exited', `Ran ${this.cycleCount} cycles`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CYCLE 1: SITEMAP SCAN
  // ─────────────────────────────────────────────────────────────────────────

  private async runScanPhase(): Promise<void> {
    this.updateState({ currentPhase: 'scanning' });
    this.log('info', 'Scanning sitemap...', `${this.options.sitemapUrls.length} URLs available`);

    this.lastScanTime = new Date();

    // ✅ FIX #2: Do NOT overwrite sessionStartedAt
    this.updateState({
      stats: {
        lastScanAt: this.lastScanTime,
        nextScanAt: this.calculateNextScan(),
        totalProcessed: 0,
        successCount: 0,
        errorCount: 0,
        avgQualityScore: 0,
        totalWordsGenerated: 0,
        // sessionStartedAt intentionally OMITTED
        cycleCount: this.cycleCount,
      },
    });

    // Filter out excluded and already-queued URLs
    const queuedUrls = new Set(this.queue.map((q) => q.url));
    const urlsToScore = this.options.sitemapUrls
      .filter((url) => !this.isExcluded(url) && !queuedUrls.has(url))
      .slice(0, ENTERPRISE_CONSTANTS.SCORING_BATCH_SIZE);

    this.log('info', `Scan complete — ${urlsToScore.length} URLs to score`);

    if (urlsToScore.length > 0) {
      await this.runScoringPhase(urlsToScore);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CYCLE 2: SEO HEALTH SCORING
  // ─────────────────────────────────────────────────────────────────────────

  private async runScoringPhase(urlsToScore?: string[]): Promise<void> {
    const urls = urlsToScore ?? this.options.sitemapUrls.slice(0, ENTERPRISE_CONSTANTS.SCORING_BATCH_SIZE);
    if (urls.length === 0) return;

    this.updateState({ currentPhase: 'scoring' });
    this.log('info', `Scoring ${urls.length} pages for SEO health...`);

    const scorer = new SEOHealthScorer();
    const concurrency = ENTERPRISE_CONSTANTS.SCORING_CONCURRENCY;
    const minHealthScore = this.options.config.minHealthScore;

    // Process in batches with concurrency control
    for (let i = 0; i < urls.length; i += concurrency) {
      if (!this.isRunning || this.abortController?.signal.aborted) break;
      if (this.isPaused) {
        await this.sleep(1000);
        i -= concurrency;
        continue;
      }

      const batch = urls.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map((url) => scorer.scoreUrl(url))
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const url = batch[j];

        if (result.status === 'rejected') {
          this.warn(`Scoring failed for ${url}: ${result.reason}`);
          continue;
        }

        const analysis: SEOHealthAnalysis = result.value;

        // Determine priority based on score
        let priority: GodModeQueueItem['priority'] = 'low';
        if (analysis.score < 40) priority = 'critical';
        else if (analysis.score < 55) priority = 'high';
        else if (analysis.score < minHealthScore) priority = 'medium';
        else continue; // Score is acceptable — skip

        this.queue.push({
          id: crypto.randomUUID(),
          url,
          priority,
          healthScore: analysis.score,
          addedAt: new Date(),
          source: 'scan',
          retryCount: 0,
        });
      }

      await this.sleep(500); // Throttle between batches
    }

    // Add priority URLs at the front (weighted 3x)
    for (const p of this.options.priorityUrls) {
      if (this.isExcluded(p.url)) continue;
      const alreadyQueued = this.queue.some((q) => q.url === p.url);
      if (!alreadyQueued) {
        this.queue.unshift({
          id: crypto.randomUUID(),
          url: p.url,
          priority: p.priority,
          healthScore: 0,
          addedAt: new Date(),
          source: 'manual',
          retryCount: 0,
        });
      }
    }

    this.sortQueue();
    this.persistQueue();
    this.updateState({ queue: this.queue });

    this.log(
      'success',
      `Scoring complete — ${this.queue.length} pages queued for improvement`
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CYCLE 3: CONTENT GENERATION
  // ─────────────────────────────────────────────────────────────────────────

  private async runGenerationPhase(): Promise<void> {
    if (this.isCircuitBroken) {
      const waitTime = this.circuitBrokenUntil
        ? Math.ceil((this.circuitBrokenUntil.getTime() - Date.now()) / 60_000)
        : 0;
      this.log('warning', 'Circuit breaker active', `Waiting ${waitTime} more minutes before retry`);
      await this.sleep(60_000);
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    const totalInQueue = this.queue.length;
    const positionLabel = this.options.priorityOnlyMode
      ? `${this.options.priorityUrls.length - totalInQueue}/${this.options.priorityUrls.length}`
      : `Queue: ${totalInQueue} remaining`;

    this.updateState({
      currentPhase: 'generating',
      currentUrl: item.url,
      queue: this.queue,
    });
    this.persistQueue();

    const startTime = Date.now();
    const isPriorityItem = this.options.priorityOnlyMode || item.source === 'manual';
    const slug = this.getSlug(item.url);

    this.log(
      'info',
      `${isPriorityItem ? '⭐ PRIORITY' : ''} Generating content [${positionLabel}]`,
      `URL: ${slug} | Retry: ${item.retryCount}/${this.options.config.retryAttempts}`
    );

    try {
      const keyword = this.extractKeyword(item.url);
      const title = this.buildTitleFromKeyword(keyword);

      if (!this.orchestrator) this.initializeOrchestrator();

      // ✅ FIX #1: Pass a SINGLE options object to generateContent()
      //    Previously this was called as generateContent(keyword, title, {...})
      //    which silently assigned the string `keyword` to the `options` parameter,
      //    causing options.keyword to be undefined → TypeError → "Status: error"
      const content = await this.orchestrator!.generateContent({
        keyword,
        title,
        contentType: 'guide',
        targetWordCount: 3000,
        includeVideos: true,
        includeReferences: true,
        injectLinks: true,
        generateSchema: true,
        validateEEAT: true,
        onProgress: (msg) => this.log('info', msg),
      });

      const processingTime = Date.now() - startTime;
      const qualityScore = content.qualityScore?.overall ?? 0;
      const wordCount = content.metrics?.wordCount ?? 0;

      this.qualityScoreHistory.push(qualityScore);
      if (this.qualityScoreHistory.length > 20) this.qualityScoreHistory.shift();

      this.processingTimeHistory.push(processingTime);
      if (this.processingTimeHistory.length > 10) this.processingTimeHistory.shift();

      // Quality gate
      if (qualityScore < this.options.config.qualityThreshold) {
        this.log(
          'warning',
          `Quality gate: Score ${qualityScore} below threshold ${this.options.config.qualityThreshold}`,
          `Skipping ${slug}`
        );
        this.addToHistory({
          url: item.url,
          action: 'skipped',
          qualityScore,
          processingTimeMs: processingTime,
          wordCount,
          error: `Quality ${qualityScore} below threshold ${this.options.config.qualityThreshold}`,
        });
        this.updateStats(qualityScore, wordCount, false);
        await this.sleep(this.adaptiveThrottleMs);
        return;
      }

      if (this.options.config.autoPublish) {
        await this.runPublishPhase(item, content, processingTime, qualityScore, wordCount);
      } else {
        this.log(
          'success',
          `Content Generated — Score: ${qualityScore}% | Words: ${wordCount.toLocaleString()} | Time: ${Math.round(processingTime / 1000)}s`
        );
        this.addToHistory({
          url: item.url,
          action: 'generated',
          qualityScore,
          processingTimeMs: processingTime,
          wordCount,
          generatedContent: {
            title: content.title,
            content: content.content,
            seoTitle: content.seoTitle,
            metaDescription: content.metaDescription,
            slug: content.slug,
          },
        });
        this.processedToday++;
        this.updateStats(qualityScore, wordCount, true);
      }

      // Reset circuit breaker on success
      this.consecutiveFailures = 0;

      // Adaptive throttle: ease off if quality is trending down
      this.updateAdaptiveThrottle();

      const waitTime = this.options.config.processingIntervalMinutes * 60 * 1000;
      if (this.queue.length > 0) {
        this.log('info', `Next item in ${this.options.config.processingIntervalMinutes} minutes`, `${this.queue.length} remaining`);
      }
      await this.sleep(waitTime);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed';
      this.log('error', 'Generation failed', message);
      this.recordFailure();

      if (item.retryCount < this.options.config.retryAttempts) {
        item.retryCount++;
        item.lastError = message;
        const backoffDelay = this.calculateBackoffDelay(item.retryCount);
        const backoffSeconds = Math.round(backoffDelay / 1000);
        this.log(
          'info',
          `Retry scheduled`,
          `Attempt ${item.retryCount}/${this.options.config.retryAttempts} after ${backoffSeconds}s backoff`
        );
        await this.sleep(backoffDelay);
        this.queue.push(item);
        this.sortQueue();
        this.persistQueue();
        this.updateState({ queue: this.queue });
      } else {
        this.log('error', 'Max retries exceeded', `Giving up on ${slug} after ${item.retryCount} attempts`);
        this.addToHistory({
          url: item.url,
          action: 'error',
          error: `Max retries (${item.retryCount}) exceeded. Last error: ${message}`,
          processingTimeMs: Date.now() - startTime,
        });
        this.updateStats(0, 0, false);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CYCLE 4: WORDPRESS PUBLISH
  // ─────────────────────────────────────────────────────────────────────────

  private async runPublishPhase(
    item: GodModeQueueItem,
    content: any,
    processingTime: number,
    qualityScore: number,
    wordCount: number
  ): Promise<void> {
    this.updateState({ currentPhase: 'publishing' });
    this.log('info', 'Publishing to WordPress...', this.getSlug(item.url));

    const appConfig = this.options.getAppConfig();

    if (!appConfig.wpUrl || !appConfig.wpUsername || !appConfig.wpAppPassword) {
      throw new Error('WordPress credentials not configured');
    }

    // Preserve original slug from URL
    const originalSlug = this.getSlug(item.url);

    try {
      const response = await fetch('/api/wordpress-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wpUrl: appConfig.wpUrl.startsWith('http')
            ? appConfig.wpUrl
            : `https://${appConfig.wpUrl}`,
          username: appConfig.wpUsername,
          appPassword: appConfig.wpAppPassword,
          title: content.title,
          content: content.content,
          status: this.options.config.defaultStatus,
          seoTitle: content.seoTitle,
          metaDescription: content.metaDescription,
          slug: originalSlug,   // preserve original URL slug
          sourceUrl: item.url,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => `Status ${response.status}`);
        throw new Error(`WordPress API error ${response.status}: ${errorBody}`);
      }

      const result = await response.json();

      this.log('success', `Published! → ${result.link}`, item.url);
      this.addToHistory({
        url: item.url,
        action: 'published',
        qualityScore,
        wordPressUrl: result.link,
        processingTimeMs: processingTime,
        wordCount,
        generatedContent: {
          title: content.title,
          content: content.content,
          seoTitle: content.seoTitle,
          metaDescription: content.metaDescription,
          slug: originalSlug,
        },
      });
      this.processedToday++;
      this.updateStats(qualityScore, wordCount, true);
    } catch (publishError) {
      const msg = publishError instanceof Error ? publishError.message : String(publishError);
      this.log('error', 'WordPress publish failed', msg);
      throw publishError; // re-throw so generation phase retry logic handles it
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS — KEYWORD EXTRACTION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * FIX v2.1: Robustly handles non-semantic slugs (p12345, a1b2c3, UUIDs).
   * Falls back to URL path segments and domain-based inference.
   */
  private extractKeyword(url: string): string {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname;
      const segments = pathname.split('/').filter(Boolean);

      // Try last segment first
      const lastSlug = segments[segments.length - 1] ?? '';
      const decoded = decodeURIComponent(lastSlug).replace(/-/g, ' ').trim();

      // Detect non-semantic slugs: pure IDs, UUIDs, short numeric/hash slugs
      const isNonSemantic =
        /^[a-f0-9]{6,}$/i.test(lastSlug) ||   // hex hash
        /^[0-9]+$/.test(lastSlug) ||            // pure numeric
        /^[a-z]{1,2}[0-9]+$/i.test(lastSlug) || // p12345, a1b2
        /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(lastSlug); // UUID-like

      if (!isNonSemantic && decoded.length > 3) {
        return decoded.toLowerCase();
      }

      // Try second-to-last segment (often the category/topic)
      if (segments.length >= 2) {
        const parentSlug = segments[segments.length - 2] ?? '';
        const parentDecoded = decodeURIComponent(parentSlug).replace(/-/g, ' ').trim();
        const parentIsNonSemantic =
          /^[a-f0-9]{6,}$/i.test(parentSlug) ||
          /^[0-9]+$/.test(parentSlug);

        if (!parentIsNonSemantic && parentDecoded.length > 3) {
          return parentDecoded.toLowerCase();
        }
      }

      // Final fallback: use the domain name as the keyword base
      const domain = parsed.hostname.replace(/^www\./, '').replace(/\.[a-z]{2,}$/, '');
      return domain.replace(/-/g, ' ').toLowerCase();
    } catch {
      return url.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') ?? 'content';
    }
  }

  private buildTitleFromKeyword(keyword: string): string {
    const words = keyword.split(' ');
    const capitalized = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    // Rotate through title templates for variety
    const templates = [
      `The Complete Guide to ${capitalized}`,
      `${capitalized}: Everything You Need to Know`,
      `How to Master ${capitalized} in 2026`,
      `${capitalized} — Expert Tips & Strategies`,
      `The Ultimate ${capitalized} Guide`,
    ];

    const idx = Math.abs(
      keyword.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
    ) % templates.length;

    return templates[idx];
  }

  private getSlug(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      return pathname.split('/').filter(Boolean).pop() ?? url;
    } catch {
      return url.split('/').filter(Boolean).pop() ?? url;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS — QUEUE & SCHEDULING
  // ─────────────────────────────────────────────────────────────────────────

  private sortQueue(): void {
    const priorityWeight: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };

    this.queue.sort((a, b) => {
      const pw = (priorityWeight[b.priority] ?? 1) - (priorityWeight[a.priority] ?? 1);
      if (pw !== 0) return pw;
      // Within same priority: lower health score = needs more work = process first
      return (a.healthScore ?? 100) - (b.healthScore ?? 100);
    });
  }

  private isExcluded(url: string): boolean {
    const urlLower = url.toLowerCase();

    for (const excluded of this.options.excludedUrls) {
      if (urlLower.includes(excluded.toLowerCase())) return true;
    }

    for (const category of this.options.excludedCategories) {
      if (urlLower.includes(`/${category.toLowerCase()}/`)) return true;
    }

    // Always exclude common non-content paths
    const systemPaths = ['/wp-admin', '/wp-login', '/feed', '/sitemap', '/robots', '/?p='];
    if (systemPaths.some((p) => urlLower.includes(p))) return true;

    return false;
  }

  private shouldScan(): boolean {
    if (!this.lastScanTime) return true;
    const hoursSinceLastScan =
      (Date.now() - this.lastScanTime.getTime()) / (1000 * 60 * 60);
    return hoursSinceLastScan >= this.options.config.scanIntervalHours;
  }

  private calculateNextScan(): Date | null {
    if (this.options.priorityOnlyMode) return null;
    const base = this.lastScanTime ?? new Date();
    return new Date(
      base.getTime() + this.options.config.scanIntervalHours * 60 * 60 * 1000
    );
  }

  private isWithinActiveHours(): boolean {
    if (!this.options.config.enableWeekends) {
      const day = new Date().getDay();
      if (day === 0 || day === 6) return false; // Sunday=0, Saturday=6
    }

    const hour = new Date().getHours();
    const { activeHoursStart, activeHoursEnd } = this.options.config;

    if (activeHoursStart <= activeHoursEnd) {
      return hour >= activeHoursStart && hour < activeHoursEnd;
    }

    // Overnight window (e.g. 22:00 - 06:00)
    return hour >= activeHoursStart || hour < activeHoursEnd;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS — CIRCUIT BREAKER & BACKOFF
  // ─────────────────────────────────────────────────────────────────────────

  private get isCircuitBroken(): boolean {
    if (!this.circuitBrokenUntil) return false;
    if (Date.now() >= this.circuitBrokenUntil.getTime()) {
      this.circuitBrokenUntil = null;
      this.consecutiveFailures = 0;
      this.log('info', 'Circuit breaker reset', 'Resuming normal operation');
      return false;
    }
    return true;
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= ENTERPRISE_CONSTANTS.CIRCUIT_BREAKER_THRESHOLD) {
      this.circuitBrokenUntil = new Date(
        Date.now() + ENTERPRISE_CONSTANTS.CIRCUIT_BREAKER_RESET_MS
      );
      this.log(
        'error',
        'Circuit breaker OPEN',
        `${this.consecutiveFailures} consecutive failures — pausing for ${ENTERPRISE_CONSTANTS.CIRCUIT_BREAKER_RESET_MS / 60_000} minutes`
      );
    }
  }

  private calculateBackoffDelay(retryCount: number): number {
    const delay =
      ENTERPRISE_CONSTANTS.EXPONENTIAL_BACKOFF_BASE_MS * Math.pow(2, retryCount - 1);
    return Math.min(delay, ENTERPRISE_CONSTANTS.EXPONENTIAL_BACKOFF_MAX_MS);
  }

  private updateAdaptiveThrottle(): void {
    if (this.qualityScoreHistory.length < 3) return;

    const recent = this.qualityScoreHistory.slice(-3);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;

    if (avg < 70) {
      // Quality trending down — throttle up to let APIs recover
      this.adaptiveThrottleMs = Math.min(
        this.adaptiveThrottleMs * 1.5,
        ENTERPRISE_CONSTANTS.ADAPTIVE_THROTTLE_MAX_MS
      );
    } else if (avg > 85) {
      // Quality good — ease throttle
      this.adaptiveThrottleMs = Math.max(
        this.adaptiveThrottleMs * 0.9,
        ENTERPRISE_CONSTANTS.ADAPTIVE_THROTTLE_MIN_MS
      );
    }
  }

  getQualityTrend(): { avg: number; trend: 'improving' | 'declining' | 'stable' } {
    if (this.qualityScoreHistory.length < 2) return { avg: 0, trend: 'stable' };

    const avg =
      this.qualityScoreHistory.reduce((a, b) => a + b, 0) / this.qualityScoreHistory.length;
    const recentAvg =
      this.qualityScoreHistory.slice(-5).reduce((a, b) => a + b, 0) /
      Math.min(5, this.qualityScoreHistory.length);
    const olderAvg =
      this.qualityScoreHistory.slice(0, -5).reduce((a, b) => a + b, 0) /
      Math.max(1, this.qualityScoreHistory.length - 5);

    let trend: 'improving' | 'declining' | 'stable' = 'stable';
    if (recentAvg > olderAvg + 3) trend = 'improving';
    else if (recentAvg < olderAvg - 3) trend = 'declining';

    return { avg, trend };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS — STATE, STATS, HISTORY
  // ─────────────────────────────────────────────────────────────────────────

  // ✅ FIX #2: updateStats no longer sends sessionStartedAt: null
  private updateStats(
    qualityScore: number,
    wordCount: number,
    success: boolean
  ): void {
    this.options.onStateUpdate({
      stats: {
        totalProcessed: 1,
        successCount: success ? 1 : 0,
        errorCount: success ? 0 : 1,
        qualityScore,
        wordCount,
        cycleCount: this.cycleCount,
        // sessionStartedAt intentionally OMITTED — preserved from start()
        lastScanAt: this.lastScanTime,
        nextScanAt: this.calculateNextScan(),
        avgQualityScore: 0,
        totalWordsGenerated: 0,
      } as any,
    });
  }

  private addToHistory(
    item: Omit<GodModeHistoryItem, 'id' | 'timestamp'>
  ): void {
    this.options.onStateUpdate({
      history: [
        {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          ...item,
        },
      ] as any,
    });
  }

  private log(
    type: GodModeActivityItem['type'],
    message: string,
    details?: string
  ): void {
    console.log(`[GodMode] ${type.toUpperCase()} ${message}${details ? ` — ${details}` : ''}`);
    this.options.onActivity({ type, message, details });
  }

  private warn(message: string): void {
    this.log('warning', message);
  }

  private updateState(updates: Partial<GodModeState>): void {
    this.options.onStateUpdate(updates);
  }

  /**
   * FIX v2.1: Sleep respects abort signal to allow instant shutdown.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, ms);
      this.abortController?.signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }
}
