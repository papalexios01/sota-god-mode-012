// src/lib/sota/cache.ts
// GENERATION CACHE v2.2 — No .finally() anywhere

interface CacheEntry<T = unknown> {
  value: T;
  createdAt: number;
  accessedAt: number;
  ttl: number;
  size: number;
}

class GenerationCache {
  private cache = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private maxSize: number;
  private defaultTTL: number;

  constructor(options?: { maxSize?: number; defaultTTLMs?: number }) {
    this.maxSize = options?.maxSize ?? 100;
    this.defaultTTL = options?.defaultTTLMs ?? 30 * 60 * 1000;
  }

  get<T = unknown>(key: string | Record<string, unknown>): T | undefined {
    const k = this.normalizeKey(key);
    const entry = this.cache.get(k);
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt > entry.ttl) {
      this.cache.delete(k);
      return undefined;
    }
    entry.accessedAt = Date.now();
    return entry.value as T;
  }

  set<T = unknown>(key: string | Record<string, unknown>, value: T, ttl?: number): void {
    const k = this.normalizeKey(key);
    if (value && typeof (value as any).then === 'function') {
      console.warn('[GenerationCache] Attempted to cache a Promise. Skipping.');
      return;
    }
    if (this.cache.size >= this.maxSize && !this.cache.has(k)) {
      this.evictLRU();
    }
    let estimatedSize = 0;
    try {
      estimatedSize = typeof value === 'string' ? value.length : JSON.stringify(value)?.length ?? 0;
    } catch { estimatedSize = 0; }
    this.cache.set(k, {
      value,
      createdAt: Date.now(),
      accessedAt: Date.now(),
      ttl: ttl ?? this.defaultTTL,
      size: estimatedSize,
    });
  }

  has(key: string | Record<string, unknown>): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string | Record<string, unknown>): boolean {
    return this.cache.delete(this.normalizeKey(key));
  }

  recordHit(): void { this.hits++; }
  recordMiss(): void { this.misses++; }

  getStats(): { size: number; hitRate: number; hits: number; misses: number; evictions: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  getMemoryUsage(): number {
    let total = 0;
    for (const entry of this.cache.values()) total += entry.size;
    return total;
  }

  private normalizeKey(key: string | Record<string, unknown>): string {
    if (typeof key === 'string') return key;
    try { return JSON.stringify(key); } catch { return String(key); }
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;
    for (const [k, entry] of this.cache.entries()) {
      if (entry.accessedAt < oldestAccess) {
        oldestAccess = entry.accessedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.evictions++;
    }
  }
}

export const generationCache = new GenerationCache({
  maxSize: 100,
  defaultTTLMs: 30 * 60 * 1000,
});

export default GenerationCache;
