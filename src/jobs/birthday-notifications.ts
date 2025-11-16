import { logger } from "../config/logger";
import { pushNotificationService } from "../services/push-notifications";

/**
 * Birthday Notification Job
 *
 * This job should be run once daily (recommended at 9 AM local time)
 * to send birthday notifications to customers.
 *
 * You can run this job using:
 * - Cron job: `0 9 * * * bun run src/jobs/birthday-notifications.ts`
 * - Cloud scheduler (e.g., Render Cron Jobs, AWS EventBridge)
 * - Manual trigger: `bun run src/jobs/birthday-notifications.ts`
 */

async function runBirthdayNotifications() {
  logger.info("Starting birthday notifications job");

  try {
    await pushNotificationService.sendBirthdayNotifications();
    logger.info("Birthday notifications job completed successfully");
  } catch (error) {
    logger.error("Birthday notifications job failed", { error });
    throw error;
  }
}

// Run if executed directly
if (import.meta.main) {
  runBirthdayNotifications()
    .then(() => {
      logger.info("Birthday notifications job finished");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("Birthday notifications job error", { error });
      process.exit(1);
    });
}

export { runBirthdayNotifications };
