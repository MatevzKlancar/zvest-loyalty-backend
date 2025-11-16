import { logger } from "../config/logger";
import { pushNotificationService } from "../services/push-notifications";

/**
 * Notification Receipts Checker Job
 *
 * This job checks the delivery status of sent push notifications.
 * Should be run every 15-30 minutes to verify delivery and handle errors.
 *
 * You can run this job using:
 * - Cron job: `*/15 * * * * bun run src/jobs/check-notification-receipts.ts`
 * - Cloud scheduler
 * - Manual trigger: `bun run src/jobs/check-notification-receipts.ts`
 */

async function runReceiptChecker() {
  logger.info("Starting notification receipts check job");

  try {
    await pushNotificationService.checkReceipts();
    logger.info("Notification receipts check job completed successfully");
  } catch (error) {
    logger.error("Notification receipts check job failed", { error });
    throw error;
  }
}

// Run if executed directly
if (import.meta.main) {
  runReceiptChecker()
    .then(() => {
      logger.info("Receipt check job finished");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("Receipt check job error", { error });
      process.exit(1);
    });
}

export { runReceiptChecker };
