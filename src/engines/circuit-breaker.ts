export type CircuitBreakerState = "closed" | "open" | "half_open";

export type DomainCircuitBreakerConfig = {
  failureThreshold: number;
  cooldownMs: number;
  halfOpenMaxAttempts: number;
  resetOnSuccess: boolean;
};

type DomainState = {
  state: CircuitBreakerState;
  failureCount: number;
  openedAtMs: number | null;
  halfOpenAttempts: number;
};

function normalizeDomain(domain: string): string {
  const normalized = domain.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new Error("DomainCircuitBreaker: domain is required");
  }
  return normalized;
}

function validateConfig(config: DomainCircuitBreakerConfig): void {
  const { failureThreshold, cooldownMs, halfOpenMaxAttempts } = config;

  if (!Number.isFinite(failureThreshold) || failureThreshold <= 0) {
    throw new Error("DomainCircuitBreaker: failureThreshold must be > 0");
  }
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
    throw new Error("DomainCircuitBreaker: cooldownMs must be >= 0");
  }
  if (!Number.isFinite(halfOpenMaxAttempts) || halfOpenMaxAttempts <= 0) {
    throw new Error("DomainCircuitBreaker: halfOpenMaxAttempts must be > 0");
  }
}

/**
 * Standalone per-domain circuit breaker.
 *
 * States:
 * - closed: requests allowed; failures are counted
 * - open: requests blocked until cooldown expires
 * - half_open: a limited number of probe attempts are allowed
 */
export class DomainCircuitBreaker {
  private readonly config: DomainCircuitBreakerConfig;
  private readonly domains = new Map<string, DomainState>();

  constructor(config: DomainCircuitBreakerConfig) {
    validateConfig(config);
    this.config = config;
  }

  canRequest(domain: string): boolean {
    const key = normalizeDomain(domain);
    const now = Date.now();
    const state = this.getOrInitDomainState(key);
    this.syncState(state, now);

    if (state.state === "open") {
      return false;
    }

    if (state.state === "half_open") {
      if (state.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        return false;
      }
      state.halfOpenAttempts += 1;
      return true;
    }

    return true;
  }

  recordSuccess(domain: string): void {
    const key = normalizeDomain(domain);
    const state = this.getOrInitDomainState(key);
    const now = Date.now();
    this.syncState(state, now);

    if (state.state === "half_open" || state.state === "open") {
      state.state = "closed";
      state.failureCount = 0;
      state.openedAtMs = null;
      state.halfOpenAttempts = 0;
      return;
    }

    if (this.config.resetOnSuccess) {
      state.failureCount = 0;
    }
  }

  recordFailure(domain: string): void {
    const key = normalizeDomain(domain);
    const state = this.getOrInitDomainState(key);
    const now = Date.now();
    this.syncState(state, now);

    state.failureCount += 1;

    if (state.state === "half_open") {
      // Any failure in half-open immediately re-opens.
      state.state = "open";
      state.openedAtMs = now;
      state.halfOpenAttempts = 0;
      return;
    }

    if (state.state === "open") {
      // Keep it open and extend the cooldown window.
      state.openedAtMs = now;
      state.halfOpenAttempts = 0;
      return;
    }

    if (state.failureCount >= this.config.failureThreshold) {
      state.state = "open";
      state.openedAtMs = now;
      state.halfOpenAttempts = 0;
    }
  }

  getState(domain: string): CircuitBreakerState {
    const key = normalizeDomain(domain);
    const state = this.domains.get(key);
    if (!state) {
      return "closed";
    }
    this.syncState(state, Date.now());
    return state.state;
  }

  getCooldownRemaining(domain: string): number {
    const key = normalizeDomain(domain);
    const state = this.domains.get(key);
    if (!state) {
      return 0;
    }

    const now = Date.now();
    this.syncState(state, now);

    if (state.state !== "open" || state.openedAtMs === null) {
      return 0;
    }

    const elapsed = now - state.openedAtMs;
    return Math.max(0, this.config.cooldownMs - elapsed);
  }

  reset(domain?: string): void {
    if (domain === undefined) {
      this.domains.clear();
      return;
    }
    const key = normalizeDomain(domain);
    this.domains.delete(key);
  }

  private getOrInitDomainState(domainKey: string): DomainState {
    const existing = this.domains.get(domainKey);
    if (existing) {
      return existing;
    }

    const initial: DomainState = {
      state: "closed",
      failureCount: 0,
      openedAtMs: null,
      halfOpenAttempts: 0,
    };
    this.domains.set(domainKey, initial);
    return initial;
  }

  private syncState(state: DomainState, nowMs: number): void {
    if (state.state !== "open") {
      return;
    }
    if (state.openedAtMs === null) {
      return;
    }
    if (this.config.cooldownMs === 0) {
      state.state = "half_open";
      state.openedAtMs = null;
      state.halfOpenAttempts = 0;
      return;
    }

    const elapsed = nowMs - state.openedAtMs;
    if (elapsed >= this.config.cooldownMs) {
      state.state = "half_open";
      state.openedAtMs = null;
      state.halfOpenAttempts = 0;
    }
  }
}
