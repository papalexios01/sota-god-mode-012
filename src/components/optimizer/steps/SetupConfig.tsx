import { useState } from "react";
import { useOptimizerStore } from "@/lib/store";
import { 
  Key, Globe, User, Building, Image, UserCircle, 
  Sparkles, MapPin, Check, AlertCircle, ExternalLink,
  Settings
} from "lucide-react";
import { cn } from "@/lib/utils";

export function SetupConfig() {
  const { config, setConfig } = useOptimizerStore();
  const [verifyingWp, setVerifyingWp] = useState(false);
  const [wpVerified, setWpVerified] = useState<boolean | null>(null);

  const handleVerifyWordPress = async () => {
    if (!config.wpUrl || !config.wpUsername || !config.wpAppPassword) {
      return;
    }
    
    setVerifyingWp(true);
    try {
      // Simulate verification
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setWpVerified(true);
    } catch {
      setWpVerified(false);
    } finally {
      setVerifyingWp(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Settings className="w-7 h-7 text-primary" />
          1. Setup & Configuration
        </h1>
        <p className="text-muted-foreground mt-1">
          Connect your AI services and configure WordPress integration.
        </p>
      </div>

      {/* API Keys Section */}
      <section className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Key className="w-5 h-5 text-primary" />
          API Keys
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InputField
            label="Google Gemini API Key"
            value={config.geminiApiKey}
            onChange={(v) => setConfig({ geminiApiKey: v })}
            type="password"
            placeholder="AIza..."
          />
          <InputField
            label="Serper API Key (Required for SOTA Research)"
            value={config.serperApiKey}
            onChange={(v) => setConfig({ serperApiKey: v })}
            type="password"
            placeholder="Enter Serper key..."
            required
          />
          <InputField
            label="OpenAI API Key"
            value={config.openaiApiKey}
            onChange={(v) => setConfig({ openaiApiKey: v })}
            type="password"
            placeholder="sk-..."
          />
          <InputField
            label="Anthropic API Key"
            value={config.anthropicApiKey}
            onChange={(v) => setConfig({ anthropicApiKey: v })}
            type="password"
            placeholder="sk-ant-..."
          />
          <InputField
            label="OpenRouter API Key"
            value={config.openrouterApiKey}
            onChange={(v) => setConfig({ openrouterApiKey: v })}
            type="password"
            placeholder="sk-or-..."
          />
          <InputField
            label="Groq API Key"
            value={config.groqApiKey}
            onChange={(v) => setConfig({ groqApiKey: v })}
            type="password"
            placeholder="gsk_..."
          />
        </div>
      </section>

      {/* Model Configuration */}
      <section className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          AI Model Configuration
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Primary Generation Model
            </label>
            <select
              value={config.primaryModel}
              onChange={(e) => setConfig({ primaryModel: e.target.value as any })}
              className="w-full md:w-80 px-4 py-2.5 bg-background border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="gemini">Google Gemini 2.5 Flash</option>
              <option value="openai">OpenAI GPT-4o</option>
              <option value="anthropic">Anthropic Claude Sonnet 4</option>
              <option value="openrouter">OpenRouter (Auto-Fallback)</option>
              <option value="groq">Groq (High-Speed)</option>
            </select>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={config.enableGoogleGrounding}
              onChange={(e) => setConfig({ enableGoogleGrounding: e.target.checked })}
              className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50"
            />
            <span className="text-sm text-foreground">Enable Google Search Grounding</span>
          </label>
        </div>
      </section>

      {/* WordPress Configuration */}
      <section className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Globe className="w-5 h-5 text-primary" />
          WordPress & Site Information
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InputField
            label="WordPress Site URL"
            value={config.wpUrl}
            onChange={(v) => setConfig({ wpUrl: v })}
            placeholder="https://your-site.com"
            icon={<Globe className="w-4 h-4" />}
          />
          <InputField
            label="WordPress Username"
            value={config.wpUsername}
            onChange={(v) => setConfig({ wpUsername: v })}
            placeholder="admin"
            icon={<User className="w-4 h-4" />}
          />
          <InputField
            label="WordPress Application Password"
            value={config.wpAppPassword}
            onChange={(v) => setConfig({ wpAppPassword: v })}
            type="password"
            placeholder="xxxx xxxx xxxx xxxx"
            icon={<Key className="w-4 h-4" />}
          />
          <InputField
            label="Organization Name"
            value={config.organizationName}
            onChange={(v) => setConfig({ organizationName: v })}
            placeholder="Your Company"
            icon={<Building className="w-4 h-4" />}
          />
          <InputField
            label="Logo URL"
            value={config.logoUrl}
            onChange={(v) => setConfig({ logoUrl: v })}
            placeholder="https://..."
            icon={<Image className="w-4 h-4" />}
          />
          <InputField
            label="Author Name"
            value={config.authorName}
            onChange={(v) => setConfig({ authorName: v })}
            placeholder="John Doe"
            icon={<UserCircle className="w-4 h-4" />}
          />
        </div>
        
        <div className="mt-4 flex items-center gap-3">
          <a
            href={config.wpUrl || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "text-sm text-primary hover:underline flex items-center gap-1",
              !config.wpUrl && "pointer-events-none opacity-50"
            )}
          >
            Learn More <ExternalLink className="w-3 h-3" />
          </a>
          <button
            onClick={handleVerifyWordPress}
            disabled={verifyingWp || !config.wpUrl || !config.wpUsername || !config.wpAppPassword}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2",
              wpVerified === true
                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                : wpVerified === false
                ? "bg-red-500/20 text-red-400 border border-red-500/30"
                : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            )}
          >
            {verifyingWp ? (
              "Verifying..."
            ) : wpVerified === true ? (
              <>
                <Check className="w-4 h-4" /> Verified
              </>
            ) : wpVerified === false ? (
              <>
                <AlertCircle className="w-4 h-4" /> Failed
              </>
            ) : (
              "✅ Verify WordPress"
            )}
          </button>
        </div>
      </section>

      {/* NeuronWriter Integration */}
      <section className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          NeuronWriter Integration
        </h2>
        <label className="flex items-center gap-3 cursor-pointer mb-4">
          <input
            type="checkbox"
            checked={config.enableNeuronWriter}
            onChange={(e) => setConfig({ enableNeuronWriter: e.target.checked })}
            className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50"
          />
          <span className="text-sm text-foreground">Enable NeuronWriter Integration</span>
        </label>
        {config.enableNeuronWriter && (
          <InputField
            label="NeuronWriter API Key"
            value={config.neuronWriterApiKey}
            onChange={(v) => setConfig({ neuronWriterApiKey: v })}
            type="password"
            placeholder="Enter NeuronWriter key..."
          />
        )}
      </section>

      {/* Geo-Targeting */}
      <section className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <MapPin className="w-5 h-5 text-primary" />
          Advanced Geo-Targeting
        </h2>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.enableGeoTargeting}
            onChange={(e) => setConfig({ enableGeoTargeting: e.target.checked })}
            className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50"
          />
          <span className="text-sm text-foreground">Enable Geo-Targeting for Content</span>
        </label>
        {config.enableGeoTargeting && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Target Country
              </label>
              <select
                value={config.targetCountry}
                onChange={(e) => setConfig({ targetCountry: e.target.value })}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="US">United States</option>
                <option value="UK">United Kingdom</option>
                <option value="CA">Canada</option>
                <option value="AU">Australia</option>
                <option value="DE">Germany</option>
                <option value="FR">France</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Target Language
              </label>
              <select
                value={config.targetLanguage}
                onChange={(e) => setConfig({ targetLanguage: e.target.value })}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="de">German</option>
                <option value="fr">French</option>
              </select>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  icon,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  icon?: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-2">
        {label}
        {required && <span className="text-red-400 ml-1">*</span>}
      </label>
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            {icon}
          </div>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "w-full px-4 py-2.5 bg-background border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50",
            icon && "pl-10"
          )}
        />
      </div>
    </div>
  );
}
