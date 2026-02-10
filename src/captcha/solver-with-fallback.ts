import type {
  CaptchaProvider,
  CaptchaSolveRequest,
  CaptchaSolveResult,
  CaptchaSolverConfig,
} from "./types";
import { createMultiProvider } from "./multi-provider";

export type MultiProviderDeps = Parameters<typeof createMultiProvider>[1];

/**
 * Create a CAPTCHA solver that tries a primary config first and falls back to a secondary
 * config if the primary throws.
 */
export function createCaptchaSolverWithFallback(
  primary?: CaptchaSolverConfig,
  fallback?: CaptchaSolverConfig,
  deps?: {
    primary?: MultiProviderDeps;
    fallback?: MultiProviderDeps;
  }
): CaptchaProvider | null {
  if (!primary && !fallback) return null;

  const primarySolver = primary ? createMultiProvider(primary, deps?.primary) : null;
  const fallbackSolver = fallback ? createMultiProvider(fallback, deps?.fallback) : null;

  const id = (primarySolver?.id ?? fallbackSolver?.id) as CaptchaProvider["id"];

  return {
    id,
    async solve(request: CaptchaSolveRequest): Promise<CaptchaSolveResult> {
      if (primarySolver) {
        try {
          return await primarySolver.solve(request);
        } catch (error) {
          if (!fallbackSolver) throw error;
        }
      }

      if (!fallbackSolver) {
        // This should be unreachable because at least one config is provided.
        throw new Error("No CAPTCHA solver configured");
      }
      return fallbackSolver.solve(request);
    },
  };
}
