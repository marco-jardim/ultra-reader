import { describe, it, expect } from "vitest";
import {
  FINGERPRINT_PROFILES,
  getFingerprintRotator,
  getRandomFingerprintProfile,
} from "../../utils/fingerprint-profiles.js";

function collect<T>(n: number, fn: () => T): T[] {
  return Array.from({ length: n }, fn);
}

describe("getRandomFingerprintProfile", () => {
  it("returns one of the curated profiles", () => {
    const p = getRandomFingerprintProfile("seed");
    expect(FINGERPRINT_PROFILES.map((x) => x.id)).toContain(p.id);
  });

  it("is deterministic for the same seed", () => {
    const a = getRandomFingerprintProfile("hello");
    const b = getRandomFingerprintProfile("hello");
    expect(a.id).toBe(b.id);
  });

  it("returns different results for different numeric seeds when pool size > 1", () => {
    expect(FINGERPRINT_PROFILES.length).toBeGreaterThan(1);
    const a = getRandomFingerprintProfile(0);
    const b = getRandomFingerprintProfile(1);
    expect(a.id).not.toBe(b.id);
  });
});

describe("getFingerprintRotator", () => {
  it("produces the same sequence for the same seed", () => {
    const r1 = getFingerprintRotator(1234);
    const r2 = getFingerprintRotator(1234);
    const s1 = collect(FINGERPRINT_PROFILES.length * 2, () => r1.next().id);
    const s2 = collect(FINGERPRINT_PROFILES.length * 2, () => r2.next().id);
    expect(s1).toEqual(s2);
  });

  it("cycles through all profiles without repetition within one full cycle (seeded)", () => {
    const rotator = getFingerprintRotator("cycle-test");
    const ids = collect(FINGERPRINT_PROFILES.length, () => rotator.next().id);
    expect(new Set(ids).size).toBe(FINGERPRINT_PROFILES.length);
  });

  it("reset() restarts the cycle", () => {
    const rotator = getFingerprintRotator("reset-test");
    const first = rotator.next().id;
    rotator.next();
    rotator.reset();
    expect(rotator.next().id).toBe(first);
  });
});
