import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateSummary,
  loadCachedProfile,
  saveCachedProfile,
  type SiteProfile,
} from "../../discovery/site-profile.js";

function baseProfile(): Omit<SiteProfile, "summary"> {
  return {
    domain: "example.com",
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    contentHash: "hash",
    sitemap: {
      found: false,
      sources: [],
      totalUrls: 0,
      topUrls: [],
    },
    openapi: {
      found: false,
      publicEndpoints: [],
      protectedEndpoints: [],
    },
    graphql: {
      found: false,
      introspectionEnabled: false,
      sampleQueries: [],
    },
    discoveredApis: {
      patterns: [],
      totalRequests: 0,
      uniqueEndpoints: 0,
    },
    endpointProfiles: [],
    feeds: [],
    wellKnownResults: [],
  };
}

describe("generateSummary", () => {
  it("recommends 'api' when OpenAPI has public endpoints", () => {
    const base = baseProfile();
    base.openapi.found = true;
    base.openapi.publicEndpoints = [
      {
        path: "/products",
        method: "GET",
        parameters: [],
        responses: { "200": { description: "ok" } },
        security: [],
      },
    ];

    const summary = generateSummary(base);
    expect(summary.recommendedStrategy).toBe("api");
    expect(summary.publicApiCount).toBeGreaterThan(0);
  });
});

describe("profile cache", () => {
  it("saves and loads cached profiles", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ultra-reader-"));
    try {
      const base = baseProfile();
      const profile: SiteProfile = {
        ...base,
        summary: generateSummary(base),
      };

      await saveCachedProfile(profile, dir);
      const loaded = await loadCachedProfile(profile.domain, dir, 24 * 60 * 60 * 1000);
      expect(loaded?.domain).toBe("example.com");
      expect(loaded?.schemaVersion).toBe(1);
      expect(loaded?.summary.recommendedStrategy).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
