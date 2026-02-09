/**
 * Geo-consistent locale utilities
 *
 * Core helpers to derive a plausible locale/timezone and related headers
 * based on proxy geo hints (e.g., residential proxy country routing).
 */

export type GeoLocale = {
  /** ISO 3166-1 alpha-2 country code (usually uppercase) */
  countryCode: string;
  /** BCP-47 locale tag (e.g., en-US, pt-BR) */
  locale: string;
  /** IANA timezone ID (e.g., America/New_York) */
  timeZone: string;
  /** Realistic Accept-Language header candidates for this locale */
  acceptLanguages: readonly string[];
};

type GeoEntry = {
  locale: string;
  timeZone: string;
};

const ACCEPT_LANGUAGE_BY_LOCALE: Record<string, readonly string[]> = {
  "en-US": [
    "en-US,en;q=0.9",
    "en-US,en;q=0.9,es;q=0.8",
    "en-US,en;q=0.9,es-419;q=0.8,es;q=0.7",
    "en-US,en;q=0.9,fr;q=0.8",
    "en-US,en;q=0.9,de;q=0.8",
  ],
  "pt-BR": [
    "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "pt-BR,pt;q=0.9,en;q=0.8",
    "pt-BR,pt;q=0.9,es;q=0.7,en;q=0.6",
  ],
  "de-DE": [
    "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
    "de-DE,de;q=0.9,en;q=0.8",
    "de-DE,de;q=0.9,fr;q=0.7,en;q=0.6",
  ],
  "fr-FR": [
    "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "fr-FR,fr;q=0.9,en;q=0.8",
    "fr-FR,fr;q=0.9,es;q=0.7,en;q=0.6",
  ],
  "es-ES": [
    "es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7",
    "es-ES,es;q=0.9,en;q=0.8",
    "es-ES,es;q=0.9,pt;q=0.7,en;q=0.6",
  ],
  "en-GB": ["en-GB,en;q=0.9", "en-GB,en;q=0.9,fr;q=0.8", "en-GB,en;q=0.9,de;q=0.8"],
  "en-CA": ["en-CA,en;q=0.9,fr-CA;q=0.8,fr;q=0.7", "en-CA,en;q=0.9,fr;q=0.8", "en-CA,en;q=0.9"],
  "en-AU": ["en-AU,en;q=0.9", "en-AU,en;q=0.9,en-GB;q=0.8", "en-AU,en;q=0.9,zh-CN;q=0.7,zh;q=0.6"],
  "pt-PT": [
    "pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "pt-PT,pt;q=0.9,es;q=0.7,en;q=0.6",
    "pt-PT,pt;q=0.9,en;q=0.8",
  ],
  "it-IT": [
    "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
    "it-IT,it;q=0.9,en;q=0.8",
    "it-IT,it;q=0.9,fr;q=0.7,en;q=0.6",
  ],
  "ja-JP": [
    "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
    "ja-JP,ja;q=0.9,en;q=0.8",
    "ja-JP,ja;q=0.9,zh-CN;q=0.7,zh;q=0.6,en;q=0.5",
  ],
};

const GEO_BY_COUNTRY: Record<string, GeoEntry> = {
  US: { locale: "en-US", timeZone: "America/New_York" },
  BR: { locale: "pt-BR", timeZone: "America/Sao_Paulo" },
  DE: { locale: "de-DE", timeZone: "Europe/Berlin" },
  FR: { locale: "fr-FR", timeZone: "Europe/Paris" },
  ES: { locale: "es-ES", timeZone: "Europe/Madrid" },
  GB: { locale: "en-GB", timeZone: "Europe/London" },
  CA: { locale: "en-CA", timeZone: "America/Toronto" },
  AU: { locale: "en-AU", timeZone: "Australia/Sydney" },
  PT: { locale: "pt-PT", timeZone: "Europe/Lisbon" },
  IT: { locale: "it-IT", timeZone: "Europe/Rome" },
  JP: { locale: "ja-JP", timeZone: "Asia/Tokyo" },
};

const COUNTRY_ALIASES: Record<string, string> = {
  // Common proxy country shorthands
  UK: "GB",
};

function normalizeCountryCode(countryCode?: string): string | undefined {
  if (!countryCode) return undefined;
  const match = countryCode.trim().match(/[a-z]{2}/i);
  if (!match) return undefined;
  return match[0].toUpperCase();
}

function resolveCountryCode(countryCode?: string): string {
  const normalized = normalizeCountryCode(countryCode);
  if (!normalized) return "US";
  const aliased = COUNTRY_ALIASES[normalized] ?? normalized;
  return GEO_BY_COUNTRY[aliased] ? aliased : "US";
}

/**
 * Pick a random (realistic) Accept-Language header value for a locale.
 */
export function getRandomAcceptLanguage(locale?: string): string {
  const normalized = (locale ?? "").trim().toLowerCase();
  const localeKey = Object.keys(ACCEPT_LANGUAGE_BY_LOCALE).find(
    (k) => k.toLowerCase() === normalized
  );

  let pool: readonly string[] | undefined = localeKey
    ? ACCEPT_LANGUAGE_BY_LOCALE[localeKey]
    : undefined;

  if (!pool && normalized) {
    const base = normalized.split("-")[0];
    const fallbackLocaleByBase: Record<string, string> = {
      en: "en-US",
      pt: "pt-BR",
      de: "de-DE",
      fr: "fr-FR",
      es: "es-ES",
      it: "it-IT",
      ja: "ja-JP",
    };
    const fallbackLocale = fallbackLocaleByBase[base];
    if (fallbackLocale) pool = ACCEPT_LANGUAGE_BY_LOCALE[fallbackLocale];
  }

  pool = pool ?? ACCEPT_LANGUAGE_BY_LOCALE["en-US"];
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Return a GeoLocale (countryCode/locale/timeZone + header candidates) for a country code.
 * Unknown or missing country code falls back to US.
 */
export function getGeoLocale(countryCode?: string): GeoLocale {
  const resolvedCountry = resolveCountryCode(countryCode);
  const entry = GEO_BY_COUNTRY[resolvedCountry] ?? GEO_BY_COUNTRY.US;
  const acceptLanguages =
    ACCEPT_LANGUAGE_BY_LOCALE[entry.locale] ?? ACCEPT_LANGUAGE_BY_LOCALE["en-US"];

  return {
    countryCode: resolvedCountry,
    locale: entry.locale,
    timeZone: entry.timeZone,
    acceptLanguages,
  };
}

/**
 * Extract a 2-letter country code hint from a proxy URL.
 *
 * Supported patterns (case-insensitive):
 * - country-br
 * - _country-br
 * - geo=br
 * - cc=br
 */
export function extractProxyCountry(proxyUrl?: string): string | undefined {
  if (!proxyUrl) return undefined;

  const queryParamMatch = proxyUrl.match(/(?:[?&]|\b)(?:geo|cc)=([a-z]{2})(?:\b|[&#])/i);
  if (queryParamMatch?.[1]) return queryParamMatch[1].toUpperCase();

  const countryMatch = proxyUrl.match(/(?:^|[^a-z0-9])_?country[-_]=?([a-z]{2})(?=$|[^a-z0-9])/i);
  if (countryMatch?.[1]) return countryMatch[1].toUpperCase();

  return undefined;
}

/**
 * Generate a minimal set of geo-consistent HTTP headers (currently locale-focused).
 */
export function geoConsistentHeaders(proxyUrl?: string): Record<string, string> {
  const country = extractProxyCountry(proxyUrl);
  const geo = getGeoLocale(country);
  return {
    "Accept-Language": getRandomAcceptLanguage(geo.locale),
  };
}
