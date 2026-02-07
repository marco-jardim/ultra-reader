import { gunzipSync } from "node:zlib";
import pLimit from "p-limit";
import { getRandomUserAgent } from "../utils/user-agents.js";
import { probeWellKnownPaths } from "./well-known-paths.js";

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
  images?: string[];
  videos?: Array<{ title: string; thumbnailLoc: string; contentLoc?: string }>;
  news?: { publicationName: string; language: string; title: string; publicationDate: string };
}

export interface SitemapParseResult {
  type: "urlset" | "sitemapindex" | "text";
  urls: SitemapUrl[];
  childSitemaps: string[];
  totalUrls: number;
  warnings: string[];
}

function normalizeOrigin(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function extractTag(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = block.match(re);
  if (!match) return undefined;
  return decodeXmlText(match[1]);
}

function extractAllTags(block: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    out.push(decodeXmlText(m[1]));
  }
  return out;
}

function parsePriority(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

export function parseSitemap(content: string): SitemapParseResult {
  const warnings: string[] = [];
  const trimmed = content.trim();

  if (!trimmed) {
    return { type: "text", urls: [], childSitemaps: [], totalUrls: 0, warnings: ["Empty sitemap"] };
  }

  // Plain text (one URL per line)
  if (!trimmed.startsWith("<")) {
    const urls = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .filter(isHttpUrl)
      .map((loc) => ({ loc }));
    return { type: "text", urls, childSitemaps: [], totalUrls: urls.length, warnings };
  }

  const lower = trimmed.slice(0, 2000).toLowerCase();
  const isIndex = lower.includes("<sitemapindex");
  const isUrlset = lower.includes("<urlset");

  if (!isIndex && !isUrlset) {
    warnings.push("Unknown XML root element; attempting best-effort parse");
  }

  if (isIndex) {
    const childSitemaps: string[] = [];
    const sitemapBlocks = trimmed.match(/<sitemap\b[\s\S]*?<\/sitemap>/gi) ?? [];
    for (const block of sitemapBlocks) {
      const loc = extractTag(block, "loc");
      if (loc && isHttpUrl(loc)) childSitemaps.push(loc);
    }
    return {
      type: "sitemapindex",
      urls: [],
      childSitemaps,
      totalUrls: 0,
      warnings,
    };
  }

  const urlBlocks = trimmed.match(/<url\b[\s\S]*?<\/url>/gi) ?? [];
  const urls: SitemapUrl[] = [];
  for (const block of urlBlocks) {
    const loc = extractTag(block, "loc");
    if (!loc || !isHttpUrl(loc)) continue;
    const lastmod = extractTag(block, "lastmod");
    const changefreq = extractTag(block, "changefreq") as SitemapUrl["changefreq"] | undefined;
    const priority = parsePriority(extractTag(block, "priority"));
    const images = extractAllTags(block, "image:loc");

    urls.push({
      loc,
      lastmod,
      changefreq,
      priority,
      images: images.length ? images : undefined,
    });
  }

  return {
    type: isUrlset ? "urlset" : "urlset",
    urls,
    childSitemaps: [],
    totalUrls: urls.length,
    warnings,
  };
}

async function fetchBytes(
  url: string,
  options: { timeoutMs: number; userAgent?: string }
): Promise<{
  finalUrl: string;
  statusCode: number;
  contentType: string | null;
  bytes: Uint8Array;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const headers: Record<string, string> = {
      "User-Agent": options.userAgent ?? getRandomUserAgent(url),
      Accept: "*/*",
    };
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers,
      signal: controller.signal,
    });
    const buf = new Uint8Array(await response.arrayBuffer());
    return {
      finalUrl: response.url,
      statusCode: response.status,
      contentType: response.headers.get("content-type"),
      bytes: buf,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function maybeGunzip(url: string, contentType: string | null, bytes: Uint8Array): Uint8Array {
  const looksGz =
    url.toLowerCase().endsWith(".gz") || (contentType ?? "").toLowerCase().includes("gzip");
  if (!looksGz) return bytes;
  try {
    return gunzipSync(bytes);
  } catch {
    return bytes;
  }
}

export async function fetchSitemap(
  sitemapUrl: string,
  options?: {
    maxDepth?: number;
    maxUrls?: number;
    sinceDate?: Date;
    includePattern?: RegExp;
    excludePattern?: RegExp;
    timeoutMs?: number;
    userAgent?: string;
  }
): Promise<SitemapParseResult> {
  const maxDepth = options?.maxDepth ?? 3;
  const maxUrls = options?.maxUrls ?? 50_000;
  const timeoutMs = options?.timeoutMs ?? 15_000;
  const userAgent = options?.userAgent;

  const seenSitemaps = new Set<string>();
  const seenUrls = new Set<string>();
  const warnings: string[] = [];
  const urls: SitemapUrl[] = [];
  const childSitemaps: string[] = [];

  async function walk(url: string, depth: number): Promise<void> {
    if (seenSitemaps.has(url)) return;
    seenSitemaps.add(url);
    if (depth > maxDepth) return;

    const { finalUrl, statusCode, contentType, bytes } = await fetchBytes(url, {
      timeoutMs,
      userAgent,
    });
    if (statusCode >= 400) {
      warnings.push(`Sitemap fetch failed: ${finalUrl} (${statusCode})`);
      return;
    }

    const decoded = maybeGunzip(finalUrl, contentType, bytes);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(decoded);
    const parsed = parseSitemap(text);
    warnings.push(...parsed.warnings);

    if (parsed.type === "sitemapindex") {
      for (const child of parsed.childSitemaps) {
        if (!seenSitemaps.has(child)) childSitemaps.push(child);
      }
      await Promise.all(parsed.childSitemaps.map((child) => walk(child, depth + 1)));
      return;
    }

    for (const entry of parsed.urls) {
      if (seenUrls.size >= maxUrls) break;
      if (options?.includePattern && !options.includePattern.test(entry.loc)) continue;
      if (options?.excludePattern && options.excludePattern.test(entry.loc)) continue;
      if (options?.sinceDate && entry.lastmod) {
        const last = Date.parse(entry.lastmod);
        if (Number.isFinite(last) && last < options.sinceDate.getTime()) continue;
      }
      if (seenUrls.has(entry.loc)) continue;
      seenUrls.add(entry.loc);
      urls.push(entry);
    }
  }

  await walk(sitemapUrl, 0);

  return {
    type: "urlset",
    urls,
    childSitemaps,
    totalUrls: urls.length,
    warnings,
  };
}

function extractSitemapsFromRobots(robotsTxt: string): string[] {
  const urls: string[] = [];
  for (const line of robotsTxt.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^sitemap\s*:\s*(\S+)/i);
    if (match && isHttpUrl(match[1])) {
      urls.push(match[1]);
    }
  }
  return urls;
}

export async function discoverSitemaps(
  baseUrl: string,
  options?: {
    maxDepth?: number;
    maxUrls?: number;
    sinceDate?: Date;
    timeoutMs?: number;
    concurrency?: number;
    userAgent?: string;
  }
): Promise<{
  sources: Array<{ url: string; foundVia: "robots.txt" | "well-known" | "sitemap-index" }>;
  urls: SitemapUrl[];
  totalUrls: number;
}> {
  const origin = normalizeOrigin(baseUrl);
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const userAgent = options?.userAgent;
  const concurrency = options?.concurrency ?? 3;
  const limit = pLimit(concurrency);

  const sources: Array<{ url: string; foundVia: "robots.txt" | "well-known" | "sitemap-index" }> =
    [];
  const sitemapUrls = new Set<string>();

  // 1) robots.txt Sitemap: directives
  try {
    const robotsUrl = new URL("/robots.txt", origin).toString();
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(robotsUrl, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": userAgent ?? getRandomUserAgent(robotsUrl),
          Accept: "text/plain,*/*",
        },
        signal: controller.signal,
      });
      if (response.ok) {
        const txt = await response.text();
        for (const url of extractSitemapsFromRobots(txt)) {
          if (!sitemapUrls.has(url)) {
            sitemapUrls.add(url);
            sources.push({ url, foundVia: "robots.txt" });
          }
        }
      }
    } finally {
      clearTimeout(t);
    }
  } catch {
    // ignore
  }

  // 2) well-known sitemap paths
  const probes = await probeWellKnownPaths(origin, {
    categories: ["sitemap"],
    timeoutMs,
    concurrency,
    userAgent,
  });
  const sitemapProbes = probes.get("sitemap") ?? [];
  for (const p of sitemapProbes) {
    if (p.found && isHttpUrl(p.finalUrl)) {
      if (!sitemapUrls.has(p.finalUrl)) {
        sitemapUrls.add(p.finalUrl);
        sources.push({ url: p.finalUrl, foundVia: "well-known" });
      }
    }
  }

  // 3) fetch + parse
  const allUrls: SitemapUrl[] = [];
  const seenLoc = new Set<string>();

  await Promise.all(
    [...sitemapUrls].map((sitemapUrl) =>
      limit(async () => {
        const parsed = await fetchSitemap(sitemapUrl, {
          maxDepth: options?.maxDepth,
          maxUrls: options?.maxUrls,
          sinceDate: options?.sinceDate,
          timeoutMs,
          userAgent,
        });
        for (const u of parsed.urls) {
          if (!seenLoc.has(u.loc)) {
            seenLoc.add(u.loc);
            allUrls.push(u);
          }
        }
        // record child sitemaps as sources (best-effort)
        for (const child of parsed.childSitemaps) {
          sources.push({ url: child, foundVia: "sitemap-index" });
        }
      })
    )
  );

  return {
    sources,
    urls: allUrls,
    totalUrls: allUrls.length,
  };
}
