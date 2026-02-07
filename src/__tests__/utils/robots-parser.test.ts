import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseRobotsTxt,
  isPathAllowed,
  fetchRobotsTxt,
  isUrlAllowed,
  type RobotsRules,
} from "../../utils/robots-parser.js";

// ---------------------------------------------------------------------------
// parseRobotsTxt
// ---------------------------------------------------------------------------

describe("parseRobotsTxt", () => {
  it("parses simple Disallow rules for wildcard user-agent", () => {
    const content = `
User-agent: *
Disallow: /admin
Disallow: /private/
    `;
    const rules = parseRobotsTxt(content);
    expect(rules.disallowedPaths).toEqual(["/admin", "/private/"]);
    expect(rules.allowedPaths).toEqual([]);
    expect(rules.crawlDelay).toBeNull();
  });

  it("parses Allow + Disallow rules", () => {
    const content = `
User-agent: *
Disallow: /api/
Allow: /api/public
    `;
    const rules = parseRobotsTxt(content);
    expect(rules.disallowedPaths).toContain("/api/");
    expect(rules.allowedPaths).toContain("/api/public");
  });

  it("parses Crawl-delay and converts to milliseconds", () => {
    const content = `
User-agent: *
Crawl-delay: 2.5
Disallow: /slow
    `;
    const rules = parseRobotsTxt(content);
    expect(rules.crawlDelay).toBe(2500);
  });

  it("parses integer Crawl-delay", () => {
    const content = `
User-agent: *
Crawl-delay: 10
    `;
    const rules = parseRobotsTxt(content);
    expect(rules.crawlDelay).toBe(10000);
  });

  it("ignores invalid Crawl-delay value", () => {
    const content = `
User-agent: *
Crawl-delay: abc
    `;
    const rules = parseRobotsTxt(content);
    expect(rules.crawlDelay).toBeNull();
  });

  it("matches specific user-agent (case-insensitive)", () => {
    const content = `
User-agent: Googlebot
Disallow: /google-only

User-agent: ReaderEngine
Disallow: /reader-blocked

User-agent: *
Disallow: /all-blocked
    `;
    const rules = parseRobotsTxt(content, "ReaderEngine");
    // Should match "ReaderEngine" block AND "*" block
    expect(rules.disallowedPaths).toContain("/reader-blocked");
    expect(rules.disallowedPaths).toContain("/all-blocked");
    // Should NOT include Googlebot rules
    expect(rules.disallowedPaths).not.toContain("/google-only");
  });

  it("matches user-agent case-insensitively", () => {
    const content = `
User-agent: READERENGINE
Disallow: /blocked
    `;
    const rules = parseRobotsTxt(content, "ReaderEngine");
    expect(rules.disallowedPaths).toContain("/blocked");
  });

  it("matches wildcard * user-agent by default", () => {
    const content = `
User-agent: *
Disallow: /secret
Allow: /secret/public
    `;
    const rules = parseRobotsTxt(content);
    expect(rules.disallowedPaths).toContain("/secret");
    expect(rules.allowedPaths).toContain("/secret/public");
  });

  it("ignores irrelevant user-agent blocks", () => {
    const content = `
User-agent: Googlebot
Disallow: /google-stuff

User-agent: Bingbot
Disallow: /bing-stuff

User-agent: *
Disallow: /general
    `;
    // Default userAgent = "*"
    const rules = parseRobotsTxt(content);
    expect(rules.disallowedPaths).toEqual(["/general"]);
  });

  it("skips comment lines and empty lines", () => {
    const content = `
# This is a comment
User-agent: *
# Another comment

Disallow: /hidden
    `;
    const rules = parseRobotsTxt(content);
    expect(rules.disallowedPaths).toEqual(["/hidden"]);
  });

  it("skips lines without colon separator", () => {
    const content = `
User-agent: *
Disallow /no-colon
Disallow: /with-colon
    `;
    const rules = parseRobotsTxt(content);
    expect(rules.disallowedPaths).toEqual(["/with-colon"]);
  });

  it("ignores empty Disallow value", () => {
    const content = `
User-agent: *
Disallow:
Disallow: /real
    `;
    const rules = parseRobotsTxt(content);
    expect(rules.disallowedPaths).toEqual(["/real"]);
  });

  it("returns empty rules for empty content", () => {
    const rules = parseRobotsTxt("");
    expect(rules.disallowedPaths).toEqual([]);
    expect(rules.allowedPaths).toEqual([]);
    expect(rules.crawlDelay).toBeNull();
  });

  it("handles Disallow values with inline comments (treats everything after colon as value)", () => {
    // The parser just takes value after ":", so inline text is included
    const content = `
User-agent: *
Disallow: /path
    `;
    const rules = parseRobotsTxt(content);
    expect(rules.disallowedPaths).toContain("/path");
  });
});

// ---------------------------------------------------------------------------
// isPathAllowed
// ---------------------------------------------------------------------------

describe("isPathAllowed", () => {
  it("returns true when no rules match", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/admin"],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isPathAllowed("/about", rules)).toBe(true);
  });

  it("returns false for disallowed path (prefix match)", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/admin"],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isPathAllowed("/admin", rules)).toBe(false);
    expect(isPathAllowed("/admin/settings", rules)).toBe(false);
  });

  it("Allow takes precedence over Disallow", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/api/"],
      allowedPaths: ["/api/public"],
      crawlDelay: null,
    };
    expect(isPathAllowed("/api/public", rules)).toBe(true);
    expect(isPathAllowed("/api/private", rules)).toBe(false);
  });

  it("handles wildcard * patterns", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/search*q="],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isPathAllowed("/search?q=test", rules)).toBe(false);
    expect(isPathAllowed("/search/results?q=hello", rules)).toBe(false);
    expect(isPathAllowed("/about", rules)).toBe(true);
  });

  it("handles $ end anchor", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/*.pdf$"],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isPathAllowed("/document.pdf", rules)).toBe(false);
    expect(isPathAllowed("/document.pdf?v=1", rules)).toBe(true); // doesn't end with .pdf
    expect(isPathAllowed("/page", rules)).toBe(true);
  });

  it("normalises path without leading slash", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/private"],
      allowedPaths: [],
      crawlDelay: null,
    };
    // "private" should be normalised to "/private"
    expect(isPathAllowed("private", rules)).toBe(false);
  });

  it("returns true when both allow and disallow lists are empty", () => {
    const rules: RobotsRules = {
      disallowedPaths: [],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isPathAllowed("/anything", rules)).toBe(true);
  });

  it("disallows root path /", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/"],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isPathAllowed("/", rules)).toBe(false);
    expect(isPathAllowed("/anything", rules)).toBe(false);
  });

  it("allow overrides root disallow for specific paths", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/"],
      allowedPaths: ["/public"],
      crawlDelay: null,
    };
    expect(isPathAllowed("/public", rules)).toBe(true);
    expect(isPathAllowed("/other", rules)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchRobotsTxt
// ---------------------------------------------------------------------------

describe("fetchRobotsTxt", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches /robots.txt and parses for ReaderEngine user-agent", async () => {
    const robotsTxt = `
User-agent: *
Disallow: /private

User-agent: ReaderEngine
Disallow: /reader-blocked
Crawl-delay: 3
    `;

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      text: async () => robotsTxt,
    } as Response);

    const rules = await fetchRobotsTxt("https://example.com");
    expect(rules).not.toBeNull();
    expect(rules!.disallowedPaths).toContain("/private");
    expect(rules!.disallowedPaths).toContain("/reader-blocked");
    expect(rules!.crawlDelay).toBe(3000);
  });

  it("sends the correct User-Agent header", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      text: async () => "User-agent: *\nDisallow:",
    } as Response);

    await fetchRobotsTxt("https://example.com");

    // Since SEC-03 fix, robots.txt fetch now uses a rotated browser UA instead of "ReaderEngine/1.0"
    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(callArgs[0]).toBe("https://example.com/robots.txt");
    const headers = (callArgs[1] as RequestInit).headers as Record<string, string>;
    // Should be a browser-like UA, not the old "ReaderEngine/1.0"
    expect(headers["User-Agent"]).toBeDefined();
    expect(headers["User-Agent"]).not.toBe("ReaderEngine/1.0");
  });

  it("fetches from the correct URL derived from baseUrl", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      text: async () => "",
    } as Response);

    await fetchRobotsTxt("https://sub.example.com/some/path");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://sub.example.com/robots.txt",
      expect.any(Object)
    );
  });

  it("returns null on HTTP error (non-ok response)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const rules = await fetchRobotsTxt("https://example.com");
    expect(rules).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("ECONNREFUSED"));

    const rules = await fetchRobotsTxt("https://example.com");
    expect(rules).toBeNull();
  });

  it("returns null for invalid base URL", async () => {
    const rules = await fetchRobotsTxt("not-a-valid-url");
    expect(rules).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isUrlAllowed
// ---------------------------------------------------------------------------

describe("isUrlAllowed", () => {
  it("returns true when rules is null", () => {
    expect(isUrlAllowed("https://example.com/anything", null)).toBe(true);
  });

  it("extracts path and checks against rules", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/admin"],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isUrlAllowed("https://example.com/admin/panel", rules)).toBe(false);
    expect(isUrlAllowed("https://example.com/public", rules)).toBe(true);
  });

  it("includes query string in path check", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/search*q="],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isUrlAllowed("https://example.com/search?q=test", rules)).toBe(false);
  });

  it("returns true for invalid URL", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/"],
      allowedPaths: [],
      crawlDelay: null,
    };
    expect(isUrlAllowed("not-a-url", rules)).toBe(true);
  });

  it("handles URL with path and search params", () => {
    const rules: RobotsRules = {
      disallowedPaths: ["/api/"],
      allowedPaths: ["/api/v2/public"],
      crawlDelay: null,
    };
    expect(isUrlAllowed("https://example.com/api/v2/public?key=abc", rules)).toBe(true);
    expect(isUrlAllowed("https://example.com/api/v1/private", rules)).toBe(false);
  });
});
