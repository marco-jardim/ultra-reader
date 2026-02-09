export type AnchorLike = {
  getAttribute(name: string): string | null;
  textContent?: string | null;
};

export interface HoneypotDetectorOptions {
  /** Disable detection entirely (default: enabled). */
  enabled?: boolean;
  /** Score at/above which a link is blocked (default: 8). */
  threshold?: number;
}

export interface HoneypotAssessment {
  blocked: boolean;
  score: number;
  threshold: number;
  reasons: string[];
}

const DEFAULT_THRESHOLD = 8;

function toLowerSafe(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function parseStyle(style: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of style.split(";")) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const value = part
      .slice(idx + 1)
      .trim()
      .toLowerCase();
    if (!key) continue;
    map[key] = value;
  }
  return map;
}

function parseCssPx(value: string | undefined): number | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === "0") return 0;
  const m = v.match(/^(-?\d+(?:\.\d+)?)(px)?$/);
  if (!m) return null;
  return Number(m[1]);
}

function parseCssNumber(value: string | undefined): number | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const m = v.match(/^(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return Number(m[1]);
}

function hasScreenReaderOnlyClass(className: string): boolean {
  // Common patterns for visually-hidden/screen-reader-only utilities.
  // These are frequently used for accessibility and are not inherently malicious.
  return /(\bsr-only\b|\bvisually-hidden\b|\bscreen-reader\b|\ba11y\b)/i.test(className);
}

function looksLikeOffscreenStyle(styleMap: Record<string, string>): boolean {
  const left = parseCssPx(styleMap["left"]);
  const top = parseCssPx(styleMap["top"]);
  const textIndent = parseCssPx(styleMap["text-indent"]);
  const transform = styleMap["transform"] ?? "";
  const clip = styleMap["clip"] ?? "";
  const clipPath = styleMap["clip-path"] ?? "";

  if (left !== null && left <= -1000) return true;
  if (top !== null && top <= -1000) return true;
  if (textIndent !== null && textIndent <= -1000) return true;
  if (/translate[xy]?\(\s*-\d{3,}px/i.test(transform)) return true;

  // Classic "visually hidden" patterns
  if (/rect\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(clip)) return true;
  if (/inset\(\s*(50%|100%)\s*\)/i.test(clipPath)) return true;

  return false;
}

function looksLikeInvisibleStyle(styleMap: Record<string, string>): boolean {
  const display = styleMap["display"] ?? "";
  const visibility = styleMap["visibility"] ?? "";
  const opacity = parseCssNumber(styleMap["opacity"]);
  const color = styleMap["color"] ?? "";

  if (display === "none") return true;
  if (visibility === "hidden") return true;
  if (opacity !== null && opacity <= 0.01) return true;
  if (color === "transparent") return true;

  return false;
}

function tinyBoxSeverity(styleMap: Record<string, string>): "none" | "tiny" | "pixel" {
  const width = parseCssPx(styleMap["width"]);
  const height = parseCssPx(styleMap["height"]);
  const fontSize = parseCssPx(styleMap["font-size"]);
  const lineHeight = parseCssPx(styleMap["line-height"]);

  // High-confidence: explicit 1x1 (or 0x0) box.
  if (width !== null && height !== null && width <= 1 && height <= 1) {
    return "pixel";
  }

  // Lower-confidence: very small text without explicit box dimensions.
  if ((fontSize !== null && fontSize <= 1) || (lineHeight !== null && lineHeight <= 1)) {
    return "tiny";
  }

  return "none";
}

function hasRepeatedParams(url: URL): boolean {
  const counts = new Map<string, number>();
  let total = 0;
  for (const [key] of url.searchParams) {
    total++;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (total >= 20) return true;
  for (const c of counts.values()) {
    if (c >= 4) return true;
  }
  return false;
}

function hasWeirdSubdomain(url: URL, baseUrl?: string): boolean {
  const host = url.hostname.toLowerCase();
  const labels = host.split(".").filter(Boolean);

  // If we have a baseUrl, compare against it for "weirdness".
  if (baseUrl) {
    try {
      const base = new URL(baseUrl);
      const baseHost = base.hostname.toLowerCase();
      if (host === baseHost) return false;
    } catch {
      // ignore
    }
  }

  if (labels.length >= 5) return true;

  const first = labels[0] ?? "";
  if (first.length >= 24 && /\d/.test(first)) return true;
  if (/[a-z0-9-]{28,}/.test(first) && /\d/.test(first)) return true;

  return false;
}

function isHighConfidenceAdminUrl(url: URL): boolean {
  const path = url.pathname.toLowerCase();

  // Very explicit admin endpoints that are rarely content pages.
  if (/(^|\/)(wp-admin)(\/|$)/i.test(path)) return true;
  if (/(^|\/)(wp-login\.php)(\/|$)/i.test(path)) return true;

  return false;
}

function isLogoutUrl(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  if (/(^|\/)(logout|signout|logoff)(\/|$)/i.test(path)) return true;

  // Action-like query patterns (often used by CMS/admin panels)
  const action = url.searchParams.get("action")?.toLowerCase();
  if (action && /^(logout|signout|logoff)$/.test(action)) return true;

  return false;
}

function isSuspiciousHref(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  const query = url.search.toLowerCase();

  // These terms can appear in legitimate articles, so keep them as a weak signal.
  if (/(^|\/)(delete|remove|destroy|terminate|deactivate|unsubscribe)(\/|$)/i.test(path)) {
    return true;
  }

  if (/\b(action|do|cmd)=(delete|remove|destroy|terminate|unsubscribe)\b/i.test(query)) {
    return true;
  }

  if (/(^|\/)(trap|honeypot)(\/|$)/i.test(path)) {
    return true;
  }

  return false;
}

export function assessHoneypotLink(
  input: {
    href: string;
    resolvedUrl: string;
    anchor?: AnchorLike;
    baseUrl?: string;
  },
  options: HoneypotDetectorOptions = {}
): HoneypotAssessment {
  const enabled = options.enabled ?? true;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  if (!enabled) {
    return { blocked: false, score: 0, threshold, reasons: [] };
  }

  const reasons: string[] = [];
  let score = 0;

  const anchor = input.anchor;
  const className = toLowerSafe(anchor?.getAttribute("class"));
  const isSrOnly = hasScreenReaderOnlyClass(className);
  const styleRaw = toLowerSafe(anchor?.getAttribute("style"));
  const styleMap = styleRaw ? parseStyle(styleRaw) : {};

  const hiddenAttr = anchor?.getAttribute("hidden");
  const ariaHidden = toLowerSafe(anchor?.getAttribute("aria-hidden"));
  const text = (anchor?.textContent ?? "").trim();

  const add = (reason: string, delta: number) => {
    reasons.push(reason);
    score += delta;
  };

  // ---------------------------------------------------------------------------
  // Anchor visibility heuristics (conservative; require multiple signals)
  // ---------------------------------------------------------------------------

  if (hiddenAttr !== null) add("anchor:hidden-attr", 6);
  if (ariaHidden === "true") add("anchor:aria-hidden", 4);

  if (looksLikeInvisibleStyle(styleMap)) {
    add("anchor:invisible-style", 6);
  }

  const tiny = tinyBoxSeverity(styleMap);
  if (tiny === "pixel") {
    // 1x1 (or 0x0) anchors are very rarely legitimate navigation.
    add("anchor:tiny-box", 8);
  } else if (tiny === "tiny") {
    add("anchor:tiny-box", 4);
  }

  if (!isSrOnly && looksLikeOffscreenStyle(styleMap)) {
    add("anchor:offscreen", 2);
  }

  if (text.length === 0) {
    add("anchor:empty-text", 1);
  }

  // ---------------------------------------------------------------------------
  // URL-level heuristics
  // ---------------------------------------------------------------------------

  let parsed: URL | null = null;
  try {
    parsed = new URL(input.resolvedUrl);
  } catch {
    // If we can't parse the resolved URL, don't block.
    return { blocked: false, score: 0, threshold, reasons: [] };
  }

  if (isHighConfidenceAdminUrl(parsed)) {
    add("url:high-confidence-action", 10);
  } else if (isLogoutUrl(parsed)) {
    // Logout endpoints are often stateful; treat as risky but don't block alone.
    add("url:high-confidence-action", 6);
  } else if (isSuspiciousHref(parsed)) {
    add("url:suspicious-href", 3);
  }

  const queryLen = parsed.search.length;
  if (queryLen >= 512) {
    add("url:very-long-query", 3);
  }

  if (hasRepeatedParams(parsed)) {
    add("url:repeated-params", 3);
  }

  if (hasWeirdSubdomain(parsed, input.baseUrl)) {
    add("url:weird-subdomain", 2);
  }

  // ---------------------------------------------------------------------------
  // Conservative decision rule
  // ---------------------------------------------------------------------------
  const blocked = score >= threshold;
  return { blocked, score, threshold, reasons };
}

export function isLikelyHoneypotLink(
  input: {
    href: string;
    resolvedUrl: string;
    anchor?: AnchorLike;
    baseUrl?: string;
  },
  options: HoneypotDetectorOptions = {}
): boolean {
  return assessHoneypotLink(input, options).blocked;
}
