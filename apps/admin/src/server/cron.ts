import { bearerTokenMatches } from "@website/security";

/** A cron job: one bounded, idempotent batch per call (target < 30 s), returns a summary. */
export type CronJob = () => Promise<Record<string, unknown>>;

/**
 * The jobs cPanel Cron Jobs may call (apps/admin/docs/cron.md). Add one line per job here and
 * one crontab line on the server. `noop` checks the set-up end to end.
 */
export const CRON_JOBS: Readonly<Record<string, CronJob>> = {
  noop: () => Promise.resolve({ processed: 0 }),
};

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * GET /cron/<job> with `Authorization: Bearer CRON_SECRET` (constant-time compare). Wrong or
 * missing secret → 401 (also for unknown jobs, so job names are not revealed); unknown job →
 * 404; a failing job → 500 with a generic body and the error in the log.
 */
export function createCronRoute(options: {
  secret: string | undefined;
  jobs: Readonly<Record<string, CronJob>>;
  log: (entry: Record<string, unknown>) => void;
}) {
  return async (job: string, request: Request): Promise<Response> => {
    if (!bearerTokenMatches(request.headers.get("authorization"), options.secret ?? "")) {
      return json({ error: "unauthenticated" }, 401);
    }
    const run = Object.hasOwn(options.jobs, job) ? options.jobs[job] : undefined;
    if (!run) return json({ error: "not_found" }, 404);
    const started = Date.now();
    try {
      const result = await run();
      options.log({ message: "cron_job_done", job, ms: Date.now() - started, ...result });
      return json({ job, ok: true, result }, 200);
    } catch (error) {
      options.log({ message: "cron_job_failed", job, error: String(error) });
      return json({ job, ok: false }, 500);
    }
  };
}
