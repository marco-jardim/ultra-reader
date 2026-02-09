import { CaptchaBudgetExceededError, CaptchaError, CaptchaNoProviderError } from "./errors";
import { create2CaptchaProvider } from "./providers/2captcha";
import { createCapSolverProvider } from "./providers/capsolver";
import {
  CaptchaHttpClient,
  CaptchaProvider,
  CaptchaProviderId,
  CaptchaSolverConfig,
} from "./types";

export interface CaptchaBudgetTracker {
  canSpend(domain: string, amount?: number): boolean;
  record(domain: string, amount?: number): void;
  getUsed(domain: string): number;
  getLimit(): number;
}

export class InMemoryCaptchaBudget implements CaptchaBudgetTracker {
  private readonly maxPerDomainPerDay: number;
  private readonly now: () => Date;
  private countsByDayAndDomain = new Map<string, number>();

  constructor(maxPerDomainPerDay: number, deps?: { now?: () => Date }) {
    this.maxPerDomainPerDay = maxPerDomainPerDay;
    this.now = deps?.now ?? (() => new Date());
  }

  getLimit(): number {
    return this.maxPerDomainPerDay;
  }

  getUsed(domain: string): number {
    const key = `${this.utcDayKey()}|${domain}`;
    return this.countsByDayAndDomain.get(key) ?? 0;
  }

  canSpend(domain: string, amount: number = 1): boolean {
    const used = this.getUsed(domain);
    return used + amount <= this.maxPerDomainPerDay;
  }

  record(domain: string, amount: number = 1): void {
    const key = `${this.utcDayKey()}|${domain}`;
    const used = this.countsByDayAndDomain.get(key) ?? 0;
    this.countsByDayAndDomain.set(key, used + amount);
  }

  private utcDayKey(): string {
    // YYYY-MM-DD in UTC
    return this.now().toISOString().slice(0, 10);
  }
}

export function selectProviderOrder(
  primary: CaptchaProviderId,
  fallback?: CaptchaProviderId
): CaptchaProviderId[] {
  const order: CaptchaProviderId[] = [primary];
  if (fallback && fallback !== primary) {
    order.push(fallback);
  }
  return order;
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    // Keep budget key deterministic even for invalid URLs.
    return "unknown";
  }
}

export function createMultiProvider(
  config: CaptchaSolverConfig,
  deps?: {
    httpClient?: CaptchaHttpClient;
    budgetTracker?: CaptchaBudgetTracker;
    providers?: Partial<Record<CaptchaProviderId, CaptchaProvider>>;
  }
): CaptchaProvider {
  const order = selectProviderOrder(config.primary, config.fallback);
  const budgetTracker =
    deps?.budgetTracker ??
    (config.budget ? new InMemoryCaptchaBudget(config.budget.maxPerDomainPerDay) : undefined);

  function getProvider(id: CaptchaProviderId): CaptchaProvider {
    const injected = deps?.providers?.[id];
    if (injected) return injected;

    if (id === "capsolver") {
      const providerConfig = config.providers.capsolver;
      if (!providerConfig) {
        throw new CaptchaNoProviderError("CapSolver provider not configured");
      }
      return createCapSolverProvider(providerConfig, { httpClient: deps?.httpClient });
    }
    if (id === "2captcha") {
      const providerConfig = config.providers["2captcha"];
      if (!providerConfig) {
        throw new CaptchaNoProviderError("2Captcha provider not configured");
      }
      return create2CaptchaProvider(providerConfig, { httpClient: deps?.httpClient });
    }

    const _exhaustive: never = id;
    throw new CaptchaNoProviderError(`Unknown provider: ${String(_exhaustive)}`);
  }

  return {
    id: config.primary,
    async solve(request) {
      const domain = domainFromUrl(request.pageUrl);
      if (budgetTracker) {
        if (!budgetTracker.canSpend(domain, 1)) {
          throw new CaptchaBudgetExceededError(
            domain,
            budgetTracker.getUsed(domain),
            budgetTracker.getLimit()
          );
        }
        // Count attempts (not just successes) to keep behavior predictable.
        budgetTracker.record(domain, 1);
      }

      let lastError: unknown;
      for (let i = 0; i < order.length; i++) {
        const providerId = order[i];
        let provider: CaptchaProvider;
        try {
          provider = getProvider(providerId);
        } catch (error) {
          lastError = error;
          continue;
        }

        try {
          return await provider.solve(request);
        } catch (error) {
          lastError = error;
          const retryable = error instanceof CaptchaError ? error.retryable : true;
          const hasNext = i + 1 < order.length;
          if (!hasNext || !retryable) {
            throw error;
          }
        }
      }

      if (lastError) {
        throw lastError;
      }
      throw new CaptchaNoProviderError("No CAPTCHA providers available");
    },
  };
}
