export type WafProvider =
  | "cloudflare"
  | "akamai"
  | "datadome"
  | "perimeterx"
  | "imperva"
  | "sucuri"
  | "unknown";

export type WafCategory = "challenge" | "captcha" | "block" | "rate_limit";

export interface WafDetection {
  provider: WafProvider;
  category: WafCategory;
  confidence: number; // 0..1
  signals: string[];
}
