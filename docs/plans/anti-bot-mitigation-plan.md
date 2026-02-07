# Plano de Mitigação Anti-Bot — ultra-reader

> Plano de implementação para cobrir todas as lacunas identificadas na [análise anti-scraping](../anti-scraping-analysis.md).  
> Priorizado por impacto no "power scraping". Cada item inclui arquivos afetados, API proposta e estimativa de esforço.

---

## Índice

1. [Phase 1 — Quick Wins (1-2 dias)](#phase-1--quick-wins)
2. [Phase 1.5 — API Discovery & Sitemap Intelligence (3-5 dias)](#phase-15--api-discovery--sitemap-intelligence)
3. [Phase 2 — Core Anti-Bot (3-5 dias)](#phase-2--core-anti-bot)
4. [Phase 3 — Advanced Evasion (5-8 dias)](#phase-3--advanced-evasion)
5. [Phase 4 — Enterprise WAFs (5-10 dias)](#phase-4--enterprise-wafs)
6. [Phase 5 — Content Integrity (3-5 dias)](#phase-5--content-integrity)
7. [Phase 6 — Hardening (2-3 dias)](#phase-6--hardening)
8. [Phase 7 — JWT/OAuth/AI Auth (5-8 dias)](#phase-7--jwtoauthai-auth)
9. [Phase 8 — LLM-Assisted Dynamic Bypass (8-12 dias)](#phase-8--llm-assisted-dynamic-bypass)
10. [Phase 9 — MCP Server (3-5 dias)](#phase-9--mcp-server)
11. [Resumo de Dependências](#resumo-de-dependências)
12. [Risk Assessment](#risk-assessment)

---

## Phase 1 — Quick Wins

> Mudanças mínimas, impacto máximo. Podem ser feitas em paralelo.

### 1.1 Flag `respectRobots` (bypass de robots.txt)

**Gravidade:** 🔴 ALTO  
**Esforço:** ~2h  
**Impacto:** Desbloqueia scraping em sites que bloqueiam via robots.txt

**Arquivos a modificar:**

- `src/types.ts` — Adicionar campo `respectRobots?: boolean` (default: `true`)
- `src/scraper.ts:57-63` — Condicionar check de robots.txt à flag
- `src/crawler.ts:91-102` — Condicionar check no crawler
- `src/cli/index.ts` — Adicionar `--ignore-robots` flag

**API proposta:**

```typescript
// src/types.ts
interface ScrapeOptions {
  // ... existing
  respectRobots?: boolean; // default: true
}

// src/scraper.ts — modificar scrapeUrl()
if (this.options.respectRobots !== false) {
  const rules = await this.getRobotsRules(url);
  if (rules && !isUrlAllowed(url, rules)) {
    throw new RobotsBlockedError(url);
  }
}
```

**Testes necessários:**

- Scrape com `respectRobots: false` em URL bloqueada por robots.txt
- Verificar que `respectRobots: true` (default) mantém comportamento atual
- Crawler com `respectRobots: false`

---

### 1.2 User-Agent Rotation Pool

**Gravidade:** 🔴 ALTO  
**Esforço:** ~4h  
**Impacto:** Evita detecção por UA estático/desatualizado

**Arquivos a criar:**

- `src/utils/user-agents.ts` — Pool de UAs modernos + função de rotação

**Arquivos a modificar:**

- `src/engines/http/index.ts:23-24` — Usar UA do pool em vez de hardcoded
- `src/engines/tlsclient/index.ts` — Passar UA rotacionado
- `src/browser/hero-config.ts:91` — Passar UA rotacionado
- `src/types.ts` — Adicionar `rotateUserAgent?: boolean` (default: `true`)

**Implementação proposta:**

```typescript
// src/utils/user-agents.ts
const CHROME_USER_AGENTS = [
  // Chrome 121-131 on Windows 10/11
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  // Chrome on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // Chrome on Linux
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // Firefox on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  // Edge on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  // ... 20+ UAs totais
];

export function getRandomUserAgent(): string {
  return CHROME_USER_AGENTS[Math.floor(Math.random() * CHROME_USER_AGENTS.length)];
}

export function getUserAgentRotator(): () => string {
  let index = 0;
  return () => CHROME_USER_AGENTS[index++ % CHROME_USER_AGENTS.length];
}
```

**Considerações:**

- UAs devem ser atualizados a cada release major (ou fetchados de um endpoint)
- Para Hero engine, o UA precisa ser consistente com o browser profile emulado
- `got-scraping` já faz UA generation interna — garantir que não conflite

---

### 1.3 Referer Header Spoofing

**Gravidade:** 🟡 MÉDIO  
**Esforço:** ~1h  
**Impacto:** Desbloqueia sites que verificam referer

**Arquivos a modificar:**

- `src/engines/http/index.ts:22-35` — Adicionar `Referer` dinâmico
- `src/types.ts` — Adicionar `referer?: string | 'auto'`

**Implementação proposta:**

```typescript
// Em DEFAULT_HEADERS ou na construção do request
function getReferer(url: string, options: ScrapeOptions): string {
  if (options.referer === "auto") {
    // Usar o próprio domínio como referer (simula navegação interna)
    const origin = new URL(url).origin;
    return origin + "/";
  }
  return options.referer || `https://www.google.com/`;
}
```

---

### 1.4 Timing Randomization (Jitter)

**Gravidade:** 🟡 MÉDIO  
**Esforço:** ~2h  
**Impacto:** Evita detecção por padrão de timing uniforme

**Arquivos a modificar:**

- `src/utils/rate-limiter.ts` — Adicionar jitter ao delay
- `src/scraper.ts:128` — Exponential backoff com jitter
- `src/crawler.ts:133-135` — Jitter no crawl delay

**Implementação proposta:**

```typescript
// src/utils/rate-limiter.ts
export function jitteredDelay(baseMs: number, jitterFactor = 0.3): number {
  const jitter = baseMs * jitterFactor;
  return baseMs + (Math.random() * 2 - 1) * jitter;
  // Ex: baseMs=1000, jitter=0.3 → range [700, 1300]
}

// src/scraper.ts — retry backoff com jitter
const backoffMs = jitteredDelay(Math.pow(2, attempt) * 1000, 0.5);
```

---

### 1.5 — Testes de Regressão do Engine Cascade

> **GAP-05 FIX:** Adicionada suíte de testes de regressão para o engine cascade,
> garantindo que a lógica de fallback HTTP → TLS Client → Hero funciona corretamente.

**Arquivo a criar:** `tests/engines/orchestrator.test.ts`

```typescript
// tests/engines/orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EngineOrchestrator } from "../../src/engines/orchestrator.js";

describe("EngineOrchestrator — Engine Cascade", () => {
  let orchestrator: EngineOrchestrator;

  beforeEach(() => {
    orchestrator = new EngineOrchestrator();
  });

  describe("cascade fallback order", () => {
    it("should try HTTP engine first", async () => {
      const httpSpy = vi.spyOn(orchestrator["httpEngine"], "fetch");
      httpSpy.mockResolvedValueOnce({ html: "<html>ok</html>", status: 200 });

      const result = await orchestrator.scrape("https://example.com");
      expect(result.engine).toBe("http");
      expect(httpSpy).toHaveBeenCalledOnce();
    });

    it("should fallback to TLS Client when HTTP returns 403", async () => {
      const httpSpy = vi.spyOn(orchestrator["httpEngine"], "fetch");
      httpSpy.mockRejectedValueOnce(new Error("HTTP 403"));

      const tlsSpy = vi.spyOn(orchestrator["tlsEngine"], "fetch");
      tlsSpy.mockResolvedValueOnce({ html: "<html>ok</html>", status: 200 });

      const result = await orchestrator.scrape("https://protected.com");
      expect(result.engine).toBe("tls-client");
      expect(httpSpy).toHaveBeenCalledOnce();
      expect(tlsSpy).toHaveBeenCalledOnce();
    });

    it("should fallback to Hero when both HTTP and TLS Client fail", async () => {
      const httpSpy = vi.spyOn(orchestrator["httpEngine"], "fetch");
      httpSpy.mockRejectedValueOnce(new Error("HTTP 403"));

      const tlsSpy = vi.spyOn(orchestrator["tlsEngine"], "fetch");
      tlsSpy.mockRejectedValueOnce(new Error("TLS 403"));

      const heroSpy = vi.spyOn(orchestrator["heroEngine"], "fetch");
      heroSpy.mockResolvedValueOnce({ html: "<html>ok</html>", status: 200 });

      const result = await orchestrator.scrape("https://heavily-protected.com");
      expect(result.engine).toBe("hero");
    });

    it("should throw when all engines fail", async () => {
      vi.spyOn(orchestrator["httpEngine"], "fetch").mockRejectedValueOnce(new Error("HTTP failed"));
      vi.spyOn(orchestrator["tlsEngine"], "fetch").mockRejectedValueOnce(new Error("TLS failed"));
      vi.spyOn(orchestrator["heroEngine"], "fetch").mockRejectedValueOnce(new Error("Hero failed"));

      await expect(orchestrator.scrape("https://impossible.com")).rejects.toThrow(
        "All engines failed"
      );
    });
  });

  describe("Cloudflare detection triggers Hero directly", () => {
    it("should skip TLS Client and use Hero for known CF challenges", async () => {
      const httpSpy = vi.spyOn(orchestrator["httpEngine"], "fetch");
      httpSpy.mockResolvedValueOnce({
        html: "<html><title>Just a moment...</title></html>",
        status: 403,
        headers: { "cf-mitigated": "challenge" },
      });

      const heroSpy = vi.spyOn(orchestrator["heroEngine"], "fetch");
      heroSpy.mockResolvedValueOnce({ html: "<html>ok</html>", status: 200 });

      const result = await orchestrator.scrape("https://cf-protected.com");
      expect(result.engine).toBe("hero");
      // TLS Client should be skipped when CF challenge is detected
    });
  });

  describe("retry with exponential backoff", () => {
    it("should retry on transient 429 errors", async () => {
      const httpSpy = vi.spyOn(orchestrator["httpEngine"], "fetch");
      httpSpy
        .mockRejectedValueOnce(Object.assign(new Error("429"), { statusCode: 429 }))
        .mockResolvedValueOnce({ html: "<html>ok</html>", status: 200 });

      const result = await orchestrator.scrape("https://rate-limited.com");
      expect(result.engine).toBe("http");
      expect(httpSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("engine-specific options", () => {
    it("should pass proxy config to all engines", async () => {
      const httpSpy = vi.spyOn(orchestrator["httpEngine"], "fetch");
      httpSpy.mockResolvedValueOnce({ html: "<html>ok</html>", status: 200 });

      await orchestrator.scrape("https://example.com", {
        proxy: { url: "http://proxy:8080" },
      });

      expect(httpSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ proxy: { url: "http://proxy:8080" } })
      );
    });
  });
});
```

---

## Phase 1.5 — API Discovery & Sitemap Intelligence

> Antes de lutar contra defesas anti-bot no HTML, descobrir se o site expõe dados estruturados via APIs internas, sitemaps ou especificações OpenAPI. APIs raramente têm a mesma proteção anti-bot que páginas renderizadas, e os dados vêm pré-estruturados.

**Racional:** Um scraper inteligente não ataca pela porta da frente quando a porta dos fundos está aberta. Se um site tem um JSON API limpo, não faz sentido lutar contra Cloudflare no HTML.

**Estimativa:** 3-5 dias  
**Pré-requisitos:** Phase 1 (UA rotation, rate limiting)  
**Prioridade:** 🔴 Alta — informa e potencialmente substitui fases posteriores

### 1.5.1 Well-Known Path Probing

**Gravidade:** 🟡 ALTO VALOR / BAIXO CUSTO

Antes de carregar qualquer página, sondar paths bem-conhecidos com requests HTTP simples (Engine 1). Zero custo adicional, potencial de descobrir o inventário completo do site.

**Arquivo:** `src/discovery/well-known-paths.ts` (~60 linhas)

```typescript
/**
 * Registry of well-known paths for API documentation, sitemaps,
 * and service descriptors.
 */

export interface WellKnownProbeResult {
  path: string;
  found: boolean;
  statusCode: number;
  contentType: string | null;
  /** URL com redirect final resolvido */
  finalUrl: string;
  /** Tamanho do body em bytes */
  contentLength: number;
}

/** Categorias de paths bem-conhecidos */
export const WELL_KNOWN_PATHS = {
  /** Sitemaps — inventário de URLs do site */
  sitemap: [
    "/sitemap.xml",
    "/sitemap_index.xml",
    "/sitemap/",
    "/sitemaps/sitemap.xml",
    "/sitemap.txt",
    "/sitemap.xml.gz",
    "/wp-sitemap.xml", // WordPress default
    "/news-sitemap.xml",
    "/video-sitemap.xml",
    "/image-sitemap.xml",
  ],

  /** OpenAPI/Swagger — especificação completa da API */
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

  /** Feeds — conteúdo estruturado alternativo */
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
    "/.well-known/ai-plugin.json", // ChatGPT/AI plugins
    "/.well-known/security.txt",
    "/.well-known/change-password",
    "/manifest.json",
    "/browserconfig.xml",
  ],
} as const;

export type ProbeCategory = keyof typeof WELL_KNOWN_PATHS;

/**
 * Sondar paths bem-conhecidos para um domínio.
 * Usa HEAD requests para minimizar bandwidth.
 * Faz GET follow-up apenas para paths que retornam 200.
 */
export async function probeWellKnownPaths(
  baseUrl: string,
  options?: {
    categories?: ProbeCategory[];
    timeoutMs?: number;
    concurrency?: number;
    userAgent?: string;
  }
): Promise<Map<ProbeCategory, WellKnownProbeResult[]>>;
```

### 1.5.2 Sitemap Parser

**Gravidade:** 🔴 CRÍTICO — fornece inventário completo sem crawling

Parsear sitemaps XML/TXT, incluindo sitemap index files (que apontam para sub-sitemaps), extrair todas as URLs com metadados (lastmod, priority, changefreq). Suporte a sitemaps comprimidos (.gz).

**Arquivo:** `src/discovery/sitemap-parser.ts` (~200 linhas)

```typescript
import { gunzipSync } from "node:zlib";

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
  /** Imagens associadas (image:image) */
  images?: string[];
  /** Vídeos associados (video:video) */
  videos?: Array<{ title: string; thumbnailLoc: string; contentLoc?: string }>;
  /** Notícias (news:news) */
  news?: { publicationName: string; language: string; title: string; publicationDate: string };
}

export interface SitemapIndex {
  sitemaps: Array<{
    loc: string;
    lastmod?: string;
  }>;
}

export interface SitemapParseResult {
  type: "urlset" | "sitemapindex" | "text";
  urls: SitemapUrl[];
  /** Sub-sitemaps referenciados (se sitemapindex) */
  childSitemaps: string[];
  /** Total de URLs descobertas (recursivo) */
  totalUrls: number;
  /** Erros de parsing não-fatais */
  warnings: string[];
}

/**
 * Parsear conteúdo XML/TXT de sitemap.
 * Detecta automaticamente se é urlset, sitemapindex ou texto plano.
 */
export function parseSitemap(content: string): SitemapParseResult;

/**
 * Fetch e parse de um sitemap URL, incluindo:
 * - Descompressão .gz automática
 * - Resolução recursiva de sitemap index files (até maxDepth)
 * - Deduplicação de URLs
 * - Respeito a lastmod para filtrar URLs recentes
 */
export async function fetchSitemap(
  sitemapUrl: string,
  options?: {
    maxDepth?: number; // default: 3
    maxUrls?: number; // default: 50_000
    sinceDate?: Date; // filtrar por lastmod >= sinceDate
    includePattern?: RegExp; // filtrar URLs por pattern
    excludePattern?: RegExp; // excluir URLs por pattern
    timeoutMs?: number; // default: 15_000 per request
    userAgent?: string;
  }
): Promise<SitemapParseResult>;

/**
 * Descobrir sitemaps de um domínio:
 * 1. Checar robots.txt para diretivas Sitemap:
 * 2. Sondar well-known paths de sitemap
 * 3. Fetch e parse todos os encontrados
 */
export async function discoverSitemaps(
  baseUrl: string,
  options?: {
    maxDepth?: number;
    maxUrls?: number;
    sinceDate?: Date;
    timeoutMs?: number;
  }
): Promise<{
  sources: Array<{ url: string; foundVia: "robots.txt" | "well-known" | "sitemap-index" }>;
  urls: SitemapUrl[];
  totalUrls: number;
}>;
```

### 1.5.3 OpenAPI/Swagger Prober

**Gravidade:** 🟡 ALTO VALOR

Quando um endpoint OpenAPI/Swagger é encontrado, parsear a especificação completa e extrair todos os endpoints com seus schemas, parâmetros, e formatos de resposta. Isso dá ao scraper (ou ao AI agent via MCP) um mapa completo da API.

**Arquivo:** `src/discovery/openapi-prober.ts` (~180 linhas)

```typescript
export interface OpenApiEndpoint {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  /** Parâmetros (path, query, header) */
  parameters: Array<{
    name: string;
    in: "path" | "query" | "header" | "cookie";
    required: boolean;
    schema?: Record<string, unknown>;
    description?: string;
  }>;
  /** Request body schema (se aplicável) */
  requestBody?: {
    contentType: string;
    schema: Record<string, unknown>;
    required: boolean;
  };
  /** Response schemas por status code */
  responses: Record<
    string,
    {
      description: string;
      contentType?: string;
      schema?: Record<string, unknown>;
    }
  >;
  /** Requer autenticação? */
  security: Array<Record<string, string[]>>;
}

export interface OpenApiSpec {
  title: string;
  version: string;
  description?: string;
  /** Base URL da API */
  servers: Array<{ url: string; description?: string }>;
  /** Todos os endpoints extraídos */
  endpoints: OpenApiEndpoint[];
  /** Esquemas de autenticação disponíveis */
  securitySchemes: Record<
    string,
    {
      type: "apiKey" | "http" | "oauth2" | "openIdConnect";
      scheme?: string; // bearer, basic
      bearerFormat?: string; // JWT
      in?: string; // header, query, cookie
      name?: string; // nome do header/query param
      flows?: Record<string, unknown>; // oauth2 flows
    }
  >;
  /** Schema definitions (componentes reutilizáveis) */
  schemas: Record<string, Record<string, unknown>>;
  /** Spec original raw */
  rawSpec: Record<string, unknown>;
}

/**
 * Parsear uma spec OpenAPI 2.0 (Swagger) ou 3.x.
 * Resolve $ref references internos.
 */
export function parseOpenApiSpec(spec: Record<string, unknown>): OpenApiSpec;

/**
 * Fetch e parse uma spec OpenAPI de uma URL.
 * Suporta JSON e YAML.
 */
export async function fetchOpenApiSpec(
  specUrl: string,
  options?: { timeoutMs?: number; userAgent?: string }
): Promise<OpenApiSpec>;

/**
 * Descobrir e parsear specs OpenAPI para um domínio.
 * Sonda todos os well-known paths de openapi.
 */
export async function discoverOpenApi(
  baseUrl: string,
  options?: { timeoutMs?: number; userAgent?: string }
): Promise<OpenApiSpec | null>;

/**
 * Filtrar endpoints da spec por critérios úteis para scraping:
 * - Apenas GET (leitura)
 * - Sem auth requerido
 * - Retorna JSON
 * - Match de pattern no path
 */
export function filterScrapableEndpoints(
  spec: OpenApiSpec,
  filters?: {
    methods?: string[];
    requiresAuth?: boolean;
    contentTypes?: string[];
    pathPattern?: RegExp;
    tags?: string[];
  }
): OpenApiEndpoint[];
```

### 1.5.4 GraphQL Introspection

**Gravidade:** 🟡 ALTO VALOR

Se um endpoint GraphQL é encontrado, executar introspection query para obter o schema completo: types, queries, mutations, subscriptions.

**Arquivo:** `src/discovery/graphql-introspect.ts` (~150 linhas)

```typescript
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
  /** Apenas os types relevantes (exclui __TypeKind, __Field, etc.) */
  userTypes: GraphQLType[];
  /** Queries disponíveis com argumentos */
  queries: GraphQLField[];
  /** Mutations disponíveis */
  mutations: GraphQLField[];
}

/** Introspection query padrão (simplificada, sem directivas) */
export const INTROSPECTION_QUERY: string;

/**
 * Executar introspection query em um endpoint GraphQL.
 * Tenta POST com application/json primeiro, depois GET com query param.
 * Se introspection desabilitada (403/400), retorna null.
 */
export async function introspectGraphQL(
  endpoint: string,
  options?: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    userAgent?: string;
  }
): Promise<GraphQLSchema | null>;

/**
 * Gerar queries GraphQL de exemplo a partir do schema introspectado.
 * Útil para scraping automatizado via API.
 */
export function generateSampleQueries(
  schema: GraphQLSchema,
  options?: {
    maxDepth?: number; // profundidade máxima de nested fields (default: 3)
    includeArgs?: boolean; // incluir argumentos com valores placeholder
    maxQueries?: number; // máximo de queries a gerar (default: 20)
  }
): Array<{
  name: string;
  query: string;
  variables?: Record<string, unknown>;
  description?: string;
}>;
```

### 1.5.5 API Request Interceptor (Hero Engine)

**Gravidade:** 🔴 CRÍTICO — descoberta passiva durante navegação

Durante a navegação via Hero (Engine 3), interceptar TODAS as requests de rede para descobrir APIs internas que o frontend do site usa. Isso captura endpoints que não estão documentados em nenhum Swagger.

**Arquivo:** `src/discovery/api-interceptor.ts` (~200 linhas)

```typescript
import type Hero from "@ulixee/hero";

export interface InterceptedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Body da request (se POST/PUT/PATCH e JSON) */
  requestBody?: unknown;
  /** Status da response */
  statusCode: number;
  /** Content-Type da response */
  contentType: string;
  /** Body da response (se JSON, limitado a maxResponseSize) */
  responseBody?: unknown;
  /** Tamanho da response em bytes */
  responseSize: number;
  /** Tempo de resposta em ms */
  timing: number;
  /** Timestamp ISO da request */
  timestamp: string;
  /** Tipo de recurso (xhr, fetch, script, etc.) */
  resourceType: string;
}

export interface ApiPattern {
  /** Base path do endpoint (e.g., /api/v2/products) */
  basePath: string;
  /** Método HTTP */
  method: string;
  /** URL template com path params extraídos (e.g., /api/v2/products/:id) */
  urlTemplate: string;
  /** Exemplos de requests capturadas */
  examples: InterceptedRequest[];
  /** Headers comuns (presentes em >80% das requests) */
  commonHeaders: Record<string, string>;
  /** Query params observados */
  queryParams: Array<{
    name: string;
    /** Valores de exemplo observados */
    exampleValues: string[];
    /** Parece obrigatório? (presente em >90% das requests) */
    likelyRequired: boolean;
  }>;
  /** Schema inferido da response (JSON) */
  responseSchema?: {
    type: string;
    /** Campos de primeiro nível com tipos */
    fields: Record<string, string>;
    /** É paginado? (detecta patterns: offset, page, cursor, next, hasMore) */
    isPaginated: boolean;
    /** Campo de paginação detectado */
    paginationField?: string;
  };
  /** Requer autenticação? (detecta Authorization, Cookie, x-api-key headers) */
  requiresAuth: boolean;
  /** Token/cookie name usado para auth */
  authMechanism?: {
    type: "bearer" | "cookie" | "api-key" | "custom-header";
    headerName: string;
    /** Valor de exemplo (mascarado) */
    maskedValue: string;
  };
}

/**
 * Filtros para captura seletiva de requests.
 */
export interface InterceptorOptions {
  /** Content types a capturar (default: ['application/json', 'application/graphql']) */
  captureContentTypes?: string[];
  /** Ignorar requests para estes domínios (analytics, tracking, CDN) */
  ignoreDomains?: string[];
  /** Default ignore list: google-analytics, facebook, hotjar, etc. */
  useDefaultIgnoreList?: boolean;
  /** Máximo de responses a armazenar em memória */
  maxCapturedRequests?: number;
  /** Máximo de bytes por response body */
  maxResponseSize?: number;
  /** Capturar também requests de imagem/CSS/font? (default: false) */
  captureAssets?: boolean;
}

/**
 * Configurar interceptação de requests em uma instância Hero.
 * Retorna uma handle para controlar a captura.
 */
export function setupApiInterceptor(hero: Hero, options?: InterceptorOptions): ApiInterceptorHandle;

export interface ApiInterceptorHandle {
  /** Requests capturadas até agora */
  getCapturedRequests(): InterceptedRequest[];
  /** Patterns de API detectados (agrupados por endpoint) */
  getApiPatterns(): ApiPattern[];
  /** Parar captura e limpar listeners */
  stop(): void;
  /** Resetar dados capturados */
  reset(): void;
  /** Total de requests capturadas */
  get count(): number;
}

/**
 * Agrupar requests capturadas em patterns de API.
 * Detecta path params (IDs numéricos, UUIDs) e cria templates.
 * Infere schemas das responses JSON.
 */
export function analyzeApiPatterns(requests: InterceptedRequest[]): ApiPattern[];

/**
 * Lista default de domínios a ignorar (analytics, tracking, ads).
 */
export const DEFAULT_IGNORE_DOMAINS: string[];
```

### 1.5.6 Endpoint Behavior Profiler

**Gravidade:** 🟡 ALTO VALOR — classifica endpoints para scraping automatizado

Dado um conjunto de endpoints descobertos (via OpenAPI, GraphQL introspection, ou interceptação), classificar cada um quanto a: auth necessário, padrão de paginação, rate limits, formato de response, e viabilidade para scraping.

**Arquivo:** `src/discovery/endpoint-profiler.ts` (~180 linhas)

```typescript
export interface EndpointProfile {
  url: string;
  method: string;
  /** Status da probe */
  status: "accessible" | "auth-required" | "rate-limited" | "blocked" | "error" | "not-found";
  /** Status code da response */
  statusCode: number;
  /** Content type da response */
  contentType: string;
  /** Tamanho da response em bytes */
  responseSize: number;
  /** Tempo de resposta em ms */
  latency: number;
  /** Headers de rate limit observados */
  rateLimits?: {
    /** X-RateLimit-Limit ou similar */
    limit?: number;
    /** X-RateLimit-Remaining */
    remaining?: number;
    /** X-RateLimit-Reset (epoch seconds ou delta) */
    resetAt?: number;
    /** Retry-After (se 429) */
    retryAfter?: number;
    /** Nome do header encontrado */
    headerNames: string[];
  };
  /** Padrão de paginação detectado */
  pagination?: {
    type: "offset" | "page" | "cursor" | "link-header" | "none";
    /** Nome do parâmetro (e.g., 'offset', 'page', 'cursor', 'after') */
    paramName: string;
    /** Tamanho de página observado */
    pageSize?: number;
    /** Total de items (se disponível no response) */
    totalItems?: number;
    /** Tem próxima página? */
    hasNext?: boolean;
  };
  /** Requer autenticação? */
  auth: {
    required: boolean;
    /** Tipo detectado */
    type?: "bearer" | "api-key" | "cookie" | "basic" | "oauth2" | "none";
    /** Header/param name onde enviar credencial */
    mechanism?: string;
  };
  /** CORS habilitado? (relevante para entender se a API é pública) */
  cors?: {
    enabled: boolean;
    allowOrigin?: string;
    allowMethods?: string[];
  };
  /** Caching headers */
  caching?: {
    cacheControl?: string;
    etag?: string;
    lastModified?: string;
    maxAge?: number;
  };
  /** Score de "scrapability" (0-100) */
  scrapabilityScore: number;
}

/**
 * Profile um endpoint individual.
 * Faz 2-3 requests: HEAD, GET, e opcionalmente GET com pagination param.
 */
export async function profileEndpoint(
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    userAgent?: string;
    /** Testar paginação? (faz requests adicionais) */
    testPagination?: boolean;
  }
): Promise<EndpointProfile>;

/**
 * Profile múltiplos endpoints em paralelo.
 * Respeita rate limits observados entre requests.
 */
export async function profileEndpoints(
  endpoints: Array<{ url: string; method?: string }>,
  options?: {
    concurrency?: number; // default: 3
    headers?: Record<string, string>;
    timeoutMs?: number;
    userAgent?: string;
    testPagination?: boolean;
    /** Callback de progresso */
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<EndpointProfile[]>;

/**
 * Calcular scrapability score baseado nos signals.
 * 100 = totalmente acessível, sem auth, JSON, paginado, sem rate limit
 * 0 = bloqueado, requer auth, sem paginação
 */
export function calculateScrapabilityScore(profile: EndpointProfile): number;
```

### 1.5.7 Site Profile Aggregator

**Gravidade:** 🔴 CRÍTICO — orquestra toda a discovery e produz o artefato final

Agrega resultados de todos os subsistemas (sitemap, OpenAPI, GraphQL, interceptação, profiling) em um **Site Profile** — um artefato JSON persistente que serve como o "mapa" completo do site para scraping ou consumo por AI agents via MCP.

**Arquivo:** `src/discovery/site-profile.ts` (~180 linhas)

```typescript
import type { SitemapUrl, SitemapParseResult } from "./sitemap-parser.js";
import type { OpenApiSpec, OpenApiEndpoint } from "./openapi-prober.js";
import type { GraphQLSchema } from "./graphql-introspect.js";
import type { ApiPattern } from "./api-interceptor.js";
import type { EndpointProfile } from "./endpoint-profiler.js";

export interface SiteProfile {
  /** Domínio base */
  domain: string;
  /** Timestamp da geração do profile */
  generatedAt: string;
  /** Versão do schema do profile (para migrations futuras) */
  schemaVersion: 1;
  /** Hash do conteúdo (para detectar se o site mudou) */
  contentHash: string;

  /** Resultados do sitemap */
  sitemap: {
    found: boolean;
    sources: Array<{ url: string; foundVia: string }>;
    totalUrls: number;
    /** Top URLs por priority (max 1000) */
    topUrls: SitemapUrl[];
    /** Último lastmod global */
    lastModified?: string;
  };

  /** Resultados do OpenAPI/Swagger */
  openapi: {
    found: boolean;
    specUrl?: string;
    spec?: OpenApiSpec;
    /** Endpoints acessíveis sem auth */
    publicEndpoints: OpenApiEndpoint[];
    /** Endpoints que requerem auth */
    protectedEndpoints: OpenApiEndpoint[];
  };

  /** Resultados do GraphQL */
  graphql: {
    found: boolean;
    endpoint?: string;
    schema?: GraphQLSchema;
    /** Introspection habilitada? */
    introspectionEnabled: boolean;
    /** Queries de exemplo geradas */
    sampleQueries: Array<{ name: string; query: string }>;
  };

  /** APIs internas descobertas via interceptação de rede */
  discoveredApis: {
    /** Patterns agrupados */
    patterns: ApiPattern[];
    /** Total de requests capturadas */
    totalRequests: number;
    /** Endpoints únicos */
    uniqueEndpoints: number;
  };

  /** Profiles de endpoints (probe results) */
  endpointProfiles: EndpointProfile[];

  /** Feeds RSS/Atom encontrados */
  feeds: Array<{
    url: string;
    type: "rss" | "atom" | "json-feed";
    title?: string;
  }>;

  /** Well-known paths que retornaram 200 */
  wellKnownResults: Array<{
    path: string;
    category: string;
    statusCode: number;
  }>;

  /** Resumo executivo para AI agents */
  summary: {
    /** Melhor estratégia de scraping recomendada */
    recommendedStrategy: "api" | "sitemap" | "graphql" | "html-scraping" | "mixed";
    /** Justificativa */
    reasoning: string;
    /** Score geral de "facilidade de scraping" (0-100) */
    overallScrapability: number;
    /** Quantos endpoints públicos acessíveis */
    publicApiCount: number;
    /** Total de URLs conhecidas */
    knownUrlCount: number;
    /** O site usa proteção anti-bot significativa? */
    hasSignificantProtection: boolean;
  };
}

export interface DiscoveryOptions {
  /** Executar probing de well-known paths? (default: true) */
  probeWellKnown?: boolean;
  /** Parsear sitemaps? (default: true) */
  parseSitemaps?: boolean;
  /** Tentar OpenAPI discovery? (default: true) */
  discoverOpenApi?: boolean;
  /** Tentar GraphQL introspection? (default: true) */
  introspectGraphQL?: boolean;
  /** Interceptar requests via Hero? (default: false — requer Engine 3) */
  interceptApiRequests?: boolean;
  /** Profilear endpoints descobertos? (default: true) */
  profileEndpoints?: boolean;
  /** Máximo de URLs de sitemap a armazenar (default: 1000) */
  maxSitemapUrls?: number;
  /** Timeout geral (default: 60_000ms) */
  timeoutMs?: number;
  /** Diretório de cache para profiles (default: .ultra-reader/profiles/) */
  cacheDir?: string;
  /** TTL do cache em ms (default: 24h) */
  cacheTtlMs?: number;
  /** Callback de progresso */
  onProgress?: (stage: string, detail: string) => void;
}

/**
 * Executar discovery completa para um domínio.
 * Orquestra todos os subsistemas em paralelo onde possível.
 *
 * Fluxo:
 * 1. probeWellKnownPaths() — HEAD requests em paralelo
 * 2. Em paralelo:
 *    a. discoverSitemaps() — se paths de sitemap encontrados
 *    b. discoverOpenApi() — se paths de OpenAPI encontrados
 *    c. introspectGraphQL() — se endpoints GraphQL encontrados
 * 3. profileEndpoints() — para todos os endpoints descobertos
 * 4. Agregar em SiteProfile
 * 5. Salvar em cache
 */
export async function discoverSite(url: string, options?: DiscoveryOptions): Promise<SiteProfile>;

/**
 * Carregar profile do cache se ainda válido.
 */
export async function loadCachedProfile(
  domain: string,
  cacheDir?: string,
  ttlMs?: number
): Promise<SiteProfile | null>;

/**
 * Salvar profile no cache.
 */
export async function saveCachedProfile(profile: SiteProfile, cacheDir?: string): Promise<void>;

/**
 * Gerar resumo executivo a partir dos dados coletados.
 */
export function generateSummary(profile: Omit<SiteProfile, "summary">): SiteProfile["summary"];
```

### 1.5.8 Discovery Module Public API

**Arquivo:** `src/discovery/index.ts` (~30 linhas)

```typescript
export {
  discoverSite,
  loadCachedProfile,
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
  type GraphQLSchema,
  type GraphQLType,
} from "./graphql-introspect.js";
export {
  setupApiInterceptor,
  analyzeApiPatterns,
  type ApiInterceptorHandle,
  type InterceptedRequest,
  type ApiPattern,
} from "./api-interceptor.js";
export { profileEndpoint, profileEndpoints, type EndpointProfile } from "./endpoint-profiler.js";
export {
  probeWellKnownPaths,
  WELL_KNOWN_PATHS,
  type WellKnownProbeResult,
  type ProbeCategory,
} from "./well-known-paths.js";
```

### 1.5.9 Integração com Engine Cascade

**Modificação em:** `src/engines/orchestrator.ts`

Antes de iniciar o cascade de engines, executar discovery rápida (well-known probing + sitemap) e disponibilizar os resultados no `ScrapeResult`:

```typescript
// No início do scrape(), antes do cascade:
if (options.discovery !== false) {
  const cachedProfile = await loadCachedProfile(domain, options.discoveryOptions?.cacheDir);
  if (cachedProfile) {
    meta.siteProfile = cachedProfile;
  } else {
    // Quick discovery: só well-known + sitemap (sem Hero interceptor)
    meta.siteProfile = await discoverSite(url, {
      ...options.discoveryOptions,
      interceptApiRequests: false, // Hero interceptor só se engine 3 ativada
      profileEndpoints: false, // profiling sob demanda
    });
  }
}
```

**Modificação em:** `src/types.ts`

```typescript
// Novos campos em ScrapeOptions:
export interface ScrapeOptions {
  // ... existing fields ...

  /** Executar API discovery antes do scrape? (default: true) */
  discovery?: boolean;
  /** Opções de discovery */
  discoveryOptions?: DiscoveryOptions;
}

// Novo campo em ScrapeResult:
export interface ScrapeResult {
  // ... existing fields ...

  /** Site profile com APIs descobertas, sitemap, etc. */
  siteProfile?: SiteProfile;
}
```

### 1.5.10 Testes Unitários

**Arquivo:** `src/__tests__/discovery/` (5 test files)

```typescript
// src/__tests__/discovery/well-known-paths.test.ts
describe("probeWellKnownPaths", () => {
  it("should probe all categories by default");
  it("should filter by specific categories");
  it("should use HEAD requests first");
  it("should handle 404 gracefully");
  it("should handle network errors gracefully");
  it("should respect timeout");
  it("should respect concurrency limit");
});

// src/__tests__/discovery/sitemap-parser.test.ts
describe("parseSitemap", () => {
  it("should parse standard urlset XML");
  it("should parse sitemapindex and list child sitemaps");
  it("should parse text format (one URL per line)");
  it("should extract lastmod, priority, changefreq");
  it("should handle image:image extensions");
  it("should handle news:news extensions");
  it("should handle malformed XML gracefully");
  it("should deduplicate URLs");
});

describe("fetchSitemap", () => {
  it("should fetch and parse remote sitemap");
  it("should decompress .gz sitemaps");
  it("should resolve sitemap index recursively up to maxDepth");
  it("should respect maxUrls limit");
  it("should filter by sinceDate");
  it("should filter by includePattern/excludePattern");
});

describe("discoverSitemaps", () => {
  it("should find sitemap via robots.txt Sitemap: directive");
  it("should fallback to well-known paths");
  it("should merge results from multiple sources");
});

// src/__tests__/discovery/openapi-prober.test.ts
describe("parseOpenApiSpec", () => {
  it("should parse OpenAPI 3.0 spec");
  it("should parse Swagger 2.0 spec");
  it("should resolve $ref references");
  it("should extract security schemes");
  it("should extract all endpoints with parameters");
});

describe("filterScrapableEndpoints", () => {
  it("should filter GET-only endpoints");
  it("should filter by auth requirement");
  it("should filter by content type");
  it("should filter by path pattern");
});

// src/__tests__/discovery/graphql-introspect.test.ts
describe("introspectGraphQL", () => {
  it("should execute introspection query via POST");
  it("should fallback to GET if POST fails");
  it("should return null if introspection disabled");
  it("should parse schema types, queries, mutations");
});

describe("generateSampleQueries", () => {
  it("should generate queries for each query type");
  it("should respect maxDepth for nested fields");
  it("should include argument placeholders");
  it("should limit to maxQueries");
});

// src/__tests__/discovery/site-profile.test.ts
describe("discoverSite", () => {
  it("should aggregate all discovery results");
  it("should return cached profile if valid");
  it("should generate summary with recommended strategy");
  it("should handle all subsystems failing gracefully");
  it("should respect per-subsystem opt-out flags");
  it("should calculate overall scrapability score");
});

describe("generateSummary", () => {
  it('should recommend "api" when OpenAPI found with public endpoints');
  it('should recommend "graphql" when introspection enabled');
  it('should recommend "sitemap" when many URLs but no API');
  it('should recommend "html-scraping" as fallback');
  it('should recommend "mixed" when multiple viable strategies');
});
```

### 1.5.11 Adaptive Engine Selection (Domain Affinity Cache)

**Gravidade:** 🔴 ALTO  
**Esforço:** ~2 dias  
**Impacto:** Evita cascade desnecessário — se sabemos que `nytimes.com` sempre requer Hero, pular HTTP e TLS economiza tempo e reduz detecção

**Problema:**

O orchestrator sempre executa a cascade completa: http → tlsclient → hero. Para domínios já conhecidos, as primeiras engines falham previsivelmente, adicionando latência (2-10s por tentativa falha) e gerando requests que podem queimar proxy IPs.

**Arquivos a criar:**

- `src/engines/engine-affinity.ts` — Cache de afinidade domain → engine

**Arquivos a modificar:**

- `src/engines/orchestrator.ts` — Consultar cache antes do cascade, atualizar após resultado

**Implementação proposta:**

```typescript
// src/engines/engine-affinity.ts

export interface EngineAffinityEntry {
  engine: string;
  successes: number;
  failures: number;
  lastSuccess: number; // timestamp
  lastFailure: number;
  avgResponseMs: number;
}

export interface DomainAffinity {
  domain: string;
  entries: Map<string, EngineAffinityEntry>; // engine name → stats
  preferredEngine: string | null;
  updatedAt: number;
}

/**
 * Cache LRU em memória com persistência opcional em disco.
 * Armazena histórico de sucesso/falha por engine para cada domínio.
 */
export class EngineAffinityCache {
  private cache = new Map<string, DomainAffinity>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(options?: { maxEntries?: number; ttlMs?: number }) {
    this.maxEntries = options?.maxEntries ?? 1000;
    this.ttlMs = options?.ttlMs ?? 24 * 60 * 60 * 1000; // 24h default
  }

  /** Retorna engine preferida para o domínio, ou null se sem dados */
  getPreferredEngine(domain: string): string | null {
    const affinity = this.cache.get(domain);
    if (!affinity || Date.now() - affinity.updatedAt > this.ttlMs) return null;
    return affinity.preferredEngine;
  }

  /** Retorna engines ordenadas por probabilidade de sucesso */
  getOrderedEngines(domain: string, defaultOrder: string[]): string[] {
    const affinity = this.cache.get(domain);
    if (!affinity) return defaultOrder;

    return [...defaultOrder].sort((a, b) => {
      const aEntry = affinity.entries.get(a);
      const bEntry = affinity.entries.get(b);
      if (!aEntry && !bEntry) return 0;
      if (!aEntry) return 1;
      if (!bEntry) return -1;

      const aScore = aEntry.successes / (aEntry.successes + aEntry.failures + 1);
      const bScore = bEntry.successes / (bEntry.successes + bEntry.failures + 1);
      return bScore - aScore; // higher success rate first
    });
  }

  /** Registrar resultado de uma engine para um domínio */
  recordResult(domain: string, engine: string, success: boolean, responseMs?: number): void {
    if (!this.cache.has(domain)) {
      this.cache.set(domain, {
        domain,
        entries: new Map(),
        preferredEngine: null,
        updatedAt: Date.now(),
      });
    }

    const affinity = this.cache.get(domain)!;
    if (!affinity.entries.has(engine)) {
      affinity.entries.set(engine, {
        engine,
        successes: 0,
        failures: 0,
        lastSuccess: 0,
        lastFailure: 0,
        avgResponseMs: 0,
      });
    }

    const entry = affinity.entries.get(engine)!;
    if (success) {
      entry.successes++;
      entry.lastSuccess = Date.now();
      if (responseMs) {
        entry.avgResponseMs =
          entry.avgResponseMs === 0 ? responseMs : entry.avgResponseMs * 0.7 + responseMs * 0.3; // EMA
      }
    } else {
      entry.failures++;
      entry.lastFailure = Date.now();
    }

    // Recalcular engine preferida
    let bestEngine: string | null = null;
    let bestScore = 0;
    for (const [name, e] of affinity.entries) {
      const total = e.successes + e.failures;
      if (total < 2) continue; // precisa de dados suficientes
      const score = e.successes / total;
      if (score > bestScore) {
        bestScore = score;
        bestEngine = name;
      }
    }
    affinity.preferredEngine = bestScore >= 0.6 ? bestEngine : null;
    affinity.updatedAt = Date.now();

    // LRU eviction
    if (this.cache.size > this.maxEntries) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
  }

  /** Limpar cache para um domínio ou todos */
  clear(domain?: string): void {
    if (domain) this.cache.delete(domain);
    else this.cache.clear();
  }

  /** Estatísticas do cache */
  stats(): { domains: number; hitRate: string } {
    const withPreference = [...this.cache.values()].filter((a) => a.preferredEngine).length;
    return {
      domains: this.cache.size,
      hitRate:
        this.cache.size > 0 ? `${Math.round((withPreference / this.cache.size) * 100)}%` : "0%",
    };
  }
}
```

**Integração no Orchestrator:**

```typescript
// orchestrator.ts — modificações
private affinityCache = new EngineAffinityCache();

async scrape(meta: ScrapeMeta): Promise<EngineResult> {
  const domain = new URL(meta.url).hostname;

  // Usar cache para reordenar engines
  const engineOrder = this.affinityCache.getOrderedEngines(domain, this.resolvedEngines);

  for (const engineName of engineOrder) {
    try {
      const result = await engine.scrape(meta);
      this.affinityCache.recordResult(domain, engineName, true, result.responseMs);
      return result;
    } catch (error) {
      this.affinityCache.recordResult(domain, engineName, false);
      // ... continue cascade
    }
  }
}
```

### 1.5.12 Circuit Breaker per Domain

**Gravidade:** 🟡 MÉDIO  
**Esforço:** ~1 dia  
**Impacto:** Para de queimar proxy IPs em domínios que estão ativamente bloqueando

**Problema:**

Se um domínio bloqueia todas as tentativas, o sistema continua tentando com exponential backoff. Isso:

- Queima proxy IPs (muitas requests falhando = IP flagged)
- Desperdiça tempo e recursos
- Pode escalar blocks (IP → IP range → ASN block)

**Arquivo a criar:**

- `src/engines/circuit-breaker.ts` — Circuit breaker per domain

**Implementação proposta:**

```typescript
// src/engines/circuit-breaker.ts

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  failureThreshold: number; // consecutivas para abrir (default: 5)
  cooldownMs: number; // tempo em open antes de half-open (default: 5 min)
  halfOpenMaxAttempts: number; // tentativas em half-open (default: 1)
  resetOnSuccess: boolean; // reset counters on success (default: true)
}

interface DomainCircuit {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureAt: number;
  openedAt: number;
  halfOpenAttempts: number;
  totalFailures: number;
  totalSuccesses: number;
}

export class DomainCircuitBreaker {
  private circuits = new Map<string, DomainCircuit>();
  private config: Required<CircuitBreakerConfig>;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      cooldownMs: config?.cooldownMs ?? 5 * 60 * 1000, // 5 min
      halfOpenMaxAttempts: config?.halfOpenMaxAttempts ?? 1,
      resetOnSuccess: config?.resetOnSuccess ?? true,
    };
  }

  /** Verificar se pode fazer request para o domínio */
  canRequest(domain: string): boolean {
    const circuit = this.circuits.get(domain);
    if (!circuit) return true;

    switch (circuit.state) {
      case "closed":
        return true;
      case "open": {
        // Cooldown expirou? Transição para half-open
        if (Date.now() - circuit.openedAt >= this.config.cooldownMs) {
          circuit.state = "half_open";
          circuit.halfOpenAttempts = 0;
          return true;
        }
        return false;
      }
      case "half_open":
        return circuit.halfOpenAttempts < this.config.halfOpenMaxAttempts;
    }
  }

  /** Registrar sucesso */
  recordSuccess(domain: string): void {
    const circuit = this.circuits.get(domain);
    if (!circuit) return;

    circuit.totalSuccesses++;
    if (this.config.resetOnSuccess) {
      circuit.state = "closed";
      circuit.consecutiveFailures = 0;
      circuit.halfOpenAttempts = 0;
    }
  }

  /** Registrar falha */
  recordFailure(domain: string): void {
    if (!this.circuits.has(domain)) {
      this.circuits.set(domain, {
        state: "closed",
        consecutiveFailures: 0,
        lastFailureAt: 0,
        openedAt: 0,
        halfOpenAttempts: 0,
        totalFailures: 0,
        totalSuccesses: 0,
      });
    }

    const circuit = this.circuits.get(domain)!;
    circuit.consecutiveFailures++;
    circuit.totalFailures++;
    circuit.lastFailureAt = Date.now();

    if (circuit.state === "half_open") {
      circuit.halfOpenAttempts++;
      if (circuit.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        circuit.state = "open";
        circuit.openedAt = Date.now();
      }
    } else if (circuit.consecutiveFailures >= this.config.failureThreshold) {
      circuit.state = "open";
      circuit.openedAt = Date.now();
    }
  }

  /** Estado atual de um domínio */
  getState(domain: string): CircuitState {
    return this.circuits.get(domain)?.state ?? "closed";
  }

  /** Tempo restante de cooldown (ms) */
  getCooldownRemaining(domain: string): number {
    const circuit = this.circuits.get(domain);
    if (!circuit || circuit.state !== "open") return 0;
    return Math.max(0, this.config.cooldownMs - (Date.now() - circuit.openedAt));
  }

  /** Reset manual */
  reset(domain?: string): void {
    if (domain) this.circuits.delete(domain);
    else this.circuits.clear();
  }
}
```

**Integração no Orchestrator:**

```typescript
// orchestrator.ts
private circuitBreaker = new DomainCircuitBreaker();

async scrape(meta: ScrapeMeta): Promise<EngineResult> {
  const domain = new URL(meta.url).hostname;

  if (!this.circuitBreaker.canRequest(domain)) {
    const remaining = this.circuitBreaker.getCooldownRemaining(domain);
    throw new Error(
      `Circuit breaker OPEN for ${domain}. Retry in ${Math.ceil(remaining / 1000)}s.`
    );
  }

  try {
    const result = await this.cascadeScrape(meta);
    this.circuitBreaker.recordSuccess(domain);
    return result;
  } catch (error) {
    this.circuitBreaker.recordFailure(domain);
    throw error;
  }
}
```

### 1.5.13 Geo-Consistency (Proxy ↔ Locale Alignment)

**Gravidade:** 🟡 MÉDIO  
**Esforço:** ~1 dia  
**Impacto:** Elimina sinal de detecção onde proxy geo e headers de locale divergem

**Problema:**

Se o scraper usa proxy no Brasil mas envia `Accept-Language: en-US` e `Sec-CH-UA-Platform: "Windows"` com timezone US, isso é um sinal de detecção forte. Anti-bot systems cruzam:

- IP geolocation vs Accept-Language
- IP geolocation vs timezone (via JS)
- IP geolocation vs Sec-CH-UA-Platform locale

**Arquivo a criar:**

- `src/utils/geo-locale.ts` — Mapeamento proxy geo → locale headers

**Arquivos a modificar:**

- `src/engines/http/index.ts` — Aplicar locale baseado no proxy
- `src/engines/tlsclient/index.ts` — Mesmo
- `src/browser/hero-config.ts` — Timezone + locale do Hero

**Implementação proposta:**

```typescript
// src/utils/geo-locale.ts

export interface GeoLocale {
  country: string;
  acceptLanguage: string;
  timezone: string;
  locale: string; // BCP 47
}

/** Mapeamento das top 30 locales por país */
const GEO_LOCALE_MAP: Record<string, GeoLocale> = {
  us: {
    country: "us",
    acceptLanguage: "en-US,en;q=0.9",
    timezone: "America/New_York",
    locale: "en-US",
  },
  gb: {
    country: "gb",
    acceptLanguage: "en-GB,en;q=0.9",
    timezone: "Europe/London",
    locale: "en-GB",
  },
  br: {
    country: "br",
    acceptLanguage: "pt-BR,pt;q=0.9,en;q=0.8",
    timezone: "America/Sao_Paulo",
    locale: "pt-BR",
  },
  de: {
    country: "de",
    acceptLanguage: "de-DE,de;q=0.9,en;q=0.8",
    timezone: "Europe/Berlin",
    locale: "de-DE",
  },
  fr: {
    country: "fr",
    acceptLanguage: "fr-FR,fr;q=0.9,en;q=0.8",
    timezone: "Europe/Paris",
    locale: "fr-FR",
  },
  jp: {
    country: "jp",
    acceptLanguage: "ja-JP,ja;q=0.9,en;q=0.8",
    timezone: "Asia/Tokyo",
    locale: "ja-JP",
  },
  kr: {
    country: "kr",
    acceptLanguage: "ko-KR,ko;q=0.9,en;q=0.8",
    timezone: "Asia/Seoul",
    locale: "ko-KR",
  },
  cn: {
    country: "cn",
    acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
    timezone: "Asia/Shanghai",
    locale: "zh-CN",
  },
  in: {
    country: "in",
    acceptLanguage: "en-IN,en;q=0.9,hi;q=0.8",
    timezone: "Asia/Kolkata",
    locale: "en-IN",
  },
  au: {
    country: "au",
    acceptLanguage: "en-AU,en;q=0.9",
    timezone: "Australia/Sydney",
    locale: "en-AU",
  },
  ca: {
    country: "ca",
    acceptLanguage: "en-CA,en;q=0.9,fr;q=0.8",
    timezone: "America/Toronto",
    locale: "en-CA",
  },
  mx: {
    country: "mx",
    acceptLanguage: "es-MX,es;q=0.9,en;q=0.8",
    timezone: "America/Mexico_City",
    locale: "es-MX",
  },
  es: {
    country: "es",
    acceptLanguage: "es-ES,es;q=0.9,en;q=0.8",
    timezone: "Europe/Madrid",
    locale: "es-ES",
  },
  it: {
    country: "it",
    acceptLanguage: "it-IT,it;q=0.9,en;q=0.8",
    timezone: "Europe/Rome",
    locale: "it-IT",
  },
  nl: {
    country: "nl",
    acceptLanguage: "nl-NL,nl;q=0.9,en;q=0.8",
    timezone: "Europe/Amsterdam",
    locale: "nl-NL",
  },
  pt: {
    country: "pt",
    acceptLanguage: "pt-PT,pt;q=0.9,en;q=0.8",
    timezone: "Europe/Lisbon",
    locale: "pt-PT",
  },
  ru: {
    country: "ru",
    acceptLanguage: "ru-RU,ru;q=0.9,en;q=0.8",
    timezone: "Europe/Moscow",
    locale: "ru-RU",
  },
  pl: {
    country: "pl",
    acceptLanguage: "pl-PL,pl;q=0.9,en;q=0.8",
    timezone: "Europe/Warsaw",
    locale: "pl-PL",
  },
  se: {
    country: "se",
    acceptLanguage: "sv-SE,sv;q=0.9,en;q=0.8",
    timezone: "Europe/Stockholm",
    locale: "sv-SE",
  },
  ar: {
    country: "ar",
    acceptLanguage: "es-AR,es;q=0.9,en;q=0.8",
    timezone: "America/Argentina/Buenos_Aires",
    locale: "es-AR",
  },
  tr: {
    country: "tr",
    acceptLanguage: "tr-TR,tr;q=0.9,en;q=0.8",
    timezone: "Europe/Istanbul",
    locale: "tr-TR",
  },
  id: {
    country: "id",
    acceptLanguage: "id-ID,id;q=0.9,en;q=0.8",
    timezone: "Asia/Jakarta",
    locale: "id-ID",
  },
  th: {
    country: "th",
    acceptLanguage: "th-TH,th;q=0.9,en;q=0.8",
    timezone: "Asia/Bangkok",
    locale: "th-TH",
  },
  sg: {
    country: "sg",
    acceptLanguage: "en-SG,en;q=0.9,zh;q=0.8",
    timezone: "Asia/Singapore",
    locale: "en-SG",
  },
  za: {
    country: "za",
    acceptLanguage: "en-ZA,en;q=0.9,af;q=0.8",
    timezone: "Africa/Johannesburg",
    locale: "en-ZA",
  },
  il: {
    country: "il",
    acceptLanguage: "he-IL,he;q=0.9,en;q=0.8",
    timezone: "Asia/Jerusalem",
    locale: "he-IL",
  },
  ae: {
    country: "ae",
    acceptLanguage: "ar-AE,ar;q=0.9,en;q=0.8",
    timezone: "Asia/Dubai",
    locale: "ar-AE",
  },
  ch: {
    country: "ch",
    acceptLanguage: "de-CH,de;q=0.9,fr;q=0.8,en;q=0.7",
    timezone: "Europe/Zurich",
    locale: "de-CH",
  },
  no: {
    country: "no",
    acceptLanguage: "nb-NO,nb;q=0.9,en;q=0.8",
    timezone: "Europe/Oslo",
    locale: "nb-NO",
  },
  dk: {
    country: "dk",
    acceptLanguage: "da-DK,da;q=0.9,en;q=0.8",
    timezone: "Europe/Copenhagen",
    locale: "da-DK",
  },
};

/**
 * Resolve locale para um país.
 * Usa proxy country se disponível, senão default para "us".
 */
export function getGeoLocale(countryCode?: string): GeoLocale {
  if (!countryCode) return GEO_LOCALE_MAP.us;
  const normalized = countryCode.toLowerCase().trim();
  return GEO_LOCALE_MAP[normalized] ?? GEO_LOCALE_MAP.us;
}

/**
 * Extrai country code do proxy URL.
 * Suporta formatos: country-br, _country-br, geo=br
 */
export function extractProxyCountry(proxyUrl?: string): string | undefined {
  if (!proxyUrl) return undefined;
  const patterns = [
    /country[=-](\w{2})/i,
    /_country[=-](\w{2})/i,
    /geo[=-](\w{2})/i,
    /cc[=-](\w{2})/i,
  ];
  for (const pattern of patterns) {
    const match = proxyUrl.match(pattern);
    if (match) return match[1].toLowerCase();
  }
  return undefined;
}

/**
 * Gera headers consistentes com a geo do proxy.
 */
export function geoConsistentHeaders(proxyUrl?: string): Record<string, string> {
  const country = extractProxyCountry(proxyUrl);
  const locale = getGeoLocale(country);
  return {
    "Accept-Language": locale.acceptLanguage,
  };
}
```

**Integração nas engines:**

```typescript
// Em http/index.ts e tlsclient/index.ts:
import { geoConsistentHeaders, getGeoLocale } from "../../utils/geo-locale.js";

const geoHeaders = geoConsistentHeaders(meta.options?.proxy?.url);
const mergedHeaders = {
  ...DEFAULT_HEADERS,
  ...geoHeaders, // Accept-Language alinhado com proxy geo
  "User-Agent": rotatedUa,
  ...refererHeader,
  ...meta.options?.headers,
};
```

**Integração no Hero:**

```typescript
// Em hero-config.ts:
import { getGeoLocale, extractProxyCountry } from "../utils/geo-locale.js";

const country = extractProxyCountry(proxyUrl);
const locale = getGeoLocale(country);

const heroOptions = {
  // ... existing config
  locale: locale.locale,
  timezoneId: locale.timezone,
};
```

### 1.5.14 Accept-Language Diversity

**Gravidade:** 🟢 BAIXO (coberto parcialmente por 1.5.13)  
**Esforço:** ~0.5 dia  
**Impacto:** Garante que Accept-Language varie naturalmente entre requests

**Nota:** Esta seção complementa 1.5.13. Enquanto geo-consistency alinha locale com proxy geo, Accept-Language diversity garante que mesmo sem proxy, o header não seja sempre idêntico.

**Implementação proposta:**

```typescript
// Adicionar ao src/utils/geo-locale.ts

/** Variações naturais de Accept-Language para uma locale */
const LANGUAGE_VARIATIONS: Record<string, string[]> = {
  "en-US": [
    "en-US,en;q=0.9",
    "en-US,en;q=0.9,es;q=0.8",
    "en-US,en;q=0.9,fr;q=0.8",
    "en-US,en;q=0.9,de;q=0.7",
    "en-US,en;q=0.8",
  ],
  "pt-BR": [
    "pt-BR,pt;q=0.9,en;q=0.8",
    "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "pt-BR,pt;q=0.9,es;q=0.8,en;q=0.7",
    "pt-BR,en-US;q=0.9,en;q=0.8",
  ],
  "es-ES": [
    "es-ES,es;q=0.9,en;q=0.8",
    "es-ES,es;q=0.9,ca;q=0.8,en;q=0.7",
    "es-ES,es;q=0.9,pt;q=0.8,en;q=0.7",
  ],
  // ... análogo para outras locales
};

/**
 * Retorna Accept-Language com variação natural.
 * Evita enviar sempre o mesmo header.
 */
export function getRandomAcceptLanguage(locale: string = "en-US"): string {
  const variations = LANGUAGE_VARIATIONS[locale];
  if (!variations || variations.length === 0) {
    return `${locale},en;q=0.9`;
  }
  return variations[Math.floor(Math.random() * variations.length)];
}
```

---

## Phase 2 — Core Anti-Bot

> Funcionalidades essenciais para power scraping sério.

### 2.1 Integração com CAPTCHA Solving Services

**Gravidade:** 🔴 CRÍTICO  
**Esforço:** ~3-4 dias  
**Impacto:** Desbloqueia sites com reCAPTCHA, hCaptcha, Turnstile interativo, Arkose/FunCaptcha, GeeTest, DataDome, Akamai BMP, Amazon WAF

#### 2.1.1 Provider Research & Comparison

Três provedores avaliados (fev/2026) para uso low-volume e budget-friendly:

| Critério                 | CapSolver                   | 2Captcha                         | Anti-Captcha                    |
| ------------------------ | --------------------------- | -------------------------------- | ------------------------------- |
| **Método**               | AI/ML (sem workers humanos) | Workers humanos (~12k worldwide) | Workers humanos (~2k worldwide) |
| **Velocidade média**     | Sub-segundo (AI)            | 5-15s (varia com hora do dia)    | ~5s (consistente)               |
| **reCAPTCHA v2**         | ~$0.80-1.50/1k              | ~$1-3/1k                         | $0.95-2.00/1k                   |
| **reCAPTCHA v3**         | ~$1-2/1k                    | ~$1.50-3/1k                      | $1.00-2.00/1k                   |
| **reCAPTCHA Enterprise** | ~$2-5/1k                    | ~$1-3/1k                         | $5.00/1k                        |
| **Cloudflare Turnstile** | ~$1-2/1k                    | ~$1.50/1k                        | $2.00/1k                        |
| **CF Challenge Pages**   | ✅ Suportado nativamente    | ❌ Não suportado                 | ❌ Não suportado                |
| **hCaptcha**             | ✅                          | ✅                               | ✅                              |
| **Arkose/FunCaptcha**    | ✅                          | ✅ ($1.50-50/1k)                 | $3.00/1k                        |
| **GeeTest**              | ✅                          | ✅ ($3/1k)                       | $1.80/1k                        |
| **DataDome**             | ✅ Nativo                   | ✅ ($3/1k)                       | ❌                              |
| **Akamai BMP**           | ❌                          | ✅ ($4.30/1k)                    | ❌                              |
| **Amazon WAF**           | ✅                          | ✅ ($1.50/1k)                    | $2.00/1k                        |
| **Image CAPTCHA**        | ✅                          | ✅ ($0.50/1k)                    | $0.50-0.70/1k                   |
| **Depósito mínimo**      | ~$1                         | ~$3                              | ~$1                             |
| **API pattern**          | createTask/getTaskResult    | createTask/getTaskResult         | createTask/getTaskResult        |
| **Proxy support**        | ✅ (proxyless + proxied)    | ✅ (proxyless + proxied)         | ✅ (proxyless + proxied)        |
| **SDK oficial (npm)**    | `capsolver-npm`             | `2captcha-ts`                    | HTTP API direto                 |
| **Desde**                | ~2022                       | 2014                             | 2007                            |
| **Custom tasks**         | ❌                          | ❌                               | ✅ (AntiGate — browser actions) |

**Recomendação para Ultra Reader:**

- **Default: CapSolver** — melhor velocidade (AI), único que resolve CF Challenge Pages + DataDome nativamente. Ideal para scraping automatizado.
- **Fallback: 2Captcha** — mais barato para volume baixo, único com Akamai BMP. Widest CAPTCHA type coverage.
- **Alternativa enterprise: Anti-Captcha** — mais estável (18 anos), AntiGate para custom tasks, melhor para reCAPTCHA v2 simples.

**Estratégia multi-provider:** O `CaptchaSolver` abstrato tenta o provider primário. Se falhar (saldo zero, timeout, tipo não suportado), fallback automático para o secundário.

#### 2.1.2 Arquivos a criar

- `src/captcha/types.ts` — Tipos de CAPTCHA, config, task/result interfaces
- `src/captcha/solver.ts` — Interface abstrata `CaptchaSolver` + `CaptchaSolverFactory`
- `src/captcha/base-provider.ts` — Classe base com polling loop, retry, error handling
- `src/captcha/capsolver.ts` — Implementação CapSolver (default provider)
- `src/captcha/two-captcha.ts` — Implementação 2Captcha
- `src/captcha/anti-captcha.ts` — Implementação Anti-Captcha
- `src/captcha/multi-provider.ts` — Multi-provider com fallback automático
- `src/captcha/site-key-extractor.ts` — Extração de siteKey do DOM (reCAPTCHA, hCaptcha, Turnstile, Arkose)
- `src/captcha/index.ts` — Re-exports

#### 2.1.3 Arquivos a modificar

- `src/types.ts` — Adicionar `captcha?: CaptchaSolverConfig` e `captchaFallback?: CaptchaSolverConfig`
- `src/engines/hero/index.ts` — Integrar solver quando CAPTCHA detectado
- `src/cloudflare/handler.ts` — Usar solver para Turnstile interativo
- `src/cloudflare/detector.ts` — Distinguir managed vs interactive Turnstile vs full challenge

#### 2.1.4 API proposta

```typescript
// src/captcha/types.ts

/** Supported CAPTCHA types */
type CaptchaType =
  | "recaptcha_v2"
  | "recaptcha_v3"
  | "recaptcha_enterprise"
  | "hcaptcha"
  | "turnstile"
  | "cloudflare_challenge" // Full CF challenge page (CapSolver only)
  | "funcaptcha" // Arkose Labs
  | "geetest"
  | "datadome"
  | "akamai_bmp" // 2Captcha only
  | "amazon_waf"
  | "image" // Image-to-text
  | "audio"; // Audio-to-text

/** Provider identifiers */
type CaptchaProvider = "capsolver" | "two-captcha" | "anti-captcha" | "custom";

/** Which types each provider supports */
const PROVIDER_CAPABILITIES: Record<CaptchaProvider, CaptchaType[]> = {
  capsolver: [
    "recaptcha_v2",
    "recaptcha_v3",
    "recaptcha_enterprise",
    "hcaptcha",
    "turnstile",
    "cloudflare_challenge",
    "funcaptcha",
    "geetest",
    "datadome",
    "amazon_waf",
    "image",
  ],
  "two-captcha": [
    "recaptcha_v2",
    "recaptcha_v3",
    "recaptcha_enterprise",
    "hcaptcha",
    "turnstile",
    "funcaptcha",
    "geetest",
    "datadome",
    "akamai_bmp",
    "amazon_waf",
    "image",
    "audio",
  ],
  "anti-captcha": [
    "recaptcha_v2",
    "recaptcha_v3",
    "recaptcha_enterprise",
    "hcaptcha",
    "turnstile",
    "funcaptcha",
    "geetest",
    "amazon_waf",
    "image",
  ],
  custom: [], // User-defined
};

interface CaptchaSolverConfig {
  provider: CaptchaProvider;
  apiKey: string;
  timeoutMs?: number; // default: 120000
  maxRetries?: number; // default: 3
  pollingIntervalMs?: number; // default: 3000 (CapSolver: 1000)
  preferredMethod?: "token" | "click"; // default: 'token'
  proxyless?: boolean; // default: true (use provider's proxies)
}

/** Unified task request */
interface CaptchaTask {
  type: CaptchaType;
  pageUrl: string;
  siteKey?: string; // reCAPTCHA, hCaptcha, Turnstile
  action?: string; // reCAPTCHA v3 action
  minScore?: number; // reCAPTCHA v3 minimum score (0.1-0.9)
  enterprisePayload?: Record<string, unknown>; // reCAPTCHA Enterprise
  imageBase64?: string; // Image CAPTCHA
  gt?: string; // GeeTest gt param
  challenge?: string; // GeeTest challenge param
  subdomain?: string; // Arkose subdomain
  publicKey?: string; // Arkose public key
  proxy?: ProxyConfig; // Pass through user's proxy to solver
}

/** Unified task result */
interface CaptchaResult {
  token: string; // Solved token to inject
  taskId: string; // Provider task ID
  provider: CaptchaProvider;
  type: CaptchaType;
  solveTimeMs: number;
  cost?: number; // Cost in USD (if available)
}

// src/captcha/solver.ts

interface CaptchaSolver {
  /** Solve any supported CAPTCHA type */
  solve(task: CaptchaTask): Promise<CaptchaResult>;

  /** Check if this provider supports a CAPTCHA type */
  supports(type: CaptchaType): boolean;

  /** Get remaining account balance in USD */
  getBalance(): Promise<number>;

  /** Report incorrect solution (for refund) */
  reportIncorrect(taskId: string): Promise<void>;

  /** Provider identifier */
  readonly provider: CaptchaProvider;
}

// src/captcha/base-provider.ts

abstract class BaseCaptchaProvider implements CaptchaSolver {
  protected readonly config: CaptchaSolverConfig;
  abstract readonly provider: CaptchaProvider;

  /** Subclass implements API-specific createTask */
  protected abstract createTask(task: CaptchaTask): Promise<string>;

  /** Subclass implements API-specific getTaskResult */
  protected abstract getTaskResult(taskId: string): Promise<CaptchaResult | null>;

  /** Shared polling loop with exponential backoff */
  async solve(task: CaptchaTask): Promise<CaptchaResult> {
    if (!this.supports(task.type)) {
      throw new CaptchaError(`${this.provider} does not support ${task.type}`);
    }

    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < (this.config.maxRetries ?? 3); attempt++) {
      try {
        const taskId = await this.createTask(task);
        const pollingInterval = this.config.pollingIntervalMs ?? 3000;
        const timeout = this.config.timeoutMs ?? 120000;

        while (Date.now() - startTime < timeout) {
          await delay(pollingInterval);
          const result = await this.getTaskResult(taskId);
          if (result) {
            return { ...result, solveTimeMs: Date.now() - startTime };
          }
        }
        throw new CaptchaError(`Timeout after ${timeout}ms`, { taskId });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!isRetryableError(error)) throw lastError;
      }
    }
    throw lastError ?? new CaptchaError("Max retries exceeded");
  }
}

// src/captcha/multi-provider.ts

class MultiProviderSolver implements CaptchaSolver {
  private primary: CaptchaSolver;
  private fallback?: CaptchaSolver;

  constructor(primary: CaptchaSolver, fallback?: CaptchaSolver) {
    this.primary = primary;
    this.fallback = fallback;
  }

  async solve(task: CaptchaTask): Promise<CaptchaResult> {
    // 1. If primary supports the type, try it first
    if (this.primary.supports(task.type)) {
      try {
        return await this.primary.solve(task);
      } catch (error) {
        if (this.fallback?.supports(task.type)) {
          return await this.fallback.solve(task);
        }
        throw error;
      }
    }
    // 2. If primary doesn't support it, go straight to fallback
    if (this.fallback?.supports(task.type)) {
      return await this.fallback.solve(task);
    }
    throw new CaptchaError(`No provider supports ${task.type}`);
  }

  get provider(): CaptchaProvider {
    return this.primary.provider;
  }
  supports(type: CaptchaType): boolean {
    return this.primary.supports(type) || (this.fallback?.supports(type) ?? false);
  }
  async getBalance(): Promise<number> {
    return this.primary.getBalance();
  }
  async reportIncorrect(taskId: string): Promise<void> {
    return this.primary.reportIncorrect(taskId);
  }
}

// src/captcha/site-key-extractor.ts

interface ExtractedCaptchaInfo {
  type: CaptchaType;
  siteKey: string;
  action?: string; // reCAPTCHA v3
  pageUrl: string;
}

/** Extracts CAPTCHA site keys from Hero DOM */
async function extractCaptchaInfo(hero: Hero): Promise<ExtractedCaptchaInfo | null> {
  const url = await hero.url;

  // reCAPTCHA v2/v3 — look for data-sitekey attribute
  const recaptchaKey = await hero.document.querySelector(
    ".g-recaptcha[data-sitekey], [data-sitekey]"
  );
  if (recaptchaKey) {
    const siteKey = await recaptchaKey.getAttribute("data-sitekey");
    const action = await recaptchaKey.getAttribute("data-action");
    const isV3 = await hero.document.querySelector('script[src*="recaptcha/api.js?render="]');
    return {
      type: isV3 ? "recaptcha_v3" : "recaptcha_v2",
      siteKey: siteKey ?? "",
      action: action ?? undefined,
      pageUrl: url,
    };
  }

  // hCaptcha — look for h-captcha div
  const hcaptchaKey = await hero.document.querySelector(".h-captcha[data-sitekey]");
  if (hcaptchaKey) {
    return {
      type: "hcaptcha",
      siteKey: (await hcaptchaKey.getAttribute("data-sitekey")) ?? "",
      pageUrl: url,
    };
  }

  // Turnstile — look for cf-turnstile div
  const turnstileKey = await hero.document.querySelector(".cf-turnstile[data-sitekey]");
  if (turnstileKey) {
    return {
      type: "turnstile",
      siteKey: (await turnstileKey.getAttribute("data-sitekey")) ?? "",
      pageUrl: url,
    };
  }

  // Arkose/FunCaptcha — look for enforcement script or iframe
  const arkoseKey = await hero.document.querySelector(
    '[data-public-key], script[src*="arkoselabs.com"]'
  );
  if (arkoseKey) {
    return {
      type: "funcaptcha",
      siteKey: (await arkoseKey.getAttribute("data-public-key")) ?? "",
      pageUrl: url,
    };
  }

  return null;
}

// src/types.ts — additions
interface ScrapeOptions {
  // ... existing
  captcha?: CaptchaSolverConfig;
  captchaFallback?: CaptchaSolverConfig; // Auto-fallback provider
}
```

#### 2.1.5 Flow de integração no Hero engine

```
1. Hero navega para URL
2. Cloudflare detector identifica challenge type
3. Se challenge = turnstile/captcha:
   a. extractCaptchaInfo(hero) → { type, siteKey, pageUrl }
   b. Se siteKey encontrado:
      i.  MultiProviderSolver.solve({ type, siteKey, pageUrl })
      ii. Injetar token no callback:
          - reCAPTCHA: hero.evaluate(() => grecaptcha.getResponse = () => token)
          - hCaptcha: hero.evaluate(() => hcaptcha.getResponse = () => token)
          - Turnstile: hero.evaluate(() => turnstile.getResponse = () => token)
      iii. Submeter form via hero.click() no botão submit
      iv.  Aguardar navigation/redirect (max 15s)
   c. Se siteKey NÃO encontrado (CF Challenge page sem widget):
      i.  Se CapSolver: usar cloudflare_challenge task type (resolve full page)
      ii. Se outro provider: fallback para Hero polling (waitForChallengeResolution)
4. Verificar se challenge resolvido (URL mudou ou challenge signals cleared)
5. Se ainda blocked → retry com outro provider ou abort
6. Extrair conteúdo normalmente
```

#### 2.1.6 Error handling & cost control

```typescript
// Erros específicos de CAPTCHA
class CaptchaError extends ReaderError {
  constructor(
    message: string,
    options?: {
      taskId?: string;
      provider?: CaptchaProvider;
      type?: CaptchaType;
      cause?: Error;
    }
  ) {
    super(message, { code: "CAPTCHA_FAILED", retryable: true, ...options });
  }
}

class CaptchaBalanceError extends CaptchaError {
  /* saldo insuficiente */
}
class CaptchaUnsupportedError extends CaptchaError {
  /* tipo não suportado, retryable: false */
}
class CaptchaTimeoutError extends CaptchaError {
  /* timeout no polling */
}

// Cost control — evitar gastar créditos desnecessariamente
interface CaptchaCostControl {
  maxSolvesPerMinute?: number; // default: 10
  maxDailySpendUsd?: number; // default: unlimited
  cacheTokens?: boolean; // default: true, cache tokens por (siteKey, type)
  cacheTokenTtlMs?: number; // default: 90000 (tokens geralmente duram 2 min)
}
```

#### 2.1.7 Dependências externas

- HTTP `fetch()` direto para todas as APIs (sem SDK npm — reduz deps, mesmo createTask/getTaskResult pattern)
- API key de pelo menos um provedor (CapSolver recomendado como default)
- Custo estimado para uso baixo: ~$1-5/mês (poucas centenas de solves)

---

### 2.2 Behavioral Simulation (Human-Like Interaction)

**Gravidade:** 🔴 ALTO  
**Esforço:** ~3 dias  
**Impacto:** Evita detecção por análise comportamental

**Arquivos a criar:**

- `src/utils/behavior-simulator.ts` — Simulação de comportamento humano

**Arquivos a modificar:**

- `src/engines/hero/index.ts` — Integrar simulação antes da extração
- `src/types.ts` — Adicionar `simulateBehavior?: boolean | BehaviorConfig`

**Implementação proposta:**

```typescript
// src/utils/behavior-simulator.ts
// DUP-01 FIX: BehaviorSimulator agora é um facade que delega a geração de
// comportamento para BehaviorGenerator (Phase 8.9), evitando duplicação da
// lógica de Bézier/mouse/scroll. BehaviorGenerator gera os dados,
// BehaviorSimulator os executa via Hero.
import Hero from "@ulixee/hero";
import { BehaviorGenerator, type SyntheticBehavior } from "../reverse/behavior-generator.js";

interface BehaviorConfig {
  mouseMovement?: boolean; // default: true
  scrolling?: boolean; // default: true
  randomDelays?: boolean; // default: true
  clickPatterns?: boolean; // default: false
  minActionDelay?: number; // default: 100ms
  maxActionDelay?: number; // default: 2000ms
  /** Duration of synthetic behavior (default: 3000ms) */
  durationMs?: number;
}

export class BehaviorSimulator {
  private generator = new BehaviorGenerator();

  constructor(
    private hero: Hero,
    private config: BehaviorConfig
  ) {}

  async simulateHumanPresence(): Promise<void> {
    // 1. Random initial wait (como humano lendo a página)
    await this.randomDelay(500, 2000);

    // 2. Gerar comportamento sintético via BehaviorGenerator (Fitts's Law, Gaussian, cubic Bézier)
    const behavior = this.generator.generate({
      durationMs: this.config.durationMs ?? 3000,
      viewport: { width: 1920, height: 1080 },
      interactionType: "browsing",
    });

    // 3. Executar mouse movements (se habilitado)
    if (this.config.mouseMovement !== false) {
      await this.executeMouse(behavior);
    }

    // 4. Executar scroll behavior (se habilitado)
    if (this.config.scrolling !== false) {
      await this.executeScroll(behavior);
    }

    // 5. Random micro-interactions
    if (this.config.randomDelays) {
      await this.randomDelay(200, 800);
    }
  }

  private async executeMouse(behavior: SyntheticBehavior): Promise<void> {
    // Execute every 3rd point for performance (BehaviorGenerator gera ~60fps data)
    for (let i = 0; i < behavior.mouseTrail.length; i += 3) {
      const point = behavior.mouseTrail[i];
      await this.hero.interact({ move: [point.x, point.y] });
      await this.randomDelay(10, 50);
    }
  }

  private async executeScroll(behavior: SyntheticBehavior): Promise<void> {
    for (const scroll of behavior.scrollEvents) {
      await this.hero.interact({
        scroll: { y: scroll.y - (behavior.scrollEvents[0]?.y ?? 0) },
      });
      await this.randomDelay(300, 1500);
    }
  }

  private async randomDelay(min: number, max: number): Promise<void> {
    const delay = min + Math.random() * (max - min);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
```

**Integração no Hero engine:**

```typescript
// src/engines/hero/index.ts — após waitForLoad, antes de extract
if (options.simulateBehavior !== false) {
  const simulator = new BehaviorSimulator(hero, options.behaviorConfig ?? {});
  await simulator.simulateHumanPresence();
}
```

---

### 2.3 Honeypot Trap Detection

**Gravidade:** 🟡 MÉDIO  
**Esforço:** ~4h  
**Impacto:** Evita ban por seguir links honeypot no crawler

**Arquivos a criar:**

- `src/utils/honeypot-detector.ts` — Detecção de links honeypot

**Arquivos a modificar:**

- `src/crawler.ts` — Filtrar links honeypot antes de seguir
- `src/utils/content-cleaner.ts` — Remover elementos honeypot

**Implementação proposta:**

```typescript
// src/utils/honeypot-detector.ts
export function isHoneypotLink(element: Element): boolean {
  const style = element.getAttribute("style") || "";
  const classList = element.classList;

  // CSS-based invisibility
  if (
    style.includes("display:none") ||
    style.includes("display: none") ||
    style.includes("visibility:hidden") ||
    style.includes("visibility: hidden") ||
    style.includes("opacity:0") ||
    style.includes("opacity: 0") ||
    style.includes("font-size:0") ||
    style.includes("font-size: 0") ||
    style.includes("height:0") ||
    style.includes("width:0") ||
    (style.includes("position:absolute") && style.includes("left:-"))
  )
    return true;

  // ARIA/accessibility hidden
  if (
    element.getAttribute("aria-hidden") === "true" ||
    element.getAttribute("tabindex") === "-1" ||
    element.hasAttribute("hidden")
  )
    return true;

  // Common honeypot class names
  const suspiciousClasses = ["honeypot", "hp-link", "trap", "hidden-link", "bot-trap"];
  if (suspiciousClasses.some((c) => classList.contains(c))) return true;

  // Extremely small dimensions via computed style (browser engine only)
  const rect = element.getBoundingClientRect?.();
  if (rect && (rect.width < 1 || rect.height < 1)) return true;

  return false;
}
```

---

### 2.4 Dynamic Content Interaction (Scroll, Lazy Load, Load More)

**Gravidade:** 🟡 MÉDIO  
**Esforço:** ~1 dia  
**Impacto:** Captura conteúdo dinâmico que requer interação

**Arquivos a criar:**

- `src/utils/page-interaction.ts` — Utilitários de interação com a página

**Arquivos a modificar:**

- `src/engines/hero/index.ts` — Integrar scroll/interaction
- `src/types.ts` — Adicionar `scrollToBottom`, `loadMoreSelector`, `lazyLoadImages`

**API proposta:**

```typescript
// src/types.ts
interface ScrapeOptions {
  // ... existing
  scrollToBottom?: boolean; // default: false
  maxScrolls?: number; // default: 10
  scrollDelayMs?: number; // default: 1000
  loadMoreSelector?: string; // CSS selector for "Load More" button
  maxLoadMoreClicks?: number; // default: 5
  lazyLoadImages?: boolean; // default: false (trigger IntersectionObserver)
}
```

**Implementação:**

```typescript
// src/utils/page-interaction.ts
export async function scrollToBottom(hero: Hero, options: ScrollOptions): Promise<void> {
  let previousHeight = 0;
  let scrollCount = 0;

  while (scrollCount < (options.maxScrolls ?? 10)) {
    const currentHeight = await hero.evaluate(() => document.body.scrollHeight);
    if (currentHeight === previousHeight) break;

    await hero.interact({ scroll: [0, currentHeight] });
    await new Promise((r) => setTimeout(r, jitteredDelay(options.scrollDelayMs ?? 1000)));

    previousHeight = currentHeight;
    scrollCount++;
  }
}

export async function clickLoadMore(
  hero: Hero,
  selector: string,
  maxClicks: number
): Promise<void> {
  for (let i = 0; i < maxClicks; i++) {
    const button = await hero.document.querySelector(selector);
    if (!button) break;

    await hero.interact({ click: button });
    await new Promise((r) => setTimeout(r, jitteredDelay(1500)));
    await hero.waitForPaintingStable();
  }
}
```

---

### 2.5 Browser Fingerprint Rotation

**Gravidade:** 🟡 MÉDIO  
**Esforço:** ~4h  
**Impacto:** Evita correlação entre sessões via fingerprint fixo

**Arquivos a criar:**

- `src/utils/fingerprint-profiles.ts` — Pool de browser profiles

**Arquivos a modificar:**

- `src/browser/hero-config.ts:76-86` — Usar profile rotacionado
- `src/types.ts` — Adicionar `rotateFingerprint?: boolean`

**Implementação proposta:**

```typescript
// src/utils/fingerprint-profiles.ts
interface BrowserProfile {
  viewport: { width: number; height: number };
  locale: string;
  timezone: string;
  platform: string;
}

const PROFILES: BrowserProfile[] = [
  {
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    timezone: "America/New_York",
    platform: "Win32",
  },
  {
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezone: "America/Los_Angeles",
    platform: "MacIntel",
  },
  {
    viewport: { width: 1366, height: 768 },
    locale: "en-GB",
    timezone: "Europe/London",
    platform: "Win32",
  },
  {
    viewport: { width: 1536, height: 864 },
    locale: "de-DE",
    timezone: "Europe/Berlin",
    platform: "Win32",
  },
  {
    viewport: { width: 2560, height: 1440 },
    locale: "en-US",
    timezone: "America/Chicago",
    platform: "MacIntel",
  },
  {
    viewport: { width: 1680, height: 1050 },
    locale: "fr-FR",
    timezone: "Europe/Paris",
    platform: "Linux x86_64",
  },
  {
    viewport: { width: 1280, height: 720 },
    locale: "pt-BR",
    timezone: "America/Sao_Paulo",
    platform: "Win32",
  },
  {
    viewport: { width: 1920, height: 1200 },
    locale: "ja-JP",
    timezone: "Asia/Tokyo",
    platform: "MacIntel",
  },
  // ... 20+ profiles
];

export function getRandomProfile(): BrowserProfile {
  return PROFILES[Math.floor(Math.random() * PROFILES.length)];
}
```

---

## Phase 3 — Advanced Evasion

> Técnicas avançadas para sites com proteção enterprise.

### 3.1 Enterprise WAF Detection Framework

**Gravidade:** 🔴 ALTO  
**Esforço:** ~3-5 dias  
**Impacto:** Detecta e adapta estratégia para WAFs enterprise

**Arquivos a criar:**

- `src/waf/detector.ts` — Framework de detecção de WAFs
- `src/waf/akamai.ts` — Detecção e mitigação Akamai Bot Manager
- `src/waf/perimeterx.ts` — Detecção PerimeterX/HUMAN
- `src/waf/datadome.ts` — Detecção DataDome
- `src/waf/kasada.ts` — Detecção Kasada
- `src/waf/types.ts` — Tipos de WAF
- `src/waf/index.ts` — Re-exports

**Arquivos a modificar:**

- `src/engines/orchestrator.ts` — Integrar WAF detection no cascade
- `src/engines/http/index.ts` — Adicionar patterns de WAFs enterprise
- `src/engines/tlsclient/index.ts` — Adicionar patterns
- `src/errors.ts` — Adicionar `WafBlockedError`

**Implementação proposta:**

```typescript
// src/waf/types.ts
type WafProvider =
  | "cloudflare"
  | "akamai"
  | "perimeterx"
  | "datadome"
  | "kasada"
  | "shape"
  | "unknown";

interface WafDetectionResult {
  detected: boolean;
  provider: WafProvider;
  challengeType: "js" | "captcha" | "pow" | "block" | "none";
  confidence: number; // 0-1
  signals: string[];
}

// src/waf/detector.ts
export function detectWaf(html: string, headers: Headers, url: string): WafDetectionResult {
  // Check each WAF in order of market share
  for (const detector of [
    detectCloudflare,
    detectAkamai,
    detectPerimeterX,
    detectDataDome,
    detectKasada,
  ]) {
    const result = detector(html, headers, url);
    if (result.detected) return result;
  }
  return {
    detected: false,
    provider: "unknown",
    challengeType: "none",
    confidence: 0,
    signals: [],
  };
}
```

**Sinais de detecção por WAF:**

| WAF            | Headers                    | Cookies                     | DOM/JS patterns                                         |
| -------------- | -------------------------- | --------------------------- | ------------------------------------------------------- |
| **Akamai**     | `Akamai-GRN`, `X-Akamai-*` | `_abck`, `ak_bmsc`, `bm_sz` | `/_sec/cp_challenge/`, `akam` prefixed vars             |
| **PerimeterX** | `X-PX-*`                   | `_px3`, `_pxvid`, `_pxhd`   | `/_pxcaptcha/`, `window._pxAppId`                       |
| **DataDome**   | `X-DataDome-*`             | `datadome`                  | `js.datadome.co`, `dd.js`                               |
| **Kasada**     | -                          | `_ct_`, `ct_`               | `/149e9513-01fa-4fb0-aad4-566afd725d1b/` (PoW endpoint) |
| **Shape/F5**   | -                          | `_imp_apg_r_`               | Polymorphic JS, `f5_cspm`                               |

---

### 3.2 Cookie Injection e Session Replay

**Gravidade:** 🟡 MÉDIO  
**Esforço:** ~1 dia  
**Impacto:** Permite scraping de sites atrás de login

**Arquivos a modificar:**

- `src/types.ts` — Adicionar `cookies?: CookieConfig[]`
- `src/engines/http/index.ts` — Injetar cookies via `Cookie` header
- `src/engines/tlsclient/index.ts` — Injetar cookies
- `src/engines/hero/index.ts` — Injetar cookies via `hero.setCookie()`

**API proposta:**

```typescript
// src/types.ts
interface CookieConfig {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  expires?: number; // Unix timestamp
}

interface ScrapeOptions {
  // ... existing
  cookies?: CookieConfig[];
  cookieString?: string; // Shortcut: "name1=val1; name2=val2"
}
```

---

### 3.3 HTTP/2 Fingerprint Control

**Gravidade:** 🟡 MÉDIO  
**Esforço:** ~2 dias  
**Impacto:** Evita detecção por fingerprint HTTP/2 (Akamai)

**Análise:**

- `fetch()` nativo do Node.js não expõe controle sobre HTTP/2 settings frames
- `got-scraping` usa `http2-wrapper` que dá controle limitado
- Hero/Chromium emula HTTP/2 settings de Chrome real

**Opções:**

1. **Opção A** (Recomendada): Para HTTP engine, usar `undici` com HTTP/2 custom settings
2. **Opção B**: Substituir `fetch()` nativo por `curl-impersonate` via child_process
3. **Opção C**: Aceitar a limitação e confiar no cascade para Hero engine

**Arquivos a modificar (se Opção A):**

- `src/engines/http/index.ts` — Substituir `fetch()` por `undici.request()` com HTTP/2 settings
- `package.json` — Adicionar `undici` dependency

```typescript
// Exemplo com undici (pseudo-código)
import { request } from "undici";

const response = await request(url, {
  method: "GET",
  headers: browserHeaders,
  // HTTP/2 settings que simulam Chrome
});
```

**Recomendação:** Opção C para v1.0, Opção A para v2.0. O cascade para Hero já cobre a maioria dos casos.

---

### 3.4 Header Order Fingerprinting

**Gravidade:** 🔴 ALTO  
**Esforço:** ~2 dias  
**Impacto:** Elimina detecção por ordenação de headers HTTP (Akamai, DataDome)

**Problema:**

WAFs como Akamai e DataDome verificam a **ordem** dos headers HTTP, não apenas seus valores. Chrome envia headers numa sequência específica:

```
Host → Connection → sec-ch-ua → sec-ch-ua-mobile → sec-ch-ua-platform →
Upgrade-Insecure-Requests → User-Agent → Accept → Sec-Fetch-Site →
Sec-Fetch-Mode → Sec-Fetch-User → Sec-Fetch-Dest → Accept-Encoding →
Accept-Language → Cookie
```

Node.js `fetch()` e `got-scraping` não garantem esta ordem. Isto é um vetor de detecção real e ativo.

**Arquivos a criar:**

- `src/utils/header-order.ts` — Mapeamento de ordem de headers por browser

**Arquivos a modificar:**

- `src/engines/http/index.ts` — Aplicar ordenação antes de enviar
- `src/engines/tlsclient/index.ts` — Aplicar ordenação

**Implementação proposta:**

```typescript
// src/utils/header-order.ts

// Chrome header order (verificado via chrome://net-internals)
const CHROME_HEADER_ORDER = [
  "host",
  "connection",
  "cache-control",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "upgrade-insecure-requests",
  "user-agent",
  "accept",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-user",
  "sec-fetch-dest",
  "referer",
  "accept-encoding",
  "accept-language",
  "cookie",
] as const;

const FIREFOX_HEADER_ORDER = [
  "host",
  "user-agent",
  "accept",
  "accept-language",
  "accept-encoding",
  "connection",
  "referer",
  "cookie",
  "upgrade-insecure-requests",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "te",
] as const;

type BrowserHeaderOrder = "chrome" | "firefox" | "safari";

/**
 * Reordena headers para corresponder à ordem real do browser especificado.
 * Headers não listados são adicionados ao final (ordem original preservada).
 */
export function orderHeaders(
  headers: Record<string, string>,
  browser: BrowserHeaderOrder = "chrome"
): Record<string, string> {
  const order = browser === "firefox" ? FIREFOX_HEADER_ORDER : CHROME_HEADER_ORDER; // Safari ≈ Chrome order

  const ordered: Record<string, string> = {};
  const lowerHeaders = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), { original: k, value: v }])
  );

  // Adicionar headers na ordem do browser
  for (const key of order) {
    const entry = lowerHeaders.get(key);
    if (entry) {
      ordered[entry.original] = entry.value;
      lowerHeaders.delete(key);
    }
  }

  // Adicionar headers restantes (custom, não-padrão) ao final
  for (const [, entry] of lowerHeaders) {
    ordered[entry.original] = entry.value;
  }

  return ordered;
}
```

**Integração nos engines:**

```typescript
// Em http/index.ts e tlsclient/index.ts, antes de enviar request:
import { orderHeaders } from "../../utils/header-order.js";

// Detectar browser da UA para ordenar corretamente
const browserType = entry.browser === "Firefox" ? "firefox" : "chrome";
const orderedHeaders = orderHeaders(mergedHeaders, browserType);
```

---

### 3.5 Request Chain Mimicry (Engines 1 & 2)

**Gravidade:** 🟡 MÉDIO-ALTO  
**Esforço:** ~3 dias  
**Impacto:** Reduz detecção por padrão de requisição single-shot

**Problema:**

Browsers reais fazem 30-100 requests por page load (HTML → CSS → JS → fonts → images → XHR). Engines 1 (HTTP) e 2 (TLS) fazem exatamente 1 request. Anti-bot systems como PerimeterX e DataDome rastreiam request chains — um fetch HTML solitário sem subsequentes resource requests é um sinal forte de bot.

**Arquivos a criar:**

- `src/utils/request-chain.ts` — Simula sub-requests de resources

**Arquivos a modificar:**

- `src/engines/http/index.ts` — Opcionalmente executar chain mimicry
- `src/engines/tlsclient/index.ts` — Opcionalmente executar chain mimicry
- `src/types.ts` — Adicionar `mimicRequestChain?: boolean` (default: false)

**Implementação proposta:**

```typescript
// src/utils/request-chain.ts

interface ChainConfig {
  /** Número de sub-resources a buscar (2-5 recomendado) */
  maxResources?: number;
  /** Delay entre requests (simula parsing time) */
  delayMs?: { min: number; max: number };
  /** Resource types a buscar */
  resourceTypes?: ("css" | "js" | "image" | "font")[];
}

/**
 * Extrai URLs de resources do HTML e faz fetch de alguns para simular
 * browser real. NÃO processa o conteúdo — apenas gera tráfego.
 */
export async function mimicBrowserChain(
  html: string,
  baseUrl: string,
  fetchFn: typeof fetch,
  config: ChainConfig = {}
): Promise<void> {
  const { maxResources = 3, delayMs = { min: 50, max: 200 } } = config;

  // Extrair CSS links e JS scripts do HTML (primeiros N)
  const resourceUrls: string[] = [];

  // CSS: <link rel="stylesheet" href="...">
  const cssRegex = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi;
  let match;
  while ((match = cssRegex.exec(html)) && resourceUrls.length < maxResources) {
    resourceUrls.push(new URL(match[1], baseUrl).href);
  }

  // JS: <script src="...">
  const jsRegex = /<script[^>]+src=["']([^"']+)["']/gi;
  while ((match = jsRegex.exec(html)) && resourceUrls.length < maxResources) {
    resourceUrls.push(new URL(match[1], baseUrl).href);
  }

  // Fetch sequencialmente com delays (browser não faz tudo em paralelo)
  for (const url of resourceUrls.slice(0, maxResources)) {
    const delay = delayMs.min + Math.random() * (delayMs.max - delayMs.min);
    await new Promise((r) => setTimeout(r, delay));
    try {
      await fetchFn(url, {
        method: "GET",
        headers: { Accept: "*/*", Referer: baseUrl },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Silenciosamente ignorar — objetivo é apenas gerar tráfego
    }
  }
}
```

**Nota:** Desabilitado por default (`mimicRequestChain: false`) porque aumenta latência em ~200-500ms e usa ~3x bandwidth. Recomendado ativar apenas para sites que detectam single-shot requests.

---

### 3.6 Browser Profile Persistence

**Gravidade:** 🟡 MÉDIO  
**Esforço:** ~2 dias  
**Impacto:** Faz o scraper parecer um usuário que retorna ao site

**Problema:**

O browser pool do Hero recicla browsers a cada 100 páginas/30 minutos, começando sempre do zero — sem cookies, localStorage, histórico. Sites rastreiam usuários via storage persistente. Um browser prístino sem nenhum cookie é um sinal de bot/primeiro-acesso que pode triggrar verificação.

**Arquivos a criar:**

- `src/browser/profile-manager.ts` — Gerenciamento de perfis persistentes

**Arquivos a modificar:**

- `src/browser/pool.ts` — Integrar profile loading/saving
- `src/browser/hero-config.ts` — Configurar userDataDir por perfil
- `src/types.ts` — Adicionar `browserProfile?: string | boolean` (nome do perfil ou auto)

**Implementação proposta:**

```typescript
// src/browser/profile-manager.ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

interface PersistentBrowserProfile {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  domain?: string; // se domain-specific
  cookies: CookieData[];
  localStorage: Record<string, string>;
  sessionCount: number;
}

export class ProfileManager {
  private profileDir: string;

  constructor(baseDir?: string) {
    this.profileDir =
      baseDir ||
      join(
        process.env.HOME || process.env.USERPROFILE || ".",
        ".config",
        "ultra-reader",
        "profiles"
      );
  }

  /** Carregar ou criar perfil para domínio */
  async getProfile(domain: string): Promise<PersistentBrowserProfile> {
    const profilePath = join(this.profileDir, `${domain}.json`);
    try {
      const data = await readFile(profilePath, "utf-8");
      const profile = JSON.parse(data) as PersistentBrowserProfile;
      profile.lastUsedAt = new Date().toISOString();
      profile.sessionCount++;
      return profile;
    } catch {
      return this.createFreshProfile(domain);
    }
  }

  /** Salvar perfil após sessão */
  async saveProfile(profile: PersistentBrowserProfile): Promise<void> {
    await mkdir(this.profileDir, { recursive: true });
    const profilePath = join(this.profileDir, `${profile.domain || profile.id}.json`);
    await writeFile(profilePath, JSON.stringify(profile, null, 2));
  }

  /** Criar perfil com "história" plausível */
  private createFreshProfile(domain: string): PersistentBrowserProfile {
    return {
      id: `profile-${Date.now()}`,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      domain,
      cookies: this.generatePlausibleCookies(domain),
      localStorage: {},
      sessionCount: 1,
    };
  }

  /** Gerar cookies mínimos que um user real teria (consent, analytics opt-out) */
  private generatePlausibleCookies(domain: string): CookieData[] {
    return [
      { name: "consent", value: "1", domain, path: "/" },
      // Alguns sites esperam um cookie de consentimento GDPR
    ];
  }
}
```

**Nota:** Perfis são domain-specific e salvos em `~/.config/ultra-reader/profiles/`. Um perfil "envelhece" naturalmente conforme é reutilizado (sessionCount aumenta, cookies acumulam). Para máximo realismo, combinar com fingerprint rotation (Phase 2.5) — perfil X sempre usa o mesmo fingerprint.

---

## Phase 4 — Enterprise WAFs

> Implementação específica para cada WAF enterprise.

### 4.1 Akamai Bot Manager Bypass

**Esforço:** ~3 dias  
**Complexidade:** Alta — Akamai usa sensor data collection

**Estratégia:**

1. Detectar Akamai via cookies `_abck`, `bm_sz` e header `Akamai-GRN`
2. Usar Hero engine (obrigatório — precisa de JS execution)
3. Aguardar sensor script carregar e executar
4. BehaviorSimulator para gerar dados de sensor legítimos
5. Retry após challenge resolution

**Limitações conhecidas:**

- Akamai sensor v2 coleta ~150+ data points
- Requer execução real de JavaScript, não pode ser simulado
- Hero/Chromium deve ser suficiente para maioria dos cases
- Sites com Akamai "strict mode" podem precisar de proxies residenciais premium

---

### 4.2 PerimeterX/HUMAN Bypass

**Esforço:** ~2 dias  
**Complexidade:** Média-Alta

**Estratégia:**

1. Detectar via cookies `_px3`, `_pxvid`
2. Usar Hero engine com behavioral simulation ativada
3. Interceptar e aguardar challenge JS
4. Se CAPTCHA for exibido → usar CAPTCHA solver integrado (Phase 2.1)

---

### 4.3 DataDome Bypass

**Esforço:** ~2 dias  
**Complexidade:** Média

**Estratégia:**

1. Detectar via cookie `datadome` e script `js.datadome.co`
2. Usar TLS Client ou Hero engine (DataDome foca em TLS fingerprint)
3. Residential proxy obrigatório para sites com DataDome strict
4. Se challenge → aguardar resolução via Hero

---

### 4.4 Kasada Bypass

**Esforço:** ~3 dias  
**Complexidade:** Muito Alta — Usa Proof-of-Work

**Estratégia:**

1. Detectar via PoW endpoint patterns
2. Usar Hero engine (obrigatório)
3. Aguardar PoW computation pelo Chromium real
4. Timeout estendido (PoW pode levar 5-10s)

**Limitação:** Kasada PoW é computacionalmente custoso. Cada request exige PoW.

---

## Phase 5 — Content Integrity

> Defesa contra manipulação de conteúdo servido a bots.

### 5.1 Agent Poisoning / Text Cloaking Detection

**Gravidade:** 🔴 CRÍTICO  
**Esforço:** ~2-3 dias  
**Impacto:** Detecta quando o site serve conteúdo diferente/envenenado para bots

**Arquivos a criar:**

- `src/utils/poison-detector.ts` — Detecção de agent poisoning

**Arquivos a modificar:**

- `src/scraper.ts` — Integrar verificação após extração
- `src/types.ts` — Adicionar `detectPoisoning?: boolean`
- `src/errors.ts` — Adicionar `ContentPoisoningError`

**Estratégias de detecção:**

```typescript
// src/utils/poison-detector.ts

interface PoisonDetectionResult {
  isPoisoned: boolean;
  confidence: number;
  signals: PoisonSignal[];
}

type PoisonSignal =
  | "hidden_text_detected" // texto com display:none, visibility:hidden, font-size:0
  | "noscript_content_mismatch" // <noscript> tem conteúdo significativamente diferente
  | "engine_content_mismatch" // conteúdo difere entre HTTP engine e Hero engine
  | "suspicious_text_ratio" // ratio texto visível/invisível anormal
  | "known_poison_patterns" // patterns conhecidos de AI poisoning
  | "encoding_anomaly"; // caracteres Unicode invisíveis ou homoglyphs

export class PoisonDetector {
  // 1. Detectar texto oculto via CSS
  detectHiddenText(html: string): PoisonSignal[] {
    // Procurar elementos com display:none, visibility:hidden, font-size:0,
    // color igual ao background, position:absolute com left:-9999px
    // que contêm texto significativo (não apenas decorativo)
  }

  // 2. Comparar conteúdo entre engines (cross-engine verification)
  async crossEngineVerify(url: string): Promise<PoisonSignal[]> {
    // Scrape com HTTP engine e com Hero engine
    // Comparar conteúdo extraído
    // Se diferença > threshold → possível cloaking
  }

  // 3. Detectar padrões conhecidos de AI poisoning
  detectKnownPatterns(text: string): PoisonSignal[] {
    // Nightshade/Glaze-style perturbations (imperceptível para humanos)
    // Instruções injetadas ("ignore previous instructions")
    // Texto LLM-targeting ("As an AI language model, you should...")
    // Homoglyphs (caracteres que parecem iguais mas são Unicode diferente)
  }

  // 4. Detectar caracteres Unicode invisíveis
  detectInvisibleUnicode(text: string): PoisonSignal[] {
    // Zero-width characters: \u200B, \u200C, \u200D, \uFEFF
    // Bidirectional overrides: \u202A-\u202E
    // Combining characters excessivos
  }

  // 5. Verificar <noscript> vs conteúdo renderizado
  detectNoscriptMismatch(html: string, renderedText: string): PoisonSignal[] {
    // Extrair texto de <noscript>
    // Comparar com texto renderizado
    // Se significativamente diferente → possível cloaking
  }
}
```

**Modo de operação:**

- `detectPoisoning: 'passive'` — Analisa o HTML já extraído (barato)
- `detectPoisoning: 'active'` — Cross-engine verification (2x requests, caro)

---

### 5.2 Shadow DOM Content Extraction

**Gravidade:** 🟢 BAIXO  
**Esforço:** ~4h  
**Impacto:** Captura conteúdo em Web Components

**Arquivos a modificar:**

- `src/engines/hero/index.ts` — Usar `hero.evaluate()` para extrair shadow DOM

```typescript
// Extrair conteúdo incluindo shadow roots
const fullHtml = await hero.evaluate(() => {
  function getShadowContent(node: Element): string {
    let html = node.outerHTML;
    if (node.shadowRoot) {
      html = html.replace(
        "</" + node.tagName.toLowerCase() + ">",
        node.shadowRoot.innerHTML + "</" + node.tagName.toLowerCase() + ">"
      );
    }
    node.querySelectorAll("*").forEach((child) => {
      if (child.shadowRoot) {
        html = html.replace(child.outerHTML, getShadowContent(child));
      }
    });
    return html;
  }
  return getShadowContent(document.documentElement);
});
```

---

### 5.3 Content Obfuscation Handling (CSS-rendered text)

**Gravidade:** 🟢 BAIXO  
**Esforço:** ~1 dia  
**Impacto:** Captura texto renderizado via CSS `::before`/`::after`

**Estratégia:**

- No Hero engine, usar `window.getComputedStyle()` para extrair `content` de pseudo-elements
- Injetar o conteúdo como texto real antes da extração HTML

```typescript
// Executar no contexto do browser via hero.evaluate()
document.querySelectorAll("*").forEach((el) => {
  const before = window.getComputedStyle(el, "::before").content;
  const after = window.getComputedStyle(el, "::after").content;
  if (before && before !== "none" && before !== '""') {
    el.prepend(document.createTextNode(before.replace(/^"|"$/g, "")));
  }
  if (after && after !== "none" && after !== '""') {
    el.append(document.createTextNode(after.replace(/^"|"$/g, "")));
  }
});
```

---

### 5.4 Soft-Block Detection & Content Validation

**Gravidade:** 🔴 ALTO  
**Esforço:** ~2 dias  
**Impacto:** Detecta respostas HTTP 200 que não contêm conteúdo real (soft-blocks, CAPTCHAs inline, conteúdo truncado)

**Problema:**

Muitos sites retornam HTTP 200 mas servem conteúdo falso:

- Páginas "please verify you're human" sem status 403
- CAPTCHAs embutidos em layout normal
- Conteúdo truncado ou placeholder ("Loading...")
- Redirecionamento via JavaScript para challenge page
- Conteúdo repetido idêntico para todas as URLs (block template)

Atualmente, se uma engine retorna 200 OK, aceitamos o conteúdo sem validação. Isso permite que soft-blocks passem despercebidos e contaminem o output.

**Arquivos a criar:**

- `src/utils/content-validator.ts` — Validação de conteúdo pós-scrape

**Arquivos a modificar:**

- `src/engines/orchestrator.ts` — Validar resultado antes de aceitar, retry se soft-block detectado
- `src/engines/errors.ts` — Adicionar `SoftBlockError` com `detectionMethod`

**Implementação proposta:**

```typescript
// src/utils/content-validator.ts

export interface ContentValidation {
  isValid: boolean;
  confidence: number; // 0-100
  issues: ContentIssue[];
}

export interface ContentIssue {
  type:
    | "soft_block"
    | "captcha_inline"
    | "truncated"
    | "placeholder"
    | "js_redirect"
    | "template_block";
  description: string;
  evidence: string;
}

/** Padrões conhecidos de soft-block (HTTP 200 com conteúdo falso) */
const SOFT_BLOCK_PATTERNS = [
  /please\s+verify\s+you['']?re?\s+(?:a\s+)?human/i,
  /complete\s+the\s+(?:security\s+)?check\s+to\s+access/i,
  /enable\s+javascript\s+and\s+cookies\s+to\s+continue/i,
  /we\s+need\s+to\s+verify\s+that\s+you['']?re?\s+not\s+a\s+robot/i,
  /access\s+to\s+this\s+page\s+has\s+been\s+denied/i,
  /automated\s+access\s+to\s+this\s+page\s+(?:was|is)\s+denied/i,
  /one\s+more\s+step/i, // CF classic
  /checking\s+your\s+browser/i,
  /attention\s+required/i, // CF
  /pardon\s+our\s+interruption/i, // Akamai
];

/** Padrões de CAPTCHA inline */
const INLINE_CAPTCHA_PATTERNS = [
  /class="(?:g-recaptcha|h-captcha|cf-turnstile)"/i,
  /data-sitekey="[a-zA-Z0-9_-]+"/i,
  /hcaptcha\.com\/captcha/i,
  /recaptcha\/api/i,
  /challenges\.cloudflare\.com\/turnstile/i,
];

/** Padrões de conteúdo placeholder/loading */
const PLACEHOLDER_PATTERNS = [
  /^\s*loading\.{0,3}\s*$/im,
  /^\s*please\s+wait\.{0,3}\s*$/im,
  /noscript.*?enable\s+javascript/is,
];

/** JS redirect patterns (meta refresh, window.location) */
const JS_REDIRECT_PATTERNS = [
  /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["']\d+;\s*url=/i,
  /window\.location\s*=\s*["'][^"']+["']/,
  /document\.location\.href\s*=\s*/,
  /location\.replace\s*\(/,
];

export function validateContent(html: string, url: string): ContentValidation {
  const issues: ContentIssue[] = [];

  // 1. Verificar soft-block patterns
  for (const pattern of SOFT_BLOCK_PATTERNS) {
    const match = html.match(pattern);
    if (match) {
      issues.push({
        type: "soft_block",
        description: "Known soft-block pattern detected in HTTP 200 response",
        evidence: match[0].slice(0, 100),
      });
    }
  }

  // 2. Verificar CAPTCHA inline
  for (const pattern of INLINE_CAPTCHA_PATTERNS) {
    const match = html.match(pattern);
    if (match) {
      issues.push({
        type: "captcha_inline",
        description: "CAPTCHA widget embedded in page content",
        evidence: match[0].slice(0, 100),
      });
    }
  }

  // 3. Verificar conteúdo truncado
  const textContent = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (textContent.length < 200 && html.length > 500) {
    issues.push({
      type: "truncated",
      description: `Very low text-to-HTML ratio: ${textContent.length} chars text in ${html.length} chars HTML`,
      evidence: textContent.slice(0, 100),
    });
  }

  // 4. Verificar placeholder/loading
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(textContent) && textContent.length < 500) {
      issues.push({
        type: "placeholder",
        description: "Page appears to be a loading/placeholder page",
        evidence: textContent.slice(0, 100),
      });
    }
  }

  // 5. Verificar JS redirect
  for (const pattern of JS_REDIRECT_PATTERNS) {
    const match = html.match(pattern);
    if (match) {
      issues.push({
        type: "js_redirect",
        description: "JavaScript/meta redirect detected — may indicate challenge redirect",
        evidence: match[0].slice(0, 100),
      });
    }
  }

  // Calcular confidence
  const hasCritical = issues.some((i) => i.type === "soft_block" || i.type === "captcha_inline");
  const confidence = hasCritical ? 95 : issues.length > 0 ? 60 + issues.length * 10 : 0;

  return {
    isValid: issues.length === 0,
    confidence: Math.min(confidence, 100),
    issues,
  };
}

/**
 * Cross-engine verification: comparar conteúdo de múltiplas engines.
 * Se Engine 1 e Engine 3 retornam conteúdo muito diferente, uma delas
 * provavelmente recebeu um soft-block.
 */
export function crossEngineVerify(results: Map<string, string>): {
  consistent: boolean;
  divergentEngines: string[];
} {
  const entries = [...results.entries()];
  if (entries.length < 2) return { consistent: true, divergentEngines: [] };

  const divergent: string[] = [];
  const [baseEngine, baseHtml] = entries[0];
  const baseText = baseHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (let i = 1; i < entries.length; i++) {
    const [engine, html] = entries[i];
    const text = html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Similaridade grosseira via comprimento + overlap
    const lengthRatio =
      Math.min(baseText.length, text.length) / Math.max(baseText.length, text.length);
    if (lengthRatio < 0.3) {
      divergent.push(engine);
    }
  }

  return { consistent: divergent.length === 0, divergentEngines: divergent };
}
```

**Integração no Orchestrator:**

```typescript
// Em orchestrator.ts, após receber resultado de uma engine:
import { validateContent } from "../utils/content-validator.js";

const validation = validateContent(result.html, meta.url);
if (!validation.isValid && validation.confidence >= 80) {
  errors.set(
    engineName,
    new SoftBlockError(
      `Soft-block detected by ${engineName}: ${validation.issues.map((i) => i.type).join(", ")}`,
      { engineName, issues: validation.issues, confidence: validation.confidence }
    )
  );
  continue; // tentar próxima engine
}
```

**Modo cross-engine (opcional, habilitado via `options.crossEngineVerify: true`):**
Quando ativado, o orchestrator scrape com 2 engines e compara resultados. Se divergirem, confia na engine com maior conteúdo textual (provavelmente a que recebeu conteúdo real).

---

## Phase 6 — Hardening

> Melhorias de robustez e compliance.

### 6.1 Meta Robots / X-Robots-Tag Handling

**Esforço:** ~2h  
**Gravidade:** 🟢 BAIXO

**Arquivos a modificar:**

- `src/utils/robots-parser.ts` — Adicionar parsing de `<meta name="robots">` e header `X-Robots-Tag`
- `src/scraper.ts` — Condicionar à flag `respectRobots`

```typescript
export function checkMetaRobots(html: string): { noindex: boolean; nofollow: boolean } {
  const match = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
  if (!match) return { noindex: false, nofollow: false };
  const content = match[1].toLowerCase();
  return {
    noindex: content.includes("noindex"),
    nofollow: content.includes("nofollow"),
  };
}

export function checkXRobotsTag(headers: Headers): { noindex: boolean; nofollow: boolean } {
  const tag = headers.get("x-robots-tag")?.toLowerCase() || "";
  return {
    noindex: tag.includes("noindex"),
    nofollow: tag.includes("nofollow"),
  };
}
```

---

### 6.2 GraphQL/REST Anti-Scrape Awareness

**Esforço:** ~4h  
**Gravidade:** 🟢 BAIXO

**Arquivos a modificar:**

- `src/utils/rate-limiter.ts` — Rate limiting por endpoint, não só por domain
- `src/errors.ts` — Adicionar `RateLimitedError` com `retryAfter` header parsing

```typescript
// Detectar rate limit headers
function parseRateLimitHeaders(headers: Headers): RateLimitInfo | null {
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  const retryAfter = headers.get("retry-after");

  if (remaining !== null && parseInt(remaining) === 0) {
    return {
      limited: true,
      retryAfterMs: retryAfter
        ? parseInt(retryAfter) * 1000
        : reset
          ? parseInt(reset) * 1000 - Date.now()
          : 60000,
    };
  }
  return null;
}
```

---

### 6.3 DNS Strategies

**Gravidade:** 🟢 BAIXO-MÉDIO  
**Esforço:** ~1 dia  
**Impacto:** Reduz latência, evita DNS-based blocking, aumenta resiliência

**Problema:**

Engines 1 (HTTP) e 2 (TLS) usam o resolver DNS padrão do sistema. Sem caching, sem fallback, sem DNS-over-HTTPS. Alguns CDNs fazem blocking a nível de DNS. Hero (Engine 3) já tem DNS over TLS configurado em hero-config.ts, mas as outras engines ficam vulneráveis.

**Arquivos a criar:**

- `src/utils/dns-resolver.ts` — DNS caching + multi-resolver + DoH

**Arquivos a modificar:**

- `src/engines/http/index.ts` — Opcionalmente usar custom resolver
- `src/engines/tlsclient/index.ts` — Opcionalmente usar custom resolver
- `src/types.ts` — Adicionar `dnsStrategy?: DnsStrategy`

**Implementação proposta:**

```typescript
// src/utils/dns-resolver.ts
import { Resolver } from "node:dns/promises";

interface DnsStrategy {
  /** Resolvers DoH/DoT a usar (default: cloudflare + google) */
  resolvers?: string[];
  /** TTL do cache em ms (default: 300000 = 5min) */
  cacheTtlMs?: number;
  /** Tentar próximo resolver se primeiro falhar */
  fallback?: boolean;
}

const DEFAULT_RESOLVERS = [
  "1.1.1.1", // Cloudflare
  "8.8.8.8", // Google
  "9.9.9.9", // Quad9
];

export class DnsCache {
  private cache = new Map<string, { addresses: string[]; expiresAt: number }>();
  private resolvers: Resolver[];
  private ttlMs: number;

  constructor(config: DnsStrategy = {}) {
    this.ttlMs = config.cacheTtlMs ?? 300_000;
    const servers = config.resolvers ?? DEFAULT_RESOLVERS;
    this.resolvers = servers.map((s) => {
      const r = new Resolver();
      r.setServers([s]);
      return r;
    });
  }

  async resolve(hostname: string): Promise<string> {
    const cached = this.cache.get(hostname);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.addresses[Math.floor(Math.random() * cached.addresses.length)];
    }

    for (const resolver of this.resolvers) {
      try {
        const addresses = await resolver.resolve4(hostname);
        this.cache.set(hostname, { addresses, expiresAt: Date.now() + this.ttlMs });
        return addresses[0];
      } catch {
        continue; // fallback para próximo resolver
      }
    }

    throw new Error(`DNS resolution failed for ${hostname} across all resolvers`);
  }

  clear(): void {
    this.cache.clear();
  }
}
```

---

### 6.4 TLS Fingerprint Rotation (JA3/JA4)

**Gravidade:** 🟡 MÉDIO  
**Esforço:** ~1 dia  
**Impacto:** Evita fingerprinting persistente por TLS handshake

**Problema:**

`got-scraping` (Engine 2) faz emulação de TLS, mas sempre usa o mesmo fingerprint por sessão. Sites com fingerprinting avançado (Akamai, Cloudflare) podem correlacionar requests pelo JA3/JA4 hash. Rotacionar fingerprints por domínio ou por sessão dificulta esta correlação.

**Nota:** Esta seção complementa a Phase 3.3 (HTTP/2 Fingerprint Control) que já propõe `undici` para controle de HTTP/2 frames. A rotação JA3/JA4 opera na camada TLS, abaixo do HTTP/2.

**Arquivos a modificar:**

- `src/engines/tlsclient/index.ts` — Rotacionar headerGeneratorOptions por request
- `src/browser/hero-config.ts` — Configurar TLS fingerprint rotation no Hero

**Implementação proposta:**

```typescript
// Em tlsclient/index.ts, rotacionar browser TLS profile:
const TLS_PROFILES = [
  { browsers: [{ name: "chrome", minVersion: 120, maxVersion: 124 }] },
  { browsers: [{ name: "firefox", minVersion: 121, maxVersion: 123 }] },
  { browsers: [{ name: "safari", minVersion: 17 }] },
  { browsers: [{ name: "edge", minVersion: 120, maxVersion: 124 }] },
] as const;

function getRandomTlsProfile() {
  return TLS_PROFILES[Math.floor(Math.random() * TLS_PROFILES.length)];
}

// Na chamada gotScraping:
const response = await gotScraping({
  url: meta.url,
  headerGeneratorOptions: getRandomTlsProfile(),
  // ...
});
```

**Domain-sticky:** Para consistência, usar o mesmo TLS profile por domínio dentro de uma sessão (mesma lógica de `getDefaultRotator()` do módulo `user-agents.ts` com domain map). Trocar apenas entre sessões.

---

## Phase 7 — JWT Extraction, OAuth Authentication e AI-Assisted Secret Discovery (NOVO)

> **Prioridade**: 🔴 Crítica para sites com autenticação
> **Esforço estimado**: 5-8 dias
> **Pré-requisitos**: Phase 1, Phase 2 (behavioral simulation)
> **Inspiração**: [opencode-anthropic-auth](https://github.com/anomalyco/opencode-anthropic-auth), [openclaw-auth-ui](https://github.com/qqliaoxin/openclaw-auth-ui)

### Problema

Muitos sites protegem conteúdo atrás de autenticação JWT. Os tokens frequentemente são:

- Gerados por OAuth flows (Google, GitHub, etc.)
- Armazenados em `localStorage`/`sessionStorage`/cookies
- Embutidos em JavaScript ofuscado e fatiado
- Necessários como `Authorization: Bearer <token>` em requests subsequentes
- Renovados via refresh tokens com expiração

O scraper atualmente não tem capacidade alguma de autenticação automática.

---

### 7.1 — JWT Token Extractor (Request/Response Interception)

**Objetivo**: Interceptar e extrair tokens JWT de qualquer fluxo de autenticação observado no browser.

**Arquivos a criar**: `src/auth/jwt-extractor.ts`

```typescript
// src/auth/jwt-extractor.ts

export interface ExtractedToken {
  token: string;
  type: "bearer" | "cookie" | "custom";
  source: "header" | "body" | "localStorage" | "sessionStorage" | "cookie" | "script";
  expiresAt?: number; // Unix timestamp
  refreshToken?: string;
  headerName: string; // e.g. 'Authorization', 'X-Auth-Token'
  domain: string;
}

export interface JwtExtractorOptions {
  /** Patterns to match in response headers/body for tokens */
  tokenPatterns?: RegExp[];
  /** Intercept requests to these URL patterns */
  interceptUrls?: string[];
  /** Also search localStorage/sessionStorage */
  searchStorage?: boolean;
  /** Also search inline <script> tags for obfuscated tokens */
  searchScripts?: boolean;
  /** Use AI agent to discover obfuscated/split secrets */
  aiDiscovery?: boolean;
}

export class JwtExtractor {
  private tokens: Map<string, ExtractedToken> = new Map();

  /**
   * Attach to a Hero instance and intercept all responses
   * looking for JWT patterns in:
   * 1. Response headers (Authorization, Set-Cookie, X-Token, etc.)
   * 2. Response body (JSON with access_token, token, jwt fields)
   * 3. Request headers (to learn which header name the site uses)
   */
  async attachToHero(hero: Hero): Promise<void>;

  /**
   * Extract tokens from browser storage after page load.
   * Scans localStorage and sessionStorage for JWT-shaped values
   * (base64url.base64url.base64url pattern).
   */
  async extractFromStorage(hero: Hero): Promise<ExtractedToken[]>;

  /**
   * Search inline <script> tags for obfuscated/split JWT secrets.
   * Uses pattern matching for common obfuscation techniques:
   * - String concatenation: var t = "eyJ" + "hbG" + "ciO"
   * - Array join: ["eyJ","hbG","ciO"].join("")
   * - Char code: String.fromCharCode(101,121,74,...)
   * - Base64 decode chains
   * - Variable reassignment chains
   */
  async extractFromScripts(html: string): Promise<ExtractedToken[]>;

  /**
   * Sign outgoing request headers with the best available token
   * for the target domain.
   */
  signHeaders(url: string, headers: Record<string, string>): Record<string, string>;

  /**
   * Check if current token is expired and refresh if possible.
   */
  async refreshIfNeeded(domain: string): Promise<boolean>;

  /**
   * Get the best token for a given domain.
   */
  getToken(domain: string): ExtractedToken | undefined;
}
```

**Padrões de detecção de JWT em scripts ofuscados**:

```typescript
// Patterns para encontrar JWT secrets em JS ofuscado
const JWT_SCRIPT_PATTERNS = [
  // Token direto
  /["']eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+["']/g,

  // Concatenação de strings
  /["']eyJ["']\s*\+\s*["'][A-Za-z0-9_-]+["']/g,

  // Array join
  /\[["']eyJ["'][\s\S]{0,500}?\]\.join\s*\(\s*["']['"]?\s*\)/g,

  // Variável com prefixo JWT
  /(?:token|jwt|auth|secret|key|bearer)\s*[:=]\s*["']eyJ[^"']+["']/gi,

  // Base64 decode chain
  /atob\s*\(\s*["'][A-Za-z0-9+/=]+["']\s*\)/g,

  // String.fromCharCode para JWT header {"alg":
  /String\.fromCharCode\s*\(\s*123\s*,\s*34\s*,\s*97\s*,\s*108\s*,\s*103/g,

  // Hex encoded
  /\\x65\\x79\\x4a/g, // "eyJ" in hex

  // Split across variables
  /(?:var|let|const)\s+\w+\s*=\s*["']eyJ[^"']*["']/g,
];
```

**Modificações em `src/engines/hero/index.ts`**:

```typescript
// Após page load, antes de extrair HTML:
if (options.auth?.extractTokens) {
  const extractor = new JwtExtractor(options.auth.extractorOptions);
  await extractor.attachToHero(hero);

  if (options.auth.extractorOptions?.searchStorage) {
    await extractor.extractFromStorage(hero);
  }

  if (options.auth.extractorOptions?.searchScripts) {
    const html = await hero.document.documentElement.outerHTML;
    await extractor.extractFromScripts(html);
  }

  // Store tokens for subsequent requests
  result.extractedTokens = extractor.getAllTokens();
}
```

---

### 7.2 — AI-Assisted Secret Discovery (Obfuscated JWT/API Keys)

**Objetivo**: Usar um LLM para analisar JavaScript ofuscado e encontrar secrets que regex não consegue.

**Arquivos a criar**: `src/auth/ai-secret-discovery.ts`

```typescript
// src/auth/ai-secret-discovery.ts

export interface AiDiscoveryOptions {
  /** LLM provider to use */
  provider: "anthropic" | "openai" | "gemini";
  /** API key for the LLM provider */
  apiKey: string;
  /** Model to use (default: provider's cheapest capable model) */
  model?: string;
  /** Max tokens for analysis (default: 4096) */
  maxTokens?: number;
  /** What to look for */
  targets: ("jwt" | "api_key" | "oauth_secret" | "signing_key" | "encryption_key")[];
}

export interface DiscoveredSecret {
  value: string;
  type: "jwt" | "api_key" | "oauth_secret" | "signing_key" | "encryption_key";
  confidence: number; // 0-1
  location: string; // description of where found
  reconstruction?: string; // how pieces were assembled
}

// DUP-02 FIX: AiSecretDiscovery agora usa LlmClient (Phase 8.11) como abstração
// de LLM em vez de fazer chamadas diretas. Isso elimina duplicação de lógica
// de chamada a providers e permite reutilizar cache/retry do LlmClient.
import { LlmClient } from "../reverse/llm-client.js";

export class AiSecretDiscovery {
  private llmClient: LlmClient;

  constructor(private options: AiDiscoveryOptions) {
    this.llmClient = new LlmClient({
      provider: options.provider ?? "anthropic",
      apiKey: options.apiKey,
      model: options.model,
      timeoutMs: 30_000,
      maxTokens: 4096,
      enableCache: true,
    });
  }

  /**
   * Feed JS source code to LLM and ask it to find obfuscated secrets.
   *
   * Strategy:
   * 1. Pre-filter: extract <script> tags and inline JS
   * 2. Chunk: split into ~3000 token chunks with overlap
   * 3. First pass: ask LLM to identify candidate locations
   * 4. Second pass: feed candidates with surrounding context for reconstruction
   * 5. Validate: check if discovered values are valid JWT/keys
   */
  async analyzeScripts(scripts: string[]): Promise<DiscoveredSecret[]>;

  /**
   * Analyze a single script for split/obfuscated tokens.
   * Uses chain-of-thought prompting:
   *
   * SYSTEM: "You are a security researcher analyzing JavaScript for
   *  obfuscated authentication tokens. Look for:
   *  - JWT tokens split across variables or concatenated
   *  - API keys assigned through indirect references
   *  - Signing secrets built from char codes or hex
   *  - Base64-encoded credentials decoded at runtime
   *  - Environment variables or config objects with auth data
   *  Return ONLY the reconstructed secret values."
   */
  private async analyzeChunk(chunk: string): Promise<DiscoveredSecret[]>;

  /**
   * Validate discovered secrets:
   * - JWT: decode header+payload, check structure
   * - API key: check known prefixes (sk-, pk_, etc.)
   * - OAuth secret: check format
   */
  private validate(secret: DiscoveredSecret): boolean;
}
```

**Prompt template para LLM**:

```typescript
const AI_DISCOVERY_PROMPT = `You are analyzing obfuscated JavaScript source code 
to find hidden authentication secrets. The code may use techniques like:

1. String splitting: var a="eyJ"; var b="hbG"; var token=a+b+c;
2. Array construction: var parts=["ey","Jh"]; var t=parts.join("");
3. Char code assembly: String.fromCharCode(101,121,74);
4. Hex encoding: "\x65\x79\x4a"
5. Base64 double-encoding: atob(atob("..."))
6. Variable indirection: var x=config[keys[0]]; var y=x[props[1]];
7. Runtime computation: var key = hash(seed + timestamp).slice(0,32);

Analyze the following code and return any secrets found as JSON:
[{"value":"the_full_reconstructed_secret","type":"jwt|api_key|oauth_secret",
"confidence":0.95,"reconstruction":"description of how pieces connect"}]

If no secrets found, return [].

CODE:
\`\`\`javascript
{CHUNK}
\`\`\``;
```

---

### 7.3 — OAuth Interactive Login (Multi-Provider)

**Objetivo**: Automatizar login OAuth para obter tokens de acesso, inspirado nos padrões do `opencode-anthropic-auth` e `openclaw-auth-ui`.

**Arquivos a criar**: `src/auth/oauth/provider.ts`, `src/auth/oauth/anthropic.ts`, `src/auth/oauth/openai.ts`, `src/auth/oauth/google.ts`, `src/auth/oauth/generic.ts`, `src/auth/oauth/types.ts`, `src/auth/oauth/index.ts`

> **Nota**: Tokens OAuth são persistidos no `UserConfig` (via `src/config/user-config.ts`), não em um token-store separado.

#### 7.3.1 — Interface Base do Provider

```typescript
// src/auth/oauth/types.ts

export interface OAuthProviderConfig {
  name: string;
  clientId: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUri: string;
  /** Use PKCE (S256 challenge) — required by most modern providers */
  usePkce: boolean;
  /** Additional query params for authorize URL */
  extraParams?: Record<string, string>;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix timestamp
  tokenType: string; // 'Bearer'
  scope?: string;
  idToken?: string; // OpenID Connect
  raw?: Record<string, any>; // Full response
}

export interface OAuthLoginOptions {
  /** How to handle the user login step */
  mode: "browser-open" | "callback-server" | "hero-automated" | "manual-url";
  /** Port for local callback server (default: random available port) */
  callbackPort?: number;
  /** Timeout waiting for user to complete login (default: 120s) */
  loginTimeoutMs?: number;
  /** Pre-filled credentials for automated login (Hero engine) */
  credentials?: { email?: string; password?: string };
  /** 2FA/MFA handler */
  mfaHandler?: () => Promise<string>;
}

export interface OAuthProvider {
  readonly name: string;
  readonly config: OAuthProviderConfig;

  /** Generate authorization URL with PKCE */
  getAuthorizationUrl(): Promise<{ url: string; state: string; codeVerifier?: string }>;

  /** Exchange authorization code for tokens */
  exchangeCode(code: string, codeVerifier?: string): Promise<OAuthTokens>;

  /** Refresh an expired access token */
  refreshTokens(refreshToken: string): Promise<OAuthTokens>;

  /** Revoke tokens on cleanup */
  revokeTokens?(tokens: OAuthTokens): Promise<void>;

  /** Create API key from OAuth session (provider-specific) */
  createApiKey?(tokens: OAuthTokens): Promise<string>;
}
```

#### 7.3.2 — Anthropic OAuth Provider

> Baseado em `opencode-anthropic-auth/index.mjs`

```typescript
// src/auth/oauth/anthropic.ts

import type { OAuthProvider, OAuthProviderConfig, OAuthTokens } from "./types.js";

const ANTHROPIC_CONFIG: OAuthProviderConfig = {
  name: "anthropic",
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  authorizationUrl: "https://console.anthropic.com/oauth/authorize",
  tokenUrl: "https://console.anthropic.com/v1/oauth/token",
  scopes: ["org:create_api_key", "user:profile", "user:inference"],
  redirectUri: "https://console.anthropic.com/oauth/code/callback",
  usePkce: true,
  extraParams: {
    response_type: "code",
    utm_source: "reader_cli",
  },
};

export class AnthropicOAuthProvider implements OAuthProvider {
  readonly name = "anthropic";
  readonly config: OAuthProviderConfig;

  /** Supports two authorization modes:
   *  - 'max': via claude.ai (Claude Pro/Max subscription)
   *  - 'console': via console.anthropic.com (API access)
   */
  constructor(private mode: "max" | "console" = "console") {
    // Spread into a mutable copy to avoid mutating the shared ANTHROPIC_CONFIG constant
    this.config = { ...ANTHROPIC_CONFIG };
    if (mode === "max") {
      this.config.authorizationUrl = "https://claude.ai/oauth/authorize";
    }
  }

  async getAuthorizationUrl() {
    const state = crypto.randomUUID();
    const codeVerifier = generateCodeVerifier(); // 128-char random
    const codeChallenge = await sha256base64url(codeVerifier);

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: this.config.scopes.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      ...this.config.extraParams,
    });

    return {
      url: `${this.config.authorizationUrl}?${params}`,
      state,
      codeVerifier,
    };
  }

  async exchangeCode(code: string, codeVerifier?: string): Promise<OAuthTokens> {
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: this.config.clientId,
        code,
        redirect_uri: this.config.redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      tokenType: "Bearer",
      raw: data,
    };
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      tokenType: "Bearer",
      raw: data,
    };
  }

  /** Create an API key via OAuth session (Anthropic-specific) */
  async createApiKey(tokens: OAuthTokens): Promise<string> {
    const response = await fetch("https://api.anthropic.com/api/oauth/claude_cli/create_api_key", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: `reader-${Date.now()}` }),
    });

    const data = await response.json();
    return data.raw_key;
  }
}
```

#### 7.3.3 — OpenAI OAuth Provider

```typescript
// src/auth/oauth/openai.ts

const OPENAI_CONFIG: OAuthProviderConfig = {
  name: "openai",
  clientId: "", // Requires registration at platform.openai.com
  authorizationUrl: "https://auth.openai.com/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  scopes: ["openid", "profile", "email"],
  redirectUri: "http://localhost:{port}/callback",
  usePkce: true,
};

export class OpenAIProvider implements OAuthProvider {
  readonly name = "openai";
  readonly config: OAuthProviderConfig;

  constructor() {
    this.config = { ...OPENAI_CONFIG };
  }

  async getAuthorizationUrl() {
    const state = crypto.randomUUID();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await sha256base64url(codeVerifier);

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: this.config.scopes.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    return { url: `${this.config.authorizationUrl}?${params}`, state, codeVerifier };
  }

  async exchangeCode(code: string, codeVerifier?: string): Promise<OAuthTokens> {
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.config.clientId,
        code,
        redirect_uri: this.config.redirectUri,
        ...(codeVerifier && { code_verifier: codeVerifier }),
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI token exchange failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      tokenType: "Bearer",
      raw: data,
    };
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.config.clientId,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI token refresh failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      tokenType: "Bearer",
      raw: data,
    };
  }

  // Note: OpenAI does not currently expose a public API key creation endpoint via OAuth.
  // Users should provide an API key directly via `ultra-reader auth set-token openai <key>`.
}
```

#### 7.3.4 — Google Gemini OAuth Provider

```typescript
// src/auth/oauth/google.ts

const GOOGLE_CONFIG: OAuthProviderConfig = {
  name: "google-gemini",
  clientId: "", // Requires GCP OAuth client
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [
    "https://www.googleapis.com/auth/generative-language",
    "https://www.googleapis.com/auth/cloud-platform",
  ],
  redirectUri: "http://localhost:{port}/callback",
  usePkce: true,
  extraParams: {
    access_type: "offline", // Get refresh token
    prompt: "consent",
  },
};

export class GoogleGeminiProvider implements OAuthProvider {
  readonly name = "google-gemini";
  readonly config: OAuthProviderConfig;

  constructor() {
    this.config = { ...GOOGLE_CONFIG };
  }

  async getAuthorizationUrl() {
    const state = crypto.randomUUID();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await sha256base64url(codeVerifier);

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: this.config.scopes.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      ...this.config.extraParams,
    });

    return { url: `${this.config.authorizationUrl}?${params}`, state, codeVerifier };
  }

  async exchangeCode(code: string, codeVerifier?: string): Promise<OAuthTokens> {
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.config.clientId,
        code,
        redirect_uri: this.config.redirectUri,
        ...(codeVerifier && { code_verifier: codeVerifier }),
      }),
    });

    if (!response.ok) {
      throw new Error(`Google token exchange failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      tokenType: "Bearer",
      raw: data,
    };
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.config.clientId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Google token refresh failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      tokenType: "Bearer",
      raw: data,
    };
  }

  /** Create a Gemini API key via GCP Service Usage API (requires `cloud-platform` scope) */
  async createApiKey(tokens: OAuthTokens): Promise<string> {
    // Uses GCP API Keys REST API: https://cloud.google.com/docs/authentication/api-keys
    const projectId = tokens.raw?.project_id;
    if (!projectId) {
      throw new Error(
        "Google OAuth tokens missing project_id — provide API key manually via `auth set-token`"
      );
    }

    const response = await fetch(
      `https://apikeys.googleapis.com/v2/projects/${projectId}/locations/global/keys`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          displayName: `ultra-reader-${Date.now()}`,
          restrictions: {
            apiTargets: [{ service: "generativelanguage.googleapis.com" }],
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Google API key creation failed: ${response.status} ${await response.text()}`
      );
    }

    const data = await response.json();
    // API keys creation is async — poll the operation
    return data.keyString ?? data.name;
  }
}
```

#### 7.3.5 — Generic OAuth Provider (Sites Arbitrários)

```typescript
// src/auth/oauth/generic.ts

/**
 * Generic OAuth provider for scraping sites that use OAuth login.
 * Automates the login flow using Hero browser:
 *
 * 1. Navigate to login page
 * 2. Detect OAuth buttons (Google, GitHub, Facebook, etc.)
 * 3. Click OAuth button → redirected to provider
 * 4. If credentials provided, fill login form
 * 5. Handle consent screen
 * 6. Follow redirect back to site
 * 7. Extract resulting session token/cookie
 */
export class GenericOAuthProvider {
  /**
   * Automated login flow using Hero browser engine.
   * Uses the behavioral simulator from Phase 2.2 for human-like interaction.
   */
  async loginViaHero(
    loginUrl: string,
    options: {
      /** CSS selector for OAuth button (e.g., 'button.google-login') */
      oauthButtonSelector?: string;
      /** Provider credentials for automated login */
      credentials?: { email: string; password: string };
      /** Selectors for email/password fields if not auto-detected */
      emailSelector?: string;
      passwordSelector?: string;
      /** Wait for this element after successful login */
      successSelector?: string;
      /** Maximum time to wait for login completion */
      timeoutMs?: number;
    }
  ): Promise<ExtractedToken[]>;

  /**
   * Detect available OAuth providers on a login page.
   * Looks for common OAuth button patterns:
   * - "Sign in with Google/GitHub/Facebook/Apple"
   * - OAuth redirect URLs in href attributes
   * - Known OAuth widget iframes
   */
  async detectOAuthProviders(
    hero: Hero,
    loginUrl: string
  ): Promise<
    {
      provider: string;
      selector: string;
      url?: string;
    }[]
  >;
}
```

#### 7.3.6 — OAuth Login Orchestrator

> Inspirado no pattern do `openclaw-auth-ui`: local callback server + browser open.

```typescript
// src/auth/oauth/provider.ts

import http from "node:http";
import { open } from "node:child_process"; // open browser

export class OAuthLoginOrchestrator {
  /**
   * Full OAuth login flow:
   *
   * Mode 'browser-open' (interactive, like openclaw-auth-ui):
   *   1. Start local HTTP server on random port
   *   2. Generate authorization URL with PKCE
   *   3. Open URL in user's default browser
   *   4. Wait for callback with authorization code
   *   5. Exchange code for tokens
   *   6. Stop server, return tokens
   *
   * Mode 'hero-automated' (headless, like opencode-anthropic-auth):
   *   1. Open authorization URL in Hero browser
   *   2. Fill credentials if provided
   *   3. Handle consent screen
   *   4. Intercept redirect with authorization code
   *   5. Exchange code for tokens
   *
   * Mode 'manual-url' (non-interactive):
   *   1. Print authorization URL to stdout
   *   2. Wait for user to paste callback URL with code
   *   3. Exchange code for tokens
   */
  async login(provider: OAuthProvider, options: OAuthLoginOptions): Promise<OAuthTokens>;

  /**
   * Start local callback server (for browser-open mode).
   * Listens for OAuth redirect with ?code=...&state=...
   */
  private startCallbackServer(
    port: number,
    expectedState: string
  ): Promise<{ code: string; state: string }>;
}
```

#### 7.3.7 — User Config (Persistência de Auth em Arquivo do Usuário)

O login OAuth, tokens de acesso, API keys e configurações de provedores devem ser
persistidos em um **arquivo de configuração do usuário** — não apenas um token store
isolado. Isso permite que o usuário faça login uma vez e reutilize credenciais em
todas as sessões subsequentes sem re-autenticação.

**Localização do arquivo de config**:

- Linux/macOS: `~/.config/ultra-reader/config.json`
- Windows: `%APPDATA%\ultra-reader\config.json`
- Override via env: `ULTRA_READER_CONFIG_PATH`
- Override via CLI: `--config <path>`

**Estrutura do arquivo de configuração**:

```jsonc
// ~/.config/ultra-reader/config.json
{
  "$schema": "https://ultra-reader.dev/config-schema.json",
  "version": 1,

  // ══════════════════════════════════════════════
  //  PROVEDORES DE IA (OAuth + API Keys)
  // ══════════════════════════════════════════════
  "providers": {
    "anthropic": {
      "auth_method": "oauth", // "oauth" | "api_key"
      "api_key": null, // sk-ant-... (se auth_method = api_key)
      "oauth": {
        "access_token": "eyJ...",
        "refresh_token": "rt_...",
        "expires_at": 1738900000, // Unix timestamp
        "token_type": "Bearer",
        "scope": "org:create_api_key user:profile user:inference",
        "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
        "id_token": null,
      },
      "derived_api_key": "sk-ant-...", // API key criada via OAuth (createApiKey)
      "last_login": "2026-02-07T12:00:00Z",
      "auto_refresh": true,
    },
    "openai": {
      "auth_method": "api_key",
      "api_key": "sk-proj-...",
      "oauth": null,
      "last_login": null,
      "auto_refresh": false,
    },
    "google": {
      "auth_method": "oauth",
      "api_key": null,
      "oauth": {
        "access_token": "ya29...",
        "refresh_token": "1//...",
        "expires_at": 1738903600,
        "token_type": "Bearer",
        "scope": "https://www.googleapis.com/auth/generative-language",
        "client_id": "...",
        "id_token": "eyJ...",
      },
      "derived_api_key": null,
      "last_login": "2026-02-07T10:30:00Z",
      "auto_refresh": true,
    },
  },

  // ══════════════════════════════════════════════
  //  TOKENS JWT POR DOMÍNIO (extraídos automaticamente)
  // ══════════════════════════════════════════════
  "domain_tokens": {
    "example.com": {
      "token": "eyJ...",
      "type": "bearer",
      "header_name": "Authorization",
      "expires_at": 1738910000,
      "source": "extracted", // "extracted" | "manual" | "oauth"
      "extracted_from": "localStorage.auth_token",
      "last_used": "2026-02-07T14:00:00Z",
    },
    "api.protected-site.com": {
      "token": "custom-key-123",
      "type": "api_key",
      "header_name": "X-Api-Key",
      "expires_at": null, // null = não expira
      "source": "manual",
      "last_used": "2026-02-06T09:00:00Z",
    },
  },

  // ══════════════════════════════════════════════
  //  COOKIES PERSISTIDOS POR DOMÍNIO
  // ══════════════════════════════════════════════
  "cookies": {
    "example.com": [
      {
        "name": "session_id",
        "value": "abc123...",
        "domain": ".example.com",
        "path": "/",
        "expires": 1739000000,
        "httpOnly": true,
        "secure": true,
        "sameSite": "Lax",
      },
    ],
  },

  // ══════════════════════════════════════════════
  //  PROXIES CONFIGURADOS
  // ══════════════════════════════════════════════
  "proxies": [
    {
      "name": "residential-us",
      "type": "residential",
      "host": "proxy.provider.com",
      "port": 7777,
      "username": "user",
      "password": "pass",
      "country": "US",
    },
  ],

  // ══════════════════════════════════════════════
  //  CONFIGURAÇÕES DE SEGURANÇA
  // ══════════════════════════════════════════════
  "security": {
    "encrypt_tokens": true,
    "encryption_key_source": "machine_id", // "machine_id" | "env:VAR" | "keychain"
    "auto_cleanup_expired": true,
    "token_max_age_days": 90,
  },
}
```

**Arquivos a criar**: `src/config/user-config.ts`, `src/config/config-schema.ts`, `src/config/crypto.ts`, `src/config/index.ts`

````typescript
// src/config/user-config.ts

import { join } from "node:path";
import { homedir } from "node:os";
import { OAuthTokens } from "../auth/oauth/types.js";

/** Platform-aware default config path */
function getDefaultConfigPath(): string {
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "ultra-reader",
      "config.json"
    );
  }
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "ultra-reader",
    "config.json"
  );
}

export interface ProviderAuth {
  auth_method: "oauth" | "api_key";
  api_key: string | null;
  oauth: OAuthTokens | null;
  derived_api_key: string | null;
  last_login: string | null;
  auto_refresh: boolean;
}

export interface DomainToken {
  token: string;
  type: "bearer" | "api_key" | "custom";
  header_name: string;
  expires_at: number | null;
  source: "extracted" | "manual" | "oauth";
  extracted_from?: string;
  last_used: string;
}

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number | null;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export interface SecurityConfig {
  encrypt_tokens: boolean;
  encryption_key_source: "machine_id" | string; // "env:VAR_NAME" or "keychain"
  auto_cleanup_expired: boolean;
  token_max_age_days: number;
}

export interface UserConfig {
  $schema?: string;
  version: number;
  providers: Record<string, ProviderAuth>;
  domain_tokens: Record<string, DomainToken>;
  cookies: Record<string, StoredCookie[]>;
  proxies: Array<{
    name: string;
    type: "datacenter" | "residential";
    host: string;
    port: number;
    username: string;
    password: string;
    country?: string;
  }>;
  security: SecurityConfig;
}

export interface UserConfigOptions {
  /** Override config file path */
  configPath?: string;
  /** Create file if it doesn't exist (default: true) */
  createIfMissing?: boolean;
  /** Watch file for external changes (default: false) */
  watchChanges?: boolean;
}

export class UserConfigManager {
  private config: UserConfig;
  private configPath: string;
  private dirty: boolean = false;

  constructor(options?: UserConfigOptions) {
    this.configPath =
      options?.configPath ?? process.env.ULTRA_READER_CONFIG_PATH ?? getDefaultConfigPath();
  }

  // ── Lifecycle ──────────────────────────────────

  /** Load config from disk. Creates default if missing. */
  async load(): Promise<UserConfig>;

  /** Save current config to disk. Encrypts sensitive fields if enabled. */
  async save(): Promise<void>;

  /** Auto-save on process exit if dirty */
  registerShutdownHook(): void;

  // ── Provider Auth ──────────────────────────────

  /** Store OAuth tokens after successful login */
  async setProviderOAuth(provider: string, tokens: OAuthTokens): Promise<void>;

  /** Store API key for a provider */
  async setProviderApiKey(provider: string, apiKey: string): Promise<void>;

  /** Get the best available credential for a provider (OAuth token > derived key > API key) */
  async getProviderCredential(provider: string): Promise<{
    type: "bearer" | "api_key";
    value: string;
    expired: boolean;
  } | null>;

  /** Auto-refresh expired OAuth tokens using stored refresh_token */
  async refreshProviderToken(provider: string): Promise<boolean>;

  /** Remove all auth data for a provider */
  async removeProvider(provider: string): Promise<void>;

  /** List all configured providers with auth status */
  listProviders(): Array<{
    name: string;
    method: "oauth" | "api_key";
    hasValidToken: boolean;
    expiresAt: number | null;
    lastLogin: string | null;
  }>;

  // ── Domain Tokens ──────────────────────────────

  /** Store a token extracted from a specific domain */
  async setDomainToken(domain: string, token: DomainToken): Promise<void>;

  /** Get stored token for a domain, auto-check expiration */
  getDomainToken(domain: string): DomainToken | null;

  /** Remove expired domain tokens */
  async cleanupExpiredTokens(): Promise<number>;

  // ── Cookies ────────────────────────────────────

  /** Store cookies for a domain */
  async setCookies(domain: string, cookies: StoredCookie[]): Promise<void>;

  /** Get stored cookies for a domain, filter expired */
  getCookies(domain: string): StoredCookie[];

  /** Merge new cookies with existing (update or append) */
  async mergeCookies(domain: string, cookies: StoredCookie[]): Promise<void>;

  // ── Proxies ────────────────────────────────────

  /** Add or update a named proxy config */
  async setProxy(name: string, proxy: Omit<UserConfig["proxies"][0], "name">): Promise<void>;

  /** Get all configured proxies */
  getProxies(): UserConfig["proxies"];

  // ── Security ───────────────────────────────────

  /** Encrypt sensitive fields before saving */
  private encryptSensitiveFields(config: UserConfig): UserConfig;

  /** Decrypt sensitive fields after loading */
  private decryptSensitiveFields(config: UserConfig): UserConfig;

  /** Derive encryption key from machine ID or other source */
  private getEncryptionKey(): Promise<Buffer>;

  // ── CLI Helpers ────────────────────────────────

  /** Print config status summary to stdout */
  printStatus(): void;

  /** Interactive: prompt user to configure a provider */
  async interactiveSetup(provider: string): Promise<void>;
  // ── Schema Migration ──────────────────────────

  /**
   * Run all pending migrations from config.version to CURRENT_VERSION.
   * Called automatically by load() before returning the config.
   * Migrations are additive — they never remove fields, only add/rename/transform.
   */
  private async migrate(raw: Record<string, unknown>): Promise<UserConfig> {
    let version = (raw.version as number) ?? 0;

    for (const migration of MIGRATIONS) {
      if (version < migration.to) {
        raw = migration.up(raw);
        version = migration.to;
      }
    }

    raw.version = version;
    return raw as UserConfig;
  }
}

/** Current schema version. Bump when adding new fields or changing structure. */
const CURRENT_CONFIG_VERSION = 1;

/** Migration definition */
interface ConfigMigration {
  /** Target version after applying this migration */
  to: number;
  /** Human-readable description */
  description: string;
  /** Transform config from previous version to this version */
  up: (config: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Ordered list of all config migrations.
 * Each migration transforms the config from version (to - 1) to version (to).
 *
 * Rules for adding migrations:
 * 1. NEVER remove a field — mark as deprecated with @deprecated
 * 2. Add new fields with sensible defaults
 * 3. Rename fields by copying (old → new) + marking old as deprecated
 * 4. Always increase `to` by 1
 * 5. Add a test for each migration in config-migration.test.ts
 *
 * Example:
 * ```typescript
 * {
 *   to: 2,
 *   description: "Add LLM provider preferences",
 *   up: (config) => ({
 *     ...config,
 *     llm: {
 *       default_provider: "anthropic",
 *       cache_responses: true,
 *       max_tokens: 4096,
 *     },
 *   }),
 * },
 * ```
 */
const MIGRATIONS: ConfigMigration[] = [
  // v0 → v1: Initial schema (no-op, establishes baseline)
  {
    to: 1,
    description: "Establish baseline config schema",
    up: (config) => ({
      providers: {},
      domain_tokens: {},
      cookies: {},
      proxies: [],
      security: {
        encrypt_tokens: true,
        encryption_key_source: "machine_id",
        auto_cleanup_expired: true,
        token_max_age_days: 90,
      },
      ...config, // preserve any existing fields
    }),
  },
];
````

**Novo módulo de criptografia** (`src/config/crypto.ts`):

```typescript
// src/config/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv + tag + ciphertext)
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(encoded: string, key: Buffer): string {
  const data = Buffer.from(encoded, "base64");
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

export async function deriveKeyFromMachineId(): Promise<Buffer> {
  // Use hostname + username + platform + a persistent random salt as machine identifier
  const os = await import("node:os");
  const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");

  const machineId = `${os.hostname()}-${os.userInfo().username}-${process.platform}`;

  // Use a persistent random salt stored alongside the config (unique per install)
  const configDir = process.env.XDG_CONFIG_HOME ?? join(os.homedir(), ".config", "ultra-reader");
  const saltPath = join(configDir, ".machine-salt");
  let salt: string;
  try {
    salt = readFileSync(saltPath, "utf8");
  } catch {
    salt = (await import("node:crypto")).randomBytes(32).toString("hex");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(saltPath, salt, { mode: 0o600 });
  }

  return scryptSync(machineId, salt, KEY_LENGTH);
}
```

**CLI commands para gerenciar config** (adições em `src/cli/index.ts`):

```typescript
// Novos subcomandos CLI para gerenciar configuração de auth

program
  .command("auth")
  .description("Manage provider authentication")
  .addCommand(
    new Command("login")
      .argument("<provider>", "Provider name (anthropic|openai|google)")
      .option("--api-key <key>", "Set API key directly instead of OAuth")
      .option("--mode <mode>", "Login mode: browser|headless|manual", "browser")
      .description("Login to a provider via OAuth or API key")
      .action(async (provider, opts) => {
        const config = new UserConfigManager();
        await config.load();

        if (opts.apiKey) {
          await config.setProviderApiKey(provider, opts.apiKey);
          console.log(`API key saved for ${provider}`);
        } else {
          // OAuth flow
          const oauthProvider = createOAuthProvider(provider);
          const orchestrator = new OAuthLoginOrchestrator();
          const tokens = await orchestrator.login(oauthProvider, { mode: opts.mode });
          await config.setProviderOAuth(provider, tokens);
          console.log(`OAuth login successful for ${provider}`);
        }

        await config.save();
      })
  )
  .addCommand(
    new Command("logout")
      .argument("<provider>", "Provider to logout from")
      .description("Remove stored credentials for a provider")
      .action(async (provider) => {
        const config = new UserConfigManager();
        await config.load();
        await config.removeProvider(provider);
        await config.save();
        console.log(`Credentials removed for ${provider}`);
      })
  )
  .addCommand(
    new Command("status")
      .description("Show auth status for all configured providers")
      .action(async () => {
        const config = new UserConfigManager();
        await config.load();
        config.printStatus();
        // Output example:
        // Provider    | Method  | Status        | Expires
        // anthropic   | oauth   | ✓ valid       | 2026-02-08 12:00
        // openai      | api_key | ✓ configured  | never
        // google      | oauth   | ✗ expired     | 2026-02-06 10:30
      })
  )
  .addCommand(
    new Command("refresh")
      .argument("[provider]", "Provider to refresh (all if omitted)")
      .description("Refresh expired OAuth tokens")
      .action(async (provider) => {
        const config = new UserConfigManager();
        await config.load();

        const providers = provider
          ? [provider]
          : config
              .listProviders()
              .filter((p) => p.method === "oauth" && !p.hasValidToken)
              .map((p) => p.name);

        for (const p of providers) {
          const ok = await config.refreshProviderToken(p);
          console.log(`${p}: ${ok ? "refreshed" : "refresh failed, re-login needed"}`);
        }

        await config.save();
      })
  )
  .addCommand(
    new Command("set-token")
      .argument("<domain>", "Domain the token is for")
      .requiredOption("--token <value>", "Token value")
      .option("--type <type>", "Token type: bearer|api_key|custom", "bearer")
      .option("--header <name>", "Header name", "Authorization")
      .description("Manually store a token for a specific domain")
      .action(async (domain, opts) => {
        const config = new UserConfigManager();
        await config.load();
        await config.setDomainToken(domain, {
          token: opts.token,
          type: opts.type,
          header_name: opts.header,
          expires_at: null,
          source: "manual",
          last_used: new Date().toISOString(),
        });
        await config.save();
        console.log(`Token stored for ${domain}`);
      })
  )
  .addCommand(
    new Command("config-path").description("Show path to config file").action(() => {
      const config = new UserConfigManager();
      console.log(config["configPath"]);
    })
  );
```

**Integração automática no scraper** — quando o scraper inicia, carrega o config:

```typescript
// Modificação em src/scraper.ts

export class Scraper {
  private userConfig: UserConfigManager | null = null;

  constructor(options: ScrapeOptions) {
    // ... existing ...

    // Auto-load user config if auth is needed or config exists
    if (options.auth?.useConfigFile !== false) {
      this.userConfig = new UserConfigManager({
        configPath: options.auth?.configPath,
      });
    }
  }

  async scrapeUrl(url: string): Promise<ScrapeResult> {
    // Load config on first use (lazy)
    if (this.userConfig) {
      await this.userConfig.load();

      const domain = new URL(url).hostname;

      // 1. Check domain-specific tokens
      const domainToken = this.userConfig.getDomainToken(domain);
      if (domainToken && domainToken.expires_at && domainToken.expires_at > Date.now() / 1000) {
        this.options.headers = {
          ...this.options.headers,
          [domainToken.header_name]:
            domainToken.type === "bearer" ? `Bearer ${domainToken.token}` : domainToken.token,
        };
      }

      // 2. Check provider credentials (for AI provider domains)
      const providerName = this.detectProvider(domain);
      if (providerName) {
        const cred = await this.userConfig.getProviderCredential(providerName);
        if (cred?.expired) {
          await this.userConfig.refreshProviderToken(providerName);
        }
      }

      // 3. Inject stored cookies
      const cookies = this.userConfig.getCookies(domain);
      if (cookies.length) {
        const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
        this.options.headers = {
          ...this.options.headers,
          Cookie: cookieHeader,
        };
      }
    }

    // ... continue with normal scrape flow ...
  }

  /** After successful scrape, persist any extracted tokens back to config */
  private async persistExtractedTokens(url: string, result: ScrapeResult): Promise<void> {
    if (!this.userConfig || !result.extractedTokens?.length) return;

    const domain = new URL(url).hostname;
    for (const token of result.extractedTokens) {
      await this.userConfig.setDomainToken(domain, {
        token: token.value,
        type: token.type,
        header_name: token.headerName ?? "Authorization",
        expires_at: token.expiresAt ?? null,
        source: "extracted",
        extracted_from: token.source,
        last_used: new Date().toISOString(),
      });
    }
    await this.userConfig.save();
  }
}
```

---

### 7.4 — Integração com ScrapeOptions e Engine Cascade

**Modificações em `src/types.ts`**:

```typescript
// Adicionar a ScrapeOptions:
export interface ScrapeOptions {
  // ... existing fields ...

  /** Authentication configuration */
  auth?: {
    /** Extract JWT tokens from page (headers, storage, scripts) */
    extractTokens?: boolean;
    /** JWT extractor options */
    extractorOptions?: JwtExtractorOptions;
    /** Use AI to discover obfuscated secrets in page scripts */
    aiDiscovery?: AiDiscoveryOptions;
    /** OAuth login configuration */
    oauth?: {
      provider: OAuthProvider | OAuthProviderConfig;
      loginOptions: OAuthLoginOptions;
    };
    /** Pre-existing tokens to use for requests */
    tokens?: ExtractedToken[];
    /** Pre-existing cookies to inject */
    cookies?: { name: string; value: string; domain: string; path?: string }[];
    /** API key to use directly (for LLM providers) */
    apiKey?: string;
    /** Custom Authorization header value */
    authorization?: string;
    /** Use config file for auth persistence (default: true) */
    useConfigFile?: boolean;
    /** Override config file path (default: platform-specific ~/.config/ultra-reader/config.json) */
    configPath?: string;
    /** Auto-save extracted tokens to config file (default: true) */
    persistExtracted?: boolean;
  };
}
```

**Modificações em `src/engines/orchestrator.ts`**:

```typescript
// No início do cascade, antes de tentar engines:
if (options.auth?.tokens?.length) {
  // Inject tokens into request headers for all engines
  const token = jwtExtractor.getBestToken(url);
  if (token) {
    options.headers = {
      ...options.headers,
      [token.headerName]: `${token.type === "bearer" ? "Bearer " : ""}${token.value}`,
    };
  }
}

// Se oauth configurado e nenhum token disponível:
if (options.auth?.oauth && !hasValidToken) {
  const orchestrator = new OAuthLoginOrchestrator();
  const tokens = await orchestrator.login(
    options.auth.oauth.provider,
    options.auth.oauth.loginOptions
  );
  // Convert to ExtractedToken and inject into headers
}
```

**Modificações em `src/cli/index.ts`**:

```typescript
// Novas flags CLI:
.option('--auth-extract', 'Extract JWT tokens from page')
.option('--auth-ai-discover <provider>', 'Use AI to find obfuscated secrets (anthropic|openai|gemini)')
.option('--auth-oauth <provider>', 'Login via OAuth (anthropic|openai|google)')
.option('--auth-api-key <key>', 'Use API key directly')
.option('--auth-bearer <token>', 'Use Bearer token directly')
.option('--auth-cookie <name=value>', 'Inject cookie (repeatable)', collect)
.option('--config <path>', 'Path to user config file')
.option('--no-config', 'Disable config file auto-loading')

// Subcomando 'auth' com login/logout/status/refresh/set-token/config-path
// Ver seção 7.3.7 para implementação completa dos subcomandos
```

---

### 7.5 — Fluxo Completo de Autenticação

```
Scrape Request com auth config
  │
  ├─ Tem tokens pré-existentes?
  │   ├─ Sim → Verificar expiração
  │   │   ├─ Válido → Usar token
  │   │   └─ Expirado → Tentar refresh
  │   │       ├─ Refresh OK → Usar novo token
  │   │       └─ Refresh falhou → Ir para OAuth
  │   └─ Não → Verificar token store
  │       ├─ Encontrou → Verificar/refresh (loop acima)
  │       └─ Não encontrou → Ir para OAuth/extraction
  │
  ├─ OAuth configurado?
  │   ├─ Sim → OAuthLoginOrchestrator.login()
  │   │   ├─ browser-open → Abre browser, espera callback
  │   │   ├─ hero-automated → Login headless com Hero
  │   │   └─ manual-url → Mostra URL, espera input
  │   └─ Não → Continuar sem auth
  │
  ├─ Scrape com token nos headers
  │   ├─ 401/403 → Token inválido
  │   │   ├─ Tentar refresh
  │   │   └─ Tentar re-auth OAuth
  │   └─ 200 → Sucesso
  │
  ├─ Extract tokens? (pós-scrape)
  │   ├─ Interceptar headers/body
  │   ├─ Buscar em localStorage/sessionStorage
  │   ├─ Buscar em <script> tags (regex)
  │   └─ AI discovery (se habilitado)
  │
  └─ Salvar tokens no store (se habilitado)
```

---

### 7.6 — Testes Necessários

| Teste                             | Tipo        | Descrição                                                     |
| --------------------------------- | ----------- | ------------------------------------------------------------- |
| JWT regex patterns                | Unit        | Testar detecção de JWT em strings concatenadas, hex, charCode |
| Token extraction from mock HTML   | Unit        | Scripts com tokens ofuscados                                  |
| OAuth PKCE flow                   | Unit        | Code verifier/challenge generation e exchange                 |
| Anthropic OAuth endpoints         | Integration | Testar contra console.anthropic.com (sandbox se disponível)   |
| Token refresh cycle               | Unit        | Expiração → refresh → novo token                              |
| Token store encryption/decryption | Unit        | AES-256-GCM round-trip                                        |
| Request header signing            | Unit        | Token correto injetado no header correto                      |
| 401 retry with re-auth            | Integration | Simular 401 → refresh → retry                                 |
| AI discovery prompt               | Unit        | Mock LLM response parsing                                     |
| CLI auth flags                    | E2E         | --auth-bearer, --auth-oauth, --auth-extract                   |

---

## Phase 8 — LLM-Assisted Dynamic Bypass (Engenharia Reversa Automatizada)

> **Objetivo**: Usar LLMs para analisar, deobfuscar e reverter mecanismos anti-bot dinâmicos
> embutidos no JavaScript dos sites — permitindo bypass de proteções que mudam entre deploys
> ou até entre requests.

---

### 8.1 — JS Bundle Analyzer e Deobfuscator

**Arquivo**: `src/reverse/bundle-analyzer.ts` (~350 linhas)

O primeiro passo é obter e normalizar o JavaScript do site para que a LLM possa analisá-lo.

```typescript
interface BundleAnalysis {
  /** URL do bundle principal */
  sourceUrl: string;
  /** Código original (minificado/ofuscado) */
  rawSource: string;
  /** Código deobfuscado (best-effort) */
  deobfuscatedSource: string;
  /** Mapa de strings decodificadas (hex, charCode, base64) */
  decodedStrings: Map<string, string>;
  /** Funções de interesse identificadas */
  interestingFunctions: FunctionSignature[];
  /** Fetch/XHR calls encontradas */
  networkCalls: NetworkCallPattern[];
  /** Tokens/secrets candidatos */
  secretCandidates: SecretCandidate[];
}

interface FunctionSignature {
  name: string;
  params: string[];
  bodySnippet: string; // primeiros 500 chars
  classification:
    | "signing"
    | "encryption"
    | "hashing"
    | "token-generation"
    | "fingerprinting"
    | "challenge-solver"
    | "anti-debug"
    | "unknown";
  confidence: number; // 0-1
  lineRange: [number, number];
}

interface NetworkCallPattern {
  method: "GET" | "POST" | "PUT" | "DELETE";
  urlPattern: string;
  headers: Record<string, string>;
  bodyStructure?: string; // JSON schema inferido
  signingFunction?: string; // nome da função que assina o request
  precedingCalls: string[]; // URLs chamadas antes (chain detection)
}
```

**Processo de análise**:

```typescript
class BundleAnalyzer {
  constructor(private llmClient: LlmClient) {}

  async analyze(url: string, hero: Hero): Promise<BundleAnalysis> {
    // 1. Coletar todos os scripts da página
    const scripts = await this.collectScripts(hero);

    // 2. Deobfuscação estática (sem LLM — rápida)
    //    - Decode hex strings: \x68\x65\x6c\x6c\x6f → hello
    //    - Decode unicode escapes: \u0048\u0065\u006c → Hel
    //    - Inline string arrays: var _0x=[...]; → substitui referências
    //    - Simplify control flow: switch/case com ordem numérica → sequencial
    //    - Evaluate constant expressions: 0x1a4 → 420
    const deobfuscated = this.staticDeobfuscate(scripts);

    // 3. Identificar funções de interesse (heurísticas sem LLM)
    //    - Funções que usam crypto.subtle, CryptoJS, sjcl
    //    - Funções que geram headers custom (X-*, Authorization)
    //    - Funções que chamam fetch/XMLHttpRequest
    //    - Funções com Base64, HMAC, SHA patterns
    const candidates = this.identifyCandidateFunctions(deobfuscated);

    // 4. Enviar APENAS as funções candidatas à LLM (economiza tokens)
    const analysis = await this.llmAnalyze(candidates);

    return analysis;
  }

  private async collectScripts(hero: Hero): Promise<ScriptSource[]> {
    // Inline scripts
    const inlineScripts = await hero.document.querySelectorAll("script:not([src])");

    // External scripts — buscar source
    const externalScripts = await hero.document.querySelectorAll("script[src]");
    for (const script of externalScripts) {
      const src = await script.getAttribute("src");
      // Fetch source code via hero.fetch() para manter cookies/session
      const response = await hero.fetch(src);
      const code = await response.text();
      sources.push({ url: src, code, type: "external" });
    }

    // Scripts carregados dinamicamente (via MutationObserver)
    const dynamicScripts = await this.captureDynamicScripts(hero);

    return [...inlineScripts, ...externalScripts, ...dynamicScripts];
  }
}
```

**Deobfuscação estática (sem LLM)**:

```typescript
class StaticDeobfuscator {
  deobfuscate(code: string): string {
    let result = code;

    // Pass 1: Decode string literals
    result = this.decodeHexStrings(result); // \x48\x65\x6c\x6c\x6f → Hello
    result = this.decodeUnicodeEscapes(result); // \u0048 → H
    result = this.decodeCharCodes(result); // String.fromCharCode(72,101) → He
    result = this.decodeBase64Literals(result); // atob("SGVsbG8=") → Hello

    // Pass 2: Inline string array references
    //   var _0xabc = ["fetch", "then", "json"];
    //   obj[_0xabc[0]](...) → obj["fetch"](...)
    result = this.inlineStringArrays(result);

    // Pass 3: Simplify control flow flattening
    //   switch(state) { case 0: ...; state=3; break; case 3: ...; }
    //   → linear execution order
    result = this.unflattenControlFlow(result);

    // Pass 4: Evaluate constant expressions
    //   var x = 0x1a4; → var x = 420;
    //   var y = 3 + 4 * 2; → var y = 11;
    result = this.evaluateConstants(result);

    // Pass 5: Rename obvious obfuscated vars (preservar semântica)
    //   _0x3a2b → var_14891 (pelo menos legível)
    result = this.normalizeVarNames(result);

    return result;
  }
}
```

---

### 8.2 — Signing Logic Extractor (Per-Request Token Generation)

**Arquivo**: `src/reverse/signing-extractor.ts` (~300 linhas)

Extrai a lógica de assinatura de requests e reproduz em Node.js.

```typescript
interface SigningLogic {
  /** Algoritmo identificado (HMAC-SHA256, AES-CBC, custom, etc.) */
  algorithm: string;
  /** Inputs necessários para gerar a assinatura */
  inputs: SigningInput[];
  /** O secret/key usado (pode ser derivado) */
  key: {
    value?: string; // Se encontrado diretamente
    derivation?: string; // Código de derivação (se dinâmico)
    source: "hardcoded" | "derived" | "server-provided" | "unknown";
  };
  /** Header ou cookie onde o token é colocado */
  outputTarget: {
    type: "header" | "cookie" | "query-param" | "body-field";
    name: string;
    format: string; // ex: "{timestamp}.{nonce}.{signature}"
  };
  /** Código Node.js reproduzível gerado pela LLM */
  reproductionCode: string;
  /** Confiança da LLM na extração (0-1) */
  confidence: number;
}

interface SigningInput {
  name: string;
  source:
    | "timestamp"
    | "nonce"
    | "url"
    | "method"
    | "body"
    | "body-hash"
    | "cookie"
    | "header"
    | "page-token"
    | "session-id"
    | "custom";
  description: string;
}
```

**Prompt especializado para a LLM**:

```typescript
const SIGNING_EXTRACTION_PROMPT = `
You are a security researcher analyzing JavaScript code for request signing logic.

## Task
Analyze the following JavaScript functions and identify the request signing/token generation mechanism.

## What to find
1. The SIGNING ALGORITHM used (HMAC-SHA256, AES, custom hash, etc.)
2. ALL INPUTS to the signing function:
   - Timestamp (Date.now(), new Date(), performance.now())
   - Nonce/random value (Math.random(), crypto.randomUUID(), UUID)
   - Request data (URL path, HTTP method, request body, body hash)
   - Session data (cookies, localStorage values, server-provided tokens)
   - Page data (CSRF token, meta tags, data attributes)
3. The SECRET/KEY:
   - Is it hardcoded? (string literal, split across vars, XOR'd)
   - Is it derived? (from multiple values, via PBKDF2, via server response)
   - Is it server-provided? (from a prior API call)
4. The OUTPUT format:
   - Which header/cookie/param receives the token
   - String format (e.g., "{ts}.{nonce}.{sig}", base64, hex)

## Code to analyze
\`\`\`javascript
{CANDIDATE_FUNCTIONS}
\`\`\`

## Required output (JSON)
{
  "algorithm": "string",
  "inputs": [{"name": "string", "source": "string", "how_obtained": "string"}],
  "key": {
    "type": "hardcoded|derived|server-provided",
    "value_or_derivation": "string (the actual key or the derivation code)"
  },
  "output": {
    "target_type": "header|cookie|query|body",
    "target_name": "string (e.g. X-Request-Signature)",
    "format": "string (e.g. {ts}.{nonce}.{sig})"
  },
  "reproduction_code_nodejs": "string (complete Node.js function that generates the token)",
  "confidence": 0.0-1.0,
  "reasoning": "string (step by step explanation)"
}
`;
```

**Implementação do reprodutor de assinatura**:

```typescript
class SigningReproducer {
  private signingFn: Function | null = null;
  private signingLogic: SigningLogic | null = null;

  async setup(signingLogic: SigningLogic): Promise<void> {
    this.signingLogic = signingLogic;
    // Compilar o código de reprodução em uma função executável
    // Usa isolated-vm (sandbox seguro) — vm2 está DEPRECATED desde 2023 (CVE-2023-37466, CVE-2023-37903)
    const ivm = await import("isolated-vm");
    const isolate = new ivm.Isolate({ memoryLimit: 64 }); // 64MB max
    const context = await isolate.createContext();

    // Injetar APIs necessárias no sandbox
    const jail = context.global;
    await jail.set("global", jail.derefInto());

    // Crypto primitives via callback (seguro — não expõe Node.js internals)
    const cryptoModule = await import("crypto");
    await jail.set(
      "_hmac",
      new ivm.Callback((alg: string, key: string, data: string) =>
        cryptoModule.createHmac(alg, key).update(data).digest("hex")
      )
    );
    await jail.set(
      "_sha256",
      new ivm.Callback((data: string) =>
        cryptoModule.createHash("sha256").update(data).digest("hex")
      )
    );
    await jail.set("_btoa", new ivm.Callback((s: string) => Buffer.from(s).toString("base64")));
    await jail.set("_atob", new ivm.Callback((s: string) => Buffer.from(s, "base64").toString()));

    const script = await isolate.compileScript(`(${signingLogic.reproductionCode})`);
    const fn = await script.run(context, { timeout: 5000 });
    this.signingFn = (...args: unknown[]) => fn.apply(undefined, args, { timeout: 5000 });
  }

  async sign(request: SigningRequest): Promise<SignedHeaders> {
    if (!this.signingFn || !this.signingLogic) {
      throw new Error("Signing function not initialized — call setup() first");
    }

    const inputs = this.resolveInputs(request);
    const token = this.signingFn(inputs);

    return {
      [this.signingLogic.outputTarget.name]: this.formatOutput(token),
    };
  }

  private resolveInputs(request: SigningRequest): Record<string, unknown> {
    if (!this.signingLogic) throw new Error("Not initialized");
    const resolved: Record<string, unknown> = {};
    for (const input of this.signingLogic.inputs) {
      switch (input.source) {
        case "timestamp":
          resolved[input.name] = Date.now();
          break;
        case "nonce":
          resolved[input.name] = crypto.randomUUID();
          break;
        case "url":
          resolved[input.name] = request.url;
          break;
        case "method":
          resolved[input.name] = request.method;
          break;
        case "body":
          resolved[input.name] = request.body;
          break;
        case "body-hash":
          resolved[input.name] = crypto
            .createHash("sha256")
            .update(request.body ?? "")
            .digest("hex");
          break;
        case "cookie":
          resolved[input.name] = request.cookies[input.name];
          break;
        case "page-token":
          resolved[input.name] = request.pageTokens[input.name];
          break;
        // ... outros sources
      }
    }
    return resolved;
  }
}
```

---

### 8.3 — Request Chain Mapper

**Arquivo**: `src/reverse/chain-mapper.ts` (~250 linhas)

Mapeia sequências de API calls onde cada response alimenta o próximo request.

```typescript
interface RequestChain {
  /** Sequência ordenada de steps */
  steps: ChainStep[];
  /** Dados que fluem entre steps (data dependencies) */
  dataFlow: DataFlowEdge[];
  /** Timing constraints entre steps */
  timingConstraints: TimingConstraint[];
  /** Código Node.js que executa a chain completa */
  reproductionCode: string;
}

interface ChainStep {
  order: number;
  method: string;
  urlPattern: string;
  headers: Record<string, string>;
  bodyTemplate?: string; // com placeholders: {{step1.session_id}}
  expectedResponse: {
    status: number;
    extractFields: { jsonPath: string; storeAs: string }[];
  };
}

interface DataFlowEdge {
  from: { step: number; field: string; location: "header" | "body" | "cookie" };
  to: { step: number; field: string; location: "header" | "body" | "query" };
}

interface TimingConstraint {
  afterStep: number;
  beforeStep: number;
  minDelayMs: number;
  maxDelayMs: number;
}
```

**Interceptação de network requests via Hero**:

```typescript
class NetworkInterceptor {
  private capturedRequests: CapturedRequest[] = [];

  async intercept(hero: Hero, url: string): Promise<CapturedRequest[]> {
    // Hero expõe Resources que foram carregados
    // Monitorar todas as requests feitas durante o page load

    hero.on("resource", (event) => {
      const resource = event.resource;
      this.capturedRequests.push({
        url: resource.url,
        method: resource.request.method,
        headers: resource.request.headers,
        postData: resource.request.postData,
        status: resource.response?.statusCode,
        responseHeaders: resource.response?.headers,
        responseBody: null, // capturar sob demanda
        timestamp: resource.request.timestamp,
        initiator: resource.request.initiator, // quem fez a request
      });
    });

    await hero.goto(url);
    await hero.waitForPaintingStable();

    // Esperar requests async completarem
    await new Promise((resolve) => setTimeout(resolve, 3000));

    return this.capturedRequests;
  }
}

class ChainMapper {
  constructor(private llmClient: LlmClient) {}

  async mapChain(capturedRequests: CapturedRequest[], pageScripts: string): Promise<RequestChain> {
    // 1. Filtrar requests relevantes (excluir static assets, analytics)
    const apiRequests = this.filterApiRequests(capturedRequests);

    // 2. Detectar data flow entre requests
    //    - Response body de request N contém valor que aparece em request N+1
    const dataFlows = this.detectDataFlow(apiRequests);

    // 3. Se data flow ambíguo, enviar à LLM com código JS
    //    para entender como o site conecta as calls
    if (dataFlows.ambiguous) {
      const llmAnalysis = await this.llmClient.analyze({
        prompt: CHAIN_MAPPING_PROMPT,
        data: { requests: apiRequests, scripts: pageScripts },
      });
      return this.buildChainFromLlmAnalysis(llmAnalysis);
    }

    return this.buildChain(apiRequests, dataFlows);
  }

  private filterApiRequests(requests: CapturedRequest[]): CapturedRequest[] {
    return requests.filter((r) => {
      const url = new URL(r.url);
      // Excluir assets estáticos
      if (/\.(js|css|png|jpg|gif|svg|woff|ico)$/i.test(url.pathname)) return false;
      // Excluir analytics/tracking
      if (/(google-analytics|gtm|facebook|hotjar|segment)/i.test(url.host)) return false;
      // Excluir CDNs de assets
      if (/(cloudfront|cdn|static)/i.test(url.host) && r.method === "GET") return false;
      return true;
    });
  }

  private detectDataFlow(requests: CapturedRequest[]): DataFlowResult {
    const flows: DataFlowEdge[] = [];
    for (let i = 0; i < requests.length; i++) {
      for (let j = i + 1; j < requests.length; j++) {
        // Procurar valores do response de i que aparecem no request de j
        const responseValues = this.extractValues(requests[i].responseBody);
        const requestValues = this.extractValues({
          ...requests[j].headers,
          url: requests[j].url,
          body: requests[j].postData,
        });

        for (const [rKey, rVal] of responseValues) {
          for (const [qKey, qVal] of requestValues) {
            if (rVal === qVal && rVal.length > 8) {
              // valor longo o suficiente para não ser coincidência
              flows.push({
                from: { step: i, field: rKey, location: "body" },
                to: { step: j, field: qKey, location: this.inferLocation(qKey, requests[j]) },
              });
            }
          }
        }
      }
    }
    return { flows, ambiguous: flows.length === 0 && requests.length > 2 };
  }
}
```

---

### 8.4 — WASM Runtime Interceptor

**Arquivo**: `src/reverse/wasm-interceptor.ts` (~200 linhas)

Hook no `WebAssembly.instantiate` para capturar inputs/outputs de WASM modules
sem precisar reverter o binário.

```typescript
interface WasmInterception {
  /** Nome do export chamado */
  exportName: string;
  /** Inputs passados ao WASM */
  inputs: unknown[];
  /** Output retornado pelo WASM */
  output: unknown;
  /** Timestamp da chamada */
  timestamp: number;
  /** Podemos reproduzir chamando o mesmo WASM em Node? */
  reproducible: boolean;
}

class WasmInterceptor {
  /**
   * Injeta hook no WebAssembly.instantiate ANTES do page load
   * para capturar todas as chamadas a exports WASM.
   */
  async inject(hero: Hero): Promise<void> {
    // Hero suporta addNewDocumentScript — executa antes de qualquer JS da página
    await hero.addNewDocumentScript(`
      (function() {
        const originalInstantiate = WebAssembly.instantiate;
        const originalInstantiateStreaming = WebAssembly.instantiateStreaming;
        window.__wasmInterceptions = [];

        function wrapExports(instance) {
          const wrapped = {};
          for (const [name, exp] of Object.entries(instance.exports)) {
            if (typeof exp === 'function') {
              wrapped[name] = function(...args) {
                const result = exp.apply(this, args);
                window.__wasmInterceptions.push({
                  exportName: name,
                  inputs: JSON.parse(JSON.stringify(args)),
                  output: typeof result === 'object' ? null : result,
                  timestamp: Date.now()
                });
                return result;
              };
            } else {
              wrapped[name] = exp;
            }
          }
          return wrapped;
        }

        WebAssembly.instantiate = async function(source, imports) {
          const result = await originalInstantiate.call(this, source, imports);
          if (result.instance) {
            result.instance = { exports: wrapExports(result.instance) };
          }
          return result;
        };

        WebAssembly.instantiateStreaming = async function(source, imports) {
          const result = await originalInstantiateStreaming.call(this, source, imports);
          if (result.instance) {
            result.instance = { exports: wrapExports(result.instance) };
          }
          return result;
        };
      })();
    `);
  }

  async collect(hero: Hero): Promise<WasmInterception[]> {
    return await hero.evaluate(`window.__wasmInterceptions || []`);
  }

  /**
   * Para tokens WASM: baixar o .wasm e executar em Node.js com os mesmos inputs.
   * Isso elimina a necessidade de reverter o binário.
   */
  async reproduceInNode(wasmUrl: string, exportName: string, inputs: unknown[]): Promise<unknown> {
    const response = await fetch(wasmUrl);
    const buffer = await response.arrayBuffer();
    const module = await WebAssembly.instantiate(buffer);
    const fn = module.instance.exports[exportName] as Function;
    return fn(...inputs);
  }
}
```

---

### 8.5 — Polymorphic Code Normalizer

**Arquivo**: `src/reverse/polymorphic-normalizer.ts` (~200 linhas)

Para sites que servem JS diferente em cada visita (Shape Security, Kasada).

```typescript
interface NormalizationResult {
  /** O algoritmo estável subjacente identificado */
  stableAlgorithm: string;
  /** Código normalizado que é consistente entre visitas */
  normalizedCode: string;
  /** Variações observadas entre amostras */
  variations: PolymorphicVariation[];
  /** Confiança na normalização */
  confidence: number;
}

interface PolymorphicVariation {
  type:
    | "var_rename"
    | "control_flow"
    | "string_encoding"
    | "dead_code"
    | "operator_substitution"
    | "array_shuffle";
  description: string;
  example: { before: string; after: string };
}
```

**Estratégia: multi-sample + LLM diff**:

```typescript
class PolymorphicNormalizer {
  constructor(private llmClient: LlmClient) {}

  async normalize(url: string, hero: Hero, samples: number = 3): Promise<NormalizationResult> {
    // 1. Coletar N amostras do mesmo script em sessões diferentes
    const codeSamples: string[] = [];
    for (let i = 0; i < samples; i++) {
      const scripts = await this.fetchScripts(url, hero);
      codeSamples.push(scripts.mainBundle);
      // Nova sessão para cada amostra
      await hero.close();
      hero = await this.createFreshHero();
    }

    // 2. Deobfuscar estaticamente cada amostra
    const deobfuscated = codeSamples.map((s) => this.staticDeobfuscate(s));

    // 3. Diff estrutural (AST-based)
    //    - Parsear cada amostra como AST
    //    - Identificar nós que são idênticos vs que variam
    const astDiff = this.computeAstDiff(deobfuscated);

    // 4. Enviar os diffs à LLM para identificar o algoritmo estável
    const analysis = await this.llmClient.analyze({
      prompt: POLYMORPHIC_ANALYSIS_PROMPT,
      data: {
        sample_count: samples,
        stable_nodes: astDiff.stable,
        varying_nodes: astDiff.varying,
        code_samples: deobfuscated.map((d) => d.substring(0, 5000)), // Truncar para economizar tokens
      },
    });

    return {
      stableAlgorithm: analysis.algorithm,
      normalizedCode: analysis.normalizedCode,
      variations: analysis.variations,
      confidence: analysis.confidence,
    };
  }
}
```

---

### 8.6 — Anti-Debug Patcher

**Arquivo**: `src/reverse/anti-debug-patcher.ts` (~150 linhas)

Neutraliza verificações de integridade e anti-debugging antes que executem.

```typescript
interface AntiDebugPattern {
  type:
    | "debugger_statement"
    | "timing_check"
    | "toString_check"
    | "stack_trace_check"
    | "self_hash"
    | "devtools_detection"
    | "console_override"
    | "error_trap";
  pattern: RegExp;
  neutralization: string; // código que substitui o pattern
}

class AntiDebugPatcher {
  private patterns: AntiDebugPattern[] = [
    {
      // debugger; statements (usados para pausar se DevTools aberto)
      type: "debugger_statement",
      pattern: /\bdebugger\b\s*;?/g,
      neutralization: "/* debugger removed */;",
    },
    {
      // Timing checks: if (performance.now() - t0 > 100) -> bot detected
      type: "timing_check",
      pattern: /performance\.now\(\)\s*-\s*\w+\s*>\s*\d+/g,
      neutralization: "false /* timing check disabled */",
    },
    {
      // Function.toString() integrity checks
      type: "toString_check",
      pattern: /\.toString\(\)\s*(!==?|===?)\s*['"][^'"]*native code[^'"]*['"]/g,
      neutralization: '=== "function () { [native code] }" /* patched */',
    },
    {
      // DevTools detection via window dimensions
      type: "devtools_detection",
      pattern: /window\.outerWidth\s*-\s*window\.innerWidth\s*>\s*\d+/g,
      neutralization: "false /* devtools check disabled */",
    },
    {
      // Stack trace depth checks
      type: "stack_trace_check",
      pattern: /new\s+Error\(\)\.stack\.split\(['"]\n['"]\)\.length\s*>\s*\d+/g,
      neutralization: "false /* stack check disabled */",
    },
    {
      // Console.log override detection
      type: "console_override",
      pattern: /console\.(log|warn|error)\s*=\s*function/g,
      neutralization: "/* console override blocked */ void",
    },
  ];

  /**
   * Injeta patches via Hero's addNewDocumentScript (executa antes do JS da página)
   */
  async inject(hero: Hero): Promise<void> {
    await hero.addNewDocumentScript(`
      (function() {
        // Override debugger via Proxy on Function constructor
        const origEval = window.eval;
        window.eval = function(code) {
          if (typeof code === 'string') {
            code = code.replace(/\\bdebugger\\b\\s*;?/g, ';');
          }
          return origEval.call(this, code);
        };

        // Freeze performance.now() timing for anti-debug checks
        const realNow = performance.now.bind(performance);
        let offset = 0;
        performance.now = function() {
          return realNow() - offset;
        };

        // Ensure Function.toString() always returns native code string
        const origToString = Function.prototype.toString;
        Function.prototype.toString = function() {
          try { return origToString.call(this); }
          catch { return 'function () { [native code] }'; }
        };

        // Block console reassignment
        Object.defineProperties(console, {
          log: { writable: false, configurable: false },
          warn: { writable: false, configurable: false },
          error: { writable: false, configurable: false },
        });
      })();
    `);
  }

  /**
   * Modo LLM: analisa código para encontrar anti-debug patterns
   * que não correspondem às heurísticas conhecidas
   */
  async discoverNewPatterns(code: string, llmClient: LlmClient): Promise<AntiDebugPattern[]> {
    const analysis = await llmClient.analyze({
      prompt: ANTI_DEBUG_DISCOVERY_PROMPT,
      data: { code: code.substring(0, 10000) },
    });
    return analysis.patterns;
  }
}
```

---

### 8.7 — Token Generation Code Transplanter (VM Sandbox)

**Arquivo**: `src/reverse/code-transplanter.ts` (~250 linhas)

Extrai a função de geração de token do JS do site e a executa isoladamente
em Node.js usando uma VM sandboxed — sem precisar entender completamente o algoritmo.

```typescript
interface TransplantResult {
  /** Código extraído e adaptado para Node.js */
  transplantedCode: string;
  /** Dependências que precisam ser mockadas no sandbox */
  requiredMocks: MockSpec[];
  /** Função wrapper pronta para chamar */
  execute: (inputs: Record<string, unknown>) => Promise<string>;
  /** Se a LLM teve que adaptar o código (vs usar direto) */
  wasAdapted: boolean;
}

interface MockSpec {
  /** O que mockar (window, document, navigator, etc.) */
  target: string;
  /** Tipo de mock */
  type: "value" | "function" | "object";
  /** Valor ou implementação do mock */
  implementation: string;
}
```

**Implementação core**:

```typescript
class CodeTransplanter {
  constructor(private llmClient: LlmClient) {}

  async transplant(signingLogic: SigningLogic, fullPageContext: string): Promise<TransplantResult> {
    // 1. Pedir à LLM para extrair APENAS o código necessário
    //    e adaptá-lo para rodar fora do browser
    const adapted = await this.llmClient.analyze({
      prompt: TRANSPLANT_PROMPT,
      data: {
        signingFunction: signingLogic.reproductionCode,
        fullContext: fullPageContext.substring(0, 15000),
        target: "Node.js CommonJS, no browser APIs",
      },
    });

    // 2. Identificar browser APIs usadas e criar mocks
    const mocks = this.identifyRequiredMocks(adapted.code);

    // 3. Construir sandbox com mocks
    const sandbox = this.buildSandbox(mocks);

    // 4. Testar execução
    const testResult = await this.testExecution(adapted.code, sandbox);

    if (!testResult.success) {
      // 5. Se falhou, pedir à LLM para corrigir
      const fixed = await this.llmClient.analyze({
        prompt: TRANSPLANT_FIX_PROMPT,
        data: {
          code: adapted.code,
          error: testResult.error,
          mocks: mocks,
        },
      });
      return this.buildResult(fixed.code, mocks, true);
    }

    return this.buildResult(adapted.code, mocks, adapted.wasAdapted);
  }

  private buildSandbox(mocks: MockSpec[]): Record<string, unknown> {
    const sandbox: Record<string, unknown> = {
      // Sempre disponível
      console: { log: () => {}, warn: () => {}, error: () => {} },
      setTimeout: setTimeout,
      setInterval: setInterval,
      clearTimeout: clearTimeout,
      clearInterval: clearInterval,
      Buffer: Buffer,
      TextEncoder: TextEncoder,
      TextDecoder: TextDecoder,
      crypto: require("crypto"),
      atob: (s: string) => Buffer.from(s, "base64").toString(),
      btoa: (s: string) => Buffer.from(s).toString("base64"),
      URL: URL,
      URLSearchParams: URLSearchParams,
    };

    // Browser API mocks
    for (const mock of mocks) {
      switch (mock.target) {
        case "window":
          sandbox.window = sandbox; // self-reference
          sandbox.self = sandbox;
          break;
        case "document":
          sandbox.document = {
            cookie: "",
            referrer: "",
            location: { href: "", hostname: "", pathname: "/" },
            querySelector: () => null,
            querySelectorAll: () => [],
            createElement: () => ({ style: {} }),
          };
          break;
        case "navigator":
          sandbox.navigator = {
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
            language: "en-US",
            languages: ["en-US", "en"],
            platform: "Win32",
            hardwareConcurrency: 8,
            deviceMemory: 8,
            webdriver: false,
          };
          break;
        case "performance":
          sandbox.performance = {
            now: () => Date.now() - Math.random() * 1000,
            timing: { navigationStart: Date.now() - 5000 },
          };
          break;
      }
    }

    return sandbox;
  }

  private identifyRequiredMocks(code: string): MockSpec[] {
    const mocks: MockSpec[] = [];
    if (/\bwindow\b/.test(code))
      mocks.push({ target: "window", type: "object", implementation: "" });
    if (/\bdocument\b/.test(code))
      mocks.push({ target: "document", type: "object", implementation: "" });
    if (/\bnavigator\b/.test(code))
      mocks.push({ target: "navigator", type: "object", implementation: "" });
    if (/\bperformance\b/.test(code))
      mocks.push({ target: "performance", type: "object", implementation: "" });
    if (/\blocation\b/.test(code))
      mocks.push({ target: "location", type: "object", implementation: "" });
    if (/\bfetch\b/.test(code))
      mocks.push({ target: "fetch", type: "function", implementation: "" });
    if (/\bXMLHttpRequest\b/.test(code))
      mocks.push({ target: "XMLHttpRequest", type: "function", implementation: "" });
    return mocks;
  }
}
```

---

### 8.8 — Encrypted Payload Reverser

**Arquivo**: `src/reverse/payload-reverser.ts` (~200 linhas)

Reverte APIs que encriptam request/response payloads.

```typescript
interface EncryptionScheme {
  /** Algoritmo detectado */
  algorithm: "AES-CBC" | "AES-GCM" | "AES-CTR" | "ChaCha20" | "XOR" | "custom";
  /** Como a chave é derivada */
  keyDerivation: {
    method: "PBKDF2" | "HKDF" | "SHA256" | "direct" | "custom";
    inputs: string[]; // ex: ['serverNonce', 'clientRandom', 'timestamp']
    code: string; // código de derivação
  };
  /** IV/nonce generation */
  ivGeneration: string;
  /** Código Node.js para encrypt */
  encryptCode: string;
  /** Código Node.js para decrypt */
  decryptCode: string;
}

class PayloadReverser {
  constructor(private llmClient: LlmClient) {}

  async reverseEncryption(
    capturedRequests: CapturedRequest[],
    pageScripts: string
  ): Promise<EncryptionScheme | null> {
    // 1. Detectar se há payloads encriptados
    //    Heurística: body é base64 ou hex sem estrutura JSON/form
    const encryptedRequests = capturedRequests.filter((r) => {
      if (!r.postData) return false;
      // Base64 puro (sem JSON)
      if (/^[A-Za-z0-9+/=]{32,}$/.test(r.postData)) return true;
      // Hex string
      if (/^[0-9a-fA-F]{32,}$/.test(r.postData)) return true;
      // JSON com campo "data" ou "payload" que é base64/hex
      try {
        const json = JSON.parse(r.postData);
        const dataField = json.data || json.payload || json.encrypted || json.body;
        if (typeof dataField === "string" && dataField.length > 32) return true;
      } catch {}
      return false;
    });

    if (encryptedRequests.length === 0) return null;

    // 2. Enviar à LLM para identificar o esquema de encriptação
    const analysis = await this.llmClient.analyze({
      prompt: ENCRYPTION_REVERSAL_PROMPT,
      data: {
        encryptedPayloads: encryptedRequests.map((r) => ({
          url: r.url,
          body: r.postData?.substring(0, 500),
          headers: r.headers,
        })),
        relevantScripts: this.extractCryptoRelatedCode(pageScripts),
      },
    });

    return analysis;
  }

  private extractCryptoRelatedCode(scripts: string): string {
    // Extrair apenas funções que usam crypto APIs
    // NOTA: Sem flag /g para evitar stale lastIndex entre chamadas de .test()
    const cryptoPatterns = [
      /crypto\.subtle\.\w+\([^)]*\)/,
      /CryptoJS\.\w+\.\w+\([^)]*\)/,
      /new\s+(?:Uint8Array|ArrayBuffer|DataView)\(/,
      /\b(?:encrypt|decrypt|cipher|decipher|hmac|pbkdf2|hkdf)\b/i,
      /\bAES\b|\bRSA\b|\bSHA\b/,
    ];

    const lines = scripts.split("\n");
    const relevantLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (cryptoPatterns.some((p) => p.test(lines[i]))) {
        // Capturar contexto: 10 linhas antes e depois
        const start = Math.max(0, i - 10);
        const end = Math.min(lines.length, i + 10);
        relevantLines.push(lines.slice(start, end).join("\n"));
      }
    }
    return relevantLines.join("\n---\n");
  }
}
```

---

### 8.9 — Synthetic Behavior Generator

**Arquivo**: `src/reverse/behavior-generator.ts` (~200 linhas)

Gera dados de comportamento humano sintéticos que passam validação
de biometric tokens.

```typescript
interface SyntheticBehavior {
  mouseTrail: { x: number; y: number; t: number }[];
  scrollEvents: { y: number; t: number; direction: "up" | "down" }[];
  keyTimings: { key: string; downAt: number; upAt: number }[];
  touchEvents: { x: number; y: number; pressure: number; t: number }[];
  focusChanges: { element: string; t: number }[];
  totalDurationMs: number;
}

class BehaviorGenerator {
  /**
   * Gera comportamento que imita padrões humanos reais.
   * Baseado em pesquisa de Human-Computer Interaction:
   * - Fitts's Law para mouse movements
   * - Log-normal distribution para key timings
   * - Natural scrolling patterns
   */
  generate(options: {
    durationMs: number;
    viewport: { width: number; height: number };
    interactionType: "browsing" | "reading" | "searching" | "form-filling";
  }): SyntheticBehavior {
    const behavior: SyntheticBehavior = {
      mouseTrail: [],
      scrollEvents: [],
      keyTimings: [],
      touchEvents: [],
      focusChanges: [],
      totalDurationMs: options.durationMs,
    };

    // Mouse: Fitts's Law — tempo proporcional a log2(distância/tamanho)
    // Com Bézier curves para trajetória natural (não linear)
    let currentX = options.viewport.width / 2;
    let currentY = options.viewport.height / 3;
    let currentT = 0;

    const numMoves = Math.floor(options.durationMs / 200); // ~5 moves/sec
    for (let i = 0; i < numMoves; i++) {
      // Target point com distribuição normal centrada na viewport
      const targetX = this.gaussianRandom(options.viewport.width / 2, options.viewport.width / 4);
      const targetY = this.gaussianRandom(options.viewport.height / 2, options.viewport.height / 4);

      // Bézier curve de currentPos até targetPos
      const controlPoints = this.generateBezierControlPoints(currentX, currentY, targetX, targetY);
      const steps = this.interpolateBezier(controlPoints, 5 + Math.floor(Math.random() * 5));

      for (const step of steps) {
        // Adicionar micro-jitter (tremor humano natural, ~1-3px)
        behavior.mouseTrail.push({
          x: Math.round(step.x + this.gaussianRandom(0, 1.5)),
          y: Math.round(step.y + this.gaussianRandom(0, 1.5)),
          t: currentT,
        });
        currentT += 15 + Math.floor(Math.random() * 10); // ~60-70fps
      }

      currentX = targetX;
      currentY = targetY;
      currentT += this.gaussianRandom(100, 50); // pausa entre movimentos
    }

    // Scroll: padrão de leitura — scroll down, pausa, scroll down, ocasional scroll up
    let scrollY = 0;
    let scrollT = 200;
    while (scrollT < options.durationMs) {
      // Scroll down (80% chance) ou up (20% chance)
      const direction = Math.random() > 0.2 ? "down" : "up";
      const amount = Math.floor(this.gaussianRandom(200, 80));
      scrollY =
        direction === "down" ? Math.min(scrollY + amount, 5000) : Math.max(scrollY - amount, 0);

      behavior.scrollEvents.push({ y: scrollY, t: scrollT, direction });

      // Pausa de leitura: log-normal (média ~2s, alta variância)
      scrollT += Math.floor(this.logNormalRandom(7.5, 0.5)); // mediana ~1800ms
    }

    return behavior;
  }

  /**
   * Injeta o comportamento gerado na página via Hero
   */
  async inject(hero: Hero, behavior: SyntheticBehavior): Promise<void> {
    // Executar mouse movements via Hero's interact API
    for (let i = 0; i < behavior.mouseTrail.length; i += 3) {
      const point = behavior.mouseTrail[i];
      await hero.interact({ move: [point.x, point.y] });
    }

    // Executar scroll events
    for (const scroll of behavior.scrollEvents) {
      await hero.interact({
        scroll: { y: scroll.y - (behavior.scrollEvents[0]?.y ?? 0) },
      });
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private gaussianRandom(mean: number, stdDev: number): number {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z * stdDev + mean;
  }

  private logNormalRandom(mu: number, sigma: number): number {
    return Math.exp(this.gaussianRandom(mu, sigma));
  }

  private generateBezierControlPoints(
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ): { x: number; y: number }[] {
    // 2 control points com offset aleatório perpendicular à reta
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    const perpX = -(y1 - y0) * 0.3;
    const perpY = (x1 - x0) * 0.3;

    return [
      { x: x0, y: y0 },
      { x: midX + perpX * (Math.random() - 0.5), y: midY + perpY * (Math.random() - 0.5) },
      { x: midX - perpX * (Math.random() - 0.5), y: midY - perpY * (Math.random() - 0.5) },
      { x: x1, y: y1 },
    ];
  }

  private interpolateBezier(
    points: { x: number; y: number }[],
    steps: number
  ): { x: number; y: number }[] {
    const result: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x =
        Math.pow(1 - t, 3) * points[0].x +
        3 * Math.pow(1 - t, 2) * t * points[1].x +
        3 * (1 - t) * Math.pow(t, 2) * points[2].x +
        Math.pow(t, 3) * points[3].x;
      const y =
        Math.pow(1 - t, 3) * points[0].y +
        3 * Math.pow(1 - t, 2) * t * points[1].y +
        3 * (1 - t) * Math.pow(t, 2) * points[2].y +
        Math.pow(t, 3) * points[3].y;
      result.push({ x, y });
    }
    return result;
  }
}
```

---

### 8.10 — GraphQL Schema/Hash Extractor

**Arquivo**: `src/reverse/graphql-extractor.ts` (~150 linhas)

Extrai persisted query hashes e schema de bundles JS.

```typescript
interface GraphQLExtraction {
  /** Persisted query hash → query text mapping */
  persistedQueries: Map<string, string>;
  /** Endpoints GraphQL encontrados */
  endpoints: string[];
  /** Schema parcial inferido dos queries */
  partialSchema: string;
}

class GraphQLExtractor {
  /**
   * Extrai hashes de persisted queries do bundle JS.
   * Sites como Twitter/X, GitHub, Facebook usam este padrão.
   */
  async extract(bundleCode: string, llmClient?: LlmClient): Promise<GraphQLExtraction> {
    const result: GraphQLExtraction = {
      persistedQueries: new Map(),
      endpoints: [],
      partialSchema: "",
    };

    // 1. Regex para persisted query patterns conhecidos
    const patterns = [
      // Apollo Client: queryId / operationName
      /documentId:\s*["']([a-f0-9]{64})["'],?\s*operationName:\s*["'](\w+)["']/g,
      // Relay: id → hash
      /(?:query|mutation)\s+(\w+).*?id:\s*["']([a-f0-9]{32,64})["']/gs,
      // Generic: sha256Hash
      /sha256Hash:\s*["']([a-f0-9]{64})["']/g,
      // Literal queries inline
      /(?:query|mutation|subscription)\s+(\w+)\s*(?:\([^)]*\))?\s*\{[^}]+\}/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(bundleCode)) !== null) {
        if (match[2]) {
          result.persistedQueries.set(match[2], match[1]); // hash → operationName
        } else if (match[1] && match[1].length === 64) {
          result.persistedQueries.set(match[1], "unknown");
        }
      }
    }

    // 2. Encontrar endpoints GraphQL
    const endpointPatterns = [
      /["'](\/graphql[^"']*?)["']/g,
      /["'](\/api\/graphql[^"']*?)["']/g,
      /["'](https?:\/\/[^"']*graphql[^"']*?)["']/g,
    ];
    for (const pattern of endpointPatterns) {
      let match;
      while ((match = pattern.exec(bundleCode)) !== null) {
        result.endpoints.push(match[1]);
      }
    }

    // 3. Se LLM disponível e queries inline encontradas, inferir schema
    if (llmClient && result.persistedQueries.size > 0) {
      const schemaAnalysis = await llmClient.analyze({
        prompt: "Infer a partial GraphQL schema from these queries:",
        data: { queries: Array.from(result.persistedQueries.entries()).slice(0, 20) },
      });
      result.partialSchema = schemaAnalysis.schema;
    }

    return result;
  }
}
```

---

### 8.11 — LLM Client Abstraction

**Arquivo**: `src/reverse/llm-client.ts` (~200 linhas)

Cliente LLM unificado que suporta múltiplos providers, usado por todos os módulos da Phase 8.

```typescript
interface LlmClientOptions {
  /** Provider: anthropic, openai, google (auto-detect da config) */
  provider?: "anthropic" | "openai" | "google";
  /** API key (ou obter do UserConfig) */
  apiKey?: string;
  /** Modelo preferido (default: modelo mais barato do provider) */
  model?: string;
  /** Timeout por request */
  timeoutMs?: number;
  /** Máximo de tokens por análise */
  maxTokens?: number;
  /** Cache de resultados (evita re-análise do mesmo código) */
  enableCache?: boolean;
}

class LlmClient {
  private cache: Map<string, unknown> = new Map();

  constructor(private options: LlmClientOptions) {}

  async analyze<T>(request: {
    prompt: string;
    data: Record<string, unknown>;
    responseFormat?: "json" | "text";
  }): Promise<T> {
    // 1. Verificar cache
    const cacheKey = this.computeCacheKey(request);
    if (this.options.enableCache && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) as T;
    }

    // 2. Selecionar modelo econômico por default
    const model = this.options.model ?? this.getDefaultModel();

    // 3. Chamar API do provider com retry e error handling (GAP-02 FIX)
    let response: string;
    try {
      response = await this.callProvider(model, request);
    } catch (error: unknown) {
      if (error instanceof Error) {
        // Rate limit (429) — retry com exponential backoff
        if ("status" in error && (error as { status: number }).status === 429) {
          const retryAfter = this.parseRetryAfter(error);
          await this.delay(retryAfter);
          response = await this.callProvider(model, request);
        }
        // Timeout
        else if (error.name === "AbortError" || error.message.includes("timeout")) {
          throw new LlmTimeoutError(
            `LLM provider ${this.options.provider} timed out after ${this.options.timeoutMs}ms`,
            { cause: error }
          );
        }
        // Outros erros de API (500, 503, etc.)
        else {
          throw new LlmApiError(
            `LLM provider ${this.options.provider} returned error: ${error.message}`,
            { cause: error }
          );
        }
      } else {
        throw error;
      }
    }

    // 4. Parsear resposta (JSON ou text) com fallback
    let parsed: T;
    try {
      parsed = request.responseFormat === "json" ? (JSON.parse(response) as T) : (response as T);
    } catch {
      throw new LlmParseError(
        `Failed to parse LLM response as JSON. Raw response: ${response.substring(0, 200)}...`
      );
    }

    // 5. Cachear
    if (this.options.enableCache) {
      this.cache.set(cacheKey, parsed);
    }

    return parsed;
  }

  private parseRetryAfter(error: unknown): number {
    // Tentar extrair Retry-After do header ou corpo do erro
    if (error && typeof error === "object" && "headers" in error) {
      const headers = (error as { headers: Record<string, string> }).headers;
      const retryAfter = headers["retry-after"];
      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) return seconds * 1000;
      }
    }
    return 5000; // default: 5s
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getDefaultModel(): string {
    switch (this.options.provider) {
      case "anthropic":
        return "claude-sonnet-4-20250514"; // barato + capaz
      case "openai":
        return "gpt-4o-mini";
      case "google":
        return "gemini-2.0-flash";
      default:
        return "claude-sonnet-4-20250514";
    }
  }

  private computeCacheKey(request: { prompt: string; data: Record<string, unknown> }): string {
    // Hash do prompt + primeiros 1000 chars do data (para evitar re-análise do mesmo bundle)
    const content = request.prompt + JSON.stringify(request.data).substring(0, 1000);
    return require("crypto").createHash("sha256").update(content).digest("hex");
  }
}
```

---

### 8.12 — Reverse Engineering Orchestrator

**Arquivo**: `src/reverse/orchestrator.ts` (~300 linhas)

Orquestra todos os módulos da Phase 8 em um pipeline coeso.

```typescript
interface ReverseEngineeringResult {
  /** Signing logic identificada (se existir) */
  signing?: SigningLogic;
  /** Request chain mapeada (se existir) */
  chain?: RequestChain;
  /** Esquema de encriptação (se existir) */
  encryption?: EncryptionScheme;
  /** Interceptions WASM (se existir) */
  wasmTokens?: WasmInterception[];
  /** GraphQL queries (se existir) */
  graphql?: GraphQLExtraction;
  /** Função transplantada pronta para uso */
  tokenGenerator?: TransplantResult;
  /** Comportamento sintético gerado */
  syntheticBehavior?: SyntheticBehavior;
  /** Resumo legível do que foi encontrado */
  summary: string;
  /** Recomendações de configuração para scraper */
  recommendations: ScraperRecommendation[];
}

interface ScraperRecommendation {
  type:
    | "add-header"
    | "use-signing"
    | "follow-chain"
    | "encrypt-payload"
    | "add-behavior"
    | "use-wasm-token"
    | "use-graphql-hash";
  description: string;
  config: Partial<ScrapeOptions>;
}

class ReverseEngineeringOrchestrator {
  private bundleAnalyzer: BundleAnalyzer;
  private signingExtractor: SigningReproducer;
  private chainMapper: ChainMapper;
  private wasmInterceptor: WasmInterceptor;
  private antiDebugPatcher: AntiDebugPatcher;
  private codeTransplanter: CodeTransplanter;
  private payloadReverser: PayloadReverser;
  private behaviorGenerator: BehaviorGenerator;
  private graphqlExtractor: GraphQLExtractor;
  private polymorphicNormalizer: PolymorphicNormalizer;

  constructor(private llmClient: LlmClient) {
    this.bundleAnalyzer = new BundleAnalyzer(llmClient);
    this.signingExtractor = new SigningReproducer(llmClient);
    this.chainMapper = new ChainMapper(llmClient);
    this.wasmInterceptor = new WasmInterceptor();
    this.antiDebugPatcher = new AntiDebugPatcher();
    this.codeTransplanter = new CodeTransplanter(llmClient);
    this.payloadReverser = new PayloadReverser(llmClient);
    this.behaviorGenerator = new BehaviorGenerator();
    this.graphqlExtractor = new GraphQLExtractor();
    this.polymorphicNormalizer = new PolymorphicNormalizer(llmClient);
  }

  /**
   * Pipeline completo: analisa um site e produz tudo necessário para scraping.
   * Chamado quando engines normais falham com 403/401/challenge.
   */
  async analyze(url: string, hero: Hero): Promise<ReverseEngineeringResult> {
    const result: ReverseEngineeringResult = {
      summary: "",
      recommendations: [],
    };

    // Step 0: Injetar anti-debug patches e WASM interceptor ANTES do page load
    await Promise.all([this.antiDebugPatcher.inject(hero), this.wasmInterceptor.inject(hero)]);

    // Step 1: Carregar página e capturar tudo
    const [bundleAnalysis, capturedRequests] = await Promise.all([
      this.bundleAnalyzer.analyze(url, hero),
      new NetworkInterceptor().intercept(hero, url),
    ]);

    // Step 2: Análises paralelas (independentes)
    const [signing, chain, encryption, wasmTokens, graphql] = await Promise.allSettled([
      // Signing logic
      bundleAnalysis.interestingFunctions.filter(
        (f) => f.classification === "signing" || f.classification === "token-generation"
      ).length > 0
        ? this.signingExtractor.extract(bundleAnalysis)
        : Promise.resolve(null),

      // Request chain
      capturedRequests.length > 2
        ? this.chainMapper.mapChain(capturedRequests, bundleAnalysis.deobfuscatedSource)
        : Promise.resolve(null),

      // Encrypted payloads
      this.payloadReverser.reverseEncryption(capturedRequests, bundleAnalysis.deobfuscatedSource),

      // WASM tokens
      this.wasmInterceptor.collect(hero),

      // GraphQL
      this.graphqlExtractor.extract(bundleAnalysis.deobfuscatedSource, this.llmClient),
    ]);

    // Step 3: Se signing logic encontrada, transplantar para Node.js
    if (signing.status === "fulfilled" && signing.value) {
      result.signing = signing.value;
      result.tokenGenerator = await this.codeTransplanter.transplant(
        signing.value,
        bundleAnalysis.deobfuscatedSource
      );
      result.recommendations.push({
        type: "use-signing",
        description: `Use ${signing.value.algorithm} signing for ${signing.value.outputTarget.name} header`,
        config: {},
      });
    }

    // Step 4: Gerar comportamento sintético se biometric tokens detectados
    if (bundleAnalysis.interestingFunctions.some((f) => f.classification === "fingerprinting")) {
      result.syntheticBehavior = this.behaviorGenerator.generate({
        durationMs: 3000,
        viewport: { width: 1920, height: 1080 },
        interactionType: "browsing",
      });
      result.recommendations.push({
        type: "add-behavior",
        description:
          "Site collects behavioral biometrics — inject synthetic behavior before scraping",
        config: {},
      });
    }

    // Step 5: Montar resumo
    result.summary = this.buildSummary(result);

    return result;
  }
}
```

---

### 8.13 — Integração com o Scraper

**Modificações em `src/types.ts`**:

```typescript
interface ScrapeOptions {
  // ... campos existentes ...

  /** Reverse engineering options (Phase 8) */
  reverseEngineering?: {
    /** Habilitar análise automática quando engines normais falham */
    enabled?: boolean;
    /** Habilitar análise de JS bundles via LLM */
    analyzeJsBundles?: boolean;
    /** Habilitar intercepção de WASM */
    interceptWasm?: boolean;
    /** Habilitar geração de comportamento sintético */
    syntheticBehavior?: boolean;
    /** Habilitar anti-debug patching */
    patchAntiDebug?: boolean;
    /** Habilitar GraphQL extraction */
    extractGraphql?: boolean;
    /** LLM provider config (ou usar do UserConfig) */
    llm?: LlmClientOptions;
    /** Cache de análises (evitar re-analisar o mesmo site) */
    cacheAnalysis?: boolean;
    /** Diretório de cache */
    cachePath?: string;
  };
}
```

**Modificações em `src/engines/orchestrator.ts`**:

```typescript
// Quando TODAS as engines falham:
if (allEnginesFailed && options.reverseEngineering?.enabled) {
  logger.info(`All engines failed for ${url}. Starting reverse engineering analysis...`);

  const reverseOrchestrator = new ReverseEngineeringOrchestrator(
    new LlmClient(options.reverseEngineering.llm ?? userConfig.getLlmConfig())
  );

  const analysis = await reverseOrchestrator.analyze(url, hero);

  // Aplicar recomendações e retry com engine configurada
  const enhancedOptions = this.applyRecommendations(options, analysis);
  return this.executeWithEngine(url, enhancedOptions, "hero");
}
```

**CLI flags**:

```typescript
.option('--reverse-engineer', 'Enable LLM-assisted reverse engineering on failure')
.option('--re-analyze-bundles', 'Analyze JS bundles for signing logic')
.option('--re-intercept-wasm', 'Intercept WASM token generation')
.option('--re-synthetic-behavior', 'Generate synthetic mouse/scroll behavior')
.option('--re-patch-antidebug', 'Neutralize anti-debugging checks')
.option('--re-extract-graphql', 'Extract GraphQL persisted queries')
.option('--re-llm-provider <provider>', 'LLM provider for analysis (anthropic|openai|google)')
```

---

### 8.14 — Testes Necessários

| Teste                         | Tipo        | Descrição                                                    |
| ----------------------------- | ----------- | ------------------------------------------------------------ |
| Static deobfuscation          | Unit        | Hex, unicode, charCode, base64, string arrays, control flow  |
| Signing logic extraction      | Unit        | Mock LLM response → SigningLogic object                      |
| Signing reproduction          | Unit        | Generated code produces valid HMAC/AES tokens in VM          |
| Request chain detection       | Unit        | Detect data flow between mock captured requests              |
| WASM hook injection           | Integration | Hook captures WebAssembly.instantiate calls in Hero          |
| Anti-debug patches            | Integration | Debugger statements, timing checks neutralized in Hero       |
| Code transplanting            | Unit        | Browser code runs in Node.js VM with mocks                   |
| Encrypted payload detection   | Unit        | Identify base64/hex payloads in mock requests                |
| Synthetic behavior generation | Unit        | Mouse trails follow Bézier curves, timings are log-normal    |
| GraphQL hash extraction       | Unit        | Extract persisted query hashes from minified bundles         |
| Polymorphic normalization     | Unit        | 3 samples of same algorithm → identical normalized output    |
| LLM client caching            | Unit        | Same input → cache hit, different input → cache miss         |
| Full pipeline                 | Integration | analyze() on mock site → produces signing + chain + behavior |
| Orchestrator integration      | Integration | allEnginesFailed → reverse engineering → retry succeeds      |

---

## Phase 9 — MCP Server (3-5 dias)

> **Objetivo**: Expor todas as capacidades do ultra-reader como um servidor MCP (Model Context Protocol),
> permitindo que qualquer AI agent (Claude Code, Cursor, Windsurf, etc.) use o scraper como ferramenta.

### 9.1 — Arquitetura do MCP Server

O MCP server wrapa a API existente (`scrape()`, `crawl()`, `ReaderClient`) sem duplicar lógica.
A camada MCP é puramente uma interface de transporte.

```
┌──────────────────────────────────────────────────────────────────┐
│                         MCP Server                               │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ stdio        │  │ SSE/HTTP     │  │ Streamable HTTP        │  │
│  │ (Claude Code)│  │ (remoto)     │  │ (MCP 2025-03-26)       │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬─────────────┘  │
│         └─────────────────┼─────────────────────┘                │
│                           ▼                                      │
│              ┌────────────────────────┐                           │
│              │    Tool Router         │                           │
│              │  (tool name → handler) │                           │
│              └────────────┬───────────┘                           │
│                           ▼                                      │
│    ┌──────────┬───────────┬──────────┬──────────┬─────────┐      │
│    │ scrape   │ crawl     │ auth     │ analyze  │ config  │      │
│    │ handler  │ handler   │ handler  │ handler  │ handler │      │
│    └────┬─────┘─────┬─────┘────┬─────┘────┬─────┘───┬─────┘      │
│         └───────────┴──────────┴──────────┴─────────┘            │
│                           ▼                                      │
│              ┌────────────────────────┐                           │
│              │   ultra-reader core    │                           │
│              │  (scraper, crawler,    │                           │
│              │   auth, reverse, etc.) │                           │
│              └────────────────────────┘                           │
└──────────────────────────────────────────────────────────────────┘
```

### 9.2 — MCP Tools

#### 9.2.1 — `scrape_url`

Scrape de uma ou mais URLs com opções completas.

```typescript
// src/mcp/tools/scrape.ts

import { z } from "zod";

export const scrapeToolSchema = {
  name: "scrape_url",
  description:
    "Scrape web pages and extract content as clean markdown or HTML. " +
    "Handles Cloudflare challenges, JavaScript rendering, anti-bot evasion, " +
    "and content cleaning automatically. Supports batch scraping of multiple URLs.",
  inputSchema: z.object({
    urls: z.array(z.string().url()).min(1).describe("URLs to scrape"),
    formats: z
      .array(z.enum(["markdown", "html"]))
      .default(["markdown"])
      .describe("Output formats"),
    onlyMainContent: z
      .boolean()
      .default(true)
      .describe("Extract only main content, removing nav/footer/ads"),
    waitForSelector: z.string().optional().describe("CSS selector to wait for before extracting"),
    includePatterns: z.array(z.string()).optional().describe("URL patterns to include (glob)"),
    excludePatterns: z.array(z.string()).optional().describe("URL patterns to exclude (glob)"),
    timeoutMs: z.number().default(30000).describe("Timeout per page in ms"),
    maxRetries: z.number().default(2).describe("Max retry attempts per page"),
    ignoreRobots: z.boolean().default(false).describe("Bypass robots.txt restrictions"),
    useProxy: z.boolean().default(false).describe("Route through configured proxy"),
    headers: z.record(z.string()).optional().describe("Custom HTTP headers to include"),
  }),
};

export async function handleScrape(
  args: z.infer<typeof scrapeToolSchema.inputSchema>,
  client: ReaderClient
): Promise<McpToolResult> {
  const result = await client.scrape({
    urls: args.urls,
    formats: args.formats,
    onlyMainContent: args.onlyMainContent,
    waitForSelector: args.waitForSelector,
    includePatterns: args.includePatterns,
    excludePatterns: args.excludePatterns,
    timeoutMs: args.timeoutMs,
    maxRetries: args.maxRetries,
    respectRobots: !args.ignoreRobots,
    proxy: args.useProxy ? client.getProxyConfig() : undefined,
    headers: args.headers,
  });

  return {
    content: result.pages.map((page) => ({
      type: "text" as const,
      text: formatPageResult(page),
    })),
    isError: result.pages.some((p) => p.error),
  };
}
```

#### 9.2.2 — `crawl_site`

Crawl com descoberta de links.

```typescript
// src/mcp/tools/crawl.ts

export const crawlToolSchema = {
  name: "crawl_site",
  description:
    "Crawl a website starting from a URL, discovering and scraping linked pages. " +
    "Respects depth limits and URL patterns. Returns structured content from all discovered pages.",
  inputSchema: z.object({
    url: z.string().url().describe("Starting URL"),
    maxDepth: z.number().default(2).describe("Maximum crawl depth from starting URL"),
    maxPages: z.number().default(50).describe("Maximum total pages to crawl"),
    includePatterns: z
      .array(z.string())
      .optional()
      .describe("Only crawl URLs matching these glob patterns"),
    excludePatterns: z
      .array(z.string())
      .optional()
      .describe("Skip URLs matching these glob patterns"),
    sameDomainOnly: z.boolean().default(true).describe("Only follow links on the same domain"),
    formats: z.array(z.enum(["markdown", "html"])).default(["markdown"]),
    ignoreRobots: z.boolean().default(false),
  }),
};
```

#### 9.2.3 — `auth_login`

Login OAuth ou API key para providers.

```typescript
// src/mcp/tools/auth.ts

export const authLoginSchema = {
  name: "auth_login",
  description:
    "Authenticate with an OAuth provider (Anthropic, OpenAI, Google) or set an API key. " +
    "OAuth tokens are persisted in the user config file and auto-refreshed. " +
    "Use auth_status to check current authentication state.",
  inputSchema: z.object({
    provider: z
      .enum(["anthropic", "openai", "google", "custom"])
      .describe("Authentication provider"),
    method: z
      .enum(["oauth", "api_key", "token"])
      .describe("Auth method: OAuth flow, direct API key, or raw token"),
    apiKey: z.string().optional().describe("API key (for method=api_key)"),
    token: z.string().optional().describe("Raw bearer token (for method=token)"),
    oauthConfig: z
      .object({
        clientId: z.string().optional(),
        scopes: z.array(z.string()).optional(),
        mode: z
          .enum(["browser", "headless", "manual_url"])
          .default("manual_url")
          .describe(
            "How to handle OAuth: open browser, headless Hero, or return URL for manual auth"
          ),
      })
      .optional()
      .describe("OAuth configuration (for method=oauth)"),
  }),
};

export const authStatusSchema = {
  name: "auth_status",
  description:
    "Check authentication status for all configured providers. " +
    "Returns which providers have valid tokens, expiration times, and refresh capability.",
  inputSchema: z.object({}),
};

export const authLogoutSchema = {
  name: "auth_logout",
  description: "Remove stored credentials for a provider.",
  inputSchema: z.object({
    provider: z
      .enum(["anthropic", "openai", "google", "custom", "all"])
      .describe("Provider to logout from, or 'all'"),
  }),
};
```

#### 9.2.4 — `analyze_antibot`

Detecta proteções anti-bot de um site.

```typescript
// src/mcp/tools/analyze.ts

export const analyzeAntibotSchema = {
  name: "analyze_antibot",
  description:
    "Analyze a website's anti-bot protections without scraping content. " +
    "Detects Cloudflare, Akamai, PerimeterX, DataDome, CAPTCHAs, WAFs, " +
    "request signing, and other protections. Suggests bypass strategies. " +
    "Optionally uses LLM to reverse-engineer JavaScript-based protections.",
  inputSchema: z.object({
    url: z.string().url().describe("URL to analyze"),
    deep: z
      .boolean()
      .default(false)
      .describe("Enable LLM-assisted JS analysis (requires LLM provider auth)"),
    analyzeBundles: z
      .boolean()
      .default(false)
      .describe("Download and analyze JS bundles for signing logic"),
    llmProvider: z
      .enum(["anthropic", "openai", "google"])
      .default("anthropic")
      .describe("LLM provider for deep analysis"),
  }),
};

export async function handleAnalyzeAntibot(
  args: z.infer<typeof analyzeAntibotSchema.inputSchema>,
  client: ReaderClient
): Promise<McpToolResult> {
  const report: AntibotReport = {
    url: args.url,
    timestamp: new Date().toISOString(),
    protections: [],
    suggestedStrategy: [],
  };

  // 1. HTTP probe — detect WAF, challenge headers, status codes
  const httpResult = await client.probeHttp(args.url);
  report.protections.push(...detectWafFromHeaders(httpResult));

  // 2. Browser probe — detect JS challenges, CAPTCHAs
  const browserResult = await client.probeWithHero(args.url);
  report.protections.push(...detectBrowserChallenges(browserResult));

  // 3. Deep analysis — LLM reverse engineering
  if (args.deep) {
    const bundles = await client.downloadBundles(args.url);
    const analysis = await client.reverseEngineer(bundles, args.llmProvider);
    report.protections.push(...analysis.detectedProtections);
    report.signingLogic = analysis.signingLogic;
    report.requestChain = analysis.requestChain;
  }

  // 4. Generate strategy
  report.suggestedStrategy = generateStrategy(report.protections);

  return {
    content: [{ type: "text", text: formatAntibotReport(report) }],
  };
}
```

#### 9.2.5 — `extract_content`

Extrai conteúdo limpo de HTML raw.

```typescript
// src/mcp/tools/extract.ts

export const extractContentSchema = {
  name: "extract_content",
  description:
    "Extract and clean content from raw HTML. Converts to markdown or structured text. " +
    "Removes ads, navigation, footers, and boilerplate. Useful when you already have HTML " +
    "from another source and want clean content extraction.",
  inputSchema: z.object({
    html: z.string().describe("Raw HTML content to extract from"),
    format: z.enum(["markdown", "html"]).default("markdown"),
    onlyMainContent: z.boolean().default(true),
    includeTags: z.array(z.string()).optional(),
    excludeTags: z.array(z.string()).optional(),
  }),
};
```

#### 9.2.6 — `reverse_engineer`

Engenharia reversa de proteções JS.

```typescript
// src/mcp/tools/reverse.ts

export const reverseEngineerSchema = {
  name: "reverse_engineer",
  description:
    "Reverse-engineer a website's JavaScript protections using LLM analysis. " +
    "Identifies token generation, request signing, API call chains, encrypted payloads, " +
    "and WASM challenges. Generates bypass code that can be used in subsequent scrape calls. " +
    "Requires LLM provider authentication (use auth_login first).",
  inputSchema: z.object({
    url: z.string().url().describe("URL to reverse-engineer"),
    targets: z
      .array(
        z.enum([
          "signing_logic",
          "request_chain",
          "wasm_tokens",
          "encrypted_payloads",
          "graphql_hashes",
          "anti_debug",
          "all",
        ])
      )
      .default(["all"])
      .describe("Specific aspects to analyze"),
    llmProvider: z.enum(["anthropic", "openai", "google"]).default("anthropic"),
    cacheResults: z
      .boolean()
      .default(true)
      .describe("Cache analysis results for this domain (24h TTL)"),
  }),
};
```

#### 9.2.7 — `manage_config`

Gerencia configuração do usuário.

```typescript
// src/mcp/tools/config.ts

export const manageConfigSchema = {
  name: "manage_config",
  description:
    "View or modify ultra-reader user configuration. " +
    "Manage proxy settings, default options, domain-specific tokens, and cookies.",
  inputSchema: z.object({
    action: z
      .enum(["get", "set", "delete", "list_domains", "export", "import"])
      .describe("Configuration action"),
    key: z
      .string()
      .optional()
      .describe("Config key path (dot notation: 'proxies.default', 'security.encryption')"),
    value: z.any().optional().describe("Value to set (for action=set)"),
    domain: z.string().optional().describe("Domain for domain-specific operations"),
  }),
};
```

### 9.3 — MCP Resources

Resources expõem dados read-only para o AI agent consultar.

```typescript
// src/mcp/resources.ts

export function registerResources(server: McpServer): void {
  // 1. User config (sanitized — sem secrets)
  server.resource(
    "config",
    "config://user",
    {
      description:
        "Current user configuration (proxies, providers, preferences). " +
        "Sensitive fields are redacted.",
      mimeType: "application/json",
    },
    async (): Promise<ResourceResult> => {
      const config = await UserConfigManager.load();
      return {
        contents: [
          {
            uri: "config://user",
            mimeType: "application/json",
            text: JSON.stringify(config.getSanitized(), null, 2),
          },
        ],
      };
    }
  );

  // 2. Domain analysis cache
  server.resource(
    "analysis-cache",
    new ResourceTemplate("analysis://domain/{domain}", {
      list: async () => {
        const domains = await ReverseCache.listDomains();
        return {
          resources: domains.map((d) => ({
            uri: `analysis://domain/${d.domain}`,
            name: `Analysis: ${d.domain}`,
            description: `Cached anti-bot analysis for ${d.domain} (${d.age})`,
            mimeType: "application/json",
          })),
        };
      },
    }),
    {},
    async (uri, { domain }): Promise<ResourceResult> => {
      const cached = await ReverseCache.get(domain as string);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(cached, null, 2),
          },
        ],
      };
    }
  );

  // 3. Supported providers
  server.resource(
    "providers",
    "providers://list",
    {
      description: "List of supported OAuth/API providers and their auth status",
      mimeType: "application/json",
    },
    async (): Promise<ResourceResult> => {
      const status = await AuthManager.getStatus();
      return {
        contents: [
          {
            uri: "providers://list",
            mimeType: "application/json",
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    }
  );
}
```

### 9.4 — MCP Prompts

Prompts pré-configurados para cenários comuns de scraping.

```typescript
// src/mcp/prompts.ts

export function registerPrompts(server: McpServer): void {
  server.prompt(
    "deep-scrape",
    {
      url: z.string().url().describe("Target URL"),
    },
    ({ url }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Perform a deep scrape of ${url}:`,
              "1. First use analyze_antibot to detect protections",
              "2. If protections are detected, use reverse_engineer to find bypass strategies",
              "3. If auth is needed, use auth_login to authenticate",
              "4. Finally use scrape_url with the appropriate settings",
              "5. Return the clean content",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "crawl-and-extract",
    {
      url: z.string().url(),
      topic: z.string().describe("Topic to focus extraction on"),
    },
    ({ url, topic }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Crawl ${url} and extract all content related to "${topic}":`,
              "1. Use crawl_site to discover pages (maxDepth=3, maxPages=100)",
              "2. Filter pages that are relevant to the topic",
              "3. Use scrape_url on the relevant pages",
              "4. Compile and summarize the extracted content",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "bypass-antibot",
    {
      url: z.string().url(),
    },
    ({ url }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Bypass anti-bot protections on ${url}:`,
              "1. Use analyze_antibot with deep=true to identify all protections",
              "2. Use reverse_engineer to analyze signing logic and request chains",
              "3. Report findings and attempt scrape_url with optimal settings",
              "4. If scraping fails, suggest manual steps needed",
            ].join("\n"),
          },
        },
      ],
    })
  );
}
```

### 9.5 — Server Entry Point e Transports

```typescript
// src/mcp/server.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ReaderClient } from "../client.js";
import { UserConfigManager } from "../config/user-config.js";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

// GAP-03: McpServerOptions type definition
export interface McpServerOptions {
  /** Path to user config file (default: platform-aware ~/.config/ultra-reader/config.json) */
  configPath?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Bind address for HTTP transports (default: "127.0.0.1") */
  host?: string;
}

export async function createMcpServer(options: McpServerOptions = {}): Promise<McpServer> {
  const server = new McpServer({
    name: "ultra-reader",
    version: "0.1.2",
    capabilities: {
      tools: {},
      resources: { listChanged: true },
      prompts: { listChanged: true },
    },
  });

  // Initialize core client
  const config = await UserConfigManager.load(options.configPath);
  const client = new ReaderClient({
    proxy: config.getDefaultProxy(),
    verbose: options.verbose ?? false,
  });

  // Register all capabilities
  registerTools(server, client, config);
  registerResources(server);
  registerPrompts(server);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await client.shutdown();
    await config.save();
    process.exit(0);
  });

  return server;
}

// stdio transport (Claude Code, Cursor, etc.)
export async function startStdio(options: McpServerOptions = {}): Promise<void> {
  const server = await createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// SSE transport (remote access) — SEC-02: bearer token auth middleware
export async function startSSE(
  options: McpServerOptions & { port?: number; authToken?: string } = {}
): Promise<void> {
  const server = await createMcpServer(options);
  const port = options.port ?? 3100;
  const host = options.host ?? "127.0.0.1"; // bind localhost only by default

  const app = express();

  // Bearer token auth middleware (when authToken is set)
  if (options.authToken) {
    app.use((req, res, next) => {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${options.authToken}`) {
        res.status(401).json({ error: "Unauthorized: invalid or missing bearer token" });
        return;
      }
      next();
    });
  }

  app.get("/sse", async (req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    await server.connect(transport);
  });
  app.post("/messages", async (req, res) => {
    // handle messages
  });

  app.listen(port, host, () => {
    console.log(
      `MCP SSE server on ${host}:${port}${options.authToken ? " (auth required)" : " (WARNING: no auth)"}`
    );
  });
}

// Streamable HTTP transport (MCP spec 2025-03-26)
export async function startStreamableHTTP(
  options: McpServerOptions & { port?: number } = {}
): Promise<void> {
  const server = await createMcpServer(options);
  const port = options.port ?? 3100;

  const app = express();
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  app.listen(port);
}
```

### 9.6 — CLI Entry Point

```typescript
// src/cli/mcp.ts — novo subcommand no CLI existente

import { Command } from "commander";

export function registerMcpCommand(program: Command): void {
  const mcp = program.command("mcp").description("Start ultra-reader as an MCP server");

  mcp
    .command("stdio")
    .description("Start MCP server with stdio transport (for Claude Code, Cursor)")
    .option("--config <path>", "Path to user config file")
    .option("--verbose", "Enable verbose logging to stderr")
    .action(async (opts) => {
      const { startStdio } = await import("../mcp/server.js");
      await startStdio({ configPath: opts.config, verbose: opts.verbose });
    });

  mcp
    .command("sse")
    .description("Start MCP server with SSE transport (for remote access)")
    .option("--port <number>", "Port to listen on", "3100")
    .option("--config <path>", "Path to user config file")
    .action(async (opts) => {
      const { startSSE } = await import("../mcp/server.js");
      await startSSE({ port: parseInt(opts.port), configPath: opts.config });
    });

  mcp
    .command("http")
    .description("Start MCP server with Streamable HTTP transport (MCP 2025-03-26)")
    .option("--port <number>", "Port to listen on", "3100")
    .option("--config <path>", "Path to user config file")
    .action(async (opts) => {
      const { startStreamableHTTP } = await import("../mcp/server.js");
      await startStreamableHTTP({ port: parseInt(opts.port), configPath: opts.config });
    });
}
```

### 9.7 — Configuração para AI Clients

#### Claude Code (`~/.claude.json`):

```json
{
  "mcpServers": {
    "ultra-reader": {
      "command": "npx",
      "args": ["@vakra-dev/reader", "mcp", "stdio"],
      "env": {
        "ULTRA_READER_CONFIG_PATH": "~/.config/ultra-reader/config.json"
      }
    }
  }
}
```

#### Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "ultra-reader": {
      "command": "npx",
      "args": ["@vakra-dev/reader", "mcp", "stdio"]
    }
  }
}
```

#### Remote (SSE):

```json
{
  "mcpServers": {
    "ultra-reader": {
      "url": "http://localhost:3100/sse"
    }
  }
}
```

### 9.8 — Testes Necessários

| Teste                            | Tipo        | Descrição                                                        |
| -------------------------------- | ----------- | ---------------------------------------------------------------- |
| Tool registration                | Unit        | Todos os 7 tools registrados com schemas válidos                 |
| scrape_url single page           | Integration | Scrape uma URL e retorna markdown                                |
| scrape_url batch                 | Integration | Scrape 3 URLs em paralelo                                        |
| crawl_site depth control         | Integration | Crawl com maxDepth=1 respeita limite                             |
| auth_login api_key               | Unit        | Salva API key no config                                          |
| auth_login oauth manual_url      | Unit        | Retorna URL para auth manual                                     |
| auth_status                      | Unit        | Retorna status de todos os providers                             |
| analyze_antibot basic            | Integration | Detecta Cloudflare em site com CF                                |
| analyze_antibot deep             | Integration | LLM analysis produz relatório                                    |
| reverse_engineer signing         | Integration | Extrai signing logic de JS                                       |
| extract_content markdown         | Unit        | HTML → markdown limpo                                            |
| manage_config CRUD               | Unit        | get/set/delete/list operations                                   |
| Resource config://user           | Unit        | Retorna config sanitizado (sem secrets)                          |
| Resource analysis://domain       | Unit        | Retorna cache de análise                                         |
| Prompt deep-scrape               | Unit        | Gera prompt com URL interpolada                                  |
| stdio transport                  | Integration | Server inicia e responde a initialize                            |
| SSE transport                    | Integration | Server aceita conexão SSE e processa requests                    |
| Streamable HTTP transport        | Integration | POST /mcp funciona com session management                        |
| Error propagation                | Unit        | Erros do scraper mapeados para McpError                          |
| Graceful shutdown                | Integration | SIGINT salva config e fecha conexões                             |
| Concurrent tool calls            | Integration | 3 scrape_url simultâneos não interferem                          |
| Auth persistence across restarts | Integration | Login → restart server → auth_status mostra provider autenticado |

---

## Resumo de Dependências

### Novas dependências NPM

| Pacote                        | Phase | Uso                                                                                          | Opcional?                            |
| ----------------------------- | ----- | -------------------------------------------------------------------------------------------- | ------------------------------------ |
| —                             | 1.x   | Nenhuma nova dependência                                                                     | —                                    |
| `2captcha` ou HTTP API direto | 2.1   | CAPTCHA solving                                                                              | Sim (opt-in via config)              |
| `undici`                      | 3.3   | HTTP/2 fingerprint control                                                                   | Sim (alternativa ao fetch)           |
| `open`                        | 7.3   | Abrir browser para OAuth flow                                                                | Sim (apenas modo interativo)         |
| `isolated-vm`                 | 8.7   | Sandbox seguro para execução de código transplantado (vm2 DEPRECATED — CVE-2023-37466/37903) | Sim (apenas com reverse engineering) |
| `@anthropic-ai/sdk`           | 8.11  | LLM client para Anthropic                                                                    | Sim (um dos 3 providers)             |
| `openai`                      | 8.11  | LLM client para OpenAI                                                                       | Sim (um dos 3 providers)             |
| `@google/generative-ai`       | 8.11  | LLM client para Google Gemini                                                                | Sim (um dos 3 providers)             |
| `@modelcontextprotocol/sdk`   | 9.x   | MCP server SDK (tools, resources, prompts)                                                   | Sim (apenas modo MCP)                |
| `zod`                         | 9.x   | Schema validation para inputs das MCP tools                                                  | Sim (apenas modo MCP)                |
| `express`                     | 9.5   | HTTP server para SSE e Streamable HTTP                                                       | Sim (apenas transport HTTP/SSE)      |
| `eventsource`                 | 9.8   | SSE client para testes de integração                                                         | Dev only                             |

### Novos arquivos a criar

| Arquivo                                 | Phase  | Linhas estimadas |
| --------------------------------------- | ------ | ---------------- |
| `src/utils/user-agents.ts`              | 1.2    | ~80              |
| `src/discovery/well-known-paths.ts`     | 1.5.1  | ~60              |
| `src/discovery/sitemap-parser.ts`       | 1.5.2  | ~180             |
| `src/discovery/openapi-prober.ts`       | 1.5.3  | ~200             |
| `src/discovery/graphql-introspect.ts`   | 1.5.4  | ~120             |
| `src/discovery/api-interceptor.ts`      | 1.5.5  | ~150             |
| `src/discovery/endpoint-profiler.ts`    | 1.5.6  | ~200             |
| `src/discovery/site-profile.ts`         | 1.5.7  | ~100             |
| `src/discovery/index.ts`                | 1.5.8  | ~30              |
| `src/engines/engine-affinity.ts`        | 1.5.11 | ~180             |
| `src/engines/circuit-breaker.ts`        | 1.5.12 | ~120             |
| `src/utils/geo-locale.ts`               | 1.5.13 | ~150             |
| `src/utils/content-validator.ts`        | 5.4    | ~180             |
| `src/utils/header-order.ts`             | 3.4    | ~120             |
| `src/utils/request-chain.ts`            | 3.5    | ~150             |
| `src/browser/profile-manager.ts`        | 3.6    | ~200             |
| `src/utils/dns-resolver.ts`             | 6.3    | ~120             |
| `src/utils/behavior-simulator.ts`       | 2.2    | ~150             |
| `src/utils/honeypot-detector.ts`        | 2.3    | ~60              |
| `src/utils/page-interaction.ts`         | 2.4    | ~100             |
| `src/utils/fingerprint-profiles.ts`     | 2.5    | ~80              |
| `src/utils/poison-detector.ts`          | 5.1    | ~200             |
| `src/captcha/types.ts`                  | 2.1    | ~120             |
| `src/captcha/solver.ts`                 | 2.1    | ~40              |
| `src/captcha/base-provider.ts`          | 2.1    | ~150             |
| `src/captcha/capsolver.ts`              | 2.1    | ~180             |
| `src/captcha/two-captcha.ts`            | 2.1    | ~150             |
| `src/captcha/anti-captcha.ts`           | 2.1    | ~150             |
| `src/captcha/multi-provider.ts`         | 2.1    | ~80              |
| `src/captcha/site-key-extractor.ts`     | 2.1    | ~120             |
| `src/captcha/index.ts`                  | 2.1    | ~15              |
| `src/waf/detector.ts`                   | 3.1    | ~150             |
| `src/waf/akamai.ts`                     | 3.1    | ~100             |
| `src/waf/perimeterx.ts`                 | 3.1    | ~80              |
| `src/waf/datadome.ts`                   | 3.1    | ~80              |
| `src/waf/kasada.ts`                     | 3.1    | ~80              |
| `src/waf/types.ts`                      | 3.1    | ~30              |
| `src/waf/index.ts`                      | 3.1    | ~10              |
| `src/auth/jwt-extractor.ts`             | 7.1    | ~250             |
| `src/auth/ai-secret-discovery.ts`       | 7.2    | ~200             |
| `src/auth/oauth/types.ts`               | 7.3    | ~80              |
| `src/auth/oauth/provider.ts`            | 7.3    | ~150             |
| `src/auth/oauth/anthropic.ts`           | 7.3    | ~180             |
| `src/auth/oauth/openai.ts`              | 7.3    | ~120             |
| `src/auth/oauth/google.ts`              | 7.3    | ~120             |
| `src/auth/oauth/generic.ts`             | 7.3    | ~200             |
| `src/config/user-config.ts`             | 7.3    | ~300             |
| `src/config/config-schema.ts`           | 7.3    | ~50              |
| `src/config/crypto.ts`                  | 7.3    | ~60              |
| `src/config/index.ts`                   | 7.3    | ~10              |
| `src/auth/oauth/index.ts`               | 7.3    | ~10              |
| `src/reverse/bundle-analyzer.ts`        | 8.1    | ~350             |
| `src/reverse/signing-extractor.ts`      | 8.2    | ~300             |
| `src/reverse/chain-mapper.ts`           | 8.3    | ~250             |
| `src/reverse/wasm-interceptor.ts`       | 8.4    | ~200             |
| `src/reverse/polymorphic-normalizer.ts` | 8.5    | ~200             |
| `src/reverse/anti-debug-patcher.ts`     | 8.6    | ~150             |
| `src/reverse/code-transplanter.ts`      | 8.7    | ~250             |
| `src/reverse/payload-reverser.ts`       | 8.8    | ~200             |
| `src/reverse/behavior-generator.ts`     | 8.9    | ~200             |
| `src/reverse/graphql-extractor.ts`      | 8.10   | ~150             |
| `src/reverse/llm-client.ts`             | 8.11   | ~200             |
| `src/reverse/orchestrator.ts`           | 8.12   | ~300             |
| `src/reverse/index.ts`                  | 8.x    | ~20              |
| `src/mcp/server.ts`                     | 9.1    | ~250             |
| `src/mcp/tools/scrape.ts`               | 9.2    | ~150             |
| `src/mcp/tools/crawl.ts`                | 9.2    | ~100             |
| `src/mcp/tools/auth.ts`                 | 9.2    | ~120             |
| `src/mcp/tools/analyze.ts`              | 9.2    | ~100             |
| `src/mcp/tools/extract.ts`              | 9.2    | ~60              |
| `src/mcp/tools/reverse.ts`              | 9.2    | ~100             |
| `src/mcp/tools/config.ts`               | 9.2    | ~80              |
| `src/mcp/tools/index.ts`                | 9.2    | ~20              |
| `src/mcp/resources.ts`                  | 9.3    | ~120             |
| `src/mcp/prompts.ts`                    | 9.4    | ~100             |
| `src/mcp/types.ts`                      | 9.x    | ~40              |
| `src/mcp/index.ts`                      | 9.x    | ~10              |
| `src/cli/mcp.ts`                        | 9.6    | ~60              |

### Arquivos existentes a modificar

| Arquivo                          | Phases                                                            | Mudanças                                                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`                   | 1.1-6.2, 8.13                                                     | +15 novos campos em ScrapeOptions, +reverseEngineering options, +crossEngineVerify, +discovery, +geoConsistency                                                        |
| `src/scraper.ts`                 | 1.1, 1.4, 5.1, 5.4, 7.3                                           | Condicionar robots, jitter, poison detection, content validation, auto-load UserConfig, inject tokens/cookies, persist extracted tokens                                |
| `src/crawler.ts`                 | 1.1, 1.5, 2.3                                                     | Condicionar robots, API discovery integration, filtrar honeypots                                                                                                       |
| `src/engines/http/index.ts`      | 1.2, 1.3, 1.5.13, 3.1, 3.4, 3.5                                   | UA rotation, Referer, geo-consistent headers, WAF patterns, header order, resource prefetch                                                                            |
| `src/engines/tlsclient/index.ts` | 1.2, 1.5.13, 3.1, 3.2, 3.4                                        | UA rotation, geo-consistent headers, WAF patterns, cookies, header order                                                                                               |
| `src/engines/hero/index.ts`      | 1.5.5, 2.1, 2.2, 2.4, 3.2, 3.6, 5.2, 5.3, 7.1, 7.3, 8.4, 8.6, 8.9 | API interception, CAPTCHA, behavior, scroll, cookies, profile persistence, shadow DOM, token extraction, OAuth login, WASM interceptor, anti-debug, behavior injection |
| `src/engines/orchestrator.ts`    | 1.5.9, 1.5.11, 1.5.12, 3.1, 5.4, 7.4, 8.13                        | Discovery integration, engine affinity cache, circuit breaker, WAF detection, content validation, token injection + 401 retry, reverse engineering trigger             |
| `src/browser/hero-config.ts`     | 1.5.13, 2.5, 3.6                                                  | Geo-consistent locale/timezone, fingerprint rotation, profile persistence config                                                                                       |
| `src/browser/pool.ts`            | 3.6                                                               | Profile-aware recycling, persistent profile storage                                                                                                                    |
| `src/utils/rate-limiter.ts`      | 1.4, 6.2                                                          | Jitter, per-endpoint limiting                                                                                                                                          |
| `src/utils/robots-parser.ts`     | 6.1                                                               | Meta robots parsing                                                                                                                                                    |
| `src/utils/content-cleaner.ts`   | 2.3                                                               | Honeypot removal                                                                                                                                                       |
| `src/engines/errors.ts`          | 3.1, 5.1, 5.4, 6.2                                                | WafBlockedError, ContentPoisoningError, SoftBlockError, RateLimitedError, CircuitBreakerOpenError                                                                      |
| `src/proxy/config.ts`            | 1.5.13                                                            | extractProxyCountry helper, geo metadata extraction                                                                                                                    |
| `src/cli/index.ts`               | 1.1, 1.2, 7.4, 8.13, 9.6                                          | --ignore-robots, --rotate-ua, auth subcommands, --config, --reverse-engineer, --re-\* flags, `mcp` subcommand (stdio, sse, http)                                       |
| `src/index.ts`                   | 1.5, 9.x                                                          | Re-export discovery, MCP server e types                                                                                                                                |
| `package.json`                   | 9.x                                                               | Adicionar bin `reader-mcp` → `dist/cli/mcp.js`, peer deps MCP SDK                                                                                                      |
| `tsconfig.json`                  | 9.x                                                               | Include `src/mcp/` no build                                                                                                                                            |

---

## Risk Assessment

| Risk                                | Probability | Impact  | Mitigation                                                                   |
| ----------------------------------- | ----------- | ------- | ---------------------------------------------------------------------------- |
| CAPTCHA service costs               | Alta        | Médio   | Rate limit CAPTCHA solving, cache tokens                                     |
| Hero desatualizar vs Chrome         | Média       | Alto    | Monitorar releases @ulixee/hero, atualizar trimestralmente                   |
| WAF patterns mudam frequentemente   | Alta        | Alto    | Manter patterns em config separado, atualizar mensalmente                    |
| Behavioral simulation detectada     | Média       | Médio   | Usar Hero's built-in human emulation, adicionar randomness                   |
| UA list desatualiza                 | Alta        | Baixo   | Script automático para fetch UAs do mercado                                  |
| Proxy pool exaure                   | Média       | Alto    | Circuit breaker, fallback para engines sem proxy                             |
| Legal/ToS issues com bypass         | Alta        | Alto    | Documentar que compliance é responsabilidade do usuário                      |
| OAuth client IDs revogados          | Média       | Alto    | Suportar client ID customizado, fallback para API key                        |
| AI discovery custo de tokens LLM    | Alta        | Baixo   | Usar modelos baratos (haiku/gpt-4o-mini), cache resultados                   |
| Config file comprometido            | Baixa       | Alto    | Encriptação AES-256-GCM, permissões 0600, machine-bound key                  |
| Config file corrompido              | Baixa       | Médio   | Backup automático antes de cada save, validação JSON Schema                  |
| Providers mudam endpoints OAuth     | Média       | Médio   | Config externalizável, atualização sem rebuild                               |
| LLM hallucina signing logic         | Média       | Alto    | Validar token gerado contra server real, retry com modelo diferente          |
| VM sandbox escape (isolated-vm)     | Muito Baixa | Crítico | Limitar memória (64MB), timeout (5s), sem acesso a process/require           |
| WASM hook detectado pelo site       | Média       | Médio   | Hook sutil via Proxy, fallback para execução direta no Hero                  |
| Custo LLM acumula em análises       | Alta        | Médio   | Cache agressivo por domínio, TTL de 24h, modelos econômicos                  |
| Code transplant falha em runtime    | Alta        | Médio   | Loop LLM: erro → fix → retry (máx 3 tentativas)                              |
| Site muda bundle entre deploys      | Alta        | Alto    | Re-análise automática quando token falha (cache invalidation)                |
| Polymorphic JS muda a cada request  | Média       | Alto    | Multi-sample normalization, fallback para execução in-browser                |
| MCP SDK breaking changes            | Baixa       | Médio   | Pin version, acompanhar spec releases                                        |
| Tool timeout em scrapes longos      | Média       | Médio   | Progress notifications via MCP, streaming parcial                            |
| SSE transport exposto sem auth      | Baixa       | Alto    | Bearer token middleware (SEC-02), bind 127.0.0.1, warning sem auth           |
| Concurrent MCP calls memory leak    | Baixa       | Alto    | Pool limit, graceful shutdown, health checks                                 |
| Affinity cache stale data           | Média       | Médio   | TTL de 24h, invalidação automática quando engine falha após sucesso anterior |
| Circuit breaker false positive      | Baixa       | Médio   | Half-open state permite retry controlado, reset manual via API               |
| Geo-locale mismatch detectado       | Média       | Médio   | Fallback para en-US quando proxy geo desconhecido, validação pre-flight      |
| Soft-block passa como conteúdo real | Alta        | Alto    | Cross-engine verify, pattern updates, semantic density check                 |
| Header order detectable por WAF     | Média       | Alto    | Manter perfis de header order atualizados com Chrome/Firefox releases        |
| Request chain incompleta detectada  | Média       | Médio   | Prefetch seletivo (CSS/JS only), fallback para Hero se detectado             |
| Browser profile poisoned/leaked     | Baixa       | Alto    | Rotação de profiles, isolamento por domínio, wipe periódico                  |
| DNS resolver bloqueado              | Baixa       | Baixo   | Fallback chain (DoH Google → CF → Quad9 → system), cache TTL                 |
| TLS fingerprint rotation detectada  | Média       | Médio   | Usar apenas fingerprints de browsers reais (Chrome, Firefox), não inventar   |

---

## Timeline Estimada

| Phase                            | Duração    | Pré-requisitos    | Prioridade                       |
| -------------------------------- | ---------- | ----------------- | -------------------------------- |
| **Phase 1** — Quick Wins         | 2-3 dias   | Nenhum            | 🔴 Fazer primeiro                |
| **Phase 1.5** — API Discovery    | 4-7 dias   | Phase 1           | 🔴 Alto ROI, evita anti-bot      |
| **Phase 2** — Core Anti-Bot      | 5-8 dias   | Phase 1 (parcial) | 🔴 Fazer segundo                 |
| **Phase 3** — Advanced Evasion   | 10-15 dias | Phase 2           | 🟡 Fazer em seguida              |
| **Phase 4** — Enterprise WAFs    | 7-13 dias  | Phase 3           | 🟡 Sob demanda                   |
| **Phase 5** — Content Integrity  | 6-9 dias   | Phase 1           | 🔴 Fazer em paralelo com Phase 2 |
| **Phase 6** — Hardening          | 4-6 dias   | Phase 1           | 🟢 Quando possível               |
| **Phase 7** — JWT/OAuth/AI Auth  | 7-10 dias  | Phase 1, Phase 2  | 🔴 Crítico para sites com auth   |
| **Phase 8** — LLM Dynamic Bypass | 10-16 dias | Phase 2, Phase 7  | 🟡 Diferencial competitivo       |
| **Phase 9** — MCP Server         | 4-7 dias   | Phase 1, Phase 7  | 🔴 Habilita uso por AI agents    |

**Total estimado: 58-93 dias de desenvolvimento** _(ajustado +30% conforme recomendação QA, inclui Phase 1.5 API Discovery, header order fingerprinting, request chain mimicry, browser profile persistence, soft-block detection, circuit breaker, geo-consistency, DNS strategies, TLS fingerprint rotation)_
