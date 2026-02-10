import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Engine, EngineMeta, EngineResult, EngineName } from "../../engines/types.js";
import { ENGINE_CONFIGS } from "../../engines/types.js";
import { EngineAffinityCache } from "../../engines/engine-affinity.js";
import { DomainCircuitBreaker } from "../../engines/circuit-breaker.js";
import {
  EngineError,
  ChallengeDetectedError,
  InsufficientContentError,
  HttpError,
  EngineTimeoutError,
  EngineUnavailableError,
  AllEnginesFailedError,
} from "../../engines/errors.js";

// ---------------------------------------------------------------------------
// Mock engines
// ---------------------------------------------------------------------------

function makeMockEngine(name: EngineName, available = true): Engine {
  return {
    config: ENGINE_CONFIGS[name],
    scrape: vi.fn<(meta: EngineMeta) => Promise<EngineResult>>(),
    isAvailable: vi.fn(() => available),
  };
}

const mockHttpEngine = makeMockEngine("http");
const mockTlsClientEngine = makeMockEngine("tlsclient");
const mockHeroEngine = makeMockEngine("hero");

// Mock the three engine modules so the orchestrator picks up our fakes.
vi.mock("../../engines/http/index.js", () => ({
  httpEngine: mockHttpEngine,
}));
vi.mock("../../engines/tlsclient/index.js", () => ({
  tlsClientEngine: mockTlsClientEngine,
}));
vi.mock("../../engines/hero/index.js", () => ({
  heroEngine: mockHeroEngine,
}));

// Import the orchestrator AFTER mocks are in place.
const { EngineOrchestrator } = await import("../../engines/orchestrator.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function successResult(engine: EngineName): EngineResult {
  return {
    html: "<html><body>Hello world</body></html>",
    url: "https://example.com",
    statusCode: 200,
    engine,
    duration: 42,
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

describe("EngineOrchestrator", () => {
  beforeEach(() => {
    // Reset mocks to defaults (all available, no impl)
    for (const eng of [mockHttpEngine, mockTlsClientEngine, mockHeroEngine]) {
      (eng.scrape as ReturnType<typeof vi.fn>).mockReset();
      (eng.isAvailable as ReturnType<typeof vi.fn>).mockReturnValue(true);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Engine order resolution
  // -----------------------------------------------------------------------

  describe("resolveEngineOrder / getAvailableEngines", () => {
    it("returns default order: http, tlsclient, hero", () => {
      const orch = new EngineOrchestrator();
      expect(orch.getAvailableEngines()).toEqual(["http", "tlsclient", "hero"]);
    });

    it("forceEngine restricts to a single engine", () => {
      const orch = new EngineOrchestrator({ forceEngine: "hero" });
      expect(orch.getAvailableEngines()).toEqual(["hero"]);
    });

    it("skipEngines removes specified engines", () => {
      const orch = new EngineOrchestrator({ skipEngines: ["tlsclient", "hero"] });
      expect(orch.getAvailableEngines()).toEqual(["http"]);
    });

    it("custom engines order is respected", () => {
      const orch = new EngineOrchestrator({ engines: ["hero", "http"] });
      expect(orch.getAvailableEngines()).toEqual(["hero", "http"]);
    });

    it("custom engines + skipEngines works together", () => {
      const orch = new EngineOrchestrator({
        engines: ["hero", "tlsclient", "http"],
        skipEngines: ["tlsclient"],
      });
      expect(orch.getAvailableEngines()).toEqual(["hero", "http"]);
    });

    it("filters out unavailable engines", () => {
      (mockHeroEngine.isAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const orch = new EngineOrchestrator();
      expect(orch.getAvailableEngines()).toEqual(["http", "tlsclient"]);
    });

    it("throws AllEnginesFailedError when no engines are available", async () => {
      (mockHttpEngine.isAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);
      (mockTlsClientEngine.isAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);
      (mockHeroEngine.isAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const orch = new EngineOrchestrator();
      await expect(orch.scrape(defaultMeta())).rejects.toThrow(AllEnginesFailedError);
    });
  });

  // -----------------------------------------------------------------------
  // Cascade behaviour
  // -----------------------------------------------------------------------

  describe("scrape – cascade", () => {
    it("returns result from first engine when it succeeds", async () => {
      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockResolvedValue(successResult("http"));

      const orch = new EngineOrchestrator();
      const result = await orch.scrape(defaultMeta());

      expect(result.engine).toBe("http");
      expect(result.attemptedEngines).toEqual(["http"]);
      expect(result.engineErrors.size).toBe(0);
      expect(mockTlsClientEngine.scrape).not.toHaveBeenCalled();
    });

    it("falls back to second engine when the first fails with retryable error", async () => {
      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ChallengeDetectedError("http", "cloudflare")
      );
      (mockTlsClientEngine.scrape as ReturnType<typeof vi.fn>).mockResolvedValue(
        successResult("tlsclient")
      );

      const orch = new EngineOrchestrator();
      const p = orch.scrape(defaultMeta());

      const result = await p;

      expect(result.engine).toBe("tlsclient");
      expect(result.attemptedEngines).toEqual(["http", "tlsclient"]);
      expect(result.engineErrors.has("http")).toBe(true);
    });

    it("falls back through all three engines", async () => {
      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ChallengeDetectedError("http", "cloudflare")
      );
      (mockTlsClientEngine.scrape as ReturnType<typeof vi.fn>).mockRejectedValue(
        new InsufficientContentError("tlsclient", 10, 100)
      );
      (mockHeroEngine.scrape as ReturnType<typeof vi.fn>).mockResolvedValue(successResult("hero"));

      const orch = new EngineOrchestrator();
      const p = orch.scrape(defaultMeta());

      const result = await p;

      expect(result.engine).toBe("hero");
      expect(result.attemptedEngines).toEqual(["http", "tlsclient", "hero"]);
      expect(result.engineErrors.size).toBe(2);
    });

    it("throws AllEnginesFailedError when all engines fail", async () => {
      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ChallengeDetectedError("http", "cloudflare")
      );
      (mockTlsClientEngine.scrape as ReturnType<typeof vi.fn>).mockRejectedValue(
        new EngineTimeoutError("tlsclient", 15000)
      );
      (mockHeroEngine.scrape as ReturnType<typeof vi.fn>).mockRejectedValue(
        new EngineError("hero", "browser crashed")
      );

      const orch = new EngineOrchestrator();
      const p = orch.scrape(defaultMeta());

      const err = await p.catch((e: Error) => e);
      expect(err).toBeInstanceOf(AllEnginesFailedError);
      const allFailed = err as AllEnginesFailedError;
      expect(allFailed.attemptedEngines).toEqual(["http", "tlsclient", "hero"]);
      expect(allFailed.errors.size).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Engine affinity + domain circuit breaker
  // -----------------------------------------------------------------------

  describe("scrape – affinity + circuit breaker", () => {
    it("uses EngineAffinityCache to prefer the historically successful engine for a domain", async () => {
      const cache = new EngineAffinityCache({ now: () => 0, ttlMs: 60_000 });
      const orch = new EngineOrchestrator({ affinityCache: cache });

      // First scrape: hero succeeds after fallbacks; this should seed affinity history.
      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ChallengeDetectedError("http", "cloudflare")
      );
      (mockTlsClientEngine.scrape as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ChallengeDetectedError("tlsclient", "cloudflare")
      );
      (mockHeroEngine.scrape as ReturnType<typeof vi.fn>).mockResolvedValue(successResult("hero"));

      const r1 = await orch.scrape(defaultMeta({ url: "https://example.com" }));
      expect(r1.attemptedEngines).toEqual(["http", "tlsclient", "hero"]);

      // Second scrape: hero should now be tried first.
      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockReset();
      (mockTlsClientEngine.scrape as ReturnType<typeof vi.fn>).mockReset();
      (mockHeroEngine.scrape as ReturnType<typeof vi.fn>).mockReset();

      (mockHeroEngine.scrape as ReturnType<typeof vi.fn>).mockResolvedValue(successResult("hero"));

      const r2 = await orch.scrape(defaultMeta({ url: "https://example.com" }));
      expect(r2.attemptedEngines).toEqual(["hero"]);
      expect(mockHttpEngine.scrape).not.toHaveBeenCalled();
      expect(mockTlsClientEngine.scrape).not.toHaveBeenCalled();

      const snap = cache.getDomainSnapshot("example.com");
      expect(snap).not.toBeNull();
      expect(snap!.entries.hero?.successes).toBe(2);
      expect(snap!.entries.hero?.avgResponseMs).not.toBeNull();
    });

    it("uses DomainCircuitBreaker to short-circuit attempts after threshold and blocks subsequent calls while open", async () => {
      vi.spyOn(Date, "now").mockReturnValue(0);

      const cb = new DomainCircuitBreaker({
        failureThreshold: 2,
        cooldownMs: 60_000,
        halfOpenMaxAttempts: 1,
        resetOnSuccess: true,
      });
      const orch = new EngineOrchestrator({ circuitBreaker: cb });

      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockRejectedValue(
        new EngineError("http", "fail")
      );
      (mockTlsClientEngine.scrape as ReturnType<typeof vi.fn>).mockRejectedValue(
        new EngineError("tlsclient", "fail")
      );
      (mockHeroEngine.scrape as ReturnType<typeof vi.fn>).mockRejectedValue(
        new EngineError("hero", "fail")
      );

      // After 2 failures, the breaker should open and block trying the 3rd engine.
      await expect(orch.scrape(defaultMeta({ url: "https://example.com" }))).rejects.toThrow(
        AllEnginesFailedError
      );
      expect(mockHeroEngine.scrape).not.toHaveBeenCalled();
      expect(cb.getState("example.com")).toBe("open");

      // Subsequent call while still open should be blocked immediately (no engine calls).
      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockReset();
      (mockTlsClientEngine.scrape as ReturnType<typeof vi.fn>).mockReset();
      (mockHeroEngine.scrape as ReturnType<typeof vi.fn>).mockReset();

      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockResolvedValue(successResult("http"));
      (mockTlsClientEngine.scrape as ReturnType<typeof vi.fn>).mockResolvedValue(
        successResult("tlsclient")
      );
      (mockHeroEngine.scrape as ReturnType<typeof vi.fn>).mockResolvedValue(successResult("hero"));

      await expect(orch.scrape(defaultMeta({ url: "https://example.com" }))).rejects.toThrow(
        AllEnginesFailedError
      );
      expect(mockHttpEngine.scrape).not.toHaveBeenCalled();
      expect(mockTlsClientEngine.scrape).not.toHaveBeenCalled();
      expect(mockHeroEngine.scrape).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // shouldRetry
  // -----------------------------------------------------------------------

  describe("shouldRetry (via cascade behaviour)", () => {
    // Helper: set up http to throw `error`, tlsclient to succeed.
    // If cascade reaches tlsclient => shouldRetry was true.
    async function assertRetries(error: Error): Promise<void> {
      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockRejectedValue(error);
      (mockTlsClientEngine.scrape as ReturnType<typeof vi.fn>).mockResolvedValue(
        successResult("tlsclient")
      );

      const orch = new EngineOrchestrator();
      const p = orch.scrape(defaultMeta());

      const result = await p;

      expect(result.engine).toBe("tlsclient");
      expect(result.attemptedEngines).toContain("http");
      expect(result.attemptedEngines).toContain("tlsclient");
    }

    // Helper: set up http to throw `error`, tlsclient should NOT be called.
    async function assertDoesNotRetry(error: Error): Promise<void> {
      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockRejectedValue(error);
      (mockTlsClientEngine.scrape as ReturnType<typeof vi.fn>).mockResolvedValue(
        successResult("tlsclient")
      );

      const orch = new EngineOrchestrator();
      const p = orch.scrape(defaultMeta());

      // Should still throw because cascade was stopped
      const err = await p.catch((e: Error) => e);
      expect(err).toBeInstanceOf(AllEnginesFailedError);
    }

    it("retries on ChallengeDetectedError", async () => {
      await assertRetries(new ChallengeDetectedError("http", "cloudflare"));
    });

    it("retries on InsufficientContentError", async () => {
      await assertRetries(new InsufficientContentError("http", 5, 100));
    });

    it("retries on EngineTimeoutError", async () => {
      await assertRetries(new EngineTimeoutError("http", 10000));
    });

    it("retries on HttpError 403", async () => {
      await assertRetries(new HttpError("http", 403, "Forbidden"));
    });

    it("retries on HttpError 404", async () => {
      await assertRetries(new HttpError("http", 404, "Not Found"));
    });

    it("retries on HttpError 429", async () => {
      await assertRetries(new HttpError("http", 429, "Too Many Requests"));
    });

    it("retries on HttpError 500", async () => {
      await assertRetries(new HttpError("http", 500, "Internal Server Error"));
    });

    it("retries on HttpError 502", async () => {
      await assertRetries(new HttpError("http", 502, "Bad Gateway"));
    });

    it("retries on HttpError 503", async () => {
      await assertRetries(new HttpError("http", 503, "Service Unavailable"));
    });

    it("retries on EngineUnavailableError (skip to next)", async () => {
      await assertRetries(new EngineUnavailableError("http", "not configured"));
    });

    it("does not retry on non-retryable EngineError", async () => {
      const err = new EngineError("http", "fatal error", { retryable: false });
      await assertDoesNotRetry(err);
    });

    it("retries on unknown / generic errors", async () => {
      // Unknown errors default to retryable=true in shouldRetry
      await assertRetries(new Error("some random error"));
    });

    it("retries on HttpError 400 (non-matching status) by checking retryable flag", async () => {
      // HttpError 400 has retryable=false (only 429/5xx are retryable on the error itself),
      // AND 400 doesn't match the orchestrator's explicit status checks (403,404,429,>=500).
      // So shouldRetry returns false via the EngineError.retryable path.
      const err = new HttpError("http", 400, "Bad Request");
      await assertDoesNotRetry(err);
    });
  });

  // -----------------------------------------------------------------------
  // Result metadata
  // -----------------------------------------------------------------------

  describe("result metadata", () => {
    it("includes attemptedEngines and engineErrors", async () => {
      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ChallengeDetectedError("http", "cloudflare")
      );
      (mockTlsClientEngine.scrape as ReturnType<typeof vi.fn>).mockResolvedValue(
        successResult("tlsclient")
      );

      const orch = new EngineOrchestrator();
      const p = orch.scrape(defaultMeta());

      const result = await p;

      expect(result.attemptedEngines).toEqual(["http", "tlsclient"]);
      expect(result.engineErrors).toBeInstanceOf(Map);
      expect(result.engineErrors.get("http")).toBeInstanceOf(ChallengeDetectedError);
    });

    it("result has all EngineResult fields plus orchestrator fields", async () => {
      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockResolvedValue(successResult("http"));

      const orch = new EngineOrchestrator();
      const p = orch.scrape(defaultMeta());

      const result = await p;

      expect(result).toMatchObject({
        html: expect.any(String),
        url: expect.any(String),
        statusCode: 200,
        engine: "http",
        duration: expect.any(Number),
        attemptedEngines: ["http"],
      });
      expect(result.engineErrors).toBeInstanceOf(Map);
    });
  });

  // -----------------------------------------------------------------------
  // Abort signal propagation
  // -----------------------------------------------------------------------

  describe("abort signal propagation", () => {
    it("passes abort signal through to engine scrape calls", async () => {
      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockResolvedValue(successResult("http"));

      const controller = new AbortController();
      const meta = defaultMeta({ abortSignal: controller.signal });

      const orch = new EngineOrchestrator();
      const p = orch.scrape(meta);

      await p;

      // The orchestrator wraps the signal in its own controller, but the
      // meta passed to the engine should have an abortSignal property.
      const callArgs = (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as EngineMeta;
      expect(callArgs.abortSignal).toBeDefined();
      expect(callArgs.abortSignal).toBeInstanceOf(AbortSignal);
    });

    it("external abort triggers the engine's abort signal", async () => {
      // Make scrape hang until we inspect the signal
      let capturedSignal: AbortSignal | undefined;
      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockImplementation(
        async (meta: EngineMeta) => {
          capturedSignal = meta.abortSignal;
          // Simulate waiting
          return new Promise((_resolve, reject) => {
            meta.abortSignal?.addEventListener("abort", () => {
              reject(new EngineTimeoutError("http", 10000));
            });
          });
        }
      );

      const controller = new AbortController();
      const orch = new EngineOrchestrator({ forceEngine: "http" });
      const p = orch.scrape(defaultMeta({ abortSignal: controller.signal }));

      // Now abort externally
      controller.abort();

      expect(capturedSignal?.aborted).toBe(true);

      // The promise should reject (all engines failed)
      const err = await p.catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
    });
  });

  // -----------------------------------------------------------------------
  // Logging
  // -----------------------------------------------------------------------

  describe("logging", () => {
    it("calls logger.info when verbose is true", async () => {
      const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockResolvedValue(successResult("http"));

      const orch = new EngineOrchestrator({ logger: logger as any, verbose: true });
      const p = orch.scrape(defaultMeta());

      await p;

      expect(logger.info).toHaveBeenCalled();
    });

    it("calls logger.debug when verbose is false", async () => {
      const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockResolvedValue(successResult("http"));

      const orch = new EngineOrchestrator({ logger: logger as any, verbose: false });
      const p = orch.scrape(defaultMeta());

      await p;

      expect(logger.debug).toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // createOrchestrator / orchestratedScrape convenience functions
  // -----------------------------------------------------------------------

  describe("convenience functions", () => {
    it("createOrchestrator returns an EngineOrchestrator instance", async () => {
      const { createOrchestrator } = await import("../../engines/orchestrator.js");
      const orch = createOrchestrator({ forceEngine: "http" });
      expect(orch).toBeInstanceOf(EngineOrchestrator);
      expect(orch.getAvailableEngines()).toEqual(["http"]);
    });

    it("orchestratedScrape creates orchestrator and scrapes", async () => {
      (mockHttpEngine.scrape as ReturnType<typeof vi.fn>).mockResolvedValue(successResult("http"));

      const { orchestratedScrape } = await import("../../engines/orchestrator.js");
      const p = orchestratedScrape(defaultMeta(), { forceEngine: "http" });

      const result = await p;

      expect(result.engine).toBe("http");
      expect(result.attemptedEngines).toEqual(["http"]);
    });
  });
});
