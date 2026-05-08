import { logger } from "../config/logger";
import { supabase } from "../config/database";
import { pushNotificationService } from "../services/push-notifications";

/**
 * Digest Dispatcher
 *
 * Reads queued rows from notification_outbox whose digest_window_at is now or
 * past, groups by recipient, and ships either:
 *   - one normal push per row when a user has only one staged notification, OR
 *   - one bundled "digest" push when a user has 2+ staged notifications across
 *     different shops in the same time bucket.
 *
 * The second case is the whole point: a user following 5 restaurants that all
 * push a daily-meal at 11:30 gets ONE notification, tap-through opens a digest
 * screen on the native app showing all 5 items.
 *
 * Stale rows (digest_window_at older than 24h and still queued) are marked
 * 'skipped' to keep the table from growing unbounded if the job ever lags.
 *
 * Cadence: every minute, just behind the main dispatcher. Either order works.
 */

const STALE_HOURS = 24;
const MAX_BATCH = 2000; // outbox rows pulled per run
const MAX_NAMED_SHOPS = 3; // how many shop names appear before "+N more"

type OutboxRow = {
  id: string;
  app_user_id: string;
  shop_id: string;
  notification_type: string;
  title: string;
  body: string;
  data: Record<string, any> | null;
  digest_window_at: string;
  source: string;
};

async function runDigest() {
  logger.info("Starting digest dispatcher");

  const nowIso = new Date().toISOString();
  const staleCutoff = new Date(
    Date.now() - STALE_HOURS * 60 * 60 * 1000
  ).toISOString();

  // 1) Sweep stale rows so they don't fire late.
  const { data: stale } = await supabase
    .from("notification_outbox")
    .update({ status: "skipped" })
    .eq("status", "queued")
    .lt("digest_window_at", staleCutoff)
    .select("id");
  if (stale && stale.length > 0) {
    logger.warn("Skipped stale outbox rows", { count: stale.length });
  }

  // 2) Pull due queued rows.
  const { data: due, error } = await supabase
    .from("notification_outbox")
    .select(
      "id, app_user_id, shop_id, notification_type, title, body, data, digest_window_at, source"
    )
    .eq("status", "queued")
    .lte("digest_window_at", nowIso)
    .order("digest_window_at", { ascending: true })
    .limit(MAX_BATCH);

  if (error) {
    logger.error("Error fetching outbox", { error });
    throw error;
  }
  if (!due || due.length === 0) {
    logger.info("No outbox rows due");
    return;
  }

  // 3) Group by (app_user_id, digest_window_at). Same user across windows
  //    yields separate groups intentionally — we don't bundle across time.
  const groups = new Map<string, OutboxRow[]>();
  for (const row of due as OutboxRow[]) {
    const key = `${row.app_user_id}__${row.digest_window_at}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  logger.info("Digest groups", {
    rows: due.length,
    groups: groups.size,
  });

  // 4) Resolve shop names once for everything we'll need to render.
  const shopIds = Array.from(new Set((due as OutboxRow[]).map((r) => r.shop_id)));
  const shopNameById = new Map<string, string>();
  if (shopIds.length > 0) {
    const { data: shops } = await supabase
      .from("shops")
      .select("id, name")
      .in("id", shopIds);
    for (const s of shops ?? []) {
      shopNameById.set(s.id, s.name ?? "a shop");
    }
  }

  let sent = 0;
  let bundled = 0;
  let dropped = 0;

  for (const [, rows] of groups) {
    const userId = rows[0].app_user_id;
    const claimedIds: string[] = [];

    // Claim the rows so a parallel run can't double-send.
    for (const row of rows) {
      const { data: claimed } = await supabase
        .from("notification_outbox")
        .update({ status: "sent" })
        .eq("id", row.id)
        .eq("status", "queued")
        .select("id")
        .single();
      if (claimed) claimedIds.push(row.id);
    }

    if (claimedIds.length === 0) {
      // Another run beat us to all of them — nothing to do.
      continue;
    }

    const claimedRows = rows.filter((r) => claimedIds.includes(r.id));

    let title: string;
    let body: string;
    let data: Record<string, any>;
    let category: string;

    if (claimedRows.length === 1) {
      // Single source — send the original push as-is.
      const r = claimedRows[0];
      title = r.title;
      body = r.body;
      category = r.notification_type;
      data = {
        ...(r.data ?? {}),
        shop_id: r.shop_id,
        // Single-source pushes also get a batch_id so analytics is uniform.
      };
    } else {
      // Multi-source — collapse into a digest.
      bundled++;
      const namedShops = claimedRows
        .slice(0, MAX_NAMED_SHOPS)
        .map((r) => shopNameById.get(r.shop_id) ?? "a shop");
      const remaining = claimedRows.length - namedShops.length;
      title = `${claimedRows.length} updates from your favorite spots`;
      const namedJoined = namedShops.join(" · ");
      body =
        remaining > 0
          ? `${namedJoined} +${remaining} more`
          : namedJoined;
      // Heuristic category: if every row is the same, use it; else "digest".
      const types = new Set(claimedRows.map((r) => r.notification_type));
      category = types.size === 1 ? Array.from(types)[0] : "digest";
      data = {
        digest: true,
        items: claimedRows.map((r) => ({
          shop_id: r.shop_id,
          shop_name: shopNameById.get(r.shop_id) ?? null,
          notification_type: r.notification_type,
          title: r.title,
          body: r.body,
        })),
      };
    }

    // Generate one batch_id per group so we can trace it across tables.
    const batchId = crypto.randomUUID();
    data.batch_id = batchId;

    const result = await pushNotificationService.sendToUsers([userId], {
      title,
      body,
      data,
      notificationType: category,
    });

    if (!result.success) {
      logger.warn("Digest send failed", { userId, batchId });
      dropped++;
      continue;
    }

    // Tag the outbox rows AND the resulting push_notifications row with the
    // batch_id so we can trace which sends collapsed into which push.
    await supabase
      .from("notification_outbox")
      .update({ batch_id: batchId })
      .in("id", claimedIds);

    // Annotate the push_notifications row(s) for this user that we just wrote.
    // sendToUsers writes one row per active token; the most recent matches.
    await supabase
      .from("push_notifications")
      .update({ batch_id: batchId })
      .eq("app_user_id", userId)
      .is("batch_id", null)
      .gte("created_at", new Date(Date.now() - 60 * 1000).toISOString());

    sent++;
  }

  logger.info("Digest dispatcher completed", {
    groups: groups.size,
    sent,
    bundled,
    dropped,
  });
}

if (import.meta.main) {
  runDigest()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Digest dispatcher error", { error });
      process.exit(1);
    });
}

export { runDigest };
