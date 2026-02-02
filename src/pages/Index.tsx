import { useState } from "react";
import { Zap, Sparkles, LayoutGrid, Shield } from "lucide-react";
import { OptimizerDashboard } from "@/components/optimizer/OptimizerDashboard";

const features = [
  {
    icon: Zap,
    title: "God Mode 2.0",
    description: "Autonomous content optimization that never sleeps. Set it and forget it while your content climbs the rankings 24/7.",
  },
  {
    icon: Sparkles,
    title: "Gap Analysis",
    description: "State-of-the-art content analysis using NLP, entity extraction, and competitor insights powered by NeuronWriter integration.",
  },
  {
    icon: LayoutGrid,
    title: "Bulk Publishing",
    description: "Generate and publish hundreds of optimized articles with one click. Scale your content empire effortlessly.",
  },
  {
    icon: Shield,
    title: "Rank Guardian",
    description: "Real-time monitoring and automatic fixes for content health. Protect your rankings 24/7 with AI-powered alerts.",
  },
];

const Index = () => {
  const [showOptimizer, setShowOptimizer] = useState(false);

  if (showOptimizer) {
    return <OptimizerDashboard />;
  }

  return (
    <div className="min-h-screen gradient-bg">
      {/* Header */}
      <header className="px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/20 rounded-lg flex items-center justify-center">
            <Zap className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              WP Content Optimizer <span className="text-primary">PRO</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Enterprise-Grade SEO Automation by{" "}
              <a href="https://affiliatemarketingforsuccess.com" className="text-primary hover:underline">
                AffiliateMarketingForSuccess.com
              </a>
            </p>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="px-6 py-16 md:py-24">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-6xl font-bold text-foreground mb-2">
            Transform Your Content Into
          </h2>
          <h2 className="text-4xl md:text-6xl font-bold gradient-text mb-8">
            Ranking Machines
          </h2>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            AI-powered SEO optimization that adapts to Google's algorithm in real-time.
            Generate, optimize, and publish content that dominates search results.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button 
              onClick={() => setShowOptimizer(true)}
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-primary text-primary-foreground font-semibold rounded-full hover:bg-primary/90 transition-colors"
            >
              <Zap className="w-5 h-5" />
              Launch Optimizer
            </button>
            <button className="inline-flex items-center justify-center gap-2 px-8 py-4 border border-primary text-primary font-semibold rounded-full hover:bg-primary/10 transition-colors">
              <Sparkles className="w-5 h-5" />
              Explore SEO Arsenal
            </button>
          </div>
        </div>

        {/* Feature Cards */}
        <div className="max-w-7xl mx-auto mt-20 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="bg-card border border-border rounded-2xl p-6 hover:border-primary/50 transition-colors"
            >
              <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center mb-4">
                <feature.icon className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-8 border-t border-border mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-card border border-border rounded-lg flex items-center justify-center">
              <span className="text-xs text-muted-foreground text-center leading-tight">
                Affiliate<br />Marketing
              </span>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                Created by <span className="text-foreground font-medium">Alexios Papaioannou</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Owner of{" "}
                <a href="https://affiliatemarketingforsuccess.com" className="text-primary hover:underline">
                  affiliatemarketingforsuccess.com
                </a>
              </p>
            </div>
          </div>

          <div className="flex flex-col items-center md:items-end gap-2">
            <span className="text-sm text-muted-foreground">Learn More About:</span>
            <div className="flex flex-wrap gap-4 text-sm">
              {["Affiliate Marketing", "AI", "SEO", "Blogging", "Reviews"].map((item) => (
                <a
                  key={item}
                  href="#"
                  className="text-muted-foreground hover:text-primary transition-colors"
                >
                  {item}
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
