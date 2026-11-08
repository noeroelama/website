import { bearerTokenMatches } from "@website/security";

export type CronJob = () => Promise<Record<string, unknown>>;

export const CRON_JOBS: Readonly<Record<string, CronJob>> = {
  noop: () => Promise.resolve({ processed: 0 }),
};

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

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
