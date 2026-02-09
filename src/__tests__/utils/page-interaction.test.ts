import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeWaitForNetworkIdleConfig,
  normalizeScrollToBottomConfig,
  normalizeClickLoadMoreConfig,
  waitForNetworkIdle,
  scrollToBottom,
  clickLoadMore,
  type PageInteractionTab,
} from "../../utils/page-interaction.js";

describe("normalizeWaitForNetworkIdleConfig", () => {
  it("provides safe defaults", () => {
    expect(normalizeWaitForNetworkIdleConfig(undefined)).toEqual({
      idleTimeMs: 500,
      timeoutMs: 15_000,
      pollIntervalMs: 100,
      maxPolls: 155,
    });
  });

  it("clamps invalid values", () => {
    expect(
      normalizeWaitForNetworkIdleConfig({
        idleTimeMs: -1,
        timeoutMs: 999_999,
        pollIntervalMs: 1,
        maxPolls: 0,
      })
    ).toEqual({
      idleTimeMs: 0,
      timeoutMs: 120_000,
      pollIntervalMs: 25,
      maxPolls: 1,
    });
  });
});

describe("normalizeScrollToBottomConfig", () => {
  it("provides safe defaults", () => {
    expect(normalizeScrollToBottomConfig(undefined)).toEqual({
      maxIterations: 12,
      scrollDelayMs: 750,
      stableIterations: 2,
      timeoutMs: 30_000,
    });
  });
});

describe("normalizeClickLoadMoreConfig", () => {
  it("normalizes nested config and supports disabling network idle", () => {
    const cfg = normalizeClickLoadMoreConfig({
      maxClicks: 10,
      waitForNetworkIdle: false,
      heightProbeSelector: "#items",
    });

    expect(cfg.maxClicks).toBe(10);
    expect(cfg.heightProbeSelector).toBe("#items");
    expect(cfg.waitForNetworkIdle).toBeNull();
  });
});

describe("waitForNetworkIdle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops on maxPolls when network never becomes idle", async () => {
    let calls = 0;
    const evaluate = vi.fn(async () => {
      calls++;
      // first call is tracker install; subsequent calls are state reads
      if (calls === 1) return undefined as any;
      return { inFlight: 1, lastActivityTs: Date.now(), nowTs: Date.now() };
    }) as unknown as PageInteractionTab["evaluate"];

    const tab: PageInteractionTab = { evaluate };

    const promise = waitForNetworkIdle(tab, {
      timeoutMs: 10_000,
      pollIntervalMs: 100,
      maxPolls: 3,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;

    expect(result.idle).toBe(false);
    expect(result.reason).toBe("maxPolls");
    expect(result.polls).toBe(3);
  });
});

describe("scrollToBottom", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops on maxIterations when height keeps increasing", async () => {
    const heights = [100, 200, 300, 400];
    let metricsCall = 0;
    let callIndex = 0;
    const evaluate = vi.fn(async () => {
      const isMetrics = callIndex % 2 === 0;
      callIndex++;
      if (!isMetrics) return undefined as any;
      const scrollHeight = heights[Math.min(metricsCall, heights.length - 1)]!;
      metricsCall++;
      return { scrollHeight, scrollY: scrollHeight, viewportHeight: 100 };
    }) as unknown as PageInteractionTab["evaluate"];

    const tab: PageInteractionTab = { evaluate };

    const promise = scrollToBottom(tab, {
      maxIterations: 3,
      scrollDelayMs: 100,
      stableIterations: 2,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await promise;

    expect(result.reason).toBe("maxIterations");
    expect(result.iterations).toBe(3);
  });

  it("stops early when height is stable at bottom", async () => {
    const heights = [100, 100, 100, 100];
    let metricsCall = 0;
    let callIndex = 0;
    const evaluate = vi.fn(async () => {
      const isMetrics = callIndex % 2 === 0;
      callIndex++;
      if (!isMetrics) return undefined as any;
      const scrollHeight = heights[Math.min(metricsCall, heights.length - 1)]!;
      metricsCall++;
      return { scrollHeight, scrollY: 100, viewportHeight: 100 };
    }) as unknown as PageInteractionTab["evaluate"];

    const tab: PageInteractionTab = { evaluate };

    const promise = scrollToBottom(tab, {
      maxIterations: 10,
      scrollDelayMs: 100,
      stableIterations: 2,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await promise;

    expect(result.reason).toBe("idle");
    expect(result.iterations).toBe(2);
  });
});

describe("clickLoadMore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops when selector is not found", async () => {
    let callIndex = 0;
    const evaluate = vi.fn(async () => {
      const phase = callIndex % 3; // 0 height(before), 1 click, 2 height(after)
      callIndex++;
      if (phase === 1) return { found: false, clicked: false, disabled: false };
      return 100;
    }) as unknown as PageInteractionTab["evaluate"];

    const tab: PageInteractionTab = { evaluate };

    const promise = clickLoadMore(tab, "button.load-more", {
      maxClicks: 5,
      waitForNetworkIdle: false,
      afterClickDelayMs: 0,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await promise;

    expect(result).toEqual({ clicks: 0, reason: "notFound" });
  });

  it("stops on noChange after maxNoChangeIterations", async () => {
    const heights = [100, 100, 100, 100];
    let heightIndex = 0;
    let callIndex = 0;
    const evaluate = vi.fn(async () => {
      const phase = callIndex % 3;
      callIndex++;
      if (phase === 1) return { found: true, clicked: true, disabled: false };
      const h = heights[Math.min(heightIndex, heights.length - 1)]!;
      heightIndex++;
      return h;
    }) as unknown as PageInteractionTab["evaluate"];

    const tab: PageInteractionTab = { evaluate };

    const promise = clickLoadMore(tab, "button.load-more", {
      maxClicks: 10,
      maxNoChangeIterations: 2,
      stopIfNoChange: true,
      waitForNetworkIdle: false,
      afterClickDelayMs: 0,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await promise;

    expect(result.reason).toBe("noChange");
    expect(result.clicks).toBe(2);
  });
});
