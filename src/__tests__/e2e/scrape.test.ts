import { describe, it, expect, vi } from "vitest";

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

import { scrape } from "../../scraper.js";

// ---------------------------------------------------------------------------
// E2E tests – gated behind RUN_E2E=true environment variable
// ---------------------------------------------------------------------------

const RUN_E2E = process.env.RUN_E2E === "true";

describe.skipIf(!RUN_E2E)("E2E: Real URL Scraping", () => {
  it("scrapes a simple HTML page", { timeout: 30000 }, async () => {
    const result = await scrape({
      urls: ["https://example.com"],
      formats: ["markdown"],
      respectRobots: false,
      maxRetries: 1,
      engines: ["http"],
    });

    expect(result.data).toHaveLength(1);
    expect(result.batchMetadata.successfulUrls).toBe(1);
    expect(result.batchMetadata.failedUrls).toBe(0);

    const page = result.data[0];
    expect(page.markdown).toBeDefined();
    expect(page.markdown!.length).toBeGreaterThan(0);
    // example.com contains "Example Domain"
    expect(page.markdown).toContain("Example Domain");
  });

  it("scrapes and returns markdown format", { timeout: 30000 }, async () => {
    const result = await scrape({
      urls: ["https://httpbin.org/html"],
      formats: ["markdown"],
      respectRobots: false,
      maxRetries: 1,
      engines: ["http"],
    });

    expect(result.data).toHaveLength(1);
    const page = result.data[0];
    expect(page.markdown).toBeDefined();
    expect(typeof page.markdown).toBe("string");
    expect(page.markdown!.length).toBeGreaterThan(50);
    // httpbin /html returns Herman Melville content
    expect(page.markdown).toContain("Herman Melville");
  });

  it("scrapes and returns html format", { timeout: 30000 }, async () => {
    const result = await scrape({
      urls: ["https://example.com"],
      formats: ["html"],
      respectRobots: false,
      maxRetries: 1,
      engines: ["http"],
    });

    expect(result.data).toHaveLength(1);
    const page = result.data[0];
    expect(page.html).toBeDefined();
    expect(page.html).toContain("Example Domain");
    // markdown should NOT be present
    expect(page.markdown).toBeUndefined();
  });

  it("handles 404 pages gracefully", { timeout: 30000 }, async () => {
    const result = await scrape({
      urls: ["https://httpbin.org/status/404"],
      formats: ["markdown"],
      respectRobots: false,
      maxRetries: 0,
      engines: ["http"],
    });

    // Either a failure in batchMetadata or an empty/errored result
    const totalFailed = result.batchMetadata.failedUrls;
    const totalSuccess = result.batchMetadata.successfulUrls;
    // The engine may fail on 404 or return empty content – either way is graceful
    expect(totalFailed + totalSuccess).toBe(1);
  });

  it("respects timeout", { timeout: 30000 }, async () => {
    // Use an extremely short timeout to ensure it triggers
    const result = await scrape({
      urls: ["https://httpbin.org/delay/10"],
      formats: ["markdown"],
      respectRobots: false,
      maxRetries: 0,
      timeoutMs: 2000,
      engines: ["http"],
    });

    // Should fail due to timeout
    expect(result.batchMetadata.failedUrls).toBe(1);
  });

  it("batch scrapes multiple URLs", { timeout: 30000 }, async () => {
    const result = await scrape({
      urls: ["https://example.com", "https://httpbin.org/html"],
      formats: ["markdown"],
      respectRobots: false,
      batchConcurrency: 2,
      maxRetries: 1,
      engines: ["http"],
    });

    expect(result.batchMetadata.totalUrls).toBe(2);
    expect(result.batchMetadata.successfulUrls).toBe(2);
    expect(result.data).toHaveLength(2);

    // Both should have markdown content
    for (const page of result.data) {
      expect(page.markdown).toBeDefined();
      expect(page.markdown!.length).toBeGreaterThan(0);
    }
  });
});
