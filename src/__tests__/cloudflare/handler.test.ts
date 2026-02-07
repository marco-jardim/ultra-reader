import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  waitForChallengeResolution,
  waitForSelector,
  handleChallenge,
} from "../../cloudflare/handler.js";
import type { ChallengeDetection } from "../../cloudflare/types.js";

// ---------------------------------------------------------------------------
// Mock the detector module
// ---------------------------------------------------------------------------

vi.mock("../../cloudflare/detector.js", () => ({
  detectChallenge: vi.fn(),
}));

// Import after mock declaration so vitest wires it up
import { detectChallenge } from "../../cloudflare/detector.js";
const mockDetectChallenge = vi.mocked(detectChallenge);

// ---------------------------------------------------------------------------
// Hero mock factory
// ---------------------------------------------------------------------------

function createMockHero(
  opts: {
    urlSequence?: string[];
    querySelector?: (sel: string) => Promise<unknown>;
  } = {}
) {
  const { urlSequence = ["https://example.com"], querySelector } = opts;
  let urlIndex = 0;

  return {
    get url() {
      const url = urlSequence[Math.min(urlIndex, urlSequence.length - 1)];
      urlIndex++;
      return Promise.resolve(url);
    },
    document: {
      querySelector: querySelector ?? vi.fn(async () => null),
    },
    waitForLoad: vi.fn(async () => {}),
    waitForPaintingStable: vi.fn(async () => {}),
  } as any;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function challengeDetection(
  isChallenge: boolean,
  type: ChallengeDetection["type"] = "none"
): ChallengeDetection {
  return {
    isChallenge,
    type,
    confidence: isChallenge ? 100 : 0,
    signals: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("waitForChallengeResolution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockDetectChallenge.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves via url_redirect when URL changes during poll", async () => {
    const hero = createMockHero({
      // First read: same as initialUrl (no change yet)
      // Second read (after one poll): different URL (redirect happened)
      urlSequence: ["https://example.com/__cf_challenge", "https://example.com/page"],
    });

    // First iteration: URL hasn't changed yet, detectChallenge says still challenge
    mockDetectChallenge.mockResolvedValue(challengeDetection(true, "js_challenge"));

    const promise = waitForChallengeResolution(hero, {
      initialUrl: "https://example.com/__cf_challenge",
      maxWaitMs: 10000,
      pollIntervalMs: 100,
    });

    // First iteration: URL matches initialUrl → falls through to detectChallenge → still challenge → polls
    await vi.advanceTimersByTimeAsync(0);
    // Advance past the pollIntervalMs (100ms) setTimeout
    await vi.advanceTimersByTimeAsync(100);
    // Second iteration: URL changed → url_redirect detected
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;

    expect(result.resolved).toBe(true);
    expect(result.method).toBe("url_redirect");
  });

  it("resolves via signals_cleared when challenge disappears", async () => {
    const hero = createMockHero({
      urlSequence: ["https://example.com"], // URL stays the same
    });

    // First call: still a challenge. Second call: cleared.
    mockDetectChallenge
      .mockResolvedValueOnce(challengeDetection(true, "js_challenge"))
      .mockResolvedValueOnce(challengeDetection(false));

    const promise = waitForChallengeResolution(hero, {
      initialUrl: "https://example.com",
      maxWaitMs: 10000,
      pollIntervalMs: 200,
    });

    // First iteration: challenge still present → waits pollInterval
    await vi.advanceTimersByTimeAsync(0);
    // Advance past the setTimeout(200) in the poll loop
    await vi.advanceTimersByTimeAsync(200);
    // Second iteration: challenge cleared
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;

    expect(result.resolved).toBe(true);
    expect(result.method).toBe("signals_cleared");
  });

  it("returns timeout when maxWaitMs is exceeded", async () => {
    const hero = createMockHero({
      urlSequence: ["https://example.com"],
    });

    // Challenge never clears
    mockDetectChallenge.mockResolvedValue(challengeDetection(true, "js_challenge"));

    const promise = waitForChallengeResolution(hero, {
      initialUrl: "https://example.com",
      maxWaitMs: 1000,
      pollIntervalMs: 200,
    });

    // Advance well past maxWaitMs
    await vi.advanceTimersByTimeAsync(1500);

    const result = await promise;

    expect(result.resolved).toBe(false);
    expect(result.method).toBe("timeout");
    expect(result.waitedMs).toBeGreaterThanOrEqual(1000);
  });
});

// ---------------------------------------------------------------------------
// waitForSelector
// ---------------------------------------------------------------------------

describe("waitForSelector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns found immediately when element exists", async () => {
    const hero = createMockHero({
      querySelector: vi.fn(async () => ({ tagName: "DIV" })),
    });

    const promise = waitForSelector(hero, ".content", 5000);
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;

    expect(result.found).toBe(true);
    expect(result.waitedMs).toBeLessThan(500);
  });

  it("returns not found when element never appears within timeout", async () => {
    const hero = createMockHero({
      querySelector: vi.fn(async () => null),
    });

    const promise = waitForSelector(hero, ".nonexistent", 1000);

    // Advance past the timeout
    await vi.advanceTimersByTimeAsync(1500);

    const result = await promise;

    expect(result.found).toBe(false);
    expect(result.waitedMs).toBeGreaterThanOrEqual(1000);
  });

  it("finds element after a few polls", async () => {
    let callCount = 0;
    const hero = createMockHero({
      querySelector: vi.fn(async () => {
        callCount++;
        // Found on 3rd call
        return callCount >= 3 ? { tagName: "DIV" } : null;
      }),
    });

    const promise = waitForSelector(hero, ".delayed", 5000);

    // First poll: not found → wait 300ms
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(300);
    // Second poll: not found → wait 300ms
    await vi.advanceTimersByTimeAsync(300);
    // Third poll: found
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;

    expect(result.found).toBe(true);
  });

  it("handles querySelector throwing without crashing", async () => {
    let callCount = 0;
    const hero = createMockHero({
      querySelector: vi.fn(async () => {
        callCount++;
        if (callCount <= 2) throw new Error("DOM not ready");
        return { tagName: "DIV" };
      }),
    });

    const promise = waitForSelector(hero, ".flaky", 5000);

    // Advance through throws + successful find
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;

    expect(result.found).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleChallenge
// ---------------------------------------------------------------------------

describe("handleChallenge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockDetectChallenge.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns resolved immediately when no challenge is detected", async () => {
    mockDetectChallenge.mockResolvedValue(challengeDetection(false));

    const hero = createMockHero({
      urlSequence: ["https://example.com"],
    });

    const promise = handleChallenge(hero);
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;

    expect(result.resolved).toBe(true);
    expect(result.method).toBe("signals_cleared");
    expect(result.waitedMs).toBe(0);
  });

  it("delegates to waitForChallengeResolution when challenge is detected", async () => {
    // First call (from handleChallenge detection): challenge detected
    // Second call (from waitForChallengeResolution poll loop): challenge cleared
    mockDetectChallenge
      .mockResolvedValueOnce(challengeDetection(true, "js_challenge"))
      .mockResolvedValueOnce(challengeDetection(false));

    const hero = createMockHero({
      urlSequence: ["https://example.com"],
    });

    const promise = handleChallenge(hero, {
      maxWaitMs: 5000,
      pollIntervalMs: 100,
    });

    // Let the async chain execute
    await vi.advanceTimersByTimeAsync(0);
    // Allow the poll interval to pass
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;

    expect(result.resolved).toBe(true);
    expect(result.method).toBe("signals_cleared");
    // detectChallenge called at least twice: once for detection, once for polling
    expect(mockDetectChallenge).toHaveBeenCalledTimes(2);
  });

  it("passes options through to waitForChallengeResolution", async () => {
    // Challenge never clears → timeout
    mockDetectChallenge.mockResolvedValue(challengeDetection(true, "js_challenge"));

    const hero = createMockHero({
      urlSequence: ["https://example.com"],
    });

    const promise = handleChallenge(hero, {
      maxWaitMs: 500,
      pollIntervalMs: 100,
    });

    await vi.advanceTimersByTimeAsync(800);

    const result = await promise;

    expect(result.resolved).toBe(false);
    expect(result.method).toBe("timeout");
  });

  it("uses current hero.url as initialUrl for waitForChallengeResolution", async () => {
    mockDetectChallenge
      .mockResolvedValueOnce(challengeDetection(true, "js_challenge"))
      // After URL change, poll detects no challenge
      .mockResolvedValue(challengeDetection(false));

    const hero = createMockHero({
      urlSequence: [
        "https://example.com/cf-challenge",
        "https://example.com/cf-challenge",
        "https://example.com/actual-page", // URL changes on 3rd read
      ],
    });

    const promise = handleChallenge(hero, {
      maxWaitMs: 5000,
      pollIntervalMs: 100,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;

    expect(result.resolved).toBe(true);
    // Could be url_redirect or signals_cleared depending on which check fires first
    expect(["url_redirect", "signals_cleared"]).toContain(result.method);
  });
});
