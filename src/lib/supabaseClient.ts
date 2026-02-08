import { createClient, SupabaseClient } from '@supabase/supabase-js';

<<<<<<< HEAD
// SOTA Supabase Client (Enterprise Grade)
// Goals:
// 1) Cloudflare Pages friendly (no server secrets required for client app)
// 2) Supports runtime configuration (env OR user-provided in Setup, stored locally)
// 3) Graceful degradation (offline mode still works via local persistence)
// 4) Safe by design: uses anon key ONLY (never service role on the client)

const LS_URL_KEY = 'sota.supabase.url';
const LS_ANON_KEY = 'sota.supabase.anonKey';

function readRuntimeConfig() {
  // Prefer build-time env, fallback to locally saved config.
  const url =
    (import.meta.env.VITE_SUPABASE_URL?.trim() ||
      (typeof window !== 'undefined' ? localStorage.getItem(LS_URL_KEY) || '' : '')).trim();

  const anonKey =
    (import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ||
      (typeof window !== 'undefined' ? localStorage.getItem(LS_ANON_KEY) || '' : '')).trim();

  return { url, anonKey };
}

export function validateSupabaseConfig(url: string, anonKey: string) {
  const configured =
    Boolean(url && anonKey) && url.startsWith('https://') && url.includes('.supabase.');
  const issues: string[] = [];
  if (!url) issues.push('Missing Supabase URL');
  if (!anonKey) issues.push('Missing Supabase anon key');
  if (url && !url.startsWith('https://')) issues.push('Supabase URL must start with https://');
  if (url && !url.includes('.supabase.')) issues.push('Supabase URL does not look like a Supabase project URL');
  return { configured, issues };
}

export function getSupabaseConfig() {
  const { url, anonKey } = readRuntimeConfig();
  const { configured, issues } = validateSupabaseConfig(url, anonKey);
  return { url, anonKey, configured, issues };
}

export function saveSupabaseConfig(url: string, anonKey: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_URL_KEY, (url || '').trim());
  localStorage.setItem(LS_ANON_KEY, (anonKey || '').trim());
}

export function clearSupabaseConfig() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(LS_URL_KEY);
  localStorage.removeItem(LS_ANON_KEY);
}

// Singleton client that can reinitialize if config changes at runtime.
=======
const LS_URL_KEY = 'sota.supabase.url';
const LS_ANON_KEY = 'sota.supabase.anonKey';

function readRuntimeConfig() {
  const url =
    (import.meta.env.VITE_SUPABASE_URL?.trim() ||
      (typeof window !== 'undefined' ? localStorage.getItem(LS_URL_KEY) || '' : '')).trim();
  const anonKey =
    (import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ||
      (typeof window !== 'undefined' ? localStorage.getItem(LS_ANON_KEY) || '' : '')).trim();
  return { url, anonKey };
}

export function validateSupabaseConfig(url: string, anonKey: string) {
  const issues: string[] = [];
  if (!url) issues.push('Missing Supabase URL');
  if (!anonKey) issues.push('Missing Supabase anon key');
  if (url && !url.startsWith('https://')) issues.push('Supabase URL must start with https://');
  if (url && !url.includes('.supabase.')) issues.push('Supabase URL does not look like a Supabase project URL');
  return { configured: issues.length === 0, issues };
}

export function getSupabaseConfig() {
  const { url, anonKey } = readRuntimeConfig();
  const { configured, issues } = validateSupabaseConfig(url, anonKey);
  return { url, anonKey, configured, issues };
}

export function saveSupabaseConfig(url: string, anonKey: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_URL_KEY, (url || '').trim());
  localStorage.setItem(LS_ANON_KEY, (anonKey || '').trim());
}

export function clearSupabaseConfig() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(LS_URL_KEY);
  localStorage.removeItem(LS_ANON_KEY);
}

>>>>>>> ede78cf (fix: stop SupabaseSyncProvider crash (remove undefined isSupabaseConfigured))
let supabaseInstance: SupabaseClient | null = null;
let lastFingerprint = '';

function fingerprint(url: string, anonKey: string) {
  return `${url}::${anonKey.slice(0, 12)}`;
}

export function getSupabaseClient(): SupabaseClient | null {
  const { url, anonKey, configured } = getSupabaseConfig();
  if (!configured) return null;

  const fp = fingerprint(url, anonKey);
  if (supabaseInstance && fp === lastFingerprint) return supabaseInstance;

  try {
    supabaseInstance = createClient(url, anonKey, {
<<<<<<< HEAD
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      global: {
        headers: {
          'X-Client-Info': 'wp-content-optimizer-pro',
        },
      },
    });
    lastFingerprint = fp;
    console.log('[Supabase] ✓ Client initialized successfully');
    return supabaseInstance;
  } catch (error) {
    console.error('[Supabase] ✗ Failed to initialize client:', error);
=======
      auth: { persistSession: true, autoRefreshToken: true },
      global: { headers: { 'X-Client-Info': 'wp-content-optimizer-pro' } },
    });
    lastFingerprint = fp;
    return supabaseInstance;
  } catch (e) {
    console.error('[Supabase] init failed', e);
>>>>>>> ede78cf (fix: stop SupabaseSyncProvider crash (remove undefined isSupabaseConfigured))
    supabaseInstance = null;
    lastFingerprint = '';
    return null;
  }
}

<<<<<<< HEAD
// Backwards-compatible exports
export const isSupabaseConfigured = getSupabaseConfig().configured;
export const supabase = getSupabaseClient();

// Helper function to safely execute Supabase operations
export async function withSupabase<T>(
  operation: (client: SupabaseClient) => Promise<T>,
  fallback: T
): Promise<T> {
  const client = getSupabaseClient();
  if (!client) return fallback;

  try {
    return await operation(client);
  } catch (error) {
    console.error('[Supabase] Operation failed:', error);
    return fallback;
  }
=======
export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig().configured;
}

export function getSupabase(): ReturnType<typeof getSupabaseClient> {
  return getSupabaseClient();
}
export async function withSupabase<T>(operation: (client: SupabaseClient) => Promise<T>, fallback: T): Promise<T> {
  const client = getSupabaseClient();
  if (!client) return fallback;
  try { return await operation(client); } catch (e) { console.error('[Supabase] op failed', e); return fallback; }
>>>>>>> ede78cf (fix: stop SupabaseSyncProvider crash (remove undefined isSupabaseConfigured))
}
