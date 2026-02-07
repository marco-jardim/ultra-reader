import { describe, it, expect } from "vitest";
import { DEFAULT_OPTIONS, isValidFormat, shouldCrawlUrl } from "../types.js";

// ---------------------------------------------------------------------------
// DEFAULT_OPTIONS
// ---------------------------------------------------------------------------

describe("DEFAULT_OPTIONS", () => {
  it("has correct format defaults", () => {
    expect(DEFAULT_OPTIONS.formats).toEqual(["markdown"]);
  });

  it("has correct timeout defaults", () => {
    expect(DEFAULT_OPTIONS.timeoutMs).toBe(30000);
    expect(DEFAULT_OPTIONS.batchTimeoutMs).toBe(300000);
  });

  it("has correct batch defaults", () => {
    expect(DEFAULT_OPTIONS.batchConcurrency).toBe(1);
    expect(DEFAULT_OPTIONS.maxRetries).toBe(2);
  });

  it("has correct content cleaning defaults", () => {
    expect(DEFAULT_OPTIONS.removeAds).toBe(true);
    expect(DEFAULT_OPTIONS.removeBase64Images).toBe(true);
    expect(DEFAULT_OPTIONS.onlyMainContent).toBe(true);
    expect(DEFAULT_OPTIONS.skipTLSVerification).toBe(true);
  });

  it("has correct anti-detection defaults", () => {
    expect(DEFAULT_OPTIONS.respectRobots).toBe(true);
    expect(DEFAULT_OPTIONS.spoofReferer).toBe(true);
  });

  it("has empty arrays for patterns and tags", () => {
    expect(DEFAULT_OPTIONS.urls).toEqual([]);
    expect(DEFAULT_OPTIONS.includePatterns).toEqual([]);
    expect(DEFAULT_OPTIONS.excludePatterns).toEqual([]);
    expect(DEFAULT_OPTIONS.includeTags).toEqual([]);
    expect(DEFAULT_OPTIONS.excludeTags).toEqual([]);
  });

  it("has Hero-specific defaults", () => {
    expect(DEFAULT_OPTIONS.verbose).toBe(false);
    expect(DEFAULT_OPTIONS.showChrome).toBe(false);
  });

  it("has a no-op onProgress callback", () => {
    expect(typeof DEFAULT_OPTIONS.onProgress).toBe("function");
    // Calling it should not throw
    expect(() =>
      DEFAULT_OPTIONS.onProgress({ completed: 1, total: 2, currentUrl: "https://x.com" })
    ).not.toThrow();
  });

  it("has optional fields as undefined by default", () => {
    expect(DEFAULT_OPTIONS.proxy).toBeUndefined();
    expect(DEFAULT_OPTIONS.waitForSelector).toBeUndefined();
    expect(DEFAULT_OPTIONS.connectionToCore).toBeUndefined();
    expect(DEFAULT_OPTIONS.userAgent).toBeUndefined();
    expect(DEFAULT_OPTIONS.headers).toBeUndefined();
    expect(DEFAULT_OPTIONS.browserPool).toBeUndefined();
    expect(DEFAULT_OPTIONS.pool).toBeUndefined();
    expect(DEFAULT_OPTIONS.engines).toBeUndefined();
    expect(DEFAULT_OPTIONS.skipEngines).toBeUndefined();
    expect(DEFAULT_OPTIONS.forceEngine).toBeUndefined();
    expect(DEFAULT_OPTIONS.uaRotation).toBeUndefined();
    expect(DEFAULT_OPTIONS.stickyUaPerDomain).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isValidFormat
// ---------------------------------------------------------------------------

describe("isValidFormat", () => {
  it('returns true for "markdown"', () => {
    expect(isValidFormat("markdown")).toBe(true);
  });

  it('returns true for "html"', () => {
    expect(isValidFormat("html")).toBe(true);
  });

  it('returns false for "json"', () => {
    expect(isValidFormat("json")).toBe(false);
  });

  it('returns false for "text"', () => {
    expect(isValidFormat("text")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidFormat("")).toBe(false);
  });

  it("returns false for arbitrary strings", () => {
    expect(isValidFormat("pdf")).toBe(false);
    expect(isValidFormat("xml")).toBe(false);
    expect(isValidFormat("Markdown")).toBe(false); // case-sensitive
    expect(isValidFormat("HTML")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldCrawlUrl
// ---------------------------------------------------------------------------

describe("shouldCrawlUrl", () => {
  it("returns true for exact same domain", () => {
    const url = new URL("https://example.com/page");
    expect(shouldCrawlUrl(url, "example.com")).toBe(true);
  });

  it("returns true for subdomain of base domain", () => {
    const url = new URL("https://blog.example.com/post/1");
    expect(shouldCrawlUrl(url, "example.com")).toBe(true);
  });

  it("returns true for deep subdomain", () => {
    const url = new URL("https://a.b.c.example.com/");
    expect(shouldCrawlUrl(url, "example.com")).toBe(true);
  });

  it("returns false for completely different domain", () => {
    const url = new URL("https://other.com/page");
    expect(shouldCrawlUrl(url, "example.com")).toBe(false);
  });

  it("returns false for domain that contains base domain as substring but is different", () => {
    // "notexample.com" ends with "example.com" but is NOT ".example.com"
    const url = new URL("https://notexample.com/page");
    expect(shouldCrawlUrl(url, "example.com")).toBe(false);
  });

  it("handles www subdomain", () => {
    const url = new URL("https://www.example.com/page");
    expect(shouldCrawlUrl(url, "example.com")).toBe(true);
  });

  it("handles URLs with ports", () => {
    const url = new URL("https://example.com:8080/page");
    // hostname does not include port
    expect(shouldCrawlUrl(url, "example.com")).toBe(true);
  });

  it("handles URLs with authentication", () => {
    const url = new URL("https://user:pass@example.com/page");
    expect(shouldCrawlUrl(url, "example.com")).toBe(true);
  });

  it("returns false when base domain is subdomain of URL domain", () => {
    // base is "sub.example.com", URL is "example.com" → should NOT match
    const url = new URL("https://example.com/page");
    expect(shouldCrawlUrl(url, "sub.example.com")).toBe(false);
  });
});
