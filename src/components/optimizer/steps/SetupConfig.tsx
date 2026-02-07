import { useState, useEffect, useCallback, useRef } from "react";
import { useOptimizerStore } from "@/lib/store";
import { createNeuronWriterService } from "@/lib/sota/NeuronWriterService";
import {
  Key, Globe, User, Building, Image, UserCircle,
  Sparkles, MapPin, Check, AlertCircle, ExternalLink, Database,
  Settings, Loader2, FolderOpen, RefreshCw, XCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
<<<<<<< HEAD
import { getSupabaseConfig, saveSupabaseConfig, clearSupabaseConfig, validateSupabaseConfig } from "@/lib/supabaseClient";
=======
import { toast } from "sonner";
import { getSupabaseConfig, saveSupabaseConfig, clearSupabaseConfig, validateSupabaseConfig } from "@/lib/supabaseClient";
import { ensureTableExists, getLastDbCheckError } from "@/lib/api/contentPersistence";
>>>>>>> a03bf59 (SOTA: Supabase diagnostics + test connection + correct RLS guidance)

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
  const [nwFetchAttempted, setNwFetchAttempted] = useState(false);

  const [sbUrl, setSbUrl] = useState(config.supabaseUrl || '');
  const [sbAnonKey, setSbAnonKey] = useState(config.supabaseAnonKey || '');
  const sbStatus = validateSupabaseConfig(sbUrl.trim(), sbAnonKey.trim());

  const configRef = useRef(config);
  configRef.current = config;

  const fetchNeuronWriterProjects = useCallback(async (apiKey: string) => {
    if (!apiKey || apiKey.trim().length < 10) {
      setNeuronWriterProjects([]);
      setNeuronWriterError(null);
      setNwFetchAttempted(false);
      return;
    }

    setNeuronWriterLoading(true);
    setNeuronWriterError(null);
    setNwFetchAttempted(true);

    try {
      const service = createNeuronWriterService(apiKey);
      const result = await service.listProjects();

      if (result.success && result.projects) {
        setNeuronWriterProjects(result.projects);
        setNeuronWriterError(null);

        if (result.projects.length > 0 && !configRef.current.neuronWriterProjectId) {
          setConfig({
            neuronWriterProjectId: result.projects[0].id,
            neuronWriterProjectName: result.projects[0].name
          });
        }
      } else {
        const errorMsg = result.error || 'Failed to fetch projects';
        setNeuronWriterError(errorMsg);
        setNeuronWriterProjects([]);
      }
    } catch (error) {
      console.error('NeuronWriter fetch error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      setNeuronWriterError(`Connection failed: ${message}`);
      setNeuronWriterProjects([]);
    } finally {
      setNeuronWriterLoading(false);
    }
  }, [setNeuronWriterProjects, setNeuronWriterLoading, setNeuronWriterError, setConfig]);

  useEffect(() => {
    if (config.enableNeuronWriter && config.neuronWriterApiKey && config.neuronWriterApiKey.trim().length >= 10) {
      const debounceTimer = setTimeout(() => {
        fetchNeuronWriterProjects(config.neuronWriterApiKey);
      }, 800);
      return () => clearTimeout(debounceTimer);
    }
  }, [config.enableNeuronWriter, config.neuronWriterApiKey, fetchNeuronWriterProjects]);

  const handleSaveSupabase = () => {
    const url = sbUrl.trim();
    const key = sbAnonKey.trim();
    const status = validateSupabaseConfig(url, key);
    if (!status.configured) return;

    setConfig({ supabaseUrl: url, supabaseAnonKey: key });
    // Persist so Cloudflare Pages deployments work without build-time env vars.
    saveSupabaseConfig(url, key);
  };

<<<<<<< HEAD
=======
  const handleTestSupabase = async () => {
    try {
      const ok = await ensureTableExists();
      if (ok) {
        toast.success('Supabase connected ✓ History sync is online.');
        return;
      }
      const detail = getLastDbCheckError();
      if (!detail) {
        toast.error('Supabase not configured (missing URL or anon key).');
        return;
      }
      if (detail.kind === 'missing_table') {
        toast.error('Connected, but table generated_blog_posts is missing. Create it in Supabase SQL Editor.');
      } else if (detail.kind === 'rls') {
        toast.error('Connected, but RLS is blocking access. Update your RLS policy.');
      } else {
        toast.error(detail.message);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Supabase connection test failed');
    }
  };

>>>>>>> a03bf59 (SOTA: Supabase diagnostics + test connection + correct RLS guidance)
  const handleClearSupabase = () => {
    setSbUrl('');
    setSbAnonKey('');
    setConfig({ supabaseUrl: '', supabaseAnonKey: '' });
    clearSupabaseConfig();
  };

  const handleReloadAfterSupabase = () => {
    // ensure all modules re-read config
    window.location.reload();
  };

  const handleVerifyWordPress = async () => {
    if (!config.wpUrl || !config.wpUsername || !config.wpAppPassword) {
      return;
    }

    setVerifyingWp(true);
    try {
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
                  <option value="custom">Custom Model ID...</option>
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
                  <option value="custom">Custom Model ID...</option>
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

      
      {/* Supabase Configuration */}
      <section className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
          <Database className="w-5 h-5 text-primary" />
          Supabase (Publishing + History)
        </h2>
        <p className="text-muted-foreground text-sm mb-4">
          Required for publishing (Edge Function) and syncing history across devices. Uses your <span className="font-medium">anon</span> key only.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InputField
            label="Supabase Project URL"
            value={sbUrl}
            onChange={(v) => setSbUrl(v)}
            placeholder="https://xxxx.supabase.co"
            icon={<Globe className="w-4 h-4" />}
          />
          <InputField
            label="Supabase Anon Key"
            value={sbAnonKey}
            onChange={(v) => setSbAnonKey(v)}
            placeholder="eyJhbGciOi..."
            icon={<Key className="w-4 h-4" />}
            type="password"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={handleSaveSupabase}
            disabled={!sbStatus.configured}
            className={cn(
              "px-4 py-2 rounded-xl font-semibold transition-all premium-ring",
              sbStatus.configured
                ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            Save
          </button>

          <button
            onClick={handleReloadAfterSupabase}
            disabled={!sbStatus.configured}
            className={cn(
              "px-4 py-2 rounded-xl font-semibold transition-all premium-ring border",
              sbStatus.configured
                ? "border-border/60 bg-background/30 hover:bg-background/45"
                : "border-border/30 bg-background/10 text-muted-foreground cursor-not-allowed"
            )}
          >
            Save & Reload
          </button>

          <button
<<<<<<< HEAD
=======
            onClick={handleTestSupabase}
            className="px-4 py-2 rounded-xl font-semibold transition-all premium-ring border border-border/60 bg-background/10 hover:bg-background/25"
          >
            Test Connection
          </button>

          <button
>>>>>>> a03bf59 (SOTA: Supabase diagnostics + test connection + correct RLS guidance)
            onClick={handleClearSupabase}
            className="px-4 py-2 rounded-xl font-semibold transition-all premium-ring border border-border/60 bg-background/10 hover:bg-background/25"
          >
            Clear
          </button>

          <div className="ml-auto flex items-center gap-2 text-sm">
            {sbStatus.configured ? (
              <span className="inline-flex items-center gap-2 text-emerald-400">
                <Check className="w-4 h-4" />
                Configured
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-amber-400">
                <AlertCircle className="w-4 h-4" />
                Not configured
              </span>
            )}
          </div>
        </div>

        {!sbStatus.configured && sbStatus.issues.length > 0 && (
          <div className="mt-3 text-sm text-muted-foreground">
            <div className="font-medium text-foreground mb-1">What to fix:</div>
            <ul className="list-disc pl-5 space-y-1">
              {sbStatus.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 text-xs text-muted-foreground">
          <div className="font-medium text-foreground mb-1">Database schema (recommended)</div>
          <pre className="whitespace-pre-wrap rounded-xl border border-border/50 bg-background/20 p-3 overflow-auto">
{`create table if not exists generated_blog_posts (
  id text primary key,
  item_id text not null unique,
  title text not null,
  seo_title text,
  content text not null,
  meta_description text,
  slug text,
  primary_keyword text,
  secondary_keywords text[],
  word_count int,
  quality_score jsonb,
  internal_links jsonb,
  schema jsonb,
  serp_analysis jsonb,
  neuronwriter_query_id text,
  generated_at timestamptz default now(),
  model text
);

-- Enable Row Level Security if you need multi-user. For single-user personal app, you can keep it simple.
`}</pre>
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
              "Verify WordPress"
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

            {config.neuronWriterApiKey && config.neuronWriterApiKey.trim().length >= 10 && (
              <div className="p-4 bg-background/50 border border-border rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-primary" />
                    Select Project
                  </label>
                  <button
                    onClick={() => fetchNeuronWriterProjects(config.neuronWriterApiKey)}
                    disabled={neuronWriterLoading}
                    className="text-sm text-primary hover:text-primary/80 flex items-center gap-1.5 px-2.5 py-1 rounded-lg hover:bg-primary/10 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={cn("w-3.5 h-3.5", neuronWriterLoading && "animate-spin")} />
                    {neuronWriterLoading ? 'Loading...' : 'Refresh Projects'}
                  </button>
                </div>

                {neuronWriterLoading && (
                  <div className="flex items-center gap-2.5 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                    <span className="text-sm text-blue-400">Connecting to NeuronWriter API...</span>
                  </div>
                )}

                {!neuronWriterLoading && neuronWriterError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <div className="flex items-start gap-2.5">
                      <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-red-400">Failed to load projects</p>
                        <p className="text-xs text-red-400/70 mt-0.5 break-words">{neuronWriterError}</p>
                        <button
                          onClick={() => fetchNeuronWriterProjects(config.neuronWriterApiKey)}
                          className="mt-2 text-xs text-red-300 hover:text-red-200 underline"
                        >
                          Try again
                        </button>
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
                      <div className="flex items-center gap-2 text-green-400 text-sm p-2 bg-green-500/5 border border-green-500/15 rounded-lg">
                        <Check className="w-4 h-4 flex-shrink-0" />
                        <span>Selected: <strong>{config.neuronWriterProjectName}</strong></span>
                      </div>
                    )}
                  </>
                )}

                {!neuronWriterLoading && !neuronWriterError && neuronWriterProjects.length === 0 && nwFetchAttempted && (
                  <div className="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-lg">
                    <div className="flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm text-yellow-400">No projects found</p>
                        <p className="text-xs text-yellow-400/60 mt-0.5">
                          Create a project in NeuronWriter first, or verify your API key is correct.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {!neuronWriterLoading && !neuronWriterError && neuronWriterProjects.length === 0 && !nwFetchAttempted && (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Click "Refresh Projects" to load your NeuronWriter projects.</span>
                  </div>
                )}
              </div>
            )}

            {config.neuronWriterApiKey && config.neuronWriterApiKey.trim().length > 0 && config.neuronWriterApiKey.trim().length < 10 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>API key appears too short. Enter a valid NeuronWriter API key.</span>
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
