import pLimit from "p-limit";
import { getRandomUserAgent } from "../utils/user-agents.js";
import { discoveryRequest, type DiscoveryHttpMethod } from "./http-client.js";

export interface EndpointProfile {
  url: string;
  method: string;
  status: "accessible" | "auth-required" | "rate-limited" | "blocked" | "error" | "not-found";
  statusCode: number;
  contentType: string;
  responseSize: number;
  latency: number;
  rateLimits?: {
    limit?: number;
    remaining?: number;
    resetAt?: number;
    retryAfter?: number;
    headerNames: string[];
  };
  pagination?: {
    type: "offset" | "page" | "cursor" | "link-header" | "none";
    paramName: string;
    pageSize?: number;
    totalItems?: number;
    hasNext?: boolean;
  };
  auth: {
    required: boolean;
    type?: "bearer" | "api-key" | "cookie" | "basic" | "oauth2" | "none";
    mechanism?: string;
  };
  cors?: {
    enabled: boolean;
    allowOrigin?: string;
    allowMethods?: string[];
  };
  caching?: {
    cacheControl?: string;
    etag?: string;
    lastModified?: string;
    maxAge?: number;
  };
  scrapabilityScore: number;
}

function toNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

function calcLatencyMs(start: number, end: number): number {
  return Math.max(0, end - start);
}

function detectAuth(headers: Record<string, string>): {
  required: boolean;
  type?: EndpointProfile["auth"]["type"];
  mechanism?: string;
} {
  const wwwAuth = headers["www-authenticate"];
  if (wwwAuth) {
    const v = wwwAuth.toLowerCase();
    if (v.includes("bearer"))
      return { required: true, type: "bearer", mechanism: "www-authenticate" };
    if (v.includes("basic"))
      return { required: true, type: "basic", mechanism: "www-authenticate" };
    return { required: true, mechanism: "www-authenticate" };
  }
  return { required: false, type: "none" };
}

function classifyStatus(statusCode: number): EndpointProfile["status"] {
  if (statusCode === 401) return "auth-required";
  if (statusCode === 404) return "not-found";
  if (statusCode === 429) return "rate-limited";
  if (statusCode === 403) return "blocked";
  if (statusCode >= 200 && statusCode < 300) return "accessible";
  return "error";
}

function parseRateLimit(
  headers: Record<string, string>
): EndpointProfile["rateLimits"] | undefined {
  const headerNames: string[] = [];
  const limit = toNumber(headers["x-ratelimit-limit"] ?? null);
  const remaining = toNumber(headers["x-ratelimit-remaining"] ?? null);
  const reset = toNumber(headers["x-ratelimit-reset"] ?? null);
  const retryAfter = toNumber(headers["retry-after"] ?? null);
  if (limit != null) headerNames.push("x-ratelimit-limit");
  if (remaining != null) headerNames.push("x-ratelimit-remaining");
  if (reset != null) headerNames.push("x-ratelimit-reset");
  if (retryAfter != null) headerNames.push("retry-after");

  if (!headerNames.length) return undefined;
  return {
    limit,
    remaining,
    resetAt: reset,
    retryAfter,
    headerNames,
  };
}

function parseCors(headers: Record<string, string>): EndpointProfile["cors"] {
  const allowOrigin = headers["access-control-allow-origin"] ?? undefined;
  const allowMethodsRaw = headers["access-control-allow-methods"];
  const allowMethods = allowMethodsRaw
    ? allowMethodsRaw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : undefined;
  return {
    enabled: !!allowOrigin,
    allowOrigin,
    allowMethods,
  };
}

function parseCaching(headers: Record<string, string>): EndpointProfile["caching"] {
  const cacheControl = headers["cache-control"] ?? undefined;
  const etag = headers["etag"] ?? undefined;
  const lastModified = headers["last-modified"] ?? undefined;
  let maxAge: number | undefined;
  if (cacheControl) {
    const m = cacheControl.match(/max-age=(\d+)/i);
    if (m) maxAge = Number.parseInt(m[1], 10);
  }
  return {
    cacheControl,
    etag,
    lastModified,
    maxAge: Number.isFinite(maxAge ?? Number.NaN) ? maxAge : undefined,
  };
}

function normalizeMethod(method: string): DiscoveryHttpMethod {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD" || upper === "POST") return upper;
  return "GET";
}

export function calculateScrapabilityScore(profile: EndpointProfile): number {
  let score = 0;
  switch (profile.status) {
    case "accessible":
      score += 70;
      break;
    case "auth-required":
      score += 20;
      break;
    case "rate-limited":
      score += 30;
      break;
    case "blocked":
      score += 5;
      break;
    case "not-found":
      score += 0;
      break;
    case "error":
      score += 10;
      break;
  }
  if (profile.contentType.toLowerCase().includes("json")) score += 20;
  if (profile.auth.required) score -= 15;
  if (profile.rateLimits) score -= 10;
  return Math.max(0, Math.min(100, score));
}

export async function profileEndpoint(
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    userAgent?: string;
    testPagination?: boolean;
    proxyUrl?: string;
  }
): Promise<EndpointProfile> {
  const method = options?.method ?? "GET";
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const headers: Record<string, string> = {
    ...options?.headers,
    Accept: options?.headers?.Accept ?? "application/json,text/plain,*/*",
    "User-Agent": options?.userAgent ?? options?.headers?.["User-Agent"] ?? getRandomUserAgent(url),
  };

  const start = Date.now();

  // 1) HEAD probe (best effort)
  try {
    await discoveryRequest(url, {
      method: "HEAD",
      timeoutMs,
      headers,
      proxyUrl: options?.proxyUrl,
    });
  } catch {
    // ignore
  }

  // 2) GET/POST
  const res = await discoveryRequest(url, {
    method: normalizeMethod(method),
    timeoutMs,
    headers,
    proxyUrl: options?.proxyUrl,
    responseType: "buffer",
  });
  const end = Date.now();

  const statusCode = res.statusCode;
  const status = classifyStatus(statusCode);
  const contentType = res.headers["content-type"] ?? "";
  const responseSize = res.bodyBuffer?.length ?? 0;

  const authFromHeaders = detectAuth(res.headers);
  const rateLimits = parseRateLimit(res.headers);
  const cors = parseCors(res.headers);
  const caching = parseCaching(res.headers);

  const profile: EndpointProfile = {
    url,
    method,
    status,
    statusCode,
    contentType,
    responseSize,
    latency: calcLatencyMs(start, end),
    rateLimits,
    auth: authFromHeaders,
    cors,
    caching,
    scrapabilityScore: 0,
  };
  profile.scrapabilityScore = calculateScrapabilityScore(profile);
  return profile;
}

export async function profileEndpoints(
  endpoints: Array<{ url: string; method?: string }>,
  options?: {
    concurrency?: number;
    headers?: Record<string, string>;
    timeoutMs?: number;
    userAgent?: string;
    testPagination?: boolean;
    proxyUrl?: string;
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<EndpointProfile[]> {
  const concurrency = options?.concurrency ?? 3;
  const limit = pLimit(concurrency);
  const total = endpoints.length;
  let completed = 0;

  const results = await Promise.all(
    endpoints.map((e) =>
      limit(async () => {
        const prof = await profileEndpoint(e.url, {
          method: e.method,
          headers: options?.headers,
          timeoutMs: options?.timeoutMs,
          userAgent: options?.userAgent,
          testPagination: options?.testPagination,
          proxyUrl: options?.proxyUrl,
        });
        completed++;
        options?.onProgress?.(completed, total);
        return prof;
      })
    )
  );

  return results;
}
