import { describe, expect, test, vi } from "vitest";
import type { CaptchaProvider } from "./types";
import { createCaptchaSolverWithFallback } from "./solver-with-fallback";

describe("createCaptchaSolverWithFallback", () => {
  test("returns null when no configs provided", () => {
    expect(createCaptchaSolverWithFallback(undefined, undefined)).toBeNull();
  });

  test("uses primary solver when it succeeds", async () => {
    const primary: CaptchaProvider = {
      id: "capsolver",
      solve: vi.fn(async () => ({ provider: "capsolver" as const, token: "tok-primary" })),
    };
    const fallback: CaptchaProvider = {
      id: "2captcha",
      solve: vi.fn(async () => ({ provider: "2captcha" as const, token: "tok-fallback" })),
    };

    const solver = createCaptchaSolverWithFallback(
      { primary: "capsolver", providers: {} },
      { primary: "2captcha", providers: {} },
      {
        primary: { providers: { capsolver: primary } },
        fallback: { providers: { "2captcha": fallback } },
      }
    );

    expect(solver).not.toBeNull();
    const res = await solver!.solve({
      captchaType: "turnstile",
      pageUrl: "https://a.com",
      siteKey: "k",
    });
    expect(res.provider).toBe("capsolver");
    expect(primary.solve).toHaveBeenCalledTimes(1);
    expect(fallback.solve).not.toHaveBeenCalled();
  });

  test("uses fallback solver when primary throws", async () => {
    const primary: CaptchaProvider = {
      id: "capsolver",
      solve: vi.fn(async () => {
        throw new Error("primary failed");
      }),
    };
    const fallback: CaptchaProvider = {
      id: "2captcha",
      solve: vi.fn(async () => ({ provider: "2captcha" as const, token: "tok" })),
    };

    const solver = createCaptchaSolverWithFallback(
      { primary: "capsolver", providers: {} },
      { primary: "2captcha", providers: {} },
      {
        primary: { providers: { capsolver: primary } },
        fallback: { providers: { "2captcha": fallback } },
      }
    );

    const res = await solver!.solve({
      captchaType: "turnstile",
      pageUrl: "https://b.com",
      siteKey: "k",
    });
    expect(res.provider).toBe("2captcha");
    expect(primary.solve).toHaveBeenCalledTimes(1);
    expect(fallback.solve).toHaveBeenCalledTimes(1);
  });
});
