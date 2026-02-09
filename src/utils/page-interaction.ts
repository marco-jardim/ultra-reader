export interface PageInteractionTab {
  evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<Awaited<T>>;
  waitForTimeout?(ms: number): Promise<void>;
}

export type NetworkIdleStopReason = "idle" | "timeout" | "maxPolls";
export type ScrollStopReason = "idle" | "timeout" | "maxIterations";
export type ClickLoadMoreStopReason = "notFound" | "noChange" | "maxClicks";

export interface WaitForNetworkIdleConfig {
  /** Time the page must remain quiet (no in-flight fetch/XHR) */
  idleTimeMs?: number;
  /** Total time budget for waiting */
  timeoutMs?: number;
  /** Poll interval used by the fallback network tracker */
  pollIntervalMs?: number;
  /** Hard stop to prevent infinite loops even with a large timeout */
  maxPolls?: number;
}

export interface NormalizedWaitForNetworkIdleConfig {
  idleTimeMs: number;
  timeoutMs: number;
  pollIntervalMs: number;
  maxPolls: number;
}

export function normalizeWaitForNetworkIdleConfig(
  input: WaitForNetworkIdleConfig | undefined
): NormalizedWaitForNetworkIdleConfig {
  const idleTimeMs = clampInt(input?.idleTimeMs, 500, 0, 60_000);
  const timeoutMs = clampInt(input?.timeoutMs, 15_000, 0, 120_000);
  const pollIntervalMs = clampInt(input?.pollIntervalMs, 100, 25, 2_000);

  // If a caller sets an extremely small poll interval, keep maxPolls bounded.
  const derivedMaxPolls = Math.ceil(timeoutMs / Math.max(1, pollIntervalMs)) + 5;
  const maxPolls = clampInt(input?.maxPolls, Math.min(500, derivedMaxPolls), 1, 5_000);

  return { idleTimeMs, timeoutMs, pollIntervalMs, maxPolls };
}

export interface WaitForNetworkIdleResult {
  idle: boolean;
  waitedMs: number;
  polls: number;
  reason: NetworkIdleStopReason;
}

type NetworkTrackerState = {
  inFlight: number;
  lastActivityTs: number;
  nowTs: number;
};

export async function waitForNetworkIdle(
  tab: PageInteractionTab,
  config?: WaitForNetworkIdleConfig
): Promise<WaitForNetworkIdleResult> {
  const cfg = normalizeWaitForNetworkIdleConfig(config);
  const start = Date.now();

  // Install a lightweight in-page tracker (idempotent).
  await tab.evaluate(() => {
    const w = window as any;
    if (w.__ultraReaderNetworkIdleTracker?.installed) return;

    const tracker = {
      installed: true,
      inFlight: 0,
      lastActivityTs: Date.now(),
    };
    w.__ultraReaderNetworkIdleTracker = tracker;

    const bump = () => {
      tracker.lastActivityTs = Date.now();
    };

    // Patch fetch
    if (typeof w.fetch === "function") {
      const originalFetch = w.fetch.bind(w);
      w.fetch = (...args: any[]) => {
        tracker.inFlight++;
        bump();
        return originalFetch(...args)
          .catch((err: any) => {
            throw err;
          })
          .finally(() => {
            tracker.inFlight = Math.max(0, tracker.inFlight - 1);
            bump();
          });
      };
    }

    // Patch XHR
    const XHR = w.XMLHttpRequest;
    if (XHR && XHR.prototype && typeof XHR.prototype.send === "function") {
      const originalSend = XHR.prototype.send;
      XHR.prototype.send = function (...args: any[]) {
        try {
          tracker.inFlight++;
          bump();
          const onDone = () => {
            tracker.inFlight = Math.max(0, tracker.inFlight - 1);
            bump();
          };
          // Ensure we always decrement.
          this.addEventListener?.("load", onDone);
          this.addEventListener?.("error", onDone);
          this.addEventListener?.("abort", onDone);
          this.addEventListener?.("timeout", onDone);
        } catch {
          // Best-effort only
        }
        // eslint-disable-next-line prefer-rest-params
        return originalSend.apply(this, args as any);
      };
    }
  });

  let polls = 0;
  for (; polls < cfg.maxPolls; polls++) {
    const elapsedMs = Date.now() - start;
    if (elapsedMs >= cfg.timeoutMs) {
      return { idle: false, waitedMs: elapsedMs, polls, reason: "timeout" };
    }

    const state = await tab.evaluate((): NetworkTrackerState => {
      const w = window as any;
      const t = w.__ultraReaderNetworkIdleTracker;
      const nowTs = Date.now();
      return {
        inFlight: Number(t?.inFlight ?? 0),
        lastActivityTs: Number(t?.lastActivityTs ?? nowTs),
        nowTs,
      };
    });

    const quietForMs = Math.max(0, state.nowTs - state.lastActivityTs);
    if (state.inFlight === 0 && quietForMs >= cfg.idleTimeMs) {
      return { idle: true, waitedMs: Date.now() - start, polls, reason: "idle" };
    }

    await sleep(tab, cfg.pollIntervalMs);
  }

  const elapsedMs = Date.now() - start;
  if (elapsedMs >= cfg.timeoutMs) {
    return { idle: false, waitedMs: elapsedMs, polls, reason: "timeout" };
  }
  return { idle: false, waitedMs: elapsedMs, polls, reason: "maxPolls" };
}

export interface ScrollToBottomConfig {
  maxIterations?: number;
  scrollDelayMs?: number;
  stableIterations?: number;
  timeoutMs?: number;
}

export interface NormalizedScrollToBottomConfig {
  maxIterations: number;
  scrollDelayMs: number;
  stableIterations: number;
  timeoutMs: number;
}

export function normalizeScrollToBottomConfig(
  input: ScrollToBottomConfig | undefined
): NormalizedScrollToBottomConfig {
  const maxIterations = clampInt(input?.maxIterations, 12, 1, 250);
  const scrollDelayMs = clampInt(input?.scrollDelayMs, 750, 0, 30_000);
  const stableIterations = clampInt(input?.stableIterations, 2, 1, 25);
  const timeoutMs = clampInt(input?.timeoutMs, 30_000, 0, 180_000);
  return { maxIterations, scrollDelayMs, stableIterations, timeoutMs };
}

export interface ScrollToBottomResult {
  iterations: number;
  reason: ScrollStopReason;
  finalScrollHeight: number;
}

type DocumentMetrics = {
  scrollHeight: number;
  scrollY: number;
  viewportHeight: number;
};

export async function scrollToBottom(
  tab: PageInteractionTab,
  config?: ScrollToBottomConfig
): Promise<ScrollToBottomResult> {
  const cfg = normalizeScrollToBottomConfig(config);
  const start = Date.now();

  const getMetrics = async (): Promise<DocumentMetrics> => {
    return tab.evaluate((): DocumentMetrics => {
      const d = document.documentElement;
      const body = document.body;
      const scrollHeight = Math.max(d?.scrollHeight ?? 0, body?.scrollHeight ?? 0);
      const scrollY = window.scrollY ?? window.pageYOffset ?? 0;
      const viewportHeight = window.innerHeight ?? d?.clientHeight ?? 0;
      return { scrollHeight, scrollY, viewportHeight };
    });
  };

  let metrics = await getMetrics();
  let stableCount = 0;
  let iterations = 0;

  for (let i = 0; i < cfg.maxIterations; i++) {
    const elapsedMs = Date.now() - start;
    if (elapsedMs >= cfg.timeoutMs) {
      return {
        iterations,
        reason: "timeout",
        finalScrollHeight: metrics.scrollHeight,
      };
    }

    iterations++;
    const previousHeight = metrics.scrollHeight;

    await tab.evaluate(() => {
      const d = document.documentElement;
      const body = document.body;
      const scrollHeight = Math.max(d?.scrollHeight ?? 0, body?.scrollHeight ?? 0);
      window.scrollTo(0, scrollHeight);
    });

    if (cfg.scrollDelayMs > 0) {
      await sleep(tab, cfg.scrollDelayMs);
    }

    metrics = await getMetrics();

    const heightIncreased = metrics.scrollHeight > previousHeight;
    const atBottom = metrics.scrollY + metrics.viewportHeight >= metrics.scrollHeight - 2;

    if (!heightIncreased && atBottom) {
      stableCount++;
      if (stableCount >= cfg.stableIterations) {
        return {
          iterations,
          reason: "idle",
          finalScrollHeight: metrics.scrollHeight,
        };
      }
    } else {
      stableCount = 0;
    }
  }

  return {
    iterations,
    reason: "maxIterations",
    finalScrollHeight: metrics.scrollHeight,
  };
}

export interface ClickLoadMoreConfig {
  maxClicks?: number;
  afterClickDelayMs?: number;
  stopIfNoChange?: boolean;
  maxNoChangeIterations?: number;
  heightProbeSelector?: string;
  waitForNetworkIdle?: WaitForNetworkIdleConfig | false;
}

export interface NormalizedClickLoadMoreConfig {
  maxClicks: number;
  afterClickDelayMs: number;
  stopIfNoChange: boolean;
  maxNoChangeIterations: number;
  heightProbeSelector?: string;
  waitForNetworkIdle: NormalizedWaitForNetworkIdleConfig | null;
}

export function normalizeClickLoadMoreConfig(
  input: ClickLoadMoreConfig | undefined
): NormalizedClickLoadMoreConfig {
  const maxClicks = clampInt(input?.maxClicks, 5, 0, 100);
  const afterClickDelayMs = clampInt(input?.afterClickDelayMs, 750, 0, 30_000);
  const stopIfNoChange = input?.stopIfNoChange ?? true;
  const maxNoChangeIterations = clampInt(input?.maxNoChangeIterations, 2, 1, 25);
  const heightProbeSelector =
    typeof input?.heightProbeSelector === "string" ? input.heightProbeSelector : undefined;
  const waitForNetworkIdle =
    input?.waitForNetworkIdle === false
      ? null
      : normalizeWaitForNetworkIdleConfig(input?.waitForNetworkIdle);

  return {
    maxClicks,
    afterClickDelayMs,
    stopIfNoChange,
    maxNoChangeIterations,
    heightProbeSelector,
    waitForNetworkIdle,
  };
}

export interface ClickLoadMoreResult {
  clicks: number;
  reason: ClickLoadMoreStopReason;
}

type ClickAttempt = {
  found: boolean;
  clicked: boolean;
  disabled: boolean;
};

export async function clickLoadMore(
  tab: PageInteractionTab,
  selector: string,
  config?: ClickLoadMoreConfig
): Promise<ClickLoadMoreResult> {
  const cfg = normalizeClickLoadMoreConfig(config);
  const safeSelector = String(selector);
  let clicks = 0;
  let noChangeCount = 0;

  const getHeight = async (): Promise<number> => {
    return tab.evaluate((probeSelector?: string) => {
      const el = probeSelector ? document.querySelector(probeSelector) : null;
      if (el && (el as any).scrollHeight != null) return Number((el as any).scrollHeight);
      const d = document.documentElement;
      const body = document.body;
      return Math.max(d?.scrollHeight ?? 0, body?.scrollHeight ?? 0);
    }, cfg.heightProbeSelector);
  };

  for (let i = 0; i < cfg.maxClicks; i++) {
    const beforeHeight = await getHeight();
    const attempt = await tab.evaluate((sel: string): ClickAttempt => {
      const el = document.querySelector(sel) as any;
      if (!el) return { found: false, clicked: false, disabled: false };

      const disabled = Boolean(el.disabled || el.getAttribute?.("aria-disabled") === "true");
      try {
        el.scrollIntoView?.({ block: "center", inline: "center" });
      } catch {
        // ignore
      }
      if (disabled) return { found: true, clicked: false, disabled: true };
      try {
        (el as HTMLElement).click();
        return { found: true, clicked: true, disabled: false };
      } catch {
        return { found: true, clicked: false, disabled: false };
      }
    }, safeSelector);

    if (!attempt.found) {
      return { clicks, reason: "notFound" };
    }

    if (!attempt.clicked) {
      // Treat "disabled" and "unclickable" the same as no more load-more.
      return { clicks, reason: "notFound" };
    }

    clicks++;

    if (cfg.waitForNetworkIdle) {
      await waitForNetworkIdle(tab, cfg.waitForNetworkIdle);
    }

    if (cfg.afterClickDelayMs > 0) {
      await sleep(tab, cfg.afterClickDelayMs);
    }

    if (cfg.stopIfNoChange) {
      const afterHeight = await getHeight();
      if (afterHeight <= beforeHeight) {
        noChangeCount++;
        if (noChangeCount >= cfg.maxNoChangeIterations) {
          return { clicks, reason: "noChange" };
        }
      } else {
        noChangeCount = 0;
      }
    }
  }

  return { clicks, reason: "maxClicks" };
}

function clampInt(value: unknown, defaultValue: number, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value))
    return defaultValue;
  const v = Math.floor(value);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

async function sleep(tab: PageInteractionTab, ms: number): Promise<void> {
  if (ms <= 0) return;
  if (typeof tab.waitForTimeout === "function") {
    await tab.waitForTimeout(ms);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}
