import { getRandomUserAgent } from "../utils/user-agents.js";

export interface GraphQLField {
  name: string;
  type: string;
  args: Array<{ name: string; type: string; defaultValue?: unknown }>;
  description?: string;
  isDeprecated: boolean;
  deprecationReason?: string;
}

export interface GraphQLType {
  name: string;
  kind: "OBJECT" | "INTERFACE" | "UNION" | "ENUM" | "INPUT_OBJECT" | "SCALAR";
  description?: string;
  fields?: GraphQLField[];
  enumValues?: Array<{ name: string; description?: string }>;
  inputFields?: GraphQLField[];
  interfaces?: string[];
  possibleTypes?: string[];
}

export interface GraphQLSchema {
  queryType: string;
  mutationType?: string;
  subscriptionType?: string;
  types: GraphQLType[];
  userTypes: GraphQLType[];
  queries: GraphQLField[];
  mutations: GraphQLField[];
}

/** Introspection query padrao (simplificada) */
export const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        args {
          name
          description
          defaultValue
          type {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType { kind name }
              }
            }
          }
        }
        type {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType { kind name }
            }
          }
        }
        isDeprecated
        deprecationReason
      }
      inputFields {
        name
        description
        defaultValue
        type {
          kind
          name
          ofType {
            kind
            name
            ofType { kind name }
          }
        }
      }
      interfaces { name }
      possibleTypes { name }
      enumValues(includeDeprecated: true) { name description }
    }
  }
}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function renderTypeRef(typeRef: unknown): string {
  if (!isRecord(typeRef)) return "Unknown";
  const kind = getString(typeRef.kind);
  const name = getString(typeRef.name);
  const ofType = typeRef.ofType;
  if (kind === "NON_NULL") return `${renderTypeRef(ofType)}!`;
  if (kind === "LIST") return `[${renderTypeRef(ofType)}]`;
  return name ?? "Unknown";
}

function parseField(field: unknown): GraphQLField | null {
  if (!isRecord(field)) return null;
  const name = getString(field.name);
  if (!name) return null;
  const args = Array.isArray(field.args)
    ? field.args
        .map((a) => {
          if (!isRecord(a)) return null;
          const an = getString(a.name);
          if (!an) return null;
          return {
            name: an,
            type: renderTypeRef(a.type),
            defaultValue: a.defaultValue,
          };
        })
        .filter((x): x is NonNullable<typeof x> => !!x)
    : [];

  return {
    name,
    type: renderTypeRef(field.type),
    args,
    description: getString(field.description),
    isDeprecated: Boolean(field.isDeprecated),
    deprecationReason: getString(field.deprecationReason),
  };
}

function parseType(type: unknown): GraphQLType | null {
  if (!isRecord(type)) return null;
  const name = getString(type.name);
  const kind = getString(type.kind);
  if (!name || !kind) return null;
  if (
    kind !== "OBJECT" &&
    kind !== "INTERFACE" &&
    kind !== "UNION" &&
    kind !== "ENUM" &&
    kind !== "INPUT_OBJECT" &&
    kind !== "SCALAR"
  ) {
    return null;
  }

  const fields = Array.isArray(type.fields)
    ? type.fields.map(parseField).filter((x): x is GraphQLField => !!x)
    : undefined;
  const inputFields = Array.isArray(type.inputFields)
    ? type.inputFields.map(parseField).filter((x): x is GraphQLField => !!x)
    : undefined;
  const enumValues = Array.isArray(type.enumValues)
    ? type.enumValues.flatMap((v) => {
        if (!isRecord(v)) return [];
        const name = getString(v.name);
        if (!name) return [];
        const description = getString(v.description);
        return description ? [{ name, description }] : [{ name }];
      })
    : undefined;
  const interfaces = Array.isArray(type.interfaces)
    ? type.interfaces
        .map((i) => (isRecord(i) ? getString(i.name) : undefined))
        .filter((x): x is string => !!x)
    : undefined;
  const possibleTypes = Array.isArray(type.possibleTypes)
    ? type.possibleTypes
        .map((i) => (isRecord(i) ? getString(i.name) : undefined))
        .filter((x): x is string => !!x)
    : undefined;

  return {
    name,
    kind,
    description: getString(type.description),
    fields,
    inputFields,
    enumValues,
    interfaces,
    possibleTypes,
  };
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, redirect: "follow", signal: controller.signal });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } finally {
    clearTimeout(timeout);
  }
}

function looksLikeIntrospectionDisabled(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  const errors = payload.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((e) => {
    if (!isRecord(e)) return false;
    const msg = getString(e.message)?.toLowerCase() ?? "";
    return (
      msg.includes("introspection") &&
      (msg.includes("disabled") || msg.includes("not allowed") || msg.includes("forbidden"))
    );
  });
}

export async function introspectGraphQL(
  endpoint: string,
  options?: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    userAgent?: string;
  }
): Promise<GraphQLSchema | null> {
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": options?.userAgent ?? getRandomUserAgent(endpoint),
    ...options?.headers,
  };

  const body = JSON.stringify({ query: INTROSPECTION_QUERY });

  // 1) POST
  const post = await fetchJson(
    endpoint,
    {
      method: "POST",
      headers,
      body,
    },
    timeoutMs
  );

  if (post.status === 403 || post.status === 400) {
    // fallback to GET (some endpoints only allow GET)
  } else if (
    post.status >= 200 &&
    post.status < 300 &&
    post.json &&
    !looksLikeIntrospectionDisabled(post.json)
  ) {
    const schema = parseSchemaFromPayload(post.json);
    return schema;
  } else if (looksLikeIntrospectionDisabled(post.json)) {
    return null;
  }

  // 2) GET fallback
  const url = new URL(endpoint);
  url.searchParams.set("query", INTROSPECTION_QUERY);
  const get = await fetchJson(
    url.toString(),
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": options?.userAgent ?? getRandomUserAgent(endpoint),
        ...options?.headers,
      },
    },
    timeoutMs
  );

  if (
    get.status >= 200 &&
    get.status < 300 &&
    get.json &&
    !looksLikeIntrospectionDisabled(get.json)
  ) {
    return parseSchemaFromPayload(get.json);
  }
  return null;
}

function parseSchemaFromPayload(payload: unknown): GraphQLSchema | null {
  if (!isRecord(payload)) return null;
  const data = payload.data;
  if (!isRecord(data)) return null;
  const schema = data.__schema;
  if (!isRecord(schema)) return null;

  const queryType = isRecord(schema.queryType) ? getString(schema.queryType.name) : undefined;
  if (!queryType) return null;
  const mutationType = isRecord(schema.mutationType)
    ? getString(schema.mutationType.name)
    : undefined;
  const subscriptionType = isRecord(schema.subscriptionType)
    ? getString(schema.subscriptionType.name)
    : undefined;
  const types = Array.isArray(schema.types)
    ? schema.types.map(parseType).filter((t): t is GraphQLType => !!t)
    : [];
  const userTypes = types.filter((t) => !t.name.startsWith("__"));

  const typeByName = new Map<string, GraphQLType>(types.map((t) => [t.name, t] as const));
  const queryObj = typeByName.get(queryType);
  const mutationObj = mutationType ? typeByName.get(mutationType) : undefined;

  return {
    queryType,
    mutationType,
    subscriptionType,
    types,
    userTypes,
    queries: queryObj?.fields ?? [],
    mutations: mutationObj?.fields ?? [],
  };
}

export function generateSampleQueries(
  schema: GraphQLSchema,
  options?: {
    maxDepth?: number;
    includeArgs?: boolean;
    maxQueries?: number;
  }
): Array<{
  name: string;
  query: string;
  variables?: Record<string, unknown>;
  description?: string;
}> {
  const maxDepth = options?.maxDepth ?? 3;
  const includeArgs = options?.includeArgs ?? false;
  const maxQueries = options?.maxQueries ?? 20;
  const typeByName = new Map<string, GraphQLType>(schema.types.map((t) => [t.name, t] as const));

  function unwrap(typeStr: string): { base: string; isList: boolean } {
    const clean = typeStr.replace(/!/g, "");
    const m = clean.match(/^\[(.+)\]$/);
    if (m) return { base: m[1], isList: true };
    return { base: clean, isList: false };
  }

  function buildSelection(typeStr: string, depth: number, visited: Set<string>): string {
    if (depth <= 0) return "";
    const { base } = unwrap(typeStr);
    const t = typeByName.get(base);
    if (!t || t.kind !== "OBJECT" || !t.fields?.length) return "";
    if (visited.has(base)) return "";
    visited.add(base);

    const fieldLines: string[] = [];
    for (const f of t.fields.slice(0, 10)) {
      const sub = buildSelection(f.type, depth - 1, visited);
      if (sub) fieldLines.push(`${f.name} { ${sub} }`);
      else fieldLines.push(f.name);
    }
    visited.delete(base);
    return fieldLines.join(" ");
  }

  const out: Array<{
    name: string;
    query: string;
    variables?: Record<string, unknown>;
    description?: string;
  }> = [];
  for (const field of schema.queries.slice(0, maxQueries)) {
    const args =
      includeArgs && field.args.length
        ? `(${field.args.map((a) => `${a.name}: $${a.name}`).join(", ")})`
        : "";
    const variables =
      includeArgs && field.args.length
        ? Object.fromEntries(field.args.map((a) => [a.name, null]))
        : undefined;
    const selection = buildSelection(field.type, maxDepth, new Set());
    const selectionSet = selection ? `{ ${selection} }` : "";
    out.push({
      name: field.name,
      query: `query ${field.name}${includeArgs && field.args.length ? `(${field.args.map((a) => `$${a.name}: String`).join(", ")})` : ""} { ${field.name}${args} ${selectionSet} }`,
      variables,
      description: field.description,
    });
  }
  return out;
}
