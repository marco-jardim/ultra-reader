export type CaptchaProviderId = "capsolver" | "2captcha";

export type CaptchaType = "turnstile" | "recaptcha_v2" | "recaptcha_v3";

export interface CaptchaSolveRequest {
  captchaType: CaptchaType;
  pageUrl: string;
  siteKey: string;
  /** reCAPTCHA v3 only */
  action?: string;
  /** reCAPTCHA v3 only */
  minScore?: number;
}

export interface CaptchaSolveResult {
  provider: CaptchaProviderId;
  token: string;
  /** Provider-specific raw response for debugging/telemetry */
  raw?: unknown;
}

export interface CaptchaProvider {
  readonly id: CaptchaProviderId;
  solve(request: CaptchaSolveRequest): Promise<CaptchaSolveResult>;
}

export interface CaptchaHttpClient {
  postJson<TResponse>(
    url: string,
    body: unknown,
    options?: { timeoutMs?: number; headers?: Record<string, string> }
  ): Promise<TResponse>;
  postForm<TResponse>(
    url: string,
    form: URLSearchParams,
    options?: { timeoutMs?: number; headers?: Record<string, string> }
  ): Promise<TResponse>;
}

export interface CaptchaDomainBudgetConfig {
  /** Maximum solve attempts per domain per UTC day. */
  maxPerDomainPerDay: number;
}

export interface CaptchaSolverConfig {
  primary: CaptchaProviderId;
  fallback?: CaptchaProviderId;
  budget?: CaptchaDomainBudgetConfig;
  providers: {
    capsolver?: {
      apiKey: string;
      baseUrl?: string;
      timeoutMs?: number;
    };
    "2captcha"?: {
      apiKey: string;
      baseUrl?: string;
      timeoutMs?: number;
    };
  };
}
