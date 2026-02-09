/**
 * Minimal browser fingerprint profile pool (Phase 2.5 - library only).
 *
 * These profiles are intentionally small but internally consistent.
 */

export type FingerprintSeed = string | number;

export interface FingerprintViewport {
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
  readonly isMobile: boolean;
  readonly hasTouch: boolean;
}

export interface FingerprintProfile {
  /** Stable identifier for debugging/logging */
  readonly id: string;

  /** User-Agent string */
  readonly ua: string;

  /** navigator.platform-style value (placeholder; will be applied in Hero config later) */
  readonly platform: string;

  /** Viewport parameters (placeholder; will be applied in Hero config later) */
  readonly viewport: FingerprintViewport;

  /** BCP-47 locale tag (placeholder; will be applied in Hero config later) */
  readonly locale: string;

  /** IANA timezone id (placeholder; will be applied in Hero config later) */
  readonly timezoneId: string;
}

export const FINGERPRINT_PROFILES: readonly FingerprintProfile[] = [
  {
    id: "chrome-win-en-us-1080p",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "Win32",
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    locale: "en-US",
    timezoneId: "America/New_York",
  },
  {
    id: "edge-win-en-gb-1080p",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    platform: "Win32",
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    locale: "en-GB",
    timezoneId: "Europe/London",
  },
  {
    id: "chrome-mac-en-us-mbp",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "MacIntel",
    viewport: { width: 1440, height: 900, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  },
  {
    id: "safari-mac-fr-fr-mbp",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    platform: "MacIntel",
    viewport: { width: 1440, height: 900, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  },
  {
    id: "firefox-linux-de-de-768p",
    ua: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
    platform: "Linux x86_64",
    viewport: { width: 1366, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  },
  {
    id: "ios-safari-en-us-iphone",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    platform: "iPhone",
    viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    locale: "en-US",
    timezoneId: "America/Chicago",
  },
] as const;

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function toUint32(seed: FingerprintSeed): number {
  return typeof seed === "number" ? seed >>> 0 : fnv1a32(seed);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function selectIndex(len: number, rnd: () => number): number {
  return Math.floor(rnd() * len);
}

function seededShuffle<T>(items: readonly T[], seed: FingerprintSeed): T[] {
  const rnd = mulberry32(toUint32(seed));
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Deterministically pick a profile when a seed is provided.
 */
export function getRandomFingerprintProfile(seed?: FingerprintSeed): FingerprintProfile {
  if (FINGERPRINT_PROFILES.length === 0) {
    throw new Error("FINGERPRINT_PROFILES is empty");
  }

  if (seed !== undefined) {
    const idx = toUint32(seed) % FINGERPRINT_PROFILES.length;
    return FINGERPRINT_PROFILES[idx];
  }

  return FINGERPRINT_PROFILES[selectIndex(FINGERPRINT_PROFILES.length, Math.random)];
}

export interface FingerprintRotator {
  next(): FingerprintProfile;
  reset(): void;
}

class SeededFingerprintRotator implements FingerprintRotator {
  private readonly order: readonly FingerprintProfile[];
  private index = 0;

  constructor(seed?: FingerprintSeed) {
    if (seed === undefined) {
      const arr = [...FINGERPRINT_PROFILES];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      this.order = arr;
      return;
    }

    this.order = seededShuffle(FINGERPRINT_PROFILES, seed);
  }

  next(): FingerprintProfile {
    if (this.order.length === 0) {
      throw new Error("FINGERPRINT_PROFILES is empty");
    }
    const profile = this.order[this.index % this.order.length];
    this.index = (this.index + 1) % this.order.length;
    return profile;
  }

  reset(): void {
    this.index = 0;
  }
}

/**
 * Create a rotator that cycles through profiles in a deterministic order.
 *
 * Pass a seed for a stable shuffled order (useful for tests / reproducibility).
 */
export function getFingerprintRotator(seed?: FingerprintSeed): FingerprintRotator {
  return new SeededFingerprintRotator(seed);
}
