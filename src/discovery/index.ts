export {
  discoverSite,
  loadCachedProfile,
  saveCachedProfile,
  generateSummary,
  type SiteProfile,
  type DiscoveryOptions,
} from "./site-profile.js";

export {
  discoverSitemaps,
  fetchSitemap,
  parseSitemap,
  type SitemapUrl,
  type SitemapParseResult,
} from "./sitemap-parser.js";

export {
  discoverOpenApi,
  fetchOpenApiSpec,
  parseOpenApiSpec,
  filterScrapableEndpoints,
  type OpenApiSpec,
  type OpenApiEndpoint,
} from "./openapi-prober.js";

export {
  introspectGraphQL,
  generateSampleQueries,
  INTROSPECTION_QUERY,
  type GraphQLSchema,
  type GraphQLType,
} from "./graphql-introspect.js";

export {
  setupApiInterceptor,
  analyzeApiPatterns,
  DEFAULT_IGNORE_DOMAINS,
  type ApiInterceptorHandle,
  type InterceptedRequest,
  type ApiPattern,
} from "./api-interceptor.js";

export {
  profileEndpoint,
  profileEndpoints,
  calculateScrapabilityScore,
  type EndpointProfile,
} from "./endpoint-profiler.js";

export {
  probeWellKnownPaths,
  WELL_KNOWN_PATHS,
  type WellKnownProbeResult,
  type ProbeCategory,
} from "./well-known-paths.js";
