import { describe, expect, test, vi } from "vitest";
import { CaptchaErrorCode, CaptchaProviderRequestError } from "./errors";
import { createMultiProvider, selectProviderOrder } from "./multi-provider";
import { CaptchaProvider } from "./types";

describe("selectProviderOrder", () => {
  test("returns primary only when no fallback", () => {
    expect(selectProviderOrder("capsolver")).toEqual(["capsolver"]);
  });

  test("returns primary then fallback", () => {
    expect(selectProviderOrder("capsolver", "2captcha")).toEqual(["capsolver", "2captcha"]);
  });

  test("dedupes when fallback equals primary", () => {
    expect(selectProviderOrder("capsolver", "capsolver")).toEqual(["capsolver"]);
  });
});

describe("createMultiProvider", () => {
  test("tries fallback when primary fails with retryable CaptchaError", async () => {
    const primary: CaptchaProvider = {
      id: "capsolver",
      solve: vi.fn(async () => {
        throw new CaptchaProviderRequestError("capsolver", "boom", { retryable: true });
      }),
    };
    const fallback: CaptchaProvider = {
      id: "2captcha",
      solve: vi.fn(async () => ({ provider: "2captcha" as const, token: "tok" })),
    };

    const solver = createMultiProvider(
      {
        primary: "capsolver",
        fallback: "2captcha",
        providers: {
          capsolver: { apiKey: "x" },
          "2captcha": { apiKey: "y" },
        },
      },
      {
        providers: {
          capsolver: primary,
          "2captcha": fallback,
        },
      }
    );

    const res = await solver.solve({
      captchaType: "turnstile",
      pageUrl: "https://example.com",
      siteKey: "k",
    });
    expect(res.provider).toBe("2captcha");
    expect(primary.solve).toHaveBeenCalledTimes(1);
    expect(fallback.solve).toHaveBeenCalledTimes(1);
  });

  test("does not try fallback when primary fails with non-retryable CaptchaError", async () => {
    const primary: CaptchaProvider = {
      id: "capsolver",
      solve: vi.fn(async () => {
        throw new CaptchaProviderRequestError("capsolver", "fatal", { retryable: false });
      }),
    };
    const fallback: CaptchaProvider = {
      id: "2captcha",
      solve: vi.fn(async () => ({ provider: "2captcha" as const, token: "tok" })),
    };
    const solver = createMultiProvider(
      {
        primary: "capsolver",
        fallback: "2captcha",
        providers: {
          capsolver: { apiKey: "x" },
          "2captcha": { apiKey: "y" },
        },
      },
      { providers: { capsolver: primary, "2captcha": fallback } }
    );

    await expect(
      solver.solve({ captchaType: "turnstile", pageUrl: "https://example.com", siteKey: "k" })
    ).rejects.toMatchObject({ code: CaptchaErrorCode.PROVIDER_REQUEST_FAILED, retryable: false });
    expect(primary.solve).toHaveBeenCalledTimes(1);
    expect(fallback.solve).not.toHaveBeenCalled();
  });
});
