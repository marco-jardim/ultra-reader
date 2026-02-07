import { parse as parseYaml } from "yaml";
import { getRandomUserAgent } from "../utils/user-agents.js";
import { probeWellKnownPaths } from "./well-known-paths.js";

export interface OpenApiEndpoint {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters: Array<{
    name: string;
    in: "path" | "query" | "header" | "cookie";
    required: boolean;
    schema?: Record<string, unknown>;
    description?: string;
  }>;
  requestBody?: {
    contentType: string;
    schema: Record<string, unknown>;
    required: boolean;
  };
  responses: Record<
    string,
    {
      description: string;
      contentType?: string;
      schema?: Record<string, unknown>;
    }
  >;
  security: Array<Record<string, string[]>>;
}

export interface OpenApiSpec {
  title: string;
  version: string;
  description?: string;
  servers: Array<{ url: string; description?: string }>;
  endpoints: OpenApiEndpoint[];
  securitySchemes: Record<
    string,
    {
      type: "apiKey" | "http" | "oauth2" | "openIdConnect";
      scheme?: string;
      bearerFormat?: string;
      in?: string;
      name?: string;
      flows?: Record<string, unknown>;
    }
  >;
  schemas: Record<string, Record<string, unknown>>;
  rawSpec: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function resolveJsonPointer(root: unknown, pointer: string): unknown {
  // Supports only internal refs: #/a/b/c
  if (!pointer.startsWith("#/")) return undefined;
  const parts = pointer
    .slice(2)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur: unknown = root;
  for (const part of parts) {
    if (!isRecord(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function resolveRef(
  root: Record<string, unknown>,
  value: unknown
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const ref = getString(value["$ref"]);
  if (!ref) return value;
  const resolved = resolveJsonPointer(root, ref);
  return isRecord(resolved) ? resolved : undefined;
}

function normalizeMethod(method: string): OpenApiEndpoint["method"] | null {
  const m = method.toUpperCase();
  if (m === "GET" || m === "POST" || m === "PUT" || m === "DELETE" || m === "PATCH") return m;
  return null;
}

function isParamLocation(value: string): value is "path" | "query" | "header" | "cookie" {
  return value === "path" || value === "query" || value === "header" || value === "cookie";
}

function extractServers(
  spec: Record<string, unknown>
): Array<{ url: string; description?: string }> {
  // OAS3: servers
  const servers = spec["servers"];
  if (Array.isArray(servers)) {
    const out: Array<{ url: string; description?: string }> = [];
    for (const s of servers) {
      if (!isRecord(s)) continue;
      const url = getString(s.url);
      if (!url) continue;
      out.push({ url, description: getString(s.description) });
    }
    return out;
  }

  // Swagger 2.0: schemes/host/basePath
  const host = getString(spec["host"]);
  const basePath = getString(spec["basePath"]) ?? "";
  const schemes = spec["schemes"];
  const schemeList = Array.isArray(schemes)
    ? schemes.map((x) => (typeof x === "string" ? x : null)).filter(Boolean)
    : [];
  const useSchemes = schemeList.length ? (schemeList as string[]) : ["https"];
  if (!host) return [];
  return useSchemes.map((scheme) => ({ url: `${scheme}://${host}${basePath}` }));
}

function extractSecuritySchemes(spec: Record<string, unknown>): OpenApiSpec["securitySchemes"] {
  // OAS3: components.securitySchemes
  const components = spec["components"];
  if (isRecord(components) && isRecord(components.securitySchemes)) {
    const out: OpenApiSpec["securitySchemes"] = {};
    for (const [name, scheme] of Object.entries(components.securitySchemes)) {
      if (!isRecord(scheme)) continue;
      const type = getString(scheme.type);
      if (!type) continue;
      if (type === "apiKey" || type === "http" || type === "oauth2" || type === "openIdConnect") {
        out[name] = {
          type,
          scheme: getString(scheme.scheme),
          bearerFormat: getString(scheme.bearerFormat),
          in: getString(scheme.in),
          name: getString(scheme.name),
          flows: isRecord(scheme.flows) ? scheme.flows : undefined,
        };
      }
    }
    return out;
  }

  // Swagger 2.0: securityDefinitions
  const defs = spec["securityDefinitions"];
  if (isRecord(defs)) {
    const out: OpenApiSpec["securitySchemes"] = {};
    for (const [name, scheme] of Object.entries(defs)) {
      if (!isRecord(scheme)) continue;
      const type = getString(scheme.type);
      if (!type) continue;
      if (type === "apiKey") {
        out[name] = { type: "apiKey", in: getString(scheme.in), name: getString(scheme.name) };
      } else if (type === "oauth2") {
        out[name] = { type: "oauth2", flows: isRecord(scheme.flows) ? scheme.flows : undefined };
      } else if (type === "basic") {
        out[name] = { type: "http", scheme: "basic" };
      }
    }
    return out;
  }

  return {};
}

function extractSchemas(spec: Record<string, unknown>): OpenApiSpec["schemas"] {
  const out: OpenApiSpec["schemas"] = {};
  const components = spec["components"];
  if (isRecord(components) && isRecord(components.schemas)) {
    for (const [name, schema] of Object.entries(components.schemas)) {
      if (isRecord(schema)) out[name] = schema;
    }
  }
  const defs = spec["definitions"];
  if (isRecord(defs)) {
    for (const [name, schema] of Object.entries(defs)) {
      if (isRecord(schema)) out[name] = schema;
    }
  }
  return out;
}

function asSecurityArray(value: unknown): Array<Record<string, string[]>> {
  if (!Array.isArray(value)) return [];
  const out: Array<Record<string, string[]>> = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const mapped: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(item)) {
      if (Array.isArray(v)) mapped[k] = v.filter((x): x is string => typeof x === "string");
    }
    out.push(mapped);
  }
  return out;
}

export function parseOpenApiSpec(spec: Record<string, unknown>): OpenApiSpec {
  const info = isRecord(spec.info) ? spec.info : undefined;
  const title = (info && getString(info.title)) || getString(spec.title) || "OpenAPI";
  const version = (info && getString(info.version)) || getString(spec.version) || "0";
  const description = (info && getString(info.description)) || getString(spec.description);

  const servers = extractServers(spec);
  const securitySchemes = extractSecuritySchemes(spec);
  const schemas = extractSchemas(spec);

  const paths = spec.paths;
  const endpoints: OpenApiEndpoint[] = [];
  if (isRecord(paths)) {
    for (const [path, pathItem] of Object.entries(paths)) {
      if (!isRecord(pathItem)) continue;
      const pathParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

      for (const [methodRaw, operationRaw] of Object.entries(pathItem)) {
        const method = normalizeMethod(methodRaw);
        if (!method) continue;
        if (!isRecord(operationRaw)) continue;

        const op = operationRaw;
        const opParams = Array.isArray(op.parameters) ? op.parameters : [];
        const allParams = [...pathParams, ...opParams]
          .map((p) => resolveRef(spec, p))
          .filter((p): p is Record<string, unknown> => !!p);

        const parameters: OpenApiEndpoint["parameters"] = allParams
          .map((p) => {
            const name = getString(p.name);
            const where = getString(p.in);
            if (!name || !where) return null;
            if (!isParamLocation(where)) return null;
            const required = Boolean(p.required);
            const schema =
              resolveRef(spec, p.schema) ?? (isRecord(p.schema) ? p.schema : undefined);
            return { name, in: where, required, schema, description: getString(p.description) };
          })
          .filter((x): x is NonNullable<typeof x> => !!x);

        // requestBody (OAS3)
        let requestBody: OpenApiEndpoint["requestBody"] | undefined;
        const reqBody = resolveRef(spec, op.requestBody);
        if (reqBody && isRecord(reqBody.content)) {
          const contentEntries = Object.entries(reqBody.content)
            .map(([contentType, media]) => ({
              contentType,
              media: resolveRef(spec, media) ?? (isRecord(media) ? media : undefined),
            }))
            .filter((x) => !!x.media);
          const json =
            contentEntries.find((c) => c.contentType.includes("application/json")) ??
            contentEntries.find((c) => c.contentType.includes("json")) ??
            contentEntries[0];
          if (json?.media && isRecord(json.media.schema)) {
            const schema = resolveRef(spec, json.media.schema) ?? json.media.schema;
            requestBody = {
              contentType: json.contentType,
              schema,
              required: Boolean(reqBody.required),
            };
          }
        }

        // swagger2 body parameter
        if (!requestBody) {
          const bodyParam = allParams.find((p) => getString(p.in) === "body");
          if (bodyParam && isRecord(bodyParam.schema)) {
            const schema = resolveRef(spec, bodyParam.schema) ?? bodyParam.schema;
            requestBody = {
              contentType: "application/json",
              schema,
              required: Boolean(bodyParam.required),
            };
          }
        }

        // responses
        const responses: OpenApiEndpoint["responses"] = {};
        const respObj = isRecord(op.responses) ? op.responses : undefined;
        if (respObj) {
          for (const [code, respRaw] of Object.entries(respObj)) {
            const resp = resolveRef(spec, respRaw);
            if (!resp) continue;
            const description = getString(resp.description) ?? "";

            // OAS3: content
            let contentType: string | undefined;
            let schema: Record<string, unknown> | undefined;
            if (isRecord(resp.content)) {
              const entries = Object.entries(resp.content)
                .map(([ct, media]) => ({
                  ct,
                  media: resolveRef(spec, media) ?? (isRecord(media) ? media : undefined),
                }))
                .filter((x) => !!x.media);
              const json =
                entries.find((c) => c.ct.includes("application/json")) ??
                entries.find((c) => c.ct.includes("json")) ??
                entries[0];
              if (json?.media) {
                contentType = json.ct;
                if (isRecord(json.media.schema)) {
                  schema = resolveRef(spec, json.media.schema) ?? json.media.schema;
                }
              }
            }

            // Swagger2: schema
            if (!schema && isRecord(resp.schema)) {
              schema = resolveRef(spec, resp.schema) ?? resp.schema;
            }

            responses[code] = { description, contentType, schema };
          }
        }

        const tags = Array.isArray(op.tags)
          ? op.tags.filter((t): t is string => typeof t === "string")
          : undefined;
        const security = asSecurityArray(op.security ?? spec.security);

        endpoints.push({
          path,
          method,
          operationId: getString(op.operationId),
          summary: getString(op.summary),
          description: getString(op.description),
          tags,
          parameters,
          requestBody,
          responses,
          security,
        });
      }
    }
  }

  return {
    title,
    version,
    description,
    servers,
    endpoints,
    securitySchemes,
    schemas,
    rawSpec: spec,
  };
}

async function fetchText(
  url: string,
  options?: { timeoutMs?: number; userAgent?: string }
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 10_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": options?.userAgent ?? getRandomUserAgent(url),
        Accept: "application/json,application/yaml,text/yaml,text/plain,*/*",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OpenAPI fetch failed (${response.status})`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchOpenApiSpec(
  specUrl: string,
  options?: { timeoutMs?: number; userAgent?: string }
): Promise<OpenApiSpec> {
  const text = await fetchText(specUrl, options);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = parseYaml(text);
  }
  if (!isRecord(raw)) throw new Error("OpenAPI spec is not an object");
  return parseOpenApiSpec(raw);
}

export async function discoverOpenApi(
  baseUrl: string,
  options?: { timeoutMs?: number; userAgent?: string }
): Promise<OpenApiSpec | null> {
  const probes = await probeWellKnownPaths(baseUrl, {
    categories: ["openapi"],
    timeoutMs: options?.timeoutMs ?? 5_000,
    concurrency: 4,
    userAgent: options?.userAgent,
  });
  const candidates = (probes.get("openapi") ?? []).filter((p) => p.found).map((p) => p.finalUrl);
  for (const url of candidates) {
    try {
      const spec = await fetchOpenApiSpec(url, options);
      return spec;
    } catch {
      // try next
    }
  }
  return null;
}

export function filterScrapableEndpoints(
  spec: OpenApiSpec,
  filters?: {
    methods?: string[];
    requiresAuth?: boolean;
    contentTypes?: string[];
    pathPattern?: RegExp;
    tags?: string[];
  }
): OpenApiEndpoint[] {
  const allowMethods = (filters?.methods ?? ["GET"]).map((m) => m.toUpperCase());
  const allowContentTypes = (
    filters?.contentTypes ?? ["application/json", "application/*+json"]
  ).map((c) => c.toLowerCase());

  return spec.endpoints.filter((e) => {
    if (!allowMethods.includes(e.method)) return false;
    if (filters?.pathPattern && !filters.pathPattern.test(e.path)) return false;
    if (filters?.tags && filters.tags.length) {
      const t = new Set(e.tags ?? []);
      if (!filters.tags.some((x) => t.has(x))) return false;
    }

    const requiresAuth = e.security.length > 0;
    if (typeof filters?.requiresAuth === "boolean" && filters.requiresAuth !== requiresAuth)
      return false;

    // crude content-type check: any response content-type matches allow list
    const responseContentTypes = Object.values(e.responses)
      .map((r) => r.contentType)
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.toLowerCase());
    if (responseContentTypes.length) {
      const ok = responseContentTypes.some((ct) =>
        allowContentTypes.some((allow) =>
          allow.endsWith("*+json") ? ct.includes("json") : ct.startsWith(allow)
        )
      );
      if (!ok) return false;
    }

    return true;
  });
}
