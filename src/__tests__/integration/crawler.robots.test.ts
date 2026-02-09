import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock native re2 module (may not be built in CI/test environments)
// ---------------------------------------------------------------------------

vi.mock("re2", () => {
  return {
    default: class RE2 {
      private re: RegExp;
      constructor(pattern: string | RegExp, flags?: string) {
        this.re = new RegExp(pattern instanceof RegExp ? pattern.source : pattern, flags);
      }
      test(str: string) {
        return this.re.test(str);
      }
      exec(str: string) {
        return this.re.exec(str);
      }
    },
  };
});

vi.mock("../../cloudflare/detector", () => {
  return {
    detectChallenge: vi.fn(async () => ({ isChallenge: false })),
  };
});

vi.mock("../../cloudflare/handler", () => {
  return {
    waitForChallengeResolution: vi.fn(async () => ({ resolved: true })),
  };
});

import { crawl } from "../../crawler.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Crawler - robots.txt", () => {
  it("blocks the seed URL by default when robots.txt disallows it", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      text: async () => "User-agent: *\nDisallow: /",
    })) as any;
    globalThis.fetch = fetchSpy;

    const pool = {
      withBrowser: vi.fn(async () => {
        throw new Error("should not navigate when seed is blocked");
      }),
    };

    const result = await crawl({
      url: "https://example.com/",
      depth: 0,
      maxPages: 1,
      delayMs: 0,
      respectRobots: true,
      pool: pool as any,
    });

    expect(fetchSpy).toHaveBeenCalled();
    expect(pool.withBrowser).not.toHaveBeenCalled();
    expect(result.urls).toHaveLength(0);
  });

  it("skips robots.txt fetch/checks when respectRobots is false", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      text: async () => "User-agent: *\nDisallow: /",
    })) as any;
    globalThis.fetch = fetchSpy;

    const hero = {
      goto: vi.fn(async () => undefined),
      waitForPaintingStable: vi.fn(async () => undefined),
      url: "https://example.com/",
      document: {
        title: "Test",
        documentElement: {
          outerHTML: "<html><head><title>Test</title></head><body></body></html>",
        },
        querySelector: vi.fn(async () => null),
      },
    };

    const pool = {
      withBrowser: vi.fn(async (fn: any) => fn(hero)),
    };

    const result = await crawl({
      url: "https://example.com/",
      depth: 0,
      maxPages: 1,
      delayMs: 0,
      respectRobots: false,
      pool: pool as any,
    });

    // robots.txt should NOT have been fetched
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(pool.withBrowser).toHaveBeenCalledTimes(1);
    expect(result.urls).toHaveLength(1);
    expect(result.urls[0].title).toBe("Test");
  });
});
