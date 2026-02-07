import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchOpenApiSpec,
  filterScrapableEndpoints,
  parseOpenApiSpec,
} from "../../discovery/openapi-prober.js";

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

describe("parseOpenApiSpec", () => {
  it("parses an OpenAPI 3.x spec and extracts endpoints", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      servers: [{ url: "https://api.example.com" }],
      paths: {
        "/products": {
          get: {
            summary: "List products",
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { type: "array" },
                  },
                },
              },
            },
          },
        },
      },
    };

    const parsed = parseOpenApiSpec(spec as unknown as Record<string, unknown>);
    expect(parsed.title).toBe("T");
    expect(parsed.servers[0]?.url).toBe("https://api.example.com");
    expect(parsed.endpoints).toHaveLength(1);
    expect(parsed.endpoints[0].path).toBe("/products");
    expect(parsed.endpoints[0].method).toBe("GET");
    expect(parsed.endpoints[0].responses["200"]).toBeTruthy();
  });

  it("parses a Swagger 2.0 spec and builds servers", () => {
    const spec = {
      swagger: "2.0",
      info: { title: "T", version: "1" },
      schemes: ["https"],
      host: "api.example.com",
      basePath: "/v1",
      paths: {
        "/items": {
          get: {
            responses: {
              "200": {
                description: "ok",
                schema: { type: "object" },
              },
            },
          },
        },
      },
    };

    const parsed = parseOpenApiSpec(spec as unknown as Record<string, unknown>);
    expect(parsed.servers[0]?.url).toBe("https://api.example.com/v1");
    expect(parsed.endpoints).toHaveLength(1);
    expect(parsed.endpoints[0].path).toBe("/items");
    expect(parsed.endpoints[0].method).toBe("GET");
  });
});

describe("filterScrapableEndpoints", () => {
  it("filters by method and pathPattern", () => {
    const spec = parseOpenApiSpec({
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      servers: [{ url: "https://api.example.com" }],
      paths: {
        "/a": { get: { responses: { "200": { description: "ok" } } } },
        "/b": { post: { responses: { "200": { description: "ok" } } } },
      },
    } as unknown as Record<string, unknown>);

    const onlyA = filterScrapableEndpoints(spec, {
      methods: ["GET"],
      pathPattern: /^\/a$/,
    });
    expect(onlyA.map((e) => `${e.method} ${e.path}`)).toEqual(["GET /a"]);
  });
});

describe("fetchOpenApiSpec", () => {
  it("supports YAML specs", async () => {
    const yaml = `openapi: 3.0.0
info:
  title: T
  version: "1"
servers:
  - url: https://api.example.com
paths:
  /ping:
    get:
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
`;

    mockFetch(async () => new Response(yaml, { status: 200 }));
    const spec = await fetchOpenApiSpec("https://example.com/openapi.yaml", { timeoutMs: 2000 });
    expect(spec.title).toBe("T");
    expect(spec.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(["GET /ping"]);
  });
});
