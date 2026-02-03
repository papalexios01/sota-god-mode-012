/**
 * God Mode 2.0 - Queue Visualization Panel
 * 
 * Displays the processing queue with priority badges,
 * health scores, and manual management controls.
 */

import { useGodModeEngine } from '@/hooks/useGodModeEngine';
import { Target, Trash2, Plus, ArrowUp, ArrowDown, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export function GodModeQueuePanel() {
  const { state, removeFromQueue, addToQueue } = useGodModeEngine();
  const [newUrl, setNewUrl] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'high': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'low': return 'bg-green-500/20 text-green-400 border-green-500/30';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getHealthColor = (score: number) => {
    if (score < 30) return 'text-red-400';
    if (score < 50) return 'text-orange-400';
    if (score < 70) return 'text-yellow-400';
    return 'text-green-400';
  };

  const getSlug = (url: string) => {
    try {
      return new URL(url).pathname.split('/').filter(Boolean).pop() || url;
    } catch {
      return url;
    }
  };

  const handleAddUrl = () => {
    if (!newUrl.trim()) return;
    
    try {
      new URL(newUrl.trim()); // Validate URL
      addToQueue(newUrl.trim(), 'high');
      setNewUrl('');
      setShowAddForm(false);
    } catch {
      // Invalid URL
    }
  };

  const estimatedTime = state.queue.length * (state.config.processingIntervalMinutes || 30);

  return (
    <div className="bg-card border border-border rounded-xl flex flex-col h-80">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Target className="w-5 h-5 text-primary" />
          Processing Queue
          <span className="px-2 py-0.5 text-xs bg-primary/20 text-primary rounded-full">
            {state.queue.length}
          </span>
        </h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="p-1.5 text-muted-foreground hover:text-primary rounded-lg hover:bg-muted/50 transition-colors"
          title="Add URL to queue"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Add URL Form */}
      {showAddForm && (
        <div className="p-3 border-b border-border bg-muted/30">
          <div className="flex gap-2">
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://example.com/post-url"
              className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              onKeyDown={(e) => e.key === 'Enter' && handleAddUrl()}
            />
            <button
              onClick={handleAddUrl}
              disabled={!newUrl.trim()}
              className="px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Queue List */}
      <div className="flex-1 overflow-y-auto">
        {state.queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Target className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">Queue is empty</p>
            <p className="text-xs">Pages will be added during scanning</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {state.queue.map((item, index) => (
              <div
                key={item.id}
                className={cn(
                  "flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors",
                  index === 0 && state.status === 'running' && "bg-primary/5"
                )}
              >
                <span className="text-xs text-muted-foreground w-5">
                  #{index + 1}
                </span>

                <span className={cn(
                  "px-2 py-0.5 text-xs font-medium rounded border",
                  getPriorityColor(item.priority)
                )}>
                  {item.priority}
                </span>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {getSlug(item.url)}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={getHealthColor(item.healthScore)}>
                      Score: {item.healthScore}
                    </span>
                    {item.retryCount > 0 && (
                      <span className="text-yellow-400">
                        Retry #{item.retryCount}
                      </span>
                    )}
                    <span className="capitalize">{item.source}</span>
                  </div>
                </div>

                <button
                  onClick={() => removeFromQueue(item.id)}
                  className="p-1.5 text-muted-foreground hover:text-destructive rounded transition-colors"
                  title="Remove from queue"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Queue Stats */}
      {state.queue.length > 0 && (
        <div className="p-3 border-t border-border bg-muted/30">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Est. completion: ~{estimatedTime} min
            </div>
            <div className="flex gap-3">
              <span className="text-red-400">
                {state.queue.filter(q => q.priority === 'critical').length} critical
              </span>
              <span className="text-orange-400">
                {state.queue.filter(q => q.priority === 'high').length} high
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
