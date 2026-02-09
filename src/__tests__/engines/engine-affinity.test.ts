import { describe, it, expect } from "vitest";
import type { EngineName } from "../../engines/types.js";
import { EngineAffinityCache } from "../../engines/engine-affinity.js";

const DEFAULT_ORDER: EngineName[] = ["http", "tlsclient", "hero"];

describe("EngineAffinityCache", () => {
  it("reorders engine cascade based on per-domain success history", () => {
    const t = 0;
    const cache = new EngineAffinityCache({ now: () => t, ttlMs: 60_000 });

    cache.recordResult("example.com", "hero", true);
    expect(cache.getOrderedEngines("example.com", DEFAULT_ORDER)).toEqual([
      "hero",
      "http",
      "tlsclient",
    ]);

    // If http repeatedly fails on the domain, it should be pushed later.
    cache.recordResult("example.com", "http", false);
    cache.recordResult("example.com", "http", false);
    expect(cache.getOrderedEngines("example.com", DEFAULT_ORDER)).toEqual([
      "hero",
      "tlsclient",
      "http",
    ]);
  });

  it("expires domain affinity after TTL", () => {
    let t = 0;
    const cache = new EngineAffinityCache({ now: () => t, ttlMs: 100 });

    cache.recordResult("expired.com", "hero", true);
    expect(cache.getPreferredEngine("expired.com")).toBe(null);
    expect(cache.getOrderedEngines("expired.com", DEFAULT_ORDER)[0]).toBe("hero");
    expect(cache.getDomainSnapshot("expired.com")).not.toBeNull();

    t = 101;

    expect(cache.getPreferredEngine("expired.com")).toBe(null);
    expect(cache.getOrderedEngines("expired.com", DEFAULT_ORDER)).toEqual(DEFAULT_ORDER);
    expect(cache.getDomainSnapshot("expired.com")).toBeNull();
  });

  it("evicts least-recently-used domains when maxEntries is exceeded", () => {
    let t = 0;
    const cache = new EngineAffinityCache({ now: () => t, ttlMs: 60_000, maxEntries: 2 });

    cache.recordResult("a.com", "http", true);
    t += 1;
    cache.recordResult("b.com", "hero", true);
    expect(cache.stats().domains).toBe(2);

    // Touch a.com so b.com becomes LRU.
    cache.getOrderedEngines("a.com", DEFAULT_ORDER);

    t += 1;
    cache.recordResult("c.com", "hero", true);
    expect(cache.stats().domains).toBe(2);

    expect(cache.getDomainSnapshot("a.com")).not.toBeNull();
    expect(cache.getDomainSnapshot("c.com")).not.toBeNull();
    expect(cache.getDomainSnapshot("b.com")).toBeNull();
  });

  it("recordResult updates per-engine counters and response-time EMA", () => {
    let t = 0;
    const cache = new EngineAffinityCache({ now: () => t, ttlMs: 60_000 });

    cache.recordResult("stats.com", "http", true, 100);
    t += 1;
    cache.recordResult("stats.com", "http", true, 200);
    t += 1;
    cache.recordResult("stats.com", "http", false);

    const snap = cache.getDomainSnapshot("stats.com");
    expect(snap).not.toBeNull();
    const http = snap!.entries.http;
    expect(http).toBeDefined();
    expect(http!.successes).toBe(2);
    expect(http!.failures).toBe(1);
    expect(http!.lastSuccess).toBe(1);
    expect(http!.lastFailure).toBe(2);
    expect(http!.avgResponseMs).not.toBeNull();
    // EMA: 100 -> 100*0.7 + 200*0.3 = 130
    expect(http!.avgResponseMs!).toBeCloseTo(130, 5);
  });

  it("sets preferredEngine only when threshold (min samples + success rate) is met", () => {
    const t = 0;
    const cache = new EngineAffinityCache({
      now: () => t,
      ttlMs: 60_000,
      preferredMinSamples: 2,
      preferredMinSuccessRate: 0.6,
    });

    cache.recordResult("pref.com", "http", true);
    expect(cache.getPreferredEngine("pref.com")).toBe(null);

    cache.recordResult("pref.com", "http", true);
    expect(cache.getPreferredEngine("pref.com")).toBe("http");

    // Drop below success-rate threshold.
    cache.recordResult("pref.com", "http", false);
    cache.recordResult("pref.com", "http", false);
    expect(cache.getPreferredEngine("pref.com")).toBe(null);

    // Another engine can become preferred once it meets thresholds.
    cache.recordResult("pref.com", "hero", true);
    cache.recordResult("pref.com", "hero", true);
    expect(cache.getPreferredEngine("pref.com")).toBe("hero");
  });
});
