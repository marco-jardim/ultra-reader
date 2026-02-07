import { gotScraping } from "got-scraping";
import type { IncomingHttpHeaders } from "node:http";

export type DiscoveryHttpMethod = "GET" | "HEAD" | "POST";
export type DiscoveryResponseType = "text" | "buffer";

export interface DiscoveryRequestOptions {
  method: DiscoveryHttpMethod;
  timeoutMs: number;
  headers: Record<string, string>;
  proxyUrl?: string;
  responseType?: DiscoveryResponseType;
  json?: unknown;
  body?: string;
}

export interface DiscoveryResponse {
  statusCode: number;
  url: string;
  headers: Record<string, string>;
  bodyText?: string;
  bodyBuffer?: Buffer;
}

function normalizeGotHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!k) continue;
    if (typeof v === "string") out[k.toLowerCase()] = v;
    else if (Array.isArray(v)) out[k.toLowerCase()] = v.join(", ");
    else if (typeof v === "number") out[k.toLowerCase()] = String(v);
  }
  return out;
}

function normalizeFetchHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export async function discoveryRequest(
  url: string,
  options: DiscoveryRequestOptions
): Promise<DiscoveryResponse> {
  const responseType = options.responseType ?? "text";

  // Proxy support: use got-scraping when a proxyUrl is provided.
  if (options.proxyUrl) {
    if (responseType === "buffer") {
      const res = await gotScraping({
        url,
        method: options.method,
        followRedirect: true,
        throwHttpErrors: false,
        proxyUrl: options.proxyUrl,
        headers: options.headers,
        timeout: { request: options.timeoutMs },
        responseType: "buffer",
        json: options.json,
        body: options.body,
      });

      return {
        statusCode: res.statusCode,
        url: res.url,
        headers: normalizeGotHeaders(res.headers),
        bodyBuffer: options.method === "HEAD" ? undefined : res.body,
      };
    }

    const res = await gotScraping({
      url,
      method: options.method,
      followRedirect: true,
      throwHttpErrors: false,
      proxyUrl: options.proxyUrl,
      headers: options.headers,
      timeout: { request: options.timeoutMs },
      responseType: "text",
      json: options.json,
      body: options.body,
    });

    return {
      statusCode: res.statusCode,
      url: res.url,
      headers: normalizeGotHeaders(res.headers),
      bodyText: options.method === "HEAD" ? undefined : res.body,
    };
  }

  // No proxy: use native fetch (Node >= 18)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const init: RequestInit = {
      method: options.method,
      redirect: "follow",
      headers: options.headers,
      signal: controller.signal,
    };

    if (options.json !== undefined) {
      init.body = JSON.stringify(options.json);
      (init.headers as Record<string, string>)["content-type"] =
        (init.headers as Record<string, string>)["content-type"] ?? "application/json";
    } else if (options.body !== undefined) {
      init.body = options.body;
    }

    const res = await fetch(url, init);
    const normalizedHeaders = normalizeFetchHeaders(res.headers);

    if (options.method === "HEAD") {
      return {
        statusCode: res.status,
        url: res.url,
        headers: normalizedHeaders,
      };
    }

    if (responseType === "buffer") {
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        statusCode: res.status,
        url: res.url,
        headers: normalizedHeaders,
        bodyBuffer: buf,
      };
    }

    const text = await res.text();
    return {
      statusCode: res.status,
      url: res.url,
      headers: normalizedHeaders,
      bodyText: text,
    };
  } finally {
    clearTimeout(timeout);
  }
}
