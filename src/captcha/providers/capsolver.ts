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

interface CapSolverConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

type CapSolverTaskType =
  | "TurnstileTaskProxyLess"
  | "ReCaptchaV2TaskProxyLess"
  | "ReCaptchaV3TaskProxyLess";

interface CapSolverCreateTaskResponse {
  errorId: number;
  errorDescription?: string;
  taskId?: string | number;
}

interface CapSolverGetTaskResultResponse {
  errorId: number;
  errorDescription?: string;
  status?: "processing" | "ready";
  solution?: {
    token?: string;
    gRecaptchaResponse?: string;
  };
}

function defaultHttpClient(): CaptchaHttpClient {
  const postJson = async <TResponse>(
    url: string,
    body: unknown,
    options?: { timeoutMs?: number; headers?: Record<string, string> }
  ): Promise<TResponse> => {
    const controller = new AbortController();
    const timeout = options?.timeoutMs;
    const timer = timeout ? setTimeout(() => controller.abort(), timeout) : undefined;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options?.headers ?? {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as TResponse;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const postForm: CaptchaHttpClient["postForm"] = async () => {
    throw new Error("CapSolver provider does not use form posts");
  };

  return { postJson, postForm };
}

function getTaskType(request: CaptchaSolveRequest): CapSolverTaskType {
  switch (request.captchaType) {
    case "turnstile":
      return "TurnstileTaskProxyLess";
    case "recaptcha_v2":
      return "ReCaptchaV2TaskProxyLess";
    case "recaptcha_v3":
      return "ReCaptchaV3TaskProxyLess";
    default: {
      const _exhaustive: never = request.captchaType;
      throw new CaptchaUnsupportedError(`Unsupported captcha type: ${String(_exhaustive)}`);
    }
  }
}

export function buildCapSolverCreateTaskRequest(
  apiKey: string,
  request: CaptchaSolveRequest
): Record<string, unknown> {
  const taskType = getTaskType(request);

  const task: Record<string, unknown> = {
    type: taskType,
    websiteURL: request.pageUrl,
    websiteKey: request.siteKey,
  };

  if (request.captchaType === "recaptcha_v3") {
    if (request.action) task.pageAction = request.action;
    if (typeof request.minScore === "number") task.minScore = request.minScore;
  }

  return {
    clientKey: apiKey,
    task,
  };
}

export function createCapSolverProvider(
  config: CapSolverConfig,
  deps?: { httpClient?: CaptchaHttpClient; pollIntervalMs?: number; maxPolls?: number }
): CaptchaProvider {
  const baseUrl = config.baseUrl ?? "https://api.capsolver.com";
  const timeoutMs = config.timeoutMs ?? 60_000;
  const httpClient = deps?.httpClient ?? defaultHttpClient();
  const pollIntervalMs = deps?.pollIntervalMs ?? 1500;
  const maxPolls = deps?.maxPolls ?? 40;

  async function createTask(request: CaptchaSolveRequest): Promise<string> {
    const payload = buildCapSolverCreateTaskRequest(config.apiKey, request);
    let res: CapSolverCreateTaskResponse;
    try {
      res = (await httpClient.postJson(`${baseUrl}/createTask`, payload, {
        timeoutMs,
      })) as CapSolverCreateTaskResponse;
    } catch (error) {
      throw new CaptchaProviderRequestError(
        "capsolver",
        `CapSolver createTask request failed: ${String(error)}`,
        {
          cause: error instanceof Error ? error : undefined,
          retryable: true,
        }
      );
    }

    if (res.errorId !== 0 || res.taskId === undefined) {
      throw new CaptchaProviderBadResponseError(
        "capsolver",
        `CapSolver createTask failed: ${res.errorDescription ?? "unknown error"}`,
        { retryable: true }
      );
    }

    return String(res.taskId);
  }

  async function getResult(taskId: string): Promise<CaptchaSolveResult> {
    for (let i = 0; i < maxPolls; i++) {
      let res: CapSolverGetTaskResultResponse;
      try {
        res = (await httpClient.postJson(
          `${baseUrl}/getTaskResult`,
          { clientKey: config.apiKey, taskId },
          { timeoutMs }
        )) as CapSolverGetTaskResultResponse;
      } catch (error) {
        throw new CaptchaProviderRequestError(
          "capsolver",
          `CapSolver getTaskResult request failed: ${String(error)}`,
          {
            cause: error instanceof Error ? error : undefined,
            retryable: true,
          }
        );
      }

      if (res.errorId !== 0) {
        throw new CaptchaProviderBadResponseError(
          "capsolver",
          `CapSolver getTaskResult failed: ${res.errorDescription ?? "unknown error"}`,
          { retryable: true }
        );
      }

      if (res.status === "ready") {
        const token = res.solution?.token ?? res.solution?.gRecaptchaResponse;
        if (!token) {
          throw new CaptchaProviderBadResponseError(
            "capsolver",
            "CapSolver returned ready status but no token",
            {
              retryable: true,
            }
          );
        }
        return { provider: "capsolver", token, raw: res };
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new CaptchaProviderRequestError("capsolver", "CapSolver polling timed out", {
      retryable: true,
    });
  }

  return {
    id: "capsolver",
    async solve(request: CaptchaSolveRequest): Promise<CaptchaSolveResult> {
      const taskId = await createTask(request);
      return getResult(taskId);
    },
  };
}
