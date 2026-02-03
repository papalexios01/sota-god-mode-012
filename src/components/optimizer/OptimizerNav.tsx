import { Settings, BarChart3, FileText, Check, Zap, Bot } from "lucide-react";
import { useOptimizerStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const steps = [
  { id: 1, label: "Setup & Config", sublabel: "API keys, WordPress", icon: Settings },
  { id: 2, label: "Strategy & Planning", sublabel: "Gap analysis, clusters", icon: BarChart3 },
  { id: 3, label: "Review & Export", sublabel: "Publish content", icon: FileText },
];

export function OptimizerNav() {
  const { currentStep, setCurrentStep, contentItems, godModeState } = useOptimizerStore();
  
  const totalItems = contentItems.length;
  const completedItems = contentItems.filter((i) => i.status === "completed").length;
  const isGodModeRunning = godModeState.status === 'running';
  const isGodModePaused = godModeState.status === 'paused';

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 bg-primary/20 rounded-lg flex items-center justify-center">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <span className="font-bold text-foreground">Navigation</span>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {steps.map((step) => {
          const isActive = currentStep === step.id;
          const isCompleted = currentStep > step.id;

          return (
            <button
              key={step.id}
              onClick={() => setCurrentStep(step.id)}
              className={cn(
                "w-full flex items-start gap-3 p-3 rounded-xl text-left transition-all",
                isActive
                  ? "bg-primary/10 border border-primary/30"
                  : "hover:bg-muted/50 border border-transparent"
              )}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : isCompleted
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {isCompleted ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <step.icon className="w-4 h-4" />
                )}
              </div>
              <div className="min-w-0">
                <div
                  className={cn(
                    "font-medium text-sm",
                    isActive ? "text-primary" : "text-foreground"
                  )}
                >
                  {step.id}. {step.label}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {step.sublabel}
                </div>
              </div>
            </button>
          );
        })}
      </nav>

      {/* God Mode Status */}
      {(isGodModeRunning || isGodModePaused) && (
        <div className="mx-4 mb-4 p-3 bg-gradient-to-r from-primary/20 to-primary/10 border border-primary/30 rounded-xl">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Bot className="w-4 h-4" />
            God Mode 2.0
            <span className={cn(
              "ml-auto px-1.5 py-0.5 text-xs rounded",
              isGodModeRunning ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"
            )}>
              {isGodModeRunning ? 'ACTIVE' : 'PAUSED'}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {godModeState.currentPhase ? (
              <span className="capitalize">{godModeState.currentPhase}...</span>
            ) : (
              <span>Queue: {godModeState.queue.length} items</span>
            )}
          </div>
        </div>
      )}

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className={cn(
            "w-2 h-2 rounded-full animate-pulse",
            isGodModeRunning ? "bg-green-500" : "bg-primary"
          )} />
          <span>{isGodModeRunning ? 'God Mode Active' : 'System Ready'}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {totalItems} items • {completedItems} done
          {isGodModeRunning && ` • Cycle ${godModeState.stats.cycleCount}`}
        </div>
      </div>
    </aside>
  );
}
