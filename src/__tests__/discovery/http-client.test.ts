import { describe, it, expect, vi, afterEach } from "vitest";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("discoveryRequest", () => {
  it("uses got-scraping when proxyUrl is provided", async () => {
    const gotScraping = vi.fn(async (options: any) => {
      return {
        statusCode: 200,
        url: options.url,
        headers: { "content-type": "text/plain" },
        body: "ok",
      };
    });

    vi.doMock("got-scraping", () => ({ gotScraping }));
    const fetchSpy = vi.fn(async () => new Response("should-not-be-used", { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { discoveryRequest } = await import("../../discovery/http-client.js");
    const res = await discoveryRequest("https://example.com", {
      method: "GET",
      timeoutMs: 1000,
      headers: { Accept: "*/*" },
      proxyUrl: "http://proxy.example:8080",
      responseType: "text",
    });

    expect(gotScraping).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.bodyText).toBe("ok");
  });

  it("uses fetch when proxyUrl is not provided", async () => {
    const fetchSpy = vi.fn(async () => new Response("ok", { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { discoveryRequest } = await import("../../discovery/http-client.js");
    const res = await discoveryRequest("https://example.com", {
      method: "GET",
      timeoutMs: 1000,
      headers: { Accept: "*/*" },
      responseType: "text",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.bodyText).toBe("ok");
  });
});
