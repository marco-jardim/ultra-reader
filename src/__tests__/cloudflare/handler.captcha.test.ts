import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChallengeDetection } from "../../cloudflare/types.js";

vi.mock("../../cloudflare/detector.js", () => ({
  detectChallenge: vi.fn(),
}));

vi.mock("../../captcha/solver-with-fallback.js", () => ({
  createCaptchaSolverWithFallback: vi.fn(),
}));

import { detectChallenge } from "../../cloudflare/detector.js";
import { createCaptchaSolverWithFallback } from "../../captcha/solver-with-fallback.js";

const mockDetectChallenge = vi.mocked(detectChallenge);
const mockCreateSolver = vi.mocked(createCaptchaSolverWithFallback);

function challengeDetection(isChallenge: boolean, type: ChallengeDetection["type"] = "none") {
  return {
    isChallenge,
    type,
    confidence: isChallenge ? 100 : 0,
    signals: [],
  } satisfies ChallengeDetection;
}

function createMockHero(
  opts: {
    urlSequence?: string[];
    html?: string;
  } = {}
) {
  const { urlSequence = ["https://example.com"], html = "<html></html>" } = opts;
  let urlIndex = 0;

  const tab = {
    evaluate: vi.fn(async () => ({ setCount: 1, submitted: true })),
  };

  return {
    get url() {
      const url = urlSequence[Math.min(urlIndex, urlSequence.length - 1)];
      urlIndex++;
      return Promise.resolve(url);
    },
    activeTab: Promise.resolve(tab),
    document: {
      documentElement: {
        outerHTML: Promise.resolve(html),
      },
      querySelector: vi.fn(async () => null),
    },
    waitForLoad: vi.fn(async () => {}),
    waitForPaintingStable: vi.fn(async () => {}),
  } as any;
}

describe("handleChallenge - captcha", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockDetectChallenge.mockReset();
    mockCreateSolver.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("attempts CAPTCHA solve when a Turnstile sitekey is detected and config is present", async () => {
    const { handleChallenge } = await import("../../cloudflare/handler.js");

    const hero = createMockHero({
      urlSequence: ["https://example.com/__cf_chl"],
      html: `
        <html>
          <head><script src="/cdn-cgi/challenge-platform"></script></head>
          <body>
            <div class="cf-turnstile" data-sitekey="0x4AAAAAAABBBBBB"></div>
          </body>
        </html>
      `,
    });

    // First detect: challenge. Second poll: cleared.
    mockDetectChallenge
      .mockResolvedValueOnce(challengeDetection(true, "js_challenge"))
      .mockResolvedValueOnce(challengeDetection(false));

    const solve = vi.fn(async () => ({ provider: "capsolver" as const, token: "tok" }));
    mockCreateSolver.mockReturnValue({ id: "capsolver", solve } as any);

    const p = handleChallenge(hero, {
      maxWaitMs: 5000,
      pollIntervalMs: 100,
      captcha: {
        primary: "capsolver",
        providers: { capsolver: { apiKey: "x" } },
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    const result = await p;
    expect(result.resolved).toBe(true);

    expect(mockCreateSolver).toHaveBeenCalledTimes(1);
    expect(solve).toHaveBeenCalledWith({
      captchaType: "turnstile",
      pageUrl: "https://example.com/__cf_chl",
      siteKey: "0x4AAAAAAABBBBBB",
    });

    const tab = await hero.activeTab;
    expect(tab.evaluate).toHaveBeenCalledTimes(1);
  });
});
