export enum CaptchaErrorCode {
  BUDGET_EXCEEDED = "BUDGET_EXCEEDED",
  NO_PROVIDER_AVAILABLE = "NO_PROVIDER_AVAILABLE",
  PROVIDER_REQUEST_FAILED = "PROVIDER_REQUEST_FAILED",
  PROVIDER_BAD_RESPONSE = "PROVIDER_BAD_RESPONSE",
  SITEKEY_NOT_FOUND = "SITEKEY_NOT_FOUND",
  UNSUPPORTED = "UNSUPPORTED",
}

export class CaptchaError extends Error {
  readonly code: CaptchaErrorCode;
  readonly provider?: string;
  readonly retryable: boolean;
  readonly cause?: Error;
  readonly timestamp: string;

  constructor(
    message: string,
    code: CaptchaErrorCode,
    options?: { provider?: string; retryable?: boolean; cause?: Error }
  ) {
    super(message);
    this.name = "CaptchaError";
    this.code = code;
    this.provider = options?.provider;
    this.retryable = options?.retryable ?? false;
    this.cause = options?.cause;
    this.timestamp = new Date().toISOString();

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class CaptchaBudgetExceededError extends CaptchaError {
  readonly domain: string;
  readonly used: number;
  readonly limit: number;

  constructor(domain: string, used: number, limit: number) {
    super(
      `CAPTCHA budget exceeded for domain ${domain}: used ${used}/${limit} (UTC day)`,
      CaptchaErrorCode.BUDGET_EXCEEDED,
      { retryable: false }
    );
    this.name = "CaptchaBudgetExceededError";
    this.domain = domain;
    this.used = used;
    this.limit = limit;
  }
}

export class CaptchaNoProviderError extends CaptchaError {
  constructor(message: string) {
    super(message, CaptchaErrorCode.NO_PROVIDER_AVAILABLE, { retryable: false });
    this.name = "CaptchaNoProviderError";
  }
}

export class CaptchaProviderRequestError extends CaptchaError {
  constructor(provider: string, message: string, options?: { cause?: Error; retryable?: boolean }) {
    super(message, CaptchaErrorCode.PROVIDER_REQUEST_FAILED, {
      provider,
      retryable: options?.retryable ?? true,
      cause: options?.cause,
    });
    this.name = "CaptchaProviderRequestError";
  }
}

export class CaptchaProviderBadResponseError extends CaptchaError {
  constructor(provider: string, message: string, options?: { cause?: Error; retryable?: boolean }) {
    super(message, CaptchaErrorCode.PROVIDER_BAD_RESPONSE, {
      provider,
      retryable: options?.retryable ?? true,
      cause: options?.cause,
    });
    this.name = "CaptchaProviderBadResponseError";
  }
}

export class CaptchaSiteKeyNotFoundError extends CaptchaError {
  constructor(message: string) {
    super(message, CaptchaErrorCode.SITEKEY_NOT_FOUND, { retryable: false });
    this.name = "CaptchaSiteKeyNotFoundError";
  }
}

export class CaptchaUnsupportedError extends CaptchaError {
  constructor(message: string) {
    super(message, CaptchaErrorCode.UNSUPPORTED, { retryable: false });
    this.name = "CaptchaUnsupportedError";
  }
}
