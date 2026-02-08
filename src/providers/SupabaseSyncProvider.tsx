import { useEffect, createContext, useContext, ReactNode, Component, ErrorInfo } from 'react';
import { useSupabaseSync } from '@/hooks/useSupabaseSync';
import { getSupabaseConfig } from '@/lib/supabaseClient';

// SOTA Supabase Sync Provider with Graceful Degradation
// This provider wraps the application and provides Supabase sync functionality.
// It gracefully handles the case where Supabase is not configured, allowing
// the app to function in "offline mode" with localStorage-only persistence.

interface SupabaseSyncContextType {
  isLoading: boolean;
  isConnected: boolean;
  lastSyncTime: Date | null;
  error: string | null;
  tableMissing: boolean;
  isOfflineMode: boolean;
  saveToSupabase: (itemId: string, content?: any) => Promise<boolean>;
  deleteFromSupabase: (itemId: string) => Promise<boolean>;
  syncAllToSupabase: () => Promise<void>;
  loadFromSupabase: () => Promise<void>;
}

const defaultContext: SupabaseSyncContextType = {
  isLoading: false,
  isConnected: false,
  lastSyncTime: null,
  error: null,
  tableMissing: false,
  isOfflineMode: true,
  saveToSupabase: async () => true,
  deleteFromSupabase: async () => true,
  syncAllToSupabase: async () => { },
  loadFromSupabase: async () => { },
};

const SupabaseSyncContext = createContext<SupabaseSyncContextType>(defaultContext);

export function useSupabaseSyncContext() {
  return useContext(SupabaseSyncContext);
}

interface SupabaseSyncProviderProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

// Enterprise-grade Error Boundary with proper recovery
class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[SupabaseSyncProvider] Error caught:', error, errorInfo);

    // Log to console for debugging but don't block the app
    if (error.message?.includes('getSupabase()') || error.message?.includes('Supabase')) {
      console.warn('[SupabaseSyncProvider] Supabase-related error - app will continue in offline mode');
    }
  }

  render() {
    if (this.state.hasError) {
      // On error, still render children but in degraded mode
      // This allows the app to function even if Supabase fails
      console.warn('[SupabaseSyncProvider] Rendering in fallback mode due to error');
      return this.props.children;
    }

    return this.props.children;
  }
}

export function SupabaseSyncProvider({ children }: SupabaseSyncProviderProps) {
  // Determine configuration dynamically (never freeze at module import)
  const isSupabaseConfigured = getSupabaseConfig().configured;

  // Use try-catch wrapper for hook initialization
  let sync: SupabaseSyncContextType;

  try {
    const hookResult = useSupabaseSync();
    sync = {
      isLoading: hookResult.isLoading,
      isConnected: hookResult.isConnected,
      lastSyncTime: hookResult.lastSyncTime,
      error: hookResult.error,
      tableMissing: hookResult.tableMissing,
      isOfflineMode: hookResult.isOfflineMode ?? !isSupabaseConfigured,
      saveToSupabase: hookResult.saveToSupabase,
      deleteFromSupabase: hookResult.deleteFromSupabase,
      syncAllToSupabase: hookResult.syncAllToSupabase,
      loadFromSupabase: hookResult.loadFromSupabase,
    };
  } catch (error) {
    console.error('[SupabaseSyncProvider] Hook initialization failed:', error);
    sync = defaultContext;
  }

  // Log connection status on mount
  useEffect(() => {
    if (sync.isOfflineMode) {
      console.info('[SupabaseSyncProvider] ℹ Running in offline mode (localStorage only)');
    } else if (sync.isConnected) {
      console.info('[SupabaseSyncProvider] ✓ Connected to Supabase');
    }
  }, [sync.isOfflineMode, sync.isConnected]);

  return (
    <ErrorBoundary>
      <SupabaseSyncContext.Provider value={sync}>
        {children}
      </SupabaseSyncContext.Provider>
    </ErrorBoundary>
  );
}
