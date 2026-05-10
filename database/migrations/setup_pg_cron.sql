-- Migration: pg_cron + pg_net scheduling for notification jobs
-- Description: Wires up the five scheduled jobs (dispatch, materialize, birthday,
--   receipts, cleanup) to fire on cadence. Each schedule POSTs to an internal
--   route on the backend, guarded by the X-Job-Secret header.
--
-- BEFORE RUNNING THIS MIGRATION:
-- 1. In the Supabase dashboard, enable both extensions: pg_cron, pg_net
--    (Database → Extensions → search and toggle on).
-- 2. Edit the two literals at the top of the DO block below:
--      base_url → your backend's HTTPS root (no trailing slash)
--      secret   → the INTERNAL_JOB_SECRET value from your backend's env
--    Then run the whole file in the Supabase SQL editor.
-- 3. Make sure INTERNAL_JOB_SECRET is set in the backend's runtime env and
--    redeployed before the first scheduled fire.
-- 4. After running, do NOT commit this file with the real secret. Either keep
--    the placeholders here and run a local copy, or rotate the secret if it
--    was committed.
--
-- Date: 2026-05-08

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Idempotent: any prior 'zvest-*' schedules are dropped and re-registered.
DO $$
DECLARE
  base_url text := 'https://zvest-loyalty-backend.onrender.com';
  secret   text := 'e8b15e2090a8f816348ed4872746535e7c15343269a8e5150c3dd71d549dde28';
BEGIN
  -- Unschedule any prior versions (no-op if they don't exist).
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname IN (
    'zvest-dispatch-scheduled-notifications',
    'zvest-dispatch-digest',
    'zvest-materialize-notification-plans',
    'zvest-birthday-notifications',
    'zvest-check-notification-receipts',
    'zvest-cleanup-stale-push-tokens'
  );

  -- 1) Dispatcher — every 5 minutes. Picks up due rows in scheduled_notifications.
  -- Trade-off: avg ~2.5 min delay between the admin-chosen send time and actual
  -- delivery. Acceptable for push notifications. Drop to '* * * * *' if we ever
  -- need second-by-second precision.
  PERFORM cron.schedule(
    'zvest-dispatch-scheduled-notifications',
    '*/5 * * * *',
    format(
      $sql$SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('X-Job-Secret', %L, 'Content-Type', 'application/json'),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );$sql$,
      base_url || '/api/internal/jobs/dispatch-scheduled-notifications',
      secret
    )
  );

  -- 2) Digest dispatcher — every 5 minutes. Reads notification_outbox rows
  --    staged by the main dispatcher (daily_meal/specials), groups by user,
  --    and ships either the original push (single source) or a bundled
  --    digest push (multi-source) so a user following 5 shops gets one push.
  PERFORM cron.schedule(
    'zvest-dispatch-digest',
    '*/5 * * * *',
    format(
      $sql$SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('X-Job-Secret', %L, 'Content-Type', 'application/json'),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );$sql$,
      base_url || '/api/internal/jobs/dispatch-digest',
      secret
    )
  );

  -- 3) Plan materializer — every 15 minutes. Materializes today's weekly-plan
  --    entries into scheduled_notifications. 15 min (vs daily) closes the
  --    "created a plan after 02:00 UTC, won't fire today" usability gap; worst-
  --    case latency between creating a plan and it being live is now <15 min.
  --    Idempotent — duplicate runs on the same day for the same (shop_id,
  --    scheduled_for-day, type, title) are no-ops.
  PERFORM cron.schedule(
    'zvest-materialize-notification-plans',
    '*/15 * * * *',
    format(
      $sql$SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('X-Job-Secret', %L, 'Content-Type', 'application/json'),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );$sql$,
      base_url || '/api/internal/jobs/materialize-notification-plans',
      secret
    )
  );

  -- 4) Birthday notifications — daily at 07:00 UTC (≈ 09:00 Europe/Ljubljana
  --    most of the year; close enough until we make this per-shop). The
  --    underlying sender dedupes per (user, shop, UTC-day) via push_notifications,
  --    so a manual re-trigger or schedule change will not double-push.
  PERFORM cron.schedule(
    'zvest-birthday-notifications',
    '0 7 * * *',
    format(
      $sql$SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('X-Job-Secret', %L, 'Content-Type', 'application/json'),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      );$sql$,
      base_url || '/api/internal/jobs/birthday-notifications',
      secret
    )
  );

  -- 5) Receipt checker — every 15 minutes. Updates push_notifications.status
  --    based on Expo receipts; deactivates DeviceNotRegistered tokens.
  PERFORM cron.schedule(
    'zvest-check-notification-receipts',
    '*/15 * * * *',
    format(
      $sql$SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('X-Job-Secret', %L, 'Content-Type', 'application/json'),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );$sql$,
      base_url || '/api/internal/jobs/check-notification-receipts',
      secret
    )
  );

  -- 6) Stale token sweep — weekly Sunday 03:00 UTC. Low priority.
  PERFORM cron.schedule(
    'zvest-cleanup-stale-push-tokens',
    '0 3 * * 0',
    format(
      $sql$SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('X-Job-Secret', %L, 'Content-Type', 'application/json'),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );$sql$,
      base_url || '/api/internal/jobs/cleanup-stale-push-tokens',
      secret
    )
  );
END $$;

-- Sanity-check the registered schedules:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'zvest-%';
-- Inspect recent runs:
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- Inspect HTTP responses (pg_net):
--   SELECT * FROM net._http_response ORDER BY created DESC LIMIT 20;
