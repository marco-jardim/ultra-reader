/**
 * Phase 1.5.11: Adaptive Engine Selection (Domain Affinity Cache)
 *
 * Tracks per-domain engine success history and reorders a candidate engine
 * cascade accordingly. In-memory only (LRU + TTL).
 */

import type { EngineName } from "./types.js";

export interface EngineAffinityEntry {
  engine: EngineName;
  successes: number;
  failures: number;
  lastSuccess: number | null;
  lastFailure: number | null;
  /** Exponential moving average (ms). null means unknown. */
  avgResponseMs: number | null;
}

export interface DomainAffinity {
  domain: string;
  entries: Map<EngineName, EngineAffinityEntry>;
  preferredEngine: EngineName | null;
  /** Updated when we record a result (used for TTL). */
  updatedAt: number;
}

export interface EngineAffinityEntrySnapshot {
  engine: EngineName;
  successes: number;
  failures: number;
  lastSuccess: number | null;
  lastFailure: number | null;
  avgResponseMs: number | null;
}

export interface DomainAffinitySnapshot {
  domain: string;
  preferredEngine: EngineName | null;
  updatedAt: number;
  entries: Record<EngineName, EngineAffinityEntrySnapshot | undefined>;
}

export interface EngineAffinityCacheOptions {
  /** Max domains to keep in memory (LRU evicts beyond this). */
  maxEntries?: number;
  /** TTL for a domain affinity record since last update. */
  ttlMs?: number;
  /** Minimum samples for an engine to become the preferred one. */
  preferredMinSamples?: number;
  /** Minimum success-rate for an engine to become preferred. */
  preferredMinSuccessRate?: number;
  /** Inject time source (testing). */
  now?: () => number;
}

type CacheValue = DomainAffinity;

/**
 * In-memory, per-domain engine affinity cache.
 * - TTL expiration based on `updatedAt`
 * - LRU eviction based on access/updates (Map insertion order)
 */
export class EngineAffinityCache {
  private cache = new Map<string, CacheValue>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly preferredMinSamples: number;
  private readonly preferredMinSuccessRate: number;
  private readonly now: () => number;

  constructor(options: EngineAffinityCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 1000);
    this.ttlMs = Math.max(1, options.ttlMs ?? 24 * 60 * 60 * 1000);
    this.preferredMinSamples = Math.max(1, options.preferredMinSamples ?? 2);
    this.preferredMinSuccessRate = Math.min(1, Math.max(0, options.preferredMinSuccessRate ?? 0.6));
    this.now = options.now ?? (() => Date.now());
  }

  /** Returns preferred engine for a domain, or null when unknown/expired. */
  getPreferredEngine(domain: string): EngineName | null {
    const affinity = this.getAffinity(domain);
    return affinity?.preferredEngine ?? null;
  }

  /**
   * Returns engines ordered by predicted success for `domain`.
   * If domain has no data (or expired), returns `defaultOrder`.
   */
  getOrderedEngines(domain: string, defaultOrder: readonly EngineName[]): EngineName[] {
    const affinity = this.getAffinity(domain);
    const order = [...defaultOrder];
    if (!affinity) return order;

    const index = new Map<EngineName, number>();
    for (let i = 0; i < order.length; i++) index.set(order[i]!, i);

    order.sort((a, b) => {
      const aEntry = affinity.entries.get(a);
      const bEntry = affinity.entries.get(b);

      const aScore = this.orderingScore(aEntry);
      const bScore = this.orderingScore(bEntry);
      if (aScore !== bScore) return bScore - aScore;

      const aSamples = aEntry ? aEntry.successes + aEntry.failures : 0;
      const bSamples = bEntry ? bEntry.successes + bEntry.failures : 0;
      if (aSamples !== bSamples) return bSamples - aSamples;

      const aLastSuccess = aEntry?.lastSuccess ?? 0;
      const bLastSuccess = bEntry?.lastSuccess ?? 0;
      if (aLastSuccess !== bLastSuccess) return bLastSuccess - aLastSuccess;

      const aAvg = aEntry?.avgResponseMs;
      const bAvg = bEntry?.avgResponseMs;
      if (typeof aAvg === "number" && typeof bAvg === "number" && aAvg !== bAvg) {
        return aAvg - bAvg; // faster first
      }

      // Stable tie-breaker: keep default cascade order.
      return (index.get(a) ?? 0) - (index.get(b) ?? 0);
    });

    return order;
  }

  /** Record an engine outcome for a domain. */
  recordResult(domain: string, engine: EngineName, success: boolean, responseMs?: number): void {
    const key = this.normalizeDomain(domain);
    const now = this.now();

    let affinity = this.cache.get(key);
    if (!affinity) {
      affinity = {
        domain: key,
        entries: new Map(),
        preferredEngine: null,
        updatedAt: now,
      };
      this.cache.set(key, affinity);
    } else if (this.isExpired(affinity, now)) {
      // Reset expired entry.
      affinity = {
        domain: key,
        entries: new Map(),
        preferredEngine: null,
        updatedAt: now,
      };
      this.cache.set(key, affinity);
    }

    this.touch(key, affinity);

    let entry = affinity.entries.get(engine);
    if (!entry) {
      entry = {
        engine,
        successes: 0,
        failures: 0,
        lastSuccess: null,
        lastFailure: null,
        avgResponseMs: null,
      };
      affinity.entries.set(engine, entry);
    }

    if (success) {
      entry.successes += 1;
      entry.lastSuccess = now;
      if (this.isValidResponseMs(responseMs)) {
        entry.avgResponseMs =
          entry.avgResponseMs === null ? responseMs : entry.avgResponseMs * 0.7 + responseMs * 0.3;
      }
    } else {
      entry.failures += 1;
      entry.lastFailure = now;
    }

    affinity.updatedAt = now;
    affinity.preferredEngine = this.computePreferredEngine(affinity);

    this.evictIfNeeded();
  }

  /** Clear one domain or entire cache. */
  clear(domain?: string): void {
    if (typeof domain === "string") {
      this.cache.delete(this.normalizeDomain(domain));
      return;
    }
    this.cache.clear();
  }

  /** Cache-level stats (useful for diagnostics/tests). */
  stats(): { domains: number; domainsWithPreference: number } {
    let withPreference = 0;
    for (const a of this.cache.values()) {
      if (a.preferredEngine) withPreference += 1;
    }
    return { domains: this.cache.size, domainsWithPreference: withPreference };
  }

  /** Snapshot of the domain record for tests/diagnostics (null if missing/expired). */
  getDomainSnapshot(domain: string): DomainAffinitySnapshot | null {
    const affinity = this.getAffinity(domain);
    if (!affinity) return null;

    const entries: DomainAffinitySnapshot["entries"] = {
      http: undefined,
      tlsclient: undefined,
      hero: undefined,
    };

    for (const [engine, e] of affinity.entries.entries()) {
      entries[engine] = {
        engine,
        successes: e.successes,
        failures: e.failures,
        lastSuccess: e.lastSuccess,
        lastFailure: e.lastFailure,
        avgResponseMs: e.avgResponseMs,
      };
    }

    return {
      domain: affinity.domain,
      preferredEngine: affinity.preferredEngine,
      updatedAt: affinity.updatedAt,
      entries,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private normalizeDomain(domain: string): string {
    return domain.trim().toLowerCase();
  }

  private isExpired(affinity: DomainAffinity, now: number): boolean {
    return now - affinity.updatedAt > this.ttlMs;
  }

  private getAffinity(domain: string): DomainAffinity | null {
    const key = this.normalizeDomain(domain);
    const affinity = this.cache.get(key);
    if (!affinity) return null;

    const now = this.now();
    if (this.isExpired(affinity, now)) {
      this.cache.delete(key);
      return null;
    }

    this.touch(key, affinity);
    return affinity;
  }

  private touch(key: string, affinity: DomainAffinity): void {
    // Refresh LRU position by reinserting.
    this.cache.delete(key);
    this.cache.set(key, affinity);
  }

  private orderingScore(entry: EngineAffinityEntry | undefined): number {
    // Laplace smoothing yields a neutral baseline of 0.5 for unknown engines.
    if (!entry) return 0.5;
    const total = entry.successes + entry.failures;
    return (entry.successes + 1) / (total + 2);
  }

  private computePreferredEngine(affinity: DomainAffinity): EngineName | null {
    let best: EngineName | null = null;
    let bestRate = 0;
    let bestSamples = 0;

    for (const [engine, entry] of affinity.entries.entries()) {
      const total = entry.successes + entry.failures;
      if (total < this.preferredMinSamples) continue;
      const rate = total > 0 ? entry.successes / total : 0;
      if (rate < this.preferredMinSuccessRate) continue;

      if (rate > bestRate) {
        best = engine;
        bestRate = rate;
        bestSamples = total;
        continue;
      }

      if (rate === bestRate && total > bestSamples) {
        best = engine;
        bestSamples = total;
      }
    }

    return best;
  }

  private evictIfNeeded(): void {
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
  }

  private isValidResponseMs(responseMs: unknown): responseMs is number {
    return (
      typeof responseMs === "number" &&
      Number.isFinite(responseMs) &&
      responseMs >= 0 &&
      responseMs <= 10 * 60 * 1000
    );
  }
}
