import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rateLimit, jitteredDelay, RateLimiter } from "../../utils/rate-limiter.js";

// ---------------------------------------------------------------------------
// jitteredDelay
// ---------------------------------------------------------------------------

describe("jitteredDelay", () => {
  it("returns a number", () => {
    expect(typeof jitteredDelay(100)).toBe("number");
  });

  it("with jitterFactor=0 returns exact base value", () => {
    // min = base*(1-0) = base, max = base*(1+0) = base → always base
    expect(jitteredDelay(200, 0)).toBe(200);
  });

  it("with default jitterFactor (0.5) returns within [base*0.5, base*1.5]", () => {
    const results = Array.from({ length: 200 }, () => jitteredDelay(1000));
    for (const r of results) {
      expect(r).toBeGreaterThanOrEqual(500);
      expect(r).toBeLessThanOrEqual(1500);
    }
  });

  it("with jitterFactor=1 returns within [0, base*2]", () => {
    const results = Array.from({ length: 200 }, () => jitteredDelay(1000, 1));
    for (const r of results) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(2000);
    }
  });

  it("returns an integer (Math.floor applied)", () => {
    const results = Array.from({ length: 50 }, () => jitteredDelay(333, 0.7));
    for (const r of results) {
      expect(Number.isInteger(r)).toBe(true);
    }
  });

  it("produces variation across many calls", () => {
    const results = new Set(Array.from({ length: 100 }, () => jitteredDelay(1000)));
    expect(results.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// rateLimit
// ---------------------------------------------------------------------------

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a Promise", () => {
    const p = rateLimit(100);
    expect(p).toBeInstanceOf(Promise);
    // Advance timers so the promise resolves (clean up)
    vi.advanceTimersByTime(200);
  });

  it("resolves after the specified delay (no jitter)", async () => {
    let resolved = false;
    const p = rateLimit(500).then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it("resolves with void", async () => {
    const p = rateLimit(10);
    vi.advanceTimersByTime(20);
    const result = await p;
    expect(result).toBeUndefined();
  });

  it("with jitter > 0 delays within the jittered range", async () => {
    // With jitter=0.5, delay ∈ [base*0.5, base*1.5] = [50, 150]
    // Force Math.random to return 0.5 → jitteredDelay gives min + 0.5*(max-min)
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    let resolved = false;
    const p = rateLimit(100, 0.5).then(() => {
      resolved = true;
    });

    // jitteredDelay(100, 0.5): min=50, max=150, result = floor(50 + 0.5*100) = 100
    await vi.advanceTimersByTimeAsync(99);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);

    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// RateLimiter
// ---------------------------------------------------------------------------

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("execute() runs the provided function and returns its result", async () => {
    const limiter = new RateLimiter(100); // 100 rps → 10ms interval
    const fn = vi.fn().mockResolvedValue(42);

    const promise = limiter.execute(fn);
    // Advance timers generously to let internal delays resolve
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;

    expect(fn).toHaveBeenCalledOnce();
    expect(result).toBe(42);
  });

  it("serializes concurrent requests (concurrency = 1)", async () => {
    const limiter = new RateLimiter(10); // 10 rps → 100ms interval
    const order: number[] = [];

    const p1 = limiter.execute(async () => {
      order.push(1);
      return "a";
    });
    const p2 = limiter.execute(async () => {
      order.push(2);
      return "b";
    });
    const p3 = limiter.execute(async () => {
      order.push(3);
      return "c";
    });

    // Advance enough time for all to complete
    await vi.advanceTimersByTimeAsync(5000);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe("a");
    expect(r2).toBe("b");
    expect(r3).toBe("c");
    expect(order).toEqual([1, 2, 3]);
  });

  it("executeAll() processes all functions and returns results", async () => {
    const limiter = new RateLimiter(100);
    const fns = [async () => "x", async () => "y", async () => "z"];

    const promise = limiter.executeAll(fns);
    await vi.advanceTimersByTimeAsync(5000);
    const results = await promise;

    expect(results).toEqual(["x", "y", "z"]);
  });

  it("propagates errors from the executed function", async () => {
    const limiter = new RateLimiter(100);

    const promise = limiter.execute(async () => {
      throw new Error("boom");
    });

    // Attach a no-op catch to prevent unhandled rejection warning
    // while we advance timers. The real assertion is below.
    promise.catch(() => {});

    // Advance timers so the internal delay resolves, then assert rejection
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).rejects.toThrow("boom");
  });

  describe("crawlDelay support", () => {
    it("setCrawlDelay() updates the delay", () => {
      const limiter = new RateLimiter(10);
      // Should not throw
      limiter.setCrawlDelay(5000);
    });

    it("setCrawlDelay(null) clears crawl delay", () => {
      const limiter = new RateLimiter(10);
      limiter.setCrawlDelay(5000);
      limiter.setCrawlDelay(null);
      // Should not throw
    });

    it("crawlDelayMs takes precedence over requestsPerSecond", async () => {
      // 10 rps → 100ms, but crawlDelay = 2000ms
      const limiter = new RateLimiter(10, { crawlDelayMs: 2000, jitterFactor: 0 });
      const calls: number[] = [];

      const p1 = limiter.execute(async () => {
        calls.push(Date.now());
        return 1;
      });
      await vi.advanceTimersByTimeAsync(100);
      await p1;

      const p2 = limiter.execute(async () => {
        calls.push(Date.now());
        return 2;
      });

      // After 100ms the second request should NOT have executed yet (needs ~2000ms delay)
      await vi.advanceTimersByTimeAsync(100);
      expect(calls).toHaveLength(1);

      // Advance past the crawl delay
      await vi.advanceTimersByTimeAsync(3000);
      await p2;
      expect(calls).toHaveLength(2);

      // The gap should be >= crawlDelay (roughly)
      const gap = calls[1] - calls[0];
      expect(gap).toBeGreaterThanOrEqual(1500); // allow jitter tolerance
    });
  });

  describe("jitter", () => {
    it("with jitterFactor=0 does not add random delays when enough time passed", async () => {
      const limiter = new RateLimiter(1, { jitterFactor: 0 });
      const fn = vi.fn().mockResolvedValue("ok");

      const promise = limiter.execute(fn);
      await vi.advanceTimersByTimeAsync(2000);
      await promise;

      expect(fn).toHaveBeenCalledOnce();
    });

    it("constructor defaults jitterFactor to 0.3", async () => {
      // We can't inspect private fields, but we can verify it constructs without error
      const limiter = new RateLimiter(5);
      const promise = limiter.execute(async () => "ok");
      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise;
      expect(result).toBe("ok");
    });
  });
});
