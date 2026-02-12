// server/cache.ts
// SOTA God Mode - TTL Cache + Circuit Breaker v3.0

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export class TTLCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private maxSize: number;

  constructor(
    private defaultTtlMs: number = 60_000,
    maxSize: number = 1000,
  ) {
    this.maxSize = maxSize;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: T, ttlMs: number = this.defaultTtlMs) {
    // Evict oldest if at capacity
    if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  /** Remove all expired entries */
  prune(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }
}

// ═══════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════════════

type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit */
  failureThreshold?: number;
  /** How long (ms) to wait before trying again after opening */
  resetTimeoutMs?: number;
  /** Optional label for logging */
  name?: string;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60_000;
    this.name = options.name ?? "default";
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = "half-open";
        console.log(`[CircuitBreaker:${this.name}] Transitioning to half-open`);
      } else {
        throw new Error(
          `Circuit breaker "${this.name}" is OPEN. Retry after ${Math.ceil((this.lastFailureTime + this.resetTimeoutMs - Date.now()) / 1000)}s.`,
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    if (this.state === "half-open") {
      console.log(`[CircuitBreaker:${this.name}] Recovered — closing circuit`);
    }
    this.failureCount = 0;
    this.state = "closed";
  }

  private onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = "open";
      console.warn(
        `[CircuitBreaker:${this.name}] OPENED after ${this.failureCount} consecutive failures`,
      );
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  reset() {
    this.state = "closed";
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}
