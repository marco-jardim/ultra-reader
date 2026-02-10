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
    const signals: string[] = [];
    if (hasHeader(headers, "cf-ray")) signals.push("hdr:cf-ray");
    if (headerIncludes(headers, "server", "cloudflare")) signals.push("hdr:server=cloudflare");
    if (headerIncludes(headers, "set-cookie", "__cf_bm")) signals.push("cookie:__cf_bm");
    if (headerIncludes(headers, "set-cookie", "cf_clearance")) signals.push("cookie:cf_clearance");
    if (htmlLower.includes("/cdn-cgi/")) signals.push("html:/cdn-cgi/");
    if (htmlLower.includes("challenge-platform")) signals.push("html:challenge-platform");
    if (htmlLower.includes("just a moment")) signals.push("html:just-a-moment");
    if (htmlLower.includes("performance & security by cloudflare")) signals.push("html:cf-footer");

    if (signals.length >= 2) {
      return build("cloudflare", classifyCategory(statusCode, htmlLower), 0.9, signals);
    }
  }

  // Akamai (Bot Manager)
  {
    const signals: string[] = [];
    if (headerIncludes(headers, "server", "akamai")) signals.push("hdr:server=akamai");
    if (headerIncludes(headers, "server", "akamaighost")) signals.push("hdr:server=AkamaiGHost");
    if (headerIncludes(headers, "set-cookie", "ak_bmsc")) signals.push("cookie:ak_bmsc");
    if (headerIncludes(headers, "set-cookie", "bm_sz")) signals.push("cookie:bm_sz");
    if (includesAny(htmlLower, ["akamaighost", "reference #", "access denied"]))
      signals.push("html:akamai-marker");

    if (signals.length >= 2) {
      return build("akamai", classifyCategory(statusCode, htmlLower), 0.8, signals);
    }
  }

  // DataDome
  {
    const signals: string[] = [];
    if (headerIncludes(headers, "set-cookie", "datadome")) signals.push("cookie:datadome");
    if (hasHeader(headers, "x-datadome")) signals.push("hdr:x-datadome");
    if (includesAny(htmlLower, ["datadome", "ddos protection by datadome"]))
      signals.push("html:datadome");

    if (signals.length >= 2) {
      return build("datadome", classifyCategory(statusCode, htmlLower), 0.8, signals);
    }
  }

  // PerimeterX
  {
    const signals: string[] = [];
    if (headerIncludes(headers, "set-cookie", "_px3")) signals.push("cookie:_px3");
    if (headerIncludes(headers, "set-cookie", "_pxhd")) signals.push("cookie:_pxhd");
    if (hasHeader(headers, "x-px")) signals.push("hdr:x-px");
    if (includesAny(htmlLower, ["perimeterx", "px-captcha", "_px"])) signals.push("html:px-marker");

    if (signals.length >= 2) {
      return build("perimeterx", classifyCategory(statusCode, htmlLower), 0.8, signals);
    }
  }

  // Imperva / Incapsula
  {
    const signals: string[] = [];
    if (headerIncludes(headers, "set-cookie", "incap_ses")) signals.push("cookie:incap_ses");
    if (headerIncludes(headers, "set-cookie", "visid_incap")) signals.push("cookie:visid_incap");
    if (hasHeader(headers, "x-iinfo")) signals.push("hdr:x-iinfo");
    if (headerIncludes(headers, "x-cdn", "incapsula")) signals.push("hdr:x-cdn=incapsula");
    if (includesAny(htmlLower, ["incapsula", "incident id", "powered by incapsula"]))
      signals.push("html:incapsula");

    if (signals.length >= 2) {
      return build("imperva", classifyCategory(statusCode, htmlLower), 0.75, signals);
    }
  }

  // Sucuri
  {
    const signals: string[] = [];
    if (hasHeader(headers, "x-sucuri-id")) signals.push("hdr:x-sucuri-id");
    if (headerIncludes(headers, "server", "sucuri")) signals.push("hdr:server=sucuri");
    if (
      includesAny(htmlLower, ["sucuri website firewall", "access denied - sucuri website firewall"])
    ) {
      signals.push("html:sucuri");
    }

    if (signals.length >= 2) {
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
