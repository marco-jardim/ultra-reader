import pLimit from "p-limit";

/**
 * Generate a random delay with jitter around a base value.
 * Uses uniform distribution: [base * (1 - jitterFactor), base * (1 + jitterFactor)]
 */
export function jitteredDelay(baseMs: number, jitterFactor: number = 0.5): number {
  const min = baseMs * (1 - jitterFactor);
  const max = baseMs * (1 + jitterFactor);
  return Math.floor(min + Math.random() * (max - min));
}

/**
 * Simple rate limit function with optional jitter.
 * @param ms - Base delay in milliseconds
 * @param jitter - Jitter factor (0-1). 0 = exact delay, 0.5 = ±50% variation
 */
export async function rateLimit(ms: number, jitter: number = 0): Promise<void> {
  const delay = jitter > 0 ? jitteredDelay(ms, jitter) : ms;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Rate limiter with jitter and optional crawl-delay support.
 * Uses p-limit for serialization, adds randomized timing between requests
 * to avoid detection by anti-bot systems that look for uniform request intervals.
 */
export class RateLimiter {
  private limit: ReturnType<typeof pLimit>;
  private requestsPerSecond: number;
  private lastRequestTime = 0;
  private jitterFactor: number;
  private crawlDelayMs: number | null;

  /**
   * @param requestsPerSecond - Maximum requests per second
   * @param options.jitterFactor - Randomization factor (0-1). Default 0.3 = ±30%
   * @param options.crawlDelayMs - Robots.txt Crawl-Delay in ms. Takes precedence over requestsPerSecond.
   */
  constructor(
    requestsPerSecond: number,
    options: { jitterFactor?: number; crawlDelayMs?: number | null } = {}
  ) {
    this.limit = pLimit(1);
    this.requestsPerSecond = requestsPerSecond;
    this.jitterFactor = options.jitterFactor ?? 0.3;
    this.crawlDelayMs = options.crawlDelayMs ?? null;
  }

  /**
   * Execute a function with rate limiting and jitter
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return this.limit(async () => {
      await this.waitForNextSlot();
      return fn();
    });
  }

  /**
   * Wait for the next available time slot, with jitter applied.
   * If crawlDelay is set, it takes precedence over requestsPerSecond.
   */
  private async waitForNextSlot(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    // crawlDelay from robots.txt takes precedence
    const minInterval = this.crawlDelayMs ?? 1000 / this.requestsPerSecond;

    if (timeSinceLastRequest < minInterval) {
      const baseDelay = minInterval - timeSinceLastRequest;
      const delay = jitteredDelay(baseDelay, this.jitterFactor);
      await new Promise((resolve) => setTimeout(resolve, delay));
    } else if (this.jitterFactor > 0) {
      // Even when enough time has passed, add small random micro-delay
      // to avoid perfectly regular request patterns
      const microDelay = jitteredDelay(50, this.jitterFactor);
      if (microDelay > 10) {
        await new Promise((resolve) => setTimeout(resolve, microDelay));
      }
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Update crawl delay (e.g., after reading robots.txt)
   */
  setCrawlDelay(delayMs: number | null): void {
    this.crawlDelayMs = delayMs;
  }

  /**
   * Execute multiple functions concurrently with rate limiting
   */
  async executeAll<T>(functions: Array<() => Promise<T>>): Promise<T[]> {
    return Promise.all(functions.map((fn) => this.execute(fn)));
  }
}
