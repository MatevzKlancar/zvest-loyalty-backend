import { Hono } from "hono";
import { logger } from "../../config/logger";
import { env } from "../../config/env";

import { runBirthdayNotifications } from "../../jobs/birthday-notifications";
import { runReceiptChecker } from "../../jobs/check-notification-receipts";
import { runDispatcher } from "../../jobs/dispatch-scheduled-notifications";
import { runMaterializer } from "../../jobs/materialize-notification-plans";
import { runCleanup } from "../../jobs/cleanup-stale-push-tokens";
import { runDigest } from "../../jobs/dispatch-digest";

/**
 * Internal job endpoints triggered by pg_cron via pg_net. Each route is the
 * same job that's runnable as a CLI script (src/jobs/*.ts) — wrapped in HTTP
 * so a Postgres scheduler can fire it without spawning a process.
 *
 * All routes require the X-Job-Secret header to match INTERNAL_JOB_SECRET.
 * If the env var is unset, every route returns 503 — better to fail loud
 * than to leave the door open.
 */
export const internalJobsController = new Hono();

internalJobsController.use("*", async (c, next) => {
  const expected = env.INTERNAL_JOB_SECRET;
  if (!expected) {
    logger.error(
      "Internal job endpoint hit but INTERNAL_JOB_SECRET is not configured"
    );
    return c.json(
      { success: false, message: "Internal jobs disabled" },
      503
    );
  }
  const provided = c.req.header("x-job-secret");
  if (provided !== expected) {
    return c.json({ success: false, message: "Forbidden" }, 403);
  }
  await next();
});

function wrap(name: string, runner: () => Promise<void>) {
  return async (c: any) => {
    const startedAt = Date.now();
    logger.info(`[internal-job] ${name} starting`);
    try {
      await runner();
      const ms = Date.now() - startedAt;
      logger.info(`[internal-job] ${name} ok`, { ms });
      return c.json({ success: true, job: name, ms });
    } catch (error) {
      const ms = Date.now() - startedAt;
      logger.error(`[internal-job] ${name} failed`, { error, ms });
      return c.json(
        { success: false, job: name, ms, message: String(error) },
        500
      );
    }
  };
}

internalJobsController.post(
  "/dispatch-scheduled-notifications",
  wrap("dispatch-scheduled-notifications", runDispatcher)
);

internalJobsController.post(
  "/dispatch-digest",
  wrap("dispatch-digest", runDigest)
);

internalJobsController.post(
  "/materialize-notification-plans",
  wrap("materialize-notification-plans", runMaterializer)
);

internalJobsController.post(
  "/birthday-notifications",
  wrap("birthday-notifications", runBirthdayNotifications)
);

internalJobsController.post(
  "/check-notification-receipts",
  wrap("check-notification-receipts", runReceiptChecker)
);

internalJobsController.post(
  "/cleanup-stale-push-tokens",
  wrap("cleanup-stale-push-tokens", runCleanup)
);
