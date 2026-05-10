import { logger } from "../config/logger";
import { supabase } from "../config/database";

/**
 * Notification Plan Materializer
 *
 * For every active plan, finds entries whose day_of_week == today (in the
 * plan's timezone), computes the absolute UTC timestamp at which the entry
 * should fire today, and inserts a row into scheduled_notifications.
 *
 * Idempotency: dedupe on (source_plan_entry_id, UTC day). At most one row
 * per plan entry per UTC day. A partial unique index in the DB enforces this
 * so concurrent materializer runs can't double-insert. Editing a plan entry's
 * send_time_local mid-day is safe — the existing pending row is updated in
 * place rather than a duplicate row inserted.
 *
 * Cadence: every 15 minutes. Closes the "create plan after 02:00 UTC, won't
 * fire today" gap; worst-case latency between saving a plan and it being
 * materialized is <15 min.
 */

type Plan = {
  id: string;
  shop_id: string;
  timezone: string;
};

type Entry = {
  id: string;
  plan_id: string;
  day_of_week: number;
  send_time_local: string; // "HH:MM" or "HH:MM:SS"
  notification_type: string;
  title: string;
  body: string;
  data: Record<string, any> | null;
};

/**
 * Returns the local day-of-week (0=Sun..6=Sat) and the UTC timestamp
 * corresponding to today's `send_time_local` in `timezone`.
 *
 * Strategy: format "now" in the target timezone to extract its local Y-M-D,
 * then construct an ISO string for that date + send_time, then ask
 * Intl what UTC time that local time maps to by binary-searching the
 * UTC offset (one tz-formatted-back-to-local round trip).
 *
 * For our use case (a simple cron, not millisecond-critical), this is enough
 * and avoids pulling in luxon/date-fns-tz.
 */
function computeScheduledForUtc(
  now: Date,
  timezone: string,
  sendTimeLocal: string
): { dayOfWeekLocal: number; scheduledForUtc: Date } {
  // Format `now` in the target timezone to read the local date components.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const year = parseInt(get("year"), 10);
  const month = parseInt(get("month"), 10); // 1-12
  const day = parseInt(get("day"), 10);
  const weekdayShort = get("weekday"); // Sun, Mon, ...
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeekLocal = dowMap[weekdayShort] ?? 0;

  // Parse send_time_local "HH:MM" or "HH:MM:SS"
  const [hh, mm, ss] = sendTimeLocal.split(":").map((s) => parseInt(s, 10));
  const hour = hh ?? 0;
  const minute = mm ?? 0;
  const second = ss ?? 0;

  // Compute the UTC timestamp where `timezone` shows year-month-day hour:minute:second.
  // Algorithm: start with UTC = those components naively, then measure the offset
  // between that "wallclock-as-UTC" and what `timezone` actually is at that instant.
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetAtNaive = getTzOffsetMs(new Date(naiveUtcMs), timezone);
  // Adjust: a tz that is +02:00 means local = utc + 2h, so utc = local - 2h.
  const correctedUtcMs = naiveUtcMs - offsetAtNaive;
  // One more pass in case the first guess crossed a DST boundary.
  const offset2 = getTzOffsetMs(new Date(correctedUtcMs), timezone);
  const finalUtcMs = naiveUtcMs - offset2;

  return {
    dayOfWeekLocal,
    scheduledForUtc: new Date(finalUtcMs),
  };
}

/**
 * Returns the offset (in ms) between `timezone` wallclock and UTC at the given
 * instant. Positive for east-of-UTC zones, e.g. Europe/Ljubljana CEST = +7200000.
 */
function getTzOffsetMs(instant: Date, timezone: string): number {
  const tzFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = tzFmt.formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const y = parseInt(get("year"), 10);
  const m = parseInt(get("month"), 10);
  const d = parseInt(get("day"), 10);
  const h = parseInt(get("hour"), 10);
  const mi = parseInt(get("minute"), 10);
  const s = parseInt(get("second"), 10);
  const tzAsUtc = Date.UTC(y, m - 1, d, h, mi, s);
  return tzAsUtc - instant.getTime();
}

async function runMaterializer() {
  logger.info("Starting notification plan materializer");

  const { data: plans, error: plansErr } = await supabase
    .from("notification_plans")
    .select("id, shop_id, timezone")
    .eq("is_active", true);

  if (plansErr) {
    logger.error("Error fetching plans", { error: plansErr });
    throw plansErr;
  }
  if (!plans || plans.length === 0) {
    logger.info("No active plans");
    return;
  }

  const now = new Date();
  let materialized = 0;
  let skippedDuplicate = 0;

  for (const plan of plans as Plan[]) {
    let dayOfWeekLocal: number;
    try {
      // Cheap pre-check using a dummy time so we can fetch only the entries we
      // actually need, instead of pulling all 7.
      const probe = computeScheduledForUtc(now, plan.timezone, "00:00");
      dayOfWeekLocal = probe.dayOfWeekLocal;
    } catch (e) {
      logger.error("Bad timezone on plan, skipping", {
        planId: plan.id,
        timezone: plan.timezone,
        error: e,
      });
      continue;
    }

    const { data: entries, error: entriesErr } = await supabase
      .from("notification_plan_entries")
      .select(
        "id, plan_id, day_of_week, send_time_local, notification_type, title, body, data"
      )
      .eq("plan_id", plan.id)
      .eq("day_of_week", dayOfWeekLocal)
      .eq("is_active", true);

    if (entriesErr) {
      logger.error("Error fetching entries", {
        error: entriesErr,
        planId: plan.id,
      });
      continue;
    }
    if (!entries || entries.length === 0) continue;

    for (const entry of entries as Entry[]) {
      const { scheduledForUtc } = computeScheduledForUtc(
        now,
        plan.timezone,
        entry.send_time_local
      );

      // If the computed time is already in the past today, skip — we don't
      // backfill missed windows.
      if (scheduledForUtc.getTime() < now.getTime() - 60_000) {
        logger.info("Skipping past-due entry", {
          planId: plan.id,
          entryId: entry.id,
          scheduledFor: scheduledForUtc.toISOString(),
        });
        continue;
      }

      // Lookup any existing row materialized from this entry on the same UTC day.
      const dayStart = new Date(scheduledForUtc);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(scheduledForUtc);
      dayEnd.setUTCHours(23, 59, 59, 999);

      const { data: existing, error: existingErr } = await supabase
        .from("scheduled_notifications")
        .select("id, scheduled_for, title, body, data, status")
        .eq("source_plan_entry_id", entry.id)
        .gte("scheduled_for", dayStart.toISOString())
        .lte("scheduled_for", dayEnd.toISOString())
        .limit(1)
        .maybeSingle();

      if (existingErr) {
        logger.error("Failed to query existing materialized row", {
          error: existingErr,
          planId: plan.id,
          entryId: entry.id,
        });
        continue;
      }

      if (existing) {
        // Don't touch rows the dispatcher has already acted on.
        if (existing.status !== "scheduled") {
          skippedDuplicate++;
          continue;
        }

        // If the entry was edited (time, title, body, data), reflect it on the
        // pending row. Skip the write when nothing actually changed to avoid
        // pointless updated_at churn.
        const targetIso = scheduledForUtc.toISOString();
        const newData = entry.data ?? {};
        const dataChanged =
          JSON.stringify(existing.data ?? {}) !== JSON.stringify(newData);
        const needsUpdate =
          existing.scheduled_for !== targetIso ||
          existing.title !== entry.title ||
          existing.body !== entry.body ||
          dataChanged;

        if (!needsUpdate) {
          skippedDuplicate++;
          continue;
        }

        const { error: updateErr } = await supabase
          .from("scheduled_notifications")
          .update({
            scheduled_for: targetIso,
            title: entry.title,
            body: entry.body,
            data: newData,
          })
          .eq("id", existing.id);

        if (updateErr) {
          logger.error("Failed to update materialized row", {
            error: updateErr,
            planId: plan.id,
            entryId: entry.id,
            rowId: existing.id,
          });
          continue;
        }
        materialized++;
        continue;
      }

      const { error: insertErr } = await supabase
        .from("scheduled_notifications")
        .insert({
          shop_id: plan.shop_id,
          source_plan_entry_id: entry.id,
          notification_type: entry.notification_type,
          title: entry.title,
          body: entry.body,
          data: entry.data ?? {},
          scheduled_for: scheduledForUtc.toISOString(),
          status: "scheduled",
        });

      if (insertErr) {
        // Likely a race with another concurrent materializer — the partial
        // unique index will reject the second insert. Treat as success-equivalent.
        logger.warn("Insert failed, possibly a race; will recompute next tick", {
          error: insertErr,
          planId: plan.id,
          entryId: entry.id,
        });
        continue;
      }
      materialized++;
    }
  }

  logger.info("Materializer completed", { materialized, skippedDuplicate });
}

if (import.meta.main) {
  runMaterializer()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Materializer error", { error });
      process.exit(1);
    });
}

export { runMaterializer };
