// src/lib/sota/SOTAContentGenerationEngine.ts
// ═══════════════════════════════════════════════════════════════════════════════
// SOTA CONTENT GENERATION ENGINE v2.2 — Multi-Model AI Processing
// ═══════════════════════════════════════════════════════════════════════════════
//
// v2.2 Fixes:
//   • FIXED: Cache key uses full-prompt hash instead of truncation to 200 chars.
//     Previously, two different 10,000-char prompts sharing the same first 200
//     characters would collide, returning stale/wrong cached content.
//
// v2.1 Fixes:
//   • FIXED: Cache type mismatch
//   • Added retry logic for transient API errors (429, 500, 503)
//   • Improved error handling
//
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  AIModel,
  APIKeys,
  GenerationParams,
  GenerationResult,
  ConsensusResult,
} from './types';
import { generationCache } from './cache';

// ─────────────────────────────────────────────────────────────────────────────
// Model configurations with dynamic model ID support
// ─────────────────────────────────────────────────────────────────────────────

interface ModelConfig {
  endpoint: string;
  modelId: string;
  weight: number;
  maxTokens: number;
}

const DEFAULT_MODEL_CONFIGS: Record<AIModel, ModelConfig> = {
  gemini: {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    modelId: 'gemini-2.5-flash',
    weight: 1.0,
    maxTokens: 8192,
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    modelId: 'gpt-4o',
    weight: 1.0,
    maxTokens: 16384,
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    modelId: 'claude-sonnet-4-20250514',
    weight: 1.0,
    maxTokens: 8192,
  },
  openrouter: {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    modelId: 'anthropic/claude-3.5-sonnet',
    weight: 0.9,
    maxTokens: 8192,
  },
  groq: {
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    modelId: 'llama-3.3-70b-versatile',
    weight: 0.8,
    maxTokens: 8192,
  },
};

// Extended API Keys interface with custom model IDs
export interface ExtendedAPIKeys extends APIKeys {
  openrouterModelId?: string;
  groqModelId?: string;
}

/** Maximum retries for transient API errors (429, 500, 503) */
const MAX_RETRIES = 2;
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];

// ─────────────────────────────────────────────────────────────────────────────
// ✅ FIX #6: Deterministic hash for cache keys
//
// The previous approach truncated the prompt to 200 chars, causing collisions
// for long-form generation prompts that share a common preamble (e.g. the
// master system prompt prefix). This simple hash produces a unique-enough key
// for cache lookup without needing a crypto import.
// ─────────────────────────────────────────────────────────────────────────────

function simpleHash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class SOTAContentGenerationEngine {
  private apiKeys: ExtendedAPIKeys;
  private onProgress?: (message: string) => void;
  private modelConfigs: Record<AIModel, ModelConfig>;

  constructor(apiKeys: ExtendedAPIKeys, onProgress?: (message: string) => void) {
    this.apiKeys = apiKeys;
    this.onProgress = onProgress;

    // Build model configs with custom model IDs
    this.modelConfigs = { ...DEFAULT_MODEL_CONFIGS };

    // Override OpenRouter model if provided
    if (apiKeys.openrouterModelId) {
      this.modelConfigs.openrouter = {
        ...this.modelConfigs.openrouter,
        modelId: apiKeys.openrouterModelId,
      };
      this.log(`OpenRouter using custom model: ${apiKeys.openrouterModelId}`);
    }

    // Override Groq model if provided
    if (apiKeys.groqModelId) {
      this.modelConfigs.groq = {
        ...this.modelConfigs.groq,
        modelId: apiKeys.groqModelId,
      };
      this.log(`Groq using custom model: ${apiKeys.groqModelId}`);
    }
  }

  private log(message: string): void {
    this.onProgress?.(message);
    console.log(`[SOTA Engine] ${message}`);
  }

  private getApiKey(model: AIModel): string | undefined {
    const keyMap: Record<AIModel, keyof APIKeys> = {
      gemini: 'geminiApiKey',
      openai: 'openaiApiKey',
      anthropic: 'anthropicApiKey',
      openrouter: 'openrouterApiKey',
      groq: 'groqApiKey',
    };
    return this.apiKeys[keyMap[model]];
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Determine if an error is retryable (rate limit or transient server error).
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message;
      return RETRYABLE_STATUS_CODES.some(code => msg.includes(String(code))) ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('fetch failed');
    }
    return false;
  }

  async generateWithModel(params: GenerationParams): Promise<GenerationResult> {
    const { prompt, model, systemPrompt, temperature = 0.7, maxTokens } = params;
    const apiKey = this.getApiKey(model);

    if (!apiKey) {
      throw new Error(`No API key configured for ${model}`);
    }

    // ✅ FIX #6: Use full-content hash for cache key instead of 200-char truncation.
    //    Old code:  { prompt: prompt.slice(0, 200), model, systemPrompt: (systemPrompt || '').slice(0, 100) }
    //    This caused collisions for prompts sharing a common preamble.
    const cacheKey = `${model}:${simpleHash(prompt)}:${simpleHash(systemPrompt || '')}`;
    const cached = generationCache.get<GenerationResult>(cacheKey);
    if (cached) {
      generationCache.recordHit();
      this.log(`Cache hit for ${model}`);
      return { ...cached, cached: true };
    }
    generationCache.recordMiss();

    const config = this.modelConfigs[model];
    const finalMaxTokens = maxTokens || config.maxTokens;

    // Retry loop for transient errors
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 8000);
        this.log(`Retrying ${model} (attempt ${attempt + 1}/${MAX_RETRIES + 1}) after ${backoffMs}ms...`);
        await this.sleep(backoffMs);
      }

      const startTime = Date.now();

      try {
        let content = '';
        let tokensUsed = 0;

        if (model === 'gemini') {
          content = await this.callGemini(apiKey, prompt, systemPrompt, temperature, finalMaxTokens);
        } else if (model === 'openai') {
          const r = await this.callOpenAI(apiKey, prompt, systemPrompt, temperature, finalMaxTokens);
          content = r.content;
          tokensUsed = r.tokens;
        } else if (model === 'anthropic') {
          const r = await this.callAnthropic(apiKey, prompt, systemPrompt, temperature, finalMaxTokens);
          content = r.content;
          tokensUsed = r.tokens;
        } else if (model === 'openrouter' || model === 'groq') {
          const r = await this.callOpenAICompatible(
            config.endpoint, apiKey, config.modelId,
            prompt, systemPrompt, temperature, finalMaxTokens,
          );
          content = r.content;
          tokensUsed = r.tokens;
        }

        const result: GenerationResult = {
          content,
          model,
          tokensUsed,
          duration: Date.now() - startTime,
          cached: false,
        };

        // Cache the resolved result directly (NOT a Promise wrapper)
        generationCache.set(cacheKey, result);

        return result;
      } catch (error) {
        lastError = error;
        if (attempt < MAX_RETRIES && this.isRetryableError(error)) {
          this.log(`${model} returned retryable error: ${error}`);
          continue;
        }
        break;
      }
    }

    this.log(`Error with ${model} after ${MAX_RETRIES + 1} attempts: ${lastError}`);
    throw lastError;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MODEL-SPECIFIC CALLERS
  // ─────────────────────────────────────────────────────────────────────────

  private async callGemini(
    apiKey: string,
    prompt: string,
    systemPrompt?: string,
    temperature: number = 0.7,
    maxTokens: number = 8192,
  ): Promise<string> {
    const url = `${this.modelConfigs.gemini.endpoint}/${this.modelConfigs.gemini.modelId}:generateContent?key=${apiKey}`;

    const contents = [{ role: 'user', parts: [{ text: prompt }] }];

    const requestBody: Record<string, unknown> = {
      contents,
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    };

    if (systemPrompt) {
      requestBody.system_instruction = { parts: [{ text: systemPrompt }] };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Gemini API error ${response.status}: ${errorBody.slice(0, 200)}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  private async callOpenAI(
    apiKey: string,
    prompt: string,
    systemPrompt?: string,
    temperature: number = 0.7,
    maxTokens: number = 4096,
  ): Promise<{ content: string; tokens: number }> {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(this.modelConfigs.openai.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelConfigs.openai.modelId,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`OpenAI API error ${response.status}: ${errorBody.slice(0, 200)}`);
    }

    const data = await response.json();
    return {
      content: data.choices?.[0]?.message?.content || '',
      tokens: data.usage?.total_tokens || 0,
    };
  }

  private async callAnthropic(
    apiKey: string,
    prompt: string,
    systemPrompt?: string,
    temperature: number = 0.7,
    maxTokens: number = 4096,
  ): Promise<{ content: string; tokens: number }> {
    const response = await fetch(this.modelConfigs.anthropic.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.modelConfigs.anthropic.modelId,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        temperature,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Anthropic API error ${response.status}: ${errorBody.slice(0, 200)}`);
    }

    const data = await response.json();
    return {
      content: data.content?.[0]?.text || '',
      tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    };
  }

  private async callOpenAICompatible(
    endpoint: string,
    apiKey: string,
    modelId: string,
    prompt: string,
    systemPrompt?: string,
    temperature: number = 0.7,
    maxTokens: number = 4096,
  ): Promise<{ content: string; tokens: number }> {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: modelId, messages, temperature, max_tokens: maxTokens }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`${modelId} API error ${response.status}: ${errorBody.slice(0, 200)}`);
    }

    const data = await response.json();
    return {
      content: data.choices?.[0]?.message?.content || '',
      tokens: data.usage?.total_tokens || 0,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONSENSUS GENERATION
  // ─────────────────────────────────────────────────────────────────────────

  async generateWithConsensus(
    prompt: string,
    systemPrompt?: string,
    models?: AIModel[],
  ): Promise<ConsensusResult> {
    const availableModels = models || this.getAvailableModels();

    if (availableModels.length === 0) {
      throw new Error('No AI models available');
    }

    if (availableModels.length === 1) {
      const result = await this.generateWithModel({
        prompt,
        model: availableModels[0],
        apiKeys: this.apiKeys,
        systemPrompt,
      });
      return {
        finalContent: result.content,
        models: [availableModels[0]],
        scores: { [availableModels[0]]: 1.0 } as Record<AIModel, number>,
        synthesized: false,
        confidence: 0.8,
      };
    }

    this.log(`Running consensus generation with ${availableModels.length} models...`);

    const results = await Promise.allSettled(
      availableModels.map(model =>
        this.generateWithModel({ prompt, model, apiKeys: this.apiKeys, systemPrompt }),
      ),
    );

    const successfulResults: Array<{ model: AIModel; content: string }> = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successfulResults.push({ model: availableModels[index], content: result.value.content });
      }
    });

    if (successfulResults.length === 0) {
      throw new Error('All models failed to generate content');
    }

    if (successfulResults.length === 1) {
      return {
        finalContent: successfulResults[0].content,
        models: [successfulResults[0].model],
        scores: { [successfulResults[0].model]: 1.0 } as Record<AIModel, number>,
        synthesized: false,
        confidence: 0.7,
      };
    }

    const synthesized = await this.synthesizeConsensus(successfulResults, systemPrompt);
    const scores: Record<AIModel, number> = {} as Record<AIModel, number>;
    successfulResults.forEach(r => { scores[r.model] = this.modelConfigs[r.model].weight; });

    return {
      finalContent: synthesized,
      models: successfulResults.map(r => r.model),
      scores,
      synthesized: true,
      confidence: 0.95,
    };
  }

  private async synthesizeConsensus(
    results: Array<{ model: AIModel; content: string }>,
    originalSystemPrompt?: string,
  ): Promise<string> {
    const primaryModel = this.getAvailableModels()[0];

    const synthesisPrompt = `You are an expert content editor. Below are ${results.length} different versions of the same content. Synthesize the BEST version by:

1. Taking the strongest points from each version
2. Ensuring factual consistency
3. Maintaining the best writing style and flow
4. Removing redundancy or filler
5. Ensuring proper HTML structure

${results.map((r, i) => `\n=== VERSION ${i + 1} (${r.model.toUpperCase()}) ===\n${r.content}\n`).join('\n')}

Synthesize into ONE perfect piece. Output ONLY the final content, no explanations.`;

    const result = await this.generateWithModel({
      prompt: synthesisPrompt,
      model: primaryModel,
      apiKeys: this.apiKeys,
      systemPrompt: originalSystemPrompt,
      temperature: 0.3,
    });

    return result.content;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  getAvailableModels(): AIModel[] {
    const models: AIModel[] = ['gemini', 'openai', 'anthropic', 'openrouter', 'groq'];
    return models.filter(model => this.getApiKey(model));
  }

  hasAvailableModel(): boolean {
    return this.getAvailableModels().length > 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────────────────

export function createSOTAEngine(
  apiKeys: APIKeys,
  onProgress?: (message: string) => void,
): SOTAContentGenerationEngine {
  return new SOTAContentGenerationEngine(apiKeys, onProgress);
}
