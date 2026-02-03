import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  GodModeState,
  GodModeActivityItem,
  GodModeHistoryItem,
  GodModeConfig,
} from './sota/GodModeTypes';
import {
  DEFAULT_GOD_MODE_STATE,
  DEFAULT_GOD_MODE_CONFIG,
  DEFAULT_GOD_MODE_STATS,
} from './sota/GodModeTypes';

export interface ContentItem {
  id: string;
  title: string;
  type: 'pillar' | 'cluster' | 'single' | 'refresh';
  status: 'pending' | 'generating' | 'completed' | 'error';
  primaryKeyword: string;
  url?: string;  // Source URL for rewrites
  content?: string;
  wordCount?: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PriorityUrl {
  id: string;
  url: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  addedAt: Date;
}

export interface NeuronWriterProject {
  id: string;
  name: string;
  queries_count?: number;
}

export interface AppConfig {
  // API Keys
  geminiApiKey: string;
  serperApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  openrouterApiKey: string;
  groqApiKey: string;
  
  // Model Config
  primaryModel: 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'groq';
  enableGoogleGrounding: boolean;
  
  // OpenRouter & Groq Custom Models
  openrouterModelId: string;
  groqModelId: string;
  
  // WordPress Config
  wpUrl: string;
  wpUsername: string;
  wpAppPassword: string;
  organizationName: string;
  logoUrl: string;
  authorName: string;
  
  // NeuronWriter
  enableNeuronWriter: boolean;
  neuronWriterApiKey: string;
  neuronWriterProjectId: string;
  neuronWriterProjectName: string;
  
  // Geo-Targeting
  enableGeoTargeting: boolean;
  targetCountry: string;
  targetLanguage: string;
}

interface OptimizerStore {
  // Navigation
  currentStep: number;
  setCurrentStep: (step: number) => void;
  
  // Configuration
  config: AppConfig;
  setConfig: (config: Partial<AppConfig>) => void;
  
  // NeuronWriter Projects (loaded dynamically)
  neuronWriterProjects: NeuronWriterProject[];
  setNeuronWriterProjects: (projects: NeuronWriterProject[]) => void;
  neuronWriterLoading: boolean;
  setNeuronWriterLoading: (loading: boolean) => void;
  neuronWriterError: string | null;
  setNeuronWriterError: (error: string | null) => void;
  
  // Content Queue
  contentItems: ContentItem[];
  addContentItem: (item: Omit<ContentItem, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateContentItem: (id: string, updates: Partial<ContentItem>) => void;
  removeContentItem: (id: string) => void;
  clearContentItems: () => void;
  
  // Priority URLs
  priorityUrls: PriorityUrl[];
  addPriorityUrl: (url: string, priority: PriorityUrl['priority']) => void;
  removePriorityUrl: (id: string) => void;
  clearPriorityUrls: () => void;
  
  // Exclusions
  excludedUrls: string[];
  excludedCategories: string[];
  setExcludedUrls: (urls: string[]) => void;
  setExcludedCategories: (categories: string[]) => void;
  
  // Sitemap
  sitemapUrls: string[];
  setSitemapUrls: (urls: string[]) => void;
  
  // God Mode Legacy (simple toggle)
  godModeEnabled: boolean;
  priorityOnlyMode: boolean;
  setGodModeEnabled: (enabled: boolean) => void;
  setPriorityOnlyMode: (enabled: boolean) => void;
  
  // God Mode 2.0 State
  godModeState: GodModeState;
  setGodModeState: (updates: Partial<GodModeState>) => void;
  addGodModeActivity: (item: Omit<GodModeActivityItem, 'id' | 'timestamp'>) => void;
  addGodModeHistory: (item: GodModeHistoryItem) => void;
  updateGodModeStats: (updates: { 
    totalProcessed?: number; 
    successCount?: number; 
    errorCount?: number; 
    qualityScore?: number; 
    wordCount?: number;
  }) => void;
}

export const useOptimizerStore = create<OptimizerStore>()(
  persist(
    (set) => ({
      // Navigation
      currentStep: 1,
      setCurrentStep: (step) => set({ currentStep: step }),
      
      // Configuration
      config: {
        geminiApiKey: '',
        serperApiKey: '',
        openaiApiKey: '',
        anthropicApiKey: '',
        openrouterApiKey: '',
        groqApiKey: '',
        primaryModel: 'gemini',
        enableGoogleGrounding: false,
        openrouterModelId: 'anthropic/claude-3.5-sonnet',
        groqModelId: 'llama-3.3-70b-versatile',
        wpUrl: '',
        wpUsername: '',
        wpAppPassword: '',
        organizationName: '',
        logoUrl: '',
        authorName: '',
        enableNeuronWriter: false,
        neuronWriterApiKey: '',
        neuronWriterProjectId: '',
        neuronWriterProjectName: '',
        enableGeoTargeting: false,
        targetCountry: 'US',
        targetLanguage: 'en',
      },
      setConfig: (updates) => set((state) => ({ 
        config: { ...state.config, ...updates } 
      })),
      
      // NeuronWriter Projects
      neuronWriterProjects: [],
      setNeuronWriterProjects: (projects) => set({ neuronWriterProjects: projects }),
      neuronWriterLoading: false,
      setNeuronWriterLoading: (loading) => set({ neuronWriterLoading: loading }),
      neuronWriterError: null,
      setNeuronWriterError: (error) => set({ neuronWriterError: error }),
      
      // Content Queue
      contentItems: [],
      addContentItem: (item) => set((state) => ({
        contentItems: [
          ...state.contentItems,
          {
            ...item,
            id: crypto.randomUUID(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      })),
      updateContentItem: (id, updates) => set((state) => ({
        contentItems: state.contentItems.map((item) =>
          item.id === id ? { ...item, ...updates, updatedAt: new Date() } : item
        ),
      })),
      removeContentItem: (id) => set((state) => ({
        contentItems: state.contentItems.filter((item) => item.id !== id),
      })),
      clearContentItems: () => set({ contentItems: [] }),
      
      // Priority URLs
      priorityUrls: [],
      addPriorityUrl: (url, priority) => set((state) => ({
        priorityUrls: [
          ...state.priorityUrls,
          { id: crypto.randomUUID(), url, priority, addedAt: new Date() },
        ],
      })),
      removePriorityUrl: (id) => set((state) => ({
        priorityUrls: state.priorityUrls.filter((u) => u.id !== id),
      })),
      clearPriorityUrls: () => set({ priorityUrls: [] }),
      
      // Exclusions
      excludedUrls: [],
      excludedCategories: [],
      setExcludedUrls: (urls) => set({ excludedUrls: urls }),
      setExcludedCategories: (categories) => set({ excludedCategories: categories }),
      
      // Sitemap
      sitemapUrls: [],
      setSitemapUrls: (urls) => set({ sitemapUrls: urls }),
      
      // God Mode
      godModeEnabled: false,
      priorityOnlyMode: false,
      setGodModeEnabled: (enabled) => set({ godModeEnabled: enabled }),
      setPriorityOnlyMode: (enabled) => set({ priorityOnlyMode: enabled }),
      
      // God Mode 2.0 State
      godModeState: DEFAULT_GOD_MODE_STATE,
      setGodModeState: (updates) => set((state) => ({
        godModeState: { ...state.godModeState, ...updates }
      })),
      addGodModeActivity: (item) => set((state) => ({
        godModeState: {
          ...state.godModeState,
          activityLog: [
            {
              id: crypto.randomUUID(),
              timestamp: new Date(),
              ...item,
            },
            ...state.godModeState.activityLog.slice(0, 99), // Keep last 100
          ],
        }
      })),
      addGodModeHistory: (item) => set((state) => ({
        godModeState: {
          ...state.godModeState,
          history: [item, ...state.godModeState.history.slice(0, 99)], // Keep last 100
        }
      })),
      updateGodModeStats: (updates) => set((state) => {
        const stats = state.godModeState.stats;
        const newTotal = stats.totalProcessed + (updates.totalProcessed || 0);
        const newSuccess = stats.successCount + (updates.successCount || 0);
        const newError = stats.errorCount + (updates.errorCount || 0);
        const newWords = stats.totalWordsGenerated + (updates.wordCount || 0);
        
        // Calculate new average quality score
        let newAvgQuality = stats.avgQualityScore;
        if (updates.qualityScore && updates.qualityScore > 0) {
          const totalQuality = stats.avgQualityScore * stats.totalProcessed + updates.qualityScore;
          newAvgQuality = newTotal > 0 ? totalQuality / newTotal : updates.qualityScore;
        }
        
        return {
          godModeState: {
            ...state.godModeState,
            stats: {
              ...stats,
              totalProcessed: newTotal,
              successCount: newSuccess,
              errorCount: newError,
              avgQualityScore: newAvgQuality,
              totalWordsGenerated: newWords,
            }
          }
        };
      }),
    }),
    {
      name: 'wp-optimizer-storage',
    }
  )
);
