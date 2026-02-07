import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { discoverSitemaps, type SitemapUrl } from "./sitemap-parser.js";
import type { ApiPattern, InterceptorOptions } from "./api-interceptor.js";
import {
  fetchOpenApiSpec,
  filterScrapableEndpoints,
  type OpenApiEndpoint,
  type OpenApiSpec,
} from "./openapi-prober.js";
import {
  generateSampleQueries,
  introspectGraphQL,
  type GraphQLSchema,
} from "./graphql-introspect.js";
import {
  profileEndpoints,
  type EndpointProfile,
  calculateScrapabilityScore,
} from "./endpoint-profiler.js";
import {
  probeWellKnownPaths,
  WELL_KNOWN_PATHS,
  type ProbeCategory,
  type WellKnownProbeResult,
} from "./well-known-paths.js";

export interface SiteProfile {
  domain: string;
  generatedAt: string;
  schemaVersion: 1;
  contentHash: string;

  sitemap: {
    found: boolean;
    sources: Array<{ url: string; foundVia: string }>;
    totalUrls: number;
    topUrls: SitemapUrl[];
    lastModified?: string;
  };

  openapi: {
    found: boolean;
    specUrl?: string;
    spec?: OpenApiSpec;
    publicEndpoints: OpenApiEndpoint[];
    protectedEndpoints: OpenApiEndpoint[];
  };

  graphql: {
    found: boolean;
    endpoint?: string;
    schema?: GraphQLSchema;
    introspectionEnabled: boolean;
    sampleQueries: Array<{ name: string; query: string }>;
  };

  discoveredApis: {
    patterns: ApiPattern[];
    totalRequests: number;
    uniqueEndpoints: number;
  };

  endpointProfiles: EndpointProfile[];

  feeds: Array<{ url: string; type: "rss" | "atom" | "json-feed"; title?: string }>;

  wellKnownResults: Array<{ path: string; category: string; statusCode: number }>;

  summary: {
    recommendedStrategy: "api" | "sitemap" | "graphql" | "html-scraping" | "mixed";
    reasoning: string;
    overallScrapability: number;
    publicApiCount: number;
    knownUrlCount: number;
    hasSignificantProtection: boolean;
  };
}

export interface DiscoveryOptions {
  probeWellKnown?: boolean;
  parseSitemaps?: boolean;
  discoverOpenApi?: boolean;
  introspectGraphQL?: boolean;
  interceptApiRequests?: boolean;

  /** Options for Phase 1.5.5 Hero network interception */
  apiInterceptorOptions?: InterceptorOptions;
  profileEndpoints?: boolean;
  maxSitemapUrls?: number;
  timeoutMs?: number;
  cacheDir?: string;
  cacheTtlMs?: number;
  /** Network controls for Phase 1.5 discovery requests */
  network?: {
    /** Proxy URL to route discovery traffic through (http(s)://user:pass@host:port) */
    proxyUrl?: string;
    /** Extra headers to send on discovery probes */
    headers?: Record<string, string>;
    /** Fixed user agent for discovery (otherwise per-request rotation may apply) */
    userAgent?: string;
  };
  onProgress?: (stage: string, detail: string) => void;
}

function originOf(url: string): string {
  return new URL(url).origin;
}

function domainOf(url: string): string {
  return new URL(url).hostname;
}

function defaultCacheDir(): string {
  // Use a stable, user-scoped cache dir (avoid polluting the current repo/cwd)
  return join(homedir(), ".ultra-reader", "profiles");
}

function safeFilename(domain: string): string {
  return domain.replace(/[^a-z0-9.-]/gi, "_");
}

export async function loadCachedProfile(
  domain: string,
  cacheDir?: string,
  ttlMs?: number
): Promise<SiteProfile | null> {
  const dir = cacheDir ?? defaultCacheDir();
  const ttl = ttlMs ?? 24 * 60 * 60 * 1000;
  const file = join(dir, `${safeFilename(domain)}.json`);
  try {
    const raw = await readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as SiteProfile;
    if (!parsed || parsed.domain !== domain) return null;
    const generatedAt = Date.parse(parsed.generatedAt);
    if (!Number.isFinite(generatedAt)) return null;
    if (Date.now() - generatedAt > ttl) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveCachedProfile(profile: SiteProfile, cacheDir?: string): Promise<void> {
  const dir = cacheDir ?? defaultCacheDir();
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${safeFilename(profile.domain)}.json`);
  await writeFile(file, JSON.stringify(profile, null, 2), "utf-8");
}

function hashProfile(
  profile: Omit<SiteProfile, "contentHash" | "generatedAt" | "summary">
): string {
  const json = JSON.stringify(profile);
  return createHash("sha256").update(json).digest("hex");
}

export function finalizeProfile(
  profile: Omit<SiteProfile, "summary" | "contentHash" | "generatedAt"> & {
    generatedAt?: string;
  }
): SiteProfile {
  const generatedAt = profile.generatedAt ?? new Date().toISOString();
  const base: Omit<SiteProfile, "summary" | "contentHash"> = {
    ...profile,
    generatedAt,
  };
  const { generatedAt: _ga, ...hashBase } = base;
  void _ga;
  const contentHash = hashProfile(hashBase);
  const withDerived: Omit<SiteProfile, "summary"> = {
    ...base,
    contentHash,
  };
  return {
    ...withDerived,
    summary: generateSummary(withDerived),
  };
}

function isAtomPath(path: string): boolean {
  return /atom/i.test(path);
}

function isJsonFeedPath(path: string): boolean {
  return /\.json$/i.test(path);
}

function pickCategories(): ProbeCategory[] {
  return Object.keys(WELL_KNOWN_PATHS) as ProbeCategory[];
}

export function generateSummary(profile: Omit<SiteProfile, "summary">): SiteProfile["summary"] {
  const openapiPublic = profile.openapi.publicEndpoints.length;
  const openapiFound = profile.openapi.found;
  const sitemapFound = profile.sitemap.found && profile.sitemap.totalUrls > 0;
  const graphqlFound = profile.graphql.found && profile.graphql.introspectionEnabled;

  const viable: Array<SiteProfile["summary"]["recommendedStrategy"]> = [];
  if (openapiFound && openapiPublic > 0) viable.push("api");
  if (graphqlFound) viable.push("graphql");
  if (sitemapFound) viable.push("sitemap");
  if (!viable.length) viable.push("html-scraping");

  const recommendedStrategy = viable.length > 1 ? "mixed" : viable[0];
  const knownUrlCount = profile.sitemap.totalUrls;
  const publicApiCount = openapiPublic;

  const scored = profile.endpointProfiles.length
    ? Math.round(
        profile.endpointProfiles.reduce((acc, p) => acc + p.scrapabilityScore, 0) /
          profile.endpointProfiles.length
      )
    : Math.min(100, (openapiPublic ? 60 : 0) + (graphqlFound ? 50 : 0) + (sitemapFound ? 40 : 0));

  const hasSignificantProtection = profile.endpointProfiles.some(
    (p) => p.status === "blocked" || p.status === "rate-limited"
  );

  const reasoningParts: string[] = [];
  if (openapiFound && openapiPublic)
    reasoningParts.push(`OpenAPI: ${openapiPublic} public endpoints`);
  if (graphqlFound) reasoningParts.push("GraphQL introspection enabled");
  if (sitemapFound) reasoningParts.push(`Sitemap: ${profile.sitemap.totalUrls} URLs`);
  if (!reasoningParts.length) reasoningParts.push("No structured sources found");

  return {
    recommendedStrategy,
    reasoning: reasoningParts.join("; "),
    overallScrapability: scored,
    publicApiCount,
    knownUrlCount,
    hasSignificantProtection,
  };
}

export async function discoverSite(url: string, options?: DiscoveryOptions): Promise<SiteProfile> {
  const domain = domainOf(url);
  const origin = originOf(url);
  const timeoutMs = options?.timeoutMs ?? 60_000;
  const maxSitemapUrls = options?.maxSitemapUrls ?? 1000;
  const network = options?.network;

  options?.onProgress?.("start", domain);

  const base: Omit<SiteProfile, "summary" | "contentHash" | "generatedAt"> = {
    domain,
    schemaVersion: 1,
    sitemap: {
      found: false,
      sources: [],
      totalUrls: 0,
      topUrls: [],
      lastModified: undefined,
    },
    openapi: {
      found: false,
      specUrl: undefined,
      spec: undefined,
      publicEndpoints: [],
      protectedEndpoints: [],
    },
    graphql: {
      found: false,
      endpoint: undefined,
      schema: undefined,
      introspectionEnabled: false,
      sampleQueries: [],
    },
    discoveredApis: { patterns: [], totalRequests: 0, uniqueEndpoints: 0 },
    endpointProfiles: [],
    feeds: [],
    wellKnownResults: [],
  };

  // 1) well-known probing
  let probes: Map<ProbeCategory, WellKnownProbeResult[]> | null = null;
  if (options?.probeWellKnown !== false) {
    options?.onProgress?.("probe", "well-known paths");
    const result = await probeWellKnownPaths(origin, {
      categories: pickCategories(),
      timeoutMs: Math.min(8_000, timeoutMs),
      concurrency: 4,
      userAgent: network?.userAgent,
      headers: network?.headers,
      proxyUrl: network?.proxyUrl,
    });
    probes = result;
    for (const [category, items] of result.entries()) {
      for (const it of items) {
        if (it.found) {
          base.wellKnownResults.push({ path: it.path, category, statusCode: it.statusCode });
          if (category === "feed") {
            const type = isJsonFeedPath(it.path)
              ? "json-feed"
              : isAtomPath(it.path)
                ? "atom"
                : "rss";
            base.feeds.push({ url: it.finalUrl, type });
          }
        }
      }
    }
  }

  // 2) sitemap discovery
  if (options?.parseSitemaps !== false) {
    options?.onProgress?.("sitemap", "discover");
    try {
      const sitemap = await discoverSitemaps(origin, {
        timeoutMs: Math.min(15_000, timeoutMs),
        maxUrls: Math.max(maxSitemapUrls, 1),
        userAgent: network?.userAgent,
        headers: network?.headers,
        proxyUrl: network?.proxyUrl,
      });
      base.sitemap.found = sitemap.totalUrls > 0;
      base.sitemap.sources = sitemap.sources;
      base.sitemap.totalUrls = sitemap.totalUrls;
      base.sitemap.topUrls = sitemap.urls
        .slice()
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
        .slice(0, maxSitemapUrls);
      const last = sitemap.urls
        .map((u) => u.lastmod)
        .filter((x): x is string => !!x)
        .sort()
        .at(-1);
      base.sitemap.lastModified = last;
    } catch {
      // ignore
    }
  }

  // 3) OpenAPI discovery (from probes, avoid re-probing)
  if (options?.discoverOpenApi !== false) {
    options?.onProgress?.("openapi", "discover");
    const openapiCandidates: string[] = [];
    const openapiItems = probes?.get("openapi") ?? [];
    for (const it of openapiItems) {
      if (it.found) openapiCandidates.push(it.finalUrl);
    }
    const unique = [...new Set(openapiCandidates)];
    for (const candidate of unique) {
      try {
        const spec = await fetchOpenApiSpec(candidate, {
          timeoutMs: Math.min(15_000, timeoutMs),
          userAgent: network?.userAgent,
          headers: network?.headers,
          proxyUrl: network?.proxyUrl,
        });
        base.openapi.found = true;
        base.openapi.specUrl = candidate;
        base.openapi.spec = spec;
        const endpoints = spec.endpoints;
        base.openapi.publicEndpoints = endpoints.filter((e) => e.security.length === 0);
        base.openapi.protectedEndpoints = endpoints.filter((e) => e.security.length > 0);
        break;
      } catch {
        // try next
      }
    }

    // If nothing found via probing, do a small fallback pass
    if (!base.openapi.found) {
      try {
        const spec = await (
          await import("./openapi-prober.js")
        ).discoverOpenApi(origin, {
          timeoutMs: Math.min(15_000, timeoutMs),
          userAgent: network?.userAgent,
          headers: network?.headers,
          proxyUrl: network?.proxyUrl,
        });
        if (spec) {
          base.openapi.found = true;
          base.openapi.spec = spec;
          base.openapi.publicEndpoints = spec.endpoints.filter((e) => e.security.length === 0);
          base.openapi.protectedEndpoints = spec.endpoints.filter((e) => e.security.length > 0);
        }
      } catch {
        // ignore
      }
    }
  }

  // 4) GraphQL introspection
  if (options?.introspectGraphQL !== false) {
    options?.onProgress?.("graphql", "introspect");
    const gqlCandidates: string[] = [];
    const gqlItems = probes?.get("graphql") ?? [];
    for (const it of gqlItems) {
      if (it.found) gqlCandidates.push(it.finalUrl);
    }
    const unique = [...new Set(gqlCandidates)];
    for (const endpoint of unique) {
      try {
        const schema = await introspectGraphQL(endpoint, {
          timeoutMs: Math.min(12_000, timeoutMs),
          userAgent: network?.userAgent,
          headers: network?.headers,
          proxyUrl: network?.proxyUrl,
        });
        if (!schema) continue;
        base.graphql.found = true;
        base.graphql.endpoint = endpoint;
        base.graphql.schema = schema;
        base.graphql.introspectionEnabled = true;
        base.graphql.sampleQueries = generateSampleQueries(schema, {
          maxDepth: 3,
          includeArgs: false,
          maxQueries: 10,
        }).map((q) => ({ name: q.name, query: q.query }));
        break;
      } catch {
        // try next
      }
    }
  }

  // 5) Endpoint profiling (optional)
  if (options?.profileEndpoints) {
    options?.onProgress?.("profile", "endpoints");
    const endpointsToProfile: Array<{ url: string; method?: string }> = [];

    if (base.openapi.found && base.openapi.spec) {
      const publicGet = filterScrapableEndpoints(base.openapi.spec, {
        methods: ["GET"],
        requiresAuth: false,
      });
      const serverUrl = base.openapi.spec.servers[0]?.url;
      if (serverUrl) {
        for (const e of publicGet.slice(0, 20)) {
          endpointsToProfile.push({ url: new URL(e.path, serverUrl).toString(), method: e.method });
        }
      }
    }

    if (base.graphql.found && base.graphql.endpoint) {
      endpointsToProfile.push({ url: base.graphql.endpoint, method: "POST" });
    }

    try {
      const profs = await profileEndpoints(endpointsToProfile, {
        concurrency: 3,
        timeoutMs: Math.min(10_000, timeoutMs),
        userAgent: network?.userAgent,
        headers: network?.headers,
        proxyUrl: network?.proxyUrl,
      });
      // normalize scores (defensive)
      for (const p of profs) p.scrapabilityScore = calculateScrapabilityScore(p);
      base.endpointProfiles = profs;
    } catch {
      // ignore
    }
  }

  const profile = finalizeProfile(base);
  options?.onProgress?.("done", profile.summary.recommendedStrategy);
  return profile;
}
