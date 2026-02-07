import { describe, it, expect, vi, afterEach } from "vitest";
import { probeWellKnownPaths, WELL_KNOWN_PATHS } from "../../discovery/well-known-paths.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockFetch(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("probeWellKnownPaths", () => {
  it("uses HEAD requests and marks 2xx as found", async () => {
    const okPath = WELL_KNOWN_PATHS.openapi[0];

    const fetchMock = mockFetch(async (input, init) => {
      const url = new URL(String(input));
      expect(init?.method).toBe("HEAD");

      if (url.pathname === okPath) {
        return new Response("", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": "0",
          },
        });
      }

      return new Response("", { status: 404 });
    });

    const result = await probeWellKnownPaths("https://example.com", {
      categories: ["openapi"],
      concurrency: 1,
      timeoutMs: 1000,
      userAgent: "UA-Test",
    });

    expect(fetchMock).toHaveBeenCalled();
    const openapiResults = result.get("openapi");
    expect(openapiResults).toBeTruthy();

    const ok = openapiResults!.find((r) => r.path === okPath);
    expect(ok?.found).toBe(true);
    expect(ok?.statusCode).toBe(200);
    expect(ok?.contentType).toContain("application/json");
  });

  it("can probe only specific categories", async () => {
    const fetchMock = mockFetch(async () => new Response("", { status: 404 }));

    const result = await probeWellKnownPaths("https://example.com", {
      categories: ["service"],
      concurrency: 2,
      timeoutMs: 1000,
    });

    expect(result.has("service")).toBe(true);
    expect(result.has("openapi")).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(WELL_KNOWN_PATHS.service.length);
  });
});
