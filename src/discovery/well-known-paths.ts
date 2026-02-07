import pLimit from "p-limit";
import { getRandomUserAgent, generateReferer } from "../utils/user-agents.js";
import { discoveryRequest } from "./http-client.js";

export interface WellKnownProbeResult {
  path: string;
  found: boolean;
  statusCode: number;
  contentType: string | null;
  /** URL com redirect final resolvido */
  finalUrl: string;
  /** Tamanho do body em bytes (se conhecido via Content-Length) */
  contentLength: number;
}

/** Categorias de paths bem-conhecidos */
export const WELL_KNOWN_PATHS = {
  /** Sitemaps — inventario de URLs do site */
  sitemap: [
    "/sitemap.xml",
    "/sitemap_index.xml",
    "/sitemap/",
    "/sitemaps/sitemap.xml",
    "/sitemap.txt",
    "/sitemap.xml.gz",
    "/wp-sitemap.xml",
    "/news-sitemap.xml",
    "/video-sitemap.xml",
    "/image-sitemap.xml",
  ],

  /** OpenAPI/Swagger — especificacao da API */
  openapi: [
    "/openapi.json",
    "/openapi.yaml",
    "/swagger.json",
    "/swagger.yaml",
    "/api-docs",
    "/api-docs.json",
    "/v1/api-docs",
    "/v2/api-docs",
    "/v3/api-docs",
    "/.well-known/openapi.json",
    "/.well-known/openapi.yaml",
    "/docs/api",
    "/api/docs",
    "/api/swagger.json",
    "/api/v1/swagger.json",
    "/api/openapi.json",
  ],

  /** GraphQL endpoints — introspection query */
  graphql: ["/graphql", "/api/graphql", "/v1/graphql", "/gql", "/query"],

  /** Feeds — conteudo estruturado alternativo */
  feed: [
    "/feed",
    "/feed.xml",
    "/rss",
    "/rss.xml",
    "/atom.xml",
    "/feed/atom",
    "/feed/rss",
    "/index.xml",
  ],

  /** Service descriptors */
  service: [
    "/.well-known/ai-plugin.json",
    "/.well-known/security.txt",
    "/.well-known/change-password",
    "/manifest.json",
    "/browserconfig.xml",
  ],
} as const;

export type ProbeCategory = keyof typeof WELL_KNOWN_PATHS;

function normalizeBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  return url.origin;
}

function joinUrl(origin: string, path: string): string {
  return new URL(path, origin).toString();
}

function parseContentLength(value: string | null): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isLikelyExistsStatus(statusCode: number): boolean {
  // Many endpoints exist but respond with auth/method blocks.
  return (
    (statusCode >= 200 && statusCode < 300) ||
    statusCode === 401 ||
    statusCode === 403 ||
    statusCode === 405 ||
    statusCode === 429
  );
}

async function headProbe(
  url: string,
  options: {
    timeoutMs: number;
    userAgent?: string;
    referer?: string;
    headers?: Record<string, string>;
    proxyUrl?: string;
  }
): Promise<{
  statusCode: number;
  contentType: string | null;
  contentLength: number;
  finalUrl: string;
}> {
  const baseHeaders: Record<string, string> = {
    ...(options.headers ?? {}),
    "User-Agent": options.userAgent ?? options.headers?.["User-Agent"] ?? getRandomUserAgent(url),
    Accept: options.headers?.Accept ?? "*/*",
  };
  if (options.referer) baseHeaders.Referer = baseHeaders.Referer ?? options.referer;

  // Use HEAD by default, but fall back to GET on method blocks.
  const head = await discoveryRequest(url, {
    method: "HEAD",
    timeoutMs: options.timeoutMs,
    headers: baseHeaders,
    proxyUrl: options.proxyUrl,
  });

  if (head.statusCode === 405 || head.statusCode === 400 || head.statusCode === 0) {
    const get = await discoveryRequest(url, {
      method: "GET",
      timeoutMs: options.timeoutMs,
      headers: {
        ...baseHeaders,
        Range: baseHeaders.Range ?? "bytes=0-2047",
      },
      proxyUrl: options.proxyUrl,
      responseType: "buffer",
    });

    const lenFromHeader = parseContentLength(get.headers["content-length"] ?? null);
    return {
      statusCode: get.statusCode,
      contentType: get.headers["content-type"] ?? null,
      contentLength: lenFromHeader || get.bodyBuffer?.length || 0,
      finalUrl: get.url,
    };
  }

  return {
    statusCode: head.statusCode,
    contentType: head.headers["content-type"] ?? null,
    contentLength: parseContentLength(head.headers["content-length"] ?? null),
    finalUrl: head.url,
  };
}

/**
 * Sondar paths bem-conhecidos para um dominio.
 * Usa HEAD requests para minimizar bandwidth.
 */
export async function probeWellKnownPaths(
  baseUrl: string,
  options?: {
    categories?: ProbeCategory[];
    timeoutMs?: number;
    concurrency?: number;
    userAgent?: string;
    headers?: Record<string, string>;
    proxyUrl?: string;
  }
): Promise<Map<ProbeCategory, WellKnownProbeResult[]>> {
  const origin = normalizeBaseUrl(baseUrl);
  const categories: ProbeCategory[] =
    options?.categories ?? (Object.keys(WELL_KNOWN_PATHS) as ProbeCategory[]);
  const timeoutMs = options?.timeoutMs ?? 5_000;
  const concurrency = options?.concurrency ?? 4;
  const userAgent = options?.userAgent;
  const headers = options?.headers;
  const proxyUrl = options?.proxyUrl;
  const referer = generateReferer(origin) ?? origin + "/";

  const limit = pLimit(concurrency);
  const out = new Map<ProbeCategory, WellKnownProbeResult[]>();

  await Promise.all(
    categories.map(async (category) => {
      const paths = WELL_KNOWN_PATHS[category];
      const results = await Promise.all(
        paths.map((path) =>
          limit(async (): Promise<WellKnownProbeResult> => {
            const fullUrl = joinUrl(origin, path);
            try {
              const res = await headProbe(fullUrl, {
                timeoutMs,
                userAgent,
                referer,
                headers,
                proxyUrl,
              });
              return {
                path,
                found: isLikelyExistsStatus(res.statusCode),
                statusCode: res.statusCode,
                contentType: res.contentType,
                contentLength: res.contentLength,
                finalUrl: res.finalUrl,
              };
            } catch {
              return {
                path,
                found: false,
                statusCode: 0,
                contentType: null,
                contentLength: 0,
                finalUrl: fullUrl,
              };
            }
          })
        )
      );
      out.set(category, results);
    })
  );

  return out;
}
