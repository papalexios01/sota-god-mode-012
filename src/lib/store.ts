import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ContentItem {
  id: string;
  title: string;
  type: 'pillar' | 'cluster' | 'single' | 'refresh';
  status: 'pending' | 'generating' | 'completed' | 'error';
  primaryKeyword: string;
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
  
  // God Mode
  godModeEnabled: boolean;
  priorityOnlyMode: boolean;
  setGodModeEnabled: (enabled: boolean) => void;
  setPriorityOnlyMode: (enabled: boolean) => void;
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
        wpUrl: '',
        wpUsername: '',
        wpAppPassword: '',
        organizationName: '',
        logoUrl: '',
        authorName: '',
        enableNeuronWriter: false,
        neuronWriterApiKey: '',
        enableGeoTargeting: false,
        targetCountry: 'US',
        targetLanguage: 'en',
      },
      setConfig: (updates) => set((state) => ({ 
        config: { ...state.config, ...updates } 
      })),
      
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
    }),
    {
      name: 'wp-optimizer-storage',
    }
  )
);
