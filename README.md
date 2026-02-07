<p align="center">
  <img src="docs/assets/logo.png" alt="Reader Logo" width="200" />
</p>

<h1 align="center">Reader</h1>

<p align="center">
  <strong>Open-source, production-grade web scraping engine built for LLMs.</strong>
</p>

<p align="center">
  Scrape and crawl the entire web, clean markdown, ready for your agents.
</p>

<p align="center">
  <a href="https://www.gnu.org/licenses/gpl-3.0"><img src="https://img.shields.io/badge/License-GPLv3-blue.svg" alt="License: GPL v3"></a>
  <a href="https://www.npmjs.com/package/@vakra-dev/reader"><img src="https://img.shields.io/npm/v/@vakra-dev/reader.svg" alt="npm version"></a>
  <a href="https://github.com/vakra-dev/reader/stargazers"><img src="https://img.shields.io/github/stars/vakra-dev/reader.svg?style=social" alt="GitHub stars"></a>
</p>

<p align="center">
  <a href="https://docs.reader.dev">Docs</a> · <a href="https://docs.reader.dev/home/examples">Examples</a> · <a href="https://discord.gg/6tjkq7J5WV">Discord</a>
</p>

<p align="center">
  <img src="./docs/assets/demo.gif" alt="Reader demo — scrape any URL to clean markdown" width="700" />
</p>

## The Problem

Building agents that need web access is frustrating. You piece together Puppeteer, add stealth plugins, fight Cloudflare, manage proxies and it still breaks in production.

Because production grade web scraping isn't about rendering a page and converting HTML to markdown. It's about everything underneath:

| Layer                    | What it actually takes                                              |
| ------------------------ | ------------------------------------------------------------------- |
| **Browser architecture** | Managing browser instances at scale, not one-off scripts            |
| **Anti-bot bypass**      | Cloudflare, Turnstile, JS challenges, they all block naive scrapers |
| **TLS fingerprinting**   | Real browsers have fingerprints. Puppeteer doesn't. Sites know.     |
| **Proxy infrastructure** | Datacenter vs residential, rotation strategies, sticky sessions     |
| **Resource management**  | Browser pooling, memory limits, graceful recycling                  |
| **Reliability**          | Rate limiting, retries, timeouts, caching, graceful degradation     |

I built **Reader**, a production-grade web scraping engine on top of [Ulixee Hero](https://ulixee.org/), a headless browser designed for exactly this.

## The Solution

Two primitives. That's it.

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient();

// Scrape URLs → clean markdown
const result = await reader.scrape({ urls: ["https://example.com"] });
console.log(result.data[0].markdown);

// Crawl a site → discover + scrape pages
const pages = await reader.crawl({
  url: "https://example.com",
  depth: 2,
  scrape: true,
});
console.log(`Found ${pages.urls.length} pages`);
```

All the hard stuff, browser pooling, challenge detection, proxy rotation, retries, happens under the hood. You get clean markdown. Your agents get the web.

> [!TIP]
> If Reader is useful to you, a [star on GitHub](https://github.com/vakra-dev/reader) helps others discover the project.

## Features

- **Cloudflare Bypass** - TLS fingerprinting, DNS over TLS, WebRTC masking
- **Clean Output** - Markdown and HTML with automatic main content extraction
- **Smart Content Cleaning** - Removes nav, headers, footers, popups, cookie banners
- **CLI & API** - Use from command line or programmatically
- **Browser Pool** - Auto-recycling, health monitoring, queue management
- **Concurrent Scraping** - Parallel URL processing with progress tracking
- **Website Crawling** - BFS link discovery with depth/page limits
- **Proxy Support** - Datacenter and residential with sticky sessions

## Installation

```bash
npm install @vakra-dev/reader
```

**Requirements:** Node.js >= 18

## Quick Start

### Basic Scrape

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient();

const result = await reader.scrape({
  urls: ["https://example.com"],
  formats: ["markdown", "html"],
});

console.log(result.data[0].markdown);
console.log(result.data[0].html);

await reader.close();
```

### Batch Scraping with Concurrency

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient();

const result = await reader.scrape({
  urls: ["https://example.com", "https://example.org", "https://example.net"],
  formats: ["markdown"],
  batchConcurrency: 3,
  onProgress: (progress) => {
    console.log(`${progress.completed}/${progress.total}: ${progress.currentUrl}`);
  },
});

console.log(`Scraped ${result.batchMetadata.successfulUrls} URLs`);

await reader.close();
```

### Crawling

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient();

const result = await reader.crawl({
  url: "https://example.com",
  depth: 2,
  maxPages: 20,
  scrape: true,
});

console.log(`Discovered ${result.urls.length} URLs`);
console.log(`Scraped ${result.scraped?.batchMetadata.successfulUrls} pages`);

await reader.close();
```

### With Proxy

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient();

const result = await reader.scrape({
  urls: ["https://example.com"],
  formats: ["markdown"],
  proxy: {
    type: "residential",
    host: "proxy.example.com",
    port: 8080,
    username: "username",
    password: "password",
    country: "us",
  },
});

await reader.close();
```

### With Proxy Rotation

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient({
  proxies: [
    { host: "proxy1.example.com", port: 8080, username: "user", password: "pass" },
    { host: "proxy2.example.com", port: 8080, username: "user", password: "pass" },
  ],
  proxyRotation: "round-robin", // or "random"
});

const result = await reader.scrape({
  urls: ["https://example.com", "https://example.org"],
  formats: ["markdown"],
  batchConcurrency: 2,
});

await reader.close();
```

### With Browser Pool Configuration

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient({
  browserPool: {
    size: 5, // 5 browser instances
    retireAfterPages: 50, // Recycle after 50 pages
    retireAfterMinutes: 15, // Recycle after 15 minutes
  },
  verbose: true,
});

const result = await reader.scrape({
  urls: manyUrls,
  batchConcurrency: 5,
});

await reader.close();
```

## CLI Reference

### Daemon Mode

For multiple requests, start a daemon to keep browser pool warm:

```bash
# Start daemon with browser pool
npx reader start --pool-size 5

# All subsequent commands auto-connect to daemon
npx reader scrape https://example.com
npx reader crawl https://example.com -d 2

# Check daemon status
npx reader status

# Stop daemon
npx reader stop

# Force standalone mode (bypass daemon)
npx reader scrape https://example.com --standalone
```

### `reader scrape <urls...>`

Scrape one or more URLs.

```bash
# Scrape a single URL
npx reader scrape https://example.com

# Scrape with multiple formats
npx reader scrape https://example.com -f markdown,html

# Scrape multiple URLs concurrently
npx reader scrape https://example.com https://example.org -c 2

# Save to file
npx reader scrape https://example.com -o output.md
```

| Option                   | Type   | Default      | Description                                             |
| ------------------------ | ------ | ------------ | ------------------------------------------------------- |
| `-f, --format <formats>` | string | `"markdown"` | Output formats (comma-separated: markdown,html)         |
| `-o, --output <file>`    | string | stdout       | Output file path                                        |
| `-c, --concurrency <n>`  | number | `1`          | Parallel requests                                       |
| `-t, --timeout <ms>`     | number | `30000`      | Request timeout in milliseconds                         |
| `--batch-timeout <ms>`   | number | `300000`     | Total timeout for entire batch operation                |
| `--proxy <url>`          | string | -            | Proxy URL (e.g., http://user:pass@host:port)            |
| `--user-agent <string>`  | string | -            | Custom user agent string                                |
| `--show-chrome`          | flag   | -            | Show browser window for debugging                       |
| `--no-main-content`      | flag   | -            | Disable main content extraction (include full page)     |
| `--include-tags <sel>`   | string | -            | CSS selectors for elements to include (comma-separated) |
| `--exclude-tags <sel>`   | string | -            | CSS selectors for elements to exclude (comma-separated) |
| `-v, --verbose`          | flag   | -            | Enable verbose logging                                  |

### `reader crawl <url>`

Crawl a website to discover pages.

```bash
# Crawl with default settings
npx reader crawl https://example.com

# Crawl deeper with more pages
npx reader crawl https://example.com -d 3 -m 50

# Crawl and scrape content
npx reader crawl https://example.com -d 2 --scrape

# Filter URLs with patterns
npx reader crawl https://example.com --include "blog/*" --exclude "admin/*"
```

| Option                   | Type   | Default      | Description                                     |
| ------------------------ | ------ | ------------ | ----------------------------------------------- |
| `-d, --depth <n>`        | number | `1`          | Maximum crawl depth                             |
| `-m, --max-pages <n>`    | number | `20`         | Maximum pages to discover                       |
| `-s, --scrape`           | flag   | -            | Also scrape content of discovered pages         |
| `-f, --format <formats>` | string | `"markdown"` | Output formats when scraping (comma-separated)  |
| `-o, --output <file>`    | string | stdout       | Output file path                                |
| `--delay <ms>`           | number | `1000`       | Delay between requests in milliseconds          |
| `-t, --timeout <ms>`     | number | -            | Total timeout for crawl operation               |
| `--include <patterns>`   | string | -            | URL patterns to include (comma-separated regex) |
| `--exclude <patterns>`   | string | -            | URL patterns to exclude (comma-separated regex) |
| `--proxy <url>`          | string | -            | Proxy URL (e.g., http://user:pass@host:port)    |
| `--user-agent <string>`  | string | -            | Custom user agent string                        |
| `--show-chrome`          | flag   | -            | Show browser window for debugging               |
| `-v, --verbose`          | flag   | -            | Enable verbose logging                          |

## API Reference

### `ReaderClient`

The recommended way to use Reader. Manages HeroCore lifecycle automatically.

```typescript
import { ReaderClient } from "@vakra-dev/reader";

const reader = new ReaderClient({ verbose: true });

// Scrape
const result = await reader.scrape({ urls: ["https://example.com"] });

// Crawl
const crawlResult = await reader.crawl({ url: "https://example.com", depth: 2 });

// Close when done (optional - auto-closes on exit)
await reader.close();
```

#### Constructor Options

| Option          | Type                | Default         | Description                                      |
| --------------- | ------------------- | --------------- | ------------------------------------------------ |
| `verbose`       | `boolean`           | `false`         | Enable verbose logging                           |
| `showChrome`    | `boolean`           | `false`         | Show browser window for debugging                |
| `browserPool`   | `BrowserPoolConfig` | `undefined`     | Browser pool configuration (size, recycling)     |
| `proxies`       | `ProxyConfig[]`     | `undefined`     | Array of proxies for rotation                    |
| `proxyRotation` | `string`            | `"round-robin"` | Rotation strategy: `"round-robin"` or `"random"` |

#### BrowserPoolConfig

| Option               | Type     | Default | Description                         |
| -------------------- | -------- | ------- | ----------------------------------- |
| `size`               | `number` | `2`     | Number of browser instances in pool |
| `retireAfterPages`   | `number` | `100`   | Recycle browser after N page loads  |
| `retireAfterMinutes` | `number` | `30`    | Recycle browser after N minutes     |
| `maxQueueSize`       | `number` | `100`   | Max pending requests in queue       |

#### Methods

| Method            | Description                        |
| ----------------- | ---------------------------------- |
| `scrape(options)` | Scrape one or more URLs            |
| `crawl(options)`  | Crawl a website to discover pages  |
| `start()`         | Pre-initialize HeroCore (optional) |
| `isReady()`       | Check if client is initialized     |
| `close()`         | Close client and release resources |

### `scrape(options): Promise<ScrapeResult>`

Scrape one or more URLs. Can be used directly or via `ReaderClient`.

| Option             | Type                          | Required | Default        | Description                                                     |
| ------------------ | ----------------------------- | -------- | -------------- | --------------------------------------------------------------- |
| `urls`             | `string[]`                    | Yes      | -              | Array of URLs to scrape                                         |
| `formats`          | `Array<"markdown" \| "html">` | No       | `["markdown"]` | Output formats                                                  |
| `onlyMainContent`  | `boolean`                     | No       | `true`         | Extract only main content (removes nav/header/footer)           |
| `includeTags`      | `string[]`                    | No       | `[]`           | CSS selectors for elements to keep                              |
| `excludeTags`      | `string[]`                    | No       | `[]`           | CSS selectors for elements to remove                            |
| `userAgent`        | `string`                      | No       | -              | Custom user agent string                                        |
| `timeoutMs`        | `number`                      | No       | `30000`        | Request timeout in milliseconds                                 |
| `includePatterns`  | `string[]`                    | No       | `[]`           | URL patterns to include (regex strings)                         |
| `excludePatterns`  | `string[]`                    | No       | `[]`           | URL patterns to exclude (regex strings)                         |
| `batchConcurrency` | `number`                      | No       | `1`            | Number of URLs to process in parallel                           |
| `batchTimeoutMs`   | `number`                      | No       | `300000`       | Total timeout for entire batch operation                        |
| `maxRetries`       | `number`                      | No       | `2`            | Maximum retry attempts for failed URLs                          |
| `onProgress`       | `function`                    | No       | -              | Progress callback: `({ completed, total, currentUrl }) => void` |
| `proxy`            | `ProxyConfig`                 | No       | -              | Proxy configuration object                                      |
| `waitForSelector`  | `string`                      | No       | -              | CSS selector to wait for before page is loaded                  |
| `verbose`          | `boolean`                     | No       | `false`        | Enable verbose logging                                          |
| `showChrome`       | `boolean`                     | No       | `false`        | Show Chrome window for debugging                                |
| `connectionToCore` | `any`                         | No       | -              | Connection to shared Hero Core (for production)                 |

**Returns:** `Promise<ScrapeResult>`

```typescript
interface ScrapeResult {
  data: WebsiteScrapeResult[];
  batchMetadata: BatchMetadata;
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
  };
}

interface BatchMetadata {
  totalUrls: number;
  successfulUrls: number;
  failedUrls: number;
  scrapedAt: string;
  totalDuration: number;
  errors?: Array<{ url: string; error: string }>;
}
```

### `crawl(options): Promise<CrawlResult>`

Crawl a website to discover pages.

| Option              | Type                                              | Required | Default                | Description                                     |
| ------------------- | ------------------------------------------------- | -------- | ---------------------- | ----------------------------------------------- |
| `url`               | `string`                                          | Yes      | -                      | Single seed URL to start crawling from          |
| `depth`             | `number`                                          | No       | `1`                    | Maximum depth to crawl                          |
| `maxPages`          | `number`                                          | No       | `20`                   | Maximum pages to discover                       |
| `scrape`            | `boolean`                                         | No       | `false`                | Also scrape full content of discovered pages    |
| `delayMs`           | `number`                                          | No       | `1000`                 | Delay between requests in milliseconds          |
| `timeoutMs`         | `number`                                          | No       | -                      | Total timeout for entire crawl operation        |
| `includePatterns`   | `string[]`                                        | No       | -                      | URL patterns to include (regex strings)         |
| `excludePatterns`   | `string[]`                                        | No       | -                      | URL patterns to exclude (regex strings)         |
| `formats`           | `Array<"markdown" \| "html" \| "json" \| "text">` | No       | `["markdown", "html"]` | Output formats for scraped content              |
| `scrapeConcurrency` | `number`                                          | No       | `2`                    | Number of URLs to scrape in parallel            |
| `proxy`             | `ProxyConfig`                                     | No       | -                      | Proxy configuration object                      |
| `userAgent`         | `string`                                          | No       | -                      | Custom user agent string                        |
| `verbose`           | `boolean`                                         | No       | `false`                | Enable verbose logging                          |
| `showChrome`        | `boolean`                                         | No       | `false`                | Show Chrome window for debugging                |
| `connectionToCore`  | `any`                                             | No       | -                      | Connection to shared Hero Core (for production) |

**Returns:** `Promise<CrawlResult>`

```typescript
interface CrawlResult {
  urls: CrawlUrl[];
  scraped?: ScrapeResult;
  metadata: CrawlMetadata;
}

interface CrawlUrl {
  url: string;
  title: string;
  description: string | null;
}

interface CrawlMetadata {
  totalUrls: number;
  maxDepth: number;
  totalDuration: number;
  seedUrl: string;
}
```

### ProxyConfig

| Option     | Type                            | Required | Default | Description                                             |
| ---------- | ------------------------------- | -------- | ------- | ------------------------------------------------------- |
| `url`      | `string`                        | No       | -       | Full proxy URL (takes precedence over other fields)     |
| `type`     | `"datacenter" \| "residential"` | No       | -       | Proxy type                                              |
| `host`     | `string`                        | No       | -       | Proxy host                                              |
| `port`     | `number`                        | No       | -       | Proxy port                                              |
| `username` | `string`                        | No       | -       | Proxy username                                          |
| `password` | `string`                        | No       | -       | Proxy password                                          |
| `country`  | `string`                        | No       | -       | Country code for residential proxies (e.g., 'us', 'uk') |

## Advanced Usage

### Browser Pool

For high-volume scraping, use the browser pool directly:

```typescript
import { BrowserPool } from "@vakra-dev/reader";

const pool = new BrowserPool({ size: 5 });
await pool.initialize();

// Use withBrowser for automatic acquire/release
const title = await pool.withBrowser(async (hero) => {
  await hero.goto("https://example.com");
  return await hero.document.title;
});

// Check pool health
const health = await pool.healthCheck();
console.log(`Pool healthy: ${health.healthy}`);

await pool.shutdown();
```

### Shared Hero Core (Production)

For production servers, use a shared Hero Core to avoid spawning new Chrome for each request:

```typescript
import HeroCore from "@ulixee/hero-core";
import { TransportBridge } from "@ulixee/net";
import { ConnectionToHeroCore } from "@ulixee/hero";
import { scrape } from "@vakra-dev/reader";

// Initialize once at startup
const heroCore = new HeroCore();
await heroCore.start();

// Create connection for each request
function createConnection() {
  const bridge = new TransportBridge();
  heroCore.addConnection(bridge.transportToClient);
  return new ConnectionToHeroCore(bridge.transportToCore);
}

// Use in requests
const result = await scrape({
  urls: ["https://example.com"],
  connectionToCore: createConnection(),
});

// Shutdown on exit
await heroCore.close();
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
    verbose: true,
    initialUrl: await hero.url,
  });

  if (result.resolved) {
    console.log(`Challenge resolved via ${result.method} in ${result.waitedMs}ms`);
  }
}
```

### Custom Formatters

```typescript
import { formatToMarkdown, formatToText, formatToHTML, formatToJson } from "@vakra-dev/reader";

// Format pages to different outputs
const markdown = formatToMarkdown(pages, baseUrl, scrapedAt, duration, metadata);
const text = formatToText(pages, baseUrl, scrapedAt, duration, metadata);
const html = formatToHTML(pages, baseUrl, scrapedAt, duration, metadata);
const json = formatToJson(pages, baseUrl, scrapedAt, duration, metadata);
```

## Anti-Bot Evasion Strategies

Reader implements a layered defense against 44 known anti-bot mechanisms. The 3-engine cascade (HTTP → TLS Client → Chromium) automatically escalates when simpler engines are blocked.

### Mitigation Status

| #   | Mechanism                           | Category   | Status       | How                                                                                                   |
| --- | ----------------------------------- | ---------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| 1   | **robots.txt**                      | Protocol   | Configurable | Full parser with Allow/Disallow/Crawl-delay, wildcards, `$` anchors. `respectRobots: false` to bypass |
| 2   | **Meta robots / X-Robots-Tag**      | Protocol   | Planned      | Phase 6 — header and meta tag parsing                                                                 |
| 3   | **Login walls / auth**              | Protocol   | Planned      | Phase 7 — JWT extraction, OAuth flows, cookie injection                                               |
| 4   | **API token requirements**          | Protocol   | Planned      | Phase 7 — token extraction from localStorage/headers/scripts                                          |
| 5   | **CORS/Origin restrictions**        | Protocol   | N/A          | Not applicable to server-side scraping                                                                |
| 6   | **IP rate limiting**                | Network    | Mitigated    | Configurable delay, `p-limit` concurrency, jitter (uniform/gaussian/exponential), exponential backoff |
| 7   | **IP reputation / blacklists**      | Network    | Mitigated    | Datacenter + residential proxies, round-robin/random rotation, sticky sessions                        |
| 8   | **Geo-blocking**                    | Network    | Mitigated    | Residential proxies with `country` param, geo-consistent Accept-Language planned                      |
| 9   | **TLS fingerprinting (JA3/JA4)**    | Network    | Mitigated    | Hero emulates real Chrome TLS fingerprint; `got-scraping` emulates browser TLS                        |
| 10  | **HTTP/2 fingerprinting**           | Network    | Partial      | `got-scraping` handles partially; native `fetch()` has no HTTP/2 settings control                     |
| 11  | **TCP fingerprinting**              | Network    | Mitigated    | Hero uses real Chromium TCP stack                                                                     |
| 12  | **DNS leak detection**              | Network    | Mitigated    | DNS over TLS via Cloudflare (1.1.1.1) in Hero engine                                                  |
| 13  | **User-Agent filtering**            | HTTP       | Mitigated    | 18 modern UAs (Chrome/Firefox/Safari/Edge), weighted random + round-robin + domain-sticky rotation    |
| 14  | **Header order/consistency**        | HTTP       | Partial      | Full `Sec-Fetch-*` headers, `Sec-CH-UA` client hints. Header order fingerprinting planned (Phase 3)   |
| 15  | **Referer header validation**       | HTTP       | Mitigated    | Auto-generated Google/Bing search referers with `spoofReferer: true` (default)                        |
| 16  | **Cookie/session validation**       | HTTP       | Partial      | Hero manages cookies via Chromium. Session persistence planned (Phase 3)                              |
| 17  | **Cloudflare JS Challenge**         | Challenge  | Mitigated    | Multi-signal detection (DOM + text + infra). Polling resolution with URL redirect + signal clearing   |
| 18  | **Cloudflare Turnstile**            | Challenge  | Partial      | Managed (invisible) mode auto-resolved by Hero. Interactive mode requires CAPTCHA solver (Phase 2)    |
| 19  | **CAPTCHAs** (reCAPTCHA, hCaptcha)  | Challenge  | Planned      | Phase 2 — 2Captcha, Anti-Captcha, CapSolver integration                                               |
| 20  | **Proof-of-Work challenges**        | Challenge  | Planned      | Phase 4 — Kasada PoW solver                                                                           |
| 21  | **WAF detection**                   | Challenge  | Partial      | Cloudflare detected. Akamai/PerimeterX/DataDome/Kasada planned (Phase 3-4)                            |
| 22  | **Akamai Bot Manager**              | Enterprise | Planned      | Phase 4 — device fingerprint + sensor data emulation                                                  |
| 23  | **PerimeterX / HUMAN**              | Enterprise | Planned      | Phase 4 — behavioral challenge handler                                                                |
| 24  | **DataDome**                        | Enterprise | Planned      | Phase 4 — cookie-based challenge solver                                                               |
| 25  | **Kasada**                          | Enterprise | Planned      | Phase 4 — polymorphic JS + PoW                                                                        |
| 26  | **Shape Security (F5)**             | Enterprise | Planned      | Phase 4 — polymorphic JS deobfuscation                                                                |
| 27  | **Canvas fingerprinting**           | Browser FP | Mitigated    | Hero emulates consistent, realistic Canvas fingerprints                                               |
| 28  | **WebGL fingerprinting**            | Browser FP | Mitigated    | Hero emulates WebGL characteristics                                                                   |
| 29  | **Audio fingerprinting**            | Browser FP | Mitigated    | Hero emulates audio processing fingerprint                                                            |
| 30  | **Font enumeration**                | Browser FP | Partial      | Hero emulates fonts partially. No granular font list control                                          |
| 31  | **Navigator/JS environment**        | Browser FP | Mitigated    | Hero emulates full Chrome: `navigator`, WebGL, Canvas, plugins                                        |
| 32  | **WebRTC IP leak**                  | Browser FP | Mitigated    | `upstreamProxyIpMask` via ipify.org                                                                   |
| 33  | **Viewport/resolution**             | Browser FP | Mitigated    | 1920x1080 viewport, `en-US` locale, `America/New_York` timezone. Rotation planned                     |
| 34  | **Behavioral analysis**             | Behavioral | Planned      | Phase 2 — Bezier mouse curves, human-like scroll, Fitts's Law click timing                            |
| 35  | **Timing attacks**                  | Behavioral | Mitigated    | Jitter with 3 distributions (uniform/gaussian/exponential), configurable min/max                      |
| 36  | **Honeypot traps**                  | Behavioral | Planned      | Phase 2 — detect `display:none`, `aria-hidden`, `opacity:0` links                                     |
| 37  | **Agent poisoning / text cloaking** | Content    | Planned      | Phase 5 — cross-engine verification, hidden text detection, Unicode analysis                          |
| 38  | **Content obfuscation** (CSS text)  | Content    | Planned      | Phase 5 — CSS `::before`/`::after` extraction, Canvas text                                            |
| 39  | **Shadow DOM / Web Components**     | Content    | Partial      | Hero renders Shadow DOM via Chromium. Deep extraction planned (Phase 5)                               |
| 40  | **iframe sandboxing**               | Content    | Partial      | Hero renders iframes. Cross-origin extraction limited                                                 |
| 41  | **JavaScript rendering**            | Dynamic    | Mitigated    | Full Chromium via Ulixee Hero. `DOMContentLoaded` + `PaintingStable` + `waitForSelector`              |
| 42  | **Dynamic content** (scroll/lazy)   | Dynamic    | Planned      | Phase 2 — scroll simulation, lazy load triggering, "Load More" interaction                            |
| 43  | **GraphQL/REST anti-scrape**        | Dynamic    | Planned      | Phase 1.5 — endpoint discovery, rate limit per endpoint                                               |
| 44  | **Soft-blocks** (degraded content)  | Content    | Planned      | Phase 5 — pattern detection, semantic density scoring, cross-engine comparison                        |

### Scorecard

| Category              | Score | Notes                                                             |
| --------------------- | ----- | ----------------------------------------------------------------- |
| Engine architecture   | 9/10  | 3-engine cascade with automatic escalation                        |
| Cloudflare bypass     | 7/10  | JS challenges yes, interactive Turnstile/CAPTCHAs not yet         |
| TLS fingerprinting    | 8/10  | Hero + got-scraping cover well                                    |
| Proxy infrastructure  | 8/10  | Rotation, residential, geo-targeting, sticky sessions             |
| Anti-headless evasion | 8/10  | Hero is top-tier for browser emulation                            |
| UA management         | 8/10  | 18 modern UAs, 3 rotation strategies, domain-sticky, client hints |
| Rate limiting         | 8/10  | Jitter, crawl-delay, backoff, concurrency control                 |
| CAPTCHA solving       | 0/10  | Not yet integrated (Phase 2)                                      |
| Behavioral evasion    | 1/10  | Planned for Phase 2                                               |
| Enterprise WAFs       | 1/10  | Only Cloudflare (Phases 3-4)                                      |
| Content integrity     | 2/10  | Planned for Phase 5                                               |

**Current overall score: 5.5/10** — strong on infrastructure, growing on evasion.

## Power Scraping: API Discovery & Hidden Endpoints

Most websites expose far more data through their APIs than through their rendered HTML. Reader's API Discovery system (Phase 1.5) automatically maps a target's internal API surface, turning a basic scrape into deep data extraction.

### Why API-First Scraping?

| Approach         | Speed              | Data Quality              | Anti-Bot Risk              | Coverage                     |
| ---------------- | ------------------ | ------------------------- | -------------------------- | ---------------------------- |
| HTML scraping    | Slow               | Lossy (parsing artifacts) | High (full browser needed) | What you see                 |
| **API scraping** | **10-100x faster** | **Structured JSON**       | **Low (lightweight HTTP)** | **Everything the app knows** |

When you hit an API endpoint directly, you skip the rendering layer entirely — no DOM parsing, no content extraction errors, no browser fingerprint to worry about. You get raw, structured data at a fraction of the cost.

### What Gets Discovered

#### Sitemaps & Site Structure

- **XML Sitemaps** — `/sitemap.xml`, `/sitemap_index.xml`, nested sitemaps, image/video/news sitemaps
- **robots.txt sitemap refs** — Extract `Sitemap:` directives from robots.txt
- **HTML sitemaps** — Detect `/sitemap`, `/site-map`, `/sitemap.html` pages
- **RSS/Atom feeds** — `/feed`, `/rss`, `/atom.xml`, `<link rel="alternate">` discovery
- **Every discovered URL** gets prioritized by `<lastmod>`, `<changefreq>`, and `<priority>`

#### API Endpoints

- **REST APIs** — Intercepts XHR/Fetch calls during page load to map `GET/POST/PUT/DELETE` endpoints
- **GraphQL** — Detects `/graphql` endpoints, extracts persisted query hashes, introspection queries
- **JSON-LD / Schema.org** — Structured data embedded in `<script type="application/ld+json">`
- **Inline JSON** — `__NEXT_DATA__`, `__NUXT__`, `window.__INITIAL_STATE__`, `window.__APP_DATA__`
- **WebSocket endpoints** — `wss://` connections observed during page lifecycle

#### API Documentation

- **OpenAPI / Swagger** — Auto-discovers `/swagger.json`, `/openapi.yaml`, `/api-docs`, `/v1/docs`, `/api/swagger-ui`
- **GraphQL Schema** — Introspection query to extract full type system, queries, mutations
- **API versioning** — Detects `/v1/`, `/v2/`, `/api/v3/` patterns and maps available versions
- **When found**: Full schema is parsed, endpoints are cataloged with parameters, types, and auth requirements

#### Authentication & Credentials

- **JWT tokens** — Extracted from `localStorage`, `sessionStorage`, cookies, `Authorization` headers, inline scripts
- **API keys** — Pattern-matched from page source, `<meta>` tags, config objects, `data-*` attributes
- **OAuth endpoints** — Discovers `/oauth/authorize`, `/token`, OIDC `.well-known/openid-configuration`
- **Session cookies** — Maps which cookies grant API access vs. which are tracking
- **CSRF tokens** — Extracts `X-CSRF-Token`, `_csrf`, hidden form fields for authenticated requests

### How It Works

```
Target URL
    │
    ├─► Sitemap Discovery ──► URL inventory with priorities
    │
    ├─► API Interception ──► Endpoint map (REST + GraphQL + WS)
    │      (during page load, captures all network requests)
    │
    ├─► Doc Discovery ──► OpenAPI/Swagger/GraphQL schema
    │
    ├─► Auth Discovery ──► Tokens, keys, OAuth flows
    │
    └─► Output: Complete site intelligence report
         ├── Structured endpoints with parameters
         ├── Authentication requirements per endpoint
         ├── Rate limit headers per endpoint
         └── Recommended scraping strategy per resource
```

Each discovered endpoint is classified by:

- **Auth level** — public, API key, JWT, OAuth, session cookie
- **Rate limits** — extracted from `X-RateLimit-*`, `Retry-After` headers
- **Data format** — JSON, XML, HTML, binary
- **Scraping cost** — engine required (HTTP vs TLS vs browser), estimated time

### Adaptive Engine Selection

The API Discovery system feeds back into the engine cascade. Once we know a domain's API endpoints respond to simple HTTP requests, we skip the browser entirely:

```
Discovery: api.example.com/v2/articles → 200 OK via HTTP engine
Result:    Engine affinity cached → all future requests use HTTP (10x faster)

Discovery: example.com/dashboard → requires Cloudflare challenge
Result:    Engine affinity cached → future requests start at Hero engine (skip failures)
```

This is tracked by `EngineAffinityCache` — a per-domain success map that decays over time, so stale entries don't persist if a site changes its protection.

### Circuit Breaker

When a domain starts failing repeatedly, the circuit breaker kicks in:

```
5 consecutive failures → circuit OPEN → stop hitting domain
                                      → rotate proxy
                                      → wait 5 minutes
                         circuit HALF-OPEN → try one request
                         success? → circuit CLOSED (resume)
                         failure? → circuit OPEN (wait again)
```

This prevents IP bans from cascading and burning through your proxy pool.

## How It Works

### 3-Engine Cascade

Reader tries three engines in order of speed and resource cost:

```
Engine 1: HTTP (native fetch)     → ~60-70% of static sites
    ↓ on failure
Engine 2: TLS Client (got-scraping) → TLS fingerprint emulation
    ↓ on failure
Engine 3: Hero (full Chromium)     → JS rendering, challenge resolution
```

Each engine has its own timeout. The orchestrator escalates based on error type: challenge detected, insufficient content, HTTP 403/429/5xx.

### Cloudflare Bypass

Reader uses [Ulixee Hero](https://ulixee.org/), a headless browser with advanced anti-detection:

1. **TLS Fingerprinting** - Emulates real Chrome browser fingerprints
2. **DNS over TLS** - Uses Cloudflare DNS (1.1.1.1) to mimic Chrome behavior
3. **WebRTC IP Masking** - Prevents IP leaks
4. **Multi-Signal Detection** - Detects challenges using DOM elements and text patterns
5. **Dynamic Waiting** - Polls for challenge resolution with URL redirect detection

### Browser Pool

- **Auto-Recycling** - Browsers recycled after 100 requests or 30 minutes
- **Health Monitoring** - Background health checks every 5 minutes
- **Request Queuing** - Queues requests when pool is full (max 100)

### HTML to Markdown: supermarkdown

Reader uses [**supermarkdown**](https://github.com/vakra-dev/supermarkdown) for HTML to Markdown conversion - a sister project we built from scratch specifically for web scraping and LLM pipelines.

**Why we built it:**

When you're scraping the web, you encounter messy, malformed HTML that breaks most converters. And when you're feeding content to LLMs, you need clean output without artifacts or noise. We needed a converter that handles real-world HTML reliably while producing high-quality markdown.

**What supermarkdown offers:**

| Feature              | Benefit                                              |
| -------------------- | ---------------------------------------------------- |
| **Written in Rust**  | Native performance with Node.js bindings via napi-rs |
| **Full GFM support** | Tables, task lists, strikethrough, autolinks         |
| **LLM-optimized**    | Clean output designed for AI consumption             |
| **Battle-tested**    | Handles malformed HTML from real web pages           |
| **CSS selectors**    | Include/exclude elements during conversion           |

supermarkdown is open source and available as both a Rust crate and npm package:

```bash
# npm
npm install @vakra-dev/supermarkdown

# Rust
cargo add supermarkdown
```

Check out the [supermarkdown repository](https://github.com/vakra-dev/supermarkdown) for examples and documentation.

## Server Deployment

Reader uses a real Chromium browser under the hood. On headless Linux servers (VPS, EC2, etc.), you need to install Chrome's system dependencies:

```bash
# Debian/Ubuntu
sudo apt-get install -y libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libxcb1 libatspi2.0-0 libx11-6 libxcomposite1 libxdamage1 \
  libxext6 libxfixes3 libxrandr2 libgbm1 libcairo2 libpango-1.0-0 libasound2
```

This is the same requirement that Puppeteer and Playwright have on headless Linux. macOS, Windows, and Linux desktops already have these libraries.

For Docker and production deployment guides, see the [deployment documentation](https://docs.reader.dev/documentation/guides/deployment).

## Documentation

Full documentation is available at **[docs.reader.dev](https://docs.reader.dev)**, including guides for scraping, crawling, proxy configuration, browser pool management, and deployment.

### Examples

| Example                                                      | Description                                |
| ------------------------------------------------------------ | ------------------------------------------ |
| [Basic Scraping](examples/basic/basic-scrape.ts)             | Simple single-URL scraping                 |
| [Batch Scraping](examples/basic/batch-scrape.ts)             | Concurrent multi-URL scraping              |
| [Browser Pool Config](examples/basic/browser-pool-config.ts) | Configure browser pool for high throughput |
| [Proxy Pool](examples/basic/proxy-pool.ts)                   | Proxy rotation with multiple proxies       |
| [Cloudflare Bypass](examples/basic/cloudflare-bypass.ts)     | Scrape Cloudflare-protected sites          |
| [All Formats](examples/basic/all-formats.ts)                 | Output in markdown, html, json, text       |
| [Crawl Website](examples/basic/crawl-website.ts)             | Crawl and discover pages                   |
| [AI Tools](examples/ai-tools/)                               | OpenAI, Anthropic, LangChain integrations  |
| [Production](examples/production/)                           | Express server, job queues                 |
| [Deployment](examples/deployment/)                           | Docker, Lambda, Vercel                     |

## Development

```bash
# Install dependencies
npm install

# Run linting
npm run lint

# Format code
npm run format

# Type check
npm run typecheck

# Find TODOs
npm run todo
```

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[GPL v3](LICENSE) - See LICENSE for details.

## Citation

If you use Reader in your research or project, please cite it:

```bibtex
@software{reader.dev,
  author = {Kaul, Nihal},
  title = {Reader: Open-source, production-grade web scraping engine built for LLMs},
  year = {2026},
  publisher = {GitHub},
  url = {https://github.com/vakra-dev/reader}
}
```

## Support

- [GitHub Issues](https://github.com/vakra-dev/reader/issues)
- [Documentation](https://docs.reader.dev)
- [Discord](https://discord.gg/6tjkq7J5WV)
