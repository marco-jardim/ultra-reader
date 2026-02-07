import { describe, it, expect, vi, afterEach } from "vitest";
import { generateSampleQueries, introspectGraphQL } from "../../discovery/graphql-introspect.js";

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

describe("introspectGraphQL", () => {
  it("returns null when blocked/forbidden", async () => {
    mockFetch(async () => new Response("forbidden", { status: 403 }));
    const schema = await introspectGraphQL("https://example.com/graphql", { timeoutMs: 2000 });
    expect(schema).toBeNull();
  });
});

describe("generateSampleQueries", () => {
  it("generates query documents from a schema", () => {
    const schema = {
      queryType: "Query",
      types: [
        {
          name: "Query",
          kind: "OBJECT",
          fields: [
            {
              name: "products",
              type: "Product",
              args: [],
              isDeprecated: false,
            },
          ],
        },
        {
          name: "Product",
          kind: "OBJECT",
          fields: [
            { name: "id", type: "ID", args: [], isDeprecated: false },
            { name: "title", type: "String", args: [], isDeprecated: false },
          ],
        },
        { name: "ID", kind: "SCALAR" },
        { name: "String", kind: "SCALAR" },
      ],
      userTypes: [
        {
          name: "Query",
          kind: "OBJECT",
          fields: [
            {
              name: "products",
              type: "Product",
              args: [],
              isDeprecated: false,
            },
          ],
        },
        {
          name: "Product",
          kind: "OBJECT",
          fields: [
            { name: "id", type: "ID", args: [], isDeprecated: false },
            { name: "title", type: "String", args: [], isDeprecated: false },
          ],
        },
      ],
      queries: [
        {
          name: "products",
          type: "Product",
          args: [],
          isDeprecated: false,
        },
      ],
      mutations: [],
    };

    const queries = generateSampleQueries(schema as never, { maxDepth: 2, maxQueries: 5 });
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0].query).toContain("query");
    expect(queries[0].query).toContain("products");
  });
});
