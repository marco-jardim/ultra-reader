/**
 * Phase 2.2 - Behavior Simulation (Human-ish interaction)
 *
 * Pure utility module (no direct Hero imports). Consumers can adapt a Hero `Tab`
 * or `Hero` instance by providing a compatible subset of methods.
 */

export type BehaviorSimulatorRandom = () => number;

export interface BehaviorSimulatorTabLike {
  /** Optional: preferred sleep primitive (Hero has waitForMillis/waitForTimeout equivalents in some setups). */
  waitForTimeout?: (ms: number) => Promise<void> | void;

  /** Optional: Hero-style interaction facade. */
  interact?: (interaction: unknown) => Promise<void> | void;

  /** Optional: direct scroll primitive (deltaX, deltaY). */
  scrollBy?: (deltaX: number, deltaY: number) => Promise<void> | void;

  /** Optional: evaluation primitive to run code in page context. */
  evaluate?<T>(fn: () => T): Promise<T> | T;

  /** Optional: focus/blur primitives. */
  focus?: () => Promise<void> | void;
  blur?: () => Promise<void> | void;

  /** Optional: mouse primitives. */
  mouse?: {
    move?: (x: number, y: number) => Promise<void> | void;
    wheel?: (deltaX: number, deltaY: number) => Promise<void> | void;
  };

  /** Optional: provide viewport size without evaluate(). */
  getViewport?: () =>
    | Promise<{ width: number; height: number }>
    | { width: number; height: number };
}

export interface IntRange {
  min: number;
  max: number;
}

export interface MsRange {
  minMs: number;
  maxMs: number;
}

export type ScrollDirection = "down" | "up" | "both";

export interface BehaviorSimulationConfig {
  /** Seeded deterministic RNG. Ignored if `rng` is provided. */
  seed?: number | string;

  /** Deterministic option: inject your own RNG (stateful function recommended). */
  rng?: BehaviorSimulatorRandom | { next: BehaviorSimulatorRandom };

  /** How many actions to attempt for this simulation run. */
  actionCount?: Partial<IntRange>;

  /** Delay inserted after every action. */
  betweenActionsDelayMs?: Partial<MsRange>;

  pause?: {
    enabled?: boolean;
    probability?: number;
    delayMs?: Partial<MsRange>;
  };

  scroll?: {
    enabled?: boolean;
    probability?: number;
    steps?: Partial<IntRange>;
    stepYpx?: Partial<IntRange>;
    direction?: ScrollDirection;
    stepDelayMs?: Partial<MsRange>;
  };

  mouseMove?: {
    enabled?: boolean;
    probability?: number;
    moves?: Partial<IntRange>;
    /** Max distance per move (px). */
    maxDistancePx?: Partial<IntRange>;
    moveDelayMs?: Partial<MsRange>;
    /** Fallback area used when viewport size can't be resolved. */
    area?: { width?: number; height?: number; marginPx?: number };
  };

  focusBlur?: {
    enabled?: boolean;
    probability?: number;
    /** Probability that the action is blur (otherwise focus). */
    blurProbability?: number;
    delayMs?: Partial<MsRange>;
  };
}

export interface NormalizedBehaviorSimulationConfig {
  rng: BehaviorSimulatorRandom;
  actionCount: IntRange;
  betweenActionsDelayMs: MsRange;
  pause: { enabled: boolean; probability: number; delayMs: MsRange };
  scroll: {
    enabled: boolean;
    probability: number;
    steps: IntRange;
    stepYpx: IntRange;
    direction: ScrollDirection;
    stepDelayMs: MsRange;
  };
  mouseMove: {
    enabled: boolean;
    probability: number;
    moves: IntRange;
    maxDistancePx: IntRange;
    moveDelayMs: MsRange;
    area: { width: number; height: number; marginPx: number };
  };
  focusBlur: {
    enabled: boolean;
    probability: number;
    blurProbability: number;
    delayMs: MsRange;
  };
}

// ---------------------------------------------------------------------------
// RNG
// ---------------------------------------------------------------------------

/**
 * Create a deterministic RNG with a numeric or string seed.
 * Uses a small, fast 32-bit generator (mulberry32).
 */
export function createSeededRng(seed: number | string): BehaviorSimulatorRandom {
  const s = typeof seed === "string" ? hashStringToUint32(seed) : toUint32(seed);
  return mulberry32(s);
}

function toUint32(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // Normalize floats and negatives into uint32 space.
  return (Math.floor(value) >>> 0) as number;
}

function hashStringToUint32(str: string): number {
  // xfnv1a
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): BehaviorSimulatorRandom {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeRng(input: BehaviorSimulationConfig | undefined): BehaviorSimulatorRandom {
  const rng = input?.rng;
  if (typeof rng === "function") return rng;
  if (rng && typeof rng === "object" && typeof rng.next === "function") return rng.next;
  if (input?.seed !== undefined) return createSeededRng(input.seed);
  return Math.random;
}

// ---------------------------------------------------------------------------
// Config normalization
// ---------------------------------------------------------------------------

export function normalizeBehaviorSimulationConfig(
  config: BehaviorSimulationConfig = {}
): NormalizedBehaviorSimulationConfig {
  const rng = normalizeRng(config);

  const actionCount = normalizeIntRange(config.actionCount, {
    min: 3,
    max: 7,
    clampMin: 0,
  });

  const betweenActionsDelayMs = normalizeMsRange(config.betweenActionsDelayMs, {
    minMs: 120,
    maxMs: 600,
    clampMinMs: 0,
  });

  const pause = {
    enabled: config.pause?.enabled ?? true,
    probability: normalizeProbability(config.pause?.probability, 0.5),
    delayMs: normalizeMsRange(config.pause?.delayMs, { minMs: 250, maxMs: 1500, clampMinMs: 0 }),
  };

  const scroll = {
    enabled: config.scroll?.enabled ?? true,
    probability: normalizeProbability(config.scroll?.probability, 0.5),
    steps: normalizeIntRange(config.scroll?.steps, { min: 1, max: 3, clampMin: 0 }),
    stepYpx: normalizeIntRange(config.scroll?.stepYpx, { min: 40, max: 160, clampMin: 0 }),
    direction: config.scroll?.direction ?? "both",
    stepDelayMs: normalizeMsRange(config.scroll?.stepDelayMs, {
      minMs: 80,
      maxMs: 400,
      clampMinMs: 0,
    }),
  };

  const mouseMove = {
    enabled: config.mouseMove?.enabled ?? true,
    probability: normalizeProbability(config.mouseMove?.probability, 0.4),
    moves: normalizeIntRange(config.mouseMove?.moves, { min: 1, max: 4, clampMin: 0 }),
    maxDistancePx: normalizeIntRange(config.mouseMove?.maxDistancePx, {
      min: 30,
      max: 220,
      clampMin: 0,
    }),
    moveDelayMs: normalizeMsRange(config.mouseMove?.moveDelayMs, {
      minMs: 20,
      maxMs: 120,
      clampMinMs: 0,
    }),
    area: {
      width: normalizeFiniteNumber(config.mouseMove?.area?.width, 1024, 1),
      height: normalizeFiniteNumber(config.mouseMove?.area?.height, 768, 1),
      marginPx: normalizeFiniteNumber(config.mouseMove?.area?.marginPx, 20, 0),
    },
  };

  const focusBlur = {
    enabled: config.focusBlur?.enabled ?? true,
    probability: normalizeProbability(config.focusBlur?.probability, 0.15),
    blurProbability: normalizeProbability(config.focusBlur?.blurProbability, 0.5),
    delayMs: normalizeMsRange(config.focusBlur?.delayMs, { minMs: 80, maxMs: 250, clampMinMs: 0 }),
  };

  return { rng, actionCount, betweenActionsDelayMs, pause, scroll, mouseMove, focusBlur };
}

function normalizeProbability(value: unknown, fallback: number): number {
  const v = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function normalizeFiniteNumber(value: unknown, fallback: number, clampMin: number): number {
  const v = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return v < clampMin ? clampMin : v;
}

function normalizeIntRange(
  input: Partial<IntRange> | undefined,
  defaults: { min: number; max: number; clampMin: number }
): IntRange {
  const rawMin =
    typeof input?.min === "number" && Number.isFinite(input.min) ? input.min : defaults.min;
  const rawMax =
    typeof input?.max === "number" && Number.isFinite(input.max) ? input.max : defaults.max;

  let min = Math.floor(rawMin);
  let max = Math.floor(rawMax);
  if (min < defaults.clampMin) min = defaults.clampMin;
  if (max < defaults.clampMin) max = defaults.clampMin;
  if (min > max) [min, max] = [max, min];
  return { min, max };
}

function normalizeMsRange(
  input: Partial<MsRange> | undefined,
  defaults: { minMs: number; maxMs: number; clampMinMs: number }
): MsRange {
  const rawMin =
    typeof input?.minMs === "number" && Number.isFinite(input.minMs) ? input.minMs : defaults.minMs;
  const rawMax =
    typeof input?.maxMs === "number" && Number.isFinite(input.maxMs) ? input.maxMs : defaults.maxMs;

  let minMs = Math.floor(rawMin);
  let maxMs = Math.floor(rawMax);
  if (minMs < defaults.clampMinMs) minMs = defaults.clampMinMs;
  if (maxMs < defaults.clampMinMs) maxMs = defaults.clampMinMs;
  if (minMs > maxMs) [minMs, maxMs] = [maxMs, minMs];
  return { minMs, maxMs };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export type BehaviorAction = "pause" | "scroll" | "mouseMove" | "focusBlur";

/**
 * Run a short sequence of human-ish interactions.
 *
 * Best-effort: if an action can't be performed due to missing tab methods,
 * it's skipped (without throwing).
 */
export async function simulateBehavior(
  tab: BehaviorSimulatorTabLike,
  config: BehaviorSimulationConfig = {}
): Promise<void> {
  const normalized = normalizeBehaviorSimulationConfig(config);
  const rng = normalized.rng;

  const totalActions = randomIntInclusive(
    rng,
    normalized.actionCount.min,
    normalized.actionCount.max
  );

  // Keep some local state to make mouse moves look less teleport-y.
  let mousePos: { x: number; y: number } | null = null;

  for (let i = 0; i < totalActions; i++) {
    const action = pickAction(normalized, rng);
    if (action === null) break;

    switch (action) {
      case "pause":
        await simulateRandomPause(tab, normalized);
        break;
      case "scroll":
        await simulateSmallScroll(tab, normalized);
        break;
      case "mouseMove": {
        const nextMousePos = await simulateMouseMoves(tab, normalized, mousePos);
        mousePos = nextMousePos;
        break;
      }
      case "focusBlur":
        await simulateFocusBlur(tab, normalized);
        break;
      default:
        break;
    }

    await sleepRandom(tab, normalized.betweenActionsDelayMs, rng);
  }
}

export async function simulateRandomPause(
  tab: BehaviorSimulatorTabLike,
  config: BehaviorSimulationConfig | NormalizedBehaviorSimulationConfig = {}
): Promise<void> {
  const normalized = isNormalized(config) ? config : normalizeBehaviorSimulationConfig(config);
  const rng = normalized.rng;
  await sleepRandom(tab, normalized.pause.delayMs, rng);
}

export async function simulateSmallScroll(
  tab: BehaviorSimulatorTabLike,
  config: BehaviorSimulationConfig | NormalizedBehaviorSimulationConfig = {}
): Promise<void> {
  const normalized = isNormalized(config) ? config : normalizeBehaviorSimulationConfig(config);
  const rng = normalized.rng;

  const steps = randomIntInclusive(rng, normalized.scroll.steps.min, normalized.scroll.steps.max);
  for (let i = 0; i < steps; i++) {
    const magnitude = randomIntInclusive(
      rng,
      normalized.scroll.stepYpx.min,
      normalized.scroll.stepYpx.max
    );
    const sign = pickScrollSign(normalized.scroll.direction, rng);
    await scrollBy(tab, 0, sign * magnitude);
    await sleepRandom(tab, normalized.scroll.stepDelayMs, rng);
  }
}

export async function simulateMouseMoves(
  tab: BehaviorSimulatorTabLike,
  config: BehaviorSimulationConfig | NormalizedBehaviorSimulationConfig = {},
  startPos: { x: number; y: number } | null = null
): Promise<{ x: number; y: number } | null> {
  const normalized = isNormalized(config) ? config : normalizeBehaviorSimulationConfig(config);
  const rng = normalized.rng;

  if (!tab.interact && !tab.mouse?.move) return startPos;

  const viewport = await resolveViewport(tab, normalized);
  const margin = normalized.mouseMove.area.marginPx;

  const bounds = {
    minX: Math.max(0, margin),
    minY: Math.max(0, margin),
    maxX: Math.max(0, viewport.width - margin),
    maxY: Math.max(0, viewport.height - margin),
  };

  let pos: { x: number; y: number };
  if (startPos) {
    pos = startPos;
  } else {
    pos = {
      x: randomIntInclusive(rng, bounds.minX, bounds.maxX),
      y: randomIntInclusive(rng, bounds.minY, bounds.maxY),
    };
  }

  const moves = randomIntInclusive(
    rng,
    normalized.mouseMove.moves.min,
    normalized.mouseMove.moves.max
  );
  for (let i = 0; i < moves; i++) {
    const maxDist = randomIntInclusive(
      rng,
      normalized.mouseMove.maxDistancePx.min,
      normalized.mouseMove.maxDistancePx.max
    );
    const dx = randomIntInclusive(rng, -maxDist, maxDist);
    const dy = randomIntInclusive(rng, -maxDist, maxDist);

    const nextPos = {
      x: clampInt(pos.x + dx, bounds.minX, bounds.maxX),
      y: clampInt(pos.y + dy, bounds.minY, bounds.maxY),
    };

    await moveMouseTo(tab, nextPos.x, nextPos.y);
    pos = nextPos;
    await sleepRandom(tab, normalized.mouseMove.moveDelayMs, rng);
  }

  return pos;
}

export async function simulateFocusBlur(
  tab: BehaviorSimulatorTabLike,
  config: BehaviorSimulationConfig | NormalizedBehaviorSimulationConfig = {}
): Promise<void> {
  const normalized = isNormalized(config) ? config : normalizeBehaviorSimulationConfig(config);
  const rng = normalized.rng;

  const doBlur = rng() < normalized.focusBlur.blurProbability;

  if (doBlur) {
    if (tab.blur) {
      await tab.blur();
    } else if (tab.evaluate) {
      // Best-effort. In some pages `document.activeElement` may not support blur.
      await tab.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        el?.blur?.();
      });
    }
  } else {
    if (tab.focus) {
      await tab.focus();
    } else if (tab.evaluate) {
      await tab.evaluate(() => {
        document.body?.focus?.();
      });
    }
  }

  await sleepRandom(tab, normalized.focusBlur.delayMs, rng);
}

function isNormalized(
  config: BehaviorSimulationConfig | NormalizedBehaviorSimulationConfig
): config is NormalizedBehaviorSimulationConfig {
  return typeof (config as NormalizedBehaviorSimulationConfig).rng === "function";
}

function pickAction(
  config: NormalizedBehaviorSimulationConfig,
  rng: BehaviorSimulatorRandom
): BehaviorAction | null {
  const actions: Array<{ action: BehaviorAction; weight: number; enabled: boolean }> = [
    { action: "pause", weight: config.pause.probability, enabled: config.pause.enabled },
    { action: "scroll", weight: config.scroll.probability, enabled: config.scroll.enabled },
    {
      action: "mouseMove",
      weight: config.mouseMove.probability,
      enabled: config.mouseMove.enabled,
    },
    {
      action: "focusBlur",
      weight: config.focusBlur.probability,
      enabled: config.focusBlur.enabled,
    },
  ];

  const filtered = actions.filter((x) => x.enabled && x.weight > 0);
  if (filtered.length === 0) return null;

  const total = filtered.reduce((sum, x) => sum + x.weight, 0);
  if (total <= 0) return null;

  const r = rng() * total;
  let acc = 0;
  for (const item of filtered) {
    acc += item.weight;
    if (r <= acc) return item.action;
  }

  return filtered[filtered.length - 1].action;
}

function pickScrollSign(direction: ScrollDirection, rng: BehaviorSimulatorRandom): 1 | -1 {
  if (direction === "down") return 1;
  if (direction === "up") return -1;
  return rng() < 0.5 ? 1 : -1;
}

async function scrollBy(
  tab: BehaviorSimulatorTabLike,
  deltaX: number,
  deltaY: number
): Promise<void> {
  if (tab.scrollBy) {
    await tab.scrollBy(deltaX, deltaY);
    return;
  }
  if (tab.mouse?.wheel) {
    await tab.mouse.wheel(deltaX, deltaY);
    return;
  }
  if (tab.interact) {
    await tab.interact({ scroll: { x: deltaX, y: deltaY } });
  }
}

async function moveMouseTo(tab: BehaviorSimulatorTabLike, x: number, y: number): Promise<void> {
  if (tab.mouse?.move) {
    await tab.mouse.move(x, y);
    return;
  }
  if (tab.interact) {
    await tab.interact({ move: [x, y] });
  }
}

async function resolveViewport(
  tab: BehaviorSimulatorTabLike,
  config: NormalizedBehaviorSimulationConfig
): Promise<{ width: number; height: number }> {
  const fallback = { width: config.mouseMove.area.width, height: config.mouseMove.area.height };

  if (tab.getViewport) {
    const v = await tab.getViewport();
    if (v && Number.isFinite(v.width) && Number.isFinite(v.height) && v.width > 0 && v.height > 0) {
      return { width: v.width, height: v.height };
    }
  }

  if (tab.evaluate) {
    try {
      const v = await tab.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      if (isViewportSize(v)) return v;
    } catch {
      // Optional capability; fallback to configured area.
    }
  }

  return fallback;
}

function isViewportSize(value: unknown): value is { width: number; height: number } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const width = v.width;
  const height = v.height;
  return (
    typeof width === "number" &&
    typeof height === "number" &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  );
}

async function sleep(tab: BehaviorSimulatorTabLike, ms: number): Promise<void> {
  if (ms <= 0) return;
  if (tab.waitForTimeout) {
    await tab.waitForTimeout(ms);
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function sleepRandom(
  tab: BehaviorSimulatorTabLike,
  range: MsRange,
  rng: BehaviorSimulatorRandom
): Promise<void> {
  const ms = randomIntInclusive(rng, range.minMs, range.maxMs);
  await sleep(tab, ms);
}

function randomIntInclusive(rng: BehaviorSimulatorRandom, min: number, max: number): number {
  if (max < min) [min, max] = [max, min];
  if (min === max) return min;
  const r = rng();
  const n = Math.floor(r * (max - min + 1)) + min;
  // Guard against rng() === 1 (shouldn't happen, but keep inclusive bounds stable)
  if (n > max) return max;
  if (n < min) return min;
  return n;
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
