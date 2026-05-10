import { logger } from "../config/logger";
import { supabase } from "../config/database";

/**
 * Stale Push Token Cleanup
 *
 * Removes push_tokens rows that have been inactive for more than 90 days.
 * Inactive means we previously marked is_active=false (token rejected by
 * Expo as invalid, or DeviceNotRegistered, or user-unregistered).
 *
 * Run weekly:
 * - Cron: `0 3 * * 0 bun run src/jobs/cleanup-stale-push-tokens.ts`
 */

const STALE_DAYS = 90;

async function runCleanup() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STALE_DAYS);
  const cutoffIso = cutoff.toISOString();

  logger.info("Starting stale push token cleanup", { cutoff: cutoffIso });

  const { data, error } = await supabase
    .from("push_tokens")
    .delete()
    .eq("is_active", false)
    .lt("updated_at", cutoffIso)
    .select("id");

  if (error) {
    logger.error("Error deleting stale push tokens", { error });
    throw error;
  }

  logger.info("Stale push token cleanup completed", {
    deleted: data?.length ?? 0,
  });
}

if (import.meta.main) {
  runCleanup()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Stale push token cleanup error", { error });
      process.exit(1);
    });
}

export { runCleanup };
