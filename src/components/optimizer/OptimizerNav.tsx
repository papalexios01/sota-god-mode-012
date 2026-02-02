import { Settings, BarChart3, FileText, Check, Zap } from "lucide-react";
import { useOptimizerStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const steps = [
  { id: 1, label: "Setup & Config", sublabel: "API keys, WordPress", icon: Settings },
  { id: 2, label: "Strategy & Planning", sublabel: "Gap analysis, clusters", icon: BarChart3 },
  { id: 3, label: "Review & Export", sublabel: "Publish content", icon: FileText },
];

export function OptimizerNav() {
  const { currentStep, setCurrentStep, contentItems } = useOptimizerStore();
  
  const totalItems = contentItems.length;
  const completedItems = contentItems.filter((i) => i.status === "completed").length;

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

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span>System Ready</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {totalItems} items • {completedItems} done
        </div>
      </div>
    </aside>
  );
}
