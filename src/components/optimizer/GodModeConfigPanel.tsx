/**
 * God Mode 2.0 - Configuration Panel
 * 
 * Full configuration interface for customizing the
 * autonomous engine behavior.
 */

import { useGodModeEngine } from '@/hooks/useGodModeEngine';
import { Settings, Clock, Zap, FileText, Calendar, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GodModeConfigPanelProps {
  onClose: () => void;
}

export function GodModeConfigPanel({ onClose }: GodModeConfigPanelProps) {
  const { state, updateConfig, isRunning } = useGodModeEngine();
  const config = state.config;

  const handleChange = (key: string, value: any) => {
    updateConfig({ [key]: value });
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Settings className="w-5 h-5 text-primary" />
          God Mode Configuration
        </h3>
        <button
          onClick={onClose}
          className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-6 grid grid-cols-3 gap-6">
        {/* Scanning Settings */}
        <div className="space-y-4">
          <h4 className="font-medium text-foreground flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            Scanning
          </h4>

          <div>
            <label className="block text-sm text-muted-foreground mb-2">
              Scan Interval
            </label>
            <select
              value={config.scanIntervalHours}
              onChange={(e) => handleChange('scanIntervalHours', Number(e.target.value))}
              disabled={isRunning}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-sm disabled:opacity-50"
            >
              <option value={1}>Every 1 hour</option>
              <option value={4}>Every 4 hours</option>
              <option value={12}>Every 12 hours</option>
              <option value={24}>Every 24 hours</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-2">
              Min Health Score Threshold
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={config.minHealthScore}
              onChange={(e) => handleChange('minHealthScore', Number(e.target.value))}
              disabled={isRunning}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-sm disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Pages scoring below this are queued for optimization
            </p>
          </div>
        </div>

        {/* Processing Settings */}
        <div className="space-y-4">
          <h4 className="font-medium text-foreground flex items-center gap-2">
            <Zap className="w-4 h-4 text-muted-foreground" />
            Processing
          </h4>

          <div>
            <label className="block text-sm text-muted-foreground mb-2">
              Processing Interval (minutes)
            </label>
            <input
              type="number"
              min={5}
              max={120}
              value={config.processingIntervalMinutes}
              onChange={(e) => handleChange('processingIntervalMinutes', Number(e.target.value))}
              disabled={isRunning}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-sm disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-2">
              Quality Threshold (%)
            </label>
            <input
              type="number"
              min={50}
              max={100}
              value={config.qualityThreshold}
              onChange={(e) => handleChange('qualityThreshold', Number(e.target.value))}
              disabled={isRunning}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-sm disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Content must score above this to be published
            </p>
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-2">
              Retry Attempts
            </label>
            <select
              value={config.retryAttempts}
              onChange={(e) => handleChange('retryAttempts', Number(e.target.value))}
              disabled={isRunning}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-sm disabled:opacity-50"
            >
              <option value={0}>No retries</option>
              <option value={1}>1 retry</option>
              <option value={2}>2 retries</option>
              <option value={3}>3 retries</option>
            </select>
          </div>
        </div>

        {/* Publishing Settings */}
        <div className="space-y-4">
          <h4 className="font-medium text-foreground flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            Publishing
          </h4>

          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={config.autoPublish}
                onChange={(e) => handleChange('autoPublish', e.target.checked)}
                disabled={isRunning}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50 disabled:opacity-50"
              />
              <span className="text-sm text-foreground">Auto-publish to WordPress</span>
            </label>
            <p className="text-xs text-muted-foreground mt-1 ml-7">
              When disabled, content is queued for manual review
            </p>
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-2">
              Default Post Status
            </label>
            <select
              value={config.defaultStatus}
              onChange={(e) => handleChange('defaultStatus', e.target.value)}
              disabled={isRunning}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-sm disabled:opacity-50"
            >
              <option value="draft">Draft</option>
              <option value="publish">Publish Immediately</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-2">
              Max Articles Per Day
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={config.maxPerDay}
              onChange={(e) => handleChange('maxPerDay', Number(e.target.value))}
              disabled={isRunning}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-sm disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      {/* Schedule Settings */}
      <div className="p-6 pt-0">
        <h4 className="font-medium text-foreground flex items-center gap-2 mb-4">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          Schedule
        </h4>

        <div className="grid grid-cols-3 gap-6">
          <div>
            <label className="block text-sm text-muted-foreground mb-2">
              Active Hours Start
            </label>
            <select
              value={config.activeHoursStart}
              onChange={(e) => handleChange('activeHoursStart', Number(e.target.value))}
              disabled={isRunning}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-sm disabled:opacity-50"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {i.toString().padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-2">
              Active Hours End
            </label>
            <select
              value={config.activeHoursEnd}
              onChange={(e) => handleChange('activeHoursEnd', Number(e.target.value))}
              disabled={isRunning}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-sm disabled:opacity-50"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {i.toString().padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="flex items-center gap-3 cursor-pointer mt-7">
              <input
                type="checkbox"
                checked={config.enableWeekends}
                onChange={(e) => handleChange('enableWeekends', e.target.checked)}
                disabled={isRunning}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50 disabled:opacity-50"
              />
              <span className="text-sm text-foreground">Process on weekends</span>
            </label>
          </div>
        </div>
      </div>

      {isRunning && (
        <div className="px-6 pb-6">
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm text-yellow-400">
            ⚠️ Configuration is locked while God Mode is running. Stop the engine to make changes.
          </div>
        </div>
      )}
    </div>
  );
}
