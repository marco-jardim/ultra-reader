import type { ProxyConfig } from "../types";
import { createProxyUrl } from "../proxy/config";
import { extractProxyCountry, getGeoLocale } from "../utils/geo-locale";
import { getFingerprintRotator, type FingerprintRotator } from "../utils/fingerprint-profiles";

function isEnvTrue(value?: string): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

let cachedFingerprintRotator: FingerprintRotator | null = null;
function getHeroFingerprintRotator(): FingerprintRotator {
  if (cachedFingerprintRotator) return cachedFingerprintRotator;

  const seed =
    typeof process !== "undefined"
      ? (process.env.HERO_FINGERPRINT_SEED as string | undefined)
      : undefined;
  cachedFingerprintRotator = getFingerprintRotator(seed);
  return cachedFingerprintRotator;
}

/**
 * Hero configuration options
 */
export interface HeroConfigOptions {
  /** Proxy configuration */
  proxy?: ProxyConfig;
  /** Show Chrome window (default: false) */
  showChrome?: boolean;
  /** Custom user agent */
  userAgent?: string;
  /** Connection to Core (for in-process Core) */
  connectionToCore?: any;
}

/**
 * Create Hero configuration with optimal anti-bot bypass settings
 *
 * Extracted from proven hero-test implementation.
 * Includes:
 * - TLS fingerprint emulation (disableMitm: false)
 * - DNS over TLS (mimics Chrome)
 * - WebRTC IP masking
 * - Proper locale and timezone
 *
 * @param options - Configuration options
 * @returns Hero configuration object
 */
export function createHeroConfig(options: HeroConfigOptions = {}): any {
  const proxyUrl = options.proxy ? createProxyUrl(options.proxy) : undefined;
  const geo = getGeoLocale(extractProxyCountry(proxyUrl));

  const config: any = {
    // Show or hide Chrome window
    showChrome: options.showChrome ?? false,

    // ============================================================================
    // CRITICAL: TLS fingerprint emulation
    // ============================================================================
    // Setting disableMitm to false enables TLS/TCP fingerprint emulation
    // This is ESSENTIAL for bypassing Cloudflare and other anti-bot systems
    disableMitm: false,

    // ============================================================================
    // Session management
    // ============================================================================
    // Use incognito for clean session state
    disableIncognito: false,

    // ============================================================================
    // Docker compatibility
    // ============================================================================
    // Required when running in containerized environments
    noChromeSandbox: true,

    // ============================================================================
    // DNS over TLS (mimics Chrome behavior)
    // ============================================================================
    // Using Cloudflare's DNS (1.1.1.1) over TLS makes the connection
    // look more like a real Chrome browser
    dnsOverTlsProvider: {
      host: "1.1.1.1",
      servername: "cloudflare-dns.com",
    },

    // ============================================================================
    // WebRTC IP leak prevention
    // ============================================================================
    // Masks the real IP address in WebRTC connections
    // Uses ipify.org to detect the public IP
    upstreamProxyIpMask: {
      ipLookupService: "https://api.ipify.org?format=json",
    },

    // ============================================================================
    // Locale and timezone
    // ============================================================================
    locale: geo.locale,
    timezoneId: geo.timeZone,

    // ============================================================================
    // Viewport (standard desktop size)
    // ============================================================================
    viewport: {
      width: 1920,
      height: 1080,
    },

    // ============================================================================
    // Connection to Core (if provided)
    // ============================================================================
    ...(options.connectionToCore && { connectionToCore: options.connectionToCore }),
  };

  // ============================================================================
  // Proxy configuration
  // ============================================================================
  if (options.proxy) {
    config.upstreamProxyUrl = proxyUrl;
    // Don't use system DNS when using proxy
    config.upstreamProxyUseSystemDns = false;
  }

  // ============================================================================
  // User agent / fingerprint profile (optional)
  // ============================================================================
  // NOTE: UA rotation exists elsewhere in the stack; do not override an explicit UA.
  if (options.userAgent) {
    config.userAgent = options.userAgent;
  } else {
    const fingerprintRotationEnabled =
      typeof process !== "undefined" && isEnvTrue(process.env.HERO_FINGERPRINT_ROTATION);

    if (fingerprintRotationEnabled) {
      const fp = getHeroFingerprintRotator().next();
      config.userAgent = fp.ua;
      config.viewport = {
        width: fp.viewport.width,
        height: fp.viewport.height,
      };

      // TODO(phase-?): If/when Hero exposes a safe platform override, wire fp.platform here.
      // Keep geo-derived locale/timezone (above) to avoid proxy/geo inconsistencies.
    }
  }

  return config;
}

/**
 * Default Hero configuration (no proxy)
 */
export function getDefaultHeroConfig(): any {
  return createHeroConfig();
}
