import { describe, it, expect, vi, afterEach } from "vitest";
import { gzipSync } from "node:zlib";
import { fetchSitemap, parseSitemap } from "../../discovery/sitemap-parser.js";

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

describe("parseSitemap", () => {
  it("parses a standard urlset sitemap and extracts metadata", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>https://example.com/a</loc>
    <lastmod>2024-01-01</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
    <image:image>
      <image:loc>https://example.com/a.jpg</image:loc>
    </image:image>
  </url>
</urlset>`;

    const result = parseSitemap(xml);
    expect(result.type).toBe("urlset");
    expect(result.urls).toHaveLength(1);
    expect(result.urls[0].loc).toBe("https://example.com/a");
    expect(result.urls[0].lastmod).toBe("2024-01-01");
    expect(result.urls[0].changefreq).toBe("daily");
    expect(result.urls[0].priority).toBe(0.8);
    expect(result.urls[0].images).toEqual(["https://example.com/a.jpg"]);
  });

  it("parses a sitemapindex and lists child sitemaps", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex>
  <sitemap>
    <loc>https://example.com/s1.xml</loc>
  </sitemap>
</sitemapindex>`;

    const result = parseSitemap(xml);
    expect(result.type).toBe("sitemapindex");
    expect(result.childSitemaps).toEqual(["https://example.com/s1.xml"]);
  });

  it("parses the text format (one URL per line)", () => {
    const txt = `# comment\nhttps://example.com/a\nnot-a-url\n\nhttps://example.com/b`;
    const result = parseSitemap(txt);
    expect(result.type).toBe("text");
    expect(result.urls.map((u) => u.loc)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });
});

describe("fetchSitemap", () => {
  it("resolves sitemap index recursively and deduplicates URLs", async () => {
    const indexXml = `<?xml version="1.0"?><sitemapindex>
      <sitemap><loc>https://example.com/child.xml</loc></sitemap>
    </sitemapindex>`;

    const childXml = `<?xml version="1.0"?><urlset>
      <url><loc>https://example.com/a</loc></url>
      <url><loc>https://example.com/a</loc></url>
      <url><loc>https://example.com/b</loc></url>
    </urlset>`;

    mockFetch(async (input, init) => {
      const url = new URL(String(input));
      expect(init?.method).toBe("GET");

      if (url.pathname === "/index.xml") return new Response(indexXml, { status: 200 });
      if (url.pathname === "/child.xml") return new Response(childXml, { status: 200 });
      return new Response("not found", { status: 404 });
    });

    const result = await fetchSitemap("https://example.com/index.xml", {
      maxDepth: 3,
      maxUrls: 1000,
      timeoutMs: 2000,
    });

    expect(result.urls.map((u) => u.loc).sort()).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(result.totalUrls).toBe(2);
  });

  it("decompresses .gz sitemaps", async () => {
    const xml = `<?xml version="1.0"?><urlset><url><loc>https://example.com/a</loc></url></urlset>`;
    const gz = gzipSync(Buffer.from(xml));

    mockFetch(
      async () =>
        new Response(new Uint8Array(gz), {
          status: 200,
          headers: { "content-type": "application/x-gzip" },
        })
    );

    const result = await fetchSitemap("https://example.com/sitemap.xml.gz", {
      timeoutMs: 2000,
    });

    expect(result.urls.map((u) => u.loc)).toEqual(["https://example.com/a"]);
  });
});
