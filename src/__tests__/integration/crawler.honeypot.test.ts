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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Crawler - honeypot links", () => {
  it("does not visit high-confidence honeypot links by default", async () => {
    const seed = "https://example.com/";
    const visited: string[] = [];

    const hero: any = {
      url: seed,
      goto: vi.fn(async (url: string) => {
        visited.push(url);
        hero.url = url;

        if (url === seed) {
          hero.document.documentElement.outerHTML =
            "<html><head><title>Seed</title></head><body>" +
            '<a href="/posts/1">Post 1</a>' +
            '<a href="/wp-admin/" style="display:none">x</a>' +
            '<a href="/posts/2">Post 2</a>' +
            "</body></html>";
        } else {
          hero.document.documentElement.outerHTML =
            "<html><head><title>Page</title></head><body></body></html>";
        }
      }),
      waitForPaintingStable: vi.fn(async () => undefined),
      document: {
        title: "Test",
        documentElement: { outerHTML: "" },
        querySelector: vi.fn(async () => null),
      },
    };

    const pool = {
      withBrowser: vi.fn(async (fn: any) => fn(hero)),
    };

    const result = await crawl({
      url: seed,
      depth: 1,
      maxPages: 3,
      delayMs: 0,
      respectRobots: false,
      pool: pool as any,
    });

    expect(result.urls.length).toBe(3);
    expect(visited).toContain(seed);
    expect(visited).toContain("https://example.com/posts/1");
    expect(visited).toContain("https://example.com/posts/2");
    expect(visited).not.toContain("https://example.com/wp-admin/");
  });

  it("can disable honeypot avoidance via options", async () => {
    const seed = "https://example.com/";
    const visited: string[] = [];

    const hero: any = {
      url: seed,
      goto: vi.fn(async (url: string) => {
        visited.push(url);
        hero.url = url;

        if (url === seed) {
          hero.document.documentElement.outerHTML =
            "<html><head><title>Seed</title></head><body>" +
            '<a href="/posts/1">Post 1</a>' +
            '<a href="/wp-admin/" style="display:none">x</a>' +
            '<a href="/posts/2">Post 2</a>' +
            "</body></html>";
        } else {
          hero.document.documentElement.outerHTML =
            "<html><head><title>Page</title></head><body></body></html>";
        }
      }),
      waitForPaintingStable: vi.fn(async () => undefined),
      document: {
        title: "Test",
        documentElement: { outerHTML: "" },
        querySelector: vi.fn(async () => null),
      },
    };

    const pool = {
      withBrowser: vi.fn(async (fn: any) => fn(hero)),
    };

    const result = await crawl({
      url: seed,
      depth: 1,
      maxPages: 3,
      delayMs: 0,
      respectRobots: false,
      avoidHoneypotLinks: false,
      pool: pool as any,
    });

    expect(result.urls.length).toBe(3);
    expect(visited).toContain("https://example.com/wp-admin/");
  });
});
