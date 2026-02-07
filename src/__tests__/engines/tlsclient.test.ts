import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EngineMeta } from "../../engines/types.js";
import {
  EngineError,
  ChallengeDetectedError,
  InsufficientContentError,
  HttpError,
  EngineTimeoutError,
  EngineUnavailableError,
} from "../../engines/errors.js";

// ---------------------------------------------------------------------------
// Mock user-agents module
// ---------------------------------------------------------------------------

const mockGetRandomUserAgent = vi.fn(() => "MockRotatedUA/1.0");
const mockGenerateReferer = vi.fn(() => "https://www.google.com/search?q=example");

vi.mock("../../utils/user-agents.js", () => ({
  getRandomUserAgent: mockGetRandomUserAgent,
  generateReferer: mockGenerateReferer,
  UserAgentRotator: {
    getClientHints: vi.fn(() => ({})),
  },
}));

// ---------------------------------------------------------------------------
// Mock got-scraping module
// ---------------------------------------------------------------------------

const mockGotScraping = vi.fn();

vi.mock("got-scraping", () => ({
  gotScraping: mockGotScraping,
}));

// Import AFTER mock setup
const { TlsClientEngine, tlsClientEngine } = await import("../../engines/tlsclient/index.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_HTML = `
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  <p>${"Lorem ipsum dolor sit amet consectetur adipiscing elit. ".repeat(10)}</p>
</body>
</html>
`;

interface MockGotResponse {
  body: string;
  statusCode: number;
  statusMessage?: string;
  url: string;
  headers: Record<string, string>;
}

function mockGotResponse(body: string, overrides: Partial<MockGotResponse> = {}): MockGotResponse {
  return {
    body,
    statusCode: 200,
    statusMessage: "OK",
    url: "https://example.com",
    headers: { "content-type": "text/html; charset=utf-8" },
    ...overrides,
  };
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

describe("TlsClientEngine", () => {
  beforeEach(() => {
    mockGotScraping.mockReset();
    mockGetRandomUserAgent.mockReturnValue("MockRotatedUA/1.0");
    mockGenerateReferer.mockReturnValue("https://www.google.com/search?q=example");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Successful scrape
  // -----------------------------------------------------------------------

  describe("successful scrape", () => {
    it("returns EngineResult with engine='tlsclient'", async () => {
      mockGotScraping.mockResolvedValue(mockGotResponse(VALID_HTML));

      const result = await tlsClientEngine.scrape(defaultMeta());

      expect(result.engine).toBe("tlsclient");
      expect(result.html).toBe(VALID_HTML);
      expect(result.statusCode).toBe(200);
      expect(result.url).toBe("https://example.com");
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("calls gotScraping with correct url and followRedirect", async () => {
      mockGotScraping.mockResolvedValue(mockGotResponse(VALID_HTML));

      await tlsClientEngine.scrape(defaultMeta({ url: "https://test.example.org/page" }));

      expect(mockGotScraping).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://test.example.org/page",
          followRedirect: true,
        })
      );
    });

    it("passes timeout configuration to gotScraping", async () => {
      mockGotScraping.mockResolvedValue(mockGotResponse(VALID_HTML));

      await tlsClientEngine.scrape(defaultMeta());

      expect(mockGotScraping).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: { request: 15000 }, // tlsclient maxTimeout
        })
      );
    });

    it("returns content-type from response headers", async () => {
      mockGotScraping.mockResolvedValue(
        mockGotResponse(VALID_HTML, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      );

      const result = await tlsClientEngine.scrape(defaultMeta());
      expect(result.contentType).toBe("text/html; charset=utf-8");
    });
  });

  // -----------------------------------------------------------------------
  // Header construction
  // -----------------------------------------------------------------------

  describe("headers", () => {
    it("includes rotated User-Agent from user-agents.ts", async () => {
      mockGotScraping.mockResolvedValue(mockGotResponse(VALID_HTML));

      await tlsClientEngine.scrape(defaultMeta());

      const callArgs = mockGotScraping.mock.calls[0][0];
      expect(callArgs.headers["User-Agent"]).toBe("MockRotatedUA/1.0");
    });

    it("options.userAgent overrides rotated UA", async () => {
      mockGotScraping.mockResolvedValue(mockGotResponse(VALID_HTML));

      await tlsClientEngine.scrape(
        defaultMeta({
          options: { urls: [], userAgent: "CustomTlsAgent/3.0" },
        })
      );

      const callArgs = mockGotScraping.mock.calls[0][0];
      expect(callArgs.headers["User-Agent"]).toBe("CustomTlsAgent/3.0");
    });

    it("options.headers['User-Agent'] is used when no options.userAgent", async () => {
      mockGotScraping.mockResolvedValue(mockGotResponse(VALID_HTML));

      await tlsClientEngine.scrape(
        defaultMeta({
          options: { urls: [], headers: { "User-Agent": "HeaderUA/1.0" } },
        })
      );

      const callArgs = mockGotScraping.mock.calls[0][0];
      // The resolved UA should be "HeaderUA/1.0" from the ?? chain,
      // but then it's overwritten to resolvedUa. Let's verify:
      expect(callArgs.headers["User-Agent"]).toBe("HeaderUA/1.0");
    });

    it("options.headers are merged into request headers", async () => {
      mockGotScraping.mockResolvedValue(mockGotResponse(VALID_HTML));

      await tlsClientEngine.scrape(
        defaultMeta({
          options: { urls: [], headers: { "X-Custom": "value123" } },
        })
      );

      const callArgs = mockGotScraping.mock.calls[0][0];
      expect(callArgs.headers["X-Custom"]).toBe("value123");
    });
  });

  // -----------------------------------------------------------------------
  // Referer spoofing
  // -----------------------------------------------------------------------

  describe("referer spoofing", () => {
    it("adds Referer header by default", async () => {
      mockGotScraping.mockResolvedValue(mockGotResponse(VALID_HTML));

      await tlsClientEngine.scrape(defaultMeta());

      const callArgs = mockGotScraping.mock.calls[0][0];
      expect(callArgs.headers["Referer"]).toBe("https://www.google.com/search?q=example");
    });

    it("omits Referer when spoofReferer is false", async () => {
      mockGenerateReferer.mockReturnValue(undefined);
      mockGotScraping.mockResolvedValue(mockGotResponse(VALID_HTML));

      await tlsClientEngine.scrape(
        defaultMeta({
          options: { urls: [], spoofReferer: false },
        })
      );

      const callArgs = mockGotScraping.mock.calls[0][0];
      expect(callArgs.headers["Referer"]).toBeUndefined();
    });

    it("explicit Referer in options.headers is used", async () => {
      mockGotScraping.mockResolvedValue(mockGotResponse(VALID_HTML));

      await tlsClientEngine.scrape(
        defaultMeta({
          options: { urls: [], headers: { Referer: "https://custom-referer.com/" } },
        })
      );

      const callArgs = mockGotScraping.mock.calls[0][0];
      // The explicit Referer from options.headers is picked up by the ?? chain
      expect(callArgs.headers["Referer"]).toBe("https://custom-referer.com/");
    });
  });

  // -----------------------------------------------------------------------
  // HTTP error statuses
  // -----------------------------------------------------------------------

  describe("HTTP errors", () => {
    it("throws HttpError on 403", async () => {
      mockGotScraping.mockResolvedValue(
        mockGotResponse("<html>Forbidden</html>", {
          statusCode: 403,
          statusMessage: "Forbidden",
        })
      );

      await expect(tlsClientEngine.scrape(defaultMeta())).rejects.toThrow(HttpError);
      const err = await tlsClientEngine.scrape(defaultMeta()).catch((e: Error) => e);
      expect((err as HttpError).statusCode).toBe(403);
    });

    it("throws HttpError on 429", async () => {
      mockGotScraping.mockResolvedValue(
        mockGotResponse("<html>Rate limited</html>", {
          statusCode: 429,
          statusMessage: "Too Many Requests",
        })
      );

      await expect(tlsClientEngine.scrape(defaultMeta())).rejects.toThrow(HttpError);
    });

    it("throws HttpError on 500", async () => {
      mockGotScraping.mockResolvedValue(
        mockGotResponse("<html>Server error</html>", {
          statusCode: 500,
          statusMessage: "Internal Server Error",
        })
      );

      await expect(tlsClientEngine.scrape(defaultMeta())).rejects.toThrow(HttpError);
    });

    it("HttpError includes engine name 'tlsclient'", async () => {
      mockGotScraping.mockResolvedValue(
        mockGotResponse("<html>Forbidden</html>", { statusCode: 403 })
      );

      const err = await tlsClientEngine.scrape(defaultMeta()).catch((e: Error) => e);
      expect((err as HttpError).engine).toBe("tlsclient");
    });
  });

  // -----------------------------------------------------------------------
  // Content validation
  // -----------------------------------------------------------------------

  describe("content validation", () => {
    it("throws InsufficientContentError when content is too short", async () => {
      mockGotScraping.mockResolvedValue(mockGotResponse("<html><body>Hi</body></html>"));

      await expect(tlsClientEngine.scrape(defaultMeta())).rejects.toThrow(InsufficientContentError);
    });

    it("InsufficientContentError has correct contentLength", async () => {
      mockGotScraping.mockResolvedValue(mockGotResponse("<html><body>short</body></html>"));

      const err = await tlsClientEngine.scrape(defaultMeta()).catch((e: Error) => e);
      expect(err).toBeInstanceOf(InsufficientContentError);
      expect((err as InsufficientContentError).contentLength).toBeLessThan(100);
      expect((err as InsufficientContentError).threshold).toBe(100);
    });
  });

  // -----------------------------------------------------------------------
  // JS required / challenge detection
  // -----------------------------------------------------------------------

  describe("JS required / challenge detection", () => {
    it("throws ChallengeDetectedError for Cloudflare JS challenge", async () => {
      const challengeHtml = `
        <html><body>
          <div class="cf-browser-verification">Verifying</div>
          <script src="/cdn-cgi/challenge-platform/scripts/xyz.js"></script>
          ${"Filler to pass length. ".repeat(10)}
        </body></html>
      `;
      mockGotScraping.mockResolvedValue(mockGotResponse(challengeHtml));

      await expect(tlsClientEngine.scrape(defaultMeta())).rejects.toThrow(ChallengeDetectedError);
    });

    it("ChallengeDetectedError includes 'cloudflare-js' type for CF patterns", async () => {
      const cfHtml = `
        <html><body>
          <div class="cf-browser-verification">Wait</div>
          ${"Content padding. ".repeat(10)}
        </body></html>
      `;
      mockGotScraping.mockResolvedValue(mockGotResponse(cfHtml));

      const err = await tlsClientEngine.scrape(defaultMeta()).catch((e: Error) => e);
      expect(err).toBeInstanceOf(ChallengeDetectedError);
      expect((err as ChallengeDetectedError).challengeType).toBe("cloudflare-js");
    });

    it("detects 'Enable JavaScript' pattern", async () => {
      const jsHtml = `
        <html><body>
          <noscript>Enable JavaScript to view this page.</noscript>
          ${"Padding text to pass min length check. ".repeat(10)}
        </body></html>
      `;
      mockGotScraping.mockResolvedValue(mockGotResponse(jsHtml));

      await expect(tlsClientEngine.scrape(defaultMeta())).rejects.toThrow(ChallengeDetectedError);
    });

    it("detects 'JavaScript is required' pattern", async () => {
      const jsHtml = `
        <html><body>
          <p>JavaScript is required to use this application.</p>
          ${"More padding content for the test. ".repeat(10)}
        </body></html>
      `;
      mockGotScraping.mockResolvedValue(mockGotResponse(jsHtml));

      await expect(tlsClientEngine.scrape(defaultMeta())).rejects.toThrow(ChallengeDetectedError);
    });
  });

  // -----------------------------------------------------------------------
  // Blocked pattern detection
  // -----------------------------------------------------------------------

  describe("blocked pattern detection", () => {
    it("throws ChallengeDetectedError for 'Access denied' pattern", async () => {
      const blockedHtml = `
        <html><body>
          <h1>Access denied</h1>
          <p>You do not have access to this resource.</p>
          ${"Padding content for minimum length. ".repeat(10)}
        </body></html>
      `;
      mockGotScraping.mockResolvedValue(mockGotResponse(blockedHtml));

      await expect(tlsClientEngine.scrape(defaultMeta())).rejects.toThrow(ChallengeDetectedError);
    });

    it("throws ChallengeDetectedError for 'bot detected' pattern", async () => {
      const botHtml = `
        <html><body>
          <p>Our systems have detected that you are a bot detected.</p>
          ${"Filler text for the test page. ".repeat(10)}
        </body></html>
      `;
      mockGotScraping.mockResolvedValue(mockGotResponse(botHtml));

      await expect(tlsClientEngine.scrape(defaultMeta())).rejects.toThrow(ChallengeDetectedError);
    });

    it("throws ChallengeDetectedError for 'too many requests' pattern", async () => {
      const tooManyHtml = `
        <html><body>
          <p>Error: too many requests from your IP address.</p>
          ${"Text padding for minimum content length. ".repeat(10)}
        </body></html>
      `;
      mockGotScraping.mockResolvedValue(mockGotResponse(tooManyHtml));

      await expect(tlsClientEngine.scrape(defaultMeta())).rejects.toThrow(ChallengeDetectedError);
    });

    it("does NOT throw for normal page content", async () => {
      mockGotScraping.mockResolvedValue(mockGotResponse(VALID_HTML));

      const result = await tlsClientEngine.scrape(defaultMeta());
      expect(result.statusCode).toBe(200);
    });
  });

  // -----------------------------------------------------------------------
  // Network / timeout errors
  // -----------------------------------------------------------------------

  describe("network and timeout errors", () => {
    it("throws EngineTimeoutError on TimeoutError", async () => {
      const timeoutErr = new Error("Timeout awaiting response");
      timeoutErr.name = "TimeoutError";
      mockGotScraping.mockRejectedValue(timeoutErr);

      await expect(tlsClientEngine.scrape(defaultMeta())).rejects.toThrow(EngineTimeoutError);
    });

    it("throws EngineTimeoutError when error message contains 'timeout'", async () => {
      mockGotScraping.mockRejectedValue(new Error("Request timeout exceeded"));

      await expect(tlsClientEngine.scrape(defaultMeta())).rejects.toThrow(EngineTimeoutError);
    });

    it("EngineTimeoutError includes maxTimeout value (15000)", async () => {
      const timeoutErr = new Error("timeout");
      timeoutErr.name = "TimeoutError";
      mockGotScraping.mockRejectedValue(timeoutErr);

      const err = await tlsClientEngine.scrape(defaultMeta()).catch((e: Error) => e);
      expect(err).toBeInstanceOf(EngineTimeoutError);
      expect((err as EngineTimeoutError).timeoutMs).toBe(15000);
    });

    it("throws EngineTimeoutError on AbortError", async () => {
      const abortErr = new DOMException("The operation was aborted", "AbortError");
      mockGotScraping.mockRejectedValue(abortErr);

      await expect(tlsClientEngine.scrape(defaultMeta())).rejects.toThrow(EngineTimeoutError);
    });

    it("wraps generic Error as EngineError", async () => {
      mockGotScraping.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(tlsClientEngine.scrape(defaultMeta())).rejects.toThrow(EngineError);
    });

    it("wraps non-Error values as EngineError", async () => {
      mockGotScraping.mockRejectedValue("string error");

      await expect(tlsClientEngine.scrape(defaultMeta())).rejects.toThrow(EngineError);
    });

    it("EngineError includes engine name 'tlsclient'", async () => {
      mockGotScraping.mockRejectedValue(new Error("connection failed"));

      const err = await tlsClientEngine.scrape(defaultMeta()).catch((e: Error) => e);
      expect(err).toBeInstanceOf(EngineError);
      expect((err as EngineError).engine).toBe("tlsclient");
    });
  });

  // -----------------------------------------------------------------------
  // isAvailable
  // -----------------------------------------------------------------------

  describe("isAvailable", () => {
    it("returns true when got-scraping is loaded (mock is defined)", () => {
      // Our mock ensures gotScraping is truthy
      expect(tlsClientEngine.isAvailable()).toBe(true);
    });

    it("new instance returns true when gotScraping is defined", () => {
      const engine = new TlsClientEngine();
      expect(engine.isAvailable()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Unavailable engine
  // -----------------------------------------------------------------------

  describe("unavailable engine", () => {
    it("throws EngineUnavailableError when engine is not available", async () => {
      // Create an engine that's explicitly unavailable
      const engine = new TlsClientEngine();
      // Access private field via cast
      (engine as any).available = false;

      await expect(engine.scrape(defaultMeta())).rejects.toThrow(EngineUnavailableError);
    });
  });

  // -----------------------------------------------------------------------
  // Config
  // -----------------------------------------------------------------------

  describe("config", () => {
    it("has engine name 'tlsclient'", () => {
      expect(tlsClientEngine.config.name).toBe("tlsclient");
    });

    it("has maxTimeout of 15000", () => {
      expect(tlsClientEngine.config.maxTimeout).toBe(15000);
    });

    it("has TLS fingerprint feature enabled", () => {
      expect(tlsClientEngine.config.features.tlsFingerprint).toBe(true);
    });

    it("does not have javascript feature", () => {
      expect(tlsClientEngine.config.features.javascript).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Abort signal handling
  // -----------------------------------------------------------------------

  describe("abort signal", () => {
    it("links external abort signal", async () => {
      mockGotScraping.mockResolvedValue(mockGotResponse(VALID_HTML));

      const controller = new AbortController();
      await tlsClientEngine.scrape(defaultMeta({ abortSignal: controller.signal }));

      // Should not throw - engine completed normally
      expect(mockGotScraping).toHaveBeenCalledTimes(1);
    });

    it("external abort during scrape causes EngineTimeoutError", async () => {
      const abortErr = new DOMException("aborted", "AbortError");
      mockGotScraping.mockRejectedValue(abortErr);

      const controller = new AbortController();
      controller.abort();

      await expect(
        tlsClientEngine.scrape(defaultMeta({ abortSignal: controller.signal }))
      ).rejects.toThrow(EngineTimeoutError);
    });
  });

  // -----------------------------------------------------------------------
  // Re-throws own errors without wrapping
  // -----------------------------------------------------------------------

  describe("error re-throwing", () => {
    it("re-throws ChallengeDetectedError without wrapping", async () => {
      const original = new ChallengeDetectedError("tlsclient", "cloudflare-js");
      mockGotScraping.mockRejectedValue(original);

      const err = await tlsClientEngine.scrape(defaultMeta()).catch((e: Error) => e);
      expect(err).toBe(original);
    });

    it("re-throws HttpError without wrapping", async () => {
      const original = new HttpError("tlsclient", 403, "Forbidden");
      mockGotScraping.mockRejectedValue(original);

      const err = await tlsClientEngine.scrape(defaultMeta()).catch((e: Error) => e);
      expect(err).toBe(original);
    });

    it("re-throws InsufficientContentError without wrapping", async () => {
      const original = new InsufficientContentError("tlsclient", 10, 100);
      mockGotScraping.mockRejectedValue(original);

      const err = await tlsClientEngine.scrape(defaultMeta()).catch((e: Error) => e);
      expect(err).toBe(original);
    });

    it("re-throws EngineUnavailableError without wrapping", async () => {
      const original = new EngineUnavailableError("tlsclient", "not available");
      mockGotScraping.mockRejectedValue(original);

      const err = await tlsClientEngine.scrape(defaultMeta()).catch((e: Error) => e);
      expect(err).toBe(original);
    });
  });
});
