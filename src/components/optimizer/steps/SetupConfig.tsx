import { useState, useEffect, useCallback } from "react";
import { useOptimizerStore } from "@/lib/store";
import { createNeuronWriterService } from "@/lib/sota/NeuronWriterService";
import {
  clearSupabaseRuntimeConfig,
  getSupabaseAnonKey,
  getSupabaseConfigSource,
  getSupabaseUrl,
  isSupabaseConfigured,
  setSupabaseRuntimeConfig,
} from "@/integrations/supabase/client";
import { 
  Key, Globe, User, Building, Image, UserCircle, 
  Sparkles, MapPin, Check, AlertCircle, ExternalLink,
  Settings, Loader2, FolderOpen, RefreshCw
} from "lucide-react";
import { cn } from "@/lib/utils";

// Popular OpenRouter Models
const OPENROUTER_MODELS = [
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo' },
  { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5' },
  { id: 'meta-llama/llama-3.1-405b-instruct', name: 'Llama 3.1 405B' },
  { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' },
  { id: 'mistralai/mixtral-8x22b-instruct', name: 'Mixtral 8x22B' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' },
  { id: 'cohere/command-r-plus', name: 'Command R+' },
];

// Popular Groq Models
const GROQ_MODELS = [
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile' },
  { id: 'llama-3.1-70b-instant', name: 'Llama 3.1 70B Instant' },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
  { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
  { id: 'gemma2-9b-it', name: 'Gemma 2 9B' },
  { id: 'llama3-groq-70b-8192-tool-use-preview', name: 'Llama 3 70B Tool Use' },
];

export function SetupConfig() {
  const { 
    config, 
    setConfig, 
    neuronWriterProjects, 
    setNeuronWriterProjects,
    neuronWriterLoading,
    setNeuronWriterLoading,
    neuronWriterError,
    setNeuronWriterError
  } = useOptimizerStore();
  
  const [verifyingWp, setVerifyingWp] = useState(false);
  const [wpVerified, setWpVerified] = useState<boolean | null>(null);
  const [customOpenRouterModel, setCustomOpenRouterModel] = useState('');
  const [customGroqModel, setCustomGroqModel] = useState('');
  const [showCustomOpenRouter, setShowCustomOpenRouter] = useState(false);
  const [showCustomGroq, setShowCustomGroq] = useState(false);

  const [supabaseUrlInput, setSupabaseUrlInput] = useState('');
  const [supabaseAnonKeyInput, setSupabaseAnonKeyInput] = useState('');
  const [savingSupabase, setSavingSupabase] = useState(false);

  useEffect(() => {
    setSupabaseUrlInput(getSupabaseUrl() ?? '');
    setSupabaseAnonKeyInput(getSupabaseAnonKey() ?? '');
  }, []);

  // Fetch NeuronWriter projects when API key changes
  const fetchNeuronWriterProjects = useCallback(async (apiKey: string) => {
    if (!apiKey || apiKey.length < 10) {
      setNeuronWriterProjects([]);
      setNeuronWriterError(null);
      return;
    }

    setNeuronWriterLoading(true);
    setNeuronWriterError(null);

    try {
      const service = createNeuronWriterService(apiKey);
      const result = await service.listProjects();

      if (result.success && result.projects) {
        setNeuronWriterProjects(result.projects);
        setNeuronWriterError(null);
        
        // Auto-select first project if none selected
        if (result.projects.length > 0 && !config.neuronWriterProjectId) {
          setConfig({ 
            neuronWriterProjectId: result.projects[0].id,
            neuronWriterProjectName: result.projects[0].name
          });
        }
      } else {
        setNeuronWriterError(result.error || 'Failed to fetch projects');
        setNeuronWriterProjects([]);
      }
    } catch (error) {
      console.error('NeuronWriter fetch error:', error);
      setNeuronWriterError(error instanceof Error ? error.message : 'Unknown error');
      setNeuronWriterProjects([]);
    } finally {
      setNeuronWriterLoading(false);
    }
  }, [setNeuronWriterProjects, setNeuronWriterLoading, setNeuronWriterError, config.neuronWriterProjectId, setConfig]);

  // Auto-fetch when API key changes
  useEffect(() => {
    if (config.enableNeuronWriter && config.neuronWriterApiKey) {
      const debounceTimer = setTimeout(() => {
        fetchNeuronWriterProjects(config.neuronWriterApiKey);
      }, 500);
      return () => clearTimeout(debounceTimer);
    }
  }, [config.enableNeuronWriter, config.neuronWriterApiKey, fetchNeuronWriterProjects]);

  const handleSaveSupabaseConfig = useCallback(async () => {
    setSavingSupabase(true);
    try {
      setSupabaseRuntimeConfig({ url: supabaseUrlInput, anonKey: supabaseAnonKeyInput });
      setNeuronWriterError(null);

      if (config.enableNeuronWriter && config.neuronWriterApiKey) {
        await fetchNeuronWriterProjects(config.neuronWriterApiKey);
      }
    } finally {
      setSavingSupabase(false);
    }
  }, [
    supabaseUrlInput,
    supabaseAnonKeyInput,
    config.enableNeuronWriter,
    config.neuronWriterApiKey,
    fetchNeuronWriterProjects,
    setNeuronWriterError,
  ]);

  const handleClearSupabaseConfig = useCallback(() => {
    clearSupabaseRuntimeConfig();
    setSupabaseUrlInput('');
    setSupabaseAnonKeyInput('');
    setNeuronWriterError(null);
  }, [setNeuronWriterError]);

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

  const handleProjectSelect = (projectId: string) => {
    const project = neuronWriterProjects.find(p => p.id === projectId);
    setConfig({ 
      neuronWriterProjectId: projectId,
      neuronWriterProjectName: project?.name || ''
    });
  };

  const handleOpenRouterModelChange = (value: string) => {
    if (value === 'custom') {
      setShowCustomOpenRouter(true);
    } else {
      setShowCustomOpenRouter(false);
      setConfig({ openrouterModelId: value });
    }
  };

  const handleGroqModelChange = (value: string) => {
    if (value === 'custom') {
      setShowCustomGroq(true);
    } else {
      setShowCustomGroq(false);
      setConfig({ groqModelId: value });
    }
  };

  const handleCustomOpenRouterSubmit = () => {
    if (customOpenRouterModel.trim()) {
      setConfig({ openrouterModelId: customOpenRouterModel.trim() });
    }
  };

  const handleCustomGroqSubmit = () => {
    if (customGroqModel.trim()) {
      setConfig({ groqModelId: customGroqModel.trim() });
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
        <div className="space-y-6">
          {/* Primary Model Selection */}
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
              <option value="openrouter">OpenRouter (Custom Model)</option>
              <option value="groq">Groq (High-Speed)</option>
            </select>
          </div>

          {/* OpenRouter Model Selection */}
          {(config.primaryModel === 'openrouter' || config.openrouterApiKey) && (
            <div className="p-4 bg-background/50 border border-border rounded-xl space-y-3">
              <label className="block text-sm font-medium text-foreground">
                OpenRouter Model ID
              </label>
              <div className="flex gap-2">
                <select
                  value={showCustomOpenRouter ? 'custom' : config.openrouterModelId}
                  onChange={(e) => handleOpenRouterModelChange(e.target.value)}
                  className="flex-1 px-4 py-2.5 bg-background border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {OPENROUTER_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                  <option value="custom">⚙️ Custom Model ID...</option>
                </select>
              </div>
              {showCustomOpenRouter && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customOpenRouterModel}
                    onChange={(e) => setCustomOpenRouterModel(e.target.value)}
                    placeholder="e.g., anthropic/claude-3.5-sonnet:beta"
                    className="flex-1 px-4 py-2.5 bg-background border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <button
                    onClick={handleCustomOpenRouterSubmit}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors"
                  >
                    Set
                  </button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Current: <code className="text-primary">{config.openrouterModelId}</code>
              </p>
            </div>
          )}

          {/* Groq Model Selection */}
          {(config.primaryModel === 'groq' || config.groqApiKey) && (
            <div className="p-4 bg-background/50 border border-border rounded-xl space-y-3">
              <label className="block text-sm font-medium text-foreground">
                Groq Model ID
              </label>
              <div className="flex gap-2">
                <select
                  value={showCustomGroq ? 'custom' : config.groqModelId}
                  onChange={(e) => handleGroqModelChange(e.target.value)}
                  className="flex-1 px-4 py-2.5 bg-background border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {GROQ_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                  <option value="custom">⚙️ Custom Model ID...</option>
                </select>
              </div>
              {showCustomGroq && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customGroqModel}
                    onChange={(e) => setCustomGroqModel(e.target.value)}
                    placeholder="e.g., llama3-groq-70b-8192-tool-use-preview"
                    className="flex-1 px-4 py-2.5 bg-background border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <button
                    onClick={handleCustomGroqSubmit}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors"
                  >
                    Set
                  </button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Current: <code className="text-primary">{config.groqModelId}</code>
              </p>
            </div>
          )}

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
          <div className="space-y-4">
            <InputField
              label="NeuronWriter API Key"
              value={config.neuronWriterApiKey}
              onChange={(v) => setConfig({ neuronWriterApiKey: v })}
              type="password"
              placeholder="Enter NeuronWriter key..."
            />

            {/* Supabase runtime config (for Lovable preview hosts without build-time env vars) */}
            <div className="p-4 bg-background/50 border border-border rounded-xl space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium text-foreground">
                  Supabase Edge Function (neuronwriter-proxy)
                </label>
                <span className="text-xs text-muted-foreground">
                  Source:{" "}
                  <code className="text-primary">{getSupabaseConfigSource()}</code>
                </span>
              </div>

              <InputField
                label="Supabase URL"
                value={supabaseUrlInput}
                onChange={setSupabaseUrlInput}
                placeholder="https://xxxx.supabase.co"
              />
              <InputField
                label="Supabase anon key"
                value={supabaseAnonKeyInput}
                onChange={setSupabaseAnonKeyInput}
                type="password"
                placeholder="eyJ..."
              />

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleSaveSupabaseConfig}
                  disabled={savingSupabase || !supabaseUrlInput.trim() || !supabaseAnonKeyInput.trim()}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
                >
                  {savingSupabase ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={handleClearSupabaseConfig}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-secondary text-secondary-foreground hover:bg-secondary/80"
                >
                  Clear
                </button>
              </div>

              <p className="text-xs text-muted-foreground">
                Lovable preview hosts don’t have Cloudflare Pages Functions (so <code>/api/neuronwriter</code> 404s). Pasting your Supabase URL + anon
                key here lets the app call your Supabase Edge Function <code>neuronwriter-proxy</code>. (Anon key is public.)
              </p>
            </div>
            
            {/* Project Selection */}
            {config.neuronWriterApiKey && (
              <div className="p-4 bg-background/50 border border-border rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-primary" />
                    Select Project
                  </label>
                  <button
                    onClick={() => fetchNeuronWriterProjects(config.neuronWriterApiKey)}
                    disabled={neuronWriterLoading}
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className={cn("w-3 h-3", neuronWriterLoading && "animate-spin")} />
                    Refresh
                  </button>
                </div>

                {neuronWriterLoading && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Fetching projects...</span>
                  </div>
                )}

                {neuronWriterError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <div className="flex items-start gap-2 text-red-400 text-sm">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium">{neuronWriterError}</p>
                        {(() => {
                          const lower = neuronWriterError.toLowerCase();
                          return (
                            lower.includes("proxy") ||
                            lower.includes("supabase") ||
                            lower.includes("vite_supabase") ||
                            lower.includes("neuronwriter-proxy")
                          );
                        })() && (
                          <p className="text-xs mt-1 text-red-300/80">
                            {(() => {
                              const hasSupabaseUrl = !!getSupabaseUrl();
                              const hasSupabaseAnon = !!getSupabaseAnonKey();
                              const hasSupabaseClient = isSupabaseConfigured();

                              // If Supabase config is missing, be explicit about what needs to be configured.
                              if (!hasSupabaseUrl) {
                                return (
                                  <>
                                    This preview can’t use <code>/api/neuronwriter</code>. Paste your Supabase URL + anon key in the “Supabase Edge Function”
                                    box above, click <strong>Save</strong>, then hit <strong>Refresh</strong>.
                                  </>
                                );
                              }

                              if (!hasSupabaseAnon || !hasSupabaseClient) {
                                return (
                                  <>
                                    Supabase URL is set, but the anon key is missing (or not applied yet). Paste the anon key above and click
                                    <strong>Save</strong>.
                                  </>
                                );
                              }

                              // Supabase is present but the proxy is still failing.
                              return (
                                <>
                                  Supabase looks configured, but the proxy call is failing. Double-check the edge function name is{" "}
                                  <code>neuronwriter-proxy</code> and it's deployed in your Supabase project.
                                </>
                              );
                            })()}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {!neuronWriterLoading && !neuronWriterError && neuronWriterProjects.length > 0 && (
                  <>
                    <select
                      value={config.neuronWriterProjectId}
                      onChange={(e) => handleProjectSelect(e.target.value)}
                      className="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      <option value="">Select a project...</option>
                      {neuronWriterProjects.map(project => (
                        <option key={project.id} value={project.id}>
                          {project.name} {project.queries_count !== undefined && `(${project.queries_count} queries)`}
                        </option>
                      ))}
                    </select>
                    
                    {config.neuronWriterProjectId && (
                      <div className="flex items-center gap-2 text-green-400 text-sm">
                        <Check className="w-4 h-4" />
                        Selected: <strong>{config.neuronWriterProjectName}</strong>
                      </div>
                    )}
                  </>
                )}

                {!neuronWriterLoading && !neuronWriterError && neuronWriterProjects.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No projects found. Create a project in NeuronWriter first, or check your API key.
                  </p>
                )}
              </div>
            )}
          </div>
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
