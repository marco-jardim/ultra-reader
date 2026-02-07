import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ReaderError,
  ReaderErrorCode,
  NetworkError,
  TimeoutError,
  CloudflareError,
  AccessDeniedError,
  ContentExtractionError,
  ValidationError,
  InvalidUrlError,
  RobotsBlockedError,
  BrowserPoolError,
  ClientClosedError,
  NotInitializedError,
  wrapError,
} from "../errors.js";

describe("ReaderError", () => {
  it("sets name, code, message, timestamp, and retryable defaults", () => {
    const err = new ReaderError("something broke", ReaderErrorCode.UNKNOWN);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ReaderError);
    expect(err.name).toBe("ReaderError");
    expect(err.code).toBe(ReaderErrorCode.UNKNOWN);
    expect(err.message).toBe("something broke");
    expect(err.retryable).toBe(false);
    expect(err.url).toBeUndefined();
    expect(err.cause).toBeUndefined();

    // timestamp is a valid ISO string
    const parsed = new Date(err.timestamp);
    expect(parsed.toISOString()).toBe(err.timestamp);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
  });

  it("accepts url and cause options", () => {
    const cause = new Error("root cause");
    const err = new ReaderError("outer", ReaderErrorCode.NETWORK_ERROR, {
      url: "https://example.com",
      cause,
      retryable: true,
    });

    expect(err.url).toBe("https://example.com");
    expect(err.cause).toBe(cause);
    expect(err.retryable).toBe(true);
  });

  it("toJSON() returns all fields", () => {
    const cause = new Error("root");
    const err = new ReaderError("msg", ReaderErrorCode.UNKNOWN, {
      url: "https://example.com",
      cause,
    });

    const json = err.toJSON();
    expect(json).toEqual({
      name: "ReaderError",
      code: "UNKNOWN",
      message: "msg",
      url: "https://example.com",
      timestamp: err.timestamp,
      retryable: false,
      cause: "root",
      stack: expect.any(String),
    });
  });

  it("toJSON() handles missing optional fields", () => {
    const err = new ReaderError("msg", ReaderErrorCode.UNKNOWN);
    const json = err.toJSON();

    expect(json.url).toBeUndefined();
    expect(json.cause).toBeUndefined();
  });
});

describe("NetworkError", () => {
  it("has code=NETWORK_ERROR, retryable=true, name=NetworkError", () => {
    const err = new NetworkError("conn failed");

    expect(err).toBeInstanceOf(ReaderError);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.name).toBe("NetworkError");
    expect(err.code).toBe(ReaderErrorCode.NETWORK_ERROR);
    expect(err.retryable).toBe(true);
    expect(err.message).toBe("conn failed");
  });

  it("passes through url and cause", () => {
    const cause = new Error("ECONNREFUSED");
    const err = new NetworkError("conn refused", { url: "https://test.com", cause });

    expect(err.url).toBe("https://test.com");
    expect(err.cause).toBe(cause);
  });
});

describe("TimeoutError", () => {
  it("has code=TIMEOUT, retryable=true, stores timeoutMs", () => {
    const err = new TimeoutError("page load timed out", 5000);

    expect(err).toBeInstanceOf(ReaderError);
    expect(err.name).toBe("TimeoutError");
    expect(err.code).toBe(ReaderErrorCode.TIMEOUT);
    expect(err.retryable).toBe(true);
    expect(err.timeoutMs).toBe(5000);
  });

  it("toJSON includes timeoutMs", () => {
    const err = new TimeoutError("timeout", 10000, { url: "https://slow.com" });
    const json = err.toJSON();

    expect(json.timeoutMs).toBe(10000);
    expect(json.code).toBe("TIMEOUT");
    expect(json.url).toBe("https://slow.com");
    expect(json.retryable).toBe(true);
  });
});

describe("CloudflareError", () => {
  it("has code=CLOUDFLARE_CHALLENGE, retryable=true, stores challengeType", () => {
    const err = new CloudflareError("turnstile");

    expect(err).toBeInstanceOf(ReaderError);
    expect(err.name).toBe("CloudflareError");
    expect(err.code).toBe(ReaderErrorCode.CLOUDFLARE_CHALLENGE);
    expect(err.retryable).toBe(true);
    expect(err.challengeType).toBe("turnstile");
  });

  it("builds message from challengeType", () => {
    const err = new CloudflareError("js_challenge");

    expect(err.message).toContain("js_challenge");
    expect(err.message).toContain("Cloudflare");
    expect(err.message).toContain("challenge not resolved");
  });

  it("toJSON includes challengeType", () => {
    const err = new CloudflareError("managed", { url: "https://cf.com" });
    const json = err.toJSON();

    expect(json.challengeType).toBe("managed");
    expect(json.url).toBe("https://cf.com");
  });
});

describe("AccessDeniedError", () => {
  it("has code=ACCESS_DENIED, retryable=false, stores statusCode", () => {
    const err = new AccessDeniedError("forbidden", { statusCode: 403, url: "https://x.com" });

    expect(err).toBeInstanceOf(ReaderError);
    expect(err.name).toBe("AccessDeniedError");
    expect(err.code).toBe(ReaderErrorCode.ACCESS_DENIED);
    expect(err.retryable).toBe(false);
    expect(err.statusCode).toBe(403);
    expect(err.url).toBe("https://x.com");
  });

  it("toJSON includes statusCode", () => {
    const err = new AccessDeniedError("no", { statusCode: 401 });
    const json = err.toJSON();

    expect(json.statusCode).toBe(401);
  });

  it("statusCode is undefined when not provided", () => {
    const err = new AccessDeniedError("denied");
    expect(err.statusCode).toBeUndefined();
  });
});

describe("ContentExtractionError", () => {
  it("has code=CONTENT_EXTRACTION_FAILED, retryable=false", () => {
    const err = new ContentExtractionError("failed to extract");

    expect(err).toBeInstanceOf(ReaderError);
    expect(err.name).toBe("ContentExtractionError");
    expect(err.code).toBe(ReaderErrorCode.CONTENT_EXTRACTION_FAILED);
    expect(err.retryable).toBe(false);
    expect(err.message).toBe("failed to extract");
  });

  it("accepts url and cause", () => {
    const cause = new Error("parse error");
    const err = new ContentExtractionError("bad html", { url: "https://x.com", cause });

    expect(err.url).toBe("https://x.com");
    expect(err.cause).toBe(cause);
  });
});

describe("ValidationError", () => {
  it("has code=INVALID_OPTIONS, retryable=false, stores field", () => {
    const err = new ValidationError("bad value", { field: "timeout" });

    expect(err).toBeInstanceOf(ReaderError);
    expect(err.name).toBe("ValidationError");
    expect(err.code).toBe(ReaderErrorCode.INVALID_OPTIONS);
    expect(err.retryable).toBe(false);
    expect(err.field).toBe("timeout");
  });

  it("toJSON includes field", () => {
    const err = new ValidationError("nope", { field: "proxy", url: "https://x.com" });
    const json = err.toJSON();

    expect(json.field).toBe("proxy");
    expect(json.url).toBe("https://x.com");
  });

  it("field is undefined when not provided", () => {
    const err = new ValidationError("nope");
    expect(err.field).toBeUndefined();
  });
});

describe("InvalidUrlError", () => {
  it("has code=INVALID_URL, retryable=false", () => {
    const err = new InvalidUrlError("not-a-url");

    expect(err).toBeInstanceOf(ReaderError);
    expect(err.name).toBe("InvalidUrlError");
    expect(err.code).toBe(ReaderErrorCode.INVALID_URL);
    expect(err.retryable).toBe(false);
    expect(err.url).toBe("not-a-url");
  });

  it("includes reason in message when provided", () => {
    const err = new InvalidUrlError("ftp://nope", "unsupported protocol");

    expect(err.message).toBe('Invalid URL "ftp://nope": unsupported protocol');
    expect(err.url).toBe("ftp://nope");
  });

  it("uses simple format without reason", () => {
    const err = new InvalidUrlError("garbage");

    expect(err.message).toBe("Invalid URL: garbage");
  });
});

describe("RobotsBlockedError", () => {
  it("has code=ROBOTS_BLOCKED, retryable=false, message includes URL", () => {
    const err = new RobotsBlockedError("https://blocked.com");

    expect(err).toBeInstanceOf(ReaderError);
    expect(err.name).toBe("RobotsBlockedError");
    expect(err.code).toBe(ReaderErrorCode.ROBOTS_BLOCKED);
    expect(err.retryable).toBe(false);
    expect(err.url).toBe("https://blocked.com");
    expect(err.message).toContain("https://blocked.com");
    expect(err.message).toContain("robots.txt");
  });
});

describe("BrowserPoolError", () => {
  it("has code=BROWSER_ERROR, retryable=true", () => {
    const err = new BrowserPoolError("pool exhausted");

    expect(err).toBeInstanceOf(ReaderError);
    expect(err.name).toBe("BrowserPoolError");
    expect(err.code).toBe(ReaderErrorCode.BROWSER_ERROR);
    expect(err.retryable).toBe(true);
    expect(err.message).toBe("pool exhausted");
  });

  it("accepts cause option", () => {
    const cause = new Error("underlying");
    const err = new BrowserPoolError("pool error", { cause });

    expect(err.cause).toBe(cause);
  });
});

describe("ClientClosedError", () => {
  it("has code=CLIENT_CLOSED, retryable=false, standard message", () => {
    const err = new ClientClosedError();

    expect(err).toBeInstanceOf(ReaderError);
    expect(err.name).toBe("ClientClosedError");
    expect(err.code).toBe(ReaderErrorCode.CLIENT_CLOSED);
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("closed");
  });
});

describe("NotInitializedError", () => {
  it("has code=NOT_INITIALIZED, retryable=false, message includes component", () => {
    const err = new NotInitializedError("BrowserPool");

    expect(err).toBeInstanceOf(ReaderError);
    expect(err.name).toBe("NotInitializedError");
    expect(err.code).toBe(ReaderErrorCode.NOT_INITIALIZED);
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("BrowserPool");
    expect(err.message).toContain("not initialized");
  });
});

describe("wrapError", () => {
  it("passes through ReaderError unchanged", () => {
    const original = new NetworkError("already wrapped");
    const result = wrapError(original, "https://example.com");

    expect(result).toBe(original); // same reference
  });

  it("wraps timeout errors as TimeoutError", () => {
    const err = new Error("Request timed out");
    const result = wrapError(err, "https://slow.com");

    expect(result).toBeInstanceOf(TimeoutError);
    expect(result.code).toBe(ReaderErrorCode.TIMEOUT);
    expect(result.retryable).toBe(true);
    expect(result.url).toBe("https://slow.com");
    expect(result.cause).toBe(err);
    expect((result as TimeoutError).timeoutMs).toBe(30000);
  });

  it("wraps 'timeout' keyword (case-insensitive) as TimeoutError", () => {
    const err = new Error("TIMEOUT exceeded");
    const result = wrapError(err);

    expect(result).toBeInstanceOf(TimeoutError);
  });

  it("wraps ECONNREFUSED as NetworkError", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:3000");
    const result = wrapError(err, "https://local.com");

    expect(result).toBeInstanceOf(NetworkError);
    expect(result.code).toBe(ReaderErrorCode.NETWORK_ERROR);
    expect(result.retryable).toBe(true);
    expect(result.message).toContain("Connection refused");
    expect(result.url).toBe("https://local.com");
    expect(result.cause).toBe(err);
  });

  it("wraps 'connection refused' as NetworkError", () => {
    const err = new Error("Connection refused by server");
    const result = wrapError(err);

    expect(result).toBeInstanceOf(NetworkError);
  });

  it("wraps DNS errors (ENOTFOUND) as NetworkError", () => {
    const err = new Error("getaddrinfo ENOTFOUND example.invalid");
    const result = wrapError(err, "https://example.invalid");

    expect(result).toBeInstanceOf(NetworkError);
    expect(result.code).toBe(ReaderErrorCode.NETWORK_ERROR);
    expect(result.message).toContain("DNS lookup failed");
    expect(result.url).toBe("https://example.invalid");
  });

  it("wraps 'dns' keyword as NetworkError", () => {
    const err = new Error("DNS resolution failed");
    const result = wrapError(err);

    expect(result).toBeInstanceOf(NetworkError);
  });

  it("wraps cloudflare errors as CloudflareError", () => {
    const err = new Error("Cloudflare protection detected");
    const result = wrapError(err, "https://cf-site.com");

    expect(result).toBeInstanceOf(CloudflareError);
    expect(result.code).toBe(ReaderErrorCode.CLOUDFLARE_CHALLENGE);
    expect(result.retryable).toBe(true);
    expect((result as CloudflareError).challengeType).toBe("unknown");
    expect(result.url).toBe("https://cf-site.com");
    expect(result.cause).toBe(err);
  });

  it("wraps 'challenge' keyword as CloudflareError", () => {
    const err = new Error("Challenge page encountered");
    const result = wrapError(err);

    expect(result).toBeInstanceOf(CloudflareError);
  });

  it("wraps unknown Error as ReaderError with UNKNOWN code", () => {
    const err = new Error("something unexpected");
    const result = wrapError(err, "https://test.com");

    expect(result).toBeInstanceOf(ReaderError);
    expect(result.code).toBe(ReaderErrorCode.UNKNOWN);
    expect(result.retryable).toBe(false);
    expect(result.message).toBe("something unexpected");
    expect(result.url).toBe("https://test.com");
    expect(result.cause).toBe(err);
  });

  it("wraps a string as ReaderError with UNKNOWN code", () => {
    const result = wrapError("string error");

    expect(result).toBeInstanceOf(ReaderError);
    expect(result.code).toBe(ReaderErrorCode.UNKNOWN);
    expect(result.retryable).toBe(false);
    expect(result.message).toBe("string error");
    expect(result.cause).toBeUndefined();
  });

  it("wraps a number as ReaderError with UNKNOWN code", () => {
    const result = wrapError(42);

    expect(result).toBeInstanceOf(ReaderError);
    expect(result.code).toBe(ReaderErrorCode.UNKNOWN);
    expect(result.message).toBe("42");
  });

  it("wraps null as ReaderError with UNKNOWN code", () => {
    const result = wrapError(null);

    expect(result).toBeInstanceOf(ReaderError);
    expect(result.code).toBe(ReaderErrorCode.UNKNOWN);
    expect(result.message).toBe("null");
  });

  it("wraps undefined as ReaderError with UNKNOWN code", () => {
    const result = wrapError(undefined);

    expect(result).toBeInstanceOf(ReaderError);
    expect(result.message).toBe("undefined");
  });

  it("preserves url parameter for non-Error values", () => {
    const result = wrapError("oops", "https://fail.com");

    expect(result.url).toBe("https://fail.com");
  });
});
