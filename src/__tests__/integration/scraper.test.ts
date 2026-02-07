import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// ---------------------------------------------------------------------------
// Mock the EngineOrchestrator at module level
// ---------------------------------------------------------------------------

const mockOrchestratorScrape = vi.fn();

vi.mock("../../engines/index.js", () => {
  class MockEngineOrchestrator {
    constructor() {}
    scrape(...args: any[]) {
      return mockOrchestratorScrape(...args);
    }
  }
  class AllEnginesFailedError extends Error {
    attemptedEngines: string[];
    errors: Map<string, Error>;
    constructor(engines: string[], errors: Map<string, Error>) {
      super("All engines failed");
      this.name = "AllEnginesFailedError";
      this.attemptedEngines = engines;
      this.errors = errors;
    }
  }
  return {
    EngineOrchestrator: MockEngineOrchestrator,
    AllEnginesFailedError,
  };
});

import { Scraper, scrape } from "../../scraper.js";
import type { ScrapeResult } from "../../types.js";

// ---------------------------------------------------------------------------
// Mock global.fetch for robots.txt
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

beforeEach(() => {
  mockOrchestratorScrape.mockReset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal HTML that the engine orchestrator would return */
const SIMPLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Test Page</title><meta name="description" content="A test page"></head>
<body><main><h1>Hello World</h1><p>Content here.</p></main></body>
</html>`;

function mockEngineSuccess(html: string = SIMPLE_HTML, url?: string) {
  mockOrchestratorScrape.mockResolvedValue({
    html,
    url: url ?? "https://example.com",
    engine: "http",
    duration: 150,
    attemptedEngines: ["http"],
  });
}

function mockEngineFailure(message: string = "Network error") {
  mockOrchestratorScrape.mockRejectedValue(new Error(message));
}

function mockFetchRobots(body: string, ok: boolean = true) {
  globalThis.fetch = vi.fn(async (input: any) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/robots.txt")) {
      return {
        ok,
        text: async () => body,
      } as Response;
    }
    return { ok: false, text: async () => "" } as Response;
  }) as any;
}

// ---------------------------------------------------------------------------
// Single URL scraping
// ---------------------------------------------------------------------------

describe("Scraper – single URL", () => {
  it("scrapes a single URL successfully", async () => {
    mockFetchRobots("User-agent: *\nAllow: /", true);
    mockEngineSuccess();

    const result = await scrape({
      urls: ["https://example.com"],
      formats: ["markdown"],
    });

    expect(result.data).toHaveLength(1);
    expect(result.batchMetadata.totalUrls).toBe(1);
    expect(result.batchMetadata.successfulUrls).toBe(1);
    expect(result.batchMetadata.failedUrls).toBe(0);
    expect(result.data[0].markdown).toBeDefined();
    expect(typeof result.data[0].markdown).toBe("string");
  });

  it("returns html format when requested", async () => {
    mockFetchRobots("User-agent: *\nAllow: /", true);
    mockEngineSuccess();

    const result = await scrape({
      urls: ["https://example.com"],
      formats: ["html"],
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].html).toBeDefined();
    expect(typeof result.data[0].html).toBe("string");
    // markdown should not be present when only html requested
    expect(result.data[0].markdown).toBeUndefined();
  });

  it("returns both markdown and html when both requested", async () => {
    mockFetchRobots("User-agent: *\nAllow: /", true);
    mockEngineSuccess();

    const result = await scrape({
      urls: ["https://example.com"],
      formats: ["markdown", "html"],
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].markdown).toBeDefined();
    expect(result.data[0].html).toBeDefined();
  });

  it("includes metadata in the result", async () => {
    mockFetchRobots("User-agent: *\nAllow: /", true);
    mockEngineSuccess();

    const result = await scrape({
      urls: ["https://example.com"],
      formats: ["markdown"],
    });

    const meta = result.data[0].metadata;
    expect(meta.baseUrl).toBe("https://example.com");
    expect(meta.totalPages).toBe(1);
    expect(meta.scrapedAt).toBeDefined();
    expect(meta.duration).toBeGreaterThanOrEqual(0);
    expect(meta.website).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Robots.txt handling
// ---------------------------------------------------------------------------

describe("Scraper – robots.txt", () => {
  it("skips robots.txt check when respectRobots is false", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      text: async () => "User-agent: *\nDisallow: /",
    })) as any;
    globalThis.fetch = fetchSpy;

    mockEngineSuccess();

    const result = await scrape({
      urls: ["https://example.com/page"],
      formats: ["markdown"],
      respectRobots: false,
    });

    // Should succeed even though robots.txt disallows everything
    expect(result.data).toHaveLength(1);
    expect(result.batchMetadata.successfulUrls).toBe(1);
    // fetch for robots.txt should NOT have been called
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("checks robots.txt by default (respectRobots: true)", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      text: async () => "User-agent: *\nAllow: /",
    })) as any;
    globalThis.fetch = fetchSpy;

    mockEngineSuccess();

    const result = await scrape({
      urls: ["https://example.com/page"],
      formats: ["markdown"],
      // respectRobots defaults to true
    });

    expect(result.data).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("returns error when URL is blocked by robots.txt", async () => {
    mockFetchRobots("User-agent: *\nDisallow: /blocked", true);
    mockEngineSuccess();

    const result = await scrape({
      urls: ["https://example.com/blocked/page"],
      formats: ["markdown"],
      respectRobots: true,
      maxRetries: 0,
    });

    // Should fail because robots.txt blocks /blocked
    expect(result.batchMetadata.failedUrls).toBe(1);
    expect(result.batchMetadata.successfulUrls).toBe(0);
    expect(result.batchMetadata.errors).toBeDefined();
    expect(result.batchMetadata.errors!.length).toBeGreaterThan(0);
    expect(result.batchMetadata.errors![0].error).toContain("robots.txt");
  });
});

// ---------------------------------------------------------------------------
// Batch scraping
// ---------------------------------------------------------------------------

describe("Scraper – batch scraping", () => {
  it("scrapes multiple URLs", async () => {
    mockFetchRobots("User-agent: *\nAllow: /", true);

    mockOrchestratorScrape
      .mockResolvedValueOnce({
        html: SIMPLE_HTML,
        url: "https://example.com/a",
        engine: "http",
        duration: 100,
        attemptedEngines: ["http"],
      })
      .mockResolvedValueOnce({
        html: SIMPLE_HTML,
        url: "https://example.com/b",
        engine: "http",
        duration: 120,
        attemptedEngines: ["http"],
      });

    const result = await scrape({
      urls: ["https://example.com/a", "https://example.com/b"],
      formats: ["markdown"],
    });

    expect(result.data).toHaveLength(2);
    expect(result.batchMetadata.totalUrls).toBe(2);
    expect(result.batchMetadata.successfulUrls).toBe(2);
  });

  it("reports partial success when some URLs fail", async () => {
    mockFetchRobots("User-agent: *\nAllow: /", true);

    mockOrchestratorScrape
      .mockResolvedValueOnce({
        html: SIMPLE_HTML,
        url: "https://example.com/good",
        engine: "http",
        duration: 100,
        attemptedEngines: ["http"],
      })
      .mockRejectedValueOnce(new Error("Connection refused"));

    const result = await scrape({
      urls: ["https://example.com/good", "https://example.com/bad"],
      formats: ["markdown"],
      maxRetries: 0,
    });

    expect(result.batchMetadata.totalUrls).toBe(2);
    expect(result.batchMetadata.successfulUrls).toBe(1);
    expect(result.batchMetadata.failedUrls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------

describe("Scraper – retry logic", () => {
  it("retries with exponential backoff on failure", async () => {
    vi.useFakeTimers();

    mockFetchRobots("User-agent: *\nAllow: /", true);

    // Fail twice, succeed on third attempt
    mockOrchestratorScrape
      .mockRejectedValueOnce(new Error("Temporary failure"))
      .mockRejectedValueOnce(new Error("Temporary failure"))
      .mockResolvedValueOnce({
        html: SIMPLE_HTML,
        url: "https://example.com",
        engine: "http",
        duration: 100,
        attemptedEngines: ["http"],
      });

    const promise = scrape({
      urls: ["https://example.com"],
      formats: ["markdown"],
      maxRetries: 2,
    });

    // First attempt fails immediately → backoff 1000ms
    await vi.advanceTimersByTimeAsync(1100);
    // Second attempt fails → backoff 2000ms
    await vi.advanceTimersByTimeAsync(2100);
    // Third attempt succeeds
    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;

    expect(result.data).toHaveLength(1);
    expect(result.batchMetadata.successfulUrls).toBe(1);
    expect(mockOrchestratorScrape).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it("maxRetries: 0 disables retries (fixed: uses ?? instead of ||)", async () => {
    // BUG FIX: scraper.ts now uses `this.options.maxRetries ?? 2`
    // so maxRetries: 0 correctly means zero retries (1 attempt total).
    mockFetchRobots("User-agent: *\nAllow: /", true);
    mockEngineFailure("Permanent failure");

    const result = await scrape({
      urls: ["https://example.com"],
      formats: ["markdown"],
      maxRetries: 0,
    });

    expect(result.batchMetadata.failedUrls).toBe(1);
    // 0 retries → 1 total attempt
    expect(mockOrchestratorScrape).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

describe("Scraper – concurrency", () => {
  it("batchConcurrency controls parallel execution", async () => {
    mockFetchRobots("User-agent: *\nAllow: /", true);

    let concurrent = 0;
    let maxConcurrent = 0;

    mockOrchestratorScrape.mockImplementation(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 50));
      concurrent--;
      return {
        html: SIMPLE_HTML,
        url: "https://example.com",
        engine: "http",
        duration: 50,
        attemptedEngines: ["http"],
      };
    });

    await scrape({
      urls: [
        "https://example.com/1",
        "https://example.com/2",
        "https://example.com/3",
        "https://example.com/4",
      ],
      formats: ["markdown"],
      batchConcurrency: 2,
      maxRetries: 0,
    });

    // Should never exceed batchConcurrency
    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(maxConcurrent).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Batch timeout
// ---------------------------------------------------------------------------

describe("Scraper – batch timeout", () => {
  it("batchTimeoutMs triggers timeout for entire batch", async () => {
    mockFetchRobots("User-agent: *\nAllow: /", true);

    // Engine takes very long
    mockOrchestratorScrape.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 60000))
    );

    await expect(
      scrape({
        urls: ["https://example.com"],
        formats: ["markdown"],
        batchTimeoutMs: 100,
        maxRetries: 0,
      })
    ).rejects.toThrow(/timed out/i);
  });
});

// ---------------------------------------------------------------------------
// Progress callback
// ---------------------------------------------------------------------------

describe("Scraper – progress callback", () => {
  it("calls onProgress for each URL on success", async () => {
    mockFetchRobots("User-agent: *\nAllow: /", true);

    mockOrchestratorScrape.mockResolvedValue({
      html: SIMPLE_HTML,
      url: "https://example.com",
      engine: "http",
      duration: 100,
      attemptedEngines: ["http"],
    });

    const progressCalls: Array<{ completed: number; total: number; currentUrl: string }> = [];

    await scrape({
      urls: ["https://example.com/a", "https://example.com/b"],
      formats: ["markdown"],
      maxRetries: 0,
      onProgress: (p) => progressCalls.push({ ...p }),
    });

    expect(progressCalls).toHaveLength(2);
    expect(progressCalls[0].completed).toBe(1);
    expect(progressCalls[0].total).toBe(2);
    expect(progressCalls[1].completed).toBe(2);
    expect(progressCalls[1].total).toBe(2);
  });

  it("calls onProgress even when a URL fails", async () => {
    mockFetchRobots("User-agent: *\nAllow: /", true);

    // Only reject once then resolve to null internally (scrapeSingleUrl catches and returns null)
    mockOrchestratorScrape.mockRejectedValue(new Error("fail"));

    const progressCalls: Array<{ completed: number; total: number; currentUrl: string }> = [];

    await scrape({
      urls: ["https://example.com/fail"],
      formats: ["markdown"],
      maxRetries: 1,
      onProgress: (p) => progressCalls.push({ ...p }),
    });

    // onProgress is called from scrapeSingleUrl on each attempt (including retries).
    // With maxRetries=1, there are 2 attempts, and each calls onProgress via the catch path.
    expect(progressCalls.length).toBe(2);
    // All progress calls should report completed: 1 and total: 1
    for (const call of progressCalls) {
      expect(call.completed).toBe(1);
      expect(call.total).toBe(1);
      expect(call.currentUrl).toBe("https://example.com/fail");
    }
  });
});

// ---------------------------------------------------------------------------
// Scraper class direct usage
// ---------------------------------------------------------------------------

describe("Scraper class", () => {
  it("can be instantiated and used directly", async () => {
    mockFetchRobots("User-agent: *\nAllow: /", true);
    mockEngineSuccess();

    const scraper = new Scraper({
      urls: ["https://example.com"],
      formats: ["markdown"],
    });

    const result = await scraper.scrape();

    expect(result.data).toHaveLength(1);
    expect(result.batchMetadata).toBeDefined();
    expect(result.batchMetadata.totalDuration).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// scrape() convenience function
// ---------------------------------------------------------------------------

describe("scrape() convenience function", () => {
  it("delegates to Scraper class", async () => {
    mockFetchRobots("User-agent: *\nAllow: /", true);
    mockEngineSuccess();

    const result = await scrape({
      urls: ["https://example.com"],
      formats: ["markdown"],
    });

    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("batchMetadata");
  });
});
