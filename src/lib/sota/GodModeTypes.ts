/**
 * God Mode 2.0 - Type Definitions
 * Enterprise-grade autonomous SEO maintenance engine types
 */

export type GodModeStatus = 'idle' | 'running' | 'paused' | 'error';
export type GodModePhase = 'scanning' | 'scoring' | 'generating' | 'publishing' | null;
export type GodModePriority = 'critical' | 'high' | 'medium' | 'low';
export type GodModeAction = 'generated' | 'published' | 'skipped' | 'error';

export interface GodModeQueueItem {
  id: string;
  url: string;
  priority: GodModePriority;
  healthScore: number;
  addedAt: Date;
  source: 'manual' | 'scan';
  retryCount: number;
  lastError?: string;
}

export interface GodModeHistoryItem {
  id: string;
  url: string;
  action: GodModeAction;
  timestamp: Date;
  qualityScore?: number;
  wordPressUrl?: string;
  error?: string;
  processingTimeMs?: number;
  wordCount?: number;
}

export interface GodModeStats {
  totalProcessed: number;
  successCount: number;
  errorCount: number;
  avgQualityScore: number;
  lastScanAt: Date | null;
  nextScanAt: Date | null;
  totalWordsGenerated: number;
  sessionStartedAt: Date | null;
  cycleCount: number;
}

export interface GodModeConfig {
  scanIntervalHours: number;
  maxConcurrent: number;
  qualityThreshold: number;
  autoPublish: boolean;
  defaultStatus: 'draft' | 'publish';
  maxPerDay: number;
  activeHoursStart: number;
  activeHoursEnd: number;
  retryAttempts: number;
  processingIntervalMinutes: number;
  enableWeekends: boolean;
  minHealthScore: number;
}

export interface GodModeState {
  status: GodModeStatus;
  currentPhase: GodModePhase;
  currentUrl: string | null;
  queue: GodModeQueueItem[];
  history: GodModeHistoryItem[];
  stats: GodModeStats;
  config: GodModeConfig;
  activityLog: GodModeActivityItem[];
  lastError: string | null;
}

export interface GodModeActivityItem {
  id: string;
  timestamp: Date;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  details?: string;
}

export interface SEOHealthAnalysis {
  url: string;
  score: number;
  wordCount: number;
  headingStructure: {
    h1Count: number;
    h2Count: number;
    h3Count: number;
    isValid: boolean;
  };
  freshness: {
    lastModified: Date | null;
    daysSinceUpdate: number;
    isStale: boolean;
  };
  links: {
    internalCount: number;
    externalCount: number;
    brokenCount: number;
  };
  schema: {
    hasSchema: boolean;
    types: string[];
  };
  issues: string[];
  recommendations: string[];
}

export const DEFAULT_GOD_MODE_CONFIG: GodModeConfig = {
  scanIntervalHours: 4,
  maxConcurrent: 1,
  qualityThreshold: 85,
  autoPublish: false,
  defaultStatus: 'draft',
  maxPerDay: 10,
  activeHoursStart: 6,
  activeHoursEnd: 22,
  retryAttempts: 2,
  processingIntervalMinutes: 30,
  enableWeekends: true,
  minHealthScore: 70,
};

export const DEFAULT_GOD_MODE_STATS: GodModeStats = {
  totalProcessed: 0,
  successCount: 0,
  errorCount: 0,
  avgQualityScore: 0,
  lastScanAt: null,
  nextScanAt: null,
  totalWordsGenerated: 0,
  sessionStartedAt: null,
  cycleCount: 0,
};

export const DEFAULT_GOD_MODE_STATE: GodModeState = {
  status: 'idle',
  currentPhase: null,
  currentUrl: null,
  queue: [],
  history: [],
  stats: DEFAULT_GOD_MODE_STATS,
  config: DEFAULT_GOD_MODE_CONFIG,
  activityLog: [],
  lastError: null,
};
