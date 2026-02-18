// src/lib/sota/cache.ts
// ═══════════════════════════════════════════════════════════════════════════════
// GENERATION CACHE v2.2 — In-Memory LRU Cache for AI Generation Results
// ═══════════════════════════════════════════════════════════════════════════════
//
// v2.2: Complete rewrite to eliminate .finally() calls on non-Promise objects.
//       This fixes "TypeError: r.finally is not a function" when using OpenRouter
//       and other AI providers.
//
//       The previous implementation may have stored or returned Promise objects
//       from the cache. When a cached Promise was later accessed and .finally()
//       was called on the deserialized/stale reference, it crashed because the
//       object was no longer a live Promise.
//
//       This version stores ONLY resolved plain objects. No Promises are cached.
//       No .finally() is used anywhere.
//
// ═══════════════════════════════════════════════════════════════════════════════

interface CacheEntry<T = unknown> {
  value: T;
  createdAt: number;
  accessedAt: number;
  ttl: number;
  size: number;
}

interface CacheStats {
  size: number;
  hitRate: number;
  hits: number;
  misses: number;
  evictions: number;
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
    this.defaultTTL = options?.defaultTTLMs ?? 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Get a cached value by key. Returns undefined on miss or expiry.
   * Accepts string keys (preferred) or object keys (JSON-serialized).
   *
   * IMPORTANT: This returns a PLAIN OBJECT, never a Promise.
   */
  get<T = unknown>(key: string | Record<string, unknown>): T | undefined {
    const k = this.normalizeKey(key);
    const entry = this.cache.get(k);

    if (!entry) {
      return undefined;
    }

    // Check TTL expiry
    if (Date.now() - entry.createdAt > entry.ttl) {
      this.cache.delete(k);
      return undefined;
    }

    // Update access time for LRU
    entry.accessedAt = Date.now();
    return entry.value as T;
  }

  /**
   * Store a resolved value in the cache.
   *
   * IMPORTANT: Only store PLAIN OBJECTS here, never Promises.
   * If you pass a Promise, it will be stored as-is (a frozen object)
   * and .then()/.finally() won't work when retrieved later.
   */
  set<T = unknown>(key: string | Record<string, unknown>, value: T, ttl?: number): void {
    const k = this.normalizeKey(key);

    // Safety: Never cache Promises — they don't survive retrieval correctly.
    if (value && typeof (value as any).then === 'function') {
      console.warn(
        '[GenerationCache] WARNING: Attempted to cache a Promise/thenable. ' +
        'Only resolved plain objects should be cached. Skipping cache write for key: ' + k.slice(0, 60)
      );
      return;
    }

    // Evict LRU entries if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(k)) {
      this.evictLRU();
    }

    const estimatedSize = typeof value === 'string'
      ? value.length
      : JSON.stringify(value)?.length ?? 0;

    this.cache.set(k, {
      value,
      createdAt: Date.now(),
      accessedAt: Date.now(),
      ttl: ttl ?? this.defaultTTL,
      size: estimatedSize,
    });
  }

  /**
   * Check if a key exists and is not expired.
   */
  has(key: string | Record<string, unknown>): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Delete a specific cache entry.
   */
  delete(key: string | Record<string, unknown>): boolean {
    return this.cache.delete(this.normalizeKey(key));
  }

  /**
   * Record a cache hit (for stats).
   */
  recordHit(): void {
    this.hits++;
  }

  /**
   * Record a cache miss (for stats).
   */
  recordMiss(): void {
    this.misses++;
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  /**
   * Clear all cache entries and reset stats.
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Get total estimated memory usage in bytes.
   */
  getMemoryUsage(): number {
    let total = 0;
    for (const entry of this.cache.values()) {
      total += entry.size;
    }
    return total;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Normalize cache key — accept both strings and objects.
   */
  private normalizeKey(key: string | Record<string, unknown>): string {
    if (typeof key === 'string') return key;
    try {
      return JSON.stringify(key);
    } catch {
      return String(key);
    }
  }

  /**
   * Evict the least-recently-accessed entry.
   */
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

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export const generationCache = new GenerationCache({
  maxSize: 100,
  defaultTTLMs: 30 * 60 * 1000, // 30 min
});

export default GenerationCache;
