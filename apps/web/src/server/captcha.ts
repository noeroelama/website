import "server-only";
import type { CaptchaVerifier } from "@website/domain/newsletter";

export function createRecaptchaVerifier(options: {
  secret: string;
  fetchImpl: typeof fetch;
}): CaptchaVerifier {
  const doFetch = options.fetchImpl;
  return {
    async verify(token, expectedAction) {
      try {
        const response = await doFetch("https://www.google.com/recaptcha/api/siteverify", {
          method: "POST",
          signal: AbortSignal.timeout(5_000),
          body: new URLSearchParams({ secret: options.secret, response: token }),
        });
        const data = (await response.json()) as {
          success?: boolean;
          score?: number;
          action?: string;
        };
        return {
          success: data.success === true && data.action === expectedAction,
          score: typeof data.score === "number" ? data.score : null,
        };
      } catch {
        return { success: false, score: null };
      }
    },
  };
}

export async function passesCaptcha(
  verifier: CaptchaVerifier | null,
  config: { minScore: number; appEnv: string },
  token: string,
  action: string,
): Promise<boolean> {
  if (!verifier) return config.appEnv === "development" || config.appEnv === "test";
  const result = await verifier.verify(token, action);
  return result.success && (result.score ?? 0) >= config.minScore;
}
