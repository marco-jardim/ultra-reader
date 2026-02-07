/**
 * User-Agent rotation pool for anti-detection
 *
 * Provides a pool of modern, real-world User-Agent strings and rotation
 * strategies to avoid fingerprint-based blocking.
 *
 * @module
 */

/**
 * Modern desktop User-Agent strings — updated Q4 2024
 *
 * Each entry represents a real browser version observed in the wild.
 * Grouped by browser family for weighted selection.
 */
const CHROME_WINDOWS: readonly string[] = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
] as const;

const CHROME_MAC: readonly string[] = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
] as const;

const CHROME_LINUX: readonly string[] = [
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
] as const;

const FIREFOX_WINDOWS: readonly string[] = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
] as const;

const FIREFOX_MAC: readonly string[] = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0",
] as const;

const FIREFOX_LINUX: readonly string[] = [
  "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
] as const;

const EDGE_WINDOWS: readonly string[] = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
] as const;

const SAFARI_MAC: readonly string[] = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
] as const;

/**
 * Browser family with usage weight (roughly matching real-world market share)
 */
interface BrowserFamily {
  readonly name: string;
  readonly weight: number;
  readonly agents: readonly string[];
}

const BROWSER_FAMILIES: readonly BrowserFamily[] = [
  { name: "chrome-windows", weight: 40, agents: CHROME_WINDOWS },
  { name: "chrome-mac", weight: 18, agents: CHROME_MAC },
  { name: "chrome-linux", weight: 4, agents: CHROME_LINUX },
  { name: "edge-windows", weight: 12, agents: EDGE_WINDOWS },
  { name: "firefox-windows", weight: 8, agents: FIREFOX_WINDOWS },
  { name: "firefox-mac", weight: 4, agents: FIREFOX_MAC },
  { name: "firefox-linux", weight: 3, agents: FIREFOX_LINUX },
  { name: "safari-mac", weight: 11, agents: SAFARI_MAC },
] as const;

/** Flat array of all available UAs */
const ALL_USER_AGENTS: string[] = BROWSER_FAMILIES.flatMap((f) => [...f.agents]);

/** Pre-computed cumulative weights for weighted random selection */
const CUMULATIVE_WEIGHTS: number[] = (() => {
  const weights: number[] = [];
  let sum = 0;
  for (const family of BROWSER_FAMILIES) {
    sum += family.weight;
    weights.push(sum);
  }
  return weights;
})();

const TOTAL_WEIGHT = CUMULATIVE_WEIGHTS[CUMULATIVE_WEIGHTS.length - 1];

/**
 * UA rotation strategy
 */
export type UaRotationStrategy = "random" | "weighted" | "round-robin" | "per-domain";

/**
 * Options for the UA rotator
 */
export interface UaRotatorOptions {
  /** Rotation strategy (default: "weighted") */
  strategy?: UaRotationStrategy;

  /** Lock UA per domain for session consistency (default: true) */
  stickyPerDomain?: boolean;

  /** Custom UA pool to use instead of built-in */
  customPool?: string[];
}

/**
 * User-Agent rotator with multiple strategies
 */
export class UserAgentRotator {
  private readonly strategy: UaRotationStrategy;
  private readonly stickyPerDomain: boolean;
  private readonly pool: readonly string[];
  private roundRobinIndex = 0;
  private domainMap = new Map<string, string>();

  constructor(options: UaRotatorOptions = {}) {
    this.strategy = options.strategy ?? "weighted";
    this.stickyPerDomain = options.stickyPerDomain ?? true;
    this.pool = options.customPool ?? ALL_USER_AGENTS;
  }

  /**
   * Get a User-Agent string, optionally sticky per domain
   */
  get(url?: string): string {
    if (url && this.stickyPerDomain) {
      return this.getForDomain(url);
    }
    return this.select();
  }

  /**
   * Get a UA sticky to a domain — same domain always gets the same UA
   * within a session (until reset)
   */
  private getForDomain(url: string): string {
    let domain: string;
    try {
      domain = new URL(url).hostname;
    } catch {
      return this.select();
    }

    const existing = this.domainMap.get(domain);
    if (existing) return existing;

    const ua = this.select();
    // LRU eviction: prevent unbounded growth
    const MAX_DOMAIN_ENTRIES = 5000;
    if (this.domainMap.size >= MAX_DOMAIN_ENTRIES) {
      // Delete oldest entry (first inserted in Map iteration order)
      const firstKey = this.domainMap.keys().next().value;
      if (firstKey) this.domainMap.delete(firstKey);
    }
    this.domainMap.set(domain, ua);
    return ua;
  }

  /**
   * Select a UA based on the current strategy
   */
  private select(): string {
    switch (this.strategy) {
      case "random":
        return this.pool[Math.floor(Math.random() * this.pool.length)];

      case "weighted":
        return this.selectWeighted();

      case "round-robin": {
        const ua = this.pool[this.roundRobinIndex % this.pool.length];
        this.roundRobinIndex = (this.roundRobinIndex + 1) % this.pool.length;
        return ua;
      }

      case "per-domain":
        // Same as weighted when no domain context
        return this.selectWeighted();

      default:
        return this.selectWeighted();
    }
  }

  /**
   * Weighted random selection based on real-world browser market share
   */
  private selectWeighted(): string {
    if (this.pool !== ALL_USER_AGENTS) {
      // Custom pool — fall back to uniform random
      return this.pool[Math.floor(Math.random() * this.pool.length)];
    }

    const r = Math.random() * TOTAL_WEIGHT;
    for (let i = 0; i < CUMULATIVE_WEIGHTS.length; i++) {
      if (r < CUMULATIVE_WEIGHTS[i]) {
        const family = BROWSER_FAMILIES[i];
        return family.agents[Math.floor(Math.random() * family.agents.length)];
      }
    }

    // Fallback (shouldn't reach here)
    return CHROME_WINDOWS[0];
  }

  /**
   * Clear sticky domain mappings (useful between sessions)
   */
  reset(): void {
    this.domainMap.clear();
    this.roundRobinIndex = 0;
  }

  /**
   * Get the browser family name for a given UA string
   */
  static identifyFamily(ua: string): string {
    if (ua.includes("Edg/")) return "edge";
    if (ua.includes("Firefox/")) return "firefox";
    if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "safari";
    if (ua.includes("Chrome/")) return "chrome";
    return "unknown";
  }

  /**
   * Get consistent Sec-CH-UA headers for a given User-Agent
   * (Client Hints that modern sites check for consistency)
   */
  static getClientHints(ua: string): Record<string, string> {
    const family = UserAgentRotator.identifyFamily(ua);

    switch (family) {
      case "chrome": {
        const match = ua.match(/Chrome\/(\d+)/);
        const version = match?.[1] ?? "131";
        return {
          "Sec-CH-UA": `"Chromium";v="${version}", "Google Chrome";v="${version}", "Not-A.Brand";v="99"`,
          "Sec-CH-UA-Mobile": "?0",
          "Sec-CH-UA-Platform": ua.includes("Windows")
            ? '"Windows"'
            : ua.includes("Mac")
              ? '"macOS"'
              : '"Linux"',
        };
      }
      case "edge": {
        const match = ua.match(/Edg\/(\d+)/);
        const version = match?.[1] ?? "131";
        const chromeMatch = ua.match(/Chrome\/(\d+)/);
        const chromeVer = chromeMatch?.[1] ?? version;
        return {
          "Sec-CH-UA": `"Chromium";v="${chromeVer}", "Microsoft Edge";v="${version}", "Not-A.Brand";v="99"`,
          "Sec-CH-UA-Mobile": "?0",
          "Sec-CH-UA-Platform": '"Windows"',
        };
      }
      default:
        // Firefox and Safari don't send Sec-CH-UA
        return {};
    }
  }
}

/**
 * Generate a plausible Referer header for a URL
 *
 * Simulates organic traffic by choosing between search engines,
 * direct navigation, and social media referrers.
 */
export function generateReferer(url: string): string | undefined {
  const r = Math.random();

  if (r < 0.4) {
    // 40% — Google search
    try {
      const domain = new URL(url).hostname;
      const query = domain.replace(/^www\./, "").split(".")[0];
      return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    } catch {
      return "https://www.google.com/";
    }
  }

  if (r < 0.55) {
    // 15% — Direct (no referer)
    return undefined;
  }

  if (r < 0.7) {
    // 15% — Google (generic)
    return "https://www.google.com/";
  }

  if (r < 0.8) {
    // 10% — Bing
    return "https://www.bing.com/";
  }

  if (r < 0.88) {
    // 8% — DuckDuckGo
    return "https://duckduckgo.com/";
  }

  if (r < 0.93) {
    // 5% — Twitter/X
    return "https://t.co/";
  }

  if (r < 0.97) {
    // 4% — Reddit
    return "https://www.reddit.com/";
  }

  // 3% — LinkedIn
  return "https://www.linkedin.com/";
}

/** Default shared rotator instance */
let defaultRotator: UserAgentRotator | null = null;

/**
 * Get the default shared UserAgentRotator instance
 */
export function getDefaultRotator(): UserAgentRotator {
  if (!defaultRotator) {
    defaultRotator = new UserAgentRotator({ strategy: "weighted", stickyPerDomain: true });
  }
  return defaultRotator;
}

/**
 * Configure the default shared rotator (call before scraping begins)
 */
export function configureDefaultRotator(options: UaRotatorOptions): void {
  defaultRotator = new UserAgentRotator(options);
}

/**
 * Quick helper: get a random UA string
 */
export function getRandomUserAgent(url?: string): string {
  return getDefaultRotator().get(url);
}
