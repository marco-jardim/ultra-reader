import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EngineMeta } from "../../engines/types.js";
import {
  EngineError,
  ChallengeDetectedError,
  InsufficientContentError,
  HttpError,
  EngineTimeoutError,
} from "../../engines/errors.js";

// ---------------------------------------------------------------------------
// Mock user-agents module
// ---------------------------------------------------------------------------

const mockGetRandomUserAgent = vi.fn(() => "MockRotatedUA/1.0");
const mockGenerateReferer = vi.fn(() => "https://www.google.com/search?q=example");
const mockGetClientHints = vi.fn(() => ({
  "Sec-CH-UA": '"Chromium";v="131"',
  "Sec-CH-UA-Mobile": "?0",
  "Sec-CH-UA-Platform": '"Windows"',
}));

vi.mock("../../utils/user-agents.js", () => ({
  getRandomUserAgent: mockGetRandomUserAgent,
  generateReferer: mockGenerateReferer,
  UserAgentRotator: {
    getClientHints: mockGetClientHints,
  },
}));

// Import AFTER mock setup
const { HttpEngine, httpEngine } = await import("../../engines/http/index.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_HTML = `
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  <p>${"Lorem ipsum dolor sit amet. ".repeat(20)}</p>
</body>
</html>
`;

function mockFetchResponse(
  body: string,
  init: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    url?: string;
  } = {}
): Response {
  const { status = 200, statusText = "OK", headers = {}, url: responseUrl } = init;
  const h = new Headers({ "content-type": "text/html; charset=utf-8", ...headers });
  const resp = new Response(body, { status, statusText, headers: h });
  // Response.url is read-only, but we can override with defineProperty
  if (responseUrl) {
    Object.defineProperty(resp, "url", { value: responseUrl });
  }
  return resp;
}

function defaultMeta(overrides: Partial<EngineMeta> = {}): EngineMeta {
  return {
    url: "https://example.com",
    options: { urls: ["https://example.com"] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HttpEngine", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
    vi.stubGlobal("fetch", fetchSpy);
    mockGetRandomUserAgent.mockReturnValue("MockRotatedUA/1.0");
    mockGenerateReferer.mockReturnValue("https://www.google.com/search?q=example");
    mockGetClientHints.mockReturnValue({
      "Sec-CH-UA": '"Chromium";v="131"',
      "Sec-CH-UA-Mobile": "?0",
      "Sec-CH-UA-Platform": '"Windows"',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Successful fetch
  // -----------------------------------------------------------------------

  describe("successful scrape", () => {
    it("returns EngineResult with html, url, statusCode, engine='http'", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(VALID_HTML, { url: "https://example.com" }));

      const result = await httpEngine.scrape(defaultMeta());

      expect(result.html).toBe(VALID_HTML);
      expect(result.url).toBeDefined();
      expect(result.statusCode).toBe(200);
      expect(result.engine).toBe("http");
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.contentType).toContain("text/html");
    });

    it("calls fetch with correct URL and GET method", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(VALID_HTML));

      await httpEngine.scrape(defaultMeta({ url: "https://test.example.org/page" }));

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://test.example.org/page",
        expect.objectContaining({ method: "GET", redirect: "follow" })
      );
    });
  });

  // -----------------------------------------------------------------------
  // Header construction
  // -----------------------------------------------------------------------

  describe("headers", () => {
    it("uses rotated User-Agent from user-agents.ts, not just hardcoded Chrome/120", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(VALID_HTML));

      await httpEngine.scrape(defaultMeta());

      const callHeaders = fetchSpy.mock.calls[0][1].headers;
      expect(callHeaders["User-Agent"]).toBe("MockRotatedUA/1.0");
    });

    it("options.userAgent overrides rotated UA", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(VALID_HTML));

      await httpEngine.scrape(
        defaultMeta({
          options: { urls: [], userAgent: "CustomAgent/2.0" },
        })
      );

      const callHeaders = fetchSpy.mock.calls[0][1].headers;
      expect(callHeaders["User-Agent"]).toBe("CustomAgent/2.0");
    });

    it("options.headers override defaults", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(VALID_HTML));

      await httpEngine.scrape(
        defaultMeta({
          options: { urls: [], headers: { "Accept-Language": "fr-FR" } },
        })
      );

      const callHeaders = fetchSpy.mock.calls[0][1].headers;
      expect(callHeaders["Accept-Language"]).toBe("fr-FR");
    });

    it("includes Sec-Fetch-* headers from defaults", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(VALID_HTML));

      await httpEngine.scrape(defaultMeta());

      const callHeaders = fetchSpy.mock.calls[0][1].headers;
      expect(callHeaders["Sec-Fetch-Dest"]).toBe("document");
      expect(callHeaders["Sec-Fetch-Mode"]).toBe("navigate");
      // Sec-Fetch-Site becomes "cross-site" when a spoofed Referer from a different origin is present
      expect(callHeaders["Sec-Fetch-Site"]).toBe("cross-site");
      expect(callHeaders["Sec-Fetch-User"]).toBe("?1");
    });

    it("includes Sec-CH-UA client hints", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(VALID_HTML));

      await httpEngine.scrape(defaultMeta());

      const callHeaders = fetchSpy.mock.calls[0][1].headers;
      expect(callHeaders["Sec-CH-UA"]).toBeDefined();
      expect(callHeaders["Sec-CH-UA-Mobile"]).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Referer spoofing
  // -----------------------------------------------------------------------

  describe("referer spoofing", () => {
    it("adds Referer header by default (spoofReferer not set)", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(VALID_HTML));

      await httpEngine.scrape(defaultMeta());

      const callHeaders = fetchSpy.mock.calls[0][1].headers;
      expect(callHeaders["Referer"]).toBe("https://www.google.com/search?q=example");
      expect(mockGenerateReferer).toHaveBeenCalledWith("https://example.com");
    });

    it("omits Referer when spoofReferer is false", async () => {
      mockGenerateReferer.mockReturnValue(undefined);
      fetchSpy.mockResolvedValue(mockFetchResponse(VALID_HTML));

      await httpEngine.scrape(
        defaultMeta({
          options: { urls: [], spoofReferer: false },
        })
      );

      const callHeaders = fetchSpy.mock.calls[0][1].headers;
      expect(callHeaders["Referer"]).toBeUndefined();
    });

    it("explicit Referer in options.headers wins over generated", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(VALID_HTML));

      await httpEngine.scrape(
        defaultMeta({
          options: { urls: [], headers: { Referer: "https://custom.ref/" } },
        })
      );

      const callHeaders = fetchSpy.mock.calls[0][1].headers;
      // options.headers spread last, so the explicit Referer wins
      expect(callHeaders["Referer"]).toBe("https://custom.ref/");
    });
  });

  // -----------------------------------------------------------------------
  // HTTP error statuses
  // -----------------------------------------------------------------------

  describe("HTTP errors", () => {
    it("throws HttpError on 403", async () => {
      fetchSpy.mockResolvedValue(
        mockFetchResponse("<html>Forbidden</html>", { status: 403, statusText: "Forbidden" })
      );

      const err = await httpEngine.scrape(defaultMeta()).catch((e: Error) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(403);
    });

    it("throws HttpError on 429", async () => {
      fetchSpy.mockResolvedValue(
        mockFetchResponse("<html>Rate limited</html>", {
          status: 429,
          statusText: "Too Many Requests",
        })
      );

      await expect(httpEngine.scrape(defaultMeta())).rejects.toThrow(HttpError);
    });

    it("throws HttpError on 500", async () => {
      fetchSpy.mockResolvedValue(
        mockFetchResponse("<html>Server error</html>", {
          status: 500,
          statusText: "Internal Server Error",
        })
      );

      await expect(httpEngine.scrape(defaultMeta())).rejects.toThrow(HttpError);
    });

    it("throws HttpError on 503", async () => {
      fetchSpy.mockResolvedValue(
        mockFetchResponse("<html>Unavailable</html>", {
          status: 503,
          statusText: "Service Unavailable",
        })
      );

      const err = await httpEngine.scrape(defaultMeta()).catch((e: Error) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(503);
    });
  });

  // -----------------------------------------------------------------------
  // Content validation
  // -----------------------------------------------------------------------

  describe("content validation", () => {
    it("throws InsufficientContentError when content is too short (<100 chars)", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse("<html><body>Hi</body></html>"));

      await expect(httpEngine.scrape(defaultMeta())).rejects.toThrow(InsufficientContentError);
    });

    it("InsufficientContentError includes contentLength and threshold", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse("<html><body>Hi</body></html>"));

      const err = await httpEngine.scrape(defaultMeta()).catch((e: Error) => e);
      expect(err).toBeInstanceOf(InsufficientContentError);
      expect((err as InsufficientContentError).contentLength).toBeLessThan(100);
      expect((err as InsufficientContentError).threshold).toBe(100);
    });
  });

  // -----------------------------------------------------------------------
  // Challenge detection
  // -----------------------------------------------------------------------

  describe("challenge detection", () => {
    const cloudflareHtml = `
      <html>
      <head><title>Just a moment</title></head>
      <body>
        <div class="cf-browser-verification">
          Checking your browser before accessing example.com.
        </div>
        <script src="/cdn-cgi/challenge-platform/scripts/invisible.js"></script>
      </body>
      </html>
    `;

    it("throws ChallengeDetectedError for Cloudflare challenge page", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(cloudflareHtml));

      await expect(httpEngine.scrape(defaultMeta())).rejects.toThrow(ChallengeDetectedError);
    });

    it("ChallengeDetectedError includes challengeType", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(cloudflareHtml));

      const err = await httpEngine.scrape(defaultMeta()).catch((e: Error) => e);
      expect(err).toBeInstanceOf(ChallengeDetectedError);
      expect((err as ChallengeDetectedError).challengeType).toBeDefined();
    });

    it("detects 'bot detection' challenge pattern", async () => {
      const botHtml = `
        <html><body>
          <h1>Are you a robot?</h1>
          <p>Please complete the security check to access this website.</p>
          ${"Some filler content to exceed min length. ".repeat(10)}
        </body></html>
      `;
      fetchSpy.mockResolvedValue(mockFetchResponse(botHtml));

      await expect(httpEngine.scrape(defaultMeta())).rejects.toThrow(ChallengeDetectedError);
    });

    it("detects DDoS protection page", async () => {
      const ddosHtml = `
        <html><body>
          <p>DDoS protection by Cloudflare</p>
          <p>/cdn-cgi/challenge challenge</p>
          ${"Filler text to pass min length. ".repeat(10)}
        </body></html>
      `;
      fetchSpy.mockResolvedValue(mockFetchResponse(ddosHtml));

      await expect(httpEngine.scrape(defaultMeta())).rejects.toThrow(ChallengeDetectedError);
    });

    it("does NOT throw for normal page content", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(VALID_HTML));

      const result = await httpEngine.scrape(defaultMeta());
      expect(result.statusCode).toBe(200);
    });
  });

  // -----------------------------------------------------------------------
  // Timeout handling
  // -----------------------------------------------------------------------

  describe("timeout", () => {
    it("throws EngineTimeoutError on AbortError", async () => {
      const abortError = new DOMException("The operation was aborted", "AbortError");
      fetchSpy.mockRejectedValue(abortError);

      await expect(httpEngine.scrape(defaultMeta())).rejects.toThrow(EngineTimeoutError);
    });

    it("EngineTimeoutError includes timeoutMs", async () => {
      const abortError = new DOMException("The operation was aborted", "AbortError");
      fetchSpy.mockRejectedValue(abortError);

      const err = await httpEngine.scrape(defaultMeta()).catch((e: Error) => e);
      expect(err).toBeInstanceOf(EngineTimeoutError);
      expect((err as EngineTimeoutError).timeoutMs).toBe(10000); // http maxTimeout
    });
  });

  // -----------------------------------------------------------------------
  // Network errors
  // -----------------------------------------------------------------------

  describe("network errors", () => {
    it("wraps generic Error as EngineError", async () => {
      fetchSpy.mockRejectedValue(new TypeError("fetch failed"));

      await expect(httpEngine.scrape(defaultMeta())).rejects.toThrow(EngineError);
    });

    it("wraps non-Error thrown values as EngineError", async () => {
      fetchSpy.mockRejectedValue("string error");

      await expect(httpEngine.scrape(defaultMeta())).rejects.toThrow(EngineError);
    });

    it("EngineError includes engine name", async () => {
      fetchSpy.mockRejectedValue(new TypeError("network down"));

      const err = await httpEngine.scrape(defaultMeta()).catch((e: Error) => e);
      expect(err).toBeInstanceOf(EngineError);
      expect((err as EngineError).engine).toBe("http");
    });
  });

  // -----------------------------------------------------------------------
  // Abort signal handling
  // -----------------------------------------------------------------------

  describe("abort signal", () => {
    it("passes abort signal to fetch", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(VALID_HTML));

      const controller = new AbortController();
      await httpEngine.scrape(defaultMeta({ abortSignal: controller.signal }));

      const fetchInit = fetchSpy.mock.calls[0][1];
      expect(fetchInit.signal).toBeInstanceOf(AbortSignal);
    });

    it("external abort causes EngineTimeoutError", async () => {
      const abortError = new DOMException("The operation was aborted", "AbortError");
      fetchSpy.mockRejectedValue(abortError);

      const controller = new AbortController();
      controller.abort();

      await expect(
        httpEngine.scrape(defaultMeta({ abortSignal: controller.signal }))
      ).rejects.toThrow(EngineTimeoutError);
    });
  });

  // -----------------------------------------------------------------------
  // isAvailable
  // -----------------------------------------------------------------------

  describe("isAvailable", () => {
    it("always returns true", () => {
      expect(httpEngine.isAvailable()).toBe(true);
    });

    it("returns true for new HttpEngine instances", () => {
      const engine = new HttpEngine();
      expect(engine.isAvailable()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Config
  // -----------------------------------------------------------------------

  describe("config", () => {
    it("has engine name 'http'", () => {
      expect(httpEngine.config.name).toBe("http");
    });

    it("has maxTimeout of 10000", () => {
      expect(httpEngine.config.maxTimeout).toBe(10000);
    });
  });
});
