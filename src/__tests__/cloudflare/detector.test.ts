import { describe, it, expect, vi } from "vitest";
import { detectChallenge, isChallengePage } from "../../cloudflare/detector.js";
import type { ChallengeDetection } from "../../cloudflare/types.js";

// ---------------------------------------------------------------------------
// Hero mock factory
// ---------------------------------------------------------------------------

interface MockHeroOptions {
  html?: string | null;
  /** Map of CSS selector → truthy value (element exists) or null (not found) */
  selectorResults?: Record<string, unknown>;
  /** If true, querySelector throws for every call */
  querySelectorThrows?: boolean;
  /** If true, hero.document is null/undefined */
  noDocument?: boolean;
}

function createMockHero(opts: MockHeroOptions = {}) {
  const {
    html = "<html><body>Hello</body></html>",
    selectorResults = {},
    querySelectorThrows = false,
    noDocument = false,
  } = opts;

  if (noDocument) {
    return { document: null } as any;
  }

  const querySelector = vi.fn(async (selector: string) => {
    if (querySelectorThrows) {
      throw new Error("querySelector error");
    }
    if (selector in selectorResults) {
      return selectorResults[selector];
    }
    return null;
  });

  return {
    document: {
      documentElement: {
        outerHTML: Promise.resolve(html ?? ""),
      },
      querySelector,
    },
  } as any;
}

// ---------------------------------------------------------------------------
// detectChallenge
// ---------------------------------------------------------------------------

describe("detectChallenge", () => {
  it("returns no challenge when no Cloudflare infrastructure is present", async () => {
    const hero = createMockHero({
      html: "<html><body><h1>Normal Page</h1></body></html>",
    });

    const result = await detectChallenge(hero);

    expect(result).toEqual<ChallengeDetection>({
      isChallenge: false,
      type: "none",
      confidence: 0,
      signals: ["No Cloudflare infrastructure detected"],
    });
  });

  it("returns challenge when CF infra + challenge selector is found", async () => {
    const hero = createMockHero({
      html: '<html><body><script src="/cdn-cgi/challenge-platform"></script></body></html>',
      selectorResults: {
        "#challenge-running": { id: "challenge-running" },
      },
    });

    const result = await detectChallenge(hero);

    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe("js_challenge");
    expect(result.confidence).toBe(100);
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Cloudflare infra"),
        expect.stringContaining("Challenge element: #challenge-running"),
      ])
    );
  });

  it("returns js_challenge when CF infra + challenge text pattern is present", async () => {
    const hero = createMockHero({
      html: '<html><head><script src="/cdn-cgi/bm"></script></head><body>Checking if the site connection is secure</body></html>',
    });

    const result = await detectChallenge(hero);

    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe("js_challenge");
    expect(result.confidence).toBe(100);
    expect(result.signals).toEqual(
      expect.arrayContaining([expect.stringContaining("Challenge text")])
    );
  });

  it("returns blocked when CF infra + both blocked patterns are present", async () => {
    const hero = createMockHero({
      html: '<html><head><meta name="cf-ray" content="abc"></head><body>Sorry, you have been blocked. Ray ID: 123abc</body></html>',
    });

    const result = await detectChallenge(hero);

    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe("blocked");
    expect(result.confidence).toBe(100);
    expect(result.signals).toEqual(
      expect.arrayContaining([expect.stringContaining("Cloudflare block page detected")])
    );
  });

  it("returns not a challenge when only one blocked pattern is present (missing ray id)", async () => {
    const hero = createMockHero({
      html: '<html><head><script src="/cdn-cgi/x"></script></head><body>Sorry, you have been blocked</body></html>',
    });

    const result = await detectChallenge(hero);

    // "sorry, you have been blocked" alone is NOT a blocked detection (needs BOTH patterns)
    // but it also doesn't match challenge text patterns, so no challenge
    expect(result.isChallenge).toBe(false);
    expect(result.type).toBe("none");
  });

  it("returns not a challenge when CF infra is present but no challenge indicators", async () => {
    const hero = createMockHero({
      html: '<html><head><script src="/cdn-cgi/scripts/analytics.js"></script></head><body><h1>Normal CF-served page</h1></body></html>',
    });

    const result = await detectChallenge(hero);

    expect(result.isChallenge).toBe(false);
    expect(result.type).toBe("none");
    expect(result.confidence).toBe(0);
  });

  it("returns no challenge when hero.document is null", async () => {
    const hero = createMockHero({ noDocument: true });

    const result = await detectChallenge(hero);

    expect(result).toEqual<ChallengeDetection>({
      isChallenge: false,
      type: "none",
      confidence: 0,
      signals: ["No document available"],
    });
  });

  it("continues to next check when querySelector throws", async () => {
    const hero = createMockHero({
      html: '<html><head><script src="/cdn-cgi/challenge-platform"></script></head><body>Checking if the site connection is secure</body></html>',
      querySelectorThrows: true,
    });

    const result = await detectChallenge(hero);

    // querySelector throws for all selectors, but text pattern still matches
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe("js_challenge");
    expect(result.confidence).toBe(100);
  });

  it("detects turnstile wrapper selector", async () => {
    const hero = createMockHero({
      html: '<html><body><script src="/cdn-cgi/t"></script></body></html>',
      selectorResults: {
        "#turnstile-wrapper": { id: "turnstile-wrapper" },
      },
    });

    const result = await detectChallenge(hero);

    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe("js_challenge");
    expect(result.signals).toEqual(
      expect.arrayContaining([expect.stringContaining("#turnstile-wrapper")])
    );
  });

  it("detects cf-hcaptcha-container selector", async () => {
    const hero = createMockHero({
      html: '<html><body><script src="/cdn-cgi/t"></script></body></html>',
      selectorResults: {
        "#cf-hcaptcha-container": { id: "cf-hcaptcha-container" },
      },
    });

    const result = await detectChallenge(hero);

    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe("js_challenge");
  });

  it('detects "waiting for...to respond" challenge pattern', async () => {
    const hero = createMockHero({
      html: '<html><head><link href="/cdn-cgi/styles/cf.css"></head><body>Waiting for example.com to respond</body></html>',
    });

    const result = await detectChallenge(hero);

    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe("js_challenge");
    expect(result.signals).toEqual(
      expect.arrayContaining([expect.stringContaining("waiting for...to respond")])
    );
  });

  it("detects __cf_bm infrastructure signal", async () => {
    const hero = createMockHero({
      html: '<html><body><script>document.cookie="__cf_bm=abc"</script><div id="challenge-form">challenge</div></body></html>',
      selectorResults: {
        "#challenge-form": { id: "challenge-form" },
      },
    });

    const result = await detectChallenge(hero);

    expect(result.isChallenge).toBe(true);
    expect(result.signals).toEqual(
      expect.arrayContaining([expect.stringContaining('Cloudflare infra: "__cf_bm"')])
    );
  });

  it("detects multiple challenge selectors at once", async () => {
    const hero = createMockHero({
      html: '<html><body><script src="/cdn-cgi/x"></script></body></html>',
      selectorResults: {
        "#challenge-running": { id: "challenge-running" },
        "#challenge-form": { id: "challenge-form" },
      },
    });

    const result = await detectChallenge(hero);

    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe("js_challenge");
    // Should have signals for both selectors
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.stringContaining("#challenge-running"),
        expect.stringContaining("#challenge-form"),
      ])
    );
  });

  it("returns error-based result when outerHTML access throws", async () => {
    const hero = {
      document: {
        documentElement: {
          get outerHTML() {
            return Promise.reject(new Error("DOM access failed"));
          },
        },
        querySelector: vi.fn(),
      },
    } as any;

    const result = await detectChallenge(hero);

    expect(result.isChallenge).toBe(false);
    expect(result.type).toBe("none");
    expect(result.confidence).toBe(0);
    expect(result.signals).toEqual(
      expect.arrayContaining([expect.stringContaining("Error during detection")])
    );
  });
});

// ---------------------------------------------------------------------------
// isChallengePage
// ---------------------------------------------------------------------------

describe("isChallengePage", () => {
  it("returns false for a normal page", async () => {
    const hero = createMockHero({
      html: "<html><body>Normal page</body></html>",
    });

    expect(await isChallengePage(hero)).toBe(false);
  });

  it("returns true when a challenge is detected", async () => {
    const hero = createMockHero({
      html: '<html><body><script src="/cdn-cgi/x"></script>Checking if the site connection is secure</body></html>',
    });

    expect(await isChallengePage(hero)).toBe(true);
  });

  it("delegates to detectChallenge internally", async () => {
    const hero = createMockHero({ noDocument: true });
    // No document → detectChallenge returns isChallenge: false
    expect(await isChallengePage(hero)).toBe(false);
  });
});
