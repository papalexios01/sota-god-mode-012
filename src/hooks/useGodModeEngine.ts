/**
 * God Mode 2.0 - React Hook for Engine Control
 *
 * Provides a clean interface for controlling the autonomous
 * SEO maintenance engine from React components.
 *
 * v2.2: Fixed handleStateUpdate — no longer mutates the incoming updates object.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useOptimizerStore } from '@/lib/store';
import { GodModeEngine } from '@/lib/sota/GodModeEngine';
import type {
  GodModeState,
  GodModeActivityItem,
  GodModeConfig,
  GodModeStats,
} from '@/lib/sota/GodModeTypes';

export function useGodModeEngine() {
  const engineRef = useRef<GodModeEngine | null>(null);

  const {
    config: appConfig,
    sitemapUrls,
    priorityUrls,
    excludedUrls,
    excludedCategories,
    priorityOnlyMode,
    godModeState,
    setGodModeState,
    addGodModeActivity,
    addGodModeHistory,
    updateGodModeStats,
  } = useOptimizerStore();

  /**
   * Handle state updates from engine.
   * The engine sends deltas for stats and single-item arrays for history.
   * This hook translates those into the correct store operations.
   *
   * ✅ FIX #4: Uses destructuring instead of `delete` to avoid mutating
   *    the caller's object. Previously, `delete updates.history` and
   *    `delete updates.stats` would remove properties from the engine's
   *    object, causing subtle bugs if the engine inspected it post-callback.
   */
  const handleStateUpdate = useCallback((updates: Partial<GodModeState>) => {
    // ✅ FIX #4: Destructure into separate variables — never mutate the original
    const { history, stats, ...rest } = updates;

    // Handle history append specially — engine sends [singleItem], we prepend via store
    if (history && Array.isArray(history)) {
      history.forEach(item => addGodModeHistory(item));
    }

    // Handle stats: extract delta fields + pass-through metadata fields
    if (stats && typeof stats === 'object') {
      const statsUpdate = stats as Record<string, unknown>;
      if (statsUpdate.totalProcessed !== undefined) {
        updateGodModeStats({
          totalProcessed: statsUpdate.totalProcessed as number,
          successCount: (statsUpdate.successCount as number) || 0,
          errorCount: (statsUpdate.errorCount as number) || 0,
          qualityScore: (statsUpdate.qualityScore as number) || (statsUpdate.avgQualityScore as number) || 0,
          wordCount: (statsUpdate.wordCount as number) || (statsUpdate.totalWordsGenerated as number) || 0,
          // Forward metadata fields so they aren't silently dropped
          cycleCount: statsUpdate.cycleCount as number | undefined,
          sessionStartedAt: statsUpdate.sessionStartedAt as Date | null | undefined,
          lastScanAt: statsUpdate.lastScanAt as Date | null | undefined,
          nextScanAt: statsUpdate.nextScanAt as Date | null | undefined,
        });
      }
    }

    // Apply remaining updates (status, currentPhase, currentUrl, queue, config, etc.)
    if (Object.keys(rest).length > 0) {
      setGodModeState(rest);
    }
  }, [setGodModeState, addGodModeHistory, updateGodModeStats]);

  /**
   * Handle activity log from engine
   */
  const handleActivity = useCallback((item: Omit<GodModeActivityItem, 'id' | 'timestamp'>) => {
    addGodModeActivity(item);
  }, [addGodModeActivity]);

  /**
   * Get current app config for the engine
   */
  const getAppConfig = useCallback(() => ({
    geminiApiKey: appConfig.geminiApiKey,
    openaiApiKey: appConfig.openaiApiKey,
    anthropicApiKey: appConfig.anthropicApiKey,
    openrouterApiKey: appConfig.openrouterApiKey,
    groqApiKey: appConfig.groqApiKey,
    primaryModel: appConfig.primaryModel,
    wpUrl: appConfig.wpUrl,
    wpUsername: appConfig.wpUsername,
    wpAppPassword: appConfig.wpAppPassword,
    enableNeuronWriter: appConfig.enableNeuronWriter,
    neuronWriterApiKey: appConfig.neuronWriterApiKey,
    neuronWriterProjectId: appConfig.neuronWriterProjectId,
    organizationName: appConfig.organizationName,
    authorName: appConfig.authorName,
    serperApiKey: appConfig.serperApiKey,
    openrouterModelId: appConfig.openrouterModelId,
    groqModelId: appConfig.groqModelId,
    fallbackModels: appConfig.fallbackModels || [],
  }), [appConfig]);

  /**
   * Start the God Mode engine
   */
  const start = useCallback(async (customConfig?: Partial<GodModeConfig>) => {
    if (priorityOnlyMode) {
      if (priorityUrls.length === 0) {
        throw new Error('🎯 Priority Only Mode requires URLs in your Priority Queue. Please add priority URLs first, or disable Priority Only Mode to use sitemap scanning.');
      }
      console.log(`[GodMode] 🎯 Priority Only Mode: ${priorityUrls.length} priority URLs will be processed`);
    } else {
      if (sitemapUrls.length === 0 && priorityUrls.length === 0) {
        throw new Error('No URLs available. Please crawl a sitemap first or add priority URLs.');
      }
    }

    const hasApiKey = appConfig.geminiApiKey || appConfig.openaiApiKey ||
      appConfig.anthropicApiKey || appConfig.openrouterApiKey ||
      appConfig.groqApiKey;

    if (!hasApiKey) {
      throw new Error('No AI API key configured. Please add at least one API key in Setup.');
    }

    if (engineRef.current) {
      engineRef.current.stop();
    }

    const config: GodModeConfig = {
      ...godModeState.config,
      ...customConfig,
    };

    console.log(`[GodMode] Starting engine - Mode: ${priorityOnlyMode ? '🎯 PRIORITY ONLY' : '🌐 FULL SITEMAP'}`);

    engineRef.current = new GodModeEngine({
      config,
      sitemapUrls,
      priorityUrls: priorityUrls.map(p => ({ url: p.url, priority: p.priority })),
      excludedUrls,
      excludedCategories,
      priorityOnlyMode,
      onStateUpdate: handleStateUpdate,
      onActivity: handleActivity,
      getAppConfig,
    });

    await engineRef.current.start();
  }, [
    sitemapUrls,
    priorityUrls,
    excludedUrls,
    excludedCategories,
    priorityOnlyMode,
    godModeState.config,
    appConfig,
    handleStateUpdate,
    handleActivity,
    getAppConfig,
  ]);

  const stop = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.stop();
      engineRef.current = null;
    }
  }, []);

  const pause = useCallback(() => {
    engineRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    engineRef.current?.resume();
  }, []);

  const updateConfig = useCallback((updates: Partial<GodModeConfig>) => {
    setGodModeState({
      config: {
        ...godModeState.config,
        ...updates,
      },
    });
  }, [godModeState.config, setGodModeState]);

  const clearHistory = useCallback(() => {
    setGodModeState({ history: [] });
  }, [setGodModeState]);

  const clearActivityLog = useCallback(() => {
    setGodModeState({ activityLog: [] });
  }, [setGodModeState]);

  const removeFromQueue = useCallback((id: string) => {
    setGodModeState({
      queue: godModeState.queue.filter(item => item.id !== id),
    });
  }, [godModeState.queue, setGodModeState]);

  const addToQueue = useCallback((url: string, priority: 'critical' | 'high' | 'medium' | 'low' = 'high') => {
    const newItem = {
      id: crypto.randomUUID(),
      url,
      priority,
      healthScore: 0,
      addedAt: new Date(),
      source: 'manual' as const,
      retryCount: 0,
    };

    setGodModeState({
      queue: [...godModeState.queue, newItem],
    });
  }, [godModeState.queue, setGodModeState]);

  useEffect(() => {
    return () => {
      if (engineRef.current) {
        engineRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (godModeState.status === 'running' && !engineRef.current) {
      console.log('[GodMode] Previous session was running. Call start() to resume.');
    }
  }, []);

  return {
    state: godModeState,
    isRunning: godModeState.status === 'running',
    isPaused: godModeState.status === 'paused',
    start,
    stop,
    pause,
    resume,
    updateConfig,
    addToQueue,
    removeFromQueue,
    clearHistory,
    clearActivityLog,
  };
}
