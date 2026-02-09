import { CaptchaSiteKeyNotFoundError } from "./errors";

export type CaptchaWidgetType = "turnstile" | "recaptcha";

export interface SiteKeyCandidate {
  type: CaptchaWidgetType;
  siteKey: string;
  source: string;
}

function uniqueCandidates(candidates: SiteKeyCandidate[]): SiteKeyCandidate[] {
  const seen = new Set<string>();
  const out: SiteKeyCandidate[] = [];
  for (const c of candidates) {
    const key = `${c.type}|${c.siteKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function extractByRegex(
  html: string,
  regex: RegExp,
  toCandidate: (match: RegExpExecArray) => SiteKeyCandidate
): SiteKeyCandidate[] {
  const out: SiteKeyCandidate[] = [];
  const r = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = r.exec(html)) !== null) {
    out.push(toCandidate(m));
  }
  return out;
}

export function extractSiteKeyCandidates(html: string): SiteKeyCandidate[] {
  const candidates: SiteKeyCandidate[] = [];

  // Turnstile: <div class="cf-turnstile" data-sitekey="..."></div>
  candidates.push(
    ...extractByRegex(
      html,
      /<[^>]+class=["'][^"']*(?:cf-turnstile|turnstile)[^"']*["'][^>]*data-sitekey=["']([^"']+)["'][^>]*>/i,
      (m) => ({ type: "turnstile", siteKey: m[1], source: "attr:data-sitekey" })
    )
  );

  // Turnstile: turnstile.render(..., { sitekey: "..." })
  candidates.push(
    ...extractByRegex(
      html,
      /turnstile\.render\([\s\S]*?\{[\s\S]*?sitekey\s*:\s*["']([^"']+)["'][\s\S]*?\}\s*\)/i,
      (m) => ({ type: "turnstile", siteKey: m[1], source: "js:turnstile.render" })
    )
  );

  // reCAPTCHA: <div class="g-recaptcha" data-sitekey="..."></div>
  candidates.push(
    ...extractByRegex(
      html,
      /<[^>]+class=["'][^"']*g-recaptcha[^"']*["'][^>]*data-sitekey=["']([^"']+)["'][^>]*>/i,
      (m) => ({ type: "recaptcha", siteKey: m[1], source: "attr:data-sitekey" })
    )
  );

  // reCAPTCHA: grecaptcha.render(..., { sitekey: "..." })
  candidates.push(
    ...extractByRegex(
      html,
      /grecaptcha\.render\([\s\S]*?\{[\s\S]*?sitekey\s*:\s*["']([^"']+)["'][\s\S]*?\}\s*\)/i,
      (m) => ({ type: "recaptcha", siteKey: m[1], source: "js:grecaptcha.render" })
    )
  );

  return uniqueCandidates(candidates);
}

export function extractFirstSiteKey(html: string, type?: CaptchaWidgetType): string | null {
  const candidates = extractSiteKeyCandidates(html);
  const filtered = type ? candidates.filter((c) => c.type === type) : candidates;
  return filtered[0]?.siteKey ?? null;
}

export function requireSiteKey(html: string, type?: CaptchaWidgetType): string {
  const key = extractFirstSiteKey(html, type);
  if (!key) {
    throw new CaptchaSiteKeyNotFoundError(
      type
        ? `Could not extract ${type} sitekey from HTML snippet`
        : "Could not extract sitekey from HTML snippet"
    );
  }
  return key;
}
