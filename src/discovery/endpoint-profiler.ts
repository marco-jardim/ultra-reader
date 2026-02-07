import pLimit from "p-limit";
import { getRandomUserAgent } from "../utils/user-agents.js";

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

function detectAuth(headers: Headers): {
  required: boolean;
  type?: EndpointProfile["auth"]["type"];
  mechanism?: string;
} {
  const wwwAuth = headers.get("www-authenticate");
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

function parseRateLimit(headers: Headers): EndpointProfile["rateLimits"] | undefined {
  const headerNames: string[] = [];
  const limit = toNumber(headers.get("x-ratelimit-limit"));
  const remaining = toNumber(headers.get("x-ratelimit-remaining"));
  const reset = toNumber(headers.get("x-ratelimit-reset"));
  const retryAfter = toNumber(headers.get("retry-after"));
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

function parseCors(headers: Headers): EndpointProfile["cors"] {
  const allowOrigin = headers.get("access-control-allow-origin") ?? undefined;
  const allowMethodsRaw = headers.get("access-control-allow-methods");
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

function parseCaching(headers: Headers): EndpointProfile["caching"] {
  const cacheControl = headers.get("cache-control") ?? undefined;
  const etag = headers.get("etag") ?? undefined;
  const lastModified = headers.get("last-modified") ?? undefined;
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
  }
): Promise<EndpointProfile> {
  const method = options?.method ?? "GET";
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const headers: Record<string, string> = {
    Accept: "application/json,text/plain,*/*",
    "User-Agent": options?.userAgent ?? getRandomUserAgent(url),
    ...options?.headers,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    // 1) HEAD probe (best effort)
    try {
      await fetch(url, { method: "HEAD", redirect: "follow", headers, signal: controller.signal });
    } catch {
      // ignore
    }

    // 2) GET/whatever
    const res = await fetch(url, {
      method,
      redirect: "follow",
      headers,
      signal: controller.signal,
    });
    const end = Date.now();
    const statusCode = res.status;
    const status = classifyStatus(statusCode);
    const contentType = res.headers.get("content-type") ?? "";
    const body = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
    const responseSize = body.byteLength;

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
  } finally {
    clearTimeout(timeout);
  }
}

export async function profileEndpoints(
  endpoints: Array<{ url: string; method?: string }>,
  options?: {
    concurrency?: number;
    headers?: Record<string, string>;
    timeoutMs?: number;
    userAgent?: string;
    testPagination?: boolean;
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
        });
        completed++;
        options?.onProgress?.(completed, total);
        return prof;
      })
    )
  );

  return results;
}
