-- Migration: add source_plan_entry_id to scheduled_notifications
-- Description: Track which plan entry materialized each scheduled_notifications
--   row, replacing the brittle (shop_id, type, title, day) dedupe with a clean
--   (source_plan_entry_id, UTC day) key. Fixes the bug where editing a plan
--   entry's send_time_local mid-day silently fails to materialize because the
--   already-sent earlier-time row was found by the title-based dedupe lookup.
--
-- Date: 2026-05-10

ALTER TABLE public.scheduled_notifications
  ADD COLUMN IF NOT EXISTS source_plan_entry_id uuid
    REFERENCES public.notification_plan_entries(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.scheduled_notifications.source_plan_entry_id IS
  'The plan entry that materialized this row (NULL for ad-hoc/manual sends). Used as the canonical idempotency key by the materializer: at most one row per (source_plan_entry_id, UTC day).';

-- Partial unique index: only enforce uniqueness for plan-driven rows.
-- Ad-hoc rows (source_plan_entry_id IS NULL) remain unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_notifications_plan_entry_day_uniq
  ON public.scheduled_notifications (
    source_plan_entry_id,
    ((scheduled_for AT TIME ZONE 'UTC')::date)
  )
  WHERE source_plan_entry_id IS NOT NULL;
