import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DomainCircuitBreaker } from "../../engines/circuit-breaker.js";

describe("DomainCircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts closed and allows requests", () => {
    const cb = new DomainCircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 1000,
      halfOpenMaxAttempts: 1,
      resetOnSuccess: true,
    });

    expect(cb.getState("example.com")).toBe("closed");
    expect(cb.canRequest("example.com")).toBe(true);
  });

  it("opens after failureThreshold failures and blocks requests", () => {
    const cb = new DomainCircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 1000,
      halfOpenMaxAttempts: 1,
      resetOnSuccess: true,
    });

    cb.recordFailure("example.com");
    cb.recordFailure("example.com");
    expect(cb.getState("example.com")).toBe("closed");

    cb.recordFailure("example.com");
    expect(cb.getState("example.com")).toBe("open");
    expect(cb.canRequest("example.com")).toBe(false);
  });

  it("transitions from open to half_open after cooldown and allows limited probe attempts", () => {
    const cb = new DomainCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 5000,
      halfOpenMaxAttempts: 2,
      resetOnSuccess: true,
    });

    cb.recordFailure("example.com");
    expect(cb.getState("example.com")).toBe("open");
    expect(cb.getCooldownRemaining("example.com")).toBe(5000);

    vi.advanceTimersByTime(4999);
    expect(cb.canRequest("example.com")).toBe(false);
    expect(cb.getState("example.com")).toBe("open");
    expect(cb.getCooldownRemaining("example.com")).toBe(1);

    vi.advanceTimersByTime(1);
    expect(cb.getState("example.com")).toBe("half_open");

    expect(cb.canRequest("example.com")).toBe(true);
    expect(cb.canRequest("example.com")).toBe(true);
    expect(cb.canRequest("example.com")).toBe(false);
  });

  it("closes and resets on success in half_open", () => {
    const cb = new DomainCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1000,
      halfOpenMaxAttempts: 1,
      resetOnSuccess: true,
    });

    cb.recordFailure("example.com");
    vi.advanceTimersByTime(1000);

    expect(cb.canRequest("example.com")).toBe(true);
    expect(cb.getState("example.com")).toBe("half_open");

    cb.recordSuccess("example.com");
    expect(cb.getState("example.com")).toBe("closed");
    expect(cb.canRequest("example.com")).toBe(true);
  });

  it("re-opens immediately on failure in half_open and restarts cooldown", () => {
    const cb = new DomainCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 2000,
      halfOpenMaxAttempts: 1,
      resetOnSuccess: true,
    });

    cb.recordFailure("example.com");
    vi.advanceTimersByTime(2000);
    expect(cb.canRequest("example.com")).toBe(true);
    expect(cb.getState("example.com")).toBe("half_open");

    cb.recordFailure("example.com");
    expect(cb.getState("example.com")).toBe("open");
    expect(cb.getCooldownRemaining("example.com")).toBe(2000);
  });

  it("reset(domain) clears only that domain; reset() clears all", () => {
    const cb = new DomainCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1000,
      halfOpenMaxAttempts: 1,
      resetOnSuccess: true,
    });

    cb.recordFailure("a.com");
    cb.recordFailure("b.com");
    expect(cb.getState("a.com")).toBe("open");
    expect(cb.getState("b.com")).toBe("open");

    cb.reset("a.com");
    expect(cb.getState("a.com")).toBe("closed");
    expect(cb.getState("b.com")).toBe("open");

    cb.reset();
    expect(cb.getState("a.com")).toBe("closed");
    expect(cb.getState("b.com")).toBe("closed");
  });

  it("when resetOnSuccess=false, successes do not clear accumulated failures in closed", () => {
    const cb = new DomainCircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 1000,
      halfOpenMaxAttempts: 1,
      resetOnSuccess: false,
    });

    cb.recordFailure("example.com");
    cb.recordSuccess("example.com");
    cb.recordFailure("example.com");
    cb.recordSuccess("example.com");
    expect(cb.getState("example.com")).toBe("closed");

    cb.recordFailure("example.com");
    expect(cb.getState("example.com")).toBe("open");
  });
});
