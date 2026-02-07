import { describe, it, expect } from "vitest";
import {
  EngineError,
  ChallengeDetectedError,
  InsufficientContentError,
  HttpError,
  EngineTimeoutError,
  EngineUnavailableError,
  NextEngineSignal,
  AllEnginesFailedError,
} from "../../engines/errors.js";
import type { EngineName } from "../../engines/types.js";

describe("EngineError", () => {
  it("stores engine name and prefixes message with engine", () => {
    const err = new EngineError("http", "fetch failed");

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(EngineError);
    expect(err.name).toBe("EngineError");
    expect(err.engine).toBe("http");
    expect(err.message).toBe("[http] fetch failed");
  });

  it("defaults retryable to true", () => {
    const err = new EngineError("hero", "something");
    expect(err.retryable).toBe(true);
  });

  it("allows overriding retryable", () => {
    const err = new EngineError("http", "fatal", { retryable: false });
    expect(err.retryable).toBe(false);
  });

  it("stores cause when provided", () => {
    const cause = new Error("root");
    const err = new EngineError("tlsclient", "wrapped", { cause });
    expect(err.cause).toBe(cause);
  });

  it("cause is undefined when not provided", () => {
    const err = new EngineError("http", "no cause");
    expect(err.cause).toBeUndefined();
  });
});

describe("ChallengeDetectedError", () => {
  it("is retryable and stores challengeType", () => {
    const err = new ChallengeDetectedError("hero", "turnstile");

    expect(err).toBeInstanceOf(EngineError);
    expect(err.name).toBe("ChallengeDetectedError");
    expect(err.engine).toBe("hero");
    expect(err.retryable).toBe(true);
    expect(err.challengeType).toBe("turnstile");
    expect(err.message).toContain("turnstile");
  });

  it("defaults challengeType to 'unknown'", () => {
    const err = new ChallengeDetectedError("http");

    expect(err.challengeType).toBe("unknown");
    expect(err.message).toContain("unknown");
  });

  it("defaults challengeType to 'unknown' when explicitly undefined", () => {
    const err = new ChallengeDetectedError("http", undefined);

    expect(err.challengeType).toBe("unknown");
  });
});

describe("InsufficientContentError", () => {
  it("is retryable, stores contentLength and threshold", () => {
    const err = new InsufficientContentError("hero", 42, 200);

    expect(err).toBeInstanceOf(EngineError);
    expect(err.name).toBe("InsufficientContentError");
    expect(err.engine).toBe("hero");
    expect(err.retryable).toBe(true);
    expect(err.contentLength).toBe(42);
    expect(err.threshold).toBe(200);
    expect(err.message).toContain("42");
    expect(err.message).toContain("200");
  });

  it("defaults threshold to 100", () => {
    const err = new InsufficientContentError("http", 50);

    expect(err.threshold).toBe(100);
    expect(err.contentLength).toBe(50);
    expect(err.message).toContain("100");
  });

  it("handles zero content length", () => {
    const err = new InsufficientContentError("tlsclient", 0);

    expect(err.contentLength).toBe(0);
    expect(err.message).toContain("0");
  });
});

describe("HttpError", () => {
  it("stores statusCode and includes it in message", () => {
    const err = new HttpError("http", 404, "Not Found");

    expect(err).toBeInstanceOf(EngineError);
    expect(err.name).toBe("HttpError");
    expect(err.engine).toBe("http");
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain("404");
    expect(err.message).toContain("Not Found");
  });

  it("is NOT retryable for 4xx errors (except 429)", () => {
    expect(new HttpError("http", 400).retryable).toBe(false);
    expect(new HttpError("http", 401).retryable).toBe(false);
    expect(new HttpError("http", 403).retryable).toBe(false);
    expect(new HttpError("http", 404).retryable).toBe(false);
    expect(new HttpError("http", 422).retryable).toBe(false);
  });

  it("IS retryable for 429 (rate limited)", () => {
    const err = new HttpError("http", 429, "Too Many Requests");
    expect(err.retryable).toBe(true);
  });

  it("IS retryable for 5xx errors", () => {
    expect(new HttpError("http", 500).retryable).toBe(true);
    expect(new HttpError("http", 502).retryable).toBe(true);
    expect(new HttpError("http", 503).retryable).toBe(true);
    expect(new HttpError("http", 504).retryable).toBe(true);
  });

  it("handles statusText being omitted", () => {
    const err = new HttpError("http", 500);
    expect(err.message).toBe("[http] HTTP 500");
  });
});

describe("EngineTimeoutError", () => {
  it("is retryable and stores timeoutMs", () => {
    const err = new EngineTimeoutError("hero", 15000);

    expect(err).toBeInstanceOf(EngineError);
    expect(err.name).toBe("EngineTimeoutError");
    expect(err.engine).toBe("hero");
    expect(err.retryable).toBe(true);
    expect(err.timeoutMs).toBe(15000);
    expect(err.message).toContain("15000");
  });
});

describe("EngineUnavailableError", () => {
  it("stores engine name and has default message", () => {
    const err = new EngineUnavailableError("hero");

    expect(err).toBeInstanceOf(EngineError);
    expect(err.name).toBe("EngineUnavailableError");
    expect(err.engine).toBe("hero");
    expect(err.message).toContain("not available");
  });

  it("uses custom reason as message", () => {
    const err = new EngineUnavailableError("tlsclient", "binary not found");
    expect(err.message).toContain("binary not found");
  });

  it("is NOT retryable (engine is permanently unavailable)", () => {
    const err = new EngineUnavailableError("hero");
    expect(err.retryable).toBe(false);
  });
});

describe("NextEngineSignal", () => {
  it("is NOT an EngineError (control flow only)", () => {
    const signal = new NextEngineSignal("http", "content too short");

    expect(signal).toBeInstanceOf(Error);
    expect(signal).not.toBeInstanceOf(EngineError);
    expect(signal.name).toBe("NextEngineSignal");
  });

  it("stores fromEngine and reason", () => {
    const signal = new NextEngineSignal("hero", "js rendering needed");

    expect(signal.fromEngine).toBe("hero");
    expect(signal.reason).toBe("js rendering needed");
    expect(signal.message).toContain("hero");
    expect(signal.message).toContain("js rendering needed");
  });
});

describe("AllEnginesFailedError", () => {
  it("stores attemptedEngines and errors map", () => {
    const engines: EngineName[] = ["http", "hero"];
    const errors = new Map<EngineName, Error>([
      ["http", new Error("timeout")],
      ["hero", new Error("crashed")],
    ]);

    const err = new AllEnginesFailedError(engines, errors);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(EngineError);
    expect(err.name).toBe("AllEnginesFailedError");
    expect(err.attemptedEngines).toEqual(["http", "hero"]);
    expect(err.errors).toBe(errors);
  });

  it("message lists all engines and their errors", () => {
    const engines: EngineName[] = ["http", "tlsclient", "hero"];
    const errors = new Map<EngineName, Error>([
      ["http", new Error("DNS failure")],
      ["tlsclient", new Error("TLS handshake failed")],
      ["hero", new Error("browser crashed")],
    ]);

    const err = new AllEnginesFailedError(engines, errors);

    expect(err.message).toContain("All engines failed");
    expect(err.message).toContain("http: DNS failure");
    expect(err.message).toContain("tlsclient: TLS handshake failed");
    expect(err.message).toContain("hero: browser crashed");
  });

  it("handles engines with no corresponding error as 'unknown'", () => {
    const engines: EngineName[] = ["http", "hero"];
    const errors = new Map<EngineName, Error>([
      ["http", new Error("fail")],
      // hero has no entry
    ]);

    const err = new AllEnginesFailedError(engines, errors);

    expect(err.message).toContain("hero: unknown");
  });

  it("works with a single engine", () => {
    const engines: EngineName[] = ["http"];
    const errors = new Map<EngineName, Error>([["http", new Error("nope")]]);

    const err = new AllEnginesFailedError(engines, errors);

    expect(err.attemptedEngines).toHaveLength(1);
    expect(err.message).toContain("http: nope");
  });

  it("works with empty engine list", () => {
    const err = new AllEnginesFailedError([], new Map());

    expect(err.attemptedEngines).toHaveLength(0);
    expect(err.message).toContain("All engines failed");
  });
});
