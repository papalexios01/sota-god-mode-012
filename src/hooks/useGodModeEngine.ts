/**
 * God Mode 2.0 - React Hook for Engine Control
 * 
 * Provides a clean interface for controlling the autonomous
 * SEO maintenance engine from React components.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useOptimizerStore } from '@/lib/store';
import { GodModeEngine } from '@/lib/sota/GodModeEngine';
import type {
  GodModeState,
  GodModeActivityItem,
  GodModeHistoryItem,
  GodModeConfig,
  DEFAULT_GOD_MODE_STATE,
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
   * Handle state updates from engine
   */
  const handleStateUpdate = useCallback((updates: Partial<GodModeState>) => {
    // Handle history append specially
    if (updates.history && Array.isArray(updates.history)) {
      updates.history.forEach(item => addGodModeHistory(item));
      delete updates.history;
    }
    
    // Handle stats increment specially
    if (updates.stats && typeof updates.stats === 'object') {
      const statsUpdate = updates.stats as any;
      if (statsUpdate.totalProcessed !== undefined) {
        updateGodModeStats({
          totalProcessed: statsUpdate.totalProcessed,
          successCount: statsUpdate.successCount || 0,
          errorCount: statsUpdate.errorCount || 0,
          qualityScore: statsUpdate.qualityScore || 0,
          wordCount: statsUpdate.wordCount || 0,
        });
        delete updates.stats;
      }
    }
    
    // Apply remaining updates
    if (Object.keys(updates).length > 0) {
      setGodModeState(updates);
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
  }), [appConfig]);

  /**
   * Start the God Mode engine
   */
  const start = useCallback(async (customConfig?: Partial<GodModeConfig>) => {
    // Validate prerequisites
    if (sitemapUrls.length === 0 && priorityUrls.length === 0 && !priorityOnlyMode) {
      throw new Error('No URLs available. Please crawl a sitemap first or add priority URLs.');
    }

    const hasApiKey = appConfig.geminiApiKey || appConfig.openaiApiKey || 
                      appConfig.anthropicApiKey || appConfig.openrouterApiKey || 
                      appConfig.groqApiKey;
    
    if (!hasApiKey) {
      throw new Error('No AI API key configured. Please add at least one API key in Setup.');
    }

    // Stop existing engine if running
    if (engineRef.current) {
      engineRef.current.stop();
    }

    // Create new engine
    const config: GodModeConfig = {
      ...godModeState.config,
      ...customConfig,
    };

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

    // Start the engine
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

  /**
   * Stop the God Mode engine
   */
  const stop = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.stop();
      engineRef.current = null;
    }
  }, []);

  /**
   * Pause the engine (maintains state)
   */
  const pause = useCallback(() => {
    engineRef.current?.pause();
  }, []);

  /**
   * Resume from paused state
   */
  const resume = useCallback(() => {
    engineRef.current?.resume();
  }, []);

  /**
   * Update engine configuration
   */
  const updateConfig = useCallback((updates: Partial<GodModeConfig>) => {
    setGodModeState({
      config: {
        ...godModeState.config,
        ...updates,
      },
    });
  }, [godModeState.config, setGodModeState]);

  /**
   * Clear history
   */
  const clearHistory = useCallback(() => {
    setGodModeState({ history: [] });
  }, [setGodModeState]);

  /**
   * Clear activity log
   */
  const clearActivityLog = useCallback(() => {
    setGodModeState({ activityLog: [] });
  }, [setGodModeState]);

  /**
   * Remove item from queue
   */
  const removeFromQueue = useCallback((id: string) => {
    setGodModeState({
      queue: godModeState.queue.filter(item => item.id !== id),
    });
  }, [godModeState.queue, setGodModeState]);

  /**
   * Manually add URL to queue
   */
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

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (engineRef.current) {
        engineRef.current.stop();
      }
    };
  }, []);

  /**
   * Auto-resume if was running before page reload
   */
  useEffect(() => {
    if (godModeState.status === 'running' && !engineRef.current) {
      // Engine was running before refresh, offer to resume
      console.log('[GodMode] Previous session was running. Call start() to resume.');
    }
  }, []);

  return {
    // State
    state: godModeState,
    isRunning: godModeState.status === 'running',
    isPaused: godModeState.status === 'paused',
    
    // Controls
    start,
    stop,
    pause,
    resume,
    
    // Configuration
    updateConfig,
    
    // Queue management
    addToQueue,
    removeFromQueue,
    
    // History
    clearHistory,
    clearActivityLog,
  };
}
