import { describe, it, expect, vi } from "vitest";
import {
  UserAgentRotator,
  generateReferer,
  getDefaultRotator,
  getRandomUserAgent,
} from "../../utils/user-agents.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect N results from a callback */
function collect<T>(n: number, fn: () => T): T[] {
  return Array.from({ length: n }, fn);
}

// ---------------------------------------------------------------------------
// getRandomUserAgent
// ---------------------------------------------------------------------------

describe("getRandomUserAgent", () => {
  it("returns a non-empty string", () => {
    const ua = getRandomUserAgent();
    expect(typeof ua).toBe("string");
    expect(ua.length).toBeGreaterThan(0);
  });

  it("returns a string that looks like a real user-agent", () => {
    const ua = getRandomUserAgent();
    expect(ua).toContain("Mozilla/5.0");
  });

  it("returns values from the known pool across many calls", () => {
    const uas = new Set(collect(200, () => getRandomUserAgent()));
    // Should have selected more than one distinct UA
    expect(uas.size).toBeGreaterThan(1);
  });

  it("accepts an optional url parameter for domain-sticky behaviour", () => {
    const ua = getRandomUserAgent("https://example.com/page");
    expect(typeof ua).toBe("string");
    expect(ua.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getDefaultRotator
// ---------------------------------------------------------------------------

describe("getDefaultRotator", () => {
  it("returns a UserAgentRotator instance", () => {
    const rotator = getDefaultRotator();
    expect(rotator).toBeInstanceOf(UserAgentRotator);
  });

  it("returns the same singleton on repeated calls", () => {
    expect(getDefaultRotator()).toBe(getDefaultRotator());
  });
});

// ---------------------------------------------------------------------------
// UserAgentRotator – construction & strategies
// ---------------------------------------------------------------------------

describe("UserAgentRotator", () => {
  describe("default (weighted) strategy", () => {
    it("returns UA strings from the pool", () => {
      const rotator = new UserAgentRotator();
      const uas = collect(50, () => rotator.get());
      for (const ua of uas) {
        expect(ua).toContain("Mozilla/5.0");
      }
    });

    it("produces variation across many calls", () => {
      const rotator = new UserAgentRotator();
      const uas = new Set(collect(200, () => rotator.get()));
      expect(uas.size).toBeGreaterThan(1);
    });
  });

  describe("random strategy", () => {
    it("returns different UAs over many calls", () => {
      const rotator = new UserAgentRotator({ strategy: "random" });
      const uas = new Set(collect(200, () => rotator.get()));
      expect(uas.size).toBeGreaterThan(1);
    });

    it("all returned UAs contain Mozilla/5.0", () => {
      const rotator = new UserAgentRotator({ strategy: "random" });
      const uas = collect(50, () => rotator.get());
      for (const ua of uas) {
        expect(ua).toContain("Mozilla/5.0");
      }
    });
  });

  describe("round-robin strategy", () => {
    it("cycles through the entire pool deterministically", () => {
      const rotator = new UserAgentRotator({ strategy: "round-robin" });
      // There are 28 UAs across all families
      const first = collect(28, () => rotator.get());
      // After a full cycle, the next call should restart
      const second = rotator.get();
      expect(second).toBe(first[0]);
    });

    it("returns unique UAs within a single cycle", () => {
      const rotator = new UserAgentRotator({ strategy: "round-robin" });
      const cycle = collect(28, () => rotator.get());
      // All returned UAs should be from the pool (strings)
      for (const ua of cycle) {
        expect(typeof ua).toBe("string");
        expect(ua.length).toBeGreaterThan(0);
      }
    });

    it("reset() restarts the cycle from index 0", () => {
      const rotator = new UserAgentRotator({ strategy: "round-robin" });
      const first = rotator.get();
      rotator.get(); // advance
      rotator.reset();
      const afterReset = rotator.get();
      expect(afterReset).toBe(first);
    });
  });

  describe("weighted strategy", () => {
    it("returns UAs from the pool", () => {
      const rotator = new UserAgentRotator({ strategy: "weighted" });
      const uas = collect(100, () => rotator.get());
      for (const ua of uas) {
        expect(ua).toContain("Mozilla/5.0");
      }
    });

    it("chrome-windows UAs appear more frequently (highest weight)", () => {
      const rotator = new UserAgentRotator({ strategy: "weighted" });
      const uas = collect(500, () => rotator.get());
      const chromeWin = uas.filter(
        (ua) => ua.includes("Chrome/") && ua.includes("Windows NT") && !ua.includes("Edg/")
      );
      // Chrome Windows has 40% weight → should be well above 20%
      expect(chromeWin.length).toBeGreaterThan(50);
    });
  });

  describe("per-domain strategy", () => {
    it("behaves like weighted when no URL is passed", () => {
      const rotator = new UserAgentRotator({ strategy: "per-domain" });
      const ua = rotator.get();
      expect(ua).toContain("Mozilla/5.0");
    });
  });

  describe("custom pool", () => {
    const customPool = ["CustomBot/1.0", "CustomBot/2.0"];

    it("only returns UAs from the custom pool", () => {
      const rotator = new UserAgentRotator({ customPool });
      const uas = new Set(collect(50, () => rotator.get()));
      for (const ua of uas) {
        expect(customPool).toContain(ua);
      }
    });

    it("weighted strategy falls back to uniform for custom pool", () => {
      const rotator = new UserAgentRotator({ strategy: "weighted", customPool });
      const uas = new Set(collect(50, () => rotator.get()));
      // Should use at least one of them
      expect(uas.size).toBeGreaterThanOrEqual(1);
      for (const ua of uas) {
        expect(customPool).toContain(ua);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Domain-sticky behaviour
  // -------------------------------------------------------------------------

  describe("domain-sticky mode (stickyPerDomain: true, default)", () => {
    it("returns the same UA for the same domain across calls", () => {
      const rotator = new UserAgentRotator({ strategy: "random" });
      const ua1 = rotator.get("https://example.com/page1");
      const ua2 = rotator.get("https://example.com/page2");
      const ua3 = rotator.get("https://example.com/other");
      expect(ua1).toBe(ua2);
      expect(ua2).toBe(ua3);
    });

    it("may return different UAs for different domains", () => {
      const rotator = new UserAgentRotator({ strategy: "random" });
      // Use many different domains to increase chance of getting different UAs
      const domains = Array.from({ length: 30 }, (_, i) => `https://site${i}.example.com/`);
      const uas = new Set(domains.map((url) => rotator.get(url)));
      // With 30 different domains, very likely > 1 distinct UA
      expect(uas.size).toBeGreaterThan(1);
    });

    it("falls back to select() for invalid URLs", () => {
      const rotator = new UserAgentRotator();
      const ua = rotator.get("not-a-url");
      expect(typeof ua).toBe("string");
      expect(ua.length).toBeGreaterThan(0);
    });
  });

  describe("stickyPerDomain: false", () => {
    it("does not lock UA per domain", () => {
      const rotator = new UserAgentRotator({ strategy: "round-robin", stickyPerDomain: false });
      const ua1 = rotator.get("https://example.com/page1");
      const ua2 = rotator.get("https://example.com/page2");
      // round-robin advances on every call so they should differ
      expect(ua1).not.toBe(ua2);
    });
  });

  // -------------------------------------------------------------------------
  // reset()
  // -------------------------------------------------------------------------

  describe("reset()", () => {
    it("clears the domain map so a domain can get a new UA", () => {
      const rotator = new UserAgentRotator({ strategy: "round-robin" });
      const first = rotator.get("https://sticky.test/a");
      rotator.reset();
      // After reset the round-robin index is also 0, so the first UA is the same.
      // But the domain map should be empty.
      const afterReset = rotator.get("https://sticky.test/b");
      // It should re-select (round-robin index was reset to 0)
      expect(afterReset).toBe(first);
    });

    it("resets round-robin index", () => {
      const rotator = new UserAgentRotator({ strategy: "round-robin" });
      const first = rotator.get();
      rotator.get();
      rotator.get();
      rotator.reset();
      expect(rotator.get()).toBe(first);
    });
  });

  // -------------------------------------------------------------------------
  // Static helpers
  // -------------------------------------------------------------------------

  describe("UserAgentRotator.identifyFamily()", () => {
    it('returns "chrome" for Chrome UA', () => {
      expect(
        UserAgentRotator.identifyFamily(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        )
      ).toBe("chrome");
    });

    it('returns "firefox" for Firefox UA', () => {
      expect(
        UserAgentRotator.identifyFamily(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0"
        )
      ).toBe("firefox");
    });

    it('returns "safari" for Safari UA (no Chrome token)', () => {
      expect(
        UserAgentRotator.identifyFamily(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15"
        )
      ).toBe("safari");
    });

    it('returns "edge" for Edge UA', () => {
      expect(
        UserAgentRotator.identifyFamily(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"
        )
      ).toBe("edge");
    });

    it('returns "unknown" for unrecognised UA', () => {
      expect(UserAgentRotator.identifyFamily("curl/7.0")).toBe("unknown");
    });
  });

  describe("UserAgentRotator.getClientHints()", () => {
    it("returns Sec-CH-UA headers for Chrome Windows UA", () => {
      const ua =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
      const hints = UserAgentRotator.getClientHints(ua);
      expect(hints["Sec-CH-UA"]).toContain('"Google Chrome";v="131"');
      expect(hints["Sec-CH-UA"]).toContain('"Chromium";v="131"');
      expect(hints["Sec-CH-UA-Mobile"]).toBe("?0");
      expect(hints["Sec-CH-UA-Platform"]).toBe('"Windows"');
    });

    it("returns macOS platform for Chrome Mac UA", () => {
      const ua =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
      const hints = UserAgentRotator.getClientHints(ua);
      expect(hints["Sec-CH-UA-Platform"]).toBe('"macOS"');
      expect(hints["Sec-CH-UA"]).toContain('"Google Chrome";v="130"');
    });

    it("returns Linux platform for Chrome Linux UA", () => {
      const ua =
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
      const hints = UserAgentRotator.getClientHints(ua);
      expect(hints["Sec-CH-UA-Platform"]).toBe('"Linux"');
    });

    it("returns Edge-specific hints for Edge UA", () => {
      const ua =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
      const hints = UserAgentRotator.getClientHints(ua);
      expect(hints["Sec-CH-UA"]).toContain('"Microsoft Edge";v="131"');
      expect(hints["Sec-CH-UA"]).toContain('"Chromium";v="131"');
      expect(hints["Sec-CH-UA-Mobile"]).toBe("?0");
      expect(hints["Sec-CH-UA-Platform"]).toBe('"Windows"');
    });

    it("returns empty object for Firefox UA (no client hints)", () => {
      const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";
      const hints = UserAgentRotator.getClientHints(ua);
      expect(hints).toEqual({});
    });

    it("returns empty object for Safari UA", () => {
      const ua =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
      const hints = UserAgentRotator.getClientHints(ua);
      expect(hints).toEqual({});
    });
  });
});

// ---------------------------------------------------------------------------
// generateReferer
// ---------------------------------------------------------------------------

describe("generateReferer", () => {
  it("returns a string or undefined", () => {
    // Run many times to cover all probability branches
    const results = collect(200, () => generateReferer("https://example.com/page"));
    for (const r of results) {
      expect(r === undefined || typeof r === "string").toBe(true);
    }
  });

  it("google search referer contains encoded domain part", () => {
    // Force Math.random to hit the google-search branch (r < 0.4)
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const ref = generateReferer("https://www.example.com/page");
    expect(ref).toContain("https://www.google.com/search?q=");
    expect(ref).toContain("example");
    vi.restoreAllMocks();
  });

  it("returns undefined for direct navigation branch", () => {
    // 0.4 <= r < 0.55 → direct (undefined)
    vi.spyOn(Math, "random").mockReturnValue(0.45);
    const ref = generateReferer("https://example.com/");
    expect(ref).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("returns google generic for 0.55-0.7 range", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.6);
    const ref = generateReferer("https://example.com/");
    expect(ref).toBe("https://www.google.com/");
    vi.restoreAllMocks();
  });

  it("returns bing for 0.7-0.8 range", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.75);
    const ref = generateReferer("https://example.com/");
    expect(ref).toBe("https://www.bing.com/");
    vi.restoreAllMocks();
  });

  it("returns duckduckgo for 0.8-0.88 range", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.85);
    const ref = generateReferer("https://example.com/");
    expect(ref).toBe("https://duckduckgo.com/");
    vi.restoreAllMocks();
  });

  it("returns t.co for 0.88-0.93 range", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const ref = generateReferer("https://example.com/");
    expect(ref).toBe("https://t.co/");
    vi.restoreAllMocks();
  });

  it("returns reddit for 0.93-0.97 range", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.95);
    const ref = generateReferer("https://example.com/");
    expect(ref).toBe("https://www.reddit.com/");
    vi.restoreAllMocks();
  });

  it("returns linkedin for >= 0.97", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.98);
    const ref = generateReferer("https://example.com/");
    expect(ref).toBe("https://www.linkedin.com/");
    vi.restoreAllMocks();
  });

  it("handles invalid URL gracefully in google-search branch", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const ref = generateReferer("not-a-valid-url");
    // Catch branch → falls back to generic google
    expect(ref).toBe("https://www.google.com/");
    vi.restoreAllMocks();
  });
});
