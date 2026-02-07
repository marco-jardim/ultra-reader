<p align="center">
  <img src="docs/assets/logo.png" alt="Ultra Reader Logo" width="200" />
</p>

<h1 align="center">Ultra Reader</h1>

<p align="center">
  <strong>Power scraping engine for AI agents — bypass anti-bot, discover APIs, extract everything.</strong>
</p>

<p align="center">
  Forked from <a href="https://github.com/vakra-dev/reader">vakra-dev/reader</a> by Nihal Kaul. Extended by <a href="https://github.com/marco-jardim">Marco Jardim</a>.
</p>

<p align="center">
  <a href="https://www.gnu.org/licenses/gpl-3.0"><img src="https://img.shields.io/badge/License-GPLv3-blue.svg" alt="License: GPL v3"></a>
  <a href="https://www.npmjs.com/package/@vakra-dev/reader"><img src="https://img.shields.io/npm/v/@vakra-dev/reader.svg" alt="npm version"></a>
  <a href="https://github.com/marco-jardim/ultra-reader/stargazers"><img src="https://img.shields.io/github/stars/marco-jardim/ultra-reader.svg?style=social" alt="GitHub stars"></a>
  <a href="https://github.com/marco-jardim/ultra-reader/actions"><img src="https://img.shields.io/github/actions/workflow/status/marco-jardim/ultra-reader/ci.yml?branch=main&label=CI" alt="CI"></a>
</p>

<p align="center">
  <img src="./docs/assets/demo.gif" alt="Ultra Reader demo — scrape any URL to clean markdown" width="700" />
</p>

---

## What Is Ultra Reader?

Ultra Reader is a **power scraping SDK** built for AI agents and data pipelines. It goes beyond simple HTML-to-markdown conversion: it bypasses anti-bot protections, discovers hidden APIs, extracts structured data, and delivers clean output ready for LLMs.

**What makes it different from the upstream Reader:**

| Capability                               | Reader (upstream) | Ultra Reader (this fork)                                                    |
| ---------------------------------------- | ----------------- | --------------------------------------------------------------------------- |
| HTML → Markdown                          | Yes               | Yes                                                                         |
| 3-Engine cascade (HTTP → TLS → Chromium) | Yes               | Yes                                                                         |
| Anti-bot evasion (44 mechanisms)         | Basic             | **Active mitigation** — UA rotation, referer spoofing, jitter, client hints |
| API Discovery                            | No                | **Yes** — sitemap, Swagger/OpenAPI, GraphQL, endpoint mapping               |
| CAPTCHA solving                          | No                | **Planned** — 2Captcha, Anti-Captcha, CapSolver                             |
| Enterprise WAF bypass                    | No                | **Planned** — Akamai, PerimeterX, DataDome, Kasada                          |
| MCP Server for AI agents                 | No                | **Planned** — stdio/SSE/HTTP transports                                     |
| JWT/OAuth extraction                     | No                | **Planned** — token discovery, OAuth flows, session replay                  |
| LLM-assisted reverse engineering         | No                | **Planned** — JS deobfuscation, signing extraction                          |
| Circuit breaker + adaptive engines       | No                | **Planned** — per-domain failure tracking, engine affinity cache            |

## Installation

```bash
npm install @vakra-dev/reader
```

**Requirements:** Node.js >= 18

## SDK Reference

### Quick Start

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient();

// Scrape → clean markdown
const result = await reader.scrape({ urls: ["https://example.com"] });
console.log(result.data[0].markdown);

// Crawl → discover + scrape pages
const pages = await reader.crawl({
  url: "https://example.com",
  depth: 2,
  scrape: true,
});
console.log(`Found ${pages.urls.length} pages`);

await reader.close();
```

### `ReaderClient`

The main entry point. Manages browser lifecycle, proxy rotation, and engine orchestration.

```typescript
const reader = new ReaderClient({
  verbose: true,
  showChrome: false, // Show browser window for debugging
  proxies: [
    // Proxy rotation pool
    { host: "proxy1.example.com", port: 8080, username: "user", password: "pass" },
    { host: "proxy2.example.com", port: 8080, username: "user", password: "pass" },
  ],
  proxyRotation: "round-robin", // or 'random'
  browserPool: {
    size: 5, // Browser instances in pool
    retireAfterPages: 50, // Recycle after N page loads
    retireAfterMinutes: 15, // Recycle after N minutes
    maxQueueSize: 100, // Max pending requests
  },
});
```

| Method            | Returns                 | Description                        |
| ----------------- | ----------------------- | ---------------------------------- |
| `scrape(options)` | `Promise<ScrapeResult>` | Scrape one or more URLs            |
| `crawl(options)`  | `Promise<CrawlResult>`  | Crawl a website to discover pages  |
| `start()`         | `Promise<void>`         | Pre-initialize HeroCore (optional) |
| `isReady()`       | `boolean`               | Check if client is initialized     |
| `close()`         | `Promise<void>`         | Close client and release resources |

### `scrape(options)`

```typescript
const result = await reader.scrape({
  urls: ["https://example.com", "https://example.org"],
  formats: ["markdown", "html"], // Output formats
  onlyMainContent: true, // Strip nav/header/footer (default: true)
  includeTags: ["article", ".content"], // CSS selectors to keep
  excludeTags: [".ads", ".sidebar"], // CSS selectors to remove
  batchConcurrency: 3, // Parallel URL processing
  batchTimeoutMs: 300000, // Total batch timeout
  maxRetries: 2, // Retry attempts per URL
  timeoutMs: 30000, // Per-request timeout

  // Anti-bot options (Phase 1)
  respectRobots: false, // Skip robots.txt checks (default: true)
  userAgent: "custom-ua", // Override rotated UA
  spoofReferer: true, // Google/Bing referer (default: true)
  uaRotation: "weighted", // 'random' | 'round-robin' | 'weighted'
  stickyUaPerDomain: true, // Same UA per domain across requests

  // Proxy per-request
  proxy: {
    type: "residential",
    host: "proxy.example.com",
    port: 8080,
    username: "user",
    password: "pass",
    country: "us",
  },

  // API discovery (Phase 1.5)
  discovery: true,
  discoveryOptions: {
    // Optional: override discovery networking. If omitted, discovery will inherit
    // `proxy`, `headers`, and `userAgent` from the scrape options.
    network: {
      proxyUrl: "http://user:pass@proxy.example.com:8080",
      headers: { "x-client": "ultra-reader" },
      userAgent: "custom-ua",
    },
    parseSitemaps: true,
    discoverOpenApi: true,
    introspectGraphQL: true,
    profileEndpoints: true,
    interceptApiRequests: false, // when true and Hero runs, request/response data is cached
    apiInterceptorOptions: {
      maxCapturedRequests: 200,
      maxResponseSize: 262144,
    },
  },

  // Progress tracking
  onProgress: ({ completed, total, currentUrl }) => {
    console.log(`${completed}/${total}: ${currentUrl}`);
  },

  // Browser control
  showChrome: false,
  waitForSelector: "#content", // Wait for element before extracting
  verbose: true,
});
```

**Returns:** `ScrapeResult`

```typescript
interface ScrapeResult {
  data: WebsiteScrapeResult[];
  batchMetadata: {
    totalUrls: number;
    successfulUrls: number;
    failedUrls: number;
    scrapedAt: string;
    totalDuration: number;
    errors?: Array<{ url: string; error: string }>;
  };
}

interface WebsiteScrapeResult {
  markdown?: string;
  html?: string;
  metadata: {
    baseUrl: string;
    totalPages: number;
    scrapedAt: string;
    duration: number;
    website: WebsiteMetadata;
    siteProfile?: SiteProfile; // Phase 1.5 discovery output (if enabled)
  };
}
```

### Discovery (Phase 1.5)

When `discovery: true` is set on `scrape(options)`, Ultra Reader runs a per-domain discovery pass before scraping and attaches results to `WebsiteScrapeResult.metadata.siteProfile`.

- Signals: sitemap discovery, OpenAPI/Swagger probing, GraphQL introspection, endpoint profiling.
- Cache: profiles are cached per-domain under `~/.ultra-reader/profiles`.
- Network consistency: discovery requests can be routed through a proxy via `discoveryOptions.network.proxyUrl`.
- Note on interception: if `discoveryOptions.interceptApiRequests: true` and the Hero engine runs, Ultra Reader captures and persists raw request/response headers (and optionally JSON bodies, bounded by size limits) into the cached `siteProfile`.

### `crawl(options)`

```typescript
const result = await reader.crawl({
  url: "https://example.com",
  depth: 2, // Max crawl depth
  maxPages: 50, // Max pages to discover
  scrape: true, // Scrape content of discovered pages
  formats: ["markdown", "html"],
  scrapeConcurrency: 3, // Parallel scraping
  delayMs: 1000, // Delay between requests
  includePatterns: ["blog/*"], // URL patterns to include (regex)
  excludePatterns: ["admin/*"], // URL patterns to exclude (regex)
});

console.log(`Discovered ${result.urls.length} URLs`);
console.log(`Scraped ${result.scraped?.batchMetadata.successfulUrls} pages`);
```

**Returns:** `CrawlResult`

```typescript
interface CrawlResult {
  urls: Array<{ url: string; title: string; description: string | null }>;
  scraped?: ScrapeResult;
  metadata: {
    totalUrls: number;
    maxDepth: number;
    totalDuration: number;
    seedUrl: string;
  };
}
```

### Proxy Configuration

```typescript
interface ProxyConfig {
  url?: string; // Full proxy URL (takes precedence)
  type?: "datacenter" | "residential";
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  country?: string; // For residential proxies ('us', 'uk', etc.)
}
```

### Browser Pool (Direct Access)

```typescript
import { BrowserPool } from "@vakra-dev/reader";

const pool = new BrowserPool({ size: 5 });
await pool.initialize();

const title = await pool.withBrowser(async (hero) => {
  await hero.goto("https://example.com");
  return await hero.document.title;
});

const health = await pool.healthCheck();
console.log(`Pool healthy: ${health.healthy}`);

await pool.shutdown();
```

### Cloudflare Challenge Detection

```typescript
import { detectChallenge, waitForChallengeResolution } from "@vakra-dev/reader";

const detection = await detectChallenge(hero);
if (detection.isChallenge) {
  console.log(`Challenge detected: ${detection.type}`);
  const result = await waitForChallengeResolution(hero, {
    maxWaitMs: 45000,
    pollIntervalMs: 500,
    initialUrl: await hero.url,
  });
  if (result.resolved) {
    console.log(`Resolved via ${result.method} in ${result.waitedMs}ms`);
  }
}
```

### Shared Hero Core (Production)

For production servers, share a single Hero Core across all requests:

```typescript
import HeroCore from "@ulixee/hero-core";
import { TransportBridge } from "@ulixee/net";
import { ConnectionToHeroCore } from "@ulixee/hero";
import { scrape } from "@vakra-dev/reader";

const heroCore = new HeroCore();
await heroCore.start();

function createConnection() {
  const bridge = new TransportBridge();
  heroCore.addConnection(bridge.transportToClient);
  return new ConnectionToHeroCore(bridge.transportToCore);
}

const result = await scrape({
  urls: ["https://example.com"],
  connectionToCore: createConnection(),
});

await heroCore.close();
```

## CLI

### Daemon Mode

```bash
npx reader start --pool-size 5    # Start daemon with browser pool
npx reader scrape https://example.com  # Auto-connects to daemon
npx reader crawl https://example.com -d 2
npx reader status                 # Check daemon status
npx reader stop                   # Stop daemon
npx reader scrape https://example.com --standalone  # Force standalone
```

### `reader scrape <urls...>`

```bash
npx reader scrape https://example.com
npx reader scrape https://example.com -f markdown,html
npx reader scrape https://example.com https://example.org -c 2
npx reader scrape https://example.com -o output.md
```

| Option                   | Type   | Default      | Description                      |
| ------------------------ | ------ | ------------ | -------------------------------- |
| `-f, --format <formats>` | string | `"markdown"` | Output formats (comma-separated) |
| `-o, --output <file>`    | string | stdout       | Output file path                 |
| `-c, --concurrency <n>`  | number | `1`          | Parallel requests                |
| `-t, --timeout <ms>`     | number | `30000`      | Request timeout                  |
| `--batch-timeout <ms>`   | number | `300000`     | Total batch timeout              |
| `--proxy <url>`          | string | -            | Proxy URL                        |
| `--user-agent <string>`  | string | -            | Custom user agent                |
| `--show-chrome`          | flag   | -            | Show browser window              |
| `--no-main-content`      | flag   | -            | Disable main content extraction  |
| `--include-tags <sel>`   | string | -            | CSS selectors to include         |
| `--exclude-tags <sel>`   | string | -            | CSS selectors to exclude         |
| `-v, --verbose`          | flag   | -            | Verbose logging                  |

### `reader crawl <url>`

```bash
npx reader crawl https://example.com
npx reader crawl https://example.com -d 3 -m 50
npx reader crawl https://example.com -d 2 --scrape
npx reader crawl https://example.com --include "blog/*" --exclude "admin/*"
```

| Option                   | Type   | Default      | Description                        |
| ------------------------ | ------ | ------------ | ---------------------------------- |
| `-d, --depth <n>`        | number | `1`          | Maximum crawl depth                |
| `-m, --max-pages <n>`    | number | `20`         | Maximum pages to discover          |
| `-s, --scrape`           | flag   | -            | Scrape content of discovered pages |
| `-f, --format <formats>` | string | `"markdown"` | Output formats                     |
| `-o, --output <file>`    | string | stdout       | Output file path                   |
| `--delay <ms>`           | number | `1000`       | Delay between requests             |
| `-t, --timeout <ms>`     | number | -            | Total crawl timeout                |
| `--include <patterns>`   | string | -            | URL patterns to include            |
| `--exclude <patterns>`   | string | -            | URL patterns to exclude            |
| `--proxy <url>`          | string | -            | Proxy URL                          |
| `--user-agent <string>`  | string | -            | Custom user agent                  |
| `--show-chrome`          | flag   | -            | Show browser window                |
| `-v, --verbose`          | flag   | -            | Verbose logging                    |

## Anti-Bot Evasion

Ultra Reader implements a layered defense against 44 known anti-bot mechanisms. The 3-engine cascade (HTTP -> TLS Client -> Chromium) automatically escalates when simpler engines are blocked.

### Implemented

| Mechanism                   | How                                                                       |
| --------------------------- | ------------------------------------------------------------------------- |
| **robots.txt**              | Full parser with wildcards, `$` anchors. `respectRobots: false` to bypass |
| **IP rate limiting**        | Configurable delay, jitter (uniform/gaussian/exponential), backoff        |
| **IP reputation**           | Datacenter + residential proxies, round-robin/random rotation             |
| **Geo-blocking**            | Residential proxies with `country` param                                  |
| **TLS fingerprinting**      | Hero emulates Chrome TLS; `got-scraping` emulates browser TLS             |
| **TCP fingerprinting**      | Hero uses real Chromium TCP stack                                         |
| **DNS leak detection**      | DNS over TLS via Cloudflare (1.1.1.1)                                     |
| **User-Agent filtering**    | 18 modern UAs, 3 rotation strategies, domain-sticky, client hints         |
| **Header consistency**      | Full Sec-Fetch-\* headers, Sec-CH-UA client hints                         |
| **Referer validation**      | Auto-generated Google/Bing search referers                                |
| **Cloudflare JS Challenge** | Multi-signal DOM + text detection, polling resolution                     |
| **Cloudflare Turnstile**    | Managed mode auto-resolved via Hero                                       |
| **Browser fingerprinting**  | Hero emulates Canvas, WebGL, Audio, Navigator, WebRTC                     |
| **Timing attacks**          | Jitter with 3 distributions, configurable min/max                         |

### Planned (Phases 2-8)

| Phase   | Scope                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------- |
| **1.5** | API Discovery — sitemap, Swagger/OpenAPI, endpoint mapping, circuit breaker, adaptive engines  |
| **2**   | CAPTCHA solving (2Captcha, Anti-Captcha, CapSolver), behavioral simulation, honeypot detection |
| **3**   | WAF detection framework, header order fingerprinting, request chain mimicry, browser profiles  |
| **4**   | Enterprise WAFs — Akamai Bot Manager, PerimeterX/HUMAN, DataDome, Kasada                       |
| **5**   | Content integrity — agent poisoning detection, shadow DOM, soft-block detection                |
| **6**   | Meta robots, rate limit headers, DNS strategies, TLS fingerprint rotation                      |
| **7**   | JWT/OAuth extraction, token discovery, user config system, CLI auth commands                   |
| **8**   | LLM-assisted bypass — JS deobfuscation, signing extraction                                     |

**Current anti-bot score: 5.5/10** — strong infrastructure, growing evasion capabilities.

## API Discovery (Phase 1.5)

Most websites expose more data through APIs than rendered HTML. Ultra Reader's API Discovery automatically maps a target's internal API surface.

| Approach         | Speed              | Data Quality        | Anti-Bot Risk | Coverage                     |
| ---------------- | ------------------ | ------------------- | ------------- | ---------------------------- |
| HTML scraping    | Slow               | Lossy               | High          | What you see                 |
| **API scraping** | **10-100x faster** | **Structured JSON** | **Low**       | **Everything the app knows** |

### What Gets Discovered

- **Sitemaps** — XML, HTML, RSS/Atom feeds, `Sitemap:` directives from robots.txt
- **REST APIs** — XHR/Fetch interception during page load
- **GraphQL** — Endpoint detection, persisted query hashes, introspection
- **OpenAPI/Swagger** — Auto-discovers `/swagger.json`, `/openapi.yaml`, `/api-docs`
- **Inline data** — `__NEXT_DATA__`, `__NUXT__`, `window.__INITIAL_STATE__`
- **Auth tokens** — JWT from localStorage/sessionStorage/cookies/headers, API keys, CSRF tokens, OAuth endpoints

### Adaptive Engine Selection

```
Discovery: api.example.com/v2/articles → 200 OK via HTTP engine
Result:    Engine affinity cached → future requests use HTTP (10x faster)

Discovery: example.com/dashboard → Cloudflare challenge
Result:    Engine affinity cached → future requests start at Hero (skip failures)
```

### Circuit Breaker

```
5 consecutive failures → circuit OPEN → stop hitting domain → rotate proxy → wait 5 min
                         circuit HALF-OPEN → try one request
                         success? → CLOSED (resume)  |  failure? → OPEN (wait again)
```

## Architecture

### 3-Engine Cascade

```
Engine 1: HTTP (native fetch)        → ~60-70% of static sites
    ↓ on failure
Engine 2: TLS Client (got-scraping)  → TLS fingerprint emulation
    ↓ on failure
Engine 3: Hero (full Chromium)       → JS rendering, challenge resolution
```

Each engine has its own timeout. The orchestrator escalates on: challenge detected, insufficient content, HTTP 403/429/5xx.

### HTML to Markdown: supermarkdown

Uses [supermarkdown](https://github.com/vakra-dev/supermarkdown) — a Rust-based HTML→Markdown converter built for web scraping and LLM pipelines. Native performance via napi-rs, full GFM support, handles malformed HTML.

```bash
npm install @vakra-dev/supermarkdown
```

## Server Deployment

On headless Linux servers, install Chrome dependencies:

```bash
# Debian/Ubuntu
sudo apt-get install -y libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libxcb1 libatspi2.0-0 libx11-6 libxcomposite1 libxdamage1 \
  libxext6 libxfixes3 libxrandr2 libgbm1 libcairo2 libpango-1.0-0 libasound2
```

## Development

```bash
npm install
npm run lint          # ESLint
npm run format        # Prettier
npm run typecheck     # tsc --noEmit
npm test              # vitest (361 tests)
npm run test:coverage # with v8 coverage
npm run build         # tsup → dist/
```

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[GPL v3](LICENSE)

## Attribution

Ultra Reader is a fork of [Reader](https://github.com/vakra-dev/reader) by [Nihal Kaul](https://github.com/vakra-dev), originally licensed under Apache 2.0. This fork is maintained by [Marco Jardim](https://github.com/marco-jardim) under GPL v3.

```bibtex
@software{ultra-reader,
  author = {Jardim, Marco and Kaul, Nihal},
  title = {Ultra Reader: Power scraping engine for AI agents},
  year = {2026},
  publisher = {GitHub},
  url = {https://github.com/marco-jardim/ultra-reader}
}
```

## Support

- [GitHub Issues](https://github.com/marco-jardim/ultra-reader/issues)
