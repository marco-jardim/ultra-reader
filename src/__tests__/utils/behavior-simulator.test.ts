import { describe, it, expect } from "vitest";
import {
  createSeededRng,
  normalizeBehaviorSimulationConfig,
  simulateBehavior,
} from "../../utils/behavior-simulator.js";

describe("createSeededRng", () => {
  it("is deterministic for the same numeric seed", () => {
    const a = createSeededRng(123);
    const b = createSeededRng(123);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("is deterministic for the same string seed", () => {
    const a = createSeededRng("hello");
    const b = createSeededRng("hello");
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("produces different sequences for different seeds", () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    // Compare first few values to reduce flakiness.
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });
});

describe("normalizeBehaviorSimulationConfig", () => {
  it("clamps probabilities and fixes inverted ranges", () => {
    const normalized = normalizeBehaviorSimulationConfig({
      actionCount: { min: 10, max: 2 },
      betweenActionsDelayMs: { minMs: 50, maxMs: -10 },
      pause: { probability: 2, delayMs: { minMs: -1, maxMs: 0 } },
      scroll: { probability: -1, steps: { min: -5, max: 0 } },
      focusBlur: { blurProbability: 123 },
    });

    expect(normalized.actionCount).toEqual({ min: 2, max: 10 });
    expect(normalized.betweenActionsDelayMs.minMs).toBe(0);
    expect(normalized.betweenActionsDelayMs.maxMs).toBe(50);
    expect(normalized.pause.probability).toBe(1);
    expect(normalized.pause.delayMs).toEqual({ minMs: 0, maxMs: 0 });
    expect(normalized.scroll.probability).toBe(0);
    expect(normalized.scroll.steps).toEqual({ min: 0, max: 0 });
    expect(normalized.focusBlur.blurProbability).toBe(1);
  });

  it("uses injected rng over seed", () => {
    const normalized = normalizeBehaviorSimulationConfig({
      seed: 999,
      rng: () => 0.5,
    });
    expect(normalized.rng()).toBe(0.5);
  });
});

describe("simulateBehavior", () => {
  it("performs deterministic scroll steps with seeded rng and fixed ranges", async () => {
    const interactions: unknown[] = [];
    const sleeps: number[] = [];

    const tab = {
      interact(interaction: unknown) {
        interactions.push(interaction);
      },
      waitForTimeout(ms: number) {
        sleeps.push(ms);
      },
    };

    await simulateBehavior(tab, {
      seed: 42,
      actionCount: { min: 2, max: 2 },
      betweenActionsDelayMs: { minMs: 0, maxMs: 0 },
      pause: { enabled: false },
      mouseMove: { enabled: false },
      focusBlur: { enabled: false },
      scroll: {
        enabled: true,
        probability: 1,
        direction: "down",
        steps: { min: 2, max: 2 },
        stepYpx: { min: 50, max: 50 },
        stepDelayMs: { minMs: 0, maxMs: 0 },
      },
    });

    // 2 actions * 2 steps = 4 scroll interactions
    expect(interactions).toHaveLength(4);
    for (const i of interactions) {
      expect(i).toEqual({ scroll: { x: 0, y: 50 } });
    }

    // All configured delays are 0.
    expect(sleeps.every((ms) => ms === 0)).toBe(true);
  });
});
