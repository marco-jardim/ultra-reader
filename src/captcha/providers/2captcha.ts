import {
  CaptchaHttpClient,
  CaptchaProvider,
  CaptchaSolveRequest,
  CaptchaSolveResult,
} from "../types";
import {
  CaptchaProviderBadResponseError,
  CaptchaProviderRequestError,
  CaptchaUnsupportedError,
} from "../errors";

interface TwoCaptchaConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

type TwoCaptchaInResponse = string;
type TwoCaptchaResResponse = string;

function defaultHttpClient(): CaptchaHttpClient {
  const postJson: CaptchaHttpClient["postJson"] = async () => {
    throw new Error("2Captcha provider does not use JSON posts");
  };

  const postForm = async <TResponse>(
    url: string,
    form: URLSearchParams,
    options?: { timeoutMs?: number; headers?: Record<string, string> }
  ): Promise<TResponse> => {
    const controller = new AbortController();
    const timeout = options?.timeoutMs;
    const timer = timeout ? setTimeout(() => controller.abort(), timeout) : undefined;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          ...(options?.headers ?? {}),
        },
        body: form.toString(),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return (await res.text()) as unknown as TResponse;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  return { postJson, postForm };
}

export function build2CaptchaInForm(apiKey: string, request: CaptchaSolveRequest): URLSearchParams {
  // 2Captcha uses "userrecaptcha" for Google reCAPTCHA and Turnstile.
  // We only build the request here; solve() does submission + polling.
  // Docs vary by captcha type; keep this minimal for Phase 2.1.
  if (
    request.captchaType !== "turnstile" &&
    request.captchaType !== "recaptcha_v2" &&
    request.captchaType !== "recaptcha_v3"
  ) {
    const _exhaustive: never = request.captchaType;
    throw new CaptchaUnsupportedError(`Unsupported captcha type: ${String(_exhaustive)}`);
  }

  const form = new URLSearchParams();
  form.set("key", apiKey);
  form.set("method", "userrecaptcha");
  form.set("googlekey", request.siteKey);
  form.set("pageurl", request.pageUrl);
  form.set("json", "0");

  if (request.captchaType === "recaptcha_v3") {
    if (request.action) form.set("action", request.action);
    if (typeof request.minScore === "number") form.set("min_score", String(request.minScore));
    form.set("version", "v3");
  }

  return form;
}

function parseInResponse(text: string): { requestId: string } {
  // Expected: "OK|<id>" or "ERROR_..."
  const trimmed = text.trim();
  if (!trimmed.startsWith("OK|")) {
    throw new Error(trimmed);
  }
  const requestId = trimmed.slice(3);
  if (!requestId) {
    throw new Error("missing request id");
  }
  return { requestId };
}

function parseResResponse(text: string): { status: "processing" | "ready"; token?: string } {
  // Expected: "CAPCHA_NOT_READY" or "OK|<token>" or "ERROR_..."
  const trimmed = text.trim();
  if (trimmed === "CAPCHA_NOT_READY") {
    return { status: "processing" };
  }
  if (trimmed.startsWith("OK|")) {
    const token = trimmed.slice(3);
    return { status: "ready", token };
  }
  throw new Error(trimmed);
}

export function create2CaptchaProvider(
  config: TwoCaptchaConfig,
  deps?: { httpClient?: CaptchaHttpClient; pollIntervalMs?: number; maxPolls?: number }
): CaptchaProvider {
  const baseUrl = config.baseUrl ?? "https://2captcha.com";
  const timeoutMs = config.timeoutMs ?? 60_000;
  const httpClient = deps?.httpClient ?? defaultHttpClient();
  const pollIntervalMs = deps?.pollIntervalMs ?? 5000;
  const maxPolls = deps?.maxPolls ?? 24;

  async function submit(request: CaptchaSolveRequest): Promise<string> {
    const form = build2CaptchaInForm(config.apiKey, request);
    let text: TwoCaptchaInResponse;
    try {
      text = (await httpClient.postForm(`${baseUrl}/in.php`, form, {
        timeoutMs,
      })) as TwoCaptchaInResponse;
    } catch (error) {
      throw new CaptchaProviderRequestError(
        "2captcha",
        `2Captcha in.php request failed: ${String(error)}`,
        {
          cause: error instanceof Error ? error : undefined,
          retryable: true,
        }
      );
    }

    try {
      return parseInResponse(text).requestId;
    } catch (error) {
      throw new CaptchaProviderBadResponseError(
        "2captcha",
        `2Captcha in.php returned error: ${text.trim()}`,
        {
          cause: error instanceof Error ? error : undefined,
          retryable: true,
        }
      );
    }
  }

  async function poll(requestId: string): Promise<CaptchaSolveResult> {
    for (let i = 0; i < maxPolls; i++) {
      const form = new URLSearchParams();
      form.set("key", config.apiKey);
      form.set("action", "get");
      form.set("id", requestId);
      form.set("json", "0");

      let text: TwoCaptchaResResponse;
      try {
        text = (await httpClient.postForm(`${baseUrl}/res.php`, form, {
          timeoutMs,
        })) as TwoCaptchaResResponse;
      } catch (error) {
        throw new CaptchaProviderRequestError(
          "2captcha",
          `2Captcha res.php request failed: ${String(error)}`,
          {
            cause: error instanceof Error ? error : undefined,
            retryable: true,
          }
        );
      }

      try {
        const parsed = parseResResponse(text);
        if (parsed.status === "ready") {
          if (!parsed.token) {
            throw new Error("missing token");
          }
          return { provider: "2captcha", token: parsed.token, raw: text };
        }
      } catch (error) {
        throw new CaptchaProviderBadResponseError(
          "2captcha",
          `2Captcha res.php returned error: ${text.trim()}`,
          {
            cause: error instanceof Error ? error : undefined,
            retryable: true,
          }
        );
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new CaptchaProviderRequestError("2captcha", "2Captcha polling timed out", {
      retryable: true,
    });
  }

  return {
    id: "2captcha",
    async solve(request: CaptchaSolveRequest): Promise<CaptchaSolveResult> {
      const requestId = await submit(request);
      return poll(requestId);
    },
  };
}
