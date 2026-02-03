/**
 * God Mode 2.0 - Real-time Activity Feed
 * 
 * Displays a live log of all engine activities with
 * color-coded messages and expandable details.
 */

import { useOptimizerStore } from '@/lib/store';
import { useGodModeEngine } from '@/hooks/useGodModeEngine';
import { Activity, CheckCircle2, AlertTriangle, XCircle, Info, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function GodModeActivityFeed() {
  const { state, clearActivityLog } = useGodModeEngine();
  const activities = state.activityLog.slice().reverse().slice(0, 50);

  const getIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle2 className="w-4 h-4 text-green-400" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
      case 'error': return <XCircle className="w-4 h-4 text-red-400" />;
      default: return <Info className="w-4 h-4 text-blue-400" />;
    }
  };

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className="bg-card border border-border rounded-xl flex flex-col h-80">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          Live Activity Feed
        </h3>
        {activities.length > 0 && (
          <button
            onClick={clearActivityLog}
            className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg hover:bg-muted/50 transition-colors"
            title="Clear activity log"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Activity className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No activity yet</p>
            <p className="text-xs">Start God Mode to see live updates</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className={cn(
                  "flex gap-3 p-3 hover:bg-muted/30 transition-colors",
                  activity.type === 'error' && "bg-red-500/5",
                  activity.type === 'success' && "bg-green-500/5"
                )}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {getIcon(activity.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {activity.message}
                    </p>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatTime(activity.timestamp)}
                    </span>
                  </div>
                  {activity.details && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {activity.details}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Live indicator */}
      {state.status === 'running' && (
        <div className="p-2 border-t border-border bg-muted/30">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            Live • Updating in real-time
          </div>
        </div>
      )}
    </div>
  );
}
