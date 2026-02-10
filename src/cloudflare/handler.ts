import type Hero from "@ulixee/hero";
import { detectChallenge } from "./detector";
import type { ChallengeResolutionResult, ChallengeWaitOptions } from "./types";
import type { CaptchaSolverConfig, CaptchaType } from "../captcha/types";
import { extractSiteKeyCandidates } from "../captcha/site-key-extractor";
import { createCaptchaSolverWithFallback } from "../captcha/solver-with-fallback";

type DetectedCaptchaWidget = {
  widget: "turnstile" | "recaptcha";
  siteKey: string;
  source: string;
};

function detectCaptchaWidgetFromHtml(html: string): DetectedCaptchaWidget | null {
  const candidates = extractSiteKeyCandidates(html);
  const turnstile = candidates.find((c) => c.type === "turnstile");
  if (turnstile)
    return { widget: "turnstile", siteKey: turnstile.siteKey, source: turnstile.source };
  const recaptcha = candidates.find((c) => c.type === "recaptcha");
  if (recaptcha)
    return { widget: "recaptcha", siteKey: recaptcha.siteKey, source: recaptcha.source };
  return null;
}

function toCaptchaType(widget: DetectedCaptchaWidget["widget"]): CaptchaType {
  if (widget === "turnstile") return "turnstile";
  // Default to v2 (v3 requires action/minScore signals we don't reliably infer from HTML).
  return "recaptcha_v2";
}

async function applyCaptchaTokenBestEffort(
  hero: Hero,
  args: { widget: DetectedCaptchaWidget["widget"]; token: string }
): Promise<{ setCount: number; submitted: boolean }> {
  type EvaluateCapableTab = {
    evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<Awaited<T>>;
  };

  const maybeTab: unknown = await hero.activeTab;
  const tab =
    maybeTab &&
    typeof maybeTab === "object" &&
    "evaluate" in maybeTab &&
    typeof (maybeTab as { evaluate?: unknown }).evaluate === "function"
      ? (maybeTab as EvaluateCapableTab)
      : null;

  if (!tab) {
    return { setCount: 0, submitted: false };
  }

  const widget = args.widget;
  const token = args.token;

  return tab.evaluate(
    (input: { widget: "turnstile" | "recaptcha"; token: string }) => {
      const tokenValue = String(input.token ?? "");
      const widgetType = input.widget;

      const names =
        widgetType === "turnstile" ? ["cf-turnstile-response"] : ["g-recaptcha-response"];

      let setCount = 0;
      for (const name of names) {
        const nodes = Array.from(
          document.querySelectorAll(`textarea[name="${name}"], input[name="${name}"]`)
        ) as Array<HTMLTextAreaElement | HTMLInputElement>;
        for (const el of nodes) {
          try {
            (el as any).value = tokenValue;
            el.setAttribute("value", tokenValue);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            setCount++;
          } catch {
            // best-effort
          }
        }
      }

      let submitted = false;
      const form =
        (document.querySelector("#challenge-form") as HTMLFormElement | null) ||
        (document.querySelector('form[action*="/cdn-cgi/"]') as HTMLFormElement | null) ||
        (document.querySelector("form") as HTMLFormElement | null);

      try {
        if (form) {
          // Some challenge pages listen to submit; requestSubmit triggers handlers when available.
          (form as any).requestSubmit?.();
          if (!(form as any).requestSubmit) {
            form.submit();
          }
          submitted = true;
        }
      } catch {
        // ignore
      }

      if (!submitted) {
        try {
          const btn =
            (document.querySelector('button[type="submit"]') as HTMLButtonElement | null) ||
            (document.querySelector('input[type="submit"]') as HTMLInputElement | null);
          (btn as any)?.click?.();
          if (btn) submitted = true;
        } catch {
          // ignore
        }
      }

      return { setCount, submitted };
    },
    { widget, token }
  );
}

async function maybeSolveCaptcha(
  hero: Hero,
  options: {
    captcha?: CaptchaSolverConfig;
    captchaFallback?: CaptchaSolverConfig;
    verbose?: boolean;
  }
): Promise<{ attempted: boolean; applied: boolean }> {
  const verbose = options.verbose ?? false;
  const log = (msg: string) => verbose && console.log(`   ${msg}`);

  if (!options.captcha && !options.captchaFallback) return { attempted: false, applied: false };

  let html: string;
  try {
    html = await hero.document.documentElement.outerHTML;
  } catch {
    return { attempted: false, applied: false };
  }

  const detected = detectCaptchaWidgetFromHtml(html);
  if (!detected) return { attempted: false, applied: false };

  const solver = createCaptchaSolverWithFallback(options.captcha, options.captchaFallback);
  if (!solver) return { attempted: false, applied: false };

  const pageUrl = await hero.url;
  const captchaType = toCaptchaType(detected.widget);

  log(`CAPTCHA widget detected: ${detected.widget} (${detected.source})`);

  try {
    const result = await solver.solve({
      captchaType,
      pageUrl,
      siteKey: detected.siteKey,
    });

    log(`CAPTCHA solved via ${result.provider}; applying token...`);

    const applied = await applyCaptchaTokenBestEffort(hero, {
      widget: detected.widget,
      token: result.token,
    });
    const ok = applied.setCount > 0 || applied.submitted;
    log(
      `CAPTCHA token applied: ${applied.setCount} field(s) updated${applied.submitted ? "; submitted" : ""}`
    );
    return { attempted: true, applied: ok };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`CAPTCHA solve failed (continuing with passive wait): ${msg}`);
    return { attempted: true, applied: false };
  }
}

/**
 * Wait for Cloudflare challenge to resolve
 *
 * Uses multiple detection strategies:
 * 1. URL redirect detection (page redirects after challenge)
 * 2. Signal polling (challenge-specific elements/text disappear)
 *
 * @param hero - Hero instance with challenge page loaded
 * @param options - Waiting options
 * @returns Resolution result with method and time waited
 *
 * @example
 * const result = await waitForChallengeResolution(hero, {
 *   maxWaitMs: 45000,
 *   pollIntervalMs: 500,
 *   verbose: true,
 *   initialUrl: 'https://example.com'
 * });
 *
 * if (result.resolved) {
 *   console.log(`Challenge resolved via ${result.method} in ${result.waitedMs}ms`);
 * }
 */
export async function waitForChallengeResolution(
  hero: Hero,
  options: ChallengeWaitOptions
): Promise<ChallengeResolutionResult> {
  const { maxWaitMs = 45000, pollIntervalMs = 500, verbose = false, initialUrl } = options;

  const startTime = Date.now();
  const log = (msg: string) => verbose && console.log(`   ${msg}`);

  while (Date.now() - startTime < maxWaitMs) {
    const elapsed = Date.now() - startTime;

    // =========================================================================
    // STRATEGY 1: Check for URL change (redirect after challenge)
    // =========================================================================
    try {
      const currentUrl = await hero.url;
      if (currentUrl !== initialUrl) {
        log(`✓ URL changed: ${initialUrl} → ${currentUrl}`);
        // Wait for the new page to fully load after redirect
        log(`  Waiting for new page to load...`);
        try {
          await hero.waitForLoad("DomContentLoaded", { timeoutMs: 30000 });
          log(`  DOMContentLoaded`);
        } catch {
          log(`  DOMContentLoaded timeout, continuing...`);
        }
        // Additional wait for JS to execute and render
        await hero.waitForPaintingStable().catch(() => {});
        log(`  Page stabilized`);
        return { resolved: true, method: "url_redirect", waitedMs: elapsed };
      }
    } catch {
      // URL check failed, continue with other strategies
    }

    // =========================================================================
    // STRATEGY 2: Check if challenge signals are gone
    // =========================================================================
    const detection = await detectChallenge(hero);

    if (!detection.isChallenge) {
      log(`✓ Challenge signals cleared (confidence dropped to ${detection.confidence})`);
      // Wait for page to fully load after challenge clears
      log(`  Waiting for page to load...`);
      try {
        await hero.waitForLoad("DomContentLoaded", { timeoutMs: 30000 });
        log(`  DOMContentLoaded`);
      } catch {
        log(`  DOMContentLoaded timeout, continuing...`);
      }
      await hero.waitForPaintingStable().catch(() => {});
      log(`  Page stabilized`);
      return { resolved: true, method: "signals_cleared", waitedMs: elapsed };
    }

    // Log progress
    log(
      `⏳ ${(elapsed / 1000).toFixed(1)}s - Still challenge (confidence: ${detection.confidence})`
    );

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Timeout reached
  return {
    resolved: false,
    method: "timeout",
    waitedMs: Date.now() - startTime,
  };
}

/**
 * Wait for a specific CSS selector to appear
 *
 * Useful when you know exactly what element should appear after challenge.
 *
 * @param hero - Hero instance
 * @param selector - CSS selector to wait for
 * @param maxWaitMs - Maximum time to wait
 * @param verbose - Enable logging
 * @returns Whether selector was found and time waited
 *
 * @example
 * const result = await waitForSelector(hero, '.content', 30000, true);
 * if (result.found) {
 *   console.log(`Content appeared after ${result.waitedMs}ms`);
 * }
 */
export async function waitForSelector(
  hero: Hero,
  selector: string,
  maxWaitMs: number,
  verbose: boolean = false
): Promise<{ found: boolean; waitedMs: number }> {
  const startTime = Date.now();
  const log = (msg: string) => verbose && console.log(`   ${msg}`);

  log(`Waiting for selector: "${selector}"`);

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const element = await hero.document.querySelector(selector);
      if (element) {
        const elapsed = Date.now() - startTime;
        log(`✓ Selector found after ${(elapsed / 1000).toFixed(1)}s`);
        return { found: true, waitedMs: elapsed };
      }
    } catch {
      // Selector not found yet, continue
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  log(`✗ Selector not found within timeout`);
  return { found: false, waitedMs: Date.now() - startTime };
}

/**
 * Handle Cloudflare challenge with automatic detection and waiting
 *
 * High-level function that combines detection and resolution.
 *
 * @param hero - Hero instance
 * @param options - Wait options (without initialUrl)
 * @returns Resolution result
 *
 * @example
 * await hero.goto('https://example.com');
 * const result = await handleChallenge(hero, { verbose: true });
 * if (result.resolved) {
 *   // Challenge passed, continue scraping
 * }
 */
export async function handleChallenge(
  hero: Hero,
  options: Omit<ChallengeWaitOptions, "initialUrl"> & {
    captcha?: CaptchaSolverConfig;
    captchaFallback?: CaptchaSolverConfig;
  } = {}
): Promise<ChallengeResolutionResult> {
  // Get current URL
  const initialUrl = await hero.url;

  // Detect challenge
  const detection = await detectChallenge(hero);

  if (!detection.isChallenge) {
    // No challenge, return immediately
    return { resolved: true, method: "signals_cleared", waitedMs: 0 };
  }

  // If a CAPTCHA widget is present and a solver is configured, attempt to solve once
  // before entering the passive wait loop.
  await maybeSolveCaptcha(hero, {
    captcha: options.captcha,
    captchaFallback: options.captchaFallback,
    verbose: options.verbose,
  });

  // Challenge detected, wait for resolution
  return waitForChallengeResolution(hero, {
    ...options,
    initialUrl,
  });
}
