import { logger } from "../config/logger";
import { supabase } from "../config/database";
import { pushNotificationService } from "../services/push-notifications";

/**
 * Scheduled Notification Dispatcher
 *
 * Picks up rows from scheduled_notifications where scheduled_for <= now()
 * AND status='scheduled', dispatches them via the push service, and writes
 * back the outcome.
 *
 * Run every minute:
 * - Cron: `* * * * * bun run src/jobs/dispatch-scheduled-notifications.ts`
 * - Cloud scheduler (Render Cron Jobs, AWS EventBridge, etc.)
 */

const BATCH_SIZE = 50;

async function runDispatcher() {
  logger.info("Starting scheduled notification dispatcher");

  const nowIso = new Date().toISOString();

  const { data: due, error } = await supabase
    .from("scheduled_notifications")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    logger.error("Error fetching due scheduled notifications", { error });
    throw error;
  }

  if (!due || due.length === 0) {
    logger.info("No scheduled notifications due");
    return;
  }

  logger.info("Dispatching scheduled notifications", { count: due.length });

  for (const row of due) {
    // Claim row to avoid double-dispatch if jobs overlap.
    const { data: claimed, error: claimErr } = await supabase
      .from("scheduled_notifications")
      .update({ status: "sending", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "scheduled")
      .select("id")
      .single();

    if (claimErr || !claimed) {
      logger.warn("Could not claim scheduled notification (already taken?)", {
        id: row.id,
      });
      continue;
    }

    try {
      const result = await pushNotificationService.sendToShopCustomers(
        row.shop_id,
        {
          title: row.title,
          body: row.body,
          data: row.data || {},
          notificationType: row.notification_type,
        }
      );

      const total = "total" in result ? result.total : 0;

      await supabase
        .from("scheduled_notifications")
        .update({
          status: "sent",
          recipient_count: total,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      logger.info("Dispatched scheduled notification", {
        id: row.id,
        shopId: row.shop_id,
        recipients: total,
      });
    } catch (err) {
      logger.error("Failed to dispatch scheduled notification", {
        error: err,
        id: row.id,
      });
      await supabase
        .from("scheduled_notifications")
        .update({
          status: "failed",
          error_message: err instanceof Error ? err.message : String(err),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
  }
}

if (import.meta.main) {
  runDispatcher()
    .then(() => {
      logger.info("Scheduled notification dispatcher finished");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("Scheduled notification dispatcher error", { error });
      process.exit(1);
    });
}

export { runDispatcher };
