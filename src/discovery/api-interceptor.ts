import type Hero from "@ulixee/hero";
import type { Resource, WebsocketResource, Tab } from "@ulixee/hero";

export interface InterceptedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  requestBody?: unknown;
  statusCode: number;
  contentType: string;
  responseBody?: unknown;
  responseSize: number;
  timing: number;
  timestamp: string;
  resourceType: string;
}

export interface ApiPattern {
  basePath: string;
  method: string;
  urlTemplate: string;
  examples: InterceptedRequest[];
  commonHeaders: Record<string, string>;
  queryParams: Array<{ name: string; exampleValues: string[]; likelyRequired: boolean }>;
  responseSchema?: {
    type: string;
    fields: Record<string, string>;
    isPaginated: boolean;
    paginationField?: string;
  };
  requiresAuth: boolean;
  authMechanism?: {
    type: "bearer" | "cookie" | "api-key" | "custom-header";
    headerName: string;
    maskedValue: string;
  };
}

export interface InterceptorOptions {
  captureContentTypes?: string[];
  ignoreDomains?: string[];
  useDefaultIgnoreList?: boolean;
  maxCapturedRequests?: number;
  maxResponseSize?: number;
  captureAssets?: boolean;
}

export interface ApiInterceptorHandle {
  /** Resolves when listeners are attached (best effort) */
  ready: Promise<void>;
  getCapturedRequests(): InterceptedRequest[];
  getApiPatterns(): ApiPattern[];
  stop(): void;
  reset(): void;
  get count(): number;
}

export const DEFAULT_IGNORE_DOMAINS = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.com",
  "facebook.net",
  "hotjar.com",
  "segment.com",
  "mixpanel.com",
  "sentry.io",
  "datadoghq.com",
  "cloudfront.net",
  "cdn.jsdelivr.net",
] as const;

function normalizeHeaderValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (value == null) return "";
  return String(value);
}

function toHeaderRecord(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    out[String(k).toLowerCase()] = normalizeHeaderValue(v);
  }
  return out;
}

function maskValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return "***";
  return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
}

function detectAuth(headers: Record<string, string>): ApiPattern["authMechanism"] | undefined {
  const auth = headers["authorization"];
  if (auth) {
    return { type: "bearer", headerName: "authorization", maskedValue: maskValue(auth) };
  }
  const apiKeyHeader = Object.keys(headers).find(
    (k) => k.includes("api-key") || k.includes("x-api-key")
  );
  if (apiKeyHeader) {
    return {
      type: "api-key",
      headerName: apiKeyHeader,
      maskedValue: maskValue(headers[apiKeyHeader] ?? ""),
    };
  }
  const cookie = headers["cookie"];
  if (cookie) {
    return { type: "cookie", headerName: "cookie", maskedValue: "***" };
  }
  return undefined;
}

function isUuid(segment: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment);
}

function templatePath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  const templated = parts.map((p) => {
    if (/^\d+$/.test(p)) return ":id";
    if (isUuid(p)) return ":uuid";
    if (p.length >= 24 && /^[0-9a-f]+$/i.test(p)) return ":hex";
    return p;
  });
  return "/" + templated.join("/");
}

function inferResponseSchema(
  body: unknown
): { type: string; fields: Record<string, string> } | undefined {
  if (body == null) return undefined;
  if (Array.isArray(body)) {
    const first = body[0];
    const inner = inferResponseSchema(first);
    return { type: "array", fields: inner?.fields ?? {} };
  }
  if (typeof body === "object") {
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      fields[k] = Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
    }
    return { type: "object", fields };
  }
  return { type: typeof body, fields: {} };
}

function detectPagination(body: unknown): { isPaginated: boolean; paginationField?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { isPaginated: false };
  const obj = body as Record<string, unknown>;
  const candidates = [
    "next",
    "nextPage",
    "nextCursor",
    "cursor",
    "page",
    "offset",
    "hasMore",
    "total",
  ];
  for (const c of candidates) {
    if (c in obj) return { isPaginated: true, paginationField: c };
  }
  return { isPaginated: false };
}

function analyzeQueryParams(urls: string[]): ApiPattern["queryParams"] {
  const counts = new Map<string, { seen: number; values: Set<string> }>();
  for (const u of urls) {
    const parsed = new URL(u);
    for (const [k, v] of parsed.searchParams.entries()) {
      if (!counts.has(k)) counts.set(k, { seen: 0, values: new Set() });
      const entry = counts.get(k)!;
      entry.seen++;
      if (entry.values.size < 5) entry.values.add(v);
    }
  }
  const total = urls.length || 1;
  return [...counts.entries()].map(([name, data]) => ({
    name,
    exampleValues: [...data.values],
    likelyRequired: data.seen / total >= 0.9,
  }));
}

export function analyzeApiPatterns(requests: InterceptedRequest[]): ApiPattern[] {
  const groups = new Map<string, InterceptedRequest[]>();
  for (const req of requests) {
    const u = new URL(req.url);
    const tpl = templatePath(u.pathname);
    const key = `${req.method.toUpperCase()} ${u.origin}${tpl}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(req);
  }

  const patterns: ApiPattern[] = [];
  for (const [key, examples] of groups) {
    const [method, full] = key.split(" ");
    const u = new URL(full);
    const urlTemplate = u.pathname;
    const parts = urlTemplate.split("/").filter(Boolean);
    const basePath = "/" + parts.slice(0, Math.min(parts.length, 3)).join("/");
    const requiresAuth = examples.some((e) => !!detectAuth(e.headers));
    const authMechanism = examples.map((e) => detectAuth(e.headers)).find((x) => x);

    // common headers: present in >= 80% of examples
    const headerCounts = new Map<string, Map<string, number>>();
    for (const ex of examples) {
      for (const [hk, hv] of Object.entries(ex.headers)) {
        if (!headerCounts.has(hk)) headerCounts.set(hk, new Map());
        const counts = headerCounts.get(hk)!;
        counts.set(hv, (counts.get(hv) ?? 0) + 1);
      }
    }
    const commonHeaders: Record<string, string> = {};
    for (const [hk, values] of headerCounts) {
      const total = examples.length;
      const best = [...values.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] / total >= 0.8) commonHeaders[hk] = best[0];
    }

    const responseBodies = examples.map((e) => e.responseBody).filter((b) => b !== undefined);
    const schema = responseBodies.length ? inferResponseSchema(responseBodies[0]) : undefined;
    const pagination = responseBodies.length
      ? detectPagination(responseBodies[0])
      : { isPaginated: false };

    patterns.push({
      basePath,
      method,
      urlTemplate,
      examples: examples.slice(0, 5),
      commonHeaders,
      queryParams: analyzeQueryParams(examples.map((e) => e.url)),
      responseSchema: schema
        ? {
            type: schema.type,
            fields: schema.fields,
            isPaginated: pagination.isPaginated,
            paginationField: pagination.paginationField,
          }
        : undefined,
      requiresAuth,
      authMechanism,
    });
  }
  return patterns;
}

function shouldIgnoreDomain(hostname: string, ignoreDomains: string[]): boolean {
  return ignoreDomains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
}

function isDesiredContentType(contentType: string, allow: string[]): boolean {
  const ct = contentType.toLowerCase();
  return allow.some((a) => ct.includes(a.toLowerCase()));
}

async function getTab(hero: Hero): Promise<Tab> {
  const tab = await hero.activeTab;
  return tab;
}

export function setupApiInterceptor(
  hero: Hero,
  options?: InterceptorOptions
): ApiInterceptorHandle {
  const captureContentTypes = options?.captureContentTypes ?? [
    "application/json",
    "application/graphql",
    "+json",
  ];
  const ignoreDomains = [
    ...(options?.useDefaultIgnoreList === false
      ? []
      : (DEFAULT_IGNORE_DOMAINS as unknown as string[])),
    ...(options?.ignoreDomains ?? []),
  ];
  const maxCaptured = options?.maxCapturedRequests ?? 200;
  const maxResponseSize = options?.maxResponseSize ?? 256 * 1024;

  const captured: InterceptedRequest[] = [];
  let stopped = false;
  let listener: ((resource: Resource | WebsocketResource) => void) | null = null;
  let tabRef: Tab | null = null;

  const ready = (async (): Promise<void> => {
    try {
      tabRef = await getTab(hero);
      listener = (resource) => {
        void (async () => {
          if (stopped) return;
          if (captured.length >= maxCaptured) return;

          const url = resource.url;
          let parsed: URL;
          try {
            parsed = new URL(url);
          } catch {
            return;
          }
          if (shouldIgnoreDomain(parsed.hostname, ignoreDomains)) return;

          const response = resource.response;
          const statusCode = response?.statusCode ?? 0;
          const resHeaders = toHeaderRecord(response?.headers);
          const contentType = resHeaders["content-type"] ?? "";
          if (!options?.captureAssets && !isDesiredContentType(contentType, captureContentTypes))
            return;

          const request = resource.request;
          const reqHeaders = toHeaderRecord(request?.headers);
          const method = request?.method ?? "GET";

          let requestBody: unknown;
          try {
            const postData = request ? await request.postData : null;
            const reqCt = reqHeaders["content-type"] ?? "";
            if (
              postData &&
              postData.length &&
              reqCt.toLowerCase().includes("json") &&
              postData.length <= 64 * 1024
            ) {
              requestBody = JSON.parse(postData.toString("utf-8"));
            }
          } catch {
            // ignore
          }

          let responseBody: unknown;
          let responseSize = 0;
          try {
            const buf = await resource.buffer;
            responseSize = buf?.length ?? 0;
            if (
              responseSize <= maxResponseSize &&
              isDesiredContentType(contentType, captureContentTypes)
            ) {
              responseBody = await resource.json;
            }
          } catch {
            // ignore
          }

          const timestamp = (request?.timestamp ?? new Date()).toISOString();
          captured.push({
            url,
            method,
            headers: reqHeaders,
            requestBody,
            statusCode,
            contentType,
            responseBody,
            responseSize,
            timing: 0,
            timestamp,
            resourceType: String((resource as unknown as { type?: unknown }).type ?? ""),
          });
        })();
      };

      await tabRef.addEventListener("resource", listener);
    } catch {
      // ignore
    }
  })();

  return {
    ready,
    getCapturedRequests() {
      return [...captured];
    },
    getApiPatterns() {
      return analyzeApiPatterns(captured);
    },
    stop() {
      stopped = true;
      if (tabRef && listener) {
        void tabRef.removeEventListener("resource", listener);
      }
    },
    reset() {
      captured.length = 0;
    },
    get count() {
      return captured.length;
    },
  };
}
