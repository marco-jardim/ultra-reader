import type { WafCategory, WafDetection, WafProvider } from "./types.js";

export interface WafDetectInput {
  url?: string;
  statusCode?: number;
  headers?: Record<string, string>;
  html?: string;
}

function normHeaders(headers?: Record<string, string>): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = String(v ?? "");
  }
  return out;
}

function includesAny(haystack: string, needles: string[]): string | null {
  const lower = haystack.toLowerCase();
  for (const n of needles) {
    if (lower.includes(n.toLowerCase())) return n;
  }
  return null;
}

function headerIncludes(
  headers: Record<string, string>,
  name: string,
  valueSubstr: string
): boolean {
  const v = headers[name.toLowerCase()];
  if (!v) return false;
  return v.toLowerCase().includes(valueSubstr.toLowerCase());
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Boolean(headers[name.toLowerCase()]);
}

function classifyCategory(statusCode?: number, htmlLower?: string): WafCategory {
  if (statusCode === 429) return "rate_limit";
  const h = htmlLower ?? "";
  if (h.includes("turnstile") || h.includes("recaptcha") || h.includes("hcaptcha"))
    return "captcha";
  if (
    h.includes("access denied") ||
    h.includes("you have been blocked") ||
    h.includes("request blocked")
  ) {
    return "block";
  }
  return "challenge";
}

function shouldReturnDetection(infraSignals: string[], actionSignals: string[]): boolean {
  // Avoid infra-only false positives: only return when a challenge/block/captcha/rate-limit is likely.
  if (actionSignals.length === 0) return false;
  // If we have no infra signals, require stronger action evidence.
  if (infraSignals.length === 0) return actionSignals.length >= 2;
  return true;
}

function build(
  provider: WafProvider,
  category: WafCategory,
  confidence: number,
  signals: string[]
): WafDetection {
  return {
    provider,
    category,
    confidence: Math.max(0, Math.min(1, confidence)),
    signals,
  };
}

export function detectWaf(input: WafDetectInput): WafDetection | null {
  const headers = normHeaders(input.headers);
  const htmlLower = (input.html ?? "").toLowerCase();
  const statusCode = input.statusCode;

  // Cloudflare
  {
    const infraSignals: string[] = [];
    const actionSignals: string[] = [];
    if (hasHeader(headers, "cf-ray")) infraSignals.push("hdr:cf-ray");
    if (headerIncludes(headers, "server", "cloudflare")) infraSignals.push("hdr:server=cloudflare");
    if (headerIncludes(headers, "set-cookie", "__cf_bm")) infraSignals.push("cookie:__cf_bm");
    if (headerIncludes(headers, "set-cookie", "cf_clearance"))
      infraSignals.push("cookie:cf_clearance");
    if (hasHeader(headers, "cf-mitigated")) actionSignals.push("hdr:cf-mitigated");

    // Challenge pages: prefer specific Cloudflare challenge paths/strings.
    if (htmlLower.includes("/cdn-cgi/challenge-platform/"))
      actionSignals.push("html:cf-challenge-platform");
    if (htmlLower.includes("just a moment")) actionSignals.push("html:just-a-moment");
    if (htmlLower.includes("checking your browser"))
      actionSignals.push("html:checking-your-browser");
    if ((statusCode ?? 0) >= 400 && htmlLower.includes("ray id")) actionSignals.push("html:ray-id");
    if (includesAny(htmlLower, ["error 1015", "you are being rate limited"]))
      actionSignals.push("html:rate-limited");

    const signals = [...infraSignals, ...actionSignals];
    if (shouldReturnDetection(infraSignals, actionSignals)) {
      return build("cloudflare", classifyCategory(statusCode, htmlLower), 0.9, signals);
    }
  }

  // Akamai (Bot Manager)
  {
    const infraSignals: string[] = [];
    const actionSignals: string[] = [];
    if (headerIncludes(headers, "server", "akamai")) infraSignals.push("hdr:server=akamai");
    if (headerIncludes(headers, "server", "akamaighost"))
      infraSignals.push("hdr:server=AkamaiGHost");
    if (headerIncludes(headers, "set-cookie", "ak_bmsc")) infraSignals.push("cookie:ak_bmsc");
    if (headerIncludes(headers, "set-cookie", "bm_sz")) infraSignals.push("cookie:bm_sz");
    if (includesAny(htmlLower, ["reference #", "akamaighost"]))
      actionSignals.push("html:akamai-marker");
    if (htmlLower.includes("access denied") && infraSignals.length > 0)
      actionSignals.push("html:access-denied");

    const signals = [...infraSignals, ...actionSignals];
    if (shouldReturnDetection(infraSignals, actionSignals)) {
      return build("akamai", classifyCategory(statusCode, htmlLower), 0.8, signals);
    }
  }

  // DataDome
  {
    const infraSignals: string[] = [];
    const actionSignals: string[] = [];
    if (headerIncludes(headers, "set-cookie", "datadome")) infraSignals.push("cookie:datadome");
    if (hasHeader(headers, "x-datadome")) infraSignals.push("hdr:x-datadome");
    if (includesAny(htmlLower, ["ddos protection by datadome", "captcha-delivery.com"]))
      actionSignals.push("html:datadome");

    const signals = [...infraSignals, ...actionSignals];
    if (shouldReturnDetection(infraSignals, actionSignals)) {
      return build("datadome", classifyCategory(statusCode, htmlLower), 0.8, signals);
    }
  }

  // PerimeterX
  {
    const infraSignals: string[] = [];
    const actionSignals: string[] = [];
    if (headerIncludes(headers, "set-cookie", "_px3")) infraSignals.push("cookie:_px3");
    if (headerIncludes(headers, "set-cookie", "_pxhd")) infraSignals.push("cookie:_pxhd");
    if (hasHeader(headers, "x-px")) infraSignals.push("hdr:x-px");
    if (includesAny(htmlLower, ["perimeterx", "px-captcha"])) actionSignals.push("html:px-marker");

    const signals = [...infraSignals, ...actionSignals];
    if (shouldReturnDetection(infraSignals, actionSignals)) {
      return build("perimeterx", classifyCategory(statusCode, htmlLower), 0.8, signals);
    }
  }

  // Imperva / Incapsula
  {
    const infraSignals: string[] = [];
    const actionSignals: string[] = [];
    if (headerIncludes(headers, "set-cookie", "incap_ses")) infraSignals.push("cookie:incap_ses");
    if (headerIncludes(headers, "set-cookie", "visid_incap"))
      infraSignals.push("cookie:visid_incap");
    if (hasHeader(headers, "x-iinfo")) infraSignals.push("hdr:x-iinfo");
    if (headerIncludes(headers, "x-cdn", "incapsula")) infraSignals.push("hdr:x-cdn=incapsula");
    if (includesAny(htmlLower, ["incident id", "powered by incapsula"]))
      actionSignals.push("html:incapsula");

    const signals = [...infraSignals, ...actionSignals];
    if (shouldReturnDetection(infraSignals, actionSignals)) {
      return build("imperva", classifyCategory(statusCode, htmlLower), 0.75, signals);
    }
  }

  // Sucuri
  {
    const infraSignals: string[] = [];
    const actionSignals: string[] = [];
    if (hasHeader(headers, "x-sucuri-id")) infraSignals.push("hdr:x-sucuri-id");
    if (headerIncludes(headers, "server", "sucuri")) infraSignals.push("hdr:server=sucuri");
    if (
      includesAny(htmlLower, ["sucuri website firewall", "access denied - sucuri website firewall"])
    ) {
      actionSignals.push("html:sucuri");
    }

    const signals = [...infraSignals, ...actionSignals];
    if (shouldReturnDetection(infraSignals, actionSignals)) {
      return build("sucuri", classifyCategory(statusCode, htmlLower), 0.75, signals);
    }
  }

  return null;
}

export function formatWafChallengeType(waf: WafDetection): string {
  // Keep simple string for logging and tests; orchestrator can parse prefix.
  if (waf.provider === "cloudflare") {
    // Preserve existing semantics used across the repo.
    if (waf.category === "captcha") return "cloudflare-captcha";
    if (waf.category === "rate_limit") return "cloudflare-rate-limit";
    if (waf.category === "block") return "cloudflare-blocked";
    return "cloudflare";
  }
  return `waf:${waf.provider}:${waf.category}`;
}
