import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocks must be declared before importing the module under test.
vi.mock("../../cloudflare/detector.js", () => ({
  detectChallenge: vi.fn(),
}));

vi.mock("../../cloudflare/handler.js", () => ({
  handleChallenge: vi.fn(),
}));

vi.mock("../../utils/behavior-simulator.js", () => ({
  simulateBehavior: vi.fn(async () => undefined),
}));

vi.mock("../../utils/page-interaction.js", () => ({
  waitForNetworkIdle: vi.fn(async () => ({ idle: true, waitedMs: 0, polls: 0, reason: "idle" })),
  scrollToBottom: vi.fn(async () => ({ iterations: 1, reason: "idle", finalScrollHeight: 0 })),
}));

import { detectChallenge } from "../../cloudflare/detector.js";
import { handleChallenge } from "../../cloudflare/handler.js";
import { simulateBehavior } from "../../utils/behavior-simulator.js";
import { waitForNetworkIdle, scrollToBottom } from "../../utils/page-interaction.js";

const mockDetectChallenge = vi.mocked(detectChallenge);
const mockHandleChallenge = vi.mocked(handleChallenge);
const mockSimulateBehavior = vi.mocked(simulateBehavior);
const mockWaitForNetworkIdle = vi.mocked(waitForNetworkIdle);
const mockScrollToBottom = vi.mocked(scrollToBottom);

function createMockHero(html: string) {
  const tab = {
    evaluate: vi.fn(async () => undefined),
  };

  return {
    goto: vi.fn(async () => undefined),
    waitForLoad: vi.fn(async () => undefined),
    waitForPaintingStable: vi.fn(async () => undefined),
    waitForElement: vi.fn(async () => undefined),
    get url() {
      return Promise.resolve("https://example.com");
    },
    activeTab: Promise.resolve(tab),
    document: {
      title: Promise.resolve("Example"),
      documentElement: {
        outerHTML: Promise.resolve(html),
      },
      querySelector: vi.fn(async () => null),
    },
  } as any;
}

describe("HeroEngine - flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockDetectChallenge.mockReset();
    mockHandleChallenge.mockReset();
    mockSimulateBehavior.mockClear();
    mockWaitForNetworkIdle.mockClear();
    mockScrollToBottom.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs behavior simulation and page interaction when enabled", async () => {
    const { heroEngine } = await import("../../engines/hero/index.js");

    mockDetectChallenge.mockResolvedValue({
      isChallenge: false,
      type: "none",
      confidence: 0,
      signals: [],
    });
    mockHandleChallenge.mockResolvedValue({
      resolved: true,
      method: "signals_cleared",
      waitedMs: 0,
    });

    const html = `<html><body>${"Hello world ".repeat(50)}</body></html>`;
    const hero = createMockHero(html);
    const pool = {
      withBrowser: vi.fn(async (cb: any) => cb(hero)),
    };

    const p = heroEngine.scrape({
      url: "https://example.com",
      options: {
        urls: ["https://example.com"],
        pool: pool as any,
        behaviorSimulation: true,
        pageInteraction: true,
      },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    // HeroEngine includes a small post-load buffer (2s) via setTimeout.
    await vi.advanceTimersByTimeAsync(3000);

    const result = await p;

    expect(result.engine).toBe("hero");
    expect(mockSimulateBehavior).toHaveBeenCalledTimes(1);
    expect(mockWaitForNetworkIdle).toHaveBeenCalledTimes(1);
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("delegates challenge resolution to cloudflare handleChallenge and passes captcha configs", async () => {
    const { heroEngine } = await import("../../engines/hero/index.js");

    mockDetectChallenge.mockResolvedValue({
      isChallenge: true,
      type: "js_challenge",
      confidence: 100,
      signals: ["Challenge element"],
    });

    mockHandleChallenge.mockResolvedValue({
      resolved: true,
      method: "signals_cleared",
      waitedMs: 123,
    });

    const html = `<html><body>${"Hello world ".repeat(50)}</body></html>`;
    const hero = createMockHero(html);
    const pool = {
      withBrowser: vi.fn(async (cb: any) => cb(hero)),
    };

    const p = heroEngine.scrape({
      url: "https://example.com",
      options: {
        urls: ["https://example.com"],
        pool: pool as any,
        captcha: { primary: "capsolver", providers: { capsolver: { apiKey: "x" } } },
        captchaFallback: { primary: "2captcha", providers: { "2captcha": { apiKey: "y" } } },
      },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    await vi.advanceTimersByTimeAsync(3000);
    await p;

    expect(mockHandleChallenge).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        captcha: expect.any(Object),
        captchaFallback: expect.any(Object),
        maxWaitMs: 45000,
        pollIntervalMs: 500,
      })
    );
  });
});
