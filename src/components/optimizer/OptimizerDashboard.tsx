import { useOptimizerStore } from "@/lib/store";
import { OptimizerNav } from "./OptimizerNav";
import { SetupConfig } from "./steps/SetupConfig";
import { ContentStrategy } from "./steps/ContentStrategy";
import { ReviewExport } from "./steps/ReviewExport";

export function OptimizerDashboard() {
  const { currentStep } = useOptimizerStore();

  return (
    <div className="min-h-screen bg-background flex">
      <OptimizerNav />
      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-6xl mx-auto">
          {currentStep === 1 && <SetupConfig />}
          {currentStep === 2 && <ContentStrategy />}
          {currentStep === 3 && <ReviewExport />}
        </div>
      </main>
    </div>
  );
}
