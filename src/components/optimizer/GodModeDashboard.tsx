/**
 * God Mode 2.0 - Enterprise Control Center Dashboard
 * 
 * Full-featured dashboard for controlling and monitoring
 * the autonomous SEO maintenance engine.
 */

import { useState } from 'react';
import { useGodModeEngine } from '@/hooks/useGodModeEngine';
import { useOptimizerStore } from '@/lib/store';
import {
  Zap, Play, Pause, Square, Settings, Activity, Clock,
  CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw,
  BarChart3, FileText, ExternalLink, Trash2, ChevronDown,
  ChevronUp, Filter, Calendar, Target, TrendingUp
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { GodModeConfigPanel } from './GodModeConfigPanel';
import { GodModeActivityFeed } from './GodModeActivityFeed';
import { GodModeQueuePanel } from './GodModeQueuePanel';

export function GodModeDashboard() {
  const { state, isRunning, isPaused, start, stop, pause, resume } = useGodModeEngine();
  const { sitemapUrls, priorityUrls } = useOptimizerStore();
  const [showConfig, setShowConfig] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const handleStart = async () => {
    setIsStarting(true);
    try {
      await start();
      toast.success('🚀 God Mode activated!');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start God Mode');
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = () => {
    stop();
    toast.info('God Mode stopped');
  };

  const handlePauseResume = () => {
    if (isPaused) {
      resume();
      toast.info('God Mode resumed');
    } else {
      pause();
      toast.info('God Mode paused');
    }
  };

  const formatTime = (date: Date | null) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getStatusColor = () => {
    switch (state.status) {
      case 'running': return 'bg-green-500';
      case 'paused': return 'bg-yellow-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-muted-foreground';
    }
  };

  const getPhaseLabel = () => {
    switch (state.currentPhase) {
      case 'scanning': return '🔍 Scanning Sitemap';
      case 'scoring': return '📊 Scoring Pages';
      case 'generating': return '⚡ Generating Content';
      case 'publishing': return '📤 Publishing';
      default: return 'Idle';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="bg-gradient-to-r from-primary/20 via-primary/10 to-transparent border border-primary/30 rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center relative">
              <Zap className="w-8 h-8 text-primary" />
              {isRunning && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full animate-pulse" />
              )}
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
                God Mode 2.0
                <span className={cn(
                  "px-2 py-0.5 text-xs font-medium rounded-full uppercase",
                  state.status === 'running' && "bg-green-500/20 text-green-400",
                  state.status === 'paused' && "bg-yellow-500/20 text-yellow-400",
                  state.status === 'error' && "bg-red-500/20 text-red-400",
                  state.status === 'idle' && "bg-muted text-muted-foreground"
                )}>
                  {state.status}
                </span>
              </h2>
              <p className="text-muted-foreground">
                Autonomous SEO maintenance engine • {getPhaseLabel()}
              </p>
            </div>
          </div>

          {/* Control Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="p-3 bg-muted hover:bg-muted/80 rounded-xl transition-colors"
            >
              <Settings className="w-5 h-5 text-muted-foreground" />
            </button>

            {isRunning ? (
              <>
                <button
                  onClick={handlePauseResume}
                  className={cn(
                    "px-4 py-3 rounded-xl font-medium flex items-center gap-2 transition-colors",
                    isPaused 
                      ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                      : "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30"
                  )}
                >
                  {isPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                  {isPaused ? 'Resume' : 'Pause'}
                </button>
                <button
                  onClick={handleStop}
                  className="px-4 py-3 bg-red-500/20 text-red-400 rounded-xl font-medium flex items-center gap-2 hover:bg-red-500/30 transition-colors"
                >
                  <Square className="w-5 h-5" />
                  Stop
                </button>
              </>
            ) : (
              <button
                onClick={handleStart}
                disabled={isStarting || (sitemapUrls.length === 0 && priorityUrls.length === 0)}
                className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-semibold flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isStarting ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Zap className="w-5 h-5" />
                )}
                {isStarting ? 'Starting...' : 'Start God Mode'}
              </button>
            )}
          </div>
        </div>

        {/* Status Bar */}
        <div className="mt-6 grid grid-cols-4 gap-4">
          <div className="bg-background/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Activity className="w-4 h-4" />
              Cycle
            </div>
            <div className="text-2xl font-bold text-foreground">
              {state.stats.cycleCount}
            </div>
          </div>
          
          <div className="bg-background/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Target className="w-4 h-4" />
              Queue
            </div>
            <div className="text-2xl font-bold text-foreground">
              {state.queue.length}
            </div>
          </div>
          
          <div className="bg-background/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Clock className="w-4 h-4" />
              Last Scan
            </div>
            <div className="text-lg font-semibold text-foreground">
              {formatTime(state.stats.lastScanAt)}
            </div>
          </div>
          
          <div className="bg-background/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <RefreshCw className="w-4 h-4" />
              Next Scan
            </div>
            <div className="text-lg font-semibold text-foreground">
              {formatTime(state.stats.nextScanAt)}
            </div>
          </div>
        </div>
      </div>

      {/* Configuration Panel (Collapsible) */}
      {showConfig && (
        <GodModeConfigPanel onClose={() => setShowConfig(false)} />
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">
                {state.stats.totalProcessed}
              </div>
              <div className="text-sm text-muted-foreground">Total Processed</div>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">
                {state.stats.successCount}
              </div>
              <div className="text-sm text-muted-foreground">Successful</div>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-500/20 rounded-lg flex items-center justify-center">
              <XCircle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">
                {state.stats.errorCount}
              </div>
              <div className="text-sm text-muted-foreground">Errors</div>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">
                {state.stats.avgQualityScore.toFixed(0)}%
              </div>
              <div className="text-sm text-muted-foreground">Avg Quality</div>
            </div>
          </div>
        </div>
      </div>

      {/* Current Processing */}
      {state.currentUrl && (
        <div className="bg-card border border-primary/30 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
            <div className="flex-1">
              <div className="text-sm text-muted-foreground">{getPhaseLabel()}</div>
              <div className="font-medium text-foreground truncate">{state.currentUrl}</div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-2 gap-6">
        {/* Activity Feed */}
        <GodModeActivityFeed />

        {/* Queue Panel */}
        <GodModeQueuePanel />
      </div>

      {/* History Section */}
      <div className="bg-card border border-border rounded-xl">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            Processing History
          </h3>
          <span className="text-sm text-muted-foreground">
            {state.history.length} items
          </span>
        </div>
        
        <div className="max-h-64 overflow-y-auto">
          {state.history.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No processing history yet. Start God Mode to begin.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {state.history.slice(0, 20).map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-3 hover:bg-muted/30">
                  {item.action === 'published' && <CheckCircle2 className="w-4 h-4 text-green-400" />}
                  {item.action === 'generated' && <FileText className="w-4 h-4 text-blue-400" />}
                  {item.action === 'skipped' && <AlertTriangle className="w-4 h-4 text-yellow-400" />}
                  {item.action === 'error' && <XCircle className="w-4 h-4 text-red-400" />}
                  
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {new URL(item.url).pathname.split('/').filter(Boolean).pop() || item.url}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(item.timestamp).toLocaleString()}
                      {item.qualityScore && ` • Score: ${item.qualityScore}%`}
                      {item.wordCount && ` • ${item.wordCount} words`}
                    </div>
                  </div>

                  {item.wordPressUrl && (
                    <a
                      href={item.wordPressUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 text-muted-foreground hover:text-primary"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Prerequisites Warning */}
      {sitemapUrls.length === 0 && priorityUrls.length === 0 && (
        <div className="flex items-center gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-yellow-400" />
          <div className="text-sm text-yellow-400">
            <strong>No URLs available.</strong> Please crawl your sitemap in the "Content Hub" tab 
            or add priority URLs in "Gap Analysis" before starting God Mode.
          </div>
        </div>
      )}
    </div>
  );
}
